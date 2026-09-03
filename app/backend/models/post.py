"""Schémas Pydantic — sondages et publications (posts / clips).

Extraits de server.py à l'identique (refactor progressif, Phase 4).
"""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, model_validator


class PollOption(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    text: str
    votes: int = 0


class Poll(BaseModel):
    model_config = ConfigDict(extra="ignore")
    options: List[PollOption]
    total_votes: int = 0


class PollVote(BaseModel):
    option_id: str


class PostCreate(BaseModel):
    content: str
    media_type: Optional[str] = None
    media_url: Optional[str] = None
    poll_options: Optional[List[str]] = None  # >= 2 options => sondage attaché au post
    affiliate_link: Optional[str] = None  # lien affilié optionnel (http/https)


class Post(BaseModel):
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def _tolerate_nulls(cls, data):
        """Empêche qu'une publication ancienne/incomplète (champ requis à null,
        ex. content=None) ne fasse échouer TOUTE une liste de publications."""
        if isinstance(data, dict):
            for k in ("id", "author_id", "author_username", "content", "created_at"):
                if data.get(k) is None:
                    data[k] = ""
        return data

    id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    author_is_verified: bool = False
    author_is_premium: bool = False  # badge Premium sur la publication (avantage réel)
    author_can_receive_tips: bool = False  # auteur a un compte Stripe → bouton Pourboire
    author_is_following: bool = False  # l'utilisateur courant suit-il déjà l'auteur ? (bouton « + » Clips)
    is_pinned: bool = False          # post épinglé en haut du profil (créateur Premium)
    content: str
    media_type: Optional[str] = None
    media_url: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    is_liked: bool = False
    is_saved: bool = False  # l'utilisateur courant a-t-il enregistré ce post/clip ?
    views: int = 0
    eu_blocked: bool = False  # clip restreint dans l'UE (geo-block Nexus Clips)
    affiliate_link: Optional[str] = None
    affiliate_clicks: int = 0
    poll: Optional[Poll] = None
    poll_user_vote: Optional[str] = None  # id de l'option votée par l'utilisateur courant
    # Republication : si repost_of est défini, ce post est un repartage.
    # author_* = la personne qui a reposté ; original_author_* = l'auteur d'origine.
    repost_of: Optional[str] = None
    original_author_id: Optional[str] = None
    original_author_username: Optional[str] = None
    original_author_profile_pic: Optional[str] = None
    original_author_is_verified: bool = False
    is_reposted: bool = False  # l'utilisateur courant a-t-il reposté ce post ?
    mentioned_user_ids: Optional[List[str]] = None
    created_at: str
