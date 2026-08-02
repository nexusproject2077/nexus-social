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
import asyncio
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

# Modération auto gratuite (toxic-bert + NudeNet) — optionnelle et fail-open :
# si le module ou ses dépendances (transformers/torch, nudenet) manquent, rien
# n'est filtré et l'application fonctionne normalement.
try:
    from backend import moderation
except ImportError:
    try:
        from app.backend import moderation
    except ImportError:
        try:
            import moderation
        except ImportError:
            moderation = None
            print("⚠️ Module 'moderation' introuvable — modération auto désactivée")

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

# Blocage GLOBAL de l'UE (HTTP 451 sur tout le site). Optionnel. On peut le
# désactiver (EU_GEO_BLOCK_ENABLED=false) tout en gardant la géolocalisation
# active, pour n'appliquer qu'un blocage granulaire (ex : Nexus Clips).
EU_GEO_BLOCK_ENABLED = os.environ.get("EU_GEO_BLOCK_ENABLED", "true").lower() == "true"
# Blocage PAR CLIP : les clips marqués eu_blocked sont masqués/refusés aux
# visiteurs de l'UE (indépendant du blocage global). Nécessite une base GeoIP.
CLIPS_EU_GEO_BLOCK = os.environ.get("CLIPS_EU_GEO_BLOCK", "true").lower() == "true"
GEOIP_DB_PATH = os.environ.get("GEOIP_DB_PATH", str(ROOT_DIR / "GeoLite2-Country.mmdb"))

# Téléchargement automatique de la base GeoLite2 (option pratique pour les dépôts
# publics : ne pas commiter le .mmdb, le récupérer au démarrage). Si la base est
# absente et qu'une clé de licence MaxMind (gratuite) est fournie via
# MAXMIND_LICENSE_KEY, on la télécharge et on l'extrait vers GEOIP_DB_PATH.
MAXMIND_LICENSE_KEY = os.environ.get("MAXMIND_LICENSE_KEY", "")
MAXMIND_EDITION = os.environ.get("MAXMIND_EDITION", "GeoLite2-Country")


def _download_geolite2_db(dest_path: str, license_key: str, edition: str = "GeoLite2-Country") -> bool:
    """Télécharge l'archive GeoLite2 chez MaxMind et extrait le .mmdb vers dest_path.

    Renvoie True en cas de succès. Best-effort : ne lève jamais (fail-open).
    """
    import urllib.request
    import tarfile
    import tempfile
    import shutil
    url = (
        "https://download.maxmind.com/app/geoip_download"
        f"?edition_id={edition}&license_key={license_key}&suffix=tar.gz"
    )
    tmp_archive = None
    try:
        print(f"⬇️ Téléchargement de la base GeoIP {edition} depuis MaxMind…")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tar.gz") as tmp:
            tmp_archive = tmp.name
            with urllib.request.urlopen(url, timeout=60) as resp:
                shutil.copyfileobj(resp, tmp)
        # L'archive contient .../GeoLite2-XXX_YYYYMMDD/GeoLite2-XXX.mmdb
        with tarfile.open(tmp_archive, "r:gz") as tar:
            member = next((m for m in tar.getmembers() if m.name.endswith(".mmdb")), None)
            if member is None:
                print("⚠️ Archive MaxMind sans fichier .mmdb — téléchargement ignoré")
                return False
            src = tar.extractfile(member)
            if src is None:
                return False
            os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
            with open(dest_path, "wb") as out:
                shutil.copyfileobj(src, out)
        print(f"✅ Base GeoIP installée : {dest_path}")
        return True
    except Exception as e:
        # Clé invalide, pas de réseau, quota MaxMind, etc. -> on continue sans geo-block.
        print(f"⚠️ Téléchargement GeoIP échoué ({e}) — géolocalisation désactivée")
        return False
    finally:
        if tmp_archive:
            try:
                os.remove(tmp_archive)
            except Exception:
                pass


if geoip2 is not None and not os.path.exists(GEOIP_DB_PATH) and MAXMIND_LICENSE_KEY:
    _download_geolite2_db(GEOIP_DB_PATH, MAXMIND_LICENSE_KEY, MAXMIND_EDITION)

# La base GeoIP est ouverte dès qu'elle est disponible, indépendamment du blocage
# global : elle sert aussi à la détection de langue et au geo-block par clip.
_geoip_reader = None
if geoip2 is not None and os.path.exists(GEOIP_DB_PATH):
    try:
        _geoip_reader = geoip2.database.Reader(GEOIP_DB_PATH)
        print(f"✅ Géolocalisation GeoIP active (base: {GEOIP_DB_PATH})")
    except Exception as e:
        print(f"⚠️ Impossible d'ouvrir la base GeoIP ({e}) — géolocalisation désactivée")
        _geoip_reader = None
else:
    print("⚠️ Base GeoLite2-Country.mmdb introuvable — géolocalisation désactivée (les requêtes passent normalement)")

if _geoip_reader is not None:
    print(f"   • blocage global UE : {'ON (451)' if EU_GEO_BLOCK_ENABLED else 'OFF'}")
    print(f"   • blocage clips UE  : {'ON' if CLIPS_EU_GEO_BLOCK else 'OFF'}")


@app.middleware("http")
async def eu_geo_block(request, call_next):
    """Retourne 451 aux visiteurs de l'UE, sauf sur les pages légales."""
    if EU_GEO_BLOCK_ENABLED and _geoip_reader is not None:
        path = request.url.path
        if not any(p in path for p in GEO_BLOCK_ALLOWED_PATHS) and is_eu_request(request):
            return JSONResponse(
                status_code=451,
                content={"error": "EU restricted - VPN/Tor required"}
            )
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
# Commission de la plateforme sur chaque cadeau reversé au créateur (Stripe Connect).
try:
    PLATFORM_FEE_PERCENT = max(0, min(100, int(os.environ.get("PLATFORM_FEE_PERCENT", "20"))))
except ValueError:
    PLATFORM_FEE_PERCENT = 20
STRIPE_ENABLED = bool(stripe and STRIPE_SECRET_KEY and STRIPE_PRICE_ID)
if STRIPE_ENABLED:
    stripe.api_key = STRIPE_SECRET_KEY
    print("✅ Stripe activé (abonnements)")
elif stripe is None:
    print("ℹ️ Stripe indisponible (SDK non installé) — abonnements désactivés")
else:
    print("ℹ️ Stripe désactivé (STRIPE_SECRET_KEY/STRIPE_PRICE_ID absents) — abonnements désactivés")

# Stripe Client (API V2) : utilisé pour Connect (comptes créateurs V2). Indépendant
# de STRIPE_PRICE_ID (Connect n'en a pas besoin) : suffit d'avoir la clé + un SDK récent.
try:
    from stripe import StripeClient as _StripeClient
except Exception:
    _StripeClient = None
stripe_client = _StripeClient(STRIPE_SECRET_KEY) if (_StripeClient and STRIPE_SECRET_KEY) else None


def _v2d(obj):
    """Objet Stripe V2 -> dict (support .to_dict / dict / passthrough)."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        try:
            return obj.to_dict()
        except Exception:
            pass
    return obj


def _v2_deep(obj, *keys, default=None):
    cur = _v2d(obj)
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = _v2d(cur.get(k))
    return cur if cur is not None else default


def _v2_transfers_active(account) -> bool:
    """Le compte connecté V2 peut-il recevoir des virements (capacité active) ?"""
    return _v2_deep(account, "configuration", "recipient", "capabilities",
                    "stripe_balance", "stripe_transfers", "status") == "active"

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


# ==================== WEB PUSH (notifications app fermée) ====================
# Clés VAPID lues dans l'environnement (à définir sur Render pour la prod).
# En leur absence, l'envoi push est un no-op propre : l'in-app + le temps réel
# WebSocket continuent de fonctionner normalement.
VAPID_PUBLIC_KEY  = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT     = os.environ.get("VAPID_SUBJECT", "mailto:contact@nexus-social.app").strip()

try:
    from pywebpush import webpush, WebPushException  # type: ignore
    _WEBPUSH_LIB = True
except Exception:
    _WEBPUSH_LIB = False

def _web_push_enabled() -> bool:
    return _WEBPUSH_LIB and bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def _push_content_for(notif_type, from_user, post_id=None, comment_content=None):
    """Titre / corps / URL cliquable d'une notification push, par type."""
    u = from_user.get("username", "Quelqu'un")
    uid = from_user.get("id", "")
    body = {
        "follow":          f"@{u} vous suit maintenant",
        "follow_request":  f"@{u} souhaite vous suivre",
        "follow_accepted": f"@{u} a accepté votre demande d'abonnement",
        "like":            f"@{u} a aimé votre publication",
        "like_clip":       f"@{u} a aimé votre clip",
        "like_story":      f"@{u} a aimé votre story",
        "comment":         f"@{u} a commenté" + (f" : {comment_content}" if comment_content else ""),
        "comment_reply":   f"@{u} a répondu à votre commentaire",
        "mention":         f"@{u} vous a mentionné",
        "tag":             f"@{u} vous a identifié",
        "live":            f"@{u} est en direct 🔴",
        "clip":            f"@{u} a publié un nouveau clip",
        "story":           f"@{u} a publié une nouvelle story",
        "story_reply":     f"@{u} a répondu à votre story",
        "story_reaction":  f"@{u} a réagi à votre story",
        "message":         f"Nouveau message de @{u}",
        "group_message":   f"@{u} a écrit dans un groupe",
        "message_request": f"@{u} veut vous envoyer un message",
        "trending":        "Votre publication est dans les tendances 🔥",
        "security":        "Connexion inhabituelle détectée sur votre compte",
    }.get(notif_type, f"@{u}")

    if notif_type in ("like", "like_clip", "like_story", "comment", "comment_reply",
                      "mention", "tag", "trending") and post_id:
        url = f"/post/{post_id}"
    elif notif_type == "clip":
        url = f"/nexus-clips/{post_id}" if post_id else "/nexus-clips"
    elif notif_type == "live":
        url = f"/live/{post_id}" if post_id else "/live"
    elif notif_type == "group_message":
        url = f"/messages/group/{post_id}" if post_id else "/messages"
    elif notif_type in ("message", "message_request"):
        url = f"/messages/{uid}" if uid else "/messages"
    elif notif_type in ("story", "story_reply", "story_reaction"):
        url = "/notifications"
    elif notif_type in ("follow", "follow_request", "follow_accepted"):
        url = f"/profil/{uid}" if uid else "/notifications"
    elif notif_type == "security":
        url = "/settings"
    else:
        url = "/notifications"
    return ("Nexus Social", body, url)


