"""Schémas Pydantic — commentaires. Extraits de server.py à l'identique."""
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CommentCreate(BaseModel):
    content: str


class Comment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    post_id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    author_is_verified: bool = False
    author_is_premium: bool = False     # commentaire d'un abonné Premium (remonté en tête)
    content: str
    likes_count: int = 0
    replies_count: int = 0
    is_liked: bool = False
    parent_comment_id: Optional[str] = None
    created_at: str
