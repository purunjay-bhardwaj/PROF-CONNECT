# Real teacher "available in my room" toggle — professor-only feature.
# Distinct from routers/professors.py (the legacy Raspberry-Pi-door-unit
# bridge, keyed by fake seed professor ids and gated by device/admin API
# keys). This router is keyed by the real numeric teacher_id and gated by
# the teacher's own JWT, so a professor can only ever set their own status.
#
# PUT /me + GET /{teacher_id} follow the contract in
# ProfConnect_Raspberry_Pi_Integration_README: the Pi kiosk polls
# GET /{teacher_id} every 15-30s with no credentials at all — it must never
# see appointment data, student details, or auth/DB internals, so that
# response only ever carries the five public display fields.
#
# GET "" (bulk) keeps the app's own pre-existing "status: available/away"
# shape, since that's what useLiveStatus() and every page reading it
# (Explore/Home/Dashboard/Profile) already expect — both shapes are built
# from the same persisted record (see ../availability_store.py) so there's
# one source of truth per teacher.
#
# Broadcasts through the same socket.io "status:update" channel as the
# legacy system (see ../sockets.py), so the existing frontend
# useLiveStatus() hook picks up changes with no socket-side changes needed.
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, field_validator

from .. import availability_store as store
from ..auth_utils import require_claims
from ..sockets import broadcast_status_update

router = APIRouter(tags=["availability"])


class AvailabilityUpdate(BaseModel):
    in_office: bool
    note: str = ""

    @field_validator("note")
    @classmethod
    def _limit_note(cls, v: str) -> str:
        v = v.strip()
        if len(v) > 180:
            raise ValueError("note must be 180 characters or fewer.")
        return v


def _legacy_shape(teacher_id: int, record: dict) -> dict:
    return {
        "id": str(teacher_id),
        "status": "available" if record["in_office"] else "away",
        "note": record["note"] or None,
        "updatedAt": record["updated_at"],
    }


def _public_shape(teacher_id: int, record: dict) -> dict:
    return {
        "teacher_id": str(teacher_id),
        "in_office": record["in_office"],
        "status": "IN_OFFICE" if record["in_office"] else "OUT_OF_OFFICE",
        "note": record["note"],
        "updated_at": record["updated_at"],
    }


# GET /api/availability
# Bulk read — used by useLiveStatus() to paint every status dot on initial
# page load, before the websocket takes over for live updates.
@router.get("")
def list_availability():
    return [
        _legacy_shape(teacher_id, record)
        for teacher_id, record in store.list_records().items()
    ]


# GET /api/availability/{teacher_id}
# Public, unauthenticated — the exact contract the Raspberry Pi kiosk polls.
# Exposes only display fields; never appointment data, student details, or
# internal DB/auth configuration.
@router.get("/{teacher_id}")
def get_availability(teacher_id: int):
    return _public_shape(teacher_id, store.get_record(teacher_id))


# PUT /api/availability/me
# The professor's own "Available in my room" toggle on the Dashboard. Only
# the signed-in teacher can set their own availability — there is no way
# for a student, or one teacher, to set another teacher's status.
@router.put("/me")
async def set_my_availability(
    payload: AvailabilityUpdate,
    authorization: Optional[str] = Header(default=None),
):
    claims = require_claims(authorization)
    if claims.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can update availability.")
    teacher_id = int(claims["sub"])

    record = store.set_record(teacher_id, in_office=payload.in_office, note=payload.note)

    await broadcast_status_update(_legacy_shape(teacher_id, record))
    return {"ok": True, "availability": _public_shape(teacher_id, record)}
