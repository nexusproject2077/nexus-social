# app/backend/server.py
import sys
from pathlib import Path
# Cette ligne magique règle TOUT le problème Render
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form, Response, Query, Body, WebSocket, WebSocketDisconnect, BackgroundTasks, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
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
from collections import defaultdict, deque
import time
from enum import Enum
import hashlib
import random
import math
import re

# E2EE (chiffrement des messages / données sensibles)
from cryptography.fernet import Fernet

# Geo-blocking (optionnel — nécessite geoip2 + base GeoLite2-Country.mmdb)
try:
    import geoip2.database
except ImportError:
    geoip2 = None

# Paiements (optionnel — nécessite le SDK stripe + clés en env)
try:
    import stripe
except ImportError:
    stripe = None

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

# Gestionnaire de connexions WebSocket temps réel (module existant)
try:
    from backend.websocket_notifications import manager as ws_manager
except ImportError:
    try:
        from websocket_notifications import manager as ws_manager
    except ImportError:
        print("⚠️ WARNING: Module 'websocket_notifications' introuvable. Temps réel désactivé.")
        ws_manager = None

# Emails transactionnels (Brevo) — no-op si BREVO_API_KEY absente
try:
    from backend.brevo import send_email as send_brevo_email
except ImportError:
    try:
        from brevo import send_email as send_brevo_email
    except ImportError:
        send_brevo_email = None

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

# ==================== EU GEO-BLOCK ====================
# Bloque les visiteurs des pays de l'UE (réponse HTTP 451) sauf sur les pages
# légales. Le middleware "fail-open" : s'il n'y a pas de base GeoIP disponible
# (ou si geoip2 n'est pas installé), toutes les requêtes passent normalement.
EU_COUNTRIES = {
    'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
    'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
    'SE', 'SI', 'SK'
}

# Chemins toujours accessibles, même depuis l'UE (obligations légales + santé)
GEO_BLOCK_ALLOWED_PATHS = ("/privacy", "/gdpr", "/legal", "/healthz", "/docs", "/openapi.json")

EU_GEO_BLOCK_ENABLED = os.environ.get("EU_GEO_BLOCK_ENABLED", "true").lower() == "true"
GEOIP_DB_PATH = os.environ.get("GEOIP_DB_PATH", str(ROOT_DIR / "GeoLite2-Country.mmdb"))

_geoip_reader = None
if EU_GEO_BLOCK_ENABLED and geoip2 is not None and os.path.exists(GEOIP_DB_PATH):
    try:
        _geoip_reader = geoip2.database.Reader(GEOIP_DB_PATH)
        print(f"✅ EU geo-block actif (base GeoIP: {GEOIP_DB_PATH})")
    except Exception as e:
        print(f"⚠️ Impossible d'ouvrir la base GeoIP ({e}) — geo-block désactivé")
        _geoip_reader = None
elif EU_GEO_BLOCK_ENABLED:
    print("⚠️ EU geo-block demandé mais base GeoLite2-Country.mmdb introuvable — les requêtes passent normalement")


@app.middleware("http")
async def eu_geo_block(request, call_next):
    """Retourne 451 aux visiteurs de l'UE, sauf sur les pages légales."""
    if _geoip_reader is not None:
        path = request.url.path
        if not any(p in path for p in GEO_BLOCK_ALLOWED_PATHS):
            client_host = request.client.host if request.client else ""
            forwarded = request.headers.get("x-forwarded-for", client_host)
            ip = forwarded.split(",")[0].strip() if forwarded else client_host
            try:
                iso_code = _geoip_reader.country(ip).country.iso_code
                if iso_code in EU_COUNTRIES:
                    return JSONResponse(
                        status_code=451,
                        content={"error": "EU restricted - VPN/Tor required"}
                    )
            except Exception:
                # IP privée / introuvable dans la base → on laisse passer
                pass
    return await call_next(request)

# ==================== E2EE HELPER ====================
# Chiffrement symétrique (Fernet) pour les données sensibles / messages.
# Définissez ENCRYPTION_KEY (clé Fernet base64) en variable d'environnement.
_encryption_key = os.environ.get("ENCRYPTION_KEY")
if _encryption_key:
    cipher = Fernet(_encryption_key.encode())
    print("✅ E2EE cipher initialisé (ENCRYPTION_KEY)")
else:
    cipher = Fernet(Fernet.generate_key())
    print("⚠️ ENCRYPTION_KEY absente — clé éphémère générée (les données ne se déchiffreront pas après un redémarrage)")


def encrypt(data) -> str:
    """Chiffre une valeur et renvoie une chaîne (token Fernet)."""
    return cipher.encrypt(str(data).encode()).decode()


def decrypt(token: str) -> str:
    """Déchiffre un token Fernet et renvoie la chaîne d'origine."""
    return cipher.decrypt(token.encode()).decode()

# Chiffrement des messages au repos. Activé uniquement si une clé STABLE
# (ENCRYPTION_KEY) est fournie : avec la clé éphémère générée au démarrage,
# les messages deviendraient illisibles après un redémarrage. Le déchiffrement
# reste toujours tolérant (renvoie la valeur brute si non chiffrée), ce qui
# assure la rétro-compatibilité avec les messages en clair existants.
E2EE_MESSAGES = bool(_encryption_key)
if E2EE_MESSAGES:
    print("✅ Chiffrement des messages au repos activé")

def encrypt_message(text):
    """Chiffre le contenu d'un message si le chiffrement est activé."""
    if E2EE_MESSAGES and isinstance(text, str) and text:
        try:
            return encrypt(text)
        except Exception:
            return text
    return text

def decrypt_message(value):
    """Déchiffre le contenu d'un message ; renvoie la valeur telle quelle
    si elle n'est pas (ou plus) déchiffrable (message en clair, clé changée)."""
    if isinstance(value, str) and value:
        try:
            return decrypt(value)
        except Exception:
            return value
    return value

# ==================== PAIEMENTS (Stripe) ====================
# Abonnements via Stripe Checkout. Désactivé proprement si les clés sont
# absentes : les endpoints renvoient 503 et rien n'est facturé.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")  # prix d'abonnement récurrent
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://nexus-social-3ta5.onrender.com")
STRIPE_ENABLED = bool(stripe and STRIPE_SECRET_KEY and STRIPE_PRICE_ID)
if STRIPE_ENABLED:
    stripe.api_key = STRIPE_SECRET_KEY
    print("✅ Stripe activé (abonnements)")
elif stripe is None:
    print("ℹ️ Stripe indisponible (SDK non installé) — abonnements désactivés")
else:
    print("ℹ️ Stripe désactivé (STRIPE_SECRET_KEY/STRIPE_PRICE_ID absents) — abonnements désactivés")

