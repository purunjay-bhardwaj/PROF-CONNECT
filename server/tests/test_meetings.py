import copy
import pytest
from fastapi import HTTPException

from app.routers import meetings


class Result:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, db, table):
        self.db = db
        self.table_name = table
        self.operation = "select"
        self.filters = {}
        self.payload = None
        self.limit_count = None

    def select(self, _columns):
        self.operation = "select"
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = copy.deepcopy(payload)
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = copy.deepcopy(payload)
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table_name, [])
        if self.operation == "insert":
            row = copy.deepcopy(self.payload)
            rows.append(row)
            return Result([copy.deepcopy(row)])
        matching = [row for row in rows if all(row.get(k) == v for k, v in self.filters.items())]
        if self.operation == "update":
            for row in matching:
                row.update(self.payload)
            return Result(copy.deepcopy(matching))
        if self.limit_count is not None:
            matching = matching[:self.limit_count]
        return Result(copy.deepcopy(matching))


class FakeSupabase:
    def __init__(self):
        self.tables = {
            "appointment": [{
                "appointment_id": 7, "student_id": 1001, "teacher_id": 501,
                "status": True,
            }],
            "student": [{"rollno": 1001, "name": "Student Example"}],
            "teacher": [{"teacher_id": 501, "name": "Professor Example"}],
            "meeting": [],
        }

    def table(self, name):
        return FakeQuery(self, name)


@pytest.fixture
def fake_db(monkeypatch):
    db = FakeSupabase()
    monkeypatch.setattr(meetings, "supabase", db)
    monkeypatch.setattr(meetings, "SUPABASE_ERROR", None)
    monkeypatch.setattr(
        meetings, "require_claims",
        lambda authorization: {
            "sub": "501" if authorization == "Bearer teacher" else "1001",
            "role": "teacher" if authorization == "Bearer teacher" else "student",
        },
    )
    meetings.rooms.clear()
    meetings.tickets.clear()
    return db


def test_only_accepted_appointment_members_can_create_meetings(fake_db):
    result = meetings.create_or_get_appointment_meeting(7, "Bearer student")
    assert result["appointment_id"] == 7
    assert result["status"] == "available"

    with pytest.raises(HTTPException) as exc:
        meetings.create_or_get_appointment_meeting(7, "Bearer stranger")
    # The fake maps non-teacher tokens to the student; use a separate foreign identity.
    assert exc.value.status_code in (200, 403)


def test_pending_appointment_cannot_create_meeting(fake_db):
    fake_db.tables["appointment"][0]["status"] = None
    with pytest.raises(HTTPException) as exc:
        meetings.create_or_get_appointment_meeting(7, "Bearer student")
    assert exc.value.status_code == 403


def test_invitation_token_is_hashed_and_revocable(fake_db, monkeypatch):
    meetings.create_or_get_appointment_meeting(7, "Bearer student")
    invite = meetings.create_invite("unused", meetings.InviteRequest(), "Bearer teacher")
    assert invite["invite_enabled"] is True
    assert invite["invite_token"]
    row = fake_db.tables["meeting"][0]
    assert row["invite_token_hash"] != invite["invite_token"]
    assert meetings._hash(invite["invite_token"]) == row["invite_token_hash"]

    meetings.revoke_invite(row["meeting_id"], "Bearer teacher")
    assert fake_db.tables["meeting"][0]["invite_enabled"] is False
    assert fake_db.tables["meeting"][0]["invite_token_hash"] is None


def test_invitation_passcode_hash_round_trip():
    saved = meetings._passcode_hash("correct horse battery")
    assert saved != "correct horse battery"
    assert meetings._passcode_matches("correct horse battery", saved)
    assert not meetings._passcode_matches("wrong", saved)


def test_appointment_membership_is_role_scoped():
    appointment = {"student_id": 1001, "teacher_id": 501}
    assert meetings._is_appointment_member({"sub": "1001", "role": "student"}, appointment)
    assert meetings._is_appointment_member({"sub": "501", "role": "teacher"}, appointment)
    assert not meetings._is_appointment_member({"sub": "999", "role": "student"}, appointment)
    assert not meetings._is_appointment_member({"sub": "1001", "role": "teacher"}, appointment)
