import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form
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

# Load env
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.environ.get('SECRET_KEY', '76f267dbc69c6b4e639a50a7ccdd3783')
ALGORITHM = "HS256"

app = FastAPI()

# CORS – AUTORISE TON FRONTEND À PARLER AU BACKEND
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://nexus-social-3ta5.onrender.com",   # TON FRONTEND (OBLIGATOIRE)
        "https://nexus-social-4k3v.onrender.com",   # ton backend (déjà là)
        "http://localhost:3000",                    # dev local
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
async def health_check():
    return {"status": "ok"}

@app.get("/")
async def root():
    return {"message": "Nexus Social API – 2025"}

# Convert ObjectId → str
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

# Auth – fixe pour anciens/nouveaux utilisateurs
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Cherche dans "id" (nouveaux), "_id" string, ou ObjectId (anciens)
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

# Models
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

class Comment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    post_id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    content: str
    created_at: str

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

# Routers
from backend.routers import stories

api_router = APIRouter(prefix="/api")
api_router.include_router(stories.router)  # → /api/stories/

app.include_router(api_router)

# Auth routes
@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    if await db.users.find_one({"$or": [{"email": user_data.email}, {"username": user_data.username}]}):
        raise HTTPException(status_code=400, detail="Email or username already registered")

    hashed = pwd_context.hash(user_data.password)
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "username": user_data.username,
        "email": user_data.email,
        "password": hashed,
        "bio": user_data.bio or "",
        "profile_pic": None,
        "followers_count": 0,
        "following_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    token = create_access_token({"sub": user_id})
    return {"token": token, "user": user_doc}

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email})
    if not user or not pwd_context.verify(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_dict = convert_mongo_doc_to_dict(user)
    token = create_access_token({"sub": user_dict["id"]})
    return {"token": token, "user": user_dict}

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
    
    updated_user = await db.users.find_one({"id": current_user["id"]})
    return User(**convert_mongo_doc_to_dict(updated_user))

# Post routes
@api_router.post("/posts", response_model=Post)
async def create_post(
    content: str = Form(...),
    media: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    media_type = None
    media_url = None
    
    if media:
        contents = await media.read()
        base64_media = base64.b64encode(contents).decode('utf-8')
        media_url = f"data:{media.content_type};base64,{base64_media}"
        media_type = "image" if media.content_type.startswith('image') else "video"
    
    post_id = str(uuid.uuid4())
    post_doc = {
        "id": post_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "content": content,
        "media_type": media_type,
        "media_url": media_url,
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.posts.insert_one(post_doc)
    
    post_dict = convert_mongo_doc_to_dict(post_doc)
    post_response = Post(**post_dict)
    post_response.is_liked = False
    return post_response

@api_router.get("/posts/feed", response_model=List[Post])
async def get_feed(current_user: dict = Depends(get_current_user)):
    follows = await db.follows.find({"follower_id": current_user["id"]}).to_list(1000)
    following_ids = [f["following_id"] for f in follows] + [current_user["id"]]

    posts_raw = await db.posts.find({"author_id": {"$in": following_ids}}).sort("created_at", -1).to_list(100)
    
    liked_posts = await db.likes.find({"user_id": current_user["id"]}).to_list(1000)
    liked_post_ids = {like["post_id"] for like in liked_posts}

    result = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        post_obj = Post(**post)
        post_obj.is_liked = post["id"] in liked_post_ids
        result.append(post_obj)
    
    return result

@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(post_id: str, current_user: dict = Depends(get_current_user)):
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    
    post = convert_mongo_doc_to_dict(post_raw)
    like = await db.likes.find_one({"user_id": current_user["id"], "post_id": post_id})
    post_obj = Post(**post)
    post_obj.is_liked = like is not None
    return post_obj

@api_router.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user)):
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")

    existing_like = await db.likes.find_one({"user_id": current_user["id"], "post_id": post_id})
    
    if existing_like:
        await db.likes.delete_one({"user_id": current_user["id"], "post_id": post_id})
        await db.posts.update_one({"id": post_id}, {"$inc": {"likes_count": -1}})
        return {"liked": False}
    else:
        await db.likes.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "post_id": post_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        await db.posts.update_one({"id": post_id}, {"$inc": {"likes_count": 1}})
        
        if post_raw["author_id"] != current_user["id"]:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": post_raw["author_id"],
                "type": "like",
                "from_user_id": current_user["id"],
                "from_username": current_user["username"],
                "from_profile_pic": current_user.get("profile_pic"),
                "post_id": post_id,
                "message": f"{current_user['username']} a aimé votre publication",
                "read": False,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        
        return {"liked": True}

@api_router.post("/posts/{post_id}/share")
async def share_post(post_id: str, current_user: dict = Depends(get_current_user)):
    original_post_raw = await db.posts.find_one({"id": post_id})
    if not original_post_raw:
        raise HTTPException(status_code=404, detail="Post not found")

    original_post = convert_mongo_doc_to_dict(original_post_raw)
    
    shared_post_id = str(uuid.uuid4())
    shared_post = {
        "id": shared_post_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "content": f"Partagé de @{original_post['author_username']}: {original_post['content']}",
        "media_type": original_post.get("media_type"),
        "media_url": original_post.get("media_url"),
        "original_post_id": post_id,
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.posts.insert_one(shared_post)
    
    await db.posts.update_one({"id": post_id}, {"$inc": {"shares_count": 1}})
    
    if original_post["author_id"] != current_user["id"]:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": original_post["author_id"],
            "type": "share",
            "from_user_id": current_user["id"],
            "from_username": current_user["username"],
            "from_profile_pic": current_user.get("profile_pic"),
            "post_id": post_id,
            "message": f"{current_user['username']} a partagé votre publication",
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    return {"message": "Post shared successfully", "post_id": shared_post_id}

@api_router.delete("/posts/{post_id}")
async def delete_post(post_id: str, current_user: dict = Depends(get_current_user)):
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    
    post = convert_mongo_doc_to_dict(post_raw)
    if post["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.posts.delete_one({"id": post_id})
    await db.comments.delete_many({"post_id": post_id})
    await db.likes.delete_many({"post_id": post_id})
    return {"message": "Post deleted successfully"}

# Comment routes
@api_router.post("/posts/{post_id}/comments", response_model=Comment)
async def create_comment(post_id: str, comment_data: CommentCreate, current_user: dict = Depends(get_current_user)):
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")
    
    post = convert_mongo_doc_to_dict(post_raw)
    
    comment_id = str(uuid.uuid4())
    comment = {
        "id": comment_id,
        "post_id": post_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "content": comment_data.content,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.comments.insert_one(comment)
    await db.posts.update_one({"id": post_id}, {"$inc": {"comments_count": 1}})
    
    if post["author_id"] != current_user["id"]:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": post["author_id"],
            "type": "comment",
            "from_user_id": current_user["id"],
            "from_username": current_user["username"],
            "from_profile_pic": current_user.get("profile_pic"),
            "post_id": post_id,
            "message": f"{current_user['username']} a commenté votre publication",
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    return Comment(**comment)

@api_router.get("/posts/{post_id}/comments", response_model=List[Comment])
async def get_comments(post_id: str, current_user: dict = Depends(get_current_user)):
    comments_raw = await db.comments.find({"post_id": post_id}).sort("created_at", -1).to_list(1000)
    return [Comment(**convert_mongo_doc_to_dict(c)) for c in comments_raw]

# User routes
@api_router.get("/users/search")
async def search_users(q: str, current_user: dict = Depends(get_current_user)):
    if not q:
        return []
    
    users_raw = await db.users.find(
        {"$or": [
            {"username": {"$regex": q, "$options": "i"}},
            {"bio": {"$regex": q, "$options": "i"}}
        ]}
    ).limit(20).to_list(20)
    
    return [UserProfile(**convert_mongo_doc_to_dict(u)) for u in users_raw]

@api_router.get("/users/{user_id}", response_model=UserProfile)
async def get_user_profile(user_id: str, current_user: dict = Depends(get_current_user)):
    user_raw = await db.users.find_one({"id": user_id})
    if not user_raw:
        raise HTTPException(status_code=404, detail="User not found")
    
    user = convert_mongo_doc_to_dict(user_raw)
    follow = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user_id})
    
    profile = UserProfile(**user)
    profile.is_following = follow is not None
    return profile

@api_router.get("/users/{user_id}/posts", response_model=List[Post])
async def get_user_posts(user_id: str, current_user: dict = Depends(get_current_user)):
    posts_raw = await db.posts.find({"author_id": user_id}).sort("created_at", -1).to_list(100)
    
    liked_posts_raw = await db.likes.find({"user_id": current_user["id"]}).to_list(1000)
    liked_post_ids = {like["post_id"] for like in [convert_mongo_doc_to_dict(l) for l in liked_posts_raw]}
    
    result = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        post_obj = Post(**post)
        post_obj.is_liked = post["id"] in liked_post_ids
        result.append(post_obj)
    
    return result

@api_router.post("/users/{user_id}/follow")
async def follow_user(user_id: str, current_user: dict = Depends(get_current_user)):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    target_user_raw = await db.users.find_one({"id": user_id})
    if not target_user_raw:
        raise HTTPException(status_code=404, detail="User not found")
    
    existing_follow = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user_id})
    
    if existing_follow:
        await db.follows.delete_one({"follower_id": current_user["id"], "following_id": user_id})
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": -1}})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": -1}})
        return {"following": False}
    else:
        await db.follows.insert_one({
            "id": str(uuid.uuid4()),
            "follower_id": current_user["id"],
            "following_id": user_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": 1}})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": 1}})
        
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "follow",
            "from_user_id": current_user["id"],
            "from_username": current_user["username"],
            "from_profile_pic": current_user.get("profile_pic"),
            "post_id": None,
            "message": f"{current_user['username']} vous suit maintenant",
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        return {"following": True}

