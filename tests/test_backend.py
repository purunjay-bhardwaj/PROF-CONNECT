import os
import tempfile
import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_PATH"] = tempfile.mktemp(suffix=".db")
from backend.main import app, rates, tickets, rooms


@pytest.fixture
def client():
    rates.clear()
    tickets.clear()
    rooms.clear()
    with TestClient(app) as c:
        yield c


def create(client, **kw):
    response = client.post("/api/rooms", json={"title": "Test room", **kw})
    assert response.status_code == 201
    return response.json()


def join(client, room, name="Alice", **kw):
    response = client.post(f"/api/rooms/{room}/join", json={"name": name, **kw})
    assert response.status_code == 200, response.text
    return response.json()


def auth(socket, ticket):
    socket.send_json({"token": ticket["token"]})
    return socket.receive_json()


def test_health_and_validation(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/config").json()["maxParticipants"] == 4
    assert client.post("/api/rooms", json={"title": "x" * 81}).status_code == 422
    assert client.post("/api/rooms", content="x" * 9000).status_code == 413
    assert client.post("/api/rooms", json={}, headers={"Origin": "https://evil.example"}).status_code == 403


def test_room_privacy_and_host_identity(client):
    room = create(client, passcode="private")
    url = f"/api/rooms/{room['id']}/join"
    assert client.post(url, json={"name": "  "}).status_code == 422
    assert client.post(url, json={"name": "Mallory", "passcode": "wrong"}).status_code == 403
    guest = join(client, room["id"], passcode="private")
    assert guest["host"] is False
    assert "host_token" not in guest
    host = join(client, room["id"], host_token=room["host_token"])
    assert host["host"] is True
    assert client.post("/api/rooms/missing/join", json={"name": "Nobody"}).status_code == 404


def test_signaling_chat_lock_and_end(client):
    room = create(client)
    rid = room["id"]
    host = join(client, rid, host_token=room["host_token"])
    guest = join(client, rid, name="Bob")
    with client.websocket_connect(f"/ws/{rid}") as a:
        assert auth(a, host)["type"] == "welcome"
        with client.websocket_connect(f"/ws/{rid}") as b:
            welcome = auth(b, guest)
            assert welcome["participants"][0]["host"] is True
            assert a.receive_json()["type"] == "joined"
            b.send_json({"type": "offer", "to": host["id"], "sdp": "test-sdp"})
            assert a.receive_json()["sdp"] == "test-sdp"
            b.send_json({"type": "chat", "text": "<script>not executable</script>"})
            message = a.receive_json()
            assert message["name"] == "Bob"
            assert b.receive_json()["id"] == message["id"]
            b.send_json({"type": "lock", "locked": True})
            assert b.receive_json()["type"] == "error"
            a.send_json({"type": "lock", "locked": True})
            assert a.receive_json()["locked"] is True
            assert b.receive_json()["locked"] is True
            assert client.post(f"/api/rooms/{rid}/join", json={"name": "Eve"}).status_code == 403
            a.send_json({"type": "lock", "locked": False})
            assert a.receive_json()["locked"] is False
            assert b.receive_json()["locked"] is False
            a.send_json({"type": "end"})
            assert a.receive_json()["type"] == "ended"
            assert b.receive_json()["type"] == "ended"
            assert client.post(f"/api/rooms/{rid}/join", json={"name": "Eve"}).status_code == 404


def test_ticket_single_use_and_bad_origin(client):
    from starlette.websockets import WebSocketDisconnect
    room = create(client)
    ticket = join(client, room["id"])
    with client.websocket_connect(f"/ws/{room['id']}") as ws:
        assert auth(ws, ticket)["type"] == "welcome"
    with client.websocket_connect(f"/ws/{room['id']}") as ws:
        assert auth(ws, ticket)["type"] == "error"
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/{room['id']}", headers={"Origin": "https://evil.example"}):
            pass


def test_capacity_and_room_isolation(client):
    from contextlib import ExitStack
    room = create(client)
    other = create(client)
    foreign = join(client, other["id"], name="Foreign")
    with ExitStack() as stack:
        connections = []
        for i in range(4):
            ticket = join(client, room["id"], name=f"Guest {i}")
            ws = stack.enter_context(client.websocket_connect(f"/ws/{room['id']}"))
            assert auth(ws, ticket)["type"] == "welcome"
            for prior in connections:
                assert prior.receive_json()["type"] == "joined"
            connections.append(ws)
        assert client.post(f"/api/rooms/{room['id']}/join", json={"name": "Overflow"}).status_code == 409
        f = stack.enter_context(client.websocket_connect(f"/ws/{other['id']}"))
        auth(f, foreign)
        connections[0].send_json({"type": "offer", "to": foreign["id"], "sdp": "must not arrive"})
        f.send_json({"type": "ping"})
        assert f.receive_json()["type"] == "pong"


def test_expired_room_and_rate_limit(client):
    import backend.main as server
    room = create(client)
    server.db.execute("UPDATE rooms SET expires_at=0 WHERE id=?", (room["id"],))
    server.db.commit()
    assert client.post(f"/api/rooms/{room['id']}/join", json={"name": "Late"}).status_code == 404
    for _ in range(14):
        create(client)
    assert client.post("/api/rooms", json={}).status_code == 429
