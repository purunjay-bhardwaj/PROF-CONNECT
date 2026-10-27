"""Profconnect Meeting Place: single-process FastAPI room service and WebRTC signaling relay."""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from backend.models import CreateRoom, JoinRoom, Signal

DB_PATH = os.getenv("DATABASE_PATH", "data/gather.db")
MAX_PARTICIPANTS = min(4, max(2, int(os.getenv("MAX_PARTICIPANTS", "4"))))
ROOM_TTL = int(os.getenv("ROOM_TTL_HOURS", "24")) * 3600
TURN_URLS = [s.strip() for s in os.getenv("TURN_URLS", "").split(",") if s.strip()]
TURN_SECRET = os.getenv("TURN_SECRET", "")
TURN_USERNAME = os.getenv("TURN_USERNAME", "")
TURN_PASSWORD = os.getenv("TURN_PASSWORD", "")
ALLOWED_ORIGINS = [s.strip().rstrip("/") for s in os.getenv("ALLOWED_ORIGINS", "").split(",") if s.strip()]
PREVIEW_MODE = os.getenv("PREVIEW_MODE", "false").lower() == "true"
ROOT = Path(__file__).resolve().parent.parent
rooms = defaultdict(dict)
tickets = {}
rates = {}
db = None


def secret_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(value, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode(), bytes.fromhex(salt), 210_000).hex()
    return f"{salt}:{digest}"


def password_matches(value, saved):
    return hmac.compare_digest(password_hash(value, saved.split(":")[0]), saved)


def room_or_404(room_id):
    row = db.execute("SELECT * FROM rooms WHERE id=?", (room_id,)).fetchone()
    if not row or row["ended"] or row["expires_at"] <= time.time():
        raise HTTPException(404, "This room does not exist or has expired. Ask your host for a new invitation.")
    return dict(row)


def public_person(p):
    return {k: p[k] for k in ("id", "name", "host", "mic", "camera", "hand", "sharing")}


def limit(key, maximum, window):
    now = time.monotonic()
    items = rates.setdefault(key, deque())
    while items and items[0] < now - window:
        items.popleft()
    if len(items) >= maximum:
        raise HTTPException(429, "Too many attempts. Please wait a few minutes before trying again.")
    items.append(now)


def ice_servers(peer_id):
    result = [{"urls": ["stun:stun.l.google.com:19302"]}]
    if TURN_URLS and TURN_SECRET:
        # Valid for the maximum room lifetime plus one hour.
        username = f"{int(time.time()) + ROOM_TTL + 3600}:{peer_id}"
        credential = base64.b64encode(hmac.new(TURN_SECRET.encode(), username.encode(), hashlib.sha1).digest()).decode()
        result.append({"urls": TURN_URLS, "username": username, "credential": credential})
    elif TURN_URLS and TURN_USERNAME and TURN_PASSWORD:
        result.append({"urls": TURN_URLS, "username": TURN_USERNAME, "credential": TURN_PASSWORD})
    return result


async def emit(person, message):
    try:
        async with person["send_lock"]:
            await asyncio.wait_for(person["ws"].send_json(message), timeout=5)
    except (RuntimeError, WebSocketDisconnect, asyncio.TimeoutError, OSError):
        pass


async def broadcast(room, message, exclude=None):
    await asyncio.gather(*(emit(p, message) for pid, p in list(rooms.get(room, {}).items()) if pid != exclude))


async def finish(room_id):
    db.execute("UPDATE rooms SET ended=1 WHERE id=?", (room_id,))
    db.commit()
    await broadcast(room_id, {"type": "ended"})
    for p in list(rooms.get(room_id, {}).values()):
        try:
            await p["ws"].close(code=1000, reason="Meeting ended")
        except (RuntimeError, OSError):
            pass


async def cleanup():
    while True:
        await asyncio.sleep(60)
        now = time.time()
        for token, ticket in list(tickets.items()):
            if ticket["expires"] < now:
                tickets.pop(token, None)
        for room_id in list(rooms):
            row = db.execute("SELECT expires_at FROM rooms WHERE id=?", (room_id,)).fetchone()
            if not row or row["expires_at"] <= now:
                await finish(room_id)
        db.execute("DELETE FROM rooms WHERE expires_at < ?", (now - 86400,))
        db.commit()
        stale = time.monotonic() - 3600
        for key, events in list(rates.items()):
            if not events or events[-1] < stale:
                rates.pop(key, None)


