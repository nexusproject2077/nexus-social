"""Schémas Pydantic — stories. Extraits de server.py à l'identique."""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class StoryCreate(BaseModel):
    media_type: str
    media_url: str


class Story(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    media_type: str
    media_url: str
    text: Optional[str] = None            # légende / texte incrusté
    audience: str = "everyone"           # everyone | close_friends | custom
    music_url: Optional[str] = None       # extrait audio (preview iTunes, 30 s)
    music_title: Optional[str] = None
    music_artist: Optional[str] = None
    music_start: float = 0.0              # passage de départ (secondes)
    mirror: bool = False                  # vidéo frontale à remettre « à l'endroit »
    views_count: int = 0
    created_at: str
    expires_at: str
    has_viewed: bool = False
    is_mine: bool = False                 # story de l'utilisateur courant (autorité serveur)


class StoryGroup(BaseModel):
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    stories: List[Story]
    last_story_time: str