# Message routes
@api_router.post("/messages", response_model=Message)
async def send_message(message_data: MessageCreate, current_user: dict = Depends(get_current_user)):
    recipient_raw = await db.users.find_one({"id": message_data.recipient_id})
    if not recipient_raw:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    recipient = convert_mongo_doc_to_dict(recipient_raw)
    
    message_id = str(uuid.uuid4())
    message = {
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
    await db.messages.insert_one(message)
    
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": message_data.recipient_id,
        "type": "message",
        "from_user_id": current_user["id"],
        "from_username": current_user["username"],
        "from_profile_pic": current_user.get("profile_pic"),
        "post_id": None,
        "message": f"{current_user['username']} vous a envoyé un message",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return Message(**message)

@api_router.get("/messages/conversations", response_model=List[Conversation])
async def get_conversations(current_user: dict = Depends(get_current_user)):
    messages_raw = await db.messages.find(
        {"$or": [{"sender_id": current_user["id"]}, {"recipient_id": current_user["id"]}]}
    ).sort("created_at", -1).to_list(1000)
    
    conversations_map = {}
    for msg_raw in messages_raw:
        msg = convert_mongo_doc_to_dict(msg_raw)
        
        other_user_id = msg["recipient_id"] if msg["sender_id"] == current_user["id"] else msg["sender_id"]
        
        if other_user_id not in conversations_map:
            other_user_raw = await db.users.find_one({"id": other_user_id})
            other_user = convert_mongo_doc_to_dict(other_user_raw)
            
            if other_user:
                unread_count = await db.messages.count_documents({
                    "sender_id": other_user_id,
                    "recipient_id": current_user["id"],
                    "read": False
                })
                
                conversations_map[other_user_id] = Conversation(
                    user_id=other_user_id,
                    username=other_user["username"],
                    profile_pic=other_user.get("profile_pic"),
                    last_message=msg["content"],
                    last_message_time=msg["created_at"],
                    unread_count=unread_count
                )
    
    return list(conversations_map.values())

@api_router.get("/messages/{other_user_id}", response_model=List[Message])
async def get_messages_with_user(other_user_id: str, current_user: dict = Depends(get_current_user)):
    messages_raw = await db.messages.find(
        {"$or": [
            {"sender_id": current_user["id"], "recipient_id": other_user_id},
            {"sender_id": other_user_id, "recipient_id": current_user["id"]}
        ]}
    ).sort("created_at", 1).to_list(1000)
    
    await db.messages.update_many(
        {"sender_id": other_user_id, "recipient_id": current_user["id"], "read": False},
        {"$set": {"read": True}}
    )
    
    return [Message(**convert_mongo_doc_to_dict(m_raw)) for m_raw in messages_raw]

# Notification routes
@api_router.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: dict = Depends(get_current_user)):
    notifications_raw = await db.notifications.find({"user_id": current_user["id"]}).sort("created_at", -1).limit(50).to_list(50)
    return [Notification(**convert_mongo_doc_to_dict(n_raw)) for n_raw in notifications_raw]

@api_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    await db.notifications.update_one(
        {"id": notification_id, "user_id": current_user["id"]},
        {"$set": {"read": True}}
    )
    return {"message": "Notification marked as read"}

@api_router.put("/notifications/read-all")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": current_user["id"], "read": False},
        {"$set": {"read": True}}
    )
    return {"message": "All notifications marked as read"}

# Search routes
@api_router.get("/search/posts")
async def search_posts(q: str, current_user: dict = Depends(get_current_user)):
    if not q:
        return []
    
    posts_raw = await db.posts.find({"content": {"$regex": q, "$options": "i"}}).sort("created_at", -1).limit(50).to_list(50)
    
    liked_posts_raw = await db.likes.find({"user_id": current_user["id"]}).to_list(1000)
    liked_post_ids = {like["post_id"] for like in [convert_mongo_doc_to_dict(l) for l in liked_posts_raw]}
    
    result = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        post_obj = Post(**post)
        post_obj.is_liked = post["id"] in liked_post_ids
        result.append(post_obj)
    
    return result

# Inclure le routeur principal
app.include_router(api_router)

logging.basicConfig(level=logging.INFO)
@app.on_event("shutdown")
async def shutdown():
    client.close()

