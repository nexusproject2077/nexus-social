# app/backend/server.py   ← ouvre ce fichier
import sys
from pathlib import Path
# Cette ligne magique règle TOUT le problème Render
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from backend.routers import stories
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt
import base64

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.environ.get('SECRET_KEY', '76f267dbc69c6b4e639a50a7ccdd3783')
ALGORITHM = "HS256"

# Create the main app
app = FastAPI()

@app.get("/")
async def root():
    return{"message": "API fonctionne !"}

# Health check pour Render
@app.get("/healthz")
async def health_check():
    return {"status": "ok"}

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")
api_router.include_router(stories.router)
app.include_router(api_router)

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
    media_type: Optional[str] = None  # 'image' or 'video'
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
    type: str  # 'like', 'comment', 'follow', 'share'
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
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except:
        raise HTTPException(status_code=401, detail="Invalid token")

# ==================== AUTH ROUTES ====================

@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"$or": [{"email": user_data.email}, {"username": user_data.username}]})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email or username already registered")
    
    # Create user
    hashed_password = pwd_context.hash(user_data.password)
    user_id = str(uuid.uuid4())
    user = {
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
    await db.users.insert_one(user)
    
    # Create token
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
            "created_at": user["created_at"]
        }
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user or not pwd_context.verify(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
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
        # Convert image to base64
        contents = await profile_pic.read()
        base64_image = base64.b64encode(contents).decode('utf-8')
        update_data["profile_pic"] = f"data:{profile_pic.content_type};base64,{base64_image}"
    
    if update_data:
        await db.users.update_one({"id": current_user["id"]}, {"$set": update_data})
    
    updated_user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    return User(**updated_user)

# ==================== POST ROUTES ====================

@api_router.post("/posts", response_model=Post)
async def create_post(
    content: str = Form(...),
    media: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    post_id = str(uuid.uuid4())
    media_type = None
    media_url = None
    
    if media:
        contents = await media.read()
        base64_media = base64.b64encode(contents).decode('utf-8')
        media_url = f"data:{media.content_type};base64,{base64_media}"
        if media.content_type.startswith('image'):
            media_type = 'image'
        elif media.content_type.startswith('video'):
            media_type = 'video'
    
    post = {
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
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.posts.insert_one(post)
    
    post_response = Post(**post)
    post_response.is_liked = False
    return post_response

@api_router.get("/posts/feed", response_model=List[Post])
async def get_feed(current_user: dict = Depends(get_current_user)):
    # Get users that current user is following
    follows = await db.follows.find({"follower_id": current_user["id"]}, {"_id": 0}).to_list(1000)
    following_ids = [f["following_id"] for f in follows]
    following_ids.append(current_user["id"])  # Include own posts
    
    # Get posts from followed users
    posts = await db.posts.find(
        {"author_id": {"$in": following_ids}}
    ).sort("created_at", -1).to_list(100)
    
    # Check which posts are liked by current user
    liked_posts = await db.likes.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(1000)
    liked_post_ids = {like["post_id"] for like in liked_posts}
    
    result = []
    for post in posts:
        post_obj = Post(**post)
        post_obj.is_liked = post["id"] in liked_post_ids
        result.append(post_obj)
    
    return result

@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(post_id: str, current_user: dict = Depends(get_current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check if liked
    like = await db.likes.find_one({"user_id": current_user["id"], "post_id": post_id})
    post_obj = Post(**post)
    post_obj.is_liked = like is not None
    return post_obj

@api_router.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user)):
    post = await db.posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check if already liked
    existing_like = await db.likes.find_one({"user_id": current_user["id"], "post_id": post_id})
    
    if existing_like:
        # Unlike
        await db.likes.delete_one({"user_id": current_user["id"], "post_id": post_id})
        await db.posts.update_one({"id": post_id}, {"$inc": {"likes_count": -1}})
        return {"liked": False}
    else:
        # Like
        await db.likes.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "post_id": post_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        await db.posts.update_one({"id": post_id}, {"$inc": {"likes_count": 1}})
        
        # Create notification
        if post["author_id"] != current_user["id"]:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": post["author_id"],
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
    original_post = await db.posts.find_one({"id": post_id})
    if not original_post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Create a shared post
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
    
    # Increment shares count
    await db.posts.update_one({"id": post_id}, {"$inc": {"shares_count": 1}})
    
    # Create notification
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
    post = await db.posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.posts.delete_one({"id": post_id})
    await db.comments.delete_many({"post_id": post_id})
    await db.likes.delete_many({"post_id": post_id})
    return {"message": "Post deleted successfully"}

# ==================== COMMENT ROUTES ====================

@api_router.post("/posts/{post_id}/comments", response_model=Comment)
async def create_comment(post_id: str, comment_data: CommentCreate, current_user: dict = Depends(get_current_user)):
    post = await db.posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
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
    
    # Create notification
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
    comments = await db.comments.find({"post_id": post_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Comment(**c) for c in comments]

# ==================== USER ROUTES ====================

@api_router.get("/users/search")
async def search_users(q: str, current_user: dict = Depends(get_current_user)):
    if not q:
        return []
    
    users = await db.users.find(
        {"$or": [
            {"username": {"$regex": q, "$options": "i"}},
            {"bio": {"$regex": q, "$options": "i"}}
        ]},
        {"_id": 0, "password": 0}
    ).limit(20).to_list(20)
    
    return users

@api_router.get("/users/{user_id}", response_model=UserProfile)
async def get_user_profile(user_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if following
    follow = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user_id})
    
    profile = UserProfile(**user)
    profile.is_following = follow is not None
    return profile

@api_router.get("/users/{user_id}/posts", response_model=List[Post])
async def get_user_posts(user_id: str, current_user: dict = Depends(get_current_user)):
    posts = await db.posts.find({"author_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    
    # Check which posts are liked by current user
    liked_posts = await db.likes.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(1000)
    liked_post_ids = {like["post_id"] for like in liked_posts}
    
    result = []
    for post in posts:
        post_obj = Post(**post)
        post_obj.is_liked = post["id"] in liked_post_ids
        result.append(post_obj)
    
    return result

@api_router.post("/users/{user_id}/follow")
async def follow_user(user_id: str, current_user: dict = Depends(get_current_user)):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    target_user = await db.users.find_one({"id": user_id})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if already following
    existing_follow = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user_id})
    
    if existing_follow:
        # Unfollow
        await db.follows.delete_one({"follower_id": current_user["id"], "following_id": user_id})
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": -1}})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": -1}})
        return {"following": False}
    else:
        # Follow
        await db.follows.insert_one({
            "id": str(uuid.uuid4()),
            "follower_id": current_user["id"],
            "following_id": user_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": 1}})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": 1}})
        
        # Create notification
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

