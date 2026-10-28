"""Routeur « growth » — temps d'écran (sync multi-appareils), salles de match,
stats créateur, amis proches et préférences de notifications utiles.

Premier routeur extrait de server.py (Phase 3 du refactor). Il ne dépend que
de `core/` (db + authentification), d'où l'absence d'import circulaire.
"""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

try:
    from backend.core.database import db
    from backend.core.security import get_current_user
except ImportError:
    from core.database import db
    from core.security import get_current_user

router = APIRouter(prefix="/api", tags=["growth"])


# ── Temps d'écran (agrégat multi-appareils par jour) ────────────────────────

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _screen_day(raw) -> str:
    """Jour au format YYYY-MM-DD : celui fourni par le client s'il est valide
    (pour que « aujourd'hui » soit le même sur tous ses appareils), sinon UTC."""
    if isinstance(raw, str) and _DAY_RE.match(raw):
        return raw
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


@router.get("/users/me/screen-time")
async def get_screen_time(day: str = "", current_user: dict = Depends(get_current_user)):
    """Total agrégé (tous appareils) du temps d'écran du jour, en secondes."""
    d = _screen_day(day)
    row = await db.screen_time.find_one(
        {"user_id": current_user["id"], "day": d}, {"_id": 0, "seconds": 1}
    )
    return {"day": d, "seconds": int((row or {}).get("seconds") or 0)}


@router.post("/users/me/screen-time")
async def add_screen_time(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Ajoute le delta de secondes compté par un appareil et renvoie l'agrégat
    du jour. Le delta est borné (anti-abus / horloge déréglée)."""
    d = _screen_day(data.get("day"))
    try:
        delta = int(float(data.get("delta_seconds") or 0))
    except (TypeError, ValueError):
        delta = 0
    delta = max(0, min(delta, 3600))  # au plus 1 h par appel
    if delta:
        await db.screen_time.update_one(
            {"user_id": current_user["id"], "day": d},
            {
                "$inc": {"seconds": delta},
                "$setOnInsert": {"user_id": current_user["id"], "day": d},
            },
            upsert=True,
        )
    row = await db.screen_time.find_one(
        {"user_id": current_user["id"], "day": d}, {"_id": 0, "seconds": 1}
    )
    return {"day": d, "seconds": int((row or {}).get("seconds") or 0)}


# ── Growth : salles de match, stats créateur, amis proches, notifs utiles ────

@router.get("/match-rooms/{match_id}/messages")
async def match_room_messages(match_id: str, limit: int = 80, current_user: dict = Depends(get_current_user)):
    """Messages d'une salle de match (chat léger lié à une rencontre)."""
    lim = max(1, min(limit, 100))
    rows = await db.match_room_messages.find(
        {"match_id": match_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(lim)
    return {"messages": rows}


@router.post("/match-rooms/{match_id}/messages")
async def match_room_post(match_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    content = (data.get("content") or "").strip()[:280]
    if not content:
        raise HTTPException(400, "Empty")
    doc = {
        "id": str(uuid.uuid4()),
        "match_id": match_id,
        "room_id": data.get("room_id") or f"match:{match_id}",
        "match_label": data.get("match_label") or "",
        "author_id": current_user["id"],
        "author_username": current_user.get("username"),
        "content": content,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.match_room_messages.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.get("/users/{user_id}/creator-stats")
async def creator_stats(user_id: str, current_user: dict = Depends(get_current_user)):
    """Agrégats créateur (clips / vues / J'aime) pour un profil."""
    posts = await db.posts.find(
        {"author_id": user_id, "$or": [{"media_type": "video"}, {"is_clip": True}]},
        {"_id": 0, "views": 1, "views_count": 1, "likes_count": 1},
    ).to_list(200)
    views = sum(int(p.get("views") or p.get("views_count") or 0) for p in posts)
    likes = sum(int(p.get("likes_count") or 0) for p in posts)
    n = len(posts)
    return {"clips": n, "views": views, "likes": likes, "avg_views": int(views / n) if n else 0}


@router.get("/users/me/close-friends")
async def get_close_friends(current_user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "close_friends": 1})
    return {"ids": (u or {}).get("close_friends") or []}


@router.put("/users/me/close-friends")
async def put_close_friends(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    ids = [str(x) for x in (data.get("ids") or [])][:100]
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"close_friends": ids}})
    return {"ids": ids}


@router.put("/users/me/smart-notif-prefs")
async def smart_notif_prefs(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    allowed = {"match_reminders", "comment_replies", "new_followers", "likes_digest", "marketing"}
    prefs = {k: bool(data[k]) for k in allowed if k in data}
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"smart_notif_prefs": prefs}})
    return prefs
