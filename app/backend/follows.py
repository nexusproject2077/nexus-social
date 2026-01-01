"""
follows.py - Système de suivi complet pour FastAPI + MongoDB
Inclut : suivi, demandes d'abonnement, listes abonnés/abonnements
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel
import jwt
import os

# Router pour les follows
follow_router = APIRouter(prefix="/api", tags=["follows"])

# Security
security = HTTPBearer()
SECRET_KEY = os.environ.get('SECRET_KEY', '76f267dbc69c6b4e639a50a7ccdd3783')
ALGORITHM = "HS256"

# MongoDB (sera injecté depuis server.py)
db = None

def set_database(database):
    """Fonction pour injecter la DB depuis server.py"""
    global db
    db = database

# ==================== MODELS ====================

class FollowRequest(BaseModel):
    id: str
    follower_id: str
    follower_username: str
    follower_profile_pic: Optional[str] = None
    created_at: str

class FollowUser(BaseModel):
    id: str
    username: str
    profile_pic: Optional[str] = None
    is_following_back: Optional[bool] = False
    follows_back: Optional[bool] = False

class FollowStats(BaseModel):
    followers: int
    following: int
    posts: int

# ==================== HELPER FUNCTIONS ====================

def convert_mongo_doc(doc: dict) -> dict:
    """Convertit un document MongoDB"""
    if doc is None:
        return None
    new_doc = doc.copy()
    if "_id" in new_doc:
        if "id" not in new_doc:
            new_doc["id"] = str(new_doc["_id"])
        del new_doc["_id"]
    return new_doc

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Récupère l'utilisateur actuel depuis le token"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        
        # Essayer "sub" (format principal) puis "user_id" (fallback)
        user_id = payload.get("sub") or payload.get("user_id")
        
        if user_id is None:
            raise HTTPException(status_code=401, detail="Token invalide")
        
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expiré")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token invalide")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Erreur d'authentification: {str(e)}")

async def check_follow_status(follower_id: str, followed_id: str) -> str:
    """
    Vérifie le statut d'abonnement
    Returns: 'following', 'pending', 'not_following'
    """
    # Vérifier abonnement confirmé
    follow = await db.follows.find_one({
        "follower_id": follower_id,
        "followed_id": followed_id,
        "status": "following"
    })
    if follow:
        return "following"
    
    # Vérifier demande en attente
    request = await db.follow_requests.find_one({
        "follower_id": follower_id,
        "followed_id": followed_id,
        "status": "pending"
    })
    if request:
        return "pending"
    
    return "not_following"

async def is_account_private(user_id: str) -> bool:
    """Vérifie si le compte est privé"""
    user = await db.users.find_one({"id": user_id})
    return user.get("is_private", False) if user else False

async def can_view_profile(viewer_id: str, profile_id: str) -> bool:
    """Vérifie si viewer peut voir le contenu de profile"""
    if viewer_id == profile_id:
        return True
    
    if not await is_account_private(profile_id):
        return True
    
    status = await check_follow_status(viewer_id, profile_id)
    return status == "following"

# ==================== ENDPOINTS SUIVI ====================

@follow_router.post("/users/{user_id}/follow")
async def follow_user(user_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Suivre un utilisateur (ou envoyer demande si privé)
    POST /api/users/{user_id}/follow
    """
    if current_user_id == user_id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous suivre vous-même")
    
    # Vérifier si l'utilisateur existe
    target_user = await db.users.find_one({"id": user_id})
    if not target_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    
    # Vérifier statut actuel
    existing_status = await check_follow_status(current_user_id, user_id)
    
    if existing_status == "following":
        raise HTTPException(status_code=400, detail="Vous suivez déjà cet utilisateur")
    
    if existing_status == "pending":
        raise HTTPException(status_code=400, detail="Demande déjà en attente")
    
    # Si compte PRIVÉ : créer demande
    if target_user.get("is_private", False):
        await db.follow_requests.insert_one({
            "id": f"req_{current_user_id}_{user_id}_{int(datetime.now(timezone.utc).timestamp())}",
            "follower_id": current_user_id,
            "followed_id": user_id,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        return {
            "status": "pending",
            "message": "Demande d'abonnement envoyée"
        }
    
    # Si compte PUBLIC : abonnement direct
    else:
        await db.follows.insert_one({
            "id": f"follow_{current_user_id}_{user_id}",
            "follower_id": current_user_id,
            "followed_id": user_id,
            "status": "following",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        # Incrémenter compteurs
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"followers_count": 1}}
        )
        await db.users.update_one(
            {"id": current_user_id},
            {"$inc": {"following_count": 1}}
        )
        
        return {
            "status": "following",
            "message": "Vous suivez maintenant cet utilisateur"
        }

@follow_router.delete("/users/{user_id}/follow")
async def unfollow_user(user_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Se désabonner d'un utilisateur
    DELETE /api/users/{user_id}/follow
    """
    try:
        # Vérifier si l'abonnement existe avant de supprimer
        existing_follow = await db.follows.find_one({
            "follower_id": current_user_id,
            "followed_id": user_id
        })
        
        # Supprimer de follows
        await db.follows.delete_one({
            "follower_id": current_user_id,
            "followed_id": user_id
        })
        
        # Supprimer demande en attente si existe
        await db.follow_requests.delete_one({
            "follower_id": current_user_id,
            "followed_id": user_id
        })
        
        # Décrémenter compteurs SEULEMENT si l'abonnement existait
        if existing_follow:
            await db.users.update_one(
                {"id": user_id},
                {"$inc": {"followers_count": -1}}
            )
            await db.users.update_one(
                {"id": current_user_id},
                {"$inc": {"following_count": -1}}
            )
        
        return {"message": "Désabonnement réussi"}
    
    except Exception as e:
        print(f"❌ Error in unfollow: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur lors du désabonnement: {str(e)}")

@follow_router.get("/users/{user_id}/follow-status")
async def get_follow_status(user_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Vérifier le statut d'abonnement
    GET /api/users/{user_id}/follow-status
    """
    status = await check_follow_status(current_user_id, user_id)
    is_private = await is_account_private(user_id)
    
    return {
        "status": status,
        "is_private": is_private
    }

# ==================== LISTES ABONNÉS/ABONNEMENTS ====================

@follow_router.get("/users/{user_id}/followers")
async def get_followers(user_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Liste des abonnés d'un utilisateur
    GET /api/users/{user_id}/followers
    """
    # Vérifier autorisation
    if not await can_view_profile(current_user_id, user_id):
        raise HTTPException(status_code=403, detail="Compte privé - abonnement requis")
    
    # Récupérer les abonnés
    followers_list = []
    async for follow in db.follows.find({"followed_id": user_id, "status": "following"}):
        follower = await db.users.find_one({"id": follow["follower_id"]})
        if follower:
            # Vérifier si suit en retour
            is_following_back = await db.follows.find_one({
                "follower_id": current_user_id,
                "followed_id": follower["id"],
                "status": "following"
            }) is not None
            
            followers_list.append({
                "id": follower["id"],
                "username": follower["username"],
                "profile_pic": follower.get("profile_pic"),
                "is_following_back": is_following_back
            })
    
    return {
        "followers": followers_list,
        "count": len(followers_list)
    }

@follow_router.get("/users/{user_id}/following")
async def get_following(user_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Liste des abonnements d'un utilisateur
    GET /api/users/{user_id}/following
    """
    # Vérifier autorisation
    if not await can_view_profile(current_user_id, user_id):
        raise HTTPException(status_code=403, detail="Compte privé - abonnement requis")
    
    # Récupérer les abonnements
    following_list = []
    async for follow in db.follows.find({"follower_id": user_id, "status": "following"}):
        followed_user = await db.users.find_one({"id": follow["followed_id"]})
        if followed_user:
            # Vérifier si suit en retour
            follows_back = await db.follows.find_one({
                "follower_id": followed_user["id"],
                "followed_id": current_user_id,
                "status": "following"
            }) is not None
            
            following_list.append({
                "id": followed_user["id"],
                "username": followed_user["username"],
                "profile_pic": followed_user.get("profile_pic"),
                "follows_back": follows_back
            })
    
    return {
        "following": following_list,
        "count": len(following_list)
    }

# ==================== DEMANDES D'ABONNEMENT ====================

@follow_router.get("/follow-requests")
async def get_follow_requests(current_user_id: str = Depends(get_current_user)):
    """
    Liste des demandes d'abonnement reçues
    GET /api/follow-requests
    """
    requests_list = []
    
    async for request in db.follow_requests.find({
        "followed_id": current_user_id,
        "status": "pending"
    }).sort("created_at", -1):
        
        follower = await db.users.find_one({"id": request["follower_id"]})
        if follower:
            requests_list.append({
                "id": request["id"],
                "user": {
                    "id": follower["id"],
                    "username": follower["username"],
                    "profile_pic": follower.get("profile_pic")
                },
                "created_at": request["created_at"]
            })
    
    return {
        "requests": requests_list,
        "count": len(requests_list)
    }

@follow_router.post("/follow-requests/{request_id}/accept")
async def accept_follow_request(request_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Accepter une demande d'abonnement
    POST /api/follow-requests/{request_id}/accept
    """
    # Vérifier que la demande existe
    request = await db.follow_requests.find_one({
        "id": request_id,
        "followed_id": current_user_id,
        "status": "pending"
    })
    
    if not request:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    
    # Créer l'abonnement
    await db.follows.insert_one({
        "id": f"follow_{request['follower_id']}_{request['followed_id']}",
        "follower_id": request["follower_id"],
        "followed_id": request["followed_id"],
        "status": "following",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Supprimer la demande
    await db.follow_requests.delete_one({"id": request_id})
    
    # Incrémenter compteurs
    await db.users.update_one(
        {"id": request["followed_id"]},
        {"$inc": {"followers_count": 1}}
    )
    await db.users.update_one(
        {"id": request["follower_id"]},
        {"$inc": {"following_count": 1}}
    )
    
    return {"message": "Demande acceptée"}

@follow_router.post("/follow-requests/{request_id}/reject")
async def reject_follow_request(request_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Refuser une demande d'abonnement
    POST /api/follow-requests/{request_id}/reject
    """
    result = await db.follow_requests.delete_one({
        "id": request_id,
        "followed_id": current_user_id,
        "status": "pending"
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    
    return {"message": "Demande refusée"}

# ==================== STATISTIQUES ====================

@follow_router.get("/users/{user_id}/stats")
async def get_user_stats(user_id: str, current_user_id: str = Depends(get_current_user)):
    """
    Statistiques publiques d'un utilisateur
    GET /api/users/{user_id}/stats
    """
    # Compter abonnés
    followers_count = await db.follows.count_documents({
        "followed_id": user_id,
        "status": "following"
    })
    
    # Compter abonnements
    following_count = await db.follows.count_documents({
        "follower_id": user_id,
        "status": "following"
    })
    
    # Compter posts (non supprimés)
    posts_count = await db.posts.count_documents({
        "author_id": user_id,
        "deleted_at": None
    })
    
    return {
        "followers": followers_count,
        "following": following_count,
        "posts": posts_count
    }