async def send_web_push(user_id: str, title: str, body: str, url: str = "/", tag: str = "nexus"):
    """Envoie une notification push (même app fermée) à tous les abonnements de
    l'utilisateur. Best-effort ; no-op si VAPID non configuré. Supprime les
    abonnements expirés (404/410)."""
    if not _web_push_enabled() or not user_id:
        return
    try:
        subs = await db.push_subscriptions.find({"user_id": user_id}).to_list(length=50)
    except Exception:
        return
    if not subs:
        return
    payload = json.dumps({"title": title, "body": (body or "")[:180], "url": url, "tag": tag})
    for s in subs:
        sub_info = s.get("subscription")
        if not sub_info:
            continue
        try:
            # pywebpush est synchrone : on l'exécute hors de la boucle asyncio.
            await asyncio.to_thread(
                webpush,
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                try:
                    await db.push_subscriptions.delete_one({"_id": s["_id"]})
                except Exception:
                    pass
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
        # Push navigateur (app fermée) — best-effort, no-op si VAPID absent.
        title, body, url = _push_content_for(notif_type, from_user, post_id, comment_content)
        await send_web_push(user_id, title, body, url, tag=notif_type)
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

    async def broadcast_viewers():
        conns = live_rooms.get(room_id, [])
        payload = json.dumps({"type": "viewers", "count": len(conns)})
        for c in list(conns):
            try:
                await c.send_text(payload)
            except Exception:
                pass

    await broadcast_viewers()  # nouveau spectateur → met à jour le compteur pour tous
    try:
        while True:
            data = await websocket.receive_text()
            # Relaie les messages (signaling WebRTC + chat/likes/gifts) aux autres pairs.
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
        else:
            await broadcast_viewers()  # départ → met à jour le compteur

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
    accent_color: Optional[str] = None
    theme: Optional[str] = None
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
    is_premium: bool = False  # membre Nexus Premium (badge + avantages)
    can_receive_tips: bool = False  # a un compte Stripe Connect → bouton Pourboire
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
    author_is_premium: bool = False  # badge Premium sur la publication (avantage réel)
    is_pinned: bool = False          # post épinglé en haut du profil (créateur Premium)
    content: str
    media_type: Optional[str] = None
    media_url: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    is_liked: bool = False
    is_saved: bool = False  # l'utilisateur courant a-t-il enregistré ce post/clip ?
    views: int = 0
    eu_blocked: bool = False  # clip restreint dans l'UE (geo-block Nexus Clips)
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
    author_is_verified: bool = False
    content: str
    likes_count: int = 0
    replies_count: int = 0
    is_liked: bool = False
    parent_comment_id: Optional[str] = None
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
    reply_to_id: Optional[str] = None
    read: bool = False
    reactions: List[dict] = []  # [{user_id, emoji, ...}] — sinon perdues au rechargement
    created_at: str
    expires_at: Optional[str] = None  # message éphémère : date d'auto-suppression

class Conversation(BaseModel):
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    last_message: str
    last_message_time: str
    unread_count: int = 0
    # Préférences personnelles (épingler / sourdine / marqué non lu) — façon Instagram.
    pinned: bool = False
    muted: bool = False
    marked_unread: bool = False

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


# ==================== MODÉRATION AUTOMATIQUE ====================
# Filtrage gratuit du contenu (toxicité via toxic-bert, NSFW via NudeNet). La
# logique lourde vit dans moderation.py ; ici on applique la politique métier :
#   • verdict "block" -> HTTP 400 (le contenu n'est jamais enregistré)
#   • verdict "flag"  -> le contenu est publié mais poussé en file de modération
#                        (db.moderation_queue) pour une revue humaine.
# Fail-open : si moderation est indisponible, on n'applique aucun filtre.

async def flag_for_review(kind: str, ref_id: str, author_id: str, text, verdict: dict, media_kind=None):
    """Ajoute un contenu signalé à la file de modération humaine."""
    await db.moderation_queue.insert_one({
        "id": str(uuid.uuid4()),
        "kind": kind,               # "post" | "comment" | "clip"
        "ref_id": ref_id,
        "author_id": author_id,
        "text": ((text or "")[:500]),
        "category": verdict.get("category"),
        "label": verdict.get("label"),
        "score": verdict.get("score"),
        "media_kind": media_kind,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def evaluate_content(text=None, media_url=None):
    """Analyse texte + média et renvoie le verdict le plus sévère (ou None si la
    modération est indisponible). NE lève JAMAIS — utilisé aussi pour scanner des
    contenus déjà publiés."""
    if moderation is None:
        return None
    verdicts = []
    if text and text.strip():
        verdicts.append(moderation.moderate_text(text))
    if media_url:
        verdicts.append(moderation.moderate_media(media_url))
    if not verdicts:
        return None
    return moderation.worst_verdict(*verdicts)


async def screen_content(text=None, media_url=None):
    """Comme evaluate_content, mais lève HTTP 400 si le contenu doit être bloqué.

    À appeler AVANT d'enregistrer le contenu ; si le verdict renvoyé vaut "flag",
    l'appelant enregistre le contenu puis appelle flag_for_review()."""
    worst = await evaluate_content(text=text, media_url=media_url)
    if worst and worst["action"] == "block":
        raise HTTPException(
            status_code=400,
            detail=f"Contenu refusé par la modération ({worst['category']}: {worst['label']})",
        )
    return worst


async def notify_content_removed(author_id: str, kind_label: str, verdict: dict):
    """Avertit l'auteur (notification) que son contenu a été retiré par la modération."""
    if not author_id:
        return
    cat = (verdict or {}).get("category", "nsfw")
    reason = ("contenu à caractère sexuel ou explicite" if cat == "nsfw"
              else "propos haineux ou toxiques" if cat == "toxicity"
              else "non-respect de nos règles")
    message = f"Votre {kind_label} a été supprimé(e) automatiquement : {reason}."
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": author_id,
            "type": "moderation",
            "from_user_id": author_id,          # système ; requis par le modèle
            "from_username": "Modération Nexus",
            "from_profile_pic": None,
            "comment_content": message,
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass
    # Notification temps réel (pastille + toast).
    await push_realtime(author_id, {"type": "notification", "data": {"message": message}})

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


def country_for_request(request: Request) -> Optional[str]:
    """Code pays ISO 3166-1 alpha-2 du visiteur (via GeoIP), ou None si indéterminé.

    Best-effort : ne lève jamais. Fonctionne dès qu'une base GeoIP est chargée,
    indépendamment du blocage global de l'UE (EU_GEO_BLOCK_ENABLED).
    """
    if _geoip_reader is None:
        return None
    try:
        return _geoip_reader.country(client_ip(request)).country.iso_code
    except Exception:
        # IP privée / introuvable dans la base → indéterminé (on laisse passer)
        return None


def is_eu_request(request: Request) -> bool:
    """True si le visiteur est géolocalisé dans un pays de l'UE (sinon False)."""
    country = country_for_request(request)
    return bool(country and country in EU_COUNTRIES)


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
    country = country_for_request(request)
    lang = lang_for_country(country)
    return {"country": country, "language": lang, "supported": sorted(SUPPORTED_UI_LANGS)}


@api_router.get("/geo/status")
async def geo_status(request: Request):
    """État géographique du visiteur pour adapter l'expérience.

    restricted=True pour l'UE (pas de pubs / pas de tracking, bandeau RGPD
    complet). Hors-UE : accès complet + bandeau cookies discret.
    Best-effort : si la base GeoIP est absente, on considère non-restreint.
    """
    country = country_for_request(request)
    restricted = bool(country and country in EU_COUNTRIES)
    return {"country": country, "restricted": restricted, "eu": restricted}


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


@api_router.put("/users/me/appearance")
async def update_appearance(
    appearance: dict,
    current_user: dict = Depends(get_current_user),
):
    """Enregistre la personnalisation (couleur d'accent, thème) côté serveur
    pour qu'elle suive l'utilisateur sur tous ses appareils/navigateurs."""
    update_data = {}
    accent = appearance.get("accent_color")
    theme = appearance.get("theme")
    if isinstance(accent, str) and accent.strip():
        update_data["accent_color"] = accent.strip()[:32]
    if isinstance(theme, str) and theme.strip():
        update_data["theme"] = theme.strip()[:32]
    if not update_data:
        raise HTTPException(status_code=400, detail="Aucune donnée valide")
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": current_user["id"]}, {"$set": update_data})
    return {"success": True, **update_data}


# ==================== BILLING (abonnements Stripe) ====================
@api_router.get("/billing/status")
async def billing_status(current_user: dict = Depends(get_current_user)):
    """Indique si les paiements sont configurés et l'état d'abonnement de l'utilisateur."""
    return {
        "enabled": STRIPE_ENABLED,
        "is_premium": bool(current_user.get("is_premium")),
        "subscription_status": current_user.get("subscription_status"),
    }


@api_router.get("/billing/plan")
async def billing_plan():
    """Infos publiques du plan Premium (prix réel Stripe) pour la page « Devenir
    Premium ». Public : pas d'auth requise. Ne renvoie jamais de prix inventé —
    si Stripe n'est pas branché, `enabled=false` et le prix est nul.
    """
    out = {"enabled": STRIPE_ENABLED, "amount": None, "currency": None, "interval": None}
    if STRIPE_ENABLED:
        try:
            price = stripe.Price.retrieve(STRIPE_PRICE_ID)
            out["amount"] = (price.get("unit_amount") or 0) / 100.0
            out["currency"] = (price.get("currency") or "eur").upper()
            rec = price.get("recurring") or {}
            out["interval"] = rec.get("interval")  # "month" | "year"
        except Exception as e:
            print(f"⚠️ billing_plan: prix Stripe illisible ({e})")
    return out


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


@api_router.post("/live/gift-checkout")
async def live_gift_checkout(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Crée une session Stripe Checkout (paiement unique) pour envoyer un cadeau
    payant pendant un direct. À la validation, le webhook enregistre le cadeau et
    le diffuse en temps réel à la room."""
    if not STRIPE_ENABLED:
        raise HTTPException(status_code=503, detail="Les paiements ne sont pas configurés")
    name = (data.get("name") or "Cadeau")[:40]
    emoji = (data.get("emoji") or "🎁")[:8]
    amount = int(data.get("amount_cents") or 0)
    room_id = (data.get("room_id") or "")[:120]
    if amount < 50:
        raise HTTPException(status_code=400, detail="Montant invalide")

    # L'hôte est encodé dans le room_id : "live_{host_id}_{timestamp}".
    parts = room_id.split("_")
    host_id = parts[1] if len(parts) >= 3 and parts[0] == "live" else None
    host = await db.users.find_one({"id": host_id}) if host_id else None

    # Reversement direct au créateur (Stripe Connect V2) avec commission plateforme,
    # si l'hôte a un compte connecté opérationnel. On vérifie la capacité EN DIRECT
    # (V2 accounts.retrieve) pour éviter de router vers un compte pas encore prêt.
    payment_intent_data = None
    host_ready = False
    if host and host.get("stripe_account_id") and host.get("id") != current_user["id"]:
        if stripe_client:
            try:
                acct = stripe_client.v2.core.accounts.retrieve(
                    host["stripe_account_id"], params={"include": ["configuration.recipient"]}
                )
                host_ready = _v2_transfers_active(acct)
            except Exception:
                host_ready = bool(host.get("stripe_charges_enabled"))
        else:
            host_ready = bool(host.get("stripe_charges_enabled"))
    if host_ready:
        fee = round(amount * PLATFORM_FEE_PERCENT / 100)
        payment_intent_data = {
            "application_fee_amount": fee,
            "transfer_data": {"destination": host["stripe_account_id"]},
        }
    try:
        kwargs = dict(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {"name": f"Cadeau Nexus — {name} {emoji}"},
                    "unit_amount": amount,
                },
                "quantity": 1,
            }],
            customer_email=current_user.get("email"),
            client_reference_id=current_user["id"],
            metadata={
                "type": "gift", "gift_name": name, "gift_emoji": emoji, "room_id": room_id,
                "from_user_id": current_user["id"], "from_username": current_user["username"],
                "host_id": host_id or "",
            },
            success_url=f"{FRONTEND_URL}/live/{room_id}?gift_sent=1",
            cancel_url=f"{FRONTEND_URL}/live/{room_id}?gift_cancel=1",
        )
        if payment_intent_data:
            kwargs["payment_intent_data"] = payment_intent_data
        session = stripe.checkout.Session.create(**kwargs)
        return {"url": session.url}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Stripe: {e}")


@api_router.post("/users/{user_id}/tip-checkout")
async def tip_checkout(user_id: str, data: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Crée une session Stripe Checkout (paiement unique) pour laisser un
    POURBOIRE (Tip) à un créateur depuis son profil. Le montant est reversé au
    créateur via Stripe Connect après commission de la plateforme.
    """
    if not STRIPE_ENABLED:
        raise HTTPException(status_code=503, detail="Les paiements ne sont pas configurés")
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous envoyer un pourboire")
    amount = int(data.get("amount_cents") or 0)
    if amount < 100:
        raise HTTPException(status_code=400, detail="Montant minimum : 1 €")

    creator = await db.users.find_one({"id": user_id})
    if not creator:
        raise HTTPException(status_code=404, detail="Créateur introuvable")

    # Le créateur doit avoir un compte Connect opérationnel pour recevoir le tip.
    ready = False
    if creator.get("stripe_account_id"):
        if stripe_client:
            try:
                acct = stripe_client.v2.core.accounts.retrieve(
                    creator["stripe_account_id"], params={"include": ["configuration.recipient"]}
                )
                ready = _v2_transfers_active(acct)
            except Exception:
                ready = bool(creator.get("stripe_charges_enabled"))
        else:
            ready = bool(creator.get("stripe_charges_enabled"))
    if not ready:
        raise HTTPException(status_code=400, detail="Ce créateur n'a pas encore activé les pourboires")

    fee = round(amount * PLATFORM_FEE_PERCENT / 100)
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {"name": f"Pourboire à @{creator.get('username')} sur Nexus"},
                    "unit_amount": amount,
                },
                "quantity": 1,
            }],
            customer_email=current_user.get("email"),
            client_reference_id=current_user["id"],
            metadata={
                "type": "tip",
                "from_user_id": current_user["id"], "from_username": current_user["username"],
                "creator_id": user_id,
            },
            payment_intent_data={
                "application_fee_amount": fee,
                "transfer_data": {"destination": creator["stripe_account_id"]},
            },
            success_url=f"{FRONTEND_URL}/profil/{user_id}?tip=success",
            cancel_url=f"{FRONTEND_URL}/profil/{user_id}?tip=cancel",
        )
        return {"url": session.url}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Stripe: {e}")


# ── Stripe Connect (API V2) : reversement direct aux créateurs (payout TikTok) ──
# Comptes connectés créés avec l'API V2 (dashboard Express, plateforme = fees/losses
# collector, capacité stripe_transfers). Le statut est lu EN DIRECT via l'API.
@api_router.get("/billing/connect/status")
async def connect_status(current_user: dict = Depends(get_current_user)):
    """État du compte connecté V2 du créateur (peut-il recevoir des virements ?)."""
    acct_id = current_user.get("stripe_account_id")
    if not (stripe_client and acct_id):
        return {"enabled": bool(stripe_client), "connected": False, "charges_enabled": False, "fee_percent": PLATFORM_FEE_PERCENT}
    try:
        acct = stripe_client.v2.core.accounts.retrieve(
            acct_id, params={"include": ["configuration.recipient", "requirements"]}
        )
        ready = _v2_transfers_active(acct)
        req_status = _v2_deep(acct, "requirements", "summary", "minimum_deadline", "status")
        onboarding_complete = req_status not in ("currently_due", "past_due")
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"stripe_charges_enabled": bool(ready)}})
        return {"enabled": True, "connected": True, "charges_enabled": bool(ready),
                "onboarding_complete": bool(onboarding_complete), "fee_percent": PLATFORM_FEE_PERCENT}
    except Exception:
        return {"enabled": True, "connected": True, "charges_enabled": bool(current_user.get("stripe_charges_enabled")), "fee_percent": PLATFORM_FEE_PERCENT}


