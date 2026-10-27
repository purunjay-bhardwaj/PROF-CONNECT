"""Shared request and signaling contracts. Never trust client-provided roles."""
from typing import Literal
from pydantic import BaseModel, Field, field_validator


class CreateRoom(BaseModel):
    title: str = Field(default="A little catch-up", max_length=80)
    passcode: str = Field(default="", max_length=64)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        return value.strip() or "A little catch-up"


class JoinRoom(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    passcode: str = Field(default="", max_length=64)
    host_token: str = Field(default="", max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Please enter your name.")
        return value.strip()


class Signal(BaseModel):
    type: Literal["offer", "answer", "ice", "chat", "state", "lock", "end", "ping"]
    to: str = Field(default="", max_length=64)
    sdp: str = Field(default="", max_length=32000)
    candidate: dict | None = None
    text: str = Field(default="", max_length=2000)
    mic: bool = False
    camera: bool = False
    hand: bool = False
    sharing: bool = False
    locked: bool = False