# ==================== MESSAGE ROUTES ====================

@api_router.post("/messages", response_model=Message)
async def send_message(message_data: MessageCreate, current_user: dict = Depends(get_current_user)):
    recipient = await db.users.find_one({"id": message_data.recipient_id})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
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
    
    # Create notification
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
    # Get all messages where user is sender or recipient
    messages = await db.messages.find(
        {"$or": [{"sender_id": current_user["id"]}, {"recipient_id": current_user["id"]}]}
    ).sort("created_at", -1).to_list(1000)
    
    # Group by conversation
    conversations_map = {}
    for msg in messages:
        other_user_id = msg["recipient_id"] if msg["sender_id"] == current_user["id"] else msg["sender_id"]
        
        if other_user_id not in conversations_map:
            other_user = await db.users.find_one({"id": other_user_id}, {"_id": 0})
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
    messages = await db.messages.find(
        {"$or": [
            {"sender_id": current_user["id"], "recipient_id": other_user_id},
            {"sender_id": other_user_id, "recipient_id": current_user["id"]}
        ]}
    ).sort("created_at", 1).to_list(1000)
    
    # Mark messages as read
    await db.messages.update_many(
        {"sender_id": other_user_id, "recipient_id": current_user["id"], "read": False},
        {"$set": {"read": True}}
    )
    
    return [Message(**m) for m in messages]

# ==================== NOTIFICATION ROUTES ====================

@api_router.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: dict = Depends(get_current_user)):
    notifications = await db.notifications.find(
        {"user_id": current_user["id"]}
    ).sort("created_at", -1).limit(50).to_list(50)
    
    return [Notification(**n) for n in notifications]

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

# ==================== SEARCH ROUTES ====================

@api_router.get("/search/posts")
async def search_posts(q: str, current_user: dict = Depends(get_current_user)):
    if not q:
        return []
    
    posts = await db.posts.find(
        {"content": {"$regex": q, "$options": "i"}},
        {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    
    # Check which posts are liked by current user
    liked_posts = await db.likes.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(1000)
    liked_post_ids = {like["post_id"] for like in liked_posts}
    
    result = []
    for post in posts:
        post_obj = Post(**post)
        post_obj.is_liked = post["id"] in liked_post_ids
        result.append(post_obj)
    
    return result

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
