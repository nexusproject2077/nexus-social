"""
À intégrer dans server.py — salles de match, stats créateur, close friends, smart notifs.
"""

# --- Match rooms (messages éphémères / 48h) ---
@api_router.get("/match-rooms/{match_id}/messages")
async def match_room_messages(match_id: str, limit: int = 80, current_user: dict = Depends(get_current_user)):
    lim = max(1, min(limit, 100))
    rows = await db.match_room_messages.find(
        {"match_id": match_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(lim)
    return {"messages": rows}


@api_router.post("/match-rooms/{match_id}/messages")
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
    return doc


@api_router.get("/users/{user_id}/creator-stats")
async def creator_stats(user_id: str, current_user: dict = Depends(get_current_user)):
    posts = await db.posts.find(
        {"author_id": user_id, "$or": [{"media_type": "video"}, {"is_clip": True}]},
        {"_id": 0, "views": 1, "views_count": 1, "likes_count": 1},
    ).to_list(200)
    views = sum(int(p.get("views") or p.get("views_count") or 0) for p in posts)
    likes = sum(int(p.get("likes_count") or 0) for p in posts)
    n = len(posts)
    return {"clips": n, "views": views, "likes": likes, "avg_views": int(views / n) if n else 0}


@api_router.get("/users/me/close-friends")
async def get_close_friends(current_user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "close_friends": 1})
    return {"ids": (u or {}).get("close_friends") or []}


@api_router.put("/users/me/close-friends")
async def put_close_friends(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    ids = [str(x) for x in (data.get("ids") or [])][:100]
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"close_friends": ids}})
    return {"ids": ids}


@api_router.put("/users/me/smart-notif-prefs")
async def smart_notif_prefs(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    allowed = {"match_reminders", "comment_replies", "new_followers", "likes_digest", "marketing"}
    prefs = {k: bool(data[k]) for k in allowed if k in data}
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"smart_notif_prefs": prefs}})
    return prefs
