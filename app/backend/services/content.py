"""Service contenu — utilitaires de publication (mentions, sondages, URLs).

Extraits de server.py à l'identique (Phase 8 du refactor). Petits helpers
partagés par les posts, clips et commentaires.
"""
import re
import uuid
from typing import List, Optional

try:
    from backend.core.database import db
except ImportError:
    from core.database import db


def safe_http_url(url: Optional[str]) -> Optional[str]:
    """N'accepte qu'une URL http(s) (évite javascript: et autres schémas dangereux)."""
    if isinstance(url, str):
        u = url.strip()
        if u.startswith("http://") or u.startswith("https://"):
            return u[:2000]
    return None


def build_poll(poll_options: Optional[List[str]]) -> Optional[dict]:
    """Construit un sondage à partir d'une liste de textes d'options.
    Renvoie None si moins de 2 options valides (non vides)."""
    if not poll_options:
        return None
    cleaned = [o.strip() for o in poll_options if o and o.strip()]
    if len(cleaned) < 2:
        return None
    # Dédoublonne en gardant l'ordre, limite à 6 options
    seen, options = set(), []
    for text in cleaned:
        if text not in seen:
            seen.add(text)
            options.append({"id": str(uuid.uuid4()), "text": text, "votes": 0})
        if len(options) >= 6:
            break
    if len(options) < 2:
        return None
    return {"options": options, "total_votes": 0, "voters": {}}


async def resolve_mentions(content: str, exclude_id: str = None):
    """Extrait les @mentions du contenu et renvoie la liste des user_ids
    correspondant à des comptes existants (hors exclude_id)."""
    if not content:
        return []
    usernames = {u.lower() for u in re.findall(r'@(\w+)', content)}
    if not usernames:
        return []
    ids = []
    async for u in db.users.find(
        {"username": {"$in": list(usernames)}}, {"id": 1, "username": 1}
    ):
        # match insensible à la casse
        if u.get("username", "").lower() in usernames and u.get("id") != exclude_id:
            ids.append(u["id"])
    return ids
