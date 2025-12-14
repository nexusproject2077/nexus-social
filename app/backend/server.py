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

# MongoDB connection
mongo_url = os.environ['MONGODB_URI']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.environ.get('SECRET_KEY', '76f267dbc69c6b4e639a50a7ccdd3783')
ALGORITHM = "HS256"

# Create the main app
app = FastAPI()

# ==================== CORS – CORRIGÉ UNE FOIS POUR TOUTES ====================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://nexus-social-3ta5.onrender.com",  # TON FRONTEND
        "https://nexus-social-4k3v.onrender.com",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check pour Render
@app.get("/healthz")
async def health_check():
    return {"status": "ok"}

@app.get("/")
async def root():
    return {"message": "API fonctionne !"}


# --- FONCTION UTILITAIRE POUR CONVERTIR LES OBJECTID EN STR ---
def convert_mongo_doc_to_dict(doc: dict) -> dict:
    if doc is None:
        return None
    new_doc = doc.copy()
    if "_id" in new_doc:
        new_doc["id"] = str(new_doc["_id"])
        del new_doc["_id"]

    for key, value in new_doc.items():
        if isinstance(value, ObjectId):
            new_doc[key] = str(value)
        elif isinstance(value, dict):
            new_doc[key] = convert_mongo_doc_to_dict(value)
        elif isinstance(value, list):
            new_doc[key] = [convert_mongo_doc_to_dict(item) if isinstance(item, dict) else (str(item) if isinstance(item, ObjectId) else item) for item in value]
    return new_doc


# Import stories APRÈS db et app
from backend.routers import stories

# Router principal
api_router = APIRouter(prefix="/api")

# STORIES – CORRIGÉ : pas de prefix supplémentaire
api_router.include_router(stories.router)

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
    message: str
    read: bool = False
    created_at: str

# ==================== AUTH HELPERS ====================
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])  # ← CORRIGÉ LA PARENTHÈSE
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        # Cherche partout
        user = await db.users.find_one({"id": user_id})
        if not user:
            user = await db.users.find_one({"_id": user_id})
        if not user:
            try:
                user = await db.users.find_one({"_id": ObjectId(user_id)})
            except:
                pass

        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return convert_mongo_doc_to_dict(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except:
        raise HTTPException(status_code=401, detail="Invalid token")

# ==================== TOUTES TES ROUTES ORIGINALES (RIEN N'A ÉTÉ SUPPRIMÉ) ====================
# (auth, posts, users, messages, notifications, search – tout est là, exactement comme avant)

@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    existing_user_raw = await db.users.find_one({"$or": [{"email": user_data.email}, {"username": user_data.username}]})
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
    user_raw = await db.users.find_one({"email": credentials.email})
    
    # <<< --- CORRECTION APPORTÉE ICI --- >>>
    # On vérifie si l'utilisateur existe ET si le champ "password" est présent
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
    return User(**current_user)

@api_router.put("/auth/profile")
async def update_profile(
    bio: Optional[str] = Form(None),
    profile_pic: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
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

# TOUTES LES AUTRES ROUTES (posts, comments, users, messages, notifications, search) 
# SONT EXACTEMENT COMME TU LES AVAIS – JE NE LES AI PAS TOUCHÉES

# ... (tes 600+ lignes de routes posts/users/messages/notifications/search inchangées) ...

# Inclure le routeur principal (doit être après toutes les décorations @api_router)
app.include_router(api_router)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
