# app/backend/server.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import uuid
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
import jwt
import base64
from bson import ObjectId
from typing import List, Optional
from pydantic import BaseModel, EmailStr, ConfigDict

# ==================== ENV & DB ====================
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ==================== SECURITY ====================
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.environ.get('SECRET_KEY', '76f267dbc69c6b4e639a50a7ccdd3783')
ALGORITHM = "HS256"

# ==================== APP ====================
app = FastAPI()

# ==================== CORS ====================
# CORS – VERSION PARFAITE QUI MARCHE À 100%
from starlette.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://nexus-social-3ta5.onrender.com",  # TON FRONTEND (OBLIGATOIRE)
        "https://nexus-social-4k3v.onrender.com",  # ton backend
        "http://localhost:3000",                   # dev local
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

@app.get("/healthz")
async def health_check():
    return {"status": "ok"}

# ==================== UTILS ====================
def convert_mongo_doc_to_dict(doc: dict) -> dict:
    if not doc:
        return None
    new_doc = doc.copy()
    if "_id" in new_doc:
        new_doc["id"] = str(new_doc["_id"])
        del new_doc["_id"]
    for k, v in new_doc.items():
        if isinstance(v, ObjectId):
            new_doc[k] = str(v)
        elif isinstance(v, dict):
            new_doc[k] = convert_mongo_doc_to_dict(v)
        elif isinstance(v, list):
            new_doc[k] = [convert_mongo_doc_to_dict(i) if isinstance(i, dict) else str(i) if isinstance(i, ObjectId) else i for i in v]
    return new_doc

def create_access_token(data: dict):
    to_encode = data.copy()
    to_encode.update({"exp": datetime.now(timezone.utc) + timedelta(days=7)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# ==================== AUTH – FIXÉ LA PARENTHÈSE ====================
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])  # ← CORRIGÉ ICI
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401)

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
    except:
        raise HTTPException(status_code=401, detail="Invalid token")

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

class CommentCreate(BaseModel):
    content: str

# ==================== ROUTERS ====================
from backend.routers import stories

api_router = APIRouter(prefix="/api")
api_router.include_router(stories.router)

# ==================== AUTH ====================
@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    if await db.users.find_one({"$or": [{"email": user_data.email}, {"username": user_data.username}]}):
        raise HTTPException(status_code=400, detail="Exists")
    hashed = pwd_context.hash(user_data.password)
    user_id = str(uuid.uuid4())
    await db.users.insert_one({
        "id": user_id, "username": user_data.username, "email": user_data.email,
        "password": hashed, "bio": user_data.bio or "", "profile_pic": None,
        "followers_count": 0, "following_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    token = create_access_token({"sub": user_id})
    return {"token": token, "user": {"id": user_id, "username": user_data.username}}

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email})
    if not user or not pwd_context.verify(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user_dict = convert_mongo_doc_to_dict(user)
    token = create_access_token({"sub": user_dict["id"]})
    return {"token": token, "user": user_dict}

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: dict = Depends(get_current_user)):
    return User(**current_user)

# ==================== POSTS & FEED ====================
@api_router.get("/posts/feed", response_model=List[dict])
async def get_feed(current_user: dict = Depends(get_current_user)):
    posts = await db.posts.find({}).sort("created_at", -1).to_list(100)
    return [convert_mongo_doc_to_dict(p) for p in posts]

# ==================== ATTACHE TOUT ====================
app.include_router(api_router)

@app.on_event("shutdown")
async def shutdown():
    client.close()

