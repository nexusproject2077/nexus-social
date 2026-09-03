"""Schéma Pydantic — notifications. Extrait de server.py à l'identique."""
from typing import Optional

from pydantic import BaseModel, ConfigDict


class Notification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    type: str
    # Optionnels : certaines notifications système (vérification d'identité, etc.)
    # n'ont pas d'expéditeur utilisateur — un défaut évite de casser TOUTE la
    # liste des notifications à cause d'une seule entrée sans from_user_id.
    from_user_id: str = ""
    from_username: str = "Nexus Social"
    from_profile_pic: Optional[str] = None
    post_id: Optional[str] = None
    comment_content: Optional[str] = None
    content: Optional[str] = None
    reason: Optional[str] = None
    url: Optional[str] = None
    read: bool = False
    created_at: str
