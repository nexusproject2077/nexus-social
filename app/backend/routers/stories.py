# backend/routers/stories.py
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, status
from fastapi.responses import JSONResponse
from typing import List
from datetime import datetime, timedelta
import cloudinary.uploader  # pip install cloudinary
from backend.models import Story, User  # ajuste selon ton ORM
from backend.auth import get_current_user  # ton système d'auth existant

router = APIRouter(prefix="/stories", tags=["stories"])

# POST : Créer une story (image ou vidéo)
@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_story(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    # Upload direct sur Cloudinary (ou ton storage)
    upload_result = cloudinary.uploader.upload(
        file.file,
        resource_type="auto",  # accepte image + vidéo
        folder="nexus/stories"
    )

    story = await Story.create(
        user_id=current_user.id,
        media_url=upload_result["secure_url"],
        media_type=upload_result["resource_type"],  # image ou video
        expires_at=datetime.utcnow() + timedelta(hours=24)
    )

    return {
        "id": story.id,
        "media_url": story.media_url,
        "expires_at": story.expires_at
    }

# GET : Récupérer toutes les stories actives des gens suivis + soi-même
@router.get("/feed", response_model=List[dict])
async def get_stories_feed(current_user: User = Depends(get_current_user)):
    # On prend les stories non expirées des gens qu'on suit + les siennes
    followed_users = await current_user.following.all().values_list("id", flat=True)
    user_ids = list(followed_users) + [current_user.id]

    stories = await Story.filter(
        user_id__in=user_ids,
        expires_at__gt=datetime.utcnow()
    ).order_by("-created_at").prefetch_related("user")

    # Grouper par utilisateur pour le front (1 cercle = 1 user)
    stories_by_user = {}
    for story in stories:
        uid = story.user.id
        if uid not in stories_by_user:
            stories_by_user[uid] = {
                "user": {
                    "id": story.user.id,
                    "username": story.user.username,
                    "avatar": story.user.avatar or "/default-avatar.png"
                },
                "stories": []
            }
        stories_by_user[uid]["stories"].append({
            "id": story.id,
            "media_url": story.media_url,
            "media_type": story.media_type,
            "created_at": story.created_at
        })

    return list(stories_by_user.values())

# DELETE : Supprimer sa propre story (optionnel)
@router.delete("/{story_id}")
async def delete_story(story_id: int, current_user: User = Depends(get_current_user)):
    story = await Story.get_or_none(id=story_id, user_id=current_user.id)
    if not story:
        raise HTTPException(status_code=404, detail="Story non trouvée ou non autorisé")
    
    # Optionnel : supprimer le fichier Cloudinary
    public_id = story.media_url.split("/")[-1].split(".")[0]
    cloudinary.uploader.destroy(f"nexus/stories/{public_id}")
    
    await story.delete()
    return {"detail": "Story supprimée"}