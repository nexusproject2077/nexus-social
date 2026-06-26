# app/backend/server.py
import sys
from pathlib import Path
# Cette ligne magique règle TOUT le problème Render
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form, Response, Query, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import InvalidURI, ConnectionFailure
import os
import logging
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt
import base64
from bson import ObjectId
import json
from collections import defaultdict
from enum import Enum
import hashlib
import random
import math
import re

# Import du module follows (avec gestion des chemins)
try:
    from backend.follows import follow_router, set_database
except ImportError:
    try:
        from follows import follow_router, set_database
    except ImportError:
        print("⚠️ WARNING: Module 'follows' not found. Follow system will not be available.")
        follow_router = None
        set_database = None

# Import du module Nexus Mail (avec gestion des chemins)
try:
    from backend.nexus_mail import mail_router, set_database as set_mail_database
except ImportError:
    try:
        from nexus_mail import mail_router, set_database as set_mail_database
    except ImportError:
        print("⚠️ WARNING: Module 'nexus_mail' not found. Nexus Mail will not be available.")
        mail_router = None
        set_mail_database = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ==================== MONGODB CONNECTION AVEC VALIDATION ====================
mongo_url = os.environ.get('MONGODB_URI') or os.environ.get('MONGO_URL') or os.environ.get('DATABASE_URL')

# Validation de l'URL MongoDB
if not mongo_url:
    raise ValueError(
        "❌ MongoDB URL not configured! "
        "Please set MONGODB_URI, MONGO_URL, or DATABASE_URL environment variable"
    )

# Vérification du schéma de l'URL
if not (mongo_url.startswith('mongodb://') or mongo_url.startswith('mongodb+srv://')):
    print(f"❌ ERREUR CRITIQUE: MongoDB URL doesn't start with 'mongodb://' or 'mongodb+srv://'")
    print(f"❌ URL actuelle: {mongo_url[:30]}...")
    print(f"")
    print(f"✅ Exemples d'URL valides:")
    print(f"   mongodb+srv://user:pass@cluster.mongodb.net/dbname")
    print(f"   mongodb://user:pass@host:27017/dbname")
    print(f"")
    raise InvalidURI(
        f"Invalid MongoDB URI scheme. "
        f"URI must begin with 'mongodb://' or 'mongodb+srv://'. "
        f"Current URI starts with: {mongo_url[:20]}"
    )

# Création du client MongoDB
try:
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ.get('DB_NAME', 'nexus_social')]
    print("✅ MongoDB client initialized successfully")
    print(f"✅ Database: {os.environ.get('DB_NAME', 'nexus_social')}")
except InvalidURI as e:
    print(f"❌ Invalid MongoDB URI: {e}")
    raise
except Exception as e:
    print(f"❌ Error initializing MongoDB client: {e}")
    raise

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.environ.get('SECRET_KEY', '76f267dbc69c6b4e639a50a7ccdd3783')
ALGORITHM = "HS256"

# Create the main app
app = FastAPI(title="Nexus Social API", version="1.0.0")

# ==================== CORS ====================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://nexus-social-3ta5.onrender.com",
        "https://nexus-social-4k3v.onrender.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check pour Render
@app.get("/healthz")
async def health_check():
    try:
        # Test de connexion MongoDB
        await client.admin.command('ping')
        return {
            "status": "healthy",
            "database": "connected",
            "service": "nexus-social-api",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }, 500

@app.get("/")
async def root():
    return {
        "message": "🚀 API Nexus Social fonctionne!",
        "version": "1.0.0",
        "status": "operational",
        "endpoints": {
            "health": "/healthz",
            "api": "/api",
            "docs": "/docs"
        }
    }


# --- FONCTION UTILITAIRE POUR CONVERTIR LES OBJECTID EN STR ---
def convert_mongo_doc_to_dict(doc: dict) -> dict:
    """Convertit un document MongoDB en dictionnaire Python avec ObjectId → str
    
    IMPORTANT: Si le document a déjà un champ 'id' (UUID), on le garde !
    On supprime juste le '_id' MongoDB pour éviter les conflits.
    """
    if doc is None:
        return None
    new_doc = doc.copy()
    
    # ✅ CORRECTION: Ne pas écraser 'id' s'il existe déjà (UUID)
    if "_id" in new_doc:
        # Si le document n'a pas de champ 'id', on utilise _id
        if "id" not in new_doc:
            new_doc["id"] = str(new_doc["_id"])
        # Supprime toujours _id pour éviter les conflits
        del new_doc["_id"]

    for key, value in new_doc.items():
        if isinstance(value, ObjectId):
            new_doc[key] = str(value)
        elif isinstance(value, dict):
            new_doc[key] = convert_mongo_doc_to_dict(value)
        elif isinstance(value, list):
            new_doc[key] = [
                convert_mongo_doc_to_dict(item) if isinstance(item, dict) 
                else (str(item) if isinstance(item, ObjectId) else item) 
                for item in value
            ]
    return new_doc


async def check_is_following(follower_id: str, followed_id: str) -> bool:
    """
    Vérifie si follower_id suit followed_id
    Compatible avec ancien format (following_id) et nouveau (followed_id)
    """
    # Chercher avec les deux formats
    follow = await db.follows.find_one({
        "$or": [
            {"follower_id": follower_id, "followed_id": followed_id},
            {"follower_id": follower_id, "following_id": followed_id}
        ]
    })
    return bool(follow)


# Router principal
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    bio: Optional[str] = ""

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    email: str
    bio: str = ""
    profile_pic: Optional[str] = None
    followers_count: int = 0
    following_count: int = 0
    created_at: str

class UserProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    bio: str = ""
    profile_pic: Optional[str] = None
    followers_count: int = 0
    following_count: int = 0
    is_following: bool = False
    created_at: str

class PostCreate(BaseModel):
    content: str
    media_type: Optional[str] = None
    media_url: Optional[str] = None

class Post(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    content: str
    media_type: Optional[str] = None
    media_url: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    is_liked: bool = False
    created_at: str

class CommentCreate(BaseModel):
    content: str

class Comment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    post_id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    content: str
    created_at: str

class MessageCreate(BaseModel):
    recipient_id: str
    content: str

class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    sender_id: str
    sender_username: str
    sender_profile_pic: Optional[str] = None
    recipient_id: str
    recipient_username: str
    content: str
    read: bool = False
    created_at: str

class Conversation(BaseModel):
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    last_message: str
    last_message_time: str
    unread_count: int = 0

class Notification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    type: str
    from_user_id: str
    from_username: str
    from_profile_pic: Optional[str] = None
    post_id: Optional[str] = None
    comment_content: Optional[str] = None
    read: bool = False
    created_at: str

class StoryCreate(BaseModel):
    media_type: str
    media_url: str

class Story(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    media_type: str
    media_url: str
    views_count: int = 0
    created_at: str
    expires_at: str
    has_viewed: bool = False

class StoryGroup(BaseModel):
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    stories: List[Story]
    last_story_time: str

# ==================== AUTH HELPERS ====================
def create_access_token(data: dict):
    """Crée un token JWT avec expiration de 7 jours"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Récupère l'utilisateur actuel depuis le token JWT"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        # Essaie d'abord avec le champ "id" personnalisé (nouveau format)
        user = await db.users.find_one({"id": user_id})
        
        # Si pas trouvé, essaie avec _id (pour les anciens tokens)
        if not user:
            try:
                # Convertit l'ID en ObjectId si c'est un ancien token MongoDB
                user = await db.users.find_one({"_id": ObjectId(user_id)})
            except:
                pass

        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return convert_mongo_doc_to_dict(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication error: {str(e)}")

# ==================== AUTH ROUTES ====================
@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    """Enregistre un nouvel utilisateur"""
    existing_user_raw = await db.users.find_one({
        "$or": [
            {"email": user_data.email},
            {"username": user_data.username}
        ]
    })
    if existing_user_raw:
        raise HTTPException(status_code=400, detail="Email or username already registered")
   
    hashed_password = pwd_context.hash(user_data.password)
    user_id = str(uuid.uuid4())
    user_to_insert = {
        "id": user_id,
        "username": user_data.username,
        "email": user_data.email,
        "password": hashed_password,
        "bio": user_data.bio,
        "profile_pic": None,
        "followers_count": 0,
        "following_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_to_insert)
   
    token = create_access_token({"sub": user_id})
   
    return {
        "token": token,
        "user": {
            "id": user_id,
            "username": user_data.username,
            "email": user_data.email,
            "bio": user_data.bio,
            "profile_pic": None,
            "followers_count": 0,
            "following_count": 0,
            "created_at": user_to_insert["created_at"]
        }
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    """Connecte un utilisateur existant"""
    user_raw = await db.users.find_one({"email": credentials.email})
    
    # Vérification avec protection contre les utilisateurs sans mot de passe
    if not user_raw or "password" not in user_raw or not pwd_context.verify(credentials.password, user_raw["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
   
    user = convert_mongo_doc_to_dict(user_raw)
    token = create_access_token({"sub": user["id"]})
   
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "bio": user.get("bio", ""),
            "profile_pic": user.get("profile_pic"),
            "followers_count": user.get("followers_count", 0),
            "following_count": user.get("following_count", 0),
            "created_at": user["created_at"]
        }
    }

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Récupère le profil de l'utilisateur actuel"""
    return User(**current_user)

@api_router.put("/auth/profile")
async def update_profile(
    bio: Optional[str] = Form(None),
    profile_pic: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Met à jour le profil de l'utilisateur"""
    update_data = {}
   
    if bio is not None:
        update_data["bio"] = bio
   
    if profile_pic:
        contents = await profile_pic.read()
        base64_image = base64.b64encode(contents).decode('utf-8')
        update_data["profile_pic"] = f"data:{profile_pic.content_type};base64,{base64_image}"
   
    if update_data:
        await db.users.update_one({"id": current_user["id"]}, {"$set": update_data})
   
    updated_user_raw = await db.users.find_one({"id": current_user["id"]})
    updated_user = convert_mongo_doc_to_dict(updated_user_raw)
    return User(**updated_user)

@api_router.put("/users/me/privacy")
async def update_privacy_settings(
    privacy_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Met à jour compte privé"""
    try:
        is_private = privacy_data.get("is_private", False)
        
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {
                "is_private": is_private,
                "privacy_updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        # Mettre à jour l'utilisateur en mémoire
        updated_user = await db.users.find_one({"id": current_user["id"]})
        
        return {
            "success": True,
            "is_private": is_private,
            "user": convert_mongo_doc_to_dict(updated_user)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@api_router.put("/users/me/profile-details")
async def update_profile_details(
    profile_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Met à jour les détails du profil (nom, prénom, etc.)"""
    try:
        allowed_fields = [
            "first_name", "last_name", "bio", "location", 
            "phone", "birthdate", "gender", "website"
        ]
        
        update_data = {
            k: v for k, v in profile_data.items() 
            if k in allowed_fields and v is not None
        }
        
        if not update_data:
            raise HTTPException(status_code=400, detail="Aucune donnée valide")
        
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": update_data}
        )
        
        updated_user = await db.users.find_one({"id": current_user["id"]})
        
        return {
            "success": True, 
            "user": convert_mongo_doc_to_dict(updated_user)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@api_router.put("/users/me/story-settings")
async def update_story_settings(
    settings: dict,
    current_user: dict = Depends(get_current_user)
):
    """Activer/désactiver réponses aux stories"""
    try:
        allow_story_replies = settings.get("allow_story_replies", True)
        
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {
                "allow_story_replies": allow_story_replies
            }}
        )
        
        return {
            "success": True,
            "allow_story_replies": allow_story_replies
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@api_router.get("/users/me/settings")
async def get_user_settings(current_user: dict = Depends(get_current_user)):
    """Récupère tous les paramètres utilisateur"""
    try:
        user = await db.users.find_one({"id": current_user["id"]})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        user_dict = convert_mongo_doc_to_dict(user)
        
        return {
            "privacy": {
                "is_private": user_dict.get("is_private", False),
                "allow_story_replies": user_dict.get("allow_story_replies", True)
            },
            "profile": {
                "first_name": user_dict.get("first_name", ""),
                "last_name": user_dict.get("last_name", ""),
                "bio": user_dict.get("bio", ""),
                "location": user_dict.get("location", ""),
                "phone": user_dict.get("phone", ""),
                "birthdate": user_dict.get("birthdate", ""),
                "gender": user_dict.get("gender", ""),
                "website": user_dict.get("website", "")
            },
            "account": {
                "username": user_dict.get("username"),
                "email": user_dict.get("email"),
                "created_at": user_dict.get("created_at")
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

# CORRECTION LIGNE 578-630

@api_router.post("/users/me/sessions/start")
async def start_user_session(current_user: dict = Depends(get_current_user)):
    """Démarre une session utilisateur (tracking d'activité)"""
    try:
        now = datetime.now(timezone.utc)
        
        # Mettre à jour la dernière activité de l'utilisateur
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {
                "last_active": now.isoformat(),
                "last_session_start": now.isoformat()
            }}
        )
        
        # Optionnel: créer un enregistrement de session
        session_id = str(uuid.uuid4())
        session = {
            "id": session_id,
            "user_id": current_user["id"],
            "started_at": now.isoformat(),
            "last_activity": now.isoformat(),
            "is_active": True
        }
        
        # Insérer dans la collection sessions (si elle existe)
        try:
            await db.sessions.insert_one(session)
        except:
            pass  # Si la collection n'existe pas, on ignore
        
        return {
            "success": True,
            "session_id": session_id,
            "started_at": now.isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@api_router.post("/users/me/sessions/{session_id}/ping")
async def ping_user_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Ping pour maintenir la session active"""
    try:
        now = datetime.now(timezone.utc)

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"last_active": now.isoformat()}}
        )

        try:
            await db.sessions.update_one(
                {"id": session_id, "user_id": current_user["id"]},
                {"$set": {"last_activity": now.isoformat()}}
            )
        except:
            pass

        return {"success": True, "session_id": session_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@api_router.put("/users/me/password")
async def change_password(
    current_password: str = Body(...),
    new_password: str = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Changer le mot de passe de l'utilisateur"""
    try:
        # Vérifier le mot de passe actuel
        user = await db.users.find_one({"id": current_user["id"]})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Vérifier que l'ancien mot de passe est correct
        if not pwd_context.verify(current_password, user["password"]):
            raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")
        
        # Hasher le nouveau mot de passe
        hashed_password = pwd_context.hash(new_password)
        
        # Mettre à jour
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"password": hashed_password}}
        )
        
        return {"success": True, "message": "Mot de passe changé avec succès"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


# 2. TÉLÉCHARGER SES DONNÉES (GDPR)
@api_router.get("/users/me/data-export")
async def export_user_data(current_user: dict = Depends(get_current_user)):
    """Exporter toutes les données de l'utilisateur (GDPR)"""
    try:
        # Récupérer toutes les données
        user = await db.users.find_one({"id": current_user["id"]})
        posts = await db.posts.find({"author_id": current_user["id"]}).to_list(length=1000)
        comments = await db.comments.find({"user_id": current_user["id"]}).to_list(length=1000)
        stories = await db.stories.find({"author_id": current_user["id"]}).to_list(length=100)
        
        # Préparer l'export
        export_data = {
            "user_profile": {
                "username": user.get("username"),
                "email": user.get("email"),
                "first_name": user.get("first_name"),
                "last_name": user.get("last_name"),
                "bio": user.get("bio"),
                "location": user.get("location"),
                "phone": user.get("phone"),
                "birthdate": user.get("birthdate"),
                "gender": user.get("gender"),
                "created_at": user.get("created_at"),
            },
            "posts": [convert_mongo_doc_to_dict(p) for p in posts],
            "comments": [convert_mongo_doc_to_dict(c) for c in comments],
            "stories": [convert_mongo_doc_to_dict(s) for s in stories],
            "export_date": datetime.now(timezone.utc).isoformat()
        }
        
        return export_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur export: {str(e)}")


# 3. OBTENIR LES SESSIONS ACTIVES
@api_router.get("/users/me/sessions")
async def get_active_sessions(current_user: dict = Depends(get_current_user)):
    """Obtenir la liste des sessions actives"""
    try:
        sessions = await db.sessions.find({
            "user_id": current_user["id"],
            "is_active": True
        }).sort("last_activity", -1).to_list(length=50)
        
        # Convertir les ObjectId
        for session in sessions:
            session["_id"] = str(session["_id"])
        
        return {"sessions": sessions}
    except Exception as e:
        return {"sessions": []}


# 4. RÉVOQUER UNE SESSION
@api_router.delete("/users/me/sessions/{session_id}")
async def revoke_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Révoquer une session spécifique"""
    try:
        result = await db.sessions.update_one(
            {
                "id": session_id,
                "user_id": current_user["id"]
            },
            {"$set": {
                "is_active": False,
                "ended_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        if result.modified_count > 0:
            return {"success": True, "message": "Session révoquée"}
        return {"success": False, "message": "Session non trouvée"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


# 5. DÉSACTIVER LE COMPTE
@api_router.put("/users/me/deactivate")
async def deactivate_account(
    password: str = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Désactiver le compte utilisateur"""
    try:
        # Vérifier le mot de passe
        user = await db.users.find_one({"id": current_user["id"]})
        if not pwd_context.verify(password, user["password"]):
            raise HTTPException(status_code=400, detail="Mot de passe incorrect")
        
        # Marquer comme désactivé
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {
                "is_active": False,
                "deactivated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        return {"success": True, "message": "Compte désactivé"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


# 6. OBTENIR LES STATISTIQUES DU COMPTE
@api_router.get("/users/me/stats")
async def get_account_stats(current_user: dict = Depends(get_current_user)):
    """Obtenir les statistiques du compte"""
    try:
        # Compter les posts
        posts_count = await db.posts.count_documents({"author_id": current_user["id"]})
        
        # Compter les likes reçus
        posts = await db.posts.find({"author_id": current_user["id"]}).to_list(length=1000)
        total_likes = sum(post.get("likes_count", 0) for post in posts)
        
        # Compter les commentaires reçus
        total_comments = sum(post.get("comments_count", 0) for post in posts)
        
        # Compter les followers
        followers_count = await db.follows.count_documents({
            "following_id": current_user["id"],
            "status": "accepted"
        })
        
        # Compter les following
        following_count = await db.follows.count_documents({
            "follower_id": current_user["id"],
            "status": "accepted"
        })
        
        # Stories publiées
        stories_count = await db.stories.count_documents({"author_id": current_user["id"]})
        
        return {
            "posts_count": posts_count,
            "total_likes": total_likes,
            "total_comments": total_comments,
            "followers_count": followers_count,
            "following_count": following_count,
            "stories_count": stories_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

        # Optionnel: créer un enregistrement de session
        session_id = str(uuid.uuid4())
        session = {
            "id": session_id,
            "user_id": current_user["id"],
            "started_at": now.isoformat(),
            "last_activity": now.isoformat(),
            "is_active": True
        }
        
        # Insérer dans la collection sessions (si elle existe)
        try:
            await db.sessions.insert_one(session)
        except:
            pass  # Si la collection n'existe pas, on ignore
        
        return {
            "success": True,
            "session_id": session_id,
            "started_at": now.isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.post("/users/me/sessions/{session_id}/end")
async def end_user_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Termine une session utilisateur"""
    try:
        now = datetime.now(timezone.utc)
        
        # Mettre à jour la session si elle existe
        try:
            result = await db.sessions.update_one(
                {
                    "id": session_id,
                    "user_id": current_user["id"]
                },
                {"$set": {
                    "ended_at": now.isoformat(),
                    "is_active": False
                }}
            )
        except:
            pass  # Si la collection n'existe pas, on ignore
        
        return {
            "success": True,
            "session_id": session_id,
            "ended_at": now.isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

# ==================== POSTS ROUTES ====================
@api_router.post("/posts", response_model=Post)
async def create_post(post_data: PostCreate, current_user: dict = Depends(get_current_user)):
    """Créer un nouveau post"""
    post_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    post_to_insert = {
        "id": post_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "content": post_data.content,
        "media_type": post_data.media_type,
        "media_url": post_data.media_url,
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "created_at": now.isoformat()
    }
    
    await db.posts.insert_one(post_to_insert)
    
    post = convert_mongo_doc_to_dict(post_to_insert)
    post["is_liked"] = False
    return Post(**post)

@api_router.get("/posts/feed", response_model=List[Post])
async def get_posts_feed(current_user: dict = Depends(get_current_user)):
    """Récupère le feed de posts (seulement des comptes autorisés)"""
    # Récupère les utilisateurs suivis
    follows_raw = await db.follows.find({
        "follower_id": current_user["id"],
        "status": "following"  # ← IMPORTANT: seulement les follows confirmés
    }).to_list(length=100)
    
    # Support ancien format (following_id) et nouveau (followed_id)
    followed_user_ids = []
    for f in follows_raw:
        f_dict = convert_mongo_doc_to_dict(f)
        # Essaie followed_id puis following_id (rétrocompatibilité)
        user_id = f_dict.get("followed_id") or f_dict.get("following_id")
        if user_id:
            followed_user_ids.append(user_id)
    
    followed_user_ids.append(current_user["id"])
    
    # Récupère les posts
    posts_raw = await db.posts.find({
        "author_id": {"$in": followed_user_ids}
    }).sort("created_at", -1).limit(50).to_list(length=50)
    
    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        posts.append(Post(**post))
    
    return posts

@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère un post spécifique"""
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    
    post = convert_mongo_doc_to_dict(post_raw)
    like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
    post["is_liked"] = bool(like_raw)
    return Post(**post)

@api_router.post("/posts/{post_id}/repost", response_model=Post)
async def repost(post_id: str, current_user: dict = Depends(get_current_user)):
    """Repartage un post (repost/republication)"""
    original_raw = await db.posts.find_one({"id": post_id})
    if not original_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    original = convert_mongo_doc_to_dict(original_raw)

    # Empêcher de reposter son propre post
    if original["author_id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas reposter votre propre publication")

    # Vérifier doublon
    existing = await db.posts.find_one({
        "repost_of": post_id,
        "author_id": current_user["id"]
    })
    if existing:
        raise HTTPException(status_code=400, detail="Vous avez déjà reposté cette publication")

    now = datetime.now(timezone.utc)
    new_id = str(uuid.uuid4())
    repost_doc = {
        "id": new_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "content": original["content"],
        "media_type": original.get("media_type"),
        "media_url": original.get("media_url"),
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "repost_of": post_id,
        "original_author_username": original["author_username"],
        "original_author_id": original["author_id"],
        "created_at": now.isoformat()
    }
    await db.posts.insert_one(repost_doc)
    await db.posts.update_one({"id": post_id}, {"$inc": {"shares_count": 1}})
    result = convert_mongo_doc_to_dict(repost_doc)
    result["is_liked"] = False
    return Post(**result)

@api_router.delete("/posts/{post_id}")
async def delete_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime un post"""
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    
    post = convert_mongo_doc_to_dict(post_raw)
    if post["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.posts.delete_one({"id": post_id})
    await db.likes.delete_many({"post_id": post_id})
    await db.comments.delete_many({"post_id": post_id})
    
    return {"message": "Post deleted successfully"}

@api_router.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Like/unlike un post"""
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    
    like_raw = await db.likes.find_one({"post_id": post_id, "user_id": current_user["id"]})
    
    if like_raw:
        # Unlike
        await db.likes.delete_one({"post_id": post_id, "user_id": current_user["id"]})
        await db.posts.update_one({"id": post_id}, {"$inc": {"likes_count": -1}})
        return {"liked": False}
    else:
        # Like
        like_id = str(uuid.uuid4())
        await db.likes.insert_one({
            "id": like_id,
            "post_id": post_id,
            "user_id": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        await db.posts.update_one({"id": post_id}, {"$inc": {"likes_count": 1}})
        
        # Créer une notification
        post = convert_mongo_doc_to_dict(post_raw)
        if post["author_id"] != current_user["id"]:
            notif_id = str(uuid.uuid4())
            await db.notifications.insert_one({
                "id": notif_id,
                "user_id": post["author_id"],
                "type": "like",
                "from_user_id": current_user["id"],
                "from_username": current_user["username"],
                "from_profile_pic": current_user.get("profile_pic"),
                "post_id": post_id,
                "read": False,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        
        return {"liked": True}

@api_router.get("/posts/{post_id}/comments", response_model=List[Comment])
async def get_post_comments(post_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les commentaires d'un post"""
    comments_raw = await db.comments.find({"post_id": post_id}).sort("created_at", -1).to_list(length=100)
    
    comments = []
    for comment_raw in comments_raw:
        comment = convert_mongo_doc_to_dict(comment_raw)
        comments.append(Comment(**comment))
    
    return comments

@api_router.post("/posts/{post_id}/comments", response_model=Comment)
async def create_comment(post_id: str, comment_data: CommentCreate, current_user: dict = Depends(get_current_user)):
    """Ajoute un commentaire à un post"""
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    
    comment_id = str(uuid.uuid4())
    comment_to_insert = {
        "id": comment_id,
        "post_id": post_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "content": comment_data.content,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.comments.insert_one(comment_to_insert)
    await db.posts.update_one({"id": post_id}, {"$inc": {"comments_count": 1}})
    
    # Créer une notification
    post = convert_mongo_doc_to_dict(post_raw)
    if post["author_id"] != current_user["id"]:
        notif_id = str(uuid.uuid4())
        await db.notifications.insert_one({
            "id": notif_id,
            "user_id": post["author_id"],
            "type": "comment",
            "from_user_id": current_user["id"],
            "from_username": current_user["username"],
            "from_profile_pic": current_user.get("profile_pic"),
            "post_id": post_id,
            "comment_content": comment_data.content,
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    comment = convert_mongo_doc_to_dict(comment_to_insert)
    return Comment(**comment)

@api_router.delete("/posts/{post_id}/comments/{comment_id}")
async def delete_comment(post_id: str, comment_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime un commentaire"""
    comment_raw = await db.comments.find_one({"id": comment_id, "post_id": post_id})
    if not comment_raw:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    comment = convert_mongo_doc_to_dict(comment_raw)
    if comment["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.comments.delete_one({"id": comment_id})
    await db.posts.update_one({"id": post_id}, {"$inc": {"comments_count": -1}})
    
    return {"message": "Comment deleted successfully"}

@api_router.post("/comments/{comment_id}/like")
async def like_comment(comment_id: str, current_user: dict = Depends(get_current_user)):
    """Like/unlike un commentaire"""
    comment_raw = await db.comments.find_one({"id": comment_id})
    if not comment_raw:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    like_raw = await db.comment_likes.find_one({"comment_id": comment_id, "user_id": current_user["id"]})
    
    if like_raw:
        # Unlike
        await db.comment_likes.delete_one({"comment_id": comment_id, "user_id": current_user["id"]})
        await db.comments.update_one({"id": comment_id}, {"$inc": {"likes_count": -1}})
        return {"liked": False}
    else:
        # Like
        like_id = str(uuid.uuid4())
        await db.comment_likes.insert_one({
            "id": like_id,
            "comment_id": comment_id,
            "user_id": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        await db.comments.update_one({"id": comment_id}, {"$inc": {"likes_count": 1}})
        return {"liked": True}

@api_router.get("/comments/{comment_id}/replies")
async def get_comment_replies(comment_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les réponses d'un commentaire"""
    replies_raw = await db.comment_replies.find({"parent_comment_id": comment_id}).sort("created_at", 1).to_list(length=100)
    
    replies = []
    for reply_raw in replies_raw:
        reply = convert_mongo_doc_to_dict(reply_raw)
        replies.append(Comment(**reply))
    
    return replies

@api_router.post("/comments/{comment_id}/replies")
async def create_comment_reply(comment_id: str, reply_data: CommentCreate, current_user: dict = Depends(get_current_user)):
    """Ajoute une réponse à un commentaire"""
    comment_raw = await db.comments.find_one({"id": comment_id})
    if not comment_raw:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    reply_id = str(uuid.uuid4())
    reply_to_insert = {
        "id": reply_id,
        "parent_comment_id": comment_id,
        "post_id": convert_mongo_doc_to_dict(comment_raw)["post_id"],
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "content": reply_data.content,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.comment_replies.insert_one(reply_to_insert)
    await db.comments.update_one({"id": comment_id}, {"$inc": {"replies_count": 1}})
    
    reply = convert_mongo_doc_to_dict(reply_to_insert)
    return Comment(**reply)

# ==================== USERS ROUTES ====================
@api_router.get("/users/search")
async def search_users(q: str, current_user: dict = Depends(get_current_user)):
    """Recherche des utilisateurs"""
    if not q or len(q.strip()) == 0:
        return []
    
    users_raw = await db.users.find({
        "$or": [
            {"username": {"$regex": q, "$options": "i"}},
            {"bio": {"$regex": q, "$options": "i"}}
        ]
    }).limit(20).to_list(length=20)
    
    users = []
    for user_raw in users_raw:
        user = convert_mongo_doc_to_dict(user_raw)
        is_following = await check_is_following(current_user["id"], user["id"])
        users.append(UserProfile(
            id=user["id"],
            username=user["username"],
            bio=user.get("bio", ""),
            profile_pic=user.get("profile_pic"),
            followers_count=user.get("followers_count", 0),
            following_count=user.get("following_count", 0),
            is_following=is_following,
            created_at=user["created_at"]
        ))
    
    return users

@api_router.get("/users/{user_id}", response_model=UserProfile)
async def get_user_profile(user_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère le profil d'un utilisateur"""
    user_raw = await db.users.find_one({"id": user_id})
    if not user_raw:
        raise HTTPException(status_code=404, detail="User not found")
    
    user = convert_mongo_doc_to_dict(user_raw)
    is_following = await check_is_following(current_user["id"], user_id)
    
    return UserProfile(
        id=user["id"],
        username=user["username"],
        bio=user.get("bio", ""),
        profile_pic=user.get("profile_pic"),
        followers_count=user.get("followers_count", 0),
        following_count=user.get("following_count", 0),
        is_following=is_following,
        created_at=user["created_at"]
    )

@api_router.get("/users/{user_id}/posts", response_model=List[Post])
async def get_user_posts(user_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les posts d'un utilisateur (avec vérification privacy)"""
    
    # Vérifier si c'est son propre profil
    is_own_profile = current_user["id"] == user_id
    
    if not is_own_profile:
        # Récupérer l'utilisateur cible
        target_user = await db.users.find_one({"id": user_id})
        
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Si le compte est privé, vérifier si l'utilisateur suit
        if target_user.get("is_private", False):
            is_following = await check_is_following(current_user["id"], user_id)
            
            if not is_following:
                raise HTTPException(
                    status_code=403, 
                    detail="Ce compte est privé. Vous devez être abonné pour voir ses publications."
                )
    
    # Récupérer les posts
    posts_raw = await db.posts.find({"author_id": user_id}).sort("created_at", -1).to_list(length=50)
    
    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        posts.append(Post(**post))
    
    return posts

# ==================== USER SETTINGS ROUTES ====================
@api_router.put("/users/me/email")
async def update_email(
    email_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Modifier l'email de l'utilisateur"""
    new_email = email_data.get("new_email")
    current_password = email_data.get("current_password")
    
    if not new_email or not current_password:
        raise HTTPException(status_code=400, detail="Missing required fields")
    
    # Vérifier le mot de passe
    if not pwd_context.verify(current_password, current_user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect password")
    
    # Vérifier si l'email existe déjà
    existing_user = await db.users.find_one({"email": new_email})
    if existing_user and existing_user["id"] != current_user["id"]:
        raise HTTPException(status_code=400, detail="Email already in use")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"email": new_email}}
    )
    
    return {"message": "Email updated successfully"}

@api_router.put("/users/me/password")
async def update_password(
    password_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Modifier le mot de passe"""
    current_password = password_data.get("current_password")
    new_password = password_data.get("new_password")
    
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Missing required fields")
    
    # Vérifier le mot de passe actuel
    if not pwd_context.verify(current_password, current_user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect password")
    
    # Hasher le nouveau mot de passe
    hashed_password = pwd_context.hash(new_password)
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"password": hashed_password}}
    )
    
    return {"message": "Password updated successfully"}

@api_router.put("/users/me/username")
async def update_username(
    username_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Modifier le nom d'utilisateur"""
    new_username = username_data.get("new_username")
    current_password = username_data.get("current_password")
    
    if not new_username or not current_password:
        raise HTTPException(status_code=400, detail="Missing required fields")
    
    # Vérifier le mot de passe
    if not pwd_context.verify(current_password, current_user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect password")
    
    # Vérifier si le username existe déjà
    existing_user = await db.users.find_one({"username": new_username})
    if existing_user and existing_user["id"] != current_user["id"]:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"username": new_username}}
    )
    
    return {"message": "Username updated successfully"}

@api_router.delete("/users/me")
async def delete_account(current_user: dict = Depends(get_current_user)):
    """Supprimer le compte utilisateur"""
    user_id = current_user["id"]
    
    # Supprimer toutes les données de l'utilisateur
    await db.users.delete_one({"id": user_id})
    await db.posts.delete_many({"author_id": user_id})
    await db.comments.delete_many({"author_id": user_id})
    await db.likes.delete_many({"user_id": user_id})
    await db.follows.delete_many({"$or": [{"follower_id": user_id}, {"followed_id": user_id}]})
    await db.messages.delete_many({"$or": [{"sender_id": user_id}, {"recipient_id": user_id}]})
    await db.notifications.delete_many({"$or": [{"user_id": user_id}, {"from_user_id": user_id}]})
    
    return {"message": "Account deleted successfully"}

@api_router.put("/users/me/privacy")
async def update_privacy(
    privacy_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Modifier la confidentialité du compte"""
    is_private = privacy_data.get("is_private", False)
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"is_private": is_private}}
    )
    
    return {"message": "Privacy settings updated"}

@api_router.get("/users/me/liked-posts")
async def get_liked_posts(current_user: dict = Depends(get_current_user)):
    """Récupère les publications aimées par l'utilisateur"""
    likes_raw = await db.likes.find({"user_id": current_user["id"]}).sort("created_at", -1).to_list(length=100)
    
    posts = []
    for like_raw in likes_raw:
        like = convert_mongo_doc_to_dict(like_raw)
        post_raw = await db.posts.find_one({"id": like["post_id"]})
        if post_raw:
            post = convert_mongo_doc_to_dict(post_raw)
            post["is_liked"] = True
            posts.append(Post(**post))
    
    return posts

@api_router.get("/users/me/comments")
async def get_user_comments(current_user: dict = Depends(get_current_user)):
    """Récupère tous les commentaires de l'utilisateur"""
    comments_raw = await db.comments.find({"author_id": current_user["id"]}).sort("created_at", -1).to_list(length=100)
    
    comments = []
    for comment_raw in comments_raw:
        comment = convert_mongo_doc_to_dict(comment_raw)
        # Récupérer l'auteur du post
        post_raw = await db.posts.find_one({"id": comment["post_id"]})
        if post_raw:
            post = convert_mongo_doc_to_dict(post_raw)
            comment["post_author"] = post["author_username"]
            comments.append(comment)
    
    return comments

@api_router.get("/users/me/deleted-items")
async def get_deleted_items(current_user: dict = Depends(get_current_user)):
    """Récupère les éléments récemment supprimés (30 jours)"""
    # Cette fonctionnalité nécessiterait un système de soft delete
    # Pour l'instant, retourne une liste vide
    return []

@api_router.get("/users/me/time-stats")
async def get_time_stats(current_user: dict = Depends(get_current_user)):
    """Récupère les statistiques de temps d'utilisation"""
    # Cette fonctionnalité nécessiterait un système de tracking
    # Pour l'instant, retourne des données simulées
    import random
    return {
        "today": random.randint(30, 180),  # minutes
        "week": random.randint(200, 800),  # minutes
        "month": random.randint(1000, 3000),  # minutes
        "average": random.randint(40, 120),  # minutes par jour
        "most_active_day": random.choice(["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"])
    }

@api_router.post("/users/{user_id}/follow")
async def follow_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Follow/unfollow un utilisateur"""
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    user_raw = await db.users.find_one({"id": user_id})
    if not user_raw:
        raise HTTPException(status_code=404, detail="User not found")
    
    existing_follow_raw = await db.follows.find_one({"follower_id": current_user["id"], "followed_id": user_id})
    
    if existing_follow_raw:
        # Unfollow
        await db.follows.delete_one({"follower_id": current_user["id"], "followed_id": user_id})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": -1}})
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": -1}})
        return {"following": False}
    else:
        # Follow
        follow_id = str(uuid.uuid4())
        await db.follows.insert_one({
            "id": follow_id,
            "follower_id": current_user["id"],
            "followed_id": user_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": 1}})
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": 1}})
        
        # Créer une notification
        notif_id = str(uuid.uuid4())
        await db.notifications.insert_one({
            "id": notif_id,
            "user_id": user_id,
            "type": "follow",
            "from_user_id": current_user["id"],
            "from_username": current_user["username"],
            "from_profile_pic": current_user.get("profile_pic"),
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        return {"following": True}

# ==================== NOTIFICATIONS ROUTES ====================
@api_router.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: dict = Depends(get_current_user)):
    """Récupère les notifications de l'utilisateur"""
    notifications_raw = await db.notifications.find({"user_id": current_user["id"]}).sort("created_at", -1).limit(50).to_list(length=50)
    
    notifications = []
    for notif_raw in notifications_raw:
        notif = convert_mongo_doc_to_dict(notif_raw)
        notifications.append(Notification(**notif))
    
    return notifications

@api_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Marque une notification comme lue"""
    notif_raw = await db.notifications.find_one({"id": notification_id})
    if not notif_raw:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    notif = convert_mongo_doc_to_dict(notif_raw)
    if notif["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.notifications.update_one({"id": notification_id}, {"$set": {"read": True}})
    return {"message": "Notification marked as read"}

# ==================== MESSAGES ROUTES ====================
@api_router.get("/messages/conversations", response_model=List[Conversation])
async def get_conversations(current_user: dict = Depends(get_current_user)):
    """Récupère les conversations de l'utilisateur"""
    messages_raw = await db.messages.find({
        "$or": [
            {"sender_id": current_user["id"]},
            {"recipient_id": current_user["id"]}
        ]
    }).sort("created_at", -1).to_list(length=1000)
    
    conversations_dict = {}
    for msg_raw in messages_raw:
        msg = convert_mongo_doc_to_dict(msg_raw)
        other_user_id = msg["recipient_id"] if msg["sender_id"] == current_user["id"] else msg["sender_id"]
        
        if other_user_id not in conversations_dict:
            other_user_raw = await db.users.find_one({"id": other_user_id})
            if other_user_raw:
                other_user = convert_mongo_doc_to_dict(other_user_raw)
                unread_count = await db.messages.count_documents({
                    "sender_id": other_user_id,
                    "recipient_id": current_user["id"],
                    "read": False
                })
                
                conversations_dict[other_user_id] = Conversation(
                    user_id=other_user["id"],
                    username=other_user["username"],
                    profile_pic=other_user.get("profile_pic"),
                    last_message=msg["content"],
                    last_message_time=msg["created_at"],
                    unread_count=unread_count
                )
    
    return list(conversations_dict.values())

@api_router.get("/messages/groups-list")
async def list_groups_alias(current_user: dict = Depends(get_current_user)):
    """Alias pour lister les groupes (évite le conflit de route avec /{user_id})"""
    groups_raw = await db.group_chats.find({
        "member_ids": current_user["id"]
    }).to_list(length=100)
    groups = [convert_mongo_doc_to_dict(g) for g in groups_raw]
    return {"success": True, "groups": groups}

@api_router.get("/messages/{user_id}", response_model=List[Message])
async def get_messages_with_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les messages avec un utilisateur spécifique"""
    messages_raw = await db.messages.find({
        "$or": [
            {"sender_id": current_user["id"], "recipient_id": user_id},
            {"sender_id": user_id, "recipient_id": current_user["id"]}
        ]
    }).sort("created_at", 1).to_list(length=100)
    
    messages = []
    for msg_raw in messages_raw:
        msg = convert_mongo_doc_to_dict(msg_raw)
        messages.append(Message(**msg))
    
    # Marquer les messages reçus comme lus
    await db.messages.update_many(
        {"sender_id": user_id, "recipient_id": current_user["id"], "read": False},
        {"$set": {"read": True}}
    )
    
    return messages

@api_router.post("/messages", response_model=Message)
async def send_message(message_data: MessageCreate, current_user: dict = Depends(get_current_user)):
    """Envoie un message"""
    recipient_raw = await db.users.find_one({"id": message_data.recipient_id})
    if not recipient_raw:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    recipient = convert_mongo_doc_to_dict(recipient_raw)
    message_id = str(uuid.uuid4())
    
    message_to_insert = {
        "id": message_id,
        "sender_id": current_user["id"],
        "sender_username": current_user["username"],
        "sender_profile_pic": current_user.get("profile_pic"),
        "recipient_id": message_data.recipient_id,
        "recipient_username": recipient["username"],
        "content": message_data.content,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.messages.insert_one(message_to_insert)
    
    message = convert_mongo_doc_to_dict(message_to_insert)
    return Message(**message)

# ==================== ENHANCED MESSAGES FEATURES ====================

# Read Receipts
@api_router.put("/messages/{message_id}/status")
async def update_message_status(
    message_id: str,
    status_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Mettre à jour le statut d'un message (delivered/read)"""
    status = status_data.get("status")
    
    message_raw = await db.messages.find_one({"id": message_id})
    if not message_raw:
        raise HTTPException(status_code=404, detail="Message not found")
    
    message = convert_mongo_doc_to_dict(message_raw)
    
    # Seul le destinataire peut mettre à jour le statut
    if message["recipient_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    now = datetime.now(timezone.utc).isoformat()
    updates = {"status": status, "updated_at": now}
    
    if status == "delivered" and not message.get("delivered_at"):
        updates["delivered_at"] = now
    elif status == "read" and not message.get("read_at"):
        updates["read_at"] = now
        updates["read"] = True  # Backward compatibility
        if not message.get("delivered_at"):
            updates["delivered_at"] = now
    
    await db.messages.update_one(
        {"id": message_id},
        {"$set": updates}
    )
    
    return {"success": True, "status": status}

@api_router.put("/messages/mark-as-read/{user_id}")
async def mark_conversation_as_read(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Marquer tous les messages d'une conversation comme lus"""
    now = datetime.now(timezone.utc).isoformat()
    
    result = await db.messages.update_many(
        {
            "sender_id": user_id,
            "recipient_id": current_user["id"],
            "read": False
        },
        {
            "$set": {
                "status": "read",
                "read": True,
                "read_at": now,
                "updated_at": now
            }
        }
    )
    
    return {
        "success": True,
        "marked_count": result.modified_count
    }

# Reactions
@api_router.post("/messages/{message_id}/react")
async def add_reaction(
    message_id: str,
    reaction_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Ajouter une réaction à un message"""
    emoji = reaction_data.get("emoji")
    
    message_raw = await db.messages.find_one({"id": message_id})
    if not message_raw:
        raise HTTPException(status_code=404, detail="Message not found")
    
    message = convert_mongo_doc_to_dict(message_raw)
    
    # Vérifier que l'utilisateur fait partie de la conversation
    if current_user["id"] not in [message["sender_id"], message["recipient_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Vérifier si l'utilisateur a déjà réagi
    reactions = message.get("reactions", [])
    existing = next((r for r in reactions if r["user_id"] == current_user["id"]), None)
    
    if existing:
        reactions = [r for r in reactions if r["user_id"] != current_user["id"]]
    
    # Ajouter nouvelle réaction
    reactions.append({
        "user_id": current_user["id"],
        "emoji": emoji,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"reactions": reactions}}
    )
    
    return {"success": True, "reactions": reactions}

@api_router.delete("/messages/{message_id}/react")
async def remove_reaction(
    message_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Retirer sa réaction d'un message"""
    message_raw = await db.messages.find_one({"id": message_id})
    if not message_raw:
        raise HTTPException(status_code=404, detail="Message not found")
    
    message = convert_mongo_doc_to_dict(message_raw)
    reactions = message.get("reactions", [])
    reactions = [r for r in reactions if r["user_id"] != current_user["id"]]
    
    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"reactions": reactions}}
    )
    
    return {"success": True, "reactions": reactions}

# Delete Message
@api_router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    delete_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Supprimer un message"""
    delete_for = delete_data.get("delete_for", "me")
    
    message_raw = await db.messages.find_one({"id": message_id})
    if not message_raw:
        raise HTTPException(status_code=404, detail="Message not found")
    
    message = convert_mongo_doc_to_dict(message_raw)
    deleted_by = message.get("deleted_by", [])
    
    if delete_for == "everyone":
        # Seul l'expéditeur peut supprimer pour tout le monde
        if message["sender_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Supprimer complètement
        await db.messages.delete_one({"id": message_id})
        return {"success": True, "message": "Message deleted for everyone"}
    
    else:  # delete_for == "me"
        if current_user["id"] not in deleted_by:
            deleted_by.append(current_user["id"])
        
        await db.messages.update_one(
            {"id": message_id},
            {"$set": {"deleted_by": deleted_by}}
        )
        
        return {"success": True, "message": "Message deleted for you"}

# ==================== GROUP CHATS ====================

@api_router.post("/messages/groups")
async def create_group(
    group_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Créer un groupe de discussion"""
    try:
        # Validation des données
        if not group_data.get("name"):
            raise HTTPException(status_code=400, detail="Le nom du groupe est requis")

        if not isinstance(group_data.get("name"), str) or len(group_data["name"].strip()) == 0:
            raise HTTPException(status_code=400, detail="Le nom du groupe doit être une chaîne non vide")

        member_ids = group_data.get("member_ids", [])
        if not isinstance(member_ids, list):
            raise HTTPException(status_code=400, detail="member_ids doit être une liste")

        # Vérifier que tous les membres existent
        if member_ids:
            members_count = await db.users.count_documents({"id": {"$in": member_ids}})
            if members_count != len(member_ids):
                raise HTTPException(status_code=400, detail="Certains utilisateurs n'existent pas")

        now = datetime.now(timezone.utc).isoformat()
        group_id = str(uuid.uuid4())

        # Créer le groupe avec le créateur toujours inclus
        all_member_ids = [current_user["id"]] + [mid for mid in member_ids if mid != current_user["id"]]

        print(f"✅ Création groupe avec member_ids: {all_member_ids}")
        print(f"✅ Creator ID: {current_user['id']}")

        group = {
            "id": group_id,
            "name": group_data["name"].strip(),
            "avatar_url": group_data.get("avatar_url"),
            "creator_id": current_user["id"],
            "admin_ids": [current_user["id"]],
            "member_ids": all_member_ids,
            "settings": {
                "allow_members_to_add": group_data.get("allow_members_to_add", True),
                "allow_members_to_send_media": group_data.get("allow_members_to_send_media", True)
            },
            "created_at": now,
            "updated_at": now
        }

        # Insérer le groupe dans la base de données
        result = await db.group_chats.insert_one(group)
        print(f"✅ Groupe créé avec ID: {group_id}")

        if not result.inserted_id:
            raise HTTPException(status_code=500, detail="Erreur lors de la création du groupe")

        # Retourner le groupe créé
        group_response = convert_mongo_doc_to_dict(group)

        return {
            "success": True,
            "group": group_response
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Erreur création groupe: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création du groupe: {str(e)}")

@api_router.get("/messages/groups")
async def list_groups(current_user: dict = Depends(get_current_user)):
    """Lister les groupes de l'utilisateur"""
    print(f"🔍 Recherche groupes pour user: {current_user['id']} (type: {type(current_user['id'])})")

    # Essayer de trouver TOUS les groupes d'abord
    all_groups = await db.group_chats.find({}).to_list(length=100)
    print(f"📊 Total de groupes dans la DB: {len(all_groups)}")

    if all_groups:
        for g in all_groups:
            print(f"  - Groupe '{g.get('name')}' avec member_ids: {g.get('member_ids')} (types: {[type(mid) for mid in g.get('member_ids', [])]})")

    # Recherche avec l'utilisateur actuel
    groups_raw = await db.group_chats.find({
        "member_ids": current_user["id"]
    }).to_list(length=100)

    print(f"📊 Groupes trouvés pour cet utilisateur: {len(groups_raw)}")

    groups = [convert_mongo_doc_to_dict(g) for g in groups_raw]

    print(f"📦 Groupes à retourner: {[g['name'] for g in groups]}")

    return {
        "success": True,
        "groups": groups
    }

@api_router.get("/messages/groups/{group_id}")
async def get_group(
    group_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Détails d'un groupe"""
    group_raw = await db.group_chats.find_one({"id": group_id})
    
    if not group_raw:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group = convert_mongo_doc_to_dict(group_raw)
    
    # Vérifier membership
    if current_user["id"] not in group["member_ids"]:
        raise HTTPException(status_code=403, detail="Not a member")
    
    return {
        "success": True,
        "group": group
    }

@api_router.post("/messages/groups/{group_id}/messages")
async def send_group_message(
    group_id: str,
    message_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Envoyer un message dans un groupe"""
    try:
        # Validation du contenu
        if not message_data.get("content"):
            raise HTTPException(status_code=400, detail="Le contenu du message est requis")

        if not isinstance(message_data.get("content"), str) or len(message_data["content"].strip()) == 0:
            raise HTTPException(status_code=400, detail="Le contenu du message doit être une chaîne non vide")

        # Vérifier membership
        group_raw = await db.group_chats.find_one({"id": group_id})

        if not group_raw:
            raise HTTPException(status_code=404, detail="Groupe introuvable")

        group = convert_mongo_doc_to_dict(group_raw)

        if current_user["id"] not in group["member_ids"]:
            raise HTTPException(status_code=403, detail="Vous n'êtes pas membre de ce groupe")

        now = datetime.now(timezone.utc).isoformat()
        message_id = str(uuid.uuid4())

        message = {
            "id": message_id,
            "group_id": group_id,
            "sender_id": current_user["id"],
            "sender_username": current_user["username"],
            "sender_profile_pic": current_user.get("profile_pic"),
            "content": message_data["content"].strip(),
            "media_urls": message_data.get("media_urls", []),
            "reply_to_id": message_data.get("reply_to_id"),
            "reactions": [],
            "read_by": [current_user["id"]],
            "deleted_for": [],
            "created_at": now
        }

        result = await db.group_messages.insert_one(message)

        if not result.inserted_id:
            raise HTTPException(status_code=500, detail="Erreur lors de l'envoi du message")

        return {
            "success": True,
            "message": convert_mongo_doc_to_dict(message)
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Erreur envoi message groupe: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'envoi du message: {str(e)}")

@api_router.get("/messages/groups/{group_id}/messages")
async def get_group_messages(
    group_id: str,
    limit: int = 50,
    skip: int = 0,
    current_user: dict = Depends(get_current_user)
):
    """Récupérer les messages d'un groupe"""
    # Vérifier membership
    group_raw = await db.group_chats.find_one({"id": group_id})
    
    if not group_raw:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group = convert_mongo_doc_to_dict(group_raw)
    
    if current_user["id"] not in group["member_ids"]:
        raise HTTPException(status_code=403, detail="Not a member")
    
    # Récupérer messages non supprimés pour cet utilisateur
    messages_raw = await db.group_messages.find({
        "group_id": group_id,
        "deleted_for": {"$ne": current_user["id"]}
    }).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
    
    messages = [convert_mongo_doc_to_dict(m) for m in messages_raw]
    messages.reverse()  # Ordre chronologique
    
    return {
        "success": True,
        "messages": messages
    }

@api_router.put("/messages/groups/{group_id}")
async def update_group(
    group_id: str,
    group_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Mettre à jour les paramètres d'un groupe"""
    try:
        # Vérifier que le groupe existe
        group_raw = await db.group_chats.find_one({"id": group_id})

        if not group_raw:
            raise HTTPException(status_code=404, detail="Groupe introuvable")

        group = convert_mongo_doc_to_dict(group_raw)

        # Vérifier si admin
        if current_user["id"] not in group["admin_ids"]:
            raise HTTPException(status_code=403, detail="Seuls les admins peuvent modifier le groupe")

        # Préparer les données de mise à jour
        update_data = {}

        if "name" in group_data:
            if not group_data["name"] or not isinstance(group_data["name"], str) or len(group_data["name"].strip()) == 0:
                raise HTTPException(status_code=400, detail="Le nom du groupe doit être une chaîne non vide")
            update_data["name"] = group_data["name"].strip()

        if "avatar_url" in group_data:
            update_data["avatar_url"] = group_data["avatar_url"]

        if not update_data:
            raise HTTPException(status_code=400, detail="Aucune donnée à mettre à jour")

        # Ajouter la date de mise à jour
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

        # Mettre à jour le groupe
        await db.group_chats.update_one(
            {"id": group_id},
            {"$set": update_data}
        )

        # Récupérer le groupe mis à jour
        updated_group_raw = await db.group_chats.find_one({"id": group_id})
        updated_group = convert_mongo_doc_to_dict(updated_group_raw)

        return {
            "success": True,
            "group": updated_group
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Erreur mise à jour groupe: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la mise à jour du groupe: {str(e)}")

@api_router.post("/messages/groups/{group_id}/members")
async def add_group_member(
    group_id: str,
    member_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Ajouter un membre à un groupe"""
    group_raw = await db.group_chats.find_one({"id": group_id})
    
    if not group_raw:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group = convert_mongo_doc_to_dict(group_raw)
    
    # Vérifier si admin
    if current_user["id"] not in group["admin_ids"]:
        raise HTTPException(status_code=403, detail="Admin only")
    
    user_id = member_data.get("user_id")
    
    if user_id not in group["member_ids"]:
        await db.group_chats.update_one(
            {"id": group_id},
            {
                "$push": {"member_ids": user_id},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            }
        )
    
    return {"success": True, "message": "Member added"}

@api_router.delete("/messages/groups/{group_id}/members/{user_id}")
async def remove_group_member(
    group_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Retirer un membre d'un groupe"""
    group_raw = await db.group_chats.find_one({"id": group_id})
    
    if not group_raw:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group = convert_mongo_doc_to_dict(group_raw)
    
    # Vérifier si admin ou si c'est l'utilisateur lui-même
    if current_user["id"] not in group["admin_ids"] and current_user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Ne pas retirer le créateur
    if user_id == group["creator_id"]:
        raise HTTPException(status_code=400, detail="Cannot remove creator")
    
    await db.group_chats.update_one(
        {"id": group_id},
        {
            "$pull": {"member_ids": user_id, "admin_ids": user_id},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    return {"success": True, "message": "Member removed"}

# ==================== SEARCH ROUTES ====================
@api_router.get("/search")
async def search(q: str, current_user: dict = Depends(get_current_user)):
    """Recherche globale (utilisateurs et posts)"""
    if not q or len(q.strip()) == 0:
        return {"users": [], "posts": []}
    
    # Search users
    users_raw = await db.users.find({
        "$or": [
            {"username": {"$regex": q, "$options": "i"}},
            {"bio": {"$regex": q, "$options": "i"}}
        ]
    }).limit(10).to_list(length=10)
    
    users = []
    for user_raw in users_raw:
        user = convert_mongo_doc_to_dict(user_raw)
        is_following = await check_is_following(current_user["id"], user["id"])
        users.append(UserProfile(
            id=user["id"],
            username=user["username"],
            bio=user.get("bio", ""),
            profile_pic=user.get("profile_pic"),
            followers_count=user.get("followers_count", 0),
            following_count=user.get("following_count", 0),
            is_following=is_following,
            created_at=user["created_at"]
        ))
    
    # Search posts
    posts_raw = await db.posts.find({
        "content": {"$regex": q, "$options": "i"}
    }).sort("created_at", -1).limit(20).to_list(length=20)
    
    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        posts.append(Post(**post))
    
    return {"users": users, "posts": posts}

# ==================== STORIES ROUTES ====================
@api_router.post("/stories", response_model=Story)
async def create_story(
    file: UploadFile = File(None),
    media_type: str = Form(None),
    media_url: str = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """Créer une nouvelle story - supporte upload de fichier OU URL"""
    story_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=24)
    
    # CAS 1: Upload de fichier
    if file:
        content_type = file.content_type
        if content_type.startswith('image'):
            media_type = 'image'
        elif content_type.startswith('video'):
            media_type = 'video'
        else:
            raise HTTPException(status_code=400, detail="Type de fichier non supporté")
        
        # Lire et convertir en base64
        file_content = await file.read()
        media_url = f"data:{content_type};base64,{base64.b64encode(file_content).decode()}"
    
    # CAS 2: URL fournie directement (ancien système)
    elif media_url and media_type:
        pass  # Utilise les valeurs fournies
    
    else:
        raise HTTPException(status_code=400, detail="Fichier ou URL requis")
    
    story_to_insert = {
        "id": story_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "media_type": media_type,
        "media_url": media_url,
        "views_count": 0,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat()
    }
    
    await db.stories.insert_one(story_to_insert)
    
    story = convert_mongo_doc_to_dict(story_to_insert)
    story["has_viewed"] = False
    return Story(**story)

@api_router.get("/stories/feed", response_model=List[StoryGroup])
async def get_stories_feed(current_user: dict = Depends(get_current_user)):
    """Récupère les stories du feed (utilisateurs suivis + propres stories)"""
    now = datetime.now(timezone.utc).isoformat()
    
    # Récupère les utilisateurs suivis + l'utilisateur actuel
    follows_raw = await db.follows.find({"follower_id": current_user["id"]}).to_list(length=100)
    
    # Support ancien format (following_id) et nouveau (followed_id)
    followed_user_ids = []
    for f in follows_raw:
        f_dict = convert_mongo_doc_to_dict(f)
        # Essaie followed_id puis following_id (rétrocompatibilité)
        user_id = f_dict.get("followed_id") or f_dict.get("following_id")
        if user_id:
            followed_user_ids.append(user_id)
    
    followed_user_ids.append(current_user["id"])  # Ajoute l'utilisateur actuel
    
    # Récupère toutes les stories non expirées des utilisateurs suivis
    stories_raw = await db.stories.find({
        "author_id": {"$in": followed_user_ids},
        "expires_at": {"$gt": now}
    }).sort("created_at", -1).to_list(length=1000)
    
    # Groupe les stories par auteur
    stories_by_user = {}
    for story_raw in stories_raw:
        story = convert_mongo_doc_to_dict(story_raw)
        author_id = story["author_id"]
        
        # Vérifie si l'utilisateur a vu cette story
        view_raw = await db.story_views.find_one({
            "story_id": story["id"],
            "user_id": current_user["id"]
        })
        story["has_viewed"] = bool(view_raw)
        
        if author_id not in stories_by_user:
            stories_by_user[author_id] = {
                "user_id": author_id,
                "username": story["author_username"],
                "profile_pic": story.get("author_profile_pic"),
                "stories": [],
                "last_story_time": story["created_at"]
            }
        
        stories_by_user[author_id]["stories"].append(Story(**story))
    
    # Convertit en liste et trie par dernière story
    story_groups = [
        StoryGroup(**group_data) 
        for group_data in stories_by_user.values()
    ]
    story_groups.sort(key=lambda x: x.last_story_time, reverse=True)
    
    return story_groups

@api_router.get("/stories/user/{user_id}", response_model=List[Story])
async def get_user_stories(user_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les stories d'un utilisateur spécifique"""
    now = datetime.now(timezone.utc).isoformat()
    
    user_raw = await db.users.find_one({"id": user_id})
    if not user_raw:
        raise HTTPException(status_code=404, detail="User not found")
    
    stories_raw = await db.stories.find({
        "author_id": user_id,
        "expires_at": {"$gt": now}
    }).sort("created_at", 1).to_list(length=100)
    
    stories = []
    for story_raw in stories_raw:
        story = convert_mongo_doc_to_dict(story_raw)
        
        # Vérifie si l'utilisateur a vu cette story
        view_raw = await db.story_views.find_one({
            "story_id": story["id"],
            "user_id": current_user["id"]
        })
        story["has_viewed"] = bool(view_raw)
        
        stories.append(Story(**story))
    
    return stories

@api_router.post("/stories/{story_id}/view")
async def view_story(story_id: str, current_user: dict = Depends(get_current_user)):
    """Marque une story comme vue"""
    story_raw = await db.stories.find_one({"id": story_id})
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story not found")
    
    # Vérifie si déjà vue
    existing_view = await db.story_views.find_one({
        "story_id": story_id,
        "user_id": current_user["id"]
    })
    
    if not existing_view:
        # Ajoute une vue
        view_id = str(uuid.uuid4())
        await db.story_views.insert_one({
            "id": view_id,
            "story_id": story_id,
            "user_id": current_user["id"],
            "viewed_at": datetime.now(timezone.utc).isoformat()
        })
        
        # Incrémente le compteur de vues
        await db.stories.update_one(
            {"id": story_id},
            {"$inc": {"views_count": 1}}
        )
    
    return {"message": "Story viewed successfully"}

@api_router.delete("/stories/{story_id}")
async def delete_story(story_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime une story"""
    story_raw = await db.stories.find_one({"id": story_id})
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story not found")
    
    story = convert_mongo_doc_to_dict(story_raw)
    if story["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.stories.delete_one({"id": story_id})
    await db.story_views.delete_many({"story_id": story_id})
    
    return {"message": "Story deleted successfully"}

@api_router.get("/stories/{story_id}/viewers")
async def get_story_viewers(story_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère la liste des utilisateurs qui ont vu une story"""
    story_raw = await db.stories.find_one({"id": story_id})
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story not found")
    
    story = convert_mongo_doc_to_dict(story_raw)
    if story["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    views_raw = await db.story_views.find({"story_id": story_id}).to_list(length=1000)
    
    viewers = []
    for view_raw in views_raw:
        view = convert_mongo_doc_to_dict(view_raw)
        user_raw = await db.users.find_one({"id": view["user_id"]})
        if user_raw:
            user = convert_mongo_doc_to_dict(user_raw)
            viewers.append({
                "user_id": user["id"],
                "username": user["username"],
                "profile_pic": user.get("profile_pic"),
                "viewed_at": view["viewed_at"]
            })
    
    return viewers

# ==================== GDPR COMPLIANCE ROUTES ====================

# Models GDPR
class ConsentUpdate(BaseModel):
    consent_type: str  # 'analytics', 'marketing', 'third_party', 'data_sharing'
    consent_given: bool
    ip_address: Optional[str] = None

class PrivacySettings(BaseModel):
    profile_visibility: str  # 'public', 'private', 'friends_only'
    show_email: bool
    show_activity: bool
    allow_tagging: bool
    allow_messaging: str  # 'everyone', 'friends', 'nobody'
    data_retention_days: Optional[int] = 365

@api_router.post("/gdpr/consent/update")
async def update_consent(user_id: str, consent: ConsentUpdate):
    """Met à jour le consentement de l'utilisateur (Article 7 RGPD)"""
    try:
        # Log du consentement
        consent_log = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "consent_type": consent.consent_type,
            "consent_given": consent.consent_given,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "ip_address": consent.ip_address,
            "method": "api_request"
        }
        
        await db.consent_logs.insert_one(consent_log)
        
        # Mettre à jour les paramètres utilisateur
        update_field = f"consents.{consent.consent_type}"
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    update_field: consent.consent_given,
                    "consents.last_updated": datetime.now(timezone.utc).isoformat()
                }
            }
        )
        
        return {
            "message": "Consentement mis à jour",
            "consent_type": consent.consent_type,
            "consent_given": consent.consent_given
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.get("/gdpr/consent/history/{user_id}")
async def get_consent_history(user_id: str):
    """Récupère l'historique des consentements"""
    try:
        history_raw = await db.consent_logs.find({"user_id": user_id}).sort("timestamp", -1).to_list(length=100)
        history = [convert_mongo_doc_to_dict(log) for log in history_raw]
        return {"history": history, "count": len(history)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.get("/gdpr/data/export/{user_id}")
async def export_user_data(user_id: str):
    """Exporte toutes les données de l'utilisateur (Article 20 - Portabilité)"""
    try:
        # Récupérer l'utilisateur
        user_raw = await db.users.find_one({"id": user_id})
        if not user_raw:
            raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
        
        user = convert_mongo_doc_to_dict(user_raw)
        
        # Posts
        posts_raw = await db.posts.find({"author_id": user_id}).to_list(length=1000)
        posts = [convert_mongo_doc_to_dict(p) for p in posts_raw]
        
        # Commentaires
        comments_raw = await db.comments.find({"author_id": user_id}).to_list(length=1000)
        comments = [convert_mongo_doc_to_dict(c) for c in comments_raw]
        
        # Likes
        likes_raw = await db.likes.find({"user_id": user_id}).to_list(length=1000)
        likes = [convert_mongo_doc_to_dict(l) for l in likes_raw]
        
        # Abonnements
        following_raw = await db.follows.find({"follower_id": user_id}).to_list(length=1000)
        following = []
        for follow in following_raw:
            follow_data = convert_mongo_doc_to_dict(follow)
            followed_user = await db.users.find_one({"id": follow_data["followed_id"]})
            if followed_user:
                following.append({
                    "username": followed_user.get("username"),
                    "followed_at": follow_data.get("created_at")
                })
        
        # Abonnés
        followers_raw = await db.follows.find({"followed_id": user_id}).to_list(length=1000)
        followers = []
        for follow in followers_raw:
            follow_data = convert_mongo_doc_to_dict(follow)
            follower_user = await db.users.find_one({"id": follow_data["follower_id"]})
            if follower_user:
                followers.append({
                    "username": follower_user.get("username"),
                    "followed_at": follow_data.get("created_at")
                })
        
        # Données utilisateur (nettoyées)
        user_data = {
            "username": user.get("username"),
            "email": user.get("email"),
            "created_at": user.get("created_at"),
            "bio": user.get("bio"),
            "profile_pic": user.get("profile_pic")
        }
        
        # Export complet
        export_data = {
            "export_date": datetime.now(timezone.utc).isoformat(),
            "user_info": user_data,
            "posts": posts,
            "comments": comments,
            "likes": likes,
            "following": following,
            "followers": followers,
            "statistics": {
                "total_posts": len(posts),
                "total_comments": len(comments),
                "total_likes": len(likes),
                "total_following": len(following),
                "total_followers": len(followers)
            }
        }
        
        return export_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur export: {str(e)}")

@api_router.post("/gdpr/data/deletion-request")
async def request_account_deletion(user_id: str, reason: Optional[str] = None):
    """Demande de suppression de compte (Article 17 - Droit à l'oubli)"""
    try:
        # Vérifier si une demande existe déjà
        existing = await db.deletion_requests.find_one({
            "user_id": user_id,
            "status": {"$in": ["pending", "processing"]}
        })
        
        if existing:
            raise HTTPException(status_code=400, detail="Une demande de suppression est déjà en cours")
        
        # Créer la demande
        request_id = str(uuid.uuid4())
        deletion_request = {
            "id": request_id,
            "user_id": user_id,
            "reason": reason,
            "status": "pending",
            "requested_at": datetime.now(timezone.utc).isoformat(),
            "scheduled_deletion_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
            "completed_at": None
        }
        
        await db.deletion_requests.insert_one(deletion_request)
        
        # Marquer l'utilisateur
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"deletion_scheduled": True, "deletion_request_id": request_id}}
        )
        
        return {
            "request_id": request_id,
            "message": "Demande de suppression enregistrée. Vous avez 30 jours pour annuler.",
            "scheduled_deletion": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.put("/gdpr/privacy/settings")
async def update_privacy_settings(user_id: str, settings: PrivacySettings):
    """Met à jour les paramètres de confidentialité"""
    try:
        settings_doc = {
            "user_id": user_id,
            "profile_visibility": settings.profile_visibility,
            "show_email": settings.show_email,
            "show_activity": settings.show_activity,
            "allow_tagging": settings.allow_tagging,
            "allow_messaging": settings.allow_messaging,
            "data_retention_days": settings.data_retention_days,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        await db.privacy_settings.update_one(
            {"user_id": user_id},
            {"$set": settings_doc},
            upsert=True
        )
        
        # Mettre à jour aussi dans users
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "is_private": settings.profile_visibility == "private",
                "privacy_updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        
        return {"message": "Paramètres de confidentialité mis à jour"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.get("/gdpr/privacy/settings/{user_id}")
async def get_privacy_settings(user_id: str):
    """Récupère les paramètres de confidentialité"""
    try:
        settings_raw = await db.privacy_settings.find_one({"user_id": user_id})
        
        if not settings_raw:
            return {
                "profile_visibility": "public",
                "show_email": False,
                "show_activity": True,
                "allow_tagging": True,
                "allow_messaging": "everyone",
                "data_retention_days": 365
            }
        
        settings = convert_mongo_doc_to_dict(settings_raw)
        return settings
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.get("/gdpr/transparency/data-usage/{user_id}")
async def get_data_usage_info(user_id: str):
    """Informe l'utilisateur de comment ses données sont utilisées"""
    return {
        "data_collection": {
            "profile_data": "Utilisé pour votre profil public et la personnalisation",
            "posts_and_comments": "Partagés publiquement ou selon vos paramètres de confidentialité",
            "likes_and_follows": "Utilisés pour recommandations et statistiques",
            "ip_address": "Enregistrée pour la sécurité et la conformité légale",
            "activity_logs": "Conservés pour la sécurité et l'amélioration du service"
        },
        "data_sharing": {
            "third_parties": "Nous ne partageons pas vos données avec des tiers",
            "analytics": "Données anonymisées pour améliorer le service",
            "legal_requirements": "Partagées uniquement si requis par la loi"
        },
        "data_retention": {
            "active_account": "Conservées tant que votre compte est actif",
            "deleted_account": "Supprimées sous 30 jours après demande",
            "legal_logs": "Logs de sécurité conservés 1 an"
        },
        "your_rights": [
            "Droit d'accès à vos données (Article 15)",
            "Droit de rectification (Article 16)",
            "Droit à l'oubli (Article 17)",
            "Droit à la portabilité (Article 20)",
            "Droit de retirer votre consentement (Article 7)"
        ]
    }

# ==================== LEGAL DOCUMENTS ====================

@app.get("/api/legal/privacy-policy")
async def get_privacy_policy():
    """Politique de confidentialité (RGPD)"""
    return Response(content="""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Politique de Confidentialité - Nexus Social</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: #e2e8f0;
            background: #0f172a;
        }
        h1 { color: #06b6d4; font-size: 2em; }
        h2 { color: #22d3ee; font-size: 1.5em; margin-top: 30px; }
        .date { color: #94a3b8; font-style: italic; }
        .important { background: #1e293b; border-left: 4px solid #06b6d4; padding: 15px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>🔒 Politique de Confidentialité</h1>
    <p class="date">Dernière mise à jour : 21 décembre 2024</p>
    
    <div class="important">
        <strong>📌 En résumé :</strong> Nous respectons votre vie privée. Vos données sont protégées conformément au RGPD.
    </div>

    <h2>1. Responsable du traitement</h2>
    <p><strong>Nexus Social</strong></p>
    <ul>
        <li>Email : privacy@nexussocial.com</li>
        <li>DPO : dpo@nexussocial.com</li>
    </ul>

    <h2>2. Vos droits RGPD</h2>
    <p>Vous avez le droit de :</p>
    <ul>
        <li>📄 Accéder à vos données (Article 15)</li>
        <li>✏️ Rectifier vos données (Article 16)</li>
        <li>🗑️ Supprimer vos données (Article 17)</li>
        <li>📦 Exporter vos données (Article 20)</li>
        <li>🚫 Vous opposer au traitement (Article 21)</li>
    </ul>

    <p>Pour exercer vos droits : <strong>Centre de confidentialité</strong> ou <strong>dpo@nexussocial.com</strong></p>
    
    <h2>3. Contact</h2>
    <p>Questions ? <a href="mailto:privacy@nexussocial.com" style="color: #06b6d4;">privacy@nexussocial.com</a></p>
    
    <footer style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #334155; color: #94a3b8; text-align: center;">
        <p>© 2024 Nexus Social - Tous droits réservés</p>
    </footer>
</body>
</html>
    """, media_type="text/html")

@app.get("/api/legal/terms-of-service")
async def get_terms_of_service():
    """Conditions d'utilisation"""
    return Response(content="""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CGU - Nexus Social</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: #e2e8f0;
            background: #0f172a;
        }
        h1 { color: #06b6d4; }
        h2 { color: #22d3ee; }
    </style>
</head>
<body>
    <h1>📜 Conditions d'Utilisation</h1>
    <p>En utilisant Nexus Social, vous acceptez ces conditions.</p>
    <h2>Contenu interdit</h2>
    <ul>
        <li>❌ Contenus illégaux</li>
        <li>❌ Harcèlement</li>
        <li>❌ Spam</li>
    </ul>
    <p>Contact : <a href="mailto:legal@nexussocial.com" style="color: #06b6d4;">legal@nexussocial.com</a></p>
</body>
</html>
    """, media_type="text/html")

@app.get("/api/legal/cookie-policy")
async def get_cookie_policy():
    """Politique des cookies"""
    return Response(content="""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cookies - Nexus Social</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: #e2e8f0;
            background: #0f172a;
        }
        h1 { color: #06b6d4; }
    </style>
</head>
<body>
    <h1>🍪 Politique des Cookies</h1>
    <p>Nous utilisons uniquement des cookies essentiels pour le fonctionnement du site.</p>
    <p>❌ Pas de cookies publicitaires</p>
    <p>❌ Pas de tracking tiers</p>
</body>
</html>
    """, media_type="text/html")



# ==================== ENHANCED FEATURES - ADDED BY MERGE SCRIPT ====================

# ==================== ENUMS ====================

class BadgeType(str, Enum):
    EARLY_ADOPTER = "early_adopter"
    VETERAN = "veteran"
    INFLUENCER = "influencer"
    VERIFIED = "verified"
    TOP_CONTRIBUTOR = "top_contributor"
    COMMENTATOR = "commentator"
    SOCIAL_BUTTERFLY = "social_butterfly"
    PHOTOGRAPHER = "photographer"
    STORYTELLER = "storyteller"
    VERIFIED_EMAIL = "verified_email"

class ReactionType(str, Enum):
    LIKE = "like"
    LOVE = "love"
    HAHA = "haha"
    WOW = "wow"
    SAD = "sad"
    ANGRY = "angry"
    FIRE = "fire"
    CLAP = "clap"

class PrivacyLevel(str, Enum):
    PUBLIC = "public"
    FOLLOWERS = "followers"
    FRIENDS = "friends"
    NOBODY = "nobody"

class ReportReason(str, Enum):
    SPAM = "spam"
    HARASSMENT = "harassment"
    HATE_SPEECH = "hate_speech"
    VIOLENCE = "violence"
    NUDITY = "nudity"
    FALSE_INFO = "false_info"

# ==================== CONSTANTS ====================

BADGES_METADATA = {
    BadgeType.EARLY_ADOPTER: {"name": "Early Adopter", "icon": "🚀", "points": 100},
    BadgeType.VETERAN: {"name": "Vétéran", "icon": "⭐", "points": 50},
    BadgeType.INFLUENCER: {"name": "Influenceur", "icon": "👑", "points": 200},
    BadgeType.VERIFIED: {"name": "Vérifié", "icon": "✓", "points": 150},
    BadgeType.TOP_CONTRIBUTOR: {"name": "Top Contributeur", "icon": "📝", "points": 30},
    BadgeType.VERIFIED_EMAIL: {"name": "Email Vérifié", "icon": "📧", "points": 10},
}

REACTION_EMOJIS = {
    ReactionType.LIKE: "❤️",
    ReactionType.LOVE: "😍",
    ReactionType.HAHA: "😂",
    ReactionType.WOW: "😮",
    ReactionType.SAD: "😢",
    ReactionType.ANGRY: "😡",
    ReactionType.FIRE: "🔥",
    ReactionType.CLAP: "👏"
}

LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500]
XP_REWARDS = {"post_created": 10, "post_liked": 2, "comment_created": 5, "story_created": 3}

# ==================== HELPER FUNCTIONS ====================

def get_timestamp_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

def extract_hashtags(text: str) -> List[str]:
    return re.findall(r'#(\w+)', text)

# ==================== GAMIFICATION ====================

class LevelingSystem:
    async def add_xp(self, user_id: str, amount: int, reason: str) -> dict:
        user = await db.users.find_one({"id": user_id})
        current_xp = user.get("xp", 0)
        new_xp = current_xp + amount
        
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"xp": new_xp}}
        )
        
        return {"xp_gained": amount, "total_xp": new_xp}

class GamificationEngine:
    async def check_and_award_badges(self, user_id: str):
        user = await db.users.find_one({"id": user_id})
        current_badges = user.get("badges", [])
        new_badges = []
        
        if user.get("email_verified") and BadgeType.VERIFIED_EMAIL not in current_badges:
            new_badges.append(BadgeType.VERIFIED_EMAIL)
        
        posts_count = await db.posts.count_documents({"author_id": user_id})
        if posts_count >= 100 and BadgeType.TOP_CONTRIBUTOR not in current_badges:
            new_badges.append(BadgeType.TOP_CONTRIBUTOR)
        
        if new_badges:
            await db.users.update_one(
                {"id": user_id},
                {"$push": {"badges": {"$each": new_badges}}}
            )
        
        return new_badges

# ==================== REACTIONS SYSTEM ====================

@api_router.post("/posts/{post_id}/react")
async def react_to_post(
    post_id: str,
    reaction_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    reaction_type = reaction_data.get("reaction_type")
    if reaction_type not in [r.value for r in ReactionType]:
        raise HTTPException(400, "Invalid reaction type")
    
    existing = await db.reactions.find_one({
        "user_id": current_user["id"],
        "post_id": post_id
    })
    
    if existing:
        await db.reactions.update_one(
            {"id": existing["id"]},
            {"$set": {"reaction_type": reaction_type}}
        )
    else:
        await db.reactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "post_id": post_id,
            "reaction_type": reaction_type,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    await update_post_reaction_counts(post_id)
    return {"success": True}

@api_router.delete("/posts/{post_id}/react")
async def remove_reaction(post_id: str, current_user: dict = Depends(get_current_user)):
    await db.reactions.delete_one({"user_id": current_user["id"], "post_id": post_id})
    await update_post_reaction_counts(post_id)
    return {"success": True}

@api_router.get("/posts/{post_id}/reactions")
async def get_post_reactions(post_id: str, current_user: dict = Depends(get_current_user)):
    reactions = await db.reactions.find({"post_id": post_id}).to_list(length=1000)
    
    by_type = {}
    for reaction in reactions:
        rtype = reaction["reaction_type"]
        if rtype not in by_type:
            by_type[rtype] = []
        by_type[rtype].append(reaction["user_id"])
    
    reaction_counts = {
        rtype: {"count": len(user_ids), "emoji": REACTION_EMOJIS[rtype]}
        for rtype, user_ids in by_type.items()
    }
    
    user_reaction = next(
        (r["reaction_type"] for r in reactions if r["user_id"] == current_user["id"]),
        None
    )
    
    return {"success": True, "reactions": reaction_counts, "user_reaction": user_reaction}

async def update_post_reaction_counts(post_id: str):
    reactions = await db.reactions.find({"post_id": post_id}).to_list(length=10000)
    counts = {}
    for reaction in reactions:
        rtype = reaction["reaction_type"]
        counts[rtype] = counts.get(rtype, 0) + 1
    
    await db.posts.update_one(
        {"id": post_id},
        {"$set": {"reactions": counts, "total_reactions": len(reactions)}}
    )

# ==================== GAMIFICATION ENDPOINTS ====================

@api_router.get("/gamification/badges")
async def get_user_badges(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["id"]})
    badges = user.get("badges", [])
    badge_details = [{"type": badge, **BADGES_METADATA.get(badge, {})} for badge in badges]
    return {"success": True, "badges": badge_details}

@api_router.post("/gamification/check-badges")
async def check_badges(current_user: dict = Depends(get_current_user)):
    engine = GamificationEngine()
    new_badges = await engine.check_and_award_badges(current_user["id"])
    return {"success": True, "new_badges": [{"type": b, **BADGES_METADATA[b]} for b in new_badges]}

@api_router.get("/gamification/level")
async def get_user_level(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["id"]})
    return {"success": True, "level": user.get("level", 1), "xp": user.get("xp", 0)}

# ==================== PRIVACY ENDPOINTS ====================

@api_router.get("/privacy/settings")
async def get_privacy_settings(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["id"]})
    privacy = user.get("privacy_settings", {})
    default_privacy = {
        "profile_visibility": "public",
        "who_can_message": "everyone",
        "blocked_users": []
    }
    return {"success": True, "privacy_settings": {**default_privacy, **privacy}}

@api_router.post("/privacy/block")
async def block_user(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    blocked_id = data["user_id"]
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$addToSet": {"privacy_settings.blocked_users": blocked_id}}
    )
    return {"success": True}

# ==================== REPORTING ENDPOINTS ====================

@api_router.post("/reports")
async def create_report(report_data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    report_id = str(uuid.uuid4())
    report = {
        "id": report_id,
        "reporter_id": current_user["id"],
        "reported_content_id": report_data.get("reported_content_id"),
        "content_type": report_data["content_type"],
        "reason": report_data["reason"],
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.reports.insert_one(report)
    return {"success": True, "report_id": report_id}

# ==================== NOTIFICATIONS ====================

async def create_notification(user_id: str, type: str, content: str, metadata: dict = None):
    notification_id = str(uuid.uuid4())
    await db.notifications.insert_one({
        "id": notification_id,
        "user_id": user_id,
        "type": type,
        "content": content,
        "metadata": metadata or {},
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    return notification_id

@api_router.get("/notifications")
async def get_notifications(limit: int = 20, current_user: dict = Depends(get_current_user)):
    notifications = await db.notifications.find(
        {"user_id": current_user["id"]}
    ).sort("created_at", -1).limit(limit).to_list(length=limit)
    return {"success": True, "notifications": [convert_mongo_doc_to_dict(n) for n in notifications]}

# ==================== BROWSER (NAVIGATEUR) ====================

@api_router.get("/browser/bookmarks")
async def get_bookmarks(current_user: dict = Depends(get_current_user)):
    """Récupérer les signets de l'utilisateur"""
    bookmarks = await db.browser_bookmarks.find(
        {"user_id": current_user["id"]}
    ).sort("timestamp", -1).to_list(length=1000)
    return {"success": True, "bookmarks": [convert_mongo_doc_to_dict(b) for b in bookmarks]}

@api_router.post("/browser/bookmarks")
async def add_bookmark(
    bookmark_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Ajouter un signet"""
    bookmark_id = str(uuid.uuid4())
    bookmark = {
        "id": bookmark_id,
        "user_id": current_user["id"],
        "url": bookmark_data.get("url"),
        "title": bookmark_data.get("title", bookmark_data.get("url")),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.browser_bookmarks.insert_one(bookmark)
    return {"success": True, "bookmark": convert_mongo_doc_to_dict(bookmark)}

@api_router.delete("/browser/bookmarks/{bookmark_id}")
async def delete_bookmark(
    bookmark_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Supprimer un signet"""
    result = await db.browser_bookmarks.delete_one({
        "id": bookmark_id,
        "user_id": current_user["id"]
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Signet non trouvé")
    return {"success": True}

@api_router.get("/browser/history")
async def get_history(
    limit: int = Query(100, le=1000),
    current_user: dict = Depends(get_current_user)
):
    """Récupérer l'historique de navigation"""
    history = await db.browser_history.find(
        {"user_id": current_user["id"]}
    ).sort("timestamp", -1).limit(limit).to_list(length=limit)
    return {"success": True, "history": [convert_mongo_doc_to_dict(h) for h in history]}

@api_router.post("/browser/history")
async def add_history(
    history_data: dict = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Ajouter à l'historique"""
    history_id = str(uuid.uuid4())
    history_item = {
        "id": history_id,
        "user_id": current_user["id"],
        "url": history_data.get("url"),
        "title": history_data.get("title", history_data.get("url")),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.browser_history.insert_one(history_item)

    # Limiter l'historique à 1000 entrées par utilisateur
    count = await db.browser_history.count_documents({"user_id": current_user["id"]})
    if count > 1000:
        # Supprimer les plus anciennes entrées
        old_entries = await db.browser_history.find(
            {"user_id": current_user["id"]}
        ).sort("timestamp", 1).limit(count - 1000).to_list(length=count - 1000)
        old_ids = [entry["id"] for entry in old_entries]
        await db.browser_history.delete_many({"id": {"$in": old_ids}})

    return {"success": True, "history_item": convert_mongo_doc_to_dict(history_item)}

@api_router.delete("/browser/history")
async def clear_history(current_user: dict = Depends(get_current_user)):
    """Effacer tout l'historique"""
    await db.browser_history.delete_many({"user_id": current_user["id"]})
    return {"success": True}

# ==================== RECHERCHE & TENDANCES (RÉELLES) ====================

@api_router.get("/search/posts", response_model=List[Post])
async def search_posts(q: str, current_user: dict = Depends(get_current_user)):
    """
    Recherche de publications par contenu ou hashtag.
    Une requête commençant par '#' filtre sur le hashtag exact.
    """
    query = (q or "").strip()
    if not query:
        return []

    # Recherche par hashtag (#python) ou texte libre
    term = query.lstrip("#")
    regex = {"$regex": re.escape(term), "$options": "i"}

    posts_raw = await db.posts.find(
        {"content": regex}
    ).sort("created_at", -1).limit(50).to_list(length=50)

    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        posts.append(Post(**post))

    return posts


async def compute_trending_hashtags(limit: int = 10):
    """
    Calcule les hashtags tendance EN DIRECT à partir des vraies publications.
    Score = (#posts 24h * 3) + (#posts 7j) + (likes * 0.1)
    Aucun cron requis : la tendance reflète toujours l'état réel de la base.
    """
    now = datetime.now(timezone.utc)
    since_7d = (now - timedelta(days=7)).isoformat()
    since_24h = (now - timedelta(hours=24)).isoformat()

    recent_posts = await db.posts.find(
        {"created_at": {"$gte": since_7d}}
    ).sort("created_at", -1).limit(3000).to_list(length=3000)

    stats: Dict[str, dict] = {}
    for post in recent_posts:
        content = post.get("content") or ""
        created = post.get("created_at", "")
        likes = post.get("likes_count", 0) or 0

        seen = set()
        for raw_tag in re.findall(r'#(\w+)', content):
            key = raw_tag.lower()
            if key in seen:
                continue
            seen.add(key)
            entry = stats.setdefault(key, {"display": raw_tag, "count": 0, "count24": 0, "likes": 0})
            entry["count"] += 1
            entry["likes"] += likes
            if created >= since_24h:
                entry["count24"] += 1

    trending = []
    for key, entry in stats.items():
        score = (entry["count24"] * 3.0) + (entry["count"] * 1.0) + (entry["likes"] * 0.1)
        trending.append({
            "tag": f"#{entry['display']}",
            "normalized": key,
            "post_count": entry["count"],
            "posts_24h": entry["count24"],
            "likes": entry["likes"],
            "score": round(score, 2),
        })

    trending.sort(key=lambda x: x["score"], reverse=True)
    return trending[:limit]


@api_router.get("/trending/hashtags")
async def get_trending_hashtags(
    limit: int = Query(10, ge=1, le=50),
    current_user: dict = Depends(get_current_user)
):
    """Hashtags tendance calculés en direct depuis les publications réelles."""
    trending = await compute_trending_hashtags(limit)
    return {"success": True, "trending": trending}


@api_router.get("/hashtags/{tag}/posts", response_model=List[Post])
async def get_posts_by_hashtag(tag: str, current_user: dict = Depends(get_current_user)):
    """Récupère les publications contenant un hashtag donné."""
    normalized = tag.lower().lstrip("#")
    # \b ne marche pas après #, on cherche '#tag' suivi d'une limite de mot
    regex = {"$regex": rf"#{re.escape(normalized)}\b", "$options": "i"}

    posts_raw = await db.posts.find({"content": regex}).sort("created_at", -1).limit(50).to_list(length=50)

    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        posts.append(Post(**post))

    return posts


@api_router.get("/clips", response_model=List[Post])
async def get_clips_feed(current_user: dict = Depends(get_current_user)):
    """
    Fil Nexus Clips : uniquement les publications vidéo, de tout le monde,
    triées par popularité récente (comme un vrai fil de courtes vidéos).
    """
    videos_raw = await db.posts.find(
        {"media_type": "video", "media_url": {"$ne": None}}
    ).sort("created_at", -1).limit(100).to_list(length=100)

    clips = []
    for post_raw in videos_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        # Ignorer les comptes désactivés
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        clips.append(Post(**post))

    # Tri par engagement récent : likes + commentaires, puis date
    clips.sort(key=lambda p: (p.likes_count + p.comments_count), reverse=True)
    return clips

# ==================== END ENHANCED FEATURES ====================

# ==================== FOLLOW SYSTEM INTEGRATION ====================
# Injecter la database dans le module follows
if set_database is not None:
    set_database(db)
    print("✅ Follow system database injected")

# Inclure le router des follows
if follow_router is not None:
    app.include_router(follow_router)
    print("✅ Follow system router registered")

# ==================== NEXUS MAIL INTEGRATION ====================
if set_mail_database is not None:
    set_mail_database(db)
    print("✅ Nexus Mail database injected")

if mail_router is not None:
    app.include_router(mail_router)
    print("✅ Nexus Mail router registered")

# Inclure le routeur principal
app.include_router(api_router)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Event handlers
@app.on_event("startup")
async def startup_db_client():
    """Vérifie la connexion MongoDB au démarrage"""
    try:
        await client.admin.command('ping')
        logger.info("✅ MongoDB connection successful")
    except Exception as e:
        logger.error(f"❌ MongoDB connection failed: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_db_client():
    """Ferme la connexion MongoDB à l'arrêt"""
    client.close()
    logger.info("MongoDB connection closed")