@asynccontextmanager
async def lifespan(app):
    global db
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, host_hash TEXT NOT NULL,
      passcode_hash TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,
      expires_at REAL NOT NULL, locked INTEGER NOT NULL DEFAULT 0,
      ended INTEGER NOT NULL DEFAULT 0
    )""")
    db.commit()
    task = asyncio.create_task(cleanup())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    for room_id in list(rooms):
        for p in list(rooms.get(room_id, {}).values()):
            try:
                await p["ws"].close(code=1001)
            except (RuntimeError, OSError):
                pass
    rooms.clear()
    tickets.clear()
    db.close()


app = FastAPI(title="Profconnect Meeting Place API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", redoc_url=None)
if ALLOWED_ORIGINS or PREVIEW_MODE:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if PREVIEW_MODE else ALLOWED_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )


def allowed_origin(origin, host):
    if not origin:
        return True  # CLI clients; endpoints still require room secrets/tickets.
    if PREVIEW_MODE:
        return True
    if ALLOWED_ORIGINS:
        return origin.rstrip("/") in ALLOWED_ORIGINS
    parsed = urlparse(origin)
    return parsed.scheme in ("http", "https") and parsed.netloc == host


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.method == "POST" and not allowed_origin(request.headers.get("origin"), request.headers.get("host")):
        return JSONResponse({"detail": "Origin not allowed."}, status_code=403)
    if request.method == "POST":
        # Count actual bytes, not only an untrusted Content-Length header.
        body = b""
        async for chunk in request.stream():
            body += chunk
            if len(body) > 8192:
                return JSONResponse({"detail": "Request too large."}, status_code=413)
        request._body = body
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    if not PREVIEW_MODE:
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), display-capture=(self)"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://api.fontshare.com; "
            "font-src 'self' https://cdn.fontshare.com https://api.fontshare.com; "
            "img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
        )
        if request.url.path == "/api/docs":
            # Swagger UI is the one route that loads its scripts from a CDN.
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "img-src 'self' data: https://fastapi.tiangolo.com; "
                "object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
            )
    return response


@app.get("/api/health")
async def health():
    db.execute("SELECT 1").fetchone()
    return {"status": "ok"}


@app.get("/api/config")
async def config():
    return {
        "maxParticipants": MAX_PARTICIPANTS,
        "roomTTLHours": ROOM_TTL // 3600,
        "turnConfigured": bool(TURN_URLS and (TURN_SECRET or (TURN_USERNAME and TURN_PASSWORD))),
    }


@app.post("/api/rooms", status_code=201)
async def create_room(body: CreateRoom, request: Request):
    limit(("create", request.client.host), 15, 3600)
    active = db.execute("SELECT count(*) FROM rooms WHERE expires_at>? AND ended=0", (time.time(),)).fetchone()[0]
    if active >= 1000:
        raise HTTPException(503, "The server has reached its room limit. Please try again later.")
    room_id = "-".join(secrets.token_hex(2) for _ in range(3))
    token = secrets.token_urlsafe(32)
    saved = await asyncio.to_thread(password_hash, body.passcode) if body.passcode else ""
    now = time.time()
    db.execute("INSERT INTO rooms(id,title,host_hash,passcode_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)",
               (room_id, body.title, secret_hash(token), saved, now, now + ROOM_TTL))
    db.commit()
    return {"id": room_id, "title": body.title, "host_token": token, "expires_at": now + ROOM_TTL}


@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, body: JoinRoom, request: Request):
    limit(("join", request.client.host), 45, 300)
    row = room_or_404(room_id)
    is_host = bool(body.host_token and hmac.compare_digest(secret_hash(body.host_token), row["host_hash"]))
    if row["locked"] and not is_host:
        raise HTTPException(403, "This room is locked. Ask your host to unlock it.")
    if row["passcode_hash"] and not is_host:
        valid = await asyncio.to_thread(password_matches, body.passcode, row["passcode_hash"])
        if not valid:
            raise HTTPException(403, "That passcode is not correct. Ask your host and try again.")
    if len(rooms.get(room_id, {})) >= MAX_PARTICIPANTS:
        raise HTTPException(409, f"This room is full. Profconnect Meeting Place supports up to {MAX_PARTICIPANTS} people.")
    peer_id = secrets.token_urlsafe(12)
    token = secrets.token_urlsafe(32)
    tickets[secret_hash(token)] = {
        "room": room_id, "id": peer_id, "name": body.name, "host": is_host, "expires": time.time() + 60,
    }
    return {"token": token, "id": peer_id, "host": is_host, "title": row["title"], "iceServers": ice_servers(peer_id)}


@app.websocket("/ws/{room_id}")
async def websocket_room(ws: WebSocket, room_id: str):
    if not allowed_origin(ws.headers.get("origin"), ws.headers.get("host")):
        await ws.close(code=1008)
        return
    try:
        limit(("socket", ws.client.host), 90, 300)
    except HTTPException:
        await ws.close(code=1008)
        return
    await ws.accept()
    peer = None
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        if len(raw) > 1024:
            await ws.close(code=1009)
            return
        auth = json.loads(raw)
        if not isinstance(auth, dict) or not isinstance(auth.get("token"), str):
            await ws.close(code=1008)
            return
        ticket = tickets.pop(secret_hash(auth["token"]), None)
        if not ticket or ticket["room"] != room_id or ticket["expires"] < time.time():
            await ws.send_json({"type": "error", "detail": "Your join ticket has expired. Leave and rejoin."})
            await ws.close(code=1008)
            return
        row = room_or_404(room_id)
        if (row["locked"] and not ticket["host"]) or len(rooms.get(room_id, {})) >= MAX_PARTICIPANTS:
            await ws.send_json({"type": "error", "detail": "The room is now locked or full. Please try again later."})
            await ws.close(code=1008)
            return
        others = [public_person(p) for p in rooms.get(room_id, {}).values()]
        peer = {**ticket, "ws": ws, "send_lock": asyncio.Lock(), "mic": False, "camera": False, "hand": False, "sharing": False}
        rooms[room_id][peer["id"]] = peer
        await emit(peer, {"type": "welcome", "participants": others, "locked": bool(row["locked"])})
        await broadcast(room_id, {"type": "joined", "participant": public_person(peer)}, exclude=peer["id"])
        messages = deque()
        chats = deque()
        while True:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=75)
            if len(raw) > 48000:
                await ws.close(code=1009)
                break
            now = time.monotonic()
            messages.append(now)
            while messages and messages[0] < now - 10:
                messages.popleft()
            if len(messages) > 240:
                await ws.close(code=1008, reason="Rate limit")
                break
            try:
                msg = Signal.model_validate_json(raw)
            except ValidationError:
                await emit(peer, {"type": "error", "detail": "Invalid meeting message."})
                continue
            if msg.type == "ping":
                await emit(peer, {"type": "pong"})
            elif msg.type in ("offer", "answer", "ice"):
                target = rooms.get(room_id, {}).get(msg.to)
                if target and target["id"] != peer["id"]:
                    await emit(target, {"type": msg.type, "from": peer["id"], "sdp": msg.sdp, "candidate": msg.candidate})
            elif msg.type == "state":
                state = {k: getattr(msg, k) for k in ("mic", "camera", "hand", "sharing")}
                peer.update(state)
                await broadcast(room_id, {"type": "state", "from": peer["id"], "state": state}, exclude=peer["id"])
            elif msg.type == "chat" and msg.text.strip():
                while chats and chats[0] < now - 10:
                    chats.popleft()
                if len(chats) >= 10:
                    await emit(peer, {"type": "error", "detail": "You are sending messages too quickly. Wait a moment."})
                    continue
                chats.append(now)
                await broadcast(room_id, {"type": "chat", "id": secrets.token_hex(8), "from": peer["id"],
                                          "name": peer["name"], "text": msg.text.strip(), "at": int(time.time() * 1000)})
            elif msg.type in ("lock", "end"):
                if not peer["host"]:
                    await emit(peer, {"type": "error", "detail": "Only the host can do that."})
                    continue
                if msg.type == "end":
                    await finish(room_id)
                    break
                db.execute("UPDATE rooms SET locked=? WHERE id=?", (int(msg.locked), room_id))
                db.commit()
                await broadcast(room_id, {"type": "locked", "locked": msg.locked})
    except HTTPException as error:
        try:
            await ws.send_json({"type": "error", "detail": error.detail})
            await ws.close(code=1008)
        except (RuntimeError, OSError):
            pass
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, RuntimeError, OSError):
        try:
            await ws.close(code=1000)
        except (RuntimeError, OSError):
            pass
    finally:
        if peer:
            rooms.get(room_id, {}).pop(peer["id"], None)
            await broadcast(room_id, {"type": "left", "id": peer["id"]})
            if room_id in rooms and not rooms[room_id]:
                rooms.pop(room_id, None)


if (ROOT / "dist").exists():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