@api_router.post("/billing/connect/onboard")
async def connect_onboard(current_user: dict = Depends(get_current_user)):
    """Crée (ou réutilise) un compte connecté **V2** (Express) pour le créateur et
    renvoie le lien d'onboarding (KYC/IBAN)."""
    if not stripe_client:
        raise HTTPException(status_code=503, detail="Les paiements ne sont pas configurés")
    acct_id = current_user.get("stripe_account_id")
    try:
        if not acct_id:
            account = stripe_client.v2.core.accounts.create(params={
                "display_name": current_user.get("username") or current_user.get("email") or "Créateur Nexus",
                "contact_email": current_user.get("email"),
                "identity": {"country": "fr"},          # pays de l'entité (app FR)
                "dashboard": "express",                  # dashboard Express géré par Stripe
                "defaults": {"responsibilities": {"fees_collector": "application", "losses_collector": "application"}},
                "configuration": {"recipient": {"capabilities": {"stripe_balance": {"stripe_transfers": {"requested": True}}}}},
                "metadata": {"user_id": current_user["id"]},
            })
            acct_id = _v2d(account).get("id") or getattr(account, "id", None)
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"stripe_account_id": acct_id}})
        link = stripe_client.v2.core.account_links.create(params={
            "account": acct_id,
            "use_case": {
                "type": "account_onboarding",
                "account_onboarding": {
                    "configurations": ["recipient"],
                    "refresh_url": f"{FRONTEND_URL}/settings?connect=refresh",
                    "return_url": f"{FRONTEND_URL}/settings?connect=done",
                },
            },
        })
        return {"url": _v2d(link).get("url") or getattr(link, "url", None)}
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
    meta = obj.get("metadata") or {}

    # ── Stripe Connect : le compte créateur devient (in)opérant ──
    if etype == "account.updated":
        await db.users.update_one(
            {"stripe_account_id": obj.get("id")},
            {"$set": {"stripe_charges_enabled": bool(obj.get("charges_enabled"))}},
        )
        return {"received": True}

    # ── Cadeau payant en direct : on enregistre + on diffuse à la room ──
    if etype == "checkout.session.completed" and meta.get("type") == "gift":
        room_id = meta.get("room_id")
        gift = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "from_user_id": meta.get("from_user_id"),
            "from_username": meta.get("from_username"),
            "gift_name": meta.get("gift_name"),
            "gift_emoji": meta.get("gift_emoji"),
            "amount_total": obj.get("amount_total"),
            "currency": obj.get("currency"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await db.live_gifts.insert_one(dict(gift))
        except Exception:
            pass
        if room_id and room_id in live_rooms:
            payload = json.dumps({"type": "gift", "from": gift["from_username"], "emoji": gift["gift_emoji"], "name": gift["gift_name"], "paid": True})
            for c in list(live_rooms.get(room_id, [])):
                try:
                    await c.send_text(payload)
                except Exception:
                    pass
        return {"received": True}

    # Pourboire (Tip) reçu depuis un profil : on l'enregistre et on notifie le créateur.
    if etype == "checkout.session.completed" and meta.get("type") == "tip":
        creator_id = meta.get("creator_id")
        amount_total = obj.get("amount_total") or 0
        try:
            await db.tips.insert_one({
                "id": str(uuid.uuid4()),
                "creator_id": creator_id,
                "from_user_id": meta.get("from_user_id"),
                "from_username": meta.get("from_username"),
                "amount_total": amount_total,
                "currency": obj.get("currency"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        if creator_id:
            try:
                amount_eur = f"{(amount_total or 0) / 100:.2f} €"
                notif_id = str(uuid.uuid4())
                await db.notifications.insert_one({
                    "id": notif_id,
                    "user_id": creator_id,
                    "type": "tip",
                    "from_user_id": meta.get("from_user_id"),
                    "from_username": meta.get("from_username"),
                    "comment_content": f"vous a envoyé un pourboire de {amount_eur} 💸",
                    "read": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                await push_realtime(creator_id, {"type": "notification"})
            except Exception:
                pass
        return {"received": True}

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
    # Modération auto (toxicité + NSFW) : bloque le contenu interdit avant insertion.
    verdict = await screen_content(text=post_data.content, media_url=post_data.media_url)

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

    # Contenu limite (verdict "flag") : publié mais soumis à revue humaine.
    if verdict and verdict["action"] == "flag":
        await flag_for_review("post", post_id, current_user["id"], post_data.content,
                              verdict, media_kind=post_data.media_type)

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
    saved_ids = await _saved_post_ids(current_user["id"], [p.get("id") for p in posts_raw])
    premium_ids = await _premium_author_ids([p.get("author_id") for p in posts_raw])
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        post["is_saved"] = post["id"] in saved_ids
        post["author_is_premium"] = post.get("author_id") in premium_ids
        enrich_post_poll(post, current_user["id"])
        posts.append(Post(**post))

    return posts

# IMPORTANT : cette route doit être déclarée AVANT `/posts/{post_id}`, sinon
# FastAPI interprète « saved » comme un post_id et renvoie 404.
@api_router.get("/posts/saved", response_model=List[Post])
async def get_saved_posts(current_user: dict = Depends(get_current_user)):
    """Liste les publications et clips enregistrés par l'utilisateur (plus récents
    d'abord), pour la page « Enregistrés »."""
    saved = await db.saved_posts.find(
        {"user_id": current_user["id"]}
    ).sort("created_at", -1).limit(200).to_list(length=200)
    order = [s.get("post_id") for s in saved]
    if not order:
        return []
    raw = await db.posts.find({"id": {"$in": order}}).to_list(length=len(order))
    by_id = {p.get("id"): p for p in raw}
    liked = {l.get("post_id") for l in await db.likes.find(
        {"post_id": {"$in": order}, "user_id": current_user["id"]}, {"post_id": 1}
    ).to_list(length=len(order))}
    premium_ids = await _premium_author_ids([p.get("author_id") for p in raw])
    out = []
    for pid in order:  # conserve l'ordre d'enregistrement (plus récent d'abord)
        p_raw = by_id.get(pid)
        if not p_raw:
            continue  # post supprimé entre-temps → ignoré
        p = convert_mongo_doc_to_dict(p_raw)
        p["is_liked"] = pid in liked
        p["is_saved"] = True
        p["author_is_premium"] = p.get("author_id") in premium_ids
        enrich_post_poll(p, current_user["id"])
        out.append(Post(**p))
    return out

@api_router.get("/posts/{post_id}", response_model=Post)
async def get_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère un post spécifique"""
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")

    post = convert_mongo_doc_to_dict(post_raw)
    like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
    post["is_liked"] = bool(like_raw)
    post["is_saved"] = bool(await db.saved_posts.find_one({"post_id": post["id"], "user_id": current_user["id"]}))
    author = await db.users.find_one({"id": post.get("author_id")}, {"is_premium": 1})
    post["author_is_premium"] = bool(author and author.get("is_premium"))
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


async def _saved_post_ids(user_id, post_ids):
    """Ensemble des post_ids (parmi ceux fournis) enregistrés par l'utilisateur.

    Batch en une requête pour enrichir une liste sans N+1.
    """
    if not post_ids:
        return set()
    rows = await db.saved_posts.find(
        {"user_id": user_id, "post_id": {"$in": list(post_ids)}}, {"post_id": 1}
    ).to_list(length=len(post_ids))
    return {r.get("post_id") for r in rows}


async def _premium_author_ids(author_ids):
    """Sous-ensemble des author_ids qui sont membres Premium (badge sur les posts).

    Batch en une requête (pas de N+1). Le statut Premium étant dynamique, on le
    lit au moment de l'affichage plutôt que de le figer dans le post.
    """
    ids = [a for a in set(author_ids or []) if a]
    if not ids:
        return set()
    rows = await db.users.find(
        {"id": {"$in": ids}, "is_premium": True}, {"id": 1}
    ).to_list(length=len(ids))
    return {r.get("id") for r in rows}


@api_router.post("/posts/{post_id}/save")
async def save_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Enregistre / retire des enregistrements un post ou un clip (façon signet)."""
    post_raw = await db.posts.find_one({"id": post_id}, {"id": 1})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")

    existing = await db.saved_posts.find_one({"post_id": post_id, "user_id": current_user["id"]})
    if existing:
        await db.saved_posts.delete_one({"post_id": post_id, "user_id": current_user["id"]})
        return {"saved": False}

    await db.saved_posts.insert_one({
        "id": str(uuid.uuid4()),
        "post_id": post_id,
        "user_id": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"saved": True}


@api_router.post("/posts/{post_id}/pin")
async def pin_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Épingle / désépingle un de ses posts en haut du profil.

    Avantage créateur Premium : réservé à l'auteur ET aux membres Premium. Un
    seul post épinglé à la fois (épingler un nouveau désépingle l'ancien).
    """
    post = await db.posts.find_one({"id": post_id}, {"author_id": 1, "pinned": 1})
    if not post:
        raise HTTPException(status_code=404, detail="Post introuvable")
    if post.get("author_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Action réservée à l'auteur")
    if not current_user.get("is_premium"):
        raise HTTPException(status_code=403, detail="Épingler un post est réservé aux membres Premium")

    if post.get("pinned"):
        await db.posts.update_one({"id": post_id}, {"$set": {"pinned": False}})
        return {"pinned": False}
    # Un seul post épinglé : on retire l'épingle des autres posts de l'auteur.
    await db.posts.update_many(
        {"author_id": current_user["id"], "pinned": True}, {"$set": {"pinned": False}}
    )
    await db.posts.update_one({"id": post_id}, {"$set": {"pinned": True}})
    return {"pinned": True}


@api_router.get("/posts/{post_id}/comments", response_model=List[Comment])
async def get_post_comments(post_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les commentaires d'un post"""
    comments_raw = await db.comments.find({"post_id": post_id}).sort("created_at", -1).to_list(length=100)

    comment_ids = [c.get("id") for c in comments_raw]
    liked_ids = set()
    if comment_ids:
        likes = await db.comment_likes.find(
            {"comment_id": {"$in": comment_ids}, "user_id": current_user["id"]}
        ).to_list(length=len(comment_ids))
        liked_ids = {l.get("comment_id") for l in likes}

    comments = []
    for comment_raw in comments_raw:
        comment = convert_mongo_doc_to_dict(comment_raw)
        comment["is_liked"] = comment.get("id") in liked_ids
        comments.append(Comment(**comment))

    return comments

@api_router.post("/posts/{post_id}/comments", response_model=Comment)
async def create_comment(post_id: str, comment_data: CommentCreate, current_user: dict = Depends(get_current_user)):
    """Ajoute un commentaire à un post"""
    post_raw = await db.posts.find_one({"id": post_id})
    if not post_raw:
        raise HTTPException(status_code=404, detail="Post not found")

    # Modération auto du texte du commentaire (toxicité).
    verdict = await screen_content(text=comment_data.content)

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

    if verdict and verdict["action"] == "flag":
        await flag_for_review("comment", comment_id, current_user["id"],
                              comment_data.content, verdict)

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
    await db.comment_replies.delete_many({"parent_comment_id": comment_id})
    await db.comment_likes.delete_many({"comment_id": comment_id})
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
        # Notifier l'auteur du commentaire (jamais soi-même).
        comment = convert_mongo_doc_to_dict(comment_raw)
        await create_notification(
            comment.get("author_id"), "comment_like", current_user,
            post_id=comment.get("post_id"), comment_content=comment.get("content"),
        )
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

    # Notifier l'auteur du commentaire parent (jamais soi-même).
    parent = convert_mongo_doc_to_dict(comment_raw)
    await create_notification(
        parent.get("author_id"), "comment_reply", current_user,
        post_id=parent.get("post_id"), comment_content=reply_data.content,
    )

    reply = convert_mongo_doc_to_dict(reply_to_insert)
    return Comment(**reply)

@api_router.delete("/comments/{comment_id}/replies/{reply_id}")
async def delete_comment_reply(comment_id: str, reply_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime une réponse (uniquement par son auteur)."""
    reply_raw = await db.comment_replies.find_one({"id": reply_id, "parent_comment_id": comment_id})
    if not reply_raw:
        raise HTTPException(status_code=404, detail="Reply not found")
    reply = convert_mongo_doc_to_dict(reply_raw)
    if reply["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.comment_replies.delete_one({"id": reply_id})
    await db.comments.update_one({"id": comment_id}, {"$inc": {"replies_count": -1}})
    return {"message": "Reply deleted successfully"}

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
        is_premium=user.get("is_premium", False),
        can_receive_tips=bool(user.get("stripe_account_id")),
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
    # Post épinglé d'abord (créateur Premium), puis du plus récent au plus ancien.
    posts_raw = await db.posts.find(
        {"author_id": user_id, "repost_of": None}
    ).sort([("pinned", -1), ("created_at", -1)]).to_list(length=50)

    # Statut Premium de l'auteur (badge sur ses posts) : une seule lecture.
    author = await db.users.find_one({"id": user_id}, {"is_premium": 1})
    author_premium = bool(author and author.get("is_premium"))

    posts = []
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        post["author_is_premium"] = author_premium
        post["is_pinned"] = bool(post.get("pinned"))
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


@api_router.delete("/users/{user_id}/follow")
async def unfollow_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Se désabonner explicitement (et annuler une éventuelle demande en attente)."""
    result = await db.follows.delete_one({"follower_id": current_user["id"], "followed_id": user_id})
    if result.deleted_count:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"following_count": -1}})
        await db.users.update_one({"id": user_id}, {"$inc": {"followers_count": -1}})
    # Annule aussi une demande d'abonnement en attente, le cas échéant.
    await db.follow_requests.delete_many({"requester_id": current_user["id"], "target_id": user_id})
    await db.notifications.delete_many({"type": "follow_request", "from_user_id": current_user["id"], "user_id": user_id})
    return {"following": False, "status": "not_following"}


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


async def _enrich_user_list(user_ids: List[str], viewer_id: str) -> List[dict]:
    """Renvoie les infos publiques d'une liste d'utilisateurs, avec, pour
    chacun, si le visiteur (viewer) le suit déjà — pour l'affichage des
    boutons Suivre/Abonné dans les listes d'abonnés/abonnements."""
    if not user_ids:
        return []
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "password": 0},
    ).to_list(length=len(user_ids))
    # Qui, parmi cette liste, le viewer suit-il déjà ?
    followed = await db.follows.find(
        {"follower_id": viewer_id, "followed_id": {"$in": user_ids}},
    ).to_list(length=len(user_ids))
    followed_set = {f.get("followed_id") for f in followed}
    by_id = {u["id"]: u for u in users}
    out = []
    for uid in user_ids:  # préserve l'ordre (plus récents d'abord)
        u = by_id.get(uid)
        if not u:
            continue
        out.append({
            "id": u["id"],
            "username": u.get("username"),
            "profile_pic": u.get("profile_pic"),
            "is_verified": u.get("is_verified", False),
            "bio": u.get("bio", ""),
            "is_following": uid in followed_set,
            "is_self": uid == viewer_id,
        })
    return out


async def _can_view_follow_lists(target_id: str, viewer_id: str) -> bool:
    """Compte public → tout le monde ; compte privé → soi-même ou abonné approuvé."""
    if target_id == viewer_id:
        return True
    target = await db.users.find_one({"id": target_id}, {"is_private": 1})
    if not target or not target.get("is_private"):
        return True
    return await check_is_following(viewer_id, target_id)


@api_router.get("/users/{user_id}/followers")
async def list_followers(user_id: str, current_user: dict = Depends(get_current_user)):
    """Liste des abonnés (ceux qui suivent user_id), plus récents d'abord."""
    if not await _can_view_follow_lists(user_id, current_user["id"]):
        raise HTTPException(status_code=403, detail="Compte privé")
    rows = await db.follows.find({"followed_id": user_id}).sort("created_at", -1).to_list(length=2000)
    ids = [r.get("follower_id") for r in rows if r.get("follower_id")]
    return await _enrich_user_list(ids, current_user["id"])


@api_router.get("/users/{user_id}/following")
async def list_following(user_id: str, current_user: dict = Depends(get_current_user)):
    """Liste des abonnements (ceux que user_id suit), plus récents d'abord."""
    if not await _can_view_follow_lists(user_id, current_user["id"]):
        raise HTTPException(status_code=403, detail="Compte privé")
    rows = await db.follows.find({"follower_id": user_id}).sort("created_at", -1).to_list(length=2000)
    ids = [r.get("followed_id") or r.get("following_id") for r in rows]
    ids = [i for i in ids if i]
    return await _enrich_user_list(ids, current_user["id"])


@api_router.delete("/users/me/followers/{follower_id}")
async def remove_follower(follower_id: str, current_user: dict = Depends(get_current_user)):
    """Retire un abonné : la personne ne nous suit plus (gestion de ses abonnés)."""
    result = await db.follows.delete_one({"follower_id": follower_id, "followed_id": current_user["id"]})
    if result.deleted_count:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"followers_count": -1}})
        await db.users.update_one({"id": follower_id}, {"$inc": {"following_count": -1}})
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


# ==================== WEB PUSH ROUTES ====================
@api_router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    """Clé publique VAPID + état d'activation (le front n'essaie de s'abonner
    que si le serveur est configuré)."""
    return {"public_key": VAPID_PUBLIC_KEY, "enabled": _web_push_enabled()}


@api_router.post("/push/subscribe")
async def push_subscribe(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Enregistre (ou met à jour) l'abonnement push du navigateur courant."""
    sub = data.get("subscription") or data
    endpoint = (sub or {}).get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="Abonnement invalide")
    await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {
            "user_id": current_user["id"],
            "subscription": sub,
            "endpoint": endpoint,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"success": True}


@api_router.post("/push/unsubscribe")
async def push_unsubscribe(data: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Désabonne le navigateur courant (suppression par endpoint)."""
    endpoint = ((data or {}).get("subscription") or data or {}).get("endpoint") or (data or {}).get("endpoint")
    if endpoint:
        await db.push_subscriptions.delete_one({"endpoint": endpoint})
    return {"success": True}


# ==================== NOTIFICATIONS ROUTES ====================
@api_router.get("/notifications", response_model=List[Notification])
async def get_notifications(skip: int = 0, limit: int = 30, current_user: dict = Depends(get_current_user)):
    """Récupère les notifications de l'utilisateur (paginé pour le scroll infini)."""
    limit = max(1, min(limit, 50))
    notifications_raw = await db.notifications.find(
        {"user_id": current_user["id"]}
    ).sort("created_at", -1).skip(max(0, skip)).limit(limit).to_list(length=limit)

    notifications = []
    for notif_raw in notifications_raw:
        notif = convert_mongo_doc_to_dict(notif_raw)
        notifications.append(Notification(**notif))
    
    return notifications

@api_router.get("/badges")
async def get_badges(current_user: dict = Depends(get_current_user)):
    """Compteurs non lus pour les pastilles (messages privés + notifications)."""
    messages = await db.messages.count_documents({"recipient_id": current_user["id"], "read": False})
    notifications = await db.notifications.count_documents({"user_id": current_user["id"], "read": False})
    return {"messages": messages, "notifications": notifications}


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
    # Projection : on N'INCLUT PAS media_url (data URL base64 potentiellement
    # lourd) pour garder la liste des conversations légère et rapide.
    messages_raw = await db.messages.find(
        {"$or": [{"sender_id": current_user["id"]}, {"recipient_id": current_user["id"]}]},
        {"content": 1, "sender_id": 1, "recipient_id": 1, "created_at": 1, "media_type": 1, "expires_at": 1},
    ).sort("created_at", -1).to_list(length=1000)

    # Conversations « effacées » (côté utilisateur uniquement) : on masque les
    # messages antérieurs à la date d'effacement (comportement type Instagram).
    clears_raw = await db.conversation_clears.find({"user_id": current_user["id"]}).to_list(length=1000)
    clears = {c["peer_id"]: c.get("cleared_at") for c in clears_raw}

    prefs = await _conversation_prefs_map(current_user["id"])

    now_iso = datetime.now(timezone.utc).isoformat()
    conversations_dict = {}
    for msg_raw in messages_raw:
        msg = convert_mongo_doc_to_dict(msg_raw)
        other_user_id = msg["recipient_id"] if msg["sender_id"] == current_user["id"] else msg["sender_id"]

        # Message éphémère expiré → ne compte pas pour l'aperçu.
        exp = msg.get("expires_at")
        if exp and exp <= now_iso:
            continue

        cleared_at = clears.get(other_user_id)
        if cleared_at and (msg.get("created_at") or "") <= cleared_at:
            continue  # message plus ancien que l'effacement → ignoré

        if other_user_id not in conversations_dict:
            other_user_raw = await db.users.find_one({"id": other_user_id})
            if other_user_raw:
                other_user = convert_mongo_doc_to_dict(other_user_raw)
                unread_count = await db.messages.count_documents({
                    "sender_id": other_user_id,
                    "recipient_id": current_user["id"],
                    "read": False
                })

                # Aperçu : texte déchiffré, ou « 📷 Photo » pour un média (ou une
                # image collée en texte, pour ne pas afficher un pavé de base64).
                text = decrypt_message(msg.get("content") or "")
                if image_data_url_from_text(text):
                    preview = "📷 Photo"
                elif text:
                    preview = text[:120]
                elif msg.get("media_type") == "audio":
                    preview = "🎤 Message vocal"
                elif msg.get("media_type"):
                    preview = "📷 Photo"
                else:
                    preview = ""
                p = prefs.get(other_user_id, {})
                conversations_dict[other_user_id] = Conversation(
                    user_id=other_user["id"],
                    username=other_user["username"],
                    profile_pic=other_user.get("profile_pic"),
                    last_message=preview,
                    last_message_time=msg["created_at"],
                    unread_count=unread_count,
                    pinned=p.get("pinned", False),
                    muted=p.get("muted", False),
                    marked_unread=p.get("marked_unread", False),
                )

    return list(conversations_dict.values())

# ==================== NOTES (statuts éphémères façon Instagram) ====================

MAX_NOTE_LEN = 80  # même limite de caractères qu'Instagram


@api_router.get("/notes")
async def get_notes(current_user: dict = Depends(get_current_user)):
    """Notes actives (non expirées) de l'utilisateur et de ses abonnements
    mutuels (comme Instagram : uniquement les personnes qui se suivent des
    deux côtés)."""
    now_iso = datetime.now(timezone.utc).isoformat()

    # Personnes que JE suis (moi → eux)
    following_raw = await db.follows.find({
        "follower_id": current_user["id"],
        "status": "following",
    }).to_list(length=1000)
    following_ids = set()
    for f in following_raw:
        fd = convert_mongo_doc_to_dict(f)
        uid = fd.get("followed_id") or fd.get("following_id")
        if uid:
            following_ids.add(uid)

    # Personnes qui ME suivent (eux → moi)
    followers_raw = await db.follows.find({
        "$or": [{"followed_id": current_user["id"]}, {"following_id": current_user["id"]}],
        "status": "following",
    }).to_list(length=1000)
    follower_ids = {convert_mongo_doc_to_dict(f).get("follower_id") for f in followers_raw}
    follower_ids.discard(None)

    # Abonnements mutuels + soi-même
    author_ids = (following_ids & follower_ids) | {current_user["id"]}

    notes_raw = await db.notes.find({
        "user_id": {"$in": list(author_ids)},
        "expires_at": {"$gt": now_iso},
    }).sort("created_at", -1).to_list(length=100)

    notes = []
    for n_raw in notes_raw:
        n = convert_mongo_doc_to_dict(n_raw)
        author_raw = await db.users.find_one({"id": n["user_id"]})
        if not author_raw:
            continue
        author = convert_mongo_doc_to_dict(author_raw)
        notes.append({
            "id": n["id"],
            "user_id": n["user_id"],
            "username": author.get("username"),
            "profile_pic": author.get("profile_pic"),
            "content": n.get("content", ""),
            "created_at": n.get("created_at"),
            "is_self": n["user_id"] == current_user["id"],
        })

    # Sa propre note d'abord.
    notes.sort(key=lambda x: (not x["is_self"],))
    return {"success": True, "notes": notes}


@api_router.post("/notes")
async def create_note(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Crée / remplace la note de l'utilisateur (une seule active, expire en 24 h)."""
    content = (payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Note vide")
    content = content[:MAX_NOTE_LEN]

    now = datetime.now(timezone.utc)
    note = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "content": content,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=24)).isoformat(),
    }
    # Une seule note active par utilisateur : on retire les précédentes.
    await db.notes.delete_many({"user_id": current_user["id"]})
    await db.notes.insert_one(note)
    return {
        "success": True,
        "note": {
            "id": note["id"],
            "user_id": current_user["id"],
            "username": current_user.get("username"),
            "profile_pic": current_user.get("profile_pic"),
            "content": content,
            "created_at": note["created_at"],
            "is_self": True,
        },
    }


@api_router.delete("/notes")
async def delete_note(current_user: dict = Depends(get_current_user)):
    """Supprime la note de l'utilisateur."""
    await db.notes.delete_many({"user_id": current_user["id"]})
    return {"success": True}


def _pair_key(a: str, b: str) -> str:
    """Clé canonique d'une paire d'utilisateurs (indépendante de l'ordre)."""
    return ":".join(sorted([a, b]))


async def _conversation_prefs_map(user_id: str) -> dict:
    """Préférences personnelles (épingler/sourdine/non lu) de l'utilisateur,
    indexées par target_id (id d'un contact OU d'un groupe)."""
    rows = await db.conversation_prefs.find({"user_id": user_id}).to_list(length=2000)
    out = {}
    for r in rows:
        out[r.get("target_id")] = {
            "pinned": bool(r.get("pinned", False)),
            "muted": bool(r.get("muted", False)),
            "marked_unread": bool(r.get("marked_unread", False)),
        }
    return out


# Durées autorisées pour les messages éphémères (secondes). 0 = désactivé.
EPHEMERAL_ALLOWED = {0, 300, 3600, 86400}


async def _ephemeral_ttl(user_a: str, user_b: str) -> int:
    """Durée d'éphémérité (s) configurée pour la conversation, 0 si désactivée."""
    doc = await db.conversation_settings.find_one({"pair_key": _pair_key(user_a, user_b)})
    return int(doc.get("ephemeral_ttl", 0)) if doc else 0


@api_router.get("/messages/conversations/{peer_id}/ephemeral")
async def get_ephemeral(peer_id: str, current_user: dict = Depends(get_current_user)):
    """Réglage des messages éphémères pour cette conversation."""
    ttl = await _ephemeral_ttl(current_user["id"], peer_id)
    return {"ttl_seconds": ttl}


@api_router.put("/messages/conversations/{peer_id}/ephemeral")
async def set_ephemeral(peer_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Active/désactive les messages éphémères (s'applique aux deux côtés)."""
    ttl = int(data.get("ttl_seconds", 0) or 0)
    if ttl not in EPHEMERAL_ALLOWED:
        raise HTTPException(status_code=400, detail="Durée non autorisée")
    await db.conversation_settings.update_one(
        {"pair_key": _pair_key(current_user["id"], peer_id)},
        {"$set": {"ephemeral_ttl": ttl, "updated_by": current_user["id"],
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    # Prévient l'autre partie en temps réel.
    await push_realtime(peer_id, {"type": "ephemeral_changed", "data": {"peer_id": current_user["id"], "ttl_seconds": ttl}})
    return {"success": True, "ttl_seconds": ttl}


@api_router.delete("/messages/conversations/{peer_id}")
async def clear_conversation(peer_id: str, current_user: dict = Depends(get_current_user)):
    """Efface une conversation côté utilisateur uniquement (type Instagram).

    On enregistre la date d'effacement ; les messages plus anciens ne sont plus
    affichés pour cet utilisateur. Un nouveau message rouvre la conversation.
    """
    now = datetime.now(timezone.utc).isoformat()
    await db.conversation_clears.update_one(
        {"user_id": current_user["id"], "peer_id": peer_id},
        {"$set": {"cleared_at": now}},
        upsert=True,
    )
    return {"success": True}


@api_router.post("/messages/prefs/{target_id}")
async def set_conversation_prefs(target_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Met à jour les préférences personnelles d'une conversation (DM ou groupe) :
    épingler, sourdine, marquer comme non lu (façon Instagram). Seuls les champs
    fournis sont modifiés."""
    allowed = ("pinned", "muted", "marked_unread")
    update = {k: bool(data[k]) for k in allowed if k in data}
    if not update:
        raise HTTPException(status_code=400, detail="Aucune préférence fournie")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.conversation_prefs.update_one(
        {"user_id": current_user["id"], "target_id": target_id},
        {"$set": update},
        upsert=True,
    )
    doc = await db.conversation_prefs.find_one({"user_id": current_user["id"], "target_id": target_id})
    return {
        "success": True,
        "pinned": bool(doc.get("pinned", False)),
        "muted": bool(doc.get("muted", False)),
        "marked_unread": bool(doc.get("marked_unread", False)),
    }


async def _enrich_groups_with_activity(groups, current_user_id):
    """Ajoute à chaque groupe son dernier message (aperçu + date) pour permettre
    un tri unifié avec les messages privés côté client."""
    for g in groups:
        last_raw = await db.group_messages.find(
            {"group_id": g["id"], "deleted_for": {"$ne": current_user_id}},
            {"content": 1, "media_urls": 1, "created_at": 1, "sender_username": 1},
        ).sort("created_at", -1).limit(1).to_list(length=1)
        if last_raw:
            last = convert_mongo_doc_to_dict(last_raw[0])
            text = decrypt_message(last.get("content") or "")
            if image_data_url_from_text(text) or (last.get("media_urls")):
                preview = "📷 Photo"
            else:
                preview = (text or "")[:120]
            g["last_message"] = preview
            g["last_message_time"] = last.get("created_at")
        else:
            g["last_message"] = ""
            g["last_message_time"] = g.get("created_at")
    return groups


@api_router.get("/messages/groups-list")
async def list_groups_alias(current_user: dict = Depends(get_current_user)):
    """Alias pour lister les groupes (évite le conflit de route avec /{user_id})"""
    groups_raw = await db.group_chats.find({
        "member_ids": current_user["id"]
    }).to_list(length=100)
    groups = [convert_mongo_doc_to_dict(g) for g in groups_raw]
    groups = await _enrich_groups_with_activity(groups, current_user["id"])
    prefs = await _conversation_prefs_map(current_user["id"])
    for g in groups:
        p = prefs.get(g["id"], {})
        g["pinned"] = p.get("pinned", False)
        g["muted"] = p.get("muted", False)
        g["marked_unread"] = p.get("marked_unread", False)
    return {"success": True, "groups": groups}

@api_router.get("/messages/{user_id}", response_model=List[Message])
async def get_messages_with_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Récupère les messages avec un utilisateur spécifique"""
    # On récupère les 60 messages LES PLUS RÉCENTS (tri décroissant + limite),
    # puis on rétablit l'ordre chronologique. Évite de charger tout l'historique
    # (images base64 comprises) qui faisait ramer/planter la page.
    # « Supprimer pour vous » : les messages où l'utilisateur figure dans
    # `deleted_by` sont masqués POUR LUI uniquement (l'autre partie les garde,
    # sans notification). La suppression « pour tout le monde » reste un hard
    # delete séparé (voir delete_message).
    query = {
        "deleted_by": {"$ne": current_user["id"]},
        "$or": [
            {"sender_id": current_user["id"], "recipient_id": user_id},
            {"sender_id": user_id, "recipient_id": current_user["id"]}
        ]
    }
    # Conversation effacée côté utilisateur : ne montrer que les messages postérieurs.
    clear = await db.conversation_clears.find_one({"user_id": current_user["id"], "peer_id": user_id})
    if clear and clear.get("cleared_at"):
        query["created_at"] = {"$gt": clear["cleared_at"]}

    # Messages éphémères expirés : on les retire (et on les supprime en base).
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.messages.delete_many({
        "expires_at": {"$ne": None, "$lte": now_iso},
        "$or": [
            {"sender_id": current_user["id"], "recipient_id": user_id},
            {"sender_id": user_id, "recipient_id": current_user["id"]},
        ],
    })
    query["$and"] = [{"$or": [{"expires_at": None}, {"expires_at": {"$gt": now_iso}}]}]

    messages_raw = await db.messages.find(query).sort("created_at", -1).to_list(length=60)
    messages_raw.reverse()

    messages = []
    for msg_raw in messages_raw:
        msg = convert_mongo_doc_to_dict(msg_raw)
        msg["content"] = decrypt_message(msg.get("content"))
        messages.append(Message(**msg))

    # Marquer les messages reçus comme lus + prévenir l'expéditeur (« Vu »).
    now_read = datetime.now(timezone.utc).isoformat()
    res = await db.messages.update_many(
        {"sender_id": user_id, "recipient_id": current_user["id"], "read": False},
        {"$set": {"read": True, "status": "read", "read_at": now_read}}
    )
    if res.modified_count:
        await push_realtime(user_id, {
            "type": "messages_read",
            "data": {"reader_id": current_user["id"], "read_at": now_read},
        })

    return messages

# Longueur max d'un message texte (empêche le spam de gros blocs, ex. data URLs collées).
MAX_MESSAGE_TEXT = 4000

# Signatures base64 des formats image courants (blob collé sans préfixe data:).
_B64_IMAGE_SIGS = {"/9j/": "jpeg", "iVBORw0KGgo": "png", "R0lGOD": "gif", "UklGR": "webp"}


def image_data_url_from_text(text):
    """Si `text` est une image (data URL complète OU base64 brut collé),
    renvoie une data URL affichable ; sinon None."""
    if not text:
        return None
    if text.startswith("data:image"):
        return text
    head = text[:16]
    for prefix, mime in _B64_IMAGE_SIGS.items():
        if head.startswith(prefix):
            return f"data:image/{mime};base64,{text}"
    return None


def normalize_message_content(content, media_url):
    """Nettoie le contenu d'un message.

    - Si le texte est en réalité une image collée (data URL ou base64 brut), on la
      traite comme un média : elle s'affiche comme une image, pas comme un pavé de
      texte qui fait ramer la page.
    - Sinon, on borne la longueur du texte.
    Renvoie (content, media_url).
    """
    text = (content or "").strip()
    if not media_url:
        as_image = image_data_url_from_text(text)
        if as_image:
            return "", as_image
    if len(text) > MAX_MESSAGE_TEXT:
        text = text[:MAX_MESSAGE_TEXT]
    return text, media_url


@api_router.post("/messages", response_model=Message)
async def send_message(message_data: MessageCreate, current_user: dict = Depends(get_current_user)):
    """Envoie un message"""
    # Anti-spam : max 30 messages / 60 s par utilisateur
    if not rate_limit(f"msg:{current_user['id']}", max_attempts=30, window_seconds=60):
        raise HTTPException(status_code=429, detail="Trop de messages envoyés. Ralentissez un peu.")

    recipient_raw = await db.users.find_one({"id": message_data.recipient_id})
    if not recipient_raw:
        raise HTTPException(status_code=404, detail="Recipient not found")

    # Normalise (data URL collée → image, borne la longueur).
    message_data.content, message_data.media_url = normalize_message_content(
        message_data.content, message_data.media_url
    )

    # Un message doit avoir du texte OU un média.
    if not (message_data.content or "").strip() and not message_data.media_url:
        raise HTTPException(status_code=400, detail="Message vide")

    # Modération NSFW du média envoyé (image). On ne scanne pas le texte privé
    # des DM ; seul le média est vérifié (anti-nudes non sollicités).
    if message_data.media_url:
        await screen_content(media_url=message_data.media_url)

    recipient = convert_mongo_doc_to_dict(recipient_raw)
    message_id = str(uuid.uuid4())

    now = datetime.now(timezone.utc)
    # Messages éphémères : si la conversation a une durée configurée, on calcule
    # la date d'expiration après laquelle le message s'auto-supprime.
    ttl = await _ephemeral_ttl(current_user["id"], message_data.recipient_id)
    expires_at = (now + timedelta(seconds=ttl)).isoformat() if ttl > 0 else None

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
        "reply_to_id": message_data.reply_to_id,
        "expires_at": expires_at,
        "read": False,
        "created_at": now.isoformat()
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
            "reply_to_id": message_data.reply_to_id,
            "expires_at": expires_at,
            "created_at": message_to_insert["created_at"],
        },
    })

    return Message(**message)

# Aperçu de lien (Open Graph) pour la messagerie.
_LINK_PREVIEW_CACHE: Dict[str, dict] = {}


def _host_is_public(host: str) -> bool:
    """Anti-SSRF : refuse localhost / IP privées / lien-local / réservées."""
    import ipaddress
    import socket
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_multicast or addr.is_unspecified):
            return False
    return True


@api_router.get("/link-preview")
async def link_preview(url: str, current_user: dict = Depends(get_current_user)):
    """Aperçu Open Graph d'un lien (titre/description/image). Best-effort + anti-SSRF."""
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL invalide")
    if url in _LINK_PREVIEW_CACHE:
        return _LINK_PREVIEW_CACHE[url]

    import asyncio
    import urllib.request
    import urllib.parse
    from html import unescape as _unescape

    result = {"url": url}
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.hostname or not _host_is_public(parsed.hostname):
            raise ValueError("hôte non public")

        def _fetch():
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0 (compatible; NexusBot/1.0)"}
            )
            with urllib.request.urlopen(req, timeout=6) as r:
                if "text/html" not in (r.headers.get("Content-Type", "") or "").lower():
                    return None
                return r.read(400000).decode("utf-8", "ignore")

        html = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        if html:
            def meta(*props):
                for p in props:
                    m = re.search(r'<meta[^>]+(?:property|name)=["\']' + re.escape(p)
                                  + r'["\'][^>]*content=["\']([^"\']*)["\']', html, re.I) \
                        or re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']'
                                     + re.escape(p) + r'["\']', html, re.I)
                    if m and m.group(1).strip():
                        return _unescape(m.group(1).strip())
                return None

            title = meta("og:title", "twitter:title")
            if not title:
                mt = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
                title = _unescape(mt.group(1).strip()) if mt else None
            image = meta("og:image", "twitter:image", "twitter:image:src")
            if image and not image.lower().startswith(("http://", "https://")):
                image = urllib.parse.urljoin(url, image)
            result = {
                "url": url,
                "title": title,
                "description": meta("og:description", "twitter:description", "description"),
                "image": image,
                "site_name": meta("og:site_name") or parsed.hostname,
            }
    except Exception:
        pass

    if len(_LINK_PREVIEW_CACHE) > 2000:
        _LINK_PREVIEW_CACHE.clear()
    _LINK_PREVIEW_CACHE[url] = result
    return result


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

    # Ouvrir/lire une conversation annule le « marqué comme non lu » manuel.
    await db.conversation_prefs.update_one(
        {"user_id": current_user["id"], "target_id": user_id},
        {"$set": {"marked_unread": False}},
    )

    # Prévient l'expéditeur en temps réel pour afficher « Vu ».
    if result.modified_count:
        await push_realtime(user_id, {
            "type": "messages_read",
            "data": {"reader_id": current_user["id"], "read_at": now},
        })

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
    
    # Réaction déjà posée par l'utilisateur ?
    reactions = message.get("reactions", [])
    existing = next((r for r in reactions if r["user_id"] == current_user["id"]), None)

    # Retire toujours l'ancienne réaction de l'utilisateur.
    reactions = [r for r in reactions if r["user_id"] != current_user["id"]]

    # Bascule : re-cliquer sur le MÊME emoji = retirer (aucune nouvelle réaction).
    toggled_off = bool(existing and existing.get("emoji") == emoji)
    if not toggled_off:
        reactions.append({
            "user_id": current_user["id"],
            "emoji": emoji,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"reactions": reactions}}
    )

    # Notifie l'auteur du message quand on réagit à SON message (pas d'auto-notif,
    # pas de notif quand on retire une réaction).
    other_id = (
        message.get("recipient_id")
        if message["sender_id"] == current_user["id"]
        else message.get("sender_id")
    )
    if not toggled_off and message["sender_id"] != current_user["id"]:
        await create_notification(
            message["sender_id"], "reaction", current_user, comment_content=emoji,
        )
    # Push temps réel à l'autre partie pour mettre à jour l'affichage des réactions.
    if other_id:
        await push_realtime(other_id, {
            "type": "reaction_update",
            "data": {"message_id": message_id, "reactions": reactions},
        })

    return {"success": True, "reactions": reactions, "toggled_off": toggled_off}

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


