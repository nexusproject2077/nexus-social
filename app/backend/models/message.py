"""Schémas Pydantic — messagerie (messages + conversations).

Extraits de server.py à l'identique (refactor progressif, Phase 4).
"""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class MessageCreate(BaseModel):
    recipient_id: str
    content: str = ""
    media_url: Optional[str] = None   # image compressée (data URL) éventuelle
    media_type: Optional[str] = None  # "image" pour l'instant
    reply_to_id: Optional[str] = None


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    sender_id: str
    sender_username: str
    sender_profile_pic: Optional[str] = None
    recipient_id: str
    recipient_username: str
    content: str = ""
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    reply_to_id: Optional[str] = None
    read: bool = False
    reactions: List[dict] = []  # [{user_id, emoji, ...}] — sinon perdues au rechargement
    created_at: str
    expires_at: Optional[str] = None  # message éphémère : date d'auto-suppression


class Conversation(BaseModel):
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    last_message: str
    last_message_time: str
    unread_count: int = 0
    # Préférences personnelles (épingler / sourdine / marqué non lu) — façon Instagram.
    pinned: bool = False
    muted: bool = False
    marked_unread: bool = False
    is_online: bool = False             # présence de l'interlocuteur (si son statut est visible)
