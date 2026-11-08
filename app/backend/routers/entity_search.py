import asyncio
import time
from collections import OrderedDict
from fastapi import APIRouter, Depends, HTTPException, Query
try:
    from backend.core.database import db
    from backend.core.security import get_current_user
    from backend.services import entity_data as data
except ImportError:
    from core.database import db
    from core.security import get_current_user
    from services import entity_data as data

router = APIRouter(prefix="/api/entity-search", tags=["entity-search"])
_slots = asyncio.Semaphore(4)
_rates = OrderedDict()

async def viewer(user=Depends(get_current_user)):
    key = str(user.get("id") or user.get("_id"))
    now = time.monotonic()
    start, count = _rates.get(key, (now, 0))
    if now - start >= 60:
        start, count = now, 0
    if count >= 30:
        raise HTTPException(429, "Trop de recherches. Réessaie dans une minute.")
    _rates[key] = (start, count + 1)
    _rates.move_to_end(key)
    while len(_rates) > 4096:
        _rates.popitem(last=False)
    return user

async def upstream(fn, *args):
    async with _slots:
        try:
            return await asyncio.to_thread(fn, *args)
        except Exception as exc:
            raise HTTPException(502, "Source externe temporairement indisponible.") from exc

async def official(entity_id):
    link = await db.entity_links.find_one({"entity_id": entity_id, "approved": True}, {"user_id": 1})
    if not link or not link.get("user_id"):
        return None
    return await db.users.find_one({"id": link["user_id"], "is_verified": True, "is_blocked": {"$ne": True}, "is_active": {"$ne": False}, "is_private": {"$ne": True}}, {"_id": 0, "id": 1, "username": 1, "profile_pic": 1, "is_verified": 1})

@router.get("")
async def search(q: str = Query(..., min_length=2, max_length=80), kind: str = Query("club", pattern="^(club|person)$"), league: str = Query("fra.1"), user=Depends(viewer)):
    if kind == "club":
        if league not in data.LEAGUES:
            raise HTTPException(422, "Compétition non prise en charge.")
        items = await upstream(data.search_clubs, q.strip(), league)
    else:
        items = await upstream(data.search_people, q.strip())
    items = [{**item, "official_account": await official(item["id"])} for item in items]
    items.sort(key=lambda item: item["official_account"] is None)
    return {"items": items, "kind": kind, "league": league if kind == "club" else None}

@router.get("/clubs/{league}/{team_id}/matches")
async def matches(league: str, team_id: str, season: int = Query(..., ge=1900, le=2100), state: str = Query("all", pattern="^(all|pre|in|post)$"), offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50), user=Depends(viewer)):
    if league not in data.LEAGUES or not team_id.isascii() or not team_id.isdigit() or len(team_id) > 12:
        raise HTTPException(422, "Club ou compétition invalide.")
    items = await upstream(data.club_schedule, league, team_id, season)
    completed = [m for m in items if m["state"] == "post"]
    upcoming = [m for m in items if m["state"] == "pre"]
    selected = [m for m in items if state == "all" or m["state"] == state]
    if state == "post":
        selected.reverse()
    return {"items": selected[offset:offset + limit], "total": len(selected), "has_more": offset + limit < len(selected), "last_match": completed[-1] if completed else None, "next_match": upcoming[0] if upcoming else None, "season": season, "league": league, "source": "ESPN", "coverage": "Rencontres retournées par la source pour cette compétition et cette saison."}

@router.get("/clubs/{league}/{team_id}/standings")
async def standings(league: str, team_id: str, season: int = Query(..., ge=1900, le=2100), user=Depends(viewer)):
    if league not in data.LEAGUES or not team_id.isascii() or not team_id.isdigit() or len(team_id) > 12:
        raise HTTPException(422, "Club ou compétition invalide.")
    groups = await upstream(data.club_standings, league, season)
    return {"groups": groups, "team_id": team_id, "season": season, "league": league, "source": "ESPN", "available": bool(groups)}