@api_router.post("/messages/translate")
async def translate_message(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Traduit un texte vers la langue cible (celle de l'utilisateur). Utilise un
    endpoint public gratuit de Google (sans clé API) → pas de configuration
    d'API requise, fonctionne pour toutes les langues, détection auto de la source."""
    text = (data.get("text") or "").strip()
    target = (data.get("target") or "fr").split("-")[0].lower()  # "fr-FR" -> "fr"
    if not text:
        raise HTTPException(status_code=400, detail="Texte vide")
    text = text[:5000]

    def _do_translate():
        import requests as _rq
        r = _rq.get(
            "https://translate.googleapis.com/translate_a/single",
            params={"client": "gtx", "sl": "auto", "tl": target, "dt": "t", "q": text},
            timeout=8,
        )
        r.raise_for_status()
        payload = r.json()
        translated = "".join(seg[0] for seg in payload[0] if seg and seg[0])
        detected = payload[2] if len(payload) > 2 else None
        return translated, detected

    try:
        translated, detected = await asyncio.get_event_loop().run_in_executor(None, _do_translate)
        return {"success": True, "translated": translated, "detected": detected, "target": target}
    except Exception:
        raise HTTPException(status_code=502, detail="Traduction indisponible")

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

        # Prévient l'autre partie en temps réel pour qu'elle retire le message.
        other_id = (
            message.get("recipient_id")
            if message["sender_id"] == current_user["id"]
            else message.get("sender_id")
        )
        if other_id:
            await push_realtime(other_id, {
                "type": "message_deleted",
                "data": {"id": message_id, "sender_id": message["sender_id"]},
            })

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
    """Lister les groupes de l'utilisateur (uniquement ceux dont il est membre)."""
    groups_raw = await db.group_chats.find({
        "member_ids": current_user["id"]
    }).to_list(length=100)
    groups = [convert_mongo_doc_to_dict(g) for g in groups_raw]
    return {"success": True, "groups": groups}

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

        # Normalise le contenu (data URL collée → image, borne la longueur).
        raw_content = message_data.get("content") if isinstance(message_data.get("content"), str) else ""
        media_urls = message_data.get("media_urls", []) or []
        text, moved = normalize_message_content(raw_content, None)
        if moved:  # une image collée en texte devient un média
            media_urls = [moved] + list(media_urls)

        # Un message doit avoir du texte OU un média.
        if not text.strip() and not media_urls:
            raise HTTPException(status_code=400, detail="Le contenu du message est requis")

        # Modération NSFW des médias du groupe (fail-open si non configurée).
        for _mu in media_urls:
            await screen_content(media_url=_mu)

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
            "content": encrypt_message(text),
            "media_urls": media_urls,
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
        response_message["content"] = text  # clair pour l'expéditeur
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


@api_router.get("/messages/groups/{group_id}/members")
async def list_group_members(group_id: str, current_user: dict = Depends(get_current_user)):
    """Liste détaillée des membres d'un groupe (avatar + rôle)."""
    group_raw = await db.group_chats.find_one({"id": group_id})
    if not group_raw:
        raise HTTPException(status_code=404, detail="Group not found")
    group = convert_mongo_doc_to_dict(group_raw)
    if current_user["id"] not in group.get("member_ids", []):
        raise HTTPException(status_code=403, detail="Not a member")

    admin_ids = group.get("admin_ids", [])
    creator_id = group.get("creator_id")
    members = []
    for uid in group.get("member_ids", []):
        u_raw = await db.users.find_one({"id": uid})
        if not u_raw:
            continue
        u = convert_mongo_doc_to_dict(u_raw)
        members.append({
            "id": uid,
            "username": u.get("username"),
            "profile_pic": u.get("profile_pic"),
            "is_admin": uid in admin_ids,
            "is_creator": uid == creator_id,
        })
    # Créateur puis admins puis le reste (alphabétique).
    members.sort(key=lambda m: (not m["is_creator"], not m["is_admin"], (m["username"] or "").lower()))
    return {
        "success": True,
        "members": members,
        "is_admin": current_user["id"] in admin_ids,
        "creator_id": creator_id,
    }


@api_router.post("/messages/groups/{group_id}/admins")
async def promote_group_admin(group_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Promouvoir un membre en admin (admin uniquement)."""
    group_raw = await db.group_chats.find_one({"id": group_id})
    if not group_raw:
        raise HTTPException(status_code=404, detail="Group not found")
    group = convert_mongo_doc_to_dict(group_raw)
    if current_user["id"] not in group.get("admin_ids", []):
        raise HTTPException(status_code=403, detail="Admin only")
    user_id = data.get("user_id")
    if user_id not in group.get("member_ids", []):
        raise HTTPException(status_code=400, detail="Not a member")
    await db.group_chats.update_one(
        {"id": group_id},
        {"$addToSet": {"admin_ids": user_id}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}


@api_router.delete("/messages/groups/{group_id}/admins/{user_id}")
async def demote_group_admin(group_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    """Retirer les droits d'admin (admin uniquement ; le créateur reste admin)."""
    group_raw = await db.group_chats.find_one({"id": group_id})
    if not group_raw:
        raise HTTPException(status_code=404, detail="Group not found")
    group = convert_mongo_doc_to_dict(group_raw)
    if current_user["id"] not in group.get("admin_ids", []):
        raise HTTPException(status_code=403, detail="Admin only")
    if user_id == group.get("creator_id"):
        raise HTTPException(status_code=400, detail="Impossible de rétrograder le créateur")
    await db.group_chats.update_one(
        {"id": group_id},
        {"$pull": {"admin_ids": user_id}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}


# ==================== APPELS AUDIO/VIDÉO (signaling WebRTC) ====================

@api_router.post("/calls/signal")
async def call_signal(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Relaie un message de signaling WebRTC (offer/answer/candidate/hangup/reject)
    vers le destinataire via le canal temps réel. Le serveur ne fait que
    transmettre : il ne stocke rien et ne voit pas les médias (P2P chiffré)."""
    to_user_id = data.get("to_user_id")
    signal = data.get("signal")
    if not to_user_id or not isinstance(signal, dict):
        raise HTTPException(status_code=400, detail="to_user_id et signal requis")
    await push_realtime(to_user_id, {
        "type": "call_signal",
        "data": {
            "from_id": current_user["id"],
            "from_username": current_user.get("username"),
            "from_profile_pic": current_user.get("profile_pic"),
            "signal": signal,
        },
    })
    return {"success": True}

# ==================== SEARCH ROUTES ====================
@api_router.get("/search")
async def search(q: str, type: str = "all", skip: int = 0, limit: int = 20,
                 current_user: dict = Depends(get_current_user)):
    """Recherche globale façon X : onglets (all/top/latest/people/media/hashtags),
    pagination (skip/limit) pour le scroll infini, résultats users/posts/hashtags."""
    q = (q or "").strip()
    if not q:
        return {"users": [], "posts": [], "hashtags": []}

    rx = {"$regex": re.escape(q.lstrip("#")), "$options": "i"}
    limit = max(1, min(limit, 40))

    async def get_users(sk, lm):
        raw = await db.users.find({"$or": [{"username": rx}, {"bio": rx}]}).skip(sk).limit(lm).to_list(length=lm)
        out = []
        for u in raw:
            u = convert_mongo_doc_to_dict(u)
            out.append(UserProfile(
                id=u["id"], username=u["username"], bio=u.get("bio", ""),
                profile_pic=u.get("profile_pic"),
                followers_count=u.get("followers_count", 0),
                following_count=u.get("following_count", 0),
                is_following=await check_is_following(current_user["id"], u["id"]),
                created_at=u["created_at"]))
        return out

    async def get_posts(sk, lm, sort_field, media_only=False):
        query = {"content": rx}
        if media_only:
            query = {"$and": [{"content": rx}, {"$or": [
                {"media_url": {"$nin": [None, ""]}},
                {"media_urls": {"$exists": True, "$ne": []}},
            ]}]}
        raw = await db.posts.find(query).sort(sort_field, -1).skip(sk).limit(lm).to_list(length=lm)
        out = []
        for p in raw:
            p = convert_mongo_doc_to_dict(p)
            p["is_liked"] = bool(await db.likes.find_one({"post_id": p["id"], "user_id": current_user["id"]}))
            enrich_post_poll(p, current_user["id"])
            out.append(Post(**p))
        return out

    async def get_hashtags():
        trending = await compute_trending_hashtags(60)
        ql = q.lstrip("#").lower()
        return [t for t in trending if ql in (t.get("tag", "").lower())][:15]

    if type == "people":
        return {"users": await get_users(skip, limit), "posts": [], "hashtags": []}
    if type == "latest":
        return {"users": [], "posts": await get_posts(skip, limit, "created_at"), "hashtags": []}
    if type == "top":
        return {"users": [], "posts": await get_posts(skip, limit, "likes_count"), "hashtags": []}
    if type == "media":
        return {"users": [], "posts": await get_posts(skip, limit, "created_at", media_only=True), "hashtags": []}
    if type == "hashtags":
        return {"users": [], "posts": [], "hashtags": await get_hashtags()}

    # « Pour toi » / all : mélange users + posts + hashtags (page 0 des annexes).
    return {
        "users": await get_users(0, 6),
        "posts": await get_posts(skip, limit, "created_at"),
        "hashtags": await get_hashtags(),
    }

# ==================== LISTES D'UTILISATEURS (façon X) ====================

async def _list_members_preview(member_ids):
    previews = []
    for uid in (member_ids or [])[:3]:
        u = await db.users.find_one({"id": uid}, {"id": 1, "username": 1, "profile_pic": 1})
        if u:
            previews.append({"id": u["id"], "username": u.get("username"), "profile_pic": u.get("profile_pic")})
    return previews


@api_router.post("/lists")
async def create_list(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Crée une liste d'utilisateurs."""
    name = (data.get("name") or "").strip()[:60]
    if not name:
        raise HTTPException(status_code=400, detail="Nom requis")
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": current_user["id"],
        "name": name,
        "member_ids": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.user_lists.insert_one(dict(doc))
    return {"success": True, "list": {"id": doc["id"], "name": name, "member_count": 0, "members_preview": [], "created_at": doc["created_at"]}}


@api_router.get("/lists")
async def get_my_lists(current_user: dict = Depends(get_current_user)):
    """Listes de l'utilisateur, avec aperçu des membres."""
    raw = await db.user_lists.find({"owner_id": current_user["id"]}).sort("created_at", -1).to_list(length=200)
    out = []
    for l in raw:
        l = convert_mongo_doc_to_dict(l)
        out.append({
            "id": l["id"], "name": l.get("name", ""),
            "member_count": len(l.get("member_ids", [])),
            "members_preview": await _list_members_preview(l.get("member_ids", [])),
            "created_at": l.get("created_at"),
        })
    return {"lists": out}


@api_router.get("/lists/{list_id}")
async def get_list_detail(list_id: str, current_user: dict = Depends(get_current_user)):
    """Détail d'une liste (membres complets)."""
    l = await db.user_lists.find_one({"id": list_id, "owner_id": current_user["id"]})
    if not l:
        raise HTTPException(status_code=404, detail="Liste introuvable")
    l = convert_mongo_doc_to_dict(l)
    members = []
    for uid in l.get("member_ids", []):
        u = await db.users.find_one({"id": uid})
        if u:
            u = convert_mongo_doc_to_dict(u)
            members.append({"id": u["id"], "username": u["username"], "profile_pic": u.get("profile_pic"), "bio": u.get("bio", "")})
    return {"id": l["id"], "name": l.get("name", ""), "members": members}


@api_router.post("/lists/{list_id}/members")
async def add_list_member(list_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Ajoute un utilisateur à une liste."""
    uid = data.get("user_id")
    if not uid:
        raise HTTPException(status_code=400, detail="user_id requis")
    l = await db.user_lists.find_one({"id": list_id, "owner_id": current_user["id"]})
    if not l:
        raise HTTPException(status_code=404, detail="Liste introuvable")
    await db.user_lists.update_one({"id": list_id}, {"$addToSet": {"member_ids": uid}})
    return {"success": True}


@api_router.delete("/lists/{list_id}/members/{user_id}")
async def remove_list_member(list_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    """Retire un utilisateur d'une liste."""
    l = await db.user_lists.find_one({"id": list_id, "owner_id": current_user["id"]})
    if not l:
        raise HTTPException(status_code=404, detail="Liste introuvable")
    await db.user_lists.update_one({"id": list_id}, {"$pull": {"member_ids": user_id}})
    return {"success": True}


@api_router.delete("/lists/{list_id}")
async def delete_list(list_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime une liste."""
    await db.user_lists.delete_one({"id": list_id, "owner_id": current_user["id"]})
    return {"success": True}

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
    # Avantage Premium : stories valables 48 h au lieu de 24 h.
    story_ttl_hours = 48 if current_user.get("is_premium") else 24
    expires_at = now + timedelta(hours=story_ttl_hours)

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

    # Modération NSFW du média (fail-open si non configurée).
    _stverdict = await screen_content(media_url=media_url)

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

    if _stverdict and _stverdict["action"] == "flag":
        await flag_for_review("story", story_id, current_user["id"], "", _stverdict, media_kind=media_type)

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
# NB : le helper create_notification() est défini plus haut (près de
# push_realtime) et pousse aussi la notification en temps réel. On ne le
# redéfinit pas ici pour ne pas masquer cette version.

# NB : GET /notifications est défini plus haut (response_model=List[Notification]).

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


async def compute_trending_hashtags(limit: int = 10, scope: str = "feed"):
    """
    Calcule les hashtags tendance EN DIRECT à partir des vraies publications.
    Fenêtre glissante 24h : seuls les posts des dernières 24h comptent, donc un
    hashtag sort automatiquement des tendances et est remplacé au-delà de 24h.
    Score = (#posts 24h * 3) + (likes * 0.1)
    Aucun cron requis : la tendance reflète toujours l'état réel de la base.

    `scope` sépare les hashtags des Clips de ceux du fil :
      - "feed"  : publications hors vidéo (les hashtags des Clips N'APPARAISSENT
                  PAS dans les tendances générales) ;
      - "clips" : uniquement les vidéos (tendances propres à Nexus Clips) ;
      - "all"   : tout confondu.
    """
    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()

    # Fenêtre glissante 24h : on ne considère QUE les posts des dernières 24h,
    # donc un hashtag sort automatiquement des tendances passé ce délai.
    q = {"created_at": {"$gte": since_24h}}
    if scope == "feed":
        q["media_type"] = {"$ne": "video"}   # exclut les Clips du fil des tendances
    elif scope == "clips":
        q["media_type"] = "video"            # tendances propres aux Clips
    recent_posts = await db.posts.find(q).sort("created_at", -1).limit(3000).to_list(length=3000)

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
async def get_clips_feed(request: Request, skip: int = 0, limit: int = 20, current_user: dict = Depends(get_current_user)):
    """
    Fil Nexus Clips : publications vidéo de tout le monde, du plus récent au plus
    ancien, paginé (skip/limit) pour le scroll infini façon TikTok.

    Geo-block : pour un visiteur de l'UE, les clips marqués eu_blocked sont retirés
    du fil (l'auteur voit toujours les siens).
    """
    limit = max(1, min(limit, 40))
    query = {"media_type": "video", "media_url": {"$ne": None}}
    if CLIPS_EU_GEO_BLOCK and is_eu_request(request):
        query["$or"] = [{"eu_blocked": {"$ne": True}}, {"author_id": current_user["id"]}]
    videos_raw = await db.posts.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)

    clips = []
    saved_ids = await _saved_post_ids(current_user["id"], [p.get("id") for p in videos_raw])
    premium_ids = await _premium_author_ids([p.get("author_id") for p in videos_raw])
    for post_raw in videos_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        post["is_saved"] = post["id"] in saved_ids
        post["author_is_premium"] = post.get("author_id") in premium_ids
        clips.append(Post(**post))
    return clips


async def _enrich_posts_for_user(raw, user_id):
    """Enrichit une liste de posts bruts (is_liked / is_saved / author_is_premium)
    en batch, puis renvoie une liste d'objets Post. Utilisé par la recherche."""
    saved_ids = await _saved_post_ids(user_id, [p.get("id") for p in raw])
    premium_ids = await _premium_author_ids([p.get("author_id") for p in raw])
    liked = {l.get("post_id") for l in await db.likes.find(
        {"post_id": {"$in": [p.get("id") for p in raw]}, "user_id": user_id}, {"post_id": 1}
    ).to_list(length=len(raw) or 1)} if raw else set()
    out = []
    for p in raw:
        p = convert_mongo_doc_to_dict(p)
        p["is_liked"] = p["id"] in liked
        p["is_saved"] = p["id"] in saved_ids
        p["author_is_premium"] = p.get("author_id") in premium_ids
        enrich_post_poll(p, user_id)
        out.append(Post(**p))
    return out


@api_router.get("/clips/search/suggest")
async def clips_search_suggest(q: str, current_user: dict = Depends(get_current_user)):
    """Autocomplete temps réel de la recherche Clips : @usernames + #hashtags de
    Clips. Léger (petites limites) pour répondre pendant la frappe."""
    q = (q or "").strip()
    if not q:
        return {"suggestions": []}
    term = q.lstrip("#@")
    if not term:
        return {"suggestions": []}
    rx = {"$regex": re.escape(term), "$options": "i"}
    suggestions = []
    if not q.startswith("#"):
        users = await db.users.find({"username": rx}, {"username": 1, "profile_pic": 1}).limit(5).to_list(length=5)
        for u in users:
            suggestions.append({"type": "user", "value": u.get("username"),
                                "label": "@" + (u.get("username") or ""), "profile_pic": u.get("profile_pic")})
    if not q.startswith("@"):
        tags = await compute_trending_hashtags(80, scope="clips")
        ql = term.lower()
        for t in tags:
            if ql in t["normalized"]:
                suggestions.append({"type": "hashtag", "value": t["tag"],
                                    "label": f'{t["tag"]} · {t["post_count"]} clips'})
            if sum(1 for s in suggestions if s["type"] == "hashtag") >= 6:
                break
    return {"suggestions": suggestions[:10]}


@api_router.get("/clips/search")
async def clips_search(q: str, type: str = "top", skip: int = 0, limit: int = 20,
                       current_user: dict = Depends(get_current_user)):
    """Recherche Nexus Clips : onglets top / videos / users / posts / hashtags /
    live, pagination (scroll infini). Le texte cherche légendes + hashtags."""
    q = (q or "").strip()
    if not q:
        return {"videos": [], "users": [], "hashtags": [], "posts": [], "lives": []}
    term = q.lstrip("#@")
    rx = {"$regex": re.escape(term), "$options": "i"}
    limit = max(1, min(limit, 40))

    async def videos(sk, lm):
        raw = await db.posts.find({"media_type": "video", "content": rx}) \
            .sort([("likes_count", -1), ("created_at", -1)]).skip(sk).limit(lm).to_list(length=lm)
        return await _enrich_posts_for_user(raw, current_user["id"])

    async def posts(sk, lm):
        raw = await db.posts.find({"media_type": {"$ne": "video"}, "content": rx}) \
            .sort([("likes_count", -1), ("created_at", -1)]).skip(sk).limit(lm).to_list(length=lm)
        return await _enrich_posts_for_user(raw, current_user["id"])

    async def users(sk, lm):
        raw = await db.users.find({"$or": [{"username": rx}, {"bio": rx}]}).skip(sk).limit(lm).to_list(length=lm)
        out = []
        for u in raw:
            u = convert_mongo_doc_to_dict(u)
            out.append(UserProfile(
                id=u["id"], username=u["username"], bio=u.get("bio", ""),
                profile_pic=u.get("profile_pic"), followers_count=u.get("followers_count", 0),
                following_count=u.get("following_count", 0),
                is_following=await check_is_following(current_user["id"], u["id"]),
                is_verified=u.get("is_verified", False), is_premium=u.get("is_premium", False),
                created_at=u["created_at"]))
        return out

    async def hashtags():
        tr = await compute_trending_hashtags(80, scope="clips")
        ql = term.lower()
        return [t for t in tr if ql in t["normalized"]][:20]

    async def lives():
        out = []
        async for s in db.live_sessions.find({"active": True}).limit(50):
            uname = s.get("host_username") or ""
            if re.search(re.escape(term), uname, re.I):
                out.append({"host_id": s.get("host_id"), "host_username": uname,
                            "host_profile_pic": s.get("host_profile_pic"),
                            "room_id": s.get("room_id"), "started_at": s.get("started_at")})
        return out

    if type == "videos":
        return {"videos": await videos(skip, limit)}
    if type == "posts":
        return {"posts": await posts(skip, limit)}
    if type == "users":
        return {"users": await users(skip, limit)}
    if type == "hashtags":
        return {"hashtags": await hashtags()}
    if type == "live":
        return {"lives": await lives()}
    # top / all : un mélange pertinent (page 0)
    return {
        "videos": await videos(0, 8),
        "users": await users(0, 5),
        "hashtags": await hashtags(),
        "posts": await posts(0, 4),
        "lives": await lives(),
    }


@api_router.post("/clips", response_model=Post)
async def create_clip(
    file: UploadFile = File(...),
    caption: str = Form(""),
    eu_blocked: bool = Form(False),
    current_user: dict = Depends(get_current_user),
):
    """
    Créer un Clip / Reel : la vidéo uploadée est stockée comme publication vidéo,
    ce qui la fait apparaître dans le fil Nexus Clips (GET /api/clips) et le feed.

    eu_blocked=true restreint le clip dans l'UE (masqué du fil / lecture refusée
    pour les visiteurs européens).
    """
    if not (file.content_type or "").startswith("video/"):
        raise HTTPException(status_code=400, detail="Le fichier doit être une vidéo")

    contents = await file.read()

    # Modération auto : texte (légende) + NSFW sur des images échantillonnées de la vidéo.
    verdict = None
    if moderation is not None:
        cap_verdict = moderation.moderate_text(caption)
        vid_verdict = moderation.moderate_video_bytes(contents, suffix=".mp4")
        verdict = moderation.worst_verdict(cap_verdict, vid_verdict)
        if verdict["action"] == "block":
            raise HTTPException(
                status_code=400,
                detail=f"Clip refusé par la modération ({verdict['category']}: {verdict['label']})",
            )

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
        "eu_blocked": bool(eu_blocked),
        "created_at": now.isoformat(),
    }
    await db.posts.insert_one(clip_to_insert)

    if verdict and verdict["action"] == "flag":
        await flag_for_review("clip", clip_id, current_user["id"], caption,
                              verdict, media_kind="video")

    clip = convert_mongo_doc_to_dict(clip_to_insert)
    clip["is_liked"] = False
    return Post(**clip)


class ExternalClip(BaseModel):
    media_url: str                 # URL https de la vidéo (Firebase Storage / CDN)
    caption: str = ""
    eu_blocked: bool = False
    duration: Optional[float] = None  # durée en secondes (indicatif)


# Hôtes de stockage autorisés pour un clip « externe » (upload direct navigateur).
# On n'accepte pas n'importe quelle URL : uniquement Firebase Storage / GCS.
_ALLOWED_CLIP_HOSTS = (
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
    ".firebasestorage.app",
    ".appspot.com",
)


@api_router.post("/clips/external", response_model=Post)
async def create_clip_from_url(data: ExternalClip, current_user: dict = Depends(get_current_user)):
    """Crée un Clip à partir d'une vidéo DÉJÀ téléversée sur Firebase Storage.

    L'upload passe directement du navigateur à Firebase (il ne transite pas par
    le backend) : cela lève la limite mémoire/taille et autorise les longues
    vidéos (ex. un combat de 59 min). On ne stocke ici que l'URL.

    Modération : seule la légende (texte) est filtrée ici — la vidéo n'étant pas
    téléchargée côté serveur, l'analyse NSFW image par image n'est pas possible
    sur ce chemin (elle reste active pour les uploads courts via /api/clips).
    """
    from urllib.parse import urlparse
    url = (data.media_url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=400, detail="URL de vidéo invalide (https requis)")
    host = parsed.hostname.lower()
    if not any(host == h or host.endswith(h) for h in _ALLOWED_CLIP_HOSTS):
        raise HTTPException(status_code=400, detail="Hôte de stockage non autorisé")

    caption = data.caption or ""
    # Modération du texte de la légende (fail-open).
    verdict = None
    if moderation is not None:
        verdict = moderation.moderate_text(caption)
        if verdict["action"] == "block":
            raise HTTPException(
                status_code=400,
                detail=f"Légende refusée par la modération ({verdict['category']}: {verdict['label']})",
            )

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
        "media_url": url,
        "media_duration": data.duration,
        "likes_count": 0,
        "comments_count": 0,
        "shares_count": 0,
        "views": 0,
        "eu_blocked": bool(data.eu_blocked),
        "created_at": now.isoformat(),
    }
    await db.posts.insert_one(clip_to_insert)

    if verdict and verdict["action"] == "flag":
        await flag_for_review("clip", clip_id, current_user["id"], caption, verdict, media_kind="video")

    clip = convert_mongo_doc_to_dict(clip_to_insert)
    clip["is_liked"] = False
    clip["is_saved"] = False
    return Post(**clip)


@api_router.get("/adsense")
async def get_adsense_config():
    """Config AdSense côté client (vide par défaut => aucune pub)."""
    return {
        "client": os.environ.get("ADSENSE_CLIENT", ""),
        "slot": os.environ.get("ADSENSE_SLOT", ""),
    }


# ==================== MODÉRATION : FILE DE REVUE HUMAINE (ADMIN) ====================
@api_router.get("/moderation/status")
async def moderation_status(admin: dict = Depends(require_admin)):
    """État de la modération auto + fournisseurs actifs + nombre en attente."""
    pending = await db.moderation_queue.count_documents({"status": "pending"})
    info = {}
    if moderation is not None and hasattr(moderation, "provider_info"):
        try:
            info = moderation.provider_info()
        except Exception:
            info = {}
    return {
        "enabled": bool(moderation is not None and getattr(moderation, "MODERATION_ENABLED", False)),
        "available": moderation is not None,
        "pending": pending,
        **info,
    }


@api_router.get("/moderation/queue")
async def moderation_queue(status: str = "pending", skip: int = 0, limit: int = 50,
                           admin: dict = Depends(require_admin)):
    """Liste les contenus signalés par la modération auto (revue humaine)."""
    limit = max(1, min(limit, 100))
    query = {} if status in ("", "all") else {"status": status}
    items = await db.moderation_queue.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
    return [convert_mongo_doc_to_dict(i) for i in items]


@api_router.post("/moderation/{item_id}/resolve")
async def moderation_resolve(item_id: str, data: dict = Body(default={}),
                             admin: dict = Depends(require_admin)):
    """Résout un élément signalé. action="approve" (conserver) ou "remove" (supprimer)."""
    item = await db.moderation_queue.find_one({"id": item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    action = (data.get("action") or "approve").lower()
    if action not in ("approve", "remove"):
        raise HTTPException(status_code=400, detail="action doit valoir 'approve' ou 'remove'")

    if action == "remove":
        kind, ref_id = item.get("kind"), item.get("ref_id")
        if kind in ("post", "clip"):
            await db.posts.delete_one({"id": ref_id})
        elif kind == "comment":
            comment = await db.comments.find_one({"id": ref_id})
            await db.comments.delete_one({"id": ref_id})
            if comment and comment.get("post_id"):
                await db.posts.update_one({"id": comment["post_id"]}, {"$inc": {"comments_count": -1}})
        # Avertit l'auteur de la suppression.
        kind_label = {"comment": "commentaire", "clip": "clip", "post": "publication"}.get(kind, "contenu")
        await notify_content_removed(item.get("author_id"), kind_label,
                                     {"category": item.get("category"), "label": item.get("label")})

    await db.moderation_queue.update_one(
        {"id": item_id},
        {"$set": {"status": "removed" if action == "remove" else "approved",
                  "resolved_by": admin["id"],
                  "resolved_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True, "action": action}


@api_router.post("/moderation/scan")
async def moderation_scan(limit: int = 40, delete: bool = False, admin: dict = Depends(require_admin)):
    """Scanne les publications média récentes PAS ENCORE vérifiées et traite les
    NSFW. Réservé admin. À lancer par lots : chaque image scannée consomme une
    unité Google Vision.

    Par sécurité, `delete` vaut FALSE par défaut : un verdict "block" est mis en
    file de revue (comme un "flag") au lieu d'être supprimé. Passez explicitement
    `?delete=true` seulement après avoir vérifié que le seuil de blocage est bien
    réglé — sinon un mauvais réglage supprime en masse des contenus légitimes.
    """
    if moderation is None or not getattr(moderation, "MODERATION_ENABLED", False):
        return {"scanned": 0, "removed": 0, "flagged": 0, "detail": "modération inactive"}
    limit = max(1, min(limit, 200))
    posts = await db.posts.find(
        {"media_url": {"$ne": None}, "moderation_checked": {"$ne": True}}
    ).sort("created_at", -1).limit(limit).to_list(length=limit)

    scanned = removed = flagged = 0
    for post in posts:
        scanned += 1
        verdict = None
        try:
            verdict = await evaluate_content(text=post.get("content"), media_url=post.get("media_url"))
        except Exception:
            verdict = None
        # Marque comme vérifié pour ne pas re-scanner (et ne pas re-facturer).
        await db.posts.update_one({"id": post["id"]}, {"$set": {"moderation_checked": True}})
        if not verdict:
            continue
        kind_label = "clip" if post.get("media_type") == "video" else "publication"
        if verdict["action"] == "block" and delete:
            await db.posts.delete_one({"id": post["id"]})
            await notify_content_removed(post.get("author_id"), kind_label, verdict)
            removed += 1
        elif verdict["action"] in ("block", "flag"):
            await flag_for_review("clip" if post.get("media_type") == "video" else "post",
                                  post["id"], post.get("author_id"), post.get("content", ""),
                                  verdict, media_kind=post.get("media_type"))
            flagged += 1
    return {"scanned": scanned, "removed": removed, "flagged": flagged,
            "remaining_hint": "relancez tant que scanned == limit"}


# Cache mémoire des vues déjà comptées : { "user_id:clip_id": expiration_ts }.
# Une « session » = fenêtre de 6 h : dans cet intervalle, les replays d'un même
# utilisateur ne re-comptent pas (comme TikTok/YouTube). Render tourne en 1 worker
# → un cache mémoire suffit (pas besoin de Redis).
_clip_view_cache: Dict[str, float] = {}
CLIP_VIEW_TTL = 6 * 3600


@api_router.post("/clips/{clip_id}/geo-block")
async def set_clip_geo_block(clip_id: str, data: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Restreint (ou lève la restriction d')un clip dans l'UE. Réservé à l'auteur.

    Corps : {"eu_blocked": true|false} (true par défaut).
    """
    clip = await db.posts.find_one({"id": clip_id}, {"author_id": 1})
    if not clip:
        raise HTTPException(status_code=404, detail="Clip introuvable")
    if clip.get("author_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Action réservée à l'auteur du clip")
    eu_blocked = bool(data.get("eu_blocked", True))
    await db.posts.update_one({"id": clip_id}, {"$set": {"eu_blocked": eu_blocked}})
    return {"success": True, "eu_blocked": eu_blocked}


@api_router.post("/clips/{clip_id}/view")
async def register_clip_view(clip_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Compte une vue UNIQUE par utilisateur et par session (pas à chaque replay)."""
    # Geo-block par clip : un visiteur de l'UE ne peut pas visionner un clip
    # restreint (sauf son auteur, pour la prévisualisation).
    if CLIPS_EU_GEO_BLOCK and is_eu_request(request):
        clip = await db.posts.find_one({"id": clip_id}, {"eu_blocked": 1, "author_id": 1})
        if clip and clip.get("eu_blocked") and clip.get("author_id") != current_user["id"]:
            raise HTTPException(status_code=451, detail="Ce clip n'est pas disponible dans votre région")

    key = f"{current_user['id']}:{clip_id}"
    now = time.time()
    exp = _clip_view_cache.get(key)

    if exp and exp > now:
        # Fast-path : déjà comptée récemment (cache mémoire) → pas de ré-incrément.
        post = await db.posts.find_one({"id": clip_id}, {"views": 1})
        if not post:
            raise HTTPException(status_code=404, detail="Clip introuvable")
        return {"success": True, "views": post.get("views", 0), "counted": False}

    # Source de vérité PERSISTANTE : une vue unique par (clip, utilisateur).
    # Le cache mémoire seul ne suffit pas — il est vidé à chaque redémarrage
    # (cold start Render), ce qui re-comptait les vues et gonflait le compteur.
    # Un enregistrement en base garantit « une vue par personne », durablement.
    _clip_view_cache[key] = now + CLIP_VIEW_TTL
    already = await db.clip_views.find_one({"clip_id": clip_id, "user_id": current_user["id"]})
    if already:
        post = await db.posts.find_one({"id": clip_id}, {"views": 1})
        if not post:
            raise HTTPException(status_code=404, detail="Clip introuvable")
        return {"success": True, "views": post.get("views", 0), "counted": False}

    # Purge légère des entrées expirées quand le cache grossit.
    if len(_clip_view_cache) > 50000:
        for k, v in list(_clip_view_cache.items()):
            if v <= now:
                _clip_view_cache.pop(k, None)

    try:
        await db.clip_views.insert_one({
            "clip_id": clip_id,
            "user_id": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        # Collision (index unique) = vue déjà enregistrée → ne pas ré-incrémenter.
        post = await db.posts.find_one({"id": clip_id}, {"views": 1})
        return {"success": True, "views": (post or {}).get("views", 0), "counted": False}

    result = await db.posts.update_one({"id": clip_id}, {"$inc": {"views": 1}})
    if result.matched_count == 0:
        _clip_view_cache.pop(key, None)
        await db.clip_views.delete_one({"clip_id": clip_id, "user_id": current_user["id"]})
        raise HTTPException(status_code=404, detail="Clip introuvable")
    post = await db.posts.find_one({"id": clip_id}, {"views": 1})
    return {"success": True, "views": (post or {}).get("views", 0), "counted": True}


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

    # Auteurs Premium : petit bonus de visibilité dans « Pour toi » (avantage réel).
    premium_authors = [u["id"] for u in await db.users.find(
        {"is_premium": True}, {"id": 1}
    ).to_list(length=5000)]

    pipeline = [
        {"$addFields": {
            "engagement_score": {
                "$add": [
                    {"$multiply": [{"$ifNull": ["$likes_count", 0]}, 2]},
                    {"$multiply": [{"$ifNull": ["$comments_count", 0]}, 3]},
                    {"$multiply": [{"$ifNull": ["$shares_count", 0]}, 4]},
                    # Bonus de personnalisation : les comptes suivis remontent
                    {"$cond": [{"$in": ["$author_id", followed_ids]}, 15, 0]},
                    # Bonus Premium : priorité dans le feed « Pour toi »
                    {"$cond": [{"$in": ["$author_id", premium_authors]}, 8, 0]},
                ]
            }
        }},
        {"$sort": {"engagement_score": -1, "created_at": -1}},
        {"$limit": limit},
    ]

    posts_raw = await db.posts.aggregate(pipeline).to_list(length=limit)

    posts = []
    saved_ids = await _saved_post_ids(current_user["id"], [p.get("id") for p in posts_raw])
    premium_set = set(premium_authors)
    for post_raw in posts_raw:
        post = convert_mongo_doc_to_dict(post_raw)
        like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
        post["is_liked"] = bool(like_raw)
        post["is_saved"] = post["id"] in saved_ids
        post["author_is_premium"] = post.get("author_id") in premium_set
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

# Exemple d'intégration Stripe Connect (API V2) — monté sous /connect-sample.
# Autonome : si le SDK/clé manquent, les pages affichent une erreur claire.
try:
    try:
        from backend.stripe_connect_sample import router as connect_sample_router
    except ImportError:
        try:
            from app.backend.stripe_connect_sample import router as connect_sample_router
        except ImportError:
            from stripe_connect_sample import router as connect_sample_router
    app.include_router(connect_sample_router)
    print("✅ Stripe Connect sample (V2) monté sur /connect-sample")
except Exception as _e:
    print(f"ℹ️ Exemple Stripe Connect non monté: {_e}")

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== TÂCHE DE FOND : NOTIF « POST EN TENDANCE » ====================
# Notifie l'auteur quand sa publication entre dans le top des posts les plus
# engageants des dernières 24h. Boucle intégrée au process (Render 1 worker),
# pas de cron externe. Anti-doublon via db.trending_notified (24h).
TRENDING_NOTIFY_INTERVAL = int(os.environ.get("TRENDING_NOTIFY_INTERVAL", "1800"))  # 30 min
TRENDING_TOP_N = int(os.environ.get("TRENDING_TOP_N", "10"))


async def _notify_trending_once():
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    raw = await db.posts.find(
        {"created_at": {"$gte": since}, "repost_of": None}
    ).to_list(length=3000)

    scored = []
    for p in raw:
        likes = p.get("likes_count", 0) or 0
        comments = p.get("comments_count", 0) or 0
        views = p.get("views", 0) or 0
        score = likes * 2 + comments * 3 + views * 0.1
        if score <= 0:
            continue
        scored.append((score, p))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:TRENDING_TOP_N]

    for _, p in top:
        post_id = p.get("id")
        author_id = p.get("author_id")
        if not post_id or not author_id:
            continue
        # Déjà notifié dans les dernières 24h ?
        already = await db.trending_notified.find_one({"post_id": post_id, "notified_at": {"$gte": since}})
        if already:
            continue
        await db.trending_notified.update_one(
            {"post_id": post_id},
            {"$set": {"post_id": post_id, "notified_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        await create_notification(
            author_id, "trending",
            {"id": "system", "username": "Nexus", "profile_pic": None},
            post_id=post_id,
        )


async def trending_notifier_loop():
    # Petit délai initial pour laisser l'app démarrer.
    await asyncio.sleep(60)
    while True:
        try:
            await _notify_trending_once()
        except Exception as e:
            logger.error(f"trending notifier: {e}")
        await asyncio.sleep(TRENDING_NOTIFY_INTERVAL)


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
    # Index unique pour les vues de clips : garantit « une vue par (clip, user) »
    # même en cas de course, et rend la vérification de doublon instantanée.
    try:
        await db.clip_views.create_index(
            [("clip_id", 1), ("user_id", 1)], unique=True, name="uniq_clip_user"
        )
    except Exception as e:
        logger.warning(f"Index clip_views non créé (peut déjà exister): {e}")
    # Index des abonnements push (un doc par navigateur/endpoint).
    try:
        await db.push_subscriptions.create_index("endpoint", unique=True, name="uniq_endpoint")
        await db.push_subscriptions.create_index("user_id", name="by_user")
    except Exception as e:
        logger.warning(f"Index push_subscriptions non créé (peut déjà exister): {e}")
    # Lance la boucle de notifications « tendance » en tâche de fond.
    try:
        asyncio.create_task(trending_notifier_loop())
        logger.info("✅ Trending notifier lancé")
    except Exception as e:
        logger.error(f"Impossible de lancer le trending notifier: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    """Ferme la connexion MongoDB à l'arrêt"""
    client.close()
    logger.info("MongoDB connection closed")
