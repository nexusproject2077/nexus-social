# app/backend/server.py
import sys
from pathlib import Path
# Cette ligne magique règle TOUT le problème Render
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import InvalidURI, ConnectionFailure
import os
import logging
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt
import base64
from bson import ObjectId

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
    """Récupère le feed de posts"""
    # Récupère les utilisateurs suivis
    follows_raw = await db.follows.find({"follower_id": current_user["id"]}).to_list(length=100)
    followed_user_ids = [convert_mongo_doc_to_dict(f)["following_id"] for f in follows_raw]
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
        is_following_raw = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user["id"]})
        users.append(UserProfile(
            id=user["id"],
            username=user["username"],
            bio=user.get("bio", ""),
            profile_pic=user.get("profile_pic"),
            followers_count=user.get("followers_count", 0),
            following_count=user.get("following_count", 0),
            is_following=bool(is_following_raw),
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
    is_following_raw = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user_id})
    
    return UserProfile(
        id=user["id"],
        username=user["username"],
        bio=user.get("bio", ""),
        profile_pic=user.get("profile_pic"),
        followers_count=user.get("followers_count", 0),
        following_count=user.get("following_count", 0),
        is_following=bool(is_following_raw),
        created_at=user["created_at"]
    )

@api_router.get("/users/{user_id}/posts", response_model=List[Post])
async def get_user_posts(user_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les posts d'un utilisateur"""
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
    await db.follows.delete_many({"$or": [{"follower_id": user_id}, {"following_id": user_id}]})
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
    
    existing_follow_raw = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user_id})
    
    if existing_follow_raw:
        # Unfollow
        await db.follows.delete_one({"follower_id": current_user["id"], "following_id": user_id})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": -1}})
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": -1}})
        return {"following": False}
    else:
        # Follow
        follow_id = str(uuid.uuid4())
        await db.follows.insert_one({
            "id": follow_id,
            "follower_id": current_user["id"],
            "following_id": user_id,
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
        is_following_raw = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user["id"]})
        users.append(UserProfile(
            id=user["id"],
            username=user["username"],
            bio=user.get("bio", ""),
            profile_pic=user.get("profile_pic"),
            followers_count=user.get("followers_count", 0),
            following_count=user.get("following_count", 0),
            is_following=bool(is_following_raw),
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
async def create_story(story_data: StoryCreate, current_user: dict = Depends(get_current_user)):
    """Créer une nouvelle story"""
    story_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=24)
    
    story_to_insert = {
        "id": story_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "media_type": story_data.media_type,
        "media_url": story_data.media_url,
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
    followed_user_ids = [convert_mongo_doc_to_dict(f)["following_id"] for f in follows_raw]
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