# ==================== ADMINISTRATION ====================
# ADMIN_EMAILS (emails séparés par des virgules) identifie les comptes
# administrateurs, exposés via is_admin sur /auth/me. Optionnel : réservé à
# d'éventuelles fonctions d'administration. Le tableau de bord Analytics, lui,
# est personnel (chaque utilisateur voit ses propres statistiques).
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
}
if ADMIN_EMAILS:
    print(f"✅ Administrateurs configurés ({len(ADMIN_EMAILS)})")

# ==================== WEBSOCKET TEMPS RÉEL ====================
# Endpoint authentifié : le client se connecte à /ws/{user_id}?token=<JWT>.
# Le token doit correspondre au user_id, sinon la connexion est refusée.
# (Le service Render tourne avec 1 worker uvicorn, donc le registre en mémoire
#  du ConnectionManager est cohérent.)
if ws_manager is not None:
    @app.websocket("/ws/{user_id}")
    async def realtime_ws(websocket: WebSocket, user_id: str, token: str = Query(None)):
        # Authentification : le token JWT doit correspondre au user_id
        try:
            payload = jwt.decode(token or "", SECRET_KEY, algorithms=[ALGORITHM])
            if payload.get("sub") != user_id:
                await websocket.close(code=1008)
                return
        except Exception:
            await websocket.close(code=1008)
            return

        await ws_manager.connect(websocket, user_id)
        try:
            while True:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
        except WebSocketDisconnect:
            ws_manager.disconnect(websocket, user_id)
        except Exception:
            ws_manager.disconnect(websocket, user_id)


async def push_realtime(user_id: str, payload: dict):
    """Envoi temps réel best-effort : n'interrompt jamais la requête REST."""
    if ws_manager is None:
        return
    try:
        await ws_manager.send_personal_message(payload, user_id)
    except Exception:
        pass


async def create_notification(user_id, notif_type, from_user, post_id=None,
                              comment_content=None):
    """Crée une notification (et la pousse en temps réel). Best-effort.

    N'auto-notifie jamais : si l'émetteur est le destinataire, on ignore.
    """
    if not user_id or user_id == from_user.get("id"):
        return
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": notif_type,
        "from_user_id": from_user.get("id"),
        "from_username": from_user.get("username", ""),
        "from_profile_pic": from_user.get("profile_pic"),
        "post_id": post_id,
        "comment_content": comment_content,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.notifications.insert_one(dict(doc))
        await push_realtime(user_id, {"type": "notification", "data": doc})
    except Exception:
        pass

# ==================== LIVE (WebRTC signaling) ====================
# Relais de signaling minimal pour un direct 1:1 (offre/réponse/ICE).
# Gratuit : les pairs utilisent un STUN public (pas de TURN => échoue derrière
# NAT symétrique). Registre en mémoire, cohérent car Render tourne en 1 worker.
live_rooms: Dict[str, list] = {}

