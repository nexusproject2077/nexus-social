From fastapi import APIRouter, Depends, File, UploadFile
from datetime import datetime, timedelta
import base64
import uuid

# ✅ Import depuis dependencies pour éviter circular import
from backend.dependencies import get_current_user, db

router = APIRouter(
    prefix="/stories",
    tags=["stories"]
)

@router.post("/")
async def create_story(file: UploadFile = File(...), current_user = Depends(get_current_user)):
    contents = await file.read()
    base64_media = base64.b64encode(contents).decode('utf-8')
    media_url = f"data:{file.content_type};base64,{base64_media}"
    media_type = "image" if file.content_type.startswith("image") else "video"

    story = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "username": current_user["username"],
        "avatar": current_user.get("profile_pic"),
        "media_url": media_url,
        "media_type": media_type,
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": (datetime.utcnow() + timedelta(hours=24)).isoformat()
    }

    await db.stories.insert_one(story)
    return story

@router.get("/feed")
async def get_stories_feed(current_user = Depends(get_current_user)):
    follows = await db.follows.find({"follower_id": current_user["id"]}).to_list(1000)
    following_ids = [f["following_id"] for f in follows] + [current_user["id"]]

    now = datetime.utcnow().isoformat()
    raw_stories = await db.stories.find({
        "user_id": {"$in": following_ids},
        "expires_at": {"$gt": now}
    }).sort("created_at", -1).to_list(1000)

    grouped = {}
    for s in raw_stories:
        uid = s["user_id"]
        if uid not in grouped:
            grouped[uid] = {
                "user": {
                    "id": s["user_id"],
                    "username": s["username"],
                    "avatar": s.get("avatar")
                },
                "stories": []
            }
        grouped[uid]["stories"].append({
            "id": s["id"],
            "media_url": s["media_url"],
            "media_type": s["media_type"]
        })

    return list(grouped.values())
