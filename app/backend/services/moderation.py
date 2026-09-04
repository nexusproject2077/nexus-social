"""Service modération — analyse auto (toxicité + NSFW) + file de revue humaine.

Extrait de server.py à l'identique (Phase 7 du refactor). S'appuie sur le
module `moderation` (toxic-bert + NudeNet, optionnel & fail-open) ; utilisé par
les posts, clips, commentaires et messages avant enregistrement.
"""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

try:
    from backend.core.database import db
except ImportError:
    from core.database import db

try:
    from backend.services.notifications import push_realtime
except ImportError:
    from services.notifications import push_realtime

# Modération auto (toxic-bert + NudeNet) — optionnelle et fail-open.
try:
    from backend import moderation
except ImportError:
    try:
        from app.backend import moderation
    except ImportError:
        try:
            import moderation
        except ImportError:
            moderation = None


async def flag_for_review(kind: str, ref_id: str, author_id: str, text, verdict: dict, media_kind=None):
    """Ajoute un contenu signalé à la file de modération humaine."""
    await db.moderation_queue.insert_one({
        "id": str(uuid.uuid4()),
        "kind": kind,               # "post" | "comment" | "clip"
        "ref_id": ref_id,
        "author_id": author_id,
        "text": ((text or "")[:500]),
        "category": verdict.get("category"),
        "label": verdict.get("label"),
        "score": verdict.get("score"),
        "media_kind": media_kind,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def evaluate_content(text=None, media_url=None):
    """Analyse texte + média et renvoie le verdict le plus sévère (ou None si la
    modération est indisponible). NE lève JAMAIS — utilisé aussi pour scanner des
    contenus déjà publiés."""
    if moderation is None:
        return None
    verdicts = []
    if text and text.strip():
        verdicts.append(moderation.moderate_text(text))
    if media_url:
        verdicts.append(moderation.moderate_media(media_url))
    if not verdicts:
        return None
    return moderation.worst_verdict(*verdicts)


async def screen_content(text=None, media_url=None):
    """Comme evaluate_content, mais lève HTTP 400 si le contenu doit être bloqué.

    À appeler AVANT d'enregistrer le contenu ; si le verdict renvoyé vaut "flag",
    l'appelant enregistre le contenu puis appelle flag_for_review()."""
    worst = await evaluate_content(text=text, media_url=media_url)
    if worst and worst["action"] == "block":
        raise HTTPException(
            status_code=400,
            detail=f"Contenu refusé par la modération ({worst['category']}: {worst['label']})",
        )
    return worst


async def notify_content_removed(author_id: str, kind_label: str, verdict: dict):
    """Avertit l'auteur (notification) que son contenu a été retiré par la modération."""
    if not author_id:
        return
    cat = (verdict or {}).get("category", "nsfw")
    reason = ("contenu à caractère sexuel ou explicite" if cat == "nsfw"
              else "propos haineux ou toxiques" if cat == "toxicity"
              else "non-respect de nos règles")
    message = f"Votre {kind_label} a été supprimé(e) automatiquement : {reason}."
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": author_id,
            "type": "moderation",
            "from_user_id": author_id,          # système ; requis par le modèle
            "from_username": "Modération Nexus",
            "from_profile_pic": None,
            "comment_content": message,
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass
    # Notification temps réel (pastille + toast).
    await push_realtime(author_id, {"type": "notification", "data": {"message": message}})