@app.websocket("/ws/live/{room_id}")
async def live_signaling(websocket: WebSocket, room_id: str, token: str = Query(None)):
    # Authentification : token JWT valide requis (utilisateur connecté)
    try:
        jwt.decode(token or "", SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    live_rooms.setdefault(room_id, []).append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Relaie le message de signaling aux autres pairs de la room
            for client in list(live_rooms.get(room_id, [])):
                if client is not websocket:
                    try:
                        await client.send_text(data)
                    except Exception:
                        pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        conns = live_rooms.get(room_id, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            live_rooms.pop(room_id, None)

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


def safe_http_url(url: Optional[str]) -> Optional[str]:
    """N'accepte qu'une URL http(s) (évite javascript: et autres schémas dangereux)."""
    if isinstance(url, str):
        u = url.strip()
        if u.startswith("http://") or u.startswith("https://"):
            return u[:2000]
    return None


def build_poll(poll_options: Optional[List[str]]) -> Optional[dict]:
    """Construit un sondage à partir d'une liste de textes d'options.
    Renvoie None si moins de 2 options valides (non vides)."""
    if not poll_options:
        return None
    cleaned = [o.strip() for o in poll_options if o and o.strip()]
    if len(cleaned) < 2:
        return None
    # Dédoublonne en gardant l'ordre, limite à 6 options
    seen, options = set(), []
    for text in cleaned:
        if text not in seen:
            seen.add(text)
            options.append({"id": str(uuid.uuid4()), "text": text, "votes": 0})
        if len(options) >= 6:
            break
    if len(options) < 2:
        return None
    return {"options": options, "total_votes": 0, "voters": {}}


def enrich_post_poll(post: dict, user_id: str) -> dict:
    """Ajoute poll_user_vote (option votée par user_id) et masque la liste
    des votants avant sérialisation dans le modèle Post."""
    poll = post.get("poll")
    if isinstance(poll, dict):
        voters = poll.get("voters") or {}
        post["poll_user_vote"] = voters.get(user_id)
    return post


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
    is_verified: bool = False
    is_premium: bool = False
    is_admin: bool = False
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
    is_verified: bool = False
    crypto_wallet: Optional[str] = None  # adresse de tips crypto (Solana/USDT…)
    created_at: str

class PollOption(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    text: str
    votes: int = 0

class Poll(BaseModel):
    model_config = ConfigDict(extra="ignore")
    options: List[PollOption]
    total_votes: int = 0

class PollVote(BaseModel):
    option_id: str

class PostCreate(BaseModel):
    content: str
    media_type: Optional[str] = None
    media_url: Optional[str] = None
    poll_options: Optional[List[str]] = None  # >= 2 options => sondage attaché au post
    affiliate_link: Optional[str] = None  # lien affilié optionnel (http/https)

class Post(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    author_is_verified: bool = False
    content: str
    media_type: Optional[str] = None
    media_url: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    is_liked: bool = False
    views: int = 0
    affiliate_link: Optional[str] = None
    affiliate_clicks: int = 0
    poll: Optional[Poll] = None
    poll_user_vote: Optional[str] = None  # id de l'option votée par l'utilisateur courant
    # Republication : si repost_of est défini, ce post est un repartage.
    # author_* = la personne qui a reposté ; original_author_* = l'auteur d'origine.
    repost_of: Optional[str] = None
    original_author_id: Optional[str] = None
    original_author_username: Optional[str] = None
    original_author_profile_pic: Optional[str] = None
    original_author_is_verified: bool = False
    is_reposted: bool = False  # l'utilisateur courant a-t-il reposté ce post ?
    mentioned_user_ids: Optional[List[str]] = None
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
    content: str = ""
    media_url: Optional[str] = None   # image compressée (data URL) éventuelle
    media_type: Optional[str] = None  # "image" pour l'instant
    reply_to_id: Optional[str] = None

class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    sender_id: str
    sender_username: str
    sender_profile_pic: Optional[str] = None
    recipient_id: str
    recipient_username: str
    content: str = ""
    media_url: Optional[str] = None
    media_type: Optional[str] = None
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


def is_admin_user(user: dict) -> bool:
    """Vrai si l'utilisateur fait partie des administrateurs (ADMIN_EMAILS)."""
    email = (user.get("email") or "").strip().lower()
    return bool(email) and email in ADMIN_EMAILS


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Dépendance : n'autorise que les administrateurs (ADMIN_EMAILS)."""
    if not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    return current_user

# ==================== RATE LIMITING (anti brute-force) ====================
# Limiteur en mémoire (cohérent car Render tourne en 1 worker). Fenêtre
# glissante par clé (IP). Suffisant pour freiner le bruteforce de login.
_rate_buckets: Dict[str, deque] = defaultdict(deque)

def rate_limit(key: str, max_attempts: int, window_seconds: int) -> bool:
    """Renvoie True si l'appel est autorisé, False si la limite est atteinte."""
    now = time.monotonic()
    bucket = _rate_buckets[key]
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= max_attempts:
        return False
    bucket.append(now)
    return True

def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ==================== GEO / LANGUE ====================
# Détection de la langue à partir du pays (adresse IP) pour adapter
# automatiquement l'interface. Les pays non listés retombent sur l'anglais.
SUPPORTED_UI_LANGS = {
    "en", "fr", "es", "de", "it", "pt", "nl", "pl",
    "tr", "ru", "uk", "ar", "hi", "zh", "ja", "ko",
}

# Pays -> langue de l'interface (code ISO 3166-1 alpha-2 -> code i18n)
COUNTRY_TO_LANG = {
    # Français
    "FR": "fr", "BE": "fr", "LU": "fr", "MC": "fr", "CI": "fr",
    "SN": "fr", "CM": "fr", "ML": "fr", "BF": "fr", "NE": "fr",
    "CD": "fr", "CG": "fr", "GA": "fr", "TG": "fr", "BJ": "fr",
    "MG": "fr", "GN": "fr", "TD": "fr", "HT": "fr", "GP": "fr", "MQ": "fr",
    # Espagnol
    "ES": "es", "MX": "es", "AR": "es", "CO": "es", "CL": "es",
    "PE": "es", "VE": "es", "EC": "es", "GT": "es", "CU": "es",
    "BO": "es", "DO": "es", "HN": "es", "PY": "es", "SV": "es",
    "NI": "es", "CR": "es", "PA": "es", "UY": "es",
    # Allemand
    "DE": "de", "AT": "de", "CH": "de", "LI": "de",
    # Italien
    "IT": "it", "SM": "it", "VA": "it",
    # Portugais
    "PT": "pt", "BR": "pt", "AO": "pt", "MZ": "pt", "CV": "pt",
    # Néerlandais
    "NL": "nl", "SR": "nl",
    # Polonais
    "PL": "pl",
    # Turc
    "TR": "tr", "CY": "tr",
    # Russe
    "RU": "ru", "BY": "ru", "KZ": "ru", "KG": "ru", "TJ": "ru",
    "AM": "ru", "AZ": "ru", "MD": "ru", "UZ": "ru", "TM": "ru",
    # Ukrainien
    "UA": "uk",
    # Arabe
    "SA": "ar", "AE": "ar", "EG": "ar", "DZ": "ar", "MA": "ar",
    "TN": "ar", "IQ": "ar", "JO": "ar", "KW": "ar", "QA": "ar",
    "OM": "ar", "BH": "ar", "LB": "ar", "LY": "ar", "YE": "ar", "SD": "ar",
    # Hindi
    "IN": "hi",
    # Chinois
    "CN": "zh", "TW": "zh", "HK": "zh", "SG": "zh", "MO": "zh",
    # Japonais
    "JP": "ja",
    # Coréen
    "KR": "ko",
}


def lang_for_country(iso_code: Optional[str]) -> str:
    """Retourne le code de langue de l'interface pour un pays donné."""
    if not iso_code:
        return "en"
    return COUNTRY_TO_LANG.get(iso_code.upper(), "en")


@api_router.get("/geo/language")
async def detect_language(request: Request):
    """Détecte le pays via l'IP et suggère une langue d'interface.

    Best-effort : si la base GeoIP est absente, renvoie 'en' et le frontend
    retombe sur la détection navigateur. Ne bloque jamais.
    """
    ip = client_ip(request)
    country = None
    if _geoip_reader is not None:
        try:
            country = _geoip_reader.country(ip).country.iso_code
        except Exception:
            country = None
    lang = lang_for_country(country)
    return {"country": country, "language": lang, "supported": sorted(SUPPORTED_UI_LANGS)}


# ==================== AUTH ROUTES ====================
@api_router.post("/auth/register")
async def register(user_data: UserCreate, background_tasks: BackgroundTasks):
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

    # Email de bienvenue (best-effort, en tâche de fond : ne bloque pas l'inscription)
    if send_brevo_email:
        background_tasks.add_task(
            send_brevo_email,
            user_data.email,
            "Bienvenue sur Nexus Social 🎉",
            f"<h1>Bienvenue {user_data.username} !</h1>"
            "<p>Ton compte est prêt. Publie ton premier post et rejoins la communauté 🚀</p>",
        )

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
async def login(credentials: UserLogin, request: Request):
    """Connecte un utilisateur existant"""
    # Anti brute-force : max 10 tentatives / 5 min par IP
    if not rate_limit(f"login:{client_ip(request)}", max_attempts=10, window_seconds=300):
        raise HTTPException(
            status_code=429,
            detail="Trop de tentatives de connexion. Réessayez dans quelques minutes.",
        )

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
    current_user["is_admin"] = is_admin_user(current_user)
    return User(**current_user)

# ==================== BILLING (abonnements Stripe) ====================
@api_router.get("/billing/status")
async def billing_status(current_user: dict = Depends(get_current_user)):
    """Indique si les paiements sont configurés et l'état d'abonnement de l'utilisateur."""
    return {
        "enabled": STRIPE_ENABLED,
        "is_premium": bool(current_user.get("is_premium")),
        "subscription_status": current_user.get("subscription_status"),
    }


@api_router.post("/billing/create-checkout-session")
async def create_checkout_session(current_user: dict = Depends(get_current_user)):
    """Crée une session Stripe Checkout d'abonnement et renvoie l'URL de paiement."""
    if not STRIPE_ENABLED:
        raise HTTPException(status_code=503, detail="Les paiements ne sont pas configurés")
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": STRIPE_PRICE_ID, "quantity": 1}],
            customer_email=current_user.get("email"),
            client_reference_id=current_user["id"],
            metadata={"user_id": current_user["id"]},
            subscription_data={"metadata": {"user_id": current_user["id"]}},
            success_url=f"{FRONTEND_URL}/settings?sub=success",
            cancel_url=f"{FRONTEND_URL}/settings?sub=cancel",
        )
        return {"url": session.url}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Stripe: {e}")


@app.post("/api/billing/webhook")
async def stripe_webhook(request: Request):
    """Webhook Stripe (signature vérifiée) : met à jour l'abonnement de l'utilisateur."""
    if not STRIPE_ENABLED or not STRIPE_WEBHOOK_SECRET:
        return {"received": False, "reason": "stripe disabled"}

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(status_code=400, detail="Signature webhook invalide")

    etype = event["type"]
    obj = event["data"]["object"]

    if etype == "checkout.session.completed":
        user_id = (obj.get("metadata") or {}).get("user_id") or obj.get("client_reference_id")
        if user_id:
            await db.users.update_one({"id": user_id}, {"$set": {
                "is_premium": True,
                "subscription_status": "active",
                "stripe_customer_id": obj.get("customer"),
                "stripe_subscription_id": obj.get("subscription"),
            }})
            if send_brevo_email:
                u = await db.users.find_one({"id": user_id})
                if u and u.get("email"):
                    send_brevo_email(
                        u["email"],
                        "Abonnement Nexus Premium activé ✅",
                        "<h1>Merci !</h1><p>Ton abonnement Nexus Premium est actif. Profite des avantages créateur 🚀</p>",
                    )
    elif etype in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub_id = obj.get("id")
        if sub_id:
            await db.users.update_one(
                {"stripe_subscription_id": sub_id},
                {"$set": {"is_premium": False, "subscription_status": "canceled"}},
            )

    return {"received": True}


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
            "phone", "birthdate", "gender", "website", "crypto_wallet"
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
                "website": user_dict.get("website", ""),
                "crypto_wallet": user_dict.get("crypto_wallet", "")
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
async def resolve_mentions(content: str, exclude_id: str = None):
    """Extrait les @mentions du contenu et renvoie la liste des user_ids
    correspondant à des comptes existants (hors exclude_id)."""
    if not content:
        return []
    usernames = {u.lower() for u in re.findall(r'@(\w+)', content)}
    if not usernames:
        return []
    ids = []
    async for u in db.users.find(
        {"username": {"$in": list(usernames)}}, {"id": 1, "username": 1}
    ):
        # match insensible à la casse
        if u.get("username", "").lower() in usernames and u.get("id") != exclude_id:
            ids.append(u["id"])
    return ids


@api_router.post("/posts", response_model=Post)
async def create_post(post_data: PostCreate, current_user: dict = Depends(get_current_user)):
    """Créer un nouveau post"""
    post_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    mentioned_ids = await resolve_mentions(post_data.content, exclude_id=current_user["id"])

    post_to_insert = {
        "id": post_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "author_is_verified": current_user.get("is_verified", False),
        "content": post_data.content,
        "media_type": post_data.media_type,
        "media_url": post_data.media_url,
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "poll": build_poll(post_data.poll_options),
        "affiliate_link": safe_http_url(post_data.affiliate_link),
        "affiliate_clicks": 0,
        "mentioned_user_ids": mentioned_ids,
        "created_at": now.isoformat()
    }

    await db.posts.insert_one(post_to_insert)

    # Notifier les personnes mentionnées.
    for uid in mentioned_ids:
        await create_notification(uid, "mention", current_user, post_id=post_id)

    post = convert_mongo_doc_to_dict(post_to_insert)
    post["is_liked"] = False
    post["poll_user_vote"] = None
    return Post(**post)


@api_router.post("/posts/{post_id}/affiliate-click")
async def track_affiliate_click(post_id: str, current_user: dict = Depends(get_current_user)):
    """Incrémente le compteur de clics d'un lien affilié (best-effort)."""
    result = await db.posts.update_one(
        {"id": post_id, "affiliate_link": {"$ne": None}},
        {"$inc": {"affiliate_clicks": 1}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lien affilié introuvable")
    return {"success": True}


@api_router.post("/posts/{post_id}/vote", response_model=Post)
async def vote_poll(post_id: str, vote: PollVote, current_user: dict = Depends(get_current_user)):
    """Voter (ou changer de vote) sur le sondage d'un post."""
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")

    poll = post_raw.get("poll")
    if not poll:
        raise HTTPException(status_code=400, detail="Ce post ne contient pas de sondage")

    options = poll.get("options", [])
    valid_ids = {o["id"] for o in options}
    if vote.option_id not in valid_ids:
        raise HTTPException(status_code=400, detail="Option invalide")

    voters = dict(poll.get("voters") or {})
    previous = voters.get(current_user["id"])
    if previous == vote.option_id:
        # Vote inchangé : on renvoie l'état courant sans modification
        post = enrich_post_poll(convert_mongo_doc_to_dict(post_raw), current_user["id"])
        like_raw = await db.likes.find_one({"post_id": post_id, "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        return Post(**post)

    total_votes = int(poll.get("total_votes") or 0)
    for opt in options:
        if previous and opt["id"] == previous:
            opt["votes"] = max(0, int(opt.get("votes") or 0) - 1)
        if opt["id"] == vote.option_id:
            opt["votes"] = int(opt.get("votes") or 0) + 1
    if not previous:
        total_votes += 1
    voters[current_user["id"]] = vote.option_id

    updated_poll = {"options": options, "total_votes": total_votes, "voters": voters}
    await db.posts.update_one({"id": post_id}, {"$set": {"poll": updated_poll}})

    post_raw["poll"] = updated_poll
    post = enrich_post_poll(convert_mongo_doc_to_dict(post_raw), current_user["id"])
    like_raw = await db.likes.find_one({"post_id": post_id, "user_id": current_user["id"]})
    post["is_liked"] = bool(like_raw)
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
        enrich_post_poll(post, current_user["id"])
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
    enrich_post_poll(post, current_user["id"])
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
        "author_is_verified": current_user.get("is_verified", False),
        "content": original["content"],
        "media_type": original.get("media_type"),
        "media_url": original.get("media_url"),
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "repost_of": post_id,
        "original_author_username": original["author_username"],
        "original_author_id": original["author_id"],
        "original_author_profile_pic": original.get("author_profile_pic"),
        "original_author_is_verified": original.get("author_is_verified", False),
        "created_at": now.isoformat()
    }
    await db.posts.insert_one(repost_doc)
    await db.posts.update_one({"id": post_id}, {"$inc": {"shares_count": 1}})

    # Notifier l'auteur d'origine (sauf soi-même, déjà exclu plus haut).
    await create_notification(
        user_id=original["author_id"],
        notif_type="repost",
        from_user=current_user,
        post_id=post_id,
    )

    result = convert_mongo_doc_to_dict(repost_doc)
    result["is_liked"] = False
    result["is_reposted"] = True
    return Post(**result)


@api_router.delete("/posts/{post_id}/repost")
async def unrepost(post_id: str, current_user: dict = Depends(get_current_user)):
    """Annule la republication d'un post par l'utilisateur courant."""
    existing = await db.posts.find_one({"repost_of": post_id, "author_id": current_user["id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Vous n'avez pas reposté cette publication")

    await db.posts.delete_one({"id": existing["id"]})
    # Décrémente le compteur de partages de l'original (jamais en dessous de 0).
    await db.posts.update_one(
        {"id": post_id, "shares_count": {"$gt": 0}},
        {"$inc": {"shares_count": -1}},
    )
    # Retire la notification de republication associée.
    await db.notifications.delete_many({
        "type": "repost", "post_id": post_id, "from_user_id": current_user["id"],
    })

    updated = await db.posts.find_one({"id": post_id})
    shares = (updated or {}).get("shares_count", 0) if updated else 0
    return {"reposted": False, "shares_count": shares}

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
        "author_is_verified": current_user.get("is_verified", False),
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
        "author_is_verified": current_user.get("is_verified", False),
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
        is_verified=user.get("is_verified", False),
        crypto_wallet=user.get("crypto_wallet"),
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
    
    # Publications originales uniquement (les reposts ont leur propre section).
    posts_raw = await db.posts.find(
        {"author_id": user_id, "repost_of": None}
    ).sort("created_at", -1).to_list(length=50)

    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        enrich_post_poll(post, current_user["id"])
        posts.append(Post(**post))

    return posts


async def _visible_profile_or_403(user_id: str, current_user: dict):
    """Vérifie l'accès à un profil (comptes privés) et renvoie l'utilisateur cible."""
    if current_user["id"] == user_id:
        return None
    target_user = await db.users.find_one({"id": user_id})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if target_user.get("is_private", False):
        if not await check_is_following(current_user["id"], user_id):
            raise HTTPException(status_code=403, detail="Ce compte est privé. Vous devez être abonné pour voir ses publications.")
    return target_user


@api_router.get("/users/{user_id}/reposts", response_model=List[Post])
async def get_user_reposts(user_id: str, current_user: dict = Depends(get_current_user)):
    """Publications repartagées (reposts) par l'utilisateur."""
    await _visible_profile_or_403(user_id, current_user)

    reposts_raw = await db.posts.find(
        {"author_id": user_id, "repost_of": {"$ne": None}}
    ).sort("created_at", -1).to_list(length=50)

    posts = []
    for post_raw in reposts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        # Like/état calculés sur la publication d'origine.
        original_id = post.get("repost_of")
        like_raw = await db.likes.find_one({"post_id": original_id, "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        post["is_reposted"] = (user_id == current_user["id"])
        posts.append(Post(**post))

    return posts


@api_router.get("/users/{user_id}/mentions", response_model=List[Post])
async def get_user_mentions(user_id: str, current_user: dict = Depends(get_current_user)):
    """Publications où l'utilisateur a été mentionné (@)."""
    await _visible_profile_or_403(user_id, current_user)

    posts_raw = await db.posts.find(
        {"mentioned_user_ids": user_id, "repost_of": None}
    ).sort("created_at", -1).to_list(length=50)

    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        enrich_post_poll(post, current_user["id"])
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

async def _do_follow(follower: dict, user_id: str):
    """Crée l'abonnement effectif (comptes publics ou requête acceptée)."""
    await db.follows.insert_one({
        "id": str(uuid.uuid4()),
        "follower_id": follower["id"],
        "followed_id": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.users.update_one({"id": follower["id"]}, {"$inc": {"following_count": 1}})
    await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": 1}})
    await create_notification(user_id, "follow", follower)


@api_router.post("/users/{user_id}/follow")
async def follow_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Suivre / ne plus suivre. Pour un compte privé, crée une demande à valider."""
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")

    user_raw = await db.users.find_one({"id": user_id})
    if not user_raw:
        raise HTTPException(status_code=404, detail="User not found")

    existing_follow_raw = await db.follows.find_one({"follower_id": current_user["id"], "followed_id": user_id})

    if existing_follow_raw:
        # Se désabonner
        await db.follows.delete_one({"follower_id": current_user["id"], "followed_id": user_id})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": -1}})
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": -1}})
        return {"following": False, "status": "not_following"}

    # Compte privé : demande d'abonnement à valider par le destinataire.
    if user_raw.get("is_private", False):
        existing_req = await db.follow_requests.find_one({"requester_id": current_user["id"], "target_id": user_id})
        if existing_req:
            # Annuler la demande (bascule).
            await db.follow_requests.delete_one({"id": existing_req["id"]})
            await db.notifications.delete_many({
                "type": "follow_request", "from_user_id": current_user["id"], "user_id": user_id,
            })
            return {"following": False, "status": "not_following"}
        await db.follow_requests.insert_one({
            "id": str(uuid.uuid4()),
            "requester_id": current_user["id"],
            "target_id": user_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await create_notification(user_id, "follow_request", current_user)
        return {"following": False, "status": "pending"}

    # Compte public : abonnement immédiat.
    await _do_follow(current_user, user_id)
    return {"following": True, "status": "following"}


@api_router.get("/users/{user_id}/follow-status")
async def get_follow_status(user_id: str, current_user: dict = Depends(get_current_user)):
    """État de la relation d'abonnement avec un utilisateur."""
    if user_id == current_user["id"]:
        return {"status": "self"}
    if await check_is_following(current_user["id"], user_id):
        return {"status": "following"}
    pending = await db.follow_requests.find_one({"requester_id": current_user["id"], "target_id": user_id})
    return {"status": "pending" if pending else "not_following"}


@api_router.get("/follow-requests")
async def list_follow_requests(current_user: dict = Depends(get_current_user)):
    """Demandes d'abonnement en attente reçues par l'utilisateur."""
    reqs = await db.follow_requests.find({"target_id": current_user["id"]}).sort("created_at", -1).to_list(length=100)
    out = []
    for r in reqs:
        u = await db.users.find_one({"id": r.get("requester_id")}, {"_id": 0, "password": 0})
        if u:
            out.append({
                "id": r.get("id"),
                "requester_id": r.get("requester_id"),
                "username": u.get("username"),
                "profile_pic": u.get("profile_pic"),
                "created_at": r.get("created_at"),
            })
    return out


@api_router.post("/follow-requests/{requester_id}/accept")
async def accept_follow_request(requester_id: str, current_user: dict = Depends(get_current_user)):
    """Accepte une demande d'abonnement."""
    req = await db.follow_requests.find_one({"requester_id": requester_id, "target_id": current_user["id"]})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    requester = await db.users.find_one({"id": requester_id})
    await db.follow_requests.delete_one({"id": req["id"]})
    if requester and not await check_is_following(requester_id, current_user["id"]):
        await _do_follow(requester, current_user["id"])
    # Nettoie la notif de demande, prévient le demandeur.
    await db.notifications.delete_many({"type": "follow_request", "from_user_id": requester_id, "user_id": current_user["id"]})
    await create_notification(requester_id, "follow_accepted", current_user)
    return {"success": True}


@api_router.post("/follow-requests/{requester_id}/reject")
async def reject_follow_request(requester_id: str, current_user: dict = Depends(get_current_user)):
    """Refuse une demande d'abonnement."""
    result = await db.follow_requests.delete_one({"requester_id": requester_id, "target_id": current_user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    await db.notifications.delete_many({"type": "follow_request", "from_user_id": requester_id, "user_id": current_user["id"]})
    return {"success": True}


# ==================== DIRECTS (LIVE) ====================
class LiveStart(BaseModel):
    room_id: str


async def _followed_ids(user_id: str) -> List[str]:
    ids = []
    async for f in db.follows.find({"follower_id": user_id}):
        fid = f.get("followed_id") or f.get("following_id")
        if fid:
            ids.append(fid)
    return ids


@api_router.post("/live/start")
async def start_live(payload: LiveStart, current_user: dict = Depends(get_current_user)):
    """Démarre un direct : visible dans les stories des abonnés + les notifie."""
    now = datetime.now(timezone.utc).isoformat()
    await db.live_sessions.update_one(
        {"host_id": current_user["id"]},
        {"$set": {
            "host_id": current_user["id"],
            "host_username": current_user["username"],
            "host_profile_pic": current_user.get("profile_pic"),
            "room_id": payload.room_id,
            "started_at": now,
            "active": True,
        }},
        upsert=True,
    )
    # Notifie les abonnés (followers) du lancement du direct.
    async for f in db.follows.find({"followed_id": current_user["id"]}):
        await create_notification(f.get("follower_id"), "live", current_user, post_id=payload.room_id)
    return {"success": True, "room_id": payload.room_id}


@api_router.post("/live/stop")
async def stop_live(current_user: dict = Depends(get_current_user)):
    """Termine le direct de l'utilisateur."""
    await db.live_sessions.update_one(
        {"host_id": current_user["id"]}, {"$set": {"active": False}}
    )
    return {"success": True}


@api_router.get("/live/active")
async def active_lives(current_user: dict = Depends(get_current_user)):
    """Directs en cours parmi les comptes suivis (abonnements) + soi-même."""
    allowed = set(await _followed_ids(current_user["id"]))
    allowed.add(current_user["id"])
    out = []
    async for s in db.live_sessions.find({"active": True}):
        if s.get("host_id") in allowed:
            out.append({
                "host_id": s.get("host_id"),
                "host_username": s.get("host_username"),
                "host_profile_pic": s.get("host_profile_pic"),
                "room_id": s.get("room_id"),
                "started_at": s.get("started_at"),
            })
    return out


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


@api_router.put("/notifications/read-all")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    """Marque toutes les notifications de l'utilisateur comme lues."""
    await db.notifications.update_many(
        {"user_id": current_user["id"], "read": False}, {"$set": {"read": True}}
    )
    return {"success": True}


@api_router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime une notification de l'utilisateur."""
    result = await db.notifications.delete_one(
        {"id": notification_id, "user_id": current_user["id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"success": True}


@api_router.delete("/notifications")
async def clear_notifications(current_user: dict = Depends(get_current_user)):
    """Supprime toutes les notifications de l'utilisateur."""
    await db.notifications.delete_many({"user_id": current_user["id"]})
    return {"success": True}

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
                    last_message=decrypt_message(msg["content"]),
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
        msg["content"] = decrypt_message(msg.get("content"))
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
    # Anti-spam : max 30 messages / 60 s par utilisateur
    if not rate_limit(f"msg:{current_user['id']}", max_attempts=30, window_seconds=60):
        raise HTTPException(status_code=429, detail="Trop de messages envoyés. Ralentissez un peu.")

    recipient_raw = await db.users.find_one({"id": message_data.recipient_id})
    if not recipient_raw:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    # Un message doit avoir du texte OU un média.
    if not (message_data.content or "").strip() and not message_data.media_url:
        raise HTTPException(status_code=400, detail="Message vide")

    recipient = convert_mongo_doc_to_dict(recipient_raw)
    message_id = str(uuid.uuid4())

    message_to_insert = {
        "id": message_id,
        "sender_id": current_user["id"],
        "sender_username": current_user["username"],
        "sender_profile_pic": current_user.get("profile_pic"),
        "recipient_id": message_data.recipient_id,
        "recipient_username": recipient["username"],
        "content": encrypt_message(message_data.content or ""),
        "media_url": message_data.media_url,
        "media_type": message_data.media_type,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    await db.messages.insert_one(message_to_insert)

    message = convert_mongo_doc_to_dict(message_to_insert)
    message["content"] = message_data.content or ""  # renvoyer en clair à l'expéditeur

    # Push temps réel au destinataire (best-effort, contenu en clair)
    await push_realtime(message_data.recipient_id, {
        "type": "new_message",
        "data": {
            "id": message_id,
            "sender_id": current_user["id"],
            "sender_username": current_user["username"],
            "sender_profile_pic": current_user.get("profile_pic"),
            "recipient_id": message_data.recipient_id,
            "content": message_data.content or "",
            "media_url": message_data.media_url,
            "media_type": message_data.media_type,
            "created_at": message_to_insert["created_at"],
        },
    })

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
        # Anti-spam : max 30 messages / 60 s par utilisateur
        if not rate_limit(f"msg:{current_user['id']}", max_attempts=30, window_seconds=60):
            raise HTTPException(status_code=429, detail="Trop de messages envoyés. Ralentissez un peu.")

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
            "content": encrypt_message(message_data["content"].strip()),
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

        response_message = convert_mongo_doc_to_dict(message)
        response_message["content"] = message_data["content"].strip()  # clair pour l'expéditeur
        return {
            "success": True,
            "message": response_message
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
    
    messages = []
    for m in messages_raw:
        msg = convert_mongo_doc_to_dict(m)
        msg["content"] = decrypt_message(msg.get("content"))
        messages.append(msg)
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

    is_self_leave = current_user["id"] == user_id

    # Un membre peut toujours se retirer lui-même (quitter le groupe).
    # Pour retirer QUELQU'UN D'AUTRE, il faut être admin.
    if not is_self_leave and current_user["id"] not in group.get("admin_ids", []):
        raise HTTPException(status_code=403, detail="Seuls les admins peuvent retirer un membre")

    # On ne peut retirer le créateur QUE s'il se retire lui-même (il quitte).
    if user_id == group.get("creator_id") and not is_self_leave:
        raise HTTPException(status_code=400, detail="Impossible de retirer le créateur du groupe")

    now_iso = datetime.now(timezone.utc).isoformat()

    # Listes finales après le départ (calcul en Python pour éviter tout conflit
    # d'opérateurs sur le même champ dans un update MongoDB).
    remaining = [m for m in group.get("member_ids", []) if m != user_id]
    new_admins = [a for a in group.get("admin_ids", []) if a != user_id]

    # Si plus personne ne reste, on supprime le groupe et ses messages.
    if not remaining:
        await db.group_chats.delete_one({"id": group_id})
        await db.group_messages.delete_many({"group_id": group_id})
        return {"success": True, "message": "Group deleted (last member left)"}

    set_fields = {
        "member_ids": remaining,
        "admin_ids": new_admins,
        "updated_at": now_iso,
    }

    # Si le créateur quitte, on transfère la propriété à un autre membre
    # (de préférence un admin existant) pour ne pas laisser le groupe orphelin.
    if user_id == group.get("creator_id"):
        new_owner = new_admins[0] if new_admins else remaining[0]
        set_fields["creator_id"] = new_owner
        if new_owner not in new_admins:
            new_admins.append(new_owner)
            set_fields["admin_ids"] = new_admins

    await db.group_chats.update_one({"id": group_id}, {"$set": set_fields})

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
        enrich_post_poll(post, current_user["id"])
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
        "author_is_verified": current_user.get("is_verified", False),
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
        enrich_post_poll(post, current_user["id"])
        posts.append(Post(**post))

    return posts


async def compute_trending_hashtags(limit: int = 10):
    """
    Calcule les hashtags tendance EN DIRECT à partir des vraies publications.
    Fenêtre glissante 24h : seuls les posts des dernières 24h comptent, donc un
    hashtag sort automatiquement des tendances et est remplacé au-delà de 24h.
    Score = (#posts 24h * 3) + (likes * 0.1)
    Aucun cron requis : la tendance reflète toujours l'état réel de la base.
    """
    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()

    # Fenêtre glissante 24h : on ne considère QUE les posts des dernières 24h,
    # donc un hashtag sort automatiquement des tendances passé ce délai.
    recent_posts = await db.posts.find(
        {"created_at": {"$gte": since_24h}}
    ).sort("created_at", -1).limit(3000).to_list(length=3000)

    stats: Dict[str, dict] = {}
    for post in recent_posts:
        content = post.get("content") or ""
        likes = post.get("likes_count", 0) or 0

        seen = set()
        for raw_tag in re.findall(r'#(\w+)', content):
            key = raw_tag.lower()
            if key in seen:
                continue
            seen.add(key)
            entry = stats.setdefault(key, {"display": raw_tag, "count": 0, "likes": 0})
            entry["count"] += 1
            entry["likes"] += likes

    trending = []
    for key, entry in stats.items():
        score = (entry["count"] * 3.0) + (entry["likes"] * 0.1)
        trending.append({
            "tag": f"#{entry['display']}",
            "normalized": key,
            "post_count": entry["count"],
            "posts_24h": entry["count"],
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
        enrich_post_poll(post, current_user["id"])
        posts.append(Post(**post))

    return posts


# ==================== ANALYTICS PERSONNEL (créateur) ====================
# Chaque utilisateur voit UNIQUEMENT les statistiques de SON PROPRE compte.
# Les dates (created_at) sont stockées en chaînes ISO 8601 : la comparaison
# lexicographique est donc valide pour filtrer par période.

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _start_of_day_iso() -> str:
    now = _utc_now()
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def _days_ago_iso(days: int) -> str:
    return (_utc_now() - timedelta(days=days)).isoformat()


async def _my_post_ids(user_id: str) -> List[str]:
    """Identifiants des publications de l'utilisateur."""
    ids = []
    async for p in db.posts.find({"author_id": user_id}, {"id": 1}):
        pid = p.get("id")
        if pid:
            ids.append(pid)
    return ids


@api_router.get("/analytics/me/stats")
async def analytics_my_stats(current_user: dict = Depends(get_current_user)):
    """Statistiques du compte de l'utilisateur connecté (temps réel)."""
    uid = current_user["id"]
    start_today = _start_of_day_iso()

    my_posts = await db.posts.find({"author_id": uid}).to_list(length=100000)
    total_posts = len(my_posts)
    total_likes = sum((p.get("likes_count") or 0) for p in my_posts)
    total_comments = sum((p.get("comments_count") or 0) for p in my_posts)
    total_views = sum((p.get("views") or 0) for p in my_posts)
    posts_today = sum(1 for p in my_posts if (p.get("created_at") or "") >= start_today)

    followers_count = await db.follows.count_documents({"followed_id": uid})
    following_count = await db.follows.count_documents({"follower_id": uid})
    new_followers_today = await db.follows.count_documents(
        {"followed_id": uid, "created_at": {"$gte": start_today}}
    )

    interactions = total_likes + total_comments
    engagement_rate = round(interactions / total_posts, 1) if total_posts else 0.0

    return {
        "total_posts": total_posts,
        "posts_today": posts_today,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "total_views": total_views,
        "followers_count": followers_count,
        "following_count": following_count,
        "new_followers_today": new_followers_today,
        "engagement_rate": engagement_rate,
    }


@api_router.get("/analytics/me/trends")
async def analytics_my_trends(
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
):
    """Croissance quotidienne du compte : posts publiés, likes et commentaires
    reçus, nouveaux abonnés — sur N jours."""
    uid = current_user["id"]
    since = _days_ago_iso(days)
    my_ids = await _my_post_ids(uid)

    async def daily_counts(collection, match):
        match = {**match, "created_at": {"$gte": since}}
        pipeline = [
            {"$match": match},
            {"$group": {"_id": {"$substrBytes": ["$created_at", 0, 10]}, "n": {"$sum": 1}}},
        ]
        out = {}
        async for row in collection.aggregate(pipeline):
            out[row["_id"]] = row["n"]
        return out

    posts_by_day = await daily_counts(db.posts, {"author_id": uid})
    followers_by_day = await daily_counts(db.follows, {"followed_id": uid})
    if my_ids:
        likes_by_day = await daily_counts(db.likes, {"post_id": {"$in": my_ids}})
        comments_by_day = await daily_counts(db.comments, {"post_id": {"$in": my_ids}})
    else:
        likes_by_day, comments_by_day = {}, {}

    today = _utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
    series = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        series.append({
            "date": d[5:],  # MM-DD, plus lisible sur le graphe
            "posts": posts_by_day.get(d, 0),
            "likes": likes_by_day.get(d, 0),
            "comments": comments_by_day.get(d, 0),
            "followers": followers_by_day.get(d, 0),
        })
    return series


@api_router.get("/analytics/me/top-posts")
async def analytics_my_top_posts(
    limit: int = Query(10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Publications les plus engageantes de l'utilisateur."""
    uid = current_user["id"]
    raw = await db.posts.find({"author_id": uid}).to_list(length=5000)

    scored = []
    for p in raw:
        likes = p.get("likes_count", 0) or 0
        comments = p.get("comments_count", 0) or 0
        views = p.get("views", 0) or 0
        score = likes * 2 + comments * 3 + views * 0.1
        scored.append({
            "post_id": p.get("id"),
            "content": (p.get("content") or "")[:200],
            "likes_count": likes,
            "comments_count": comments,
            "views": views,
            "created_at": p.get("created_at"),
            "engagement_score": score,
        })
    scored.sort(key=lambda x: x["engagement_score"], reverse=True)
    return scored[:limit]


@api_router.get("/analytics/me/activity/hourly")
async def analytics_my_hourly(
    days: int = Query(30, ge=1, le=90),
    current_user: dict = Depends(get_current_user),
):
    """Quand l'audience interagit avec mon contenu : likes et commentaires reçus
    par heure de la journée (0-23), plus mes publications par heure."""
    uid = current_user["id"]
    since = _days_ago_iso(days)
    my_ids = await _my_post_ids(uid)

    async def by_hour(collection, match):
        match = {**match, "created_at": {"$gte": since}}
        pipeline = [
            {"$match": match},
            {"$group": {"_id": {"$substrBytes": ["$created_at", 11, 2]}, "n": {"$sum": 1}}},
        ]
        out = {}
        async for row in collection.aggregate(pipeline):
            try:
                out[int(row["_id"])] = row["n"]
            except (ValueError, TypeError):
                continue
        return out

    posts_h = await by_hour(db.posts, {"author_id": uid})
    if my_ids:
        likes_h = await by_hour(db.likes, {"post_id": {"$in": my_ids}})
        comments_h = await by_hour(db.comments, {"post_id": {"$in": my_ids}})
    else:
        likes_h, comments_h = {}, {}

    result = []
    for h in range(24):
        result.append({"hour": h, "type": "posts", "activity_count": posts_h.get(h, 0)})
        result.append({"hour": h, "type": "comments", "activity_count": comments_h.get(h, 0)})
        result.append({"hour": h, "type": "likes", "activity_count": likes_h.get(h, 0)})
    return result


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


@api_router.post("/clips", response_model=Post)
async def create_clip(
    file: UploadFile = File(...),
    caption: str = Form(""),
    current_user: dict = Depends(get_current_user),
):
    """
    Créer un Clip / Reel : la vidéo uploadée est stockée comme publication vidéo,
    ce qui la fait apparaître dans le fil Nexus Clips (GET /api/clips) et le feed.
    """
    if not (file.content_type or "").startswith("video/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une vidéo")

    contents = await file.read()
    media_url = f"data:{file.content_type};base64," + base64.b64encode(contents).decode("utf-8")

    clip_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    clip_to_insert = {
        "id": clip_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "author_is_verified": current_user.get("is_verified", False),
        "content": caption,
        "media_type": "video",
        "media_url": media_url,
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "views": 0,
        "created_at": now.isoformat(),
    }
    await db.posts.insert_one(clip_to_insert)

    clip = convert_mongo_doc_to_dict(clip_to_insert)
    clip["is_liked"] = False
    return Post(**clip)


@api_router.get("/adsense")
async def get_adsense_config():
    """Config AdSense côté client (vide par défaut => aucune pub)."""
    return {
        "client": os.environ.get("ADSENSE_CLIENT", ""),
        "slot": os.environ.get("ADSENSE_SLOT", ""),
    }


@api_router.post("/clips/{clip_id}/view")
async def register_clip_view(clip_id: str, current_user: dict = Depends(get_current_user)):
    """Incrémente le compteur de vues d'un clip (best-effort)."""
    result = await db.posts.update_one({"id": clip_id}, {"$inc": {"views": 1}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Clip introuvable")
    post = await db.posts.find_one({"id": clip_id})
    return {"success": True, "views": (post or {}).get("views", 0)}


@api_router.get("/feed/foryou", response_model=List[Post])
async def for_you_feed(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """
    Feed "Pour toi" : mélange les publications des comptes suivis et les
    contenus tendance (fort engagement), classés par un score d'engagement
    pondéré avec un bonus de personnalisation pour les comptes suivis.

    Le score est calculé côté base via un pipeline d'agrégation (plus efficace
    qu'un chargement massif suivi d'un tri en mémoire).
    """
    limit = max(1, min(limit, 100))

    # Comptes suivis (formats followed_id et following_id supportés)
    follows_raw = await db.follows.find({
        "follower_id": current_user["id"],
        "status": "following"
    }).to_list(length=1000)
    followed_ids = []
    for f in follows_raw:
        fid = f.get("followed_id") or f.get("following_id")
        if fid:
            followed_ids.append(fid)

    pipeline = [
        {"$addFields": {
            "engagement_score": {
                "$add": [
                    {"$multiply": [{"$ifNull": ["$likes_count", 0]}, 2]},
                    {"$multiply": [{"$ifNull": ["$comments_count", 0]}, 3]},
                    {"$multiply": [{"$ifNull": ["$shares_count", 0]}, 4]},
                    # Bonus de personnalisation : les comptes suivis remontent
                    {"$cond": [{"$in": ["$author_id", followed_ids]}, 15, 0]},
                ]
            }
        }},
        {"$sort": {"engagement_score": -1, "created_at": -1}},
        {"$limit": limit},
    ]

    posts_raw = await db.posts.aggregate(pipeline).to_list(length=limit)

    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        enrich_post_poll(post, current_user["id"])
        posts.append(Post(**post))

    return posts

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
