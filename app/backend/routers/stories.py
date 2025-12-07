# app/backend/routers/stories.py
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from datetime import datetime, timedelta
import base64
import uuid
from bson import ObjectId # Import de ObjectId

router = APIRouter(tags=["stories"])

# On récupère db et get_current_user DIRECTEMENT depuis server.py via Depends
def get_db():
    from backend.server import db
    return db

def get_current_user_dependency():
    from backend.server import get_current_user
    return get_current_user

# Importe la fonction utilitaire du fichier server.py
# Cela évite la duplication de code et assure la cohérence
def convert_mongo_doc_to_dict(doc: dict) -> dict:
    from backend.server import convert_mongo_doc_to_dict as server_convert_mongo_doc_to_dict
    return server_convert_mongo_doc_to_dict(doc)


@router.post("/")
async def create_story(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user_dependency()),
    db = Depends(get_db)
):
    contents = await file.read()
    base64_media = base64.b64encode(contents).decode('utf-8')
    media_url = f"data:{file.content_type};base64,{base64_media}"
    media_type = "image" if file.content_type.startswith("image") else "video"

    story_to_insert = { # Renommé en story_to_insert pour l'insertion
        "user_id": current_user["id"], # Assurez-vous que current_user["id"] est déjà un str
        "username": current_user["username"],
        "avatar": current_user.get("profile_pic"),
        "media_url": media_url,
        "media_type": media_type,
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": (datetime.utcnow() + timedelta(hours=24)).isoformat()
    }
    
    # MongoDB va ajouter un _id automatiquement. On ne spécifie pas 'id' ici.
    result = await db.stories.insert_one(story_to_insert)
    
    # Récupère l'histoire insérée pour s'assurer d'avoir le _id et le convertir
    inserted_story_raw = await db.stories.find_one({"_id": result.inserted_id})

    if inserted_story_raw:
        # Convertir l'ObjectId (_id) en str 'id' avant de le retourner
        story_response = convert_mongo_doc_to_dict(inserted_story_raw)
        return {"success": True, "story": story_response}
    else:
        raise HTTPException(status_code=500, detail="Failed to retrieve inserted story")


@router.get("/feed")
async def get_stories_feed(
    current_user: dict = Depends(get_current_user_dependency()),
    db = Depends(get_db)
):
    # Assurez-vous que user_id dans le filtre est une chaîne de caractères
    follows_raw = await db.follows.find({"follower_id": current_user["id"]}).to_list(1000)
    # Convertir les ObjectIds potentiels dans les résultats de follows
    follows = [convert_mongo_doc_to_dict(f) for f in follows_raw]
    following_ids = [f["following_id"] for f in follows] + [current_user["id"]]

    now = datetime.utcnow().isoformat()
    raw_stories = await db.stories.find({ # Renommé en raw_stories pour éviter la confusion
        "user_id": {"$in": following_ids},
        "expires_at": {"$gt": now}
    }).sort("created_at", -1).to_list(1000)

    grouped = {}
    for s_doc in raw_stories: # Utilisez s_doc pour le document brut de MongoDB
        # Convertir le document MongoDB pour la réponse
        s = convert_mongo_doc_to_dict(s_doc) # Utilise la fonction utilitaire ici

        uid = s["user_id"]
        if uid not in grouped:
            grouped[uid] = {
                "user": {"id": uid, "username": s["username"], "avatar": s.get("avatar")},
                "stories": []
            }
        grouped[uid]["stories"].append({
            "id": s["id"],
            "media_url": s["media_url"],
            "media_type": s["media_type"]
        })
    return list(grouped.values())

