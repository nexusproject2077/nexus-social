from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from datetime import datetime, timedelta, timezone
import base64
import uuid
from bson import ObjectId

router = APIRouter(tags=["stories"])

# Récupère db et get_current_user depuis server.py
def get_db():
    from backend.server import db
    return db

def get_current_user_dependency():
    from backend.server import get_current_user
    return get_current_user

def convert_mongo_doc_to_dict(doc: dict) -> dict:
    from backend.server import convert_mongo_doc_to_dict as server_convert_mongo_doc_to_dict
    return server_convert_mongo_doc_to_dict(doc)


@router.post("/")
async def create_story(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user_dependency()),
    db = Depends(get_db)
):
    """Créer une nouvelle story"""
    contents = await file.read()
    base64_media = base64.b64encode(contents).decode('utf-8')
    media_url = f"data:{file.content_type};base64,{base64_media}"
    media_type = "image" if file.content_type.startswith("image") else "video"

    story_to_insert = { 
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "username": current_user["username"],
        "avatar": current_user.get("profile_pic"),
        "media_url": media_url,
        "media_type": media_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    }
    
    result = await db.stories.insert_one(story_to_insert)
    
    # Récupère l'histoire insérée
    inserted_story_raw = await db.stories.find_one({"_id": result.inserted_id})

    if inserted_story_raw:
        story_response = convert_mongo_doc_to_dict(inserted_story_raw)
        return {"success": True, "story": story_response}
    else:
        raise HTTPException(status_code=500, detail="Failed to retrieve inserted story")


@router.delete("/{story_id}")
async def delete_story(
    story_id: str, 
    current_user: dict = Depends(get_current_user_dependency()), 
    db = Depends(get_db)
):
    """Supprimer une story"""
    story_raw = await db.stories.find_one({"id": story_id})
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story not found")

    story = convert_mongo_doc_to_dict(story_raw)

    if story["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    await db.stories.delete_one({"id": story_id})
    return {"message": "Story deleted successfully"}
    

@router.get("/feed")
async def get_stories_feed(
    current_user: dict = Depends(get_current_user_dependency()),
    db = Depends(get_db)
):
    """Feed des stories"""
    follows_raw = await db.follows.find({
        "follower_id": current_user["id"],
        "status": "following"
    }).to_list(1000)
    
    follows = [convert_mongo_doc_to_dict(f) for f in follows_raw]
    
    following_ids = []
    for f in follows:
        user_id = f.get("followed_id") or f.get("following_id")
        if user_id:
            following_ids.append(user_id)
    following_ids.append(current_user["id"])

    now = datetime.now(timezone.utc).isoformat()
    raw_stories = await db.stories.find({
        "user_id": {"$in": following_ids},
        "expires_at": {"$gt": now}
    }).sort("created_at", -1).to_list(1000)

    grouped = {}
    for s_doc in raw_stories:
        s = convert_mongo_doc_to_dict(s_doc)
        uid = s["user_id"]
        if uid not in grouped:
            grouped[uid] = {
                "user": {"id": uid, "username": s["username"], "avatar": s.get("avatar")},
                "stories": []
            }
        grouped[uid]["stories"].append({
            "id": s["id"],
            "media_url": s["media_url"],
            "media_type": s["media_type"],
            "user_id": s["user_id"],
            "created_at": s["created_at"]
        })
    
    return list(grouped.values())


@router.post("/{story_id}/reply")
async def reply_to_story(
    story_id: str,
    reply_data: dict,
    current_user: dict = Depends(get_current_user_dependency()),
    db = Depends(get_db)
):
    """Répondre à une story"""
    story_raw = await db.stories.find_one({"id": story_id})
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story introuvable")
    
    story = convert_mongo_doc_to_dict(story_raw)
    author_raw = await db.users.find_one({"id": story["user_id"]})
    author = convert_mongo_doc_to_dict(author_raw)
    
    if not author.get("allow_story_replies", True):
        raise HTTPException(403, detail="Réponses désactivées")
    
    message_id = str(uuid.uuid4())
    message = {
        "id": message_id,
        "sender_id": current_user["id"],
        "sender_username": current_user["username"],
        "sender_profile_pic": current_user.get("profile_pic"),
        "recipient_id": story["user_id"],
        "recipient_username": author["username"],
        "content": reply_data.get("content", ""),
        "story_id": story_id,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.messages.insert_one(message)
    return {"success": True, "message": convert_mongo_doc_to_dict(message)}
