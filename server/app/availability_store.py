# Persisted per-teacher "in office right now" state — Supabase-backed
# (table: teacher_availability, see db/schema.sql) so a backend restart
# doesn't reset every professor back to out-of-office. Distinct from the
# legacy Raspberry-Pi-door-unit store in store.py — that one is keyed by
# fake seed slugs ("aris-thorne", etc.) left over from before the app had
# real DB-backed teachers, and nothing in the UI reads from it anymore.
#
# Canonical record shape: {in_office: bool, note: str, updated_at: str|None}.
# The router builds both the app's own legacy "status: available/away"
# response shape and the Raspberry-Pi-facing "in_office/IN_OFFICE" shape
# from this one record, so there's a single source of truth per teacher.
from datetime import datetime, timezone
from typing import Optional

from .db import supabase

TABLE = "teacher_availability"

DEFAULT_RECORD = {"in_office": False, "note": "", "updated_at": None}


def _row_to_record(row: Optional[dict]) -> dict:
    if not row:
        return dict(DEFAULT_RECORD)
    return {
        "in_office": bool(row.get("in_office", False)),
        "note": row.get("note") or "",
        "updated_at": row.get("updated_at"),
    }


def get_record(teacher_id: int) -> dict:
    if supabase is None:
        return dict(DEFAULT_RECORD)
    rows = (
        supabase.table(TABLE)
        .select("in_office,note,updated_at")
        .eq("teacher_id", teacher_id)
        .limit(1)
        .execute()
        .data
    )
    return _row_to_record(rows[0] if rows else None)


def list_records() -> dict[int, dict]:
    if supabase is None:
        return {}
    rows = supabase.table(TABLE).select("teacher_id,in_office,note,updated_at").execute().data
    return {int(row["teacher_id"]): _row_to_record(row) for row in rows}


def set_record(teacher_id: int, *, in_office: bool, note: str = "") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    row = {"teacher_id": teacher_id, "in_office": in_office, "note": note, "updated_at": now}
    if supabase is not None:
        supabase.table(TABLE).upsert(row).execute()
    return _row_to_record(row)
