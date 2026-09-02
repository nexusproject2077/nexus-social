# app/backend/server.py
import sys
from pathlib import Path
# Cette ligne magique règle TOUT le problème Render
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form, Response, Query, Body, WebSocket, WebSocketDisconnect, BackgroundTasks, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, RedirectResponse, HTMLResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import InvalidURI, ConnectionFailure
import os
import logging
from pydantic import BaseModel, Field, ConfigDict, EmailStr, model_validator
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt
import base64
import gzip as _gzip
from bson import ObjectId
import json
from collections import defaultdict, deque, OrderedDict
import time
import asyncio
from enum import Enum
import hashlib
import hmac
import random
import math
import re
import unicodedata
import html as _html

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

# Emails transactionnels (Brevo) — no-op si BREVO_API_KEY absente.
# _EMAIL_ENABLED reflète la config RÉELLE (clé API + SDK présents) : la fonction
# send_brevo_email existe toujours même sans config, donc on ne peut PAS s'y fier
# pour savoir si un email partira vraiment (sinon on bloquerait des comptes sur
# une vérification email qui n'arrive jamais).
try:
    from backend.brevo import send_email as send_brevo_email, EMAIL_ENABLED as _EMAIL_ENABLED
except ImportError:
    try:
        from brevo import send_email as send_brevo_email, EMAIL_ENABLED as _EMAIL_ENABLED
    except ImportError:
        send_brevo_email = None
        _EMAIL_ENABLED = False

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

# ==================== CORE (config · DB · sérialisation · sécurité) =========
# Refactor progressif : la config, la connexion Mongo, la sérialisation Mongo
# et l'authentification vivent dans le paquet `core/`. On réexpose les symboles
# ici pour que tout le code existant continue de fonctionner à l'identique.
try:
    from backend.core.config import (
        MONGO_URL as mongo_url, SECRET_KEY, ALGORITHM, ADMIN_EMAILS,
    )
    from backend.core.database import client, db
    from backend.core.serialization import convert_mongo_doc_to_dict
    from backend.core.security import (
        pwd_context, security, create_access_token,
        get_current_user, is_admin_user, require_admin,
    )
except ImportError:
    from core.config import (
        MONGO_URL as mongo_url, SECRET_KEY, ALGORITHM, ADMIN_EMAILS,
    )
    from core.database import client, db
    from core.serialization import convert_mongo_doc_to_dict
    from core.security import (
        pwd_context, security, create_access_token,
        get_current_user, is_admin_user, require_admin,
    )

# Create the main app
app = FastAPI(title="Nexus Social API", version="1.0.0")

# ==================== CORS ====================
# Origines autorisées : la liste de base + celles fournies par la variable
# d'environnement CORS_EXTRA_ORIGINS (séparées par des virgules). Permet
# d'ajouter le nouveau domaine du front (ex. Cloudflare Pages) SANS toucher au
# code lors d'un changement d'hébergeur.
_CORS_ORIGINS = [
    "https://nexus-social-3ta5.onrender.com",
    "https://nexus-social-4k3v.onrender.com",
    "https://nexus-social.merickoken54.workers.dev",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
]
_CORS_ORIGINS += [o.strip() for o in os.environ.get("CORS_EXTRA_ORIGINS", "").split(",") if o.strip()]
# Autorise en plus, sans avoir à lister chaque sous-domaine, tout front hébergé
# sur Cloudflare (*.workers.dev / *.pages.dev) — l'app Nexus est déployée là.
_CORS_ORIGIN_REGEX = r"https://([a-z0-9-]+\.)*(workers\.dev|pages\.dev)$"


def _origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    if "*" in _CORS_ORIGINS or origin in _CORS_ORIGINS:
        return True
    return bool(re.match(_CORS_ORIGIN_REGEX, origin))


app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Gestionnaire d'erreurs GLOBAL : sans lui, une exception non gérée renvoie un
# 500 généré AU-DESSUS du middleware CORS → la réponse n'a pas d'en-tête
# Access-Control-Allow-Origin, et le navigateur masque le vrai 500 en « erreur
# CORS ». En interceptant ici, la réponse repasse par le middleware CORS (en-tête
# ajouté) ET on LOGGE la trace complète (visible dans les journaux Cloud Run).
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"💥 Erreur non gérée sur {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Erreur interne du serveur."})

# ==================== CLOUDINARY (médias hors base — anti-OOM) ====================
# Les médias (photos/vidéos) étaient stockés en base64 DANS MongoDB : les charger
# en mémoire faisait exploser la RAM (OOM Render). Ici on les envoie sur
# Cloudinary et on ne conserve qu'une URL légère en base.
#
# Config par variables d'environnement (Render → service backend) :
#   - soit CLOUDINARY_URL = cloudinary://<api_key>:<api_secret>@<cloud_name>
#   - soit CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
# Si Cloudinary n'est pas configuré, store_media() renvoie le média inchangé
# (base64 conservé) → AUCUNE régression, juste pas d'allègement.
_CLOUDINARY_READY = False
try:
    import cloudinary as _cloudinary
    import cloudinary.uploader as _cloudinary_uploader
    if os.environ.get("CLOUDINARY_URL"):
        _cloudinary.config(secure=True)  # lit CLOUDINARY_URL
        _CLOUDINARY_READY = True
    elif os.environ.get("CLOUDINARY_CLOUD_NAME"):
        _cloudinary.config(
            cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
            api_key=os.environ.get("CLOUDINARY_API_KEY"),
            api_secret=os.environ.get("CLOUDINARY_API_SECRET"),
            secure=True,
        )
        _CLOUDINARY_READY = True
    if _CLOUDINARY_READY:
        print("✅ Cloudinary configuré (médias hors base)")
    else:
        print("ℹ️ Cloudinary non configuré — médias conservés en base (base64)")
except Exception as _e:
    print(f"ℹ️ Cloudinary indisponible ({_e}) — médias en base64")


async def store_media(media, folder="nexus"):
    """Décharge un média base64 vers Cloudinary et renvoie son URL (légère).

    - Si `media` est None/vide → renvoyé tel quel.
    - Si c'est déjà une URL http(s) (média externe déjà hébergé) → inchangé.
    - Si c'est une data URL base64 ET Cloudinary configuré → upload puis URL.
    - Sinon (pas de Cloudinary, ou échec upload) → renvoyé tel quel (base64
      conservé) : best-effort, jamais bloquant, aucune régression.
    """
    if not media or not isinstance(media, str):
        return media
    if not media.startswith("data:"):
        return media  # déjà une URL externe → rien à faire
    if not _CLOUDINARY_READY:
        return media  # pas de Cloudinary → on garde le base64
    resource_type = "video" if media.startswith("data:video") else "image"

    def _upload():
        return _cloudinary_uploader.upload(
            media, folder=folder, resource_type=resource_type,
            unique_filename=True, overwrite=False,
        )
    try:
        res = await asyncio.to_thread(_upload)
        return res.get("secure_url") or media
    except Exception as e:
        logger.warning(f"Upload Cloudinary échoué (média conservé en base64): {e}")
        return media


async def store_media_list(items, folder="nexus"):
    """store_media appliqué à une liste (messages de groupe : media_urls)."""
    if not items:
        return items
    out = []
    for it in items:
        out.append(await store_media(it, folder=folder))
    return out


# --- Migration paresseuse : convertit les anciens médias base64 en URL Cloudinary
# EN ARRIÈRE-PLAN au moment où ils sont servis (ex. dans le fil). Ainsi les
# publications existantes s'allègent d'elles-mêmes au fil de la navigation, sans
# action manuelle. Borné : quelques migrations concurrentes maximum, dédupliqué.
_lazy_migrating: set = set()
_LAZY_MIGRATE_MAX = 3  # migrations simultanées max (évite un pic mémoire)


def schedule_lazy_media_migration(collection: str, doc: dict, field: str = "media_url"):
    """Programme (best-effort) la migration base64→Cloudinary d'un document servi."""
    if not _CLOUDINARY_READY:
        return
    val = doc.get(field)
    if not (isinstance(val, str) and val.startswith("data:")):
        return
    did = doc.get("id")
    if not did or did in _lazy_migrating or len(_lazy_migrating) >= _LAZY_MIGRATE_MAX:
        return
    _lazy_migrating.add(did)

    async def _run():
        try:
            new_url = await store_media(val, folder=f"migrated/{collection}")
            if new_url and not str(new_url).startswith("data:"):
                await db[collection].update_one({"id": did}, {"$set": {field: new_url}})
        except Exception:
            pass
        finally:
            _lazy_migrating.discard(did)

    try:
        asyncio.create_task(_run())
    except Exception:
        _lazy_migrating.discard(did)

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


def _cors_headers_for(request) -> dict:
    """En-têtes CORS à ajouter manuellement sur une réponse d'erreur.

    On reflète l'Origin de la requête si elle fait partie des origines
    autorisées (ou si `*` est configuré). Indispensable sur les réponses 500
    générées HORS du CORSMiddleware, sinon le navigateur masque le vrai statut
    en « erreur CORS ».
    """
    origin = request.headers.get("origin")
    headers = {"Vary": "Origin"}
    if _origin_allowed(origin):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return headers


@app.middleware("http")
async def catch_all_errors_with_cors(request, call_next):
    """Filet de sécurité le PLUS EXTÉRIEUR : capture TOUTE exception non gérée
    en aval (y compris les erreurs de SÉRIALISATION de la réponse, qui échappent
    aux try/except des endpoints et au gestionnaire @app.exception_handler).

    Renvoie un 500 propre AVEC les en-têtes CORS manuels, pour que le navigateur
    voie le vrai statut au lieu d'une fausse « erreur CORS ». Logge la trace
    complète (visible dans les journaux Cloud Run) pour diagnostiquer la cause.
    """
    try:
        return await call_next(request)
    except Exception as exc:
        logger.exception(
            f"💥 Erreur non gérée (middleware) sur {request.method} {request.url.path}: {exc}"
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Erreur interne du serveur."},
            headers=_cors_headers_for(request),
        )


# Seuil sous lequel compresser ne vaut pas le coût (petites réponses).
_GZIP_MIN_SIZE = 600


@app.middleware("http")
async def gzip_json_responses(request: Request, call_next):
    """Compresse (gzip) UNIQUEMENT les réponses JSON — feed, conversations,
    notifications… — ce qui allège nettement le transfert sur mobile (réseau
    lent). On NE touche PAS aux médias (image/vidéo, déjà compressés) ni aux
    réponses Range (206) du proxy média : elles ont un content-type non-JSON,
    donc naturellement exclues → aucun risque de casser la lecture/seek vidéo.

    Middleware le plus EXTÉRIEUR : il lit la réponse finale (en-têtes CORS
    déjà posés) et les recopie tels quels avant d'ajouter Content-Encoding."""
    response = await call_next(request)
    try:
        if (response.status_code != 200
                or "gzip" not in request.headers.get("accept-encoding", "").lower()
                or "application/json" not in (response.headers.get("content-type") or "")
                or response.headers.get("content-encoding")):
            return response
        # Réponse JSON standard → corps disponible via body_iterator.
        body = b""
        async for chunk in response.body_iterator:
            body += chunk if isinstance(chunk, (bytes, bytearray)) else str(chunk).encode()
        headers = dict(response.headers)
        headers.pop("content-length", None)  # recalculé par Response
        if len(body) < _GZIP_MIN_SIZE:
            return Response(content=body, status_code=response.status_code,
                            headers=headers, background=response.background)
        compressed = _gzip.compress(body, compresslevel=5)
        headers["content-encoding"] = "gzip"
        headers["vary"] = "Accept-Encoding"
        return Response(content=compressed, status_code=response.status_code,
                        headers=headers, background=response.background)
    except Exception:
        # Toute anomalie → on renvoie la réponse d'origine non compressée.
        return response


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
def _clean_secret(raw: str) -> str:
    """Nettoie une clé/identifiant Stripe lu depuis l'environnement.

    Un copier-coller « enrichi » (mail, PDF, doc stylé) injecte parfois des
    caractères Unicode invisibles ou typographiques (apostrophe courbe, espace
    insécable, zéro-largeur…). Le SDK Stripe met la clé dans l'en-tête HTTP
    `Authorization`, encodé en latin-1 par `requests` → un tel caractère fait
    planter TOUT appel Stripe avec « 'latin-1' codec can't encode… ordinal not
    in range(256) ». On ne garde donc que le 1er jeton et ses octets ASCII
    imprimables (les clés Stripe sont [A-Za-z0-9_] : rien de légitime n'est
    perdu). Corrige aussi une clé collée par erreur avec un secret à la suite.
    """
    v = (raw or "").strip()
    parts = v.split()
    if parts:
        v = parts[0]
    return "".join(ch for ch in v if 33 <= ord(ch) <= 126)


STRIPE_SECRET_KEY = _clean_secret(os.environ.get("STRIPE_SECRET_KEY", ""))
STRIPE_WEBHOOK_SECRET = _clean_secret(os.environ.get("STRIPE_WEBHOOK_SECRET", ""))
STRIPE_PRICE_ID = _clean_secret(os.environ.get("STRIPE_PRICE_ID", ""))  # prix d'abonnement (repli / mensuel)
# Deux offres Premium : Mensuel 3,99 €/mois et Annuel 34,99 €/an (−25 %).
STRIPE_PRICE_ID_MONTHLY = _clean_secret(os.environ.get("STRIPE_PRICE_ID_MONTHLY", "")) or STRIPE_PRICE_ID
STRIPE_PRICE_ID_ANNUAL = _clean_secret(os.environ.get("STRIPE_PRICE_ID_ANNUAL", ""))
# Diagnostic : signale (sans révéler la clé) si un nettoyage a été nécessaire.
if os.environ.get("STRIPE_SECRET_KEY", "") and os.environ.get("STRIPE_SECRET_KEY", "").strip() != STRIPE_SECRET_KEY:
    print("🧹 Stripe: STRIPE_SECRET_KEY contenait des caractères parasites (nettoyés) — "
          "vérifiez le copier-coller de la clé dans Cloud Run.")
# URL du front (redirections Stripe/PayPal succès·annulation, liens Connect,
# retours OAuth…). Défaut = le front Cloudflare actuel (l'ancienne URL Render
# était morte depuis la migration). Surchargeable via la variable FRONTEND_URL.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://nexus-social.merickoken54.workers.dev")
# Commission de la plateforme sur chaque cadeau reversé au créateur (Stripe Connect).
try:
    PLATFORM_FEE_PERCENT = max(0, min(100, int(os.environ.get("PLATFORM_FEE_PERCENT", "20"))))
except ValueError:
    PLATFORM_FEE_PERCENT = 20
STRIPE_ENABLED = bool(stripe and STRIPE_SECRET_KEY and STRIPE_PRICE_ID)
if STRIPE_ENABLED:
    stripe.api_key = STRIPE_SECRET_KEY
    # Force explicitement le client HTTP `requests` (CA `certifi` embarqué,
    # gestion propre des en-têtes). `requests` est déjà dans requirements donc
    # Stripe le choisit automatiquement — ce forçage n'est qu'une assurance.
    # NB (v12+) : le module est `stripe._http_client`, pas `stripe.http_client`.
    try:
        from stripe import _http_client as _stripe_http
        stripe.default_http_client = _stripe_http.RequestsClient()
    except Exception:
        pass  # le choix automatique de Stripe reste valable
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


# ══════════════ PayPal Commerce Platform (marketplace, commission auto) ══════════════
# Modèle « 100 % automatique » façon Stripe Connect : le payeur paie le CRÉATEUR,
# la plateforme prélève sa commission (platform_fees) au passage — Nexus ne
# détient jamais les fonds. Nécessite un compte PARTENAIRE PayPal (Commerce
# Platform) + variables d'environnement. Tout est inactif tant que non configuré.
import requests as _requests  # client HTTP synchrone (exécuté via asyncio.to_thread)

PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "").strip()
PAYPAL_SECRET = os.environ.get("PAYPAL_SECRET", "").strip()
PAYPAL_ENV = os.environ.get("PAYPAL_ENV", "sandbox").strip().lower()
PAYPAL_PARTNER_ID = os.environ.get("PAYPAL_PARTNER_ID", "").strip()   # merchant-id du partenaire (Nexus)
PAYPAL_BN_CODE = os.environ.get("PAYPAL_BN_CODE", "").strip()          # PayPal-Partner-Attribution-Id (BN code)
PAYPAL_WEBHOOK_ID = os.environ.get("PAYPAL_WEBHOOK_ID", "").strip()
PAYPAL_BASE = "https://api-m.paypal.com" if PAYPAL_ENV == "live" else "https://api-m.sandbox.paypal.com"
PAYPAL_ENABLED = bool(PAYPAL_CLIENT_ID and PAYPAL_SECRET)
if PAYPAL_ENABLED:
    print(f"✅ PayPal Commerce activé ({PAYPAL_ENV})")
else:
    print("ℹ️ PayPal désactivé (PAYPAL_CLIENT_ID/PAYPAL_SECRET absents) — pourboires PayPal via lien PayPal.me uniquement")

_paypal_token_cache = {"token": None, "exp": 0}


def _paypal_token_sync():
    now = time.time()
    if _paypal_token_cache["token"] and _paypal_token_cache["exp"] > now + 30:
        return _paypal_token_cache["token"]
    r = _requests.post(
        f"{PAYPAL_BASE}/v1/oauth2/token",
        auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET),
        data={"grant_type": "client_credentials"},
        headers={"Accept": "application/json"}, timeout=20,
    )
    r.raise_for_status()
    d = r.json()
    _paypal_token_cache["token"] = d["access_token"]
    _paypal_token_cache["exp"] = now + int(d.get("expires_in", 3000))
    return d["access_token"]


def _paypal_auth_assertion(merchant_id: str) -> str:
    """En-tête PayPal-Auth-Assertion (JWT non signé) : autorise la plateforme à
    agir POUR LE COMPTE du vendeur (nécessaire pour les platform_fees en tiers)."""
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).decode().rstrip("=")
    header = b64({"alg": "none"})
    payload = b64({"iss": PAYPAL_CLIENT_ID, "payer_id": merchant_id})
    return f"{header}.{payload}."


def _paypal_call_sync(method: str, path: str, json_body=None, extra_headers=None):
    headers = {"Authorization": f"Bearer {_paypal_token_sync()}", "Content-Type": "application/json"}
    if PAYPAL_BN_CODE:
        headers["PayPal-Partner-Attribution-Id"] = PAYPAL_BN_CODE
    if extra_headers:
        headers.update(extra_headers)
    return _requests.request(method, f"{PAYPAL_BASE}{path}", headers=headers, json=json_body, timeout=25)


async def _paypal_call(method: str, path: str, json_body=None, extra_headers=None):
    return await asyncio.to_thread(_paypal_call_sync, method, path, json_body, extra_headers)

# ==================== ADMINISTRATION ====================
# ADMIN_EMAILS est désormais défini dans core/config.py et importé plus haut.
# `is_admin_user` / `require_admin` viennent de core/security.
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


# Types de notification connus (pour l'UI des réglages).
NOTIF_TYPES = [
    "like", "comment", "comment_reply", "mention", "tag",
    "follow", "follow_request", "follow_accepted", "live",
    "message", "group_message", "story_reply", "story_reaction",
    "instant", "instant_reaction", "trending", "security",
]


async def _notif_allowed(user_id, notif_type, from_user_id=None):
    """False si l'utilisateur a désactivé ce type de notification, ou coupé les
    notifications de cet expéditeur. Best-effort (autorise en cas d'erreur)."""
    if not user_id:
        return False
    try:
        pref = await db.notification_prefs.find_one({"user_id": user_id})
    except Exception:
        return True
    if not pref:
        return True
    if notif_type in (pref.get("disabled_types") or []):
        return False
    if from_user_id and from_user_id in (pref.get("muted_accounts") or []):
        return False
    return True


async def create_notification(user_id, notif_type, from_user, post_id=None,
                              comment_content=None):
    """Crée une notification (et la pousse en temps réel). Best-effort.

    N'auto-notifie jamais : si l'émetteur est le destinataire, on ignore.
    Respecte les préférences de l'utilisateur (type désactivé / compte coupé).
    """
    if not user_id or user_id == from_user.get("id"):
        return
    # Préférences par type (activé par défaut). On respecte les DEUX systèmes
    # (rétro-compat) : le profil par-type (users.notif_prefs, modale
    # NotificationSettings) ET la collection notification_prefs (page Réglages).
    try:
        _u = await db.users.find_one({"id": user_id}, {"notif_prefs": 1})
        if ((_u or {}).get("notif_prefs") or {}).get(notif_type) is False:
            return
    except Exception:
        pass
    if not await _notif_allowed(user_id, notif_type, from_user.get("id")):
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
# convert_mongo_doc_to_dict est désormais dans core/serialization.py (importé
# plus haut) — même comportement, partagé avec core/security.


# ==================== PROXY MÉDIA (anti-OOM base64) ====================
# Les médias (photos/vidéos) sont parfois stockés en base64 DANS MongoDB. Les
# renvoyer tels quels dans les FLUX (clips, profil) charge des dizaines/centaines
# de Mo en mémoire d'un coup → l'instance Cloud Run est TUÉE (OOM/SIGKILL) et
# renvoie un 500 d'infrastructure SANS en-tête CORS (le navigateur le déguise en
# « erreur CORS », et aucun try/except Python ne peut l'attraper car le process
# est déjà mort).
#
# Solution : dans les flux, on NE transfère PLUS le base64 depuis MongoDB. Une
# étape d'agrégation remplace un media_url base64 par un sentinel léger
# « nexusmedia:<id> » (le base64 ne quitte jamais la base). Le front reçoit à la
# place une URL vers ce proxy, qui sert le média À LA DEMANDE, un seul à la fois
# (mémoire bornée), avec support des requêtes Range (lecture/seek vidéo).

_MEDIA_SENTINEL = "nexusmedia:"

# ── Cache LRU des médias DÉCODÉS (accélère la lecture vidéo) ────────────────
# Un <video> déclenche PLUSIEURS requêtes Range successives (métadonnées, puis
# lecture/seek). Sans cache, CHAQUE Range rechargeait tout le base64 (plusieurs
# Mo) depuis Mongo PUIS le redécodait en entier — juste pour renvoyer une
# tranche. On garde donc en mémoire les octets décodés des derniers médias
# servis, borné par une taille TOTALE stricte (anti-OOM conservé : on ne détient
# jamais plus que ce plafond, contrairement au chargement d'un flux entier).
_media_bytes_cache: "OrderedDict[str, tuple]" = OrderedDict()  # key -> (data, content_type)
_media_cache_bytes = 0
_MEDIA_CACHE_MAX_BYTES = 96 * 1024 * 1024   # ~96 Mo (quelques vidéos récentes)
_MEDIA_CACHE_ITEM_MAX = 20 * 1024 * 1024    # on ne cache pas un média > 20 Mo


def _media_cache_get(key: str):
    hit = _media_bytes_cache.get(key)
    if hit is not None:
        _media_bytes_cache.move_to_end(key)  # LRU : marque comme récemment utilisé
    return hit


def _media_cache_put(key: str, data: bytes, content_type: str):
    global _media_cache_bytes
    size = len(data)
    if size <= 0 or size > _MEDIA_CACHE_ITEM_MAX:
        return  # trop gros (ou vide) → on ne cache pas (évite d'évincer plein d'items)
    if key in _media_bytes_cache:
        _media_cache_bytes -= len(_media_bytes_cache[key][0])
        del _media_bytes_cache[key]
    _media_bytes_cache[key] = (data, content_type)
    _media_cache_bytes += size
    # Éviction LRU jusqu'à repasser sous le plafond total.
    while _media_cache_bytes > _MEDIA_CACHE_MAX_BYTES and _media_bytes_cache:
        _, (old_data, _ct) = _media_bytes_cache.popitem(last=False)
        _media_cache_bytes -= len(old_data)

# Registre des types de médias servis par le proxy : kind -> (collection, champ).
# - "post" / "story" : contenu public ou entre abonnés → proxy par UUID (comme
#   les clips déjà en place).
# - "message" : messages privés (DM) → l'URL est SIGNÉE et EXPIRANTE (voir
#   _media_sign) pour respecter la confidentialité (pas d'accès public par id).
_MEDIA_KINDS = {
    "post": ("posts", "media_url"),
    "story": ("stories", "media_url"),
    "message": ("messages", "media_url"),
}
_SIGNED_MEDIA_KINDS = {"message"}   # kinds nécessitant une signature valide
_MEDIA_SIG_TTL = 6 * 3600           # validité d'un lien média signé (6 h)


def _media_sign(kind: str, media_id: str, exp: int) -> str:
    """Signature HMAC courte d'un lien média privé (kind + id + expiration)."""
    msg = f"{kind}:{media_id}:{exp}".encode()
    return hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:32]


def _drop_base64_media_stage() -> dict:
    """Étape d'agrégation : remplace un media_url base64 (data:) par un sentinel
    léger « nexusmedia:<id> » — le base64 ne quitte JAMAIS MongoDB (anti-OOM).
    Les URLs externes (http/https, Cloudinary…) sont conservées telles quelles."""
    return {"$addFields": {"media_url": {
        "$cond": [
            {"$eq": [{"$substrCP": [{"$ifNull": ["$media_url", ""]}, 0, 5]}, "data:"]},
            {"$concat": [_MEDIA_SENTINEL, {"$ifNull": ["$id", ""]}]},
            "$media_url",
        ]
    }}}


def _media_public_base(request) -> str:
    """Base publique (https) du backend, dérivée de l'en-tête Host de la requête.
    Cloud Run termine le TLS en amont ; on force https pour éviter tout
    contenu mixte côté front (servi en https)."""
    host = None
    try:
        host = request.headers.get("host")
    except Exception:
        host = None
    if not host:
        try:
            host = request.url.netloc
        except Exception:
            host = ""
    return f"https://{host}" if host else ""


def _optimize_cloudinary(url):
    """Insère `f_auto,q_auto` dans une URL Cloudinary → format moderne (WebP/AVIF)
    + qualité automatique. Les images/vidéos deviennent 50-80 % plus légères,
    sans perte visible, servies et mises en cache par le CDN Cloudinary → posts
    qui s'affichent beaucoup plus vite (surtout mobile).

    Idempotent (ne double pas la transformation). Laisse intactes les URL non
    Cloudinary (proxy média interne, URL externes, None)."""
    if not isinstance(url, str) or "res.cloudinary.com" not in url:
        return url
    # IMAGES uniquement : sur une vidéo, f_auto déclencherait un transcodage
    # (lent/coûteux au 1er accès). Les vidéos Cloudinary streament très bien
    # telles quelles → on n'y touche pas.
    marker = "/image/upload/"
    i = url.find(marker)
    if i == -1:
        return url
    after = i + len(marker)
    seg = url[after:].split("/", 1)[0]  # 1er segment après /upload/
    # Déjà une transformation (préfixe de type "x_...") → on n'ajoute pas.
    if "f_auto" in seg or "q_auto" in seg or "_" in seg:
        return url
    return url[:after] + "f_auto,q_auto/" + url[after:]


def _resolve_media_sentinel(post: dict, base: str, kind: str = "post") -> dict:
    """Remplace le sentinel « nexusmedia:<id> » par l'URL absolue du proxy média.

    `kind` (post|story|message) choisit la route. Pour un kind PRIVÉ (message),
    l'URL est signée + expirante → le média n'est pas accessible publiquement par
    simple id. Sans base (pas de requête), on met None (jamais bloquant).

    Les URL Cloudinary sont optimisées à la volée (f_auto,q_auto) pour un
    chargement bien plus rapide."""
    mu = post.get("media_url")
    if isinstance(mu, str) and mu.startswith(_MEDIA_SENTINEL):
        pid = mu[len(_MEDIA_SENTINEL):] or post.get("id") or ""
        if base and pid:
            url = f"{base}/api/media/{kind}/{pid}"
            if kind in _SIGNED_MEDIA_KINDS:
                exp = int(time.time()) + _MEDIA_SIG_TTL
                url += f"?exp={exp}&sig={_media_sign(kind, pid, exp)}"
            post["media_url"] = url
        else:
            post["media_url"] = None
    else:
        post["media_url"] = _optimize_cloudinary(mu)
    return post


def _ranged_media_response(request, data: bytes, content_type: str) -> Response:
    """Renvoie des octets média avec support des requêtes Range (seek vidéo).
    Cache immuable (le contenu d'un id ne change pas)."""
    total = len(data)
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
    }
    range_header = request.headers.get("range") if request else None
    if range_header and range_header.startswith("bytes="):
        try:
            rng = range_header[6:].split(",")[0].strip()
            start_s, _, end_s = rng.partition("-")
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else total - 1
            start = max(0, start)
            end = min(end, total - 1)
            if start > end:
                start, end = 0, total - 1
            chunk = data[start:end + 1]
            headers["Content-Range"] = f"bytes {start}-{end}/{total}"
            headers["Content-Length"] = str(len(chunk))
            return Response(content=chunk, status_code=206, media_type=content_type, headers=headers)
        except Exception:
            pass
    headers["Content-Length"] = str(total)
    return Response(content=data, status_code=200, media_type=content_type, headers=headers)


def normalize_paypal(value: Optional[str]) -> Optional[str]:
    """Normalise une entrée PayPal en lien PayPal.me sûr.

    Accepte : « pseudo », « @pseudo », « paypal.me/pseudo », une URL complète
    paypal.me/… ou paypal.com/paypalme/… → renvoie « https://paypal.me/<pseudo> ».
    Renvoie None pour une entrée vide (permet d'effacer le lien)."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v:
        return None
    v = re.sub(r"^https?://", "", v, flags=re.I).strip("/")
    v = re.sub(r"^(www\.)?paypal\.me/", "", v, flags=re.I)
    v = re.sub(r"^(www\.)?paypal\.com/paypalme/", "", v, flags=re.I)
    handle = v.lstrip("@").split("/")[0].split("?")[0].strip()
    # Pseudo PayPal : lettres/chiffres, 1–30 caractères.
    if not re.fullmatch(r"[A-Za-z0-9]{1,30}", handle):
        return None
    return f"https://paypal.me/{handle}"


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
    birthdate: Optional[str] = None  # AAAA-MM-JJ — requis (loi FR : >= 15 ans)
    # Compte privé PAR DÉFAUT (contrôle & vie privée) : seuls les abonnés
    # approuvés voient le contenu. Modifiable ensuite dans les réglages.
    is_private: Optional[bool] = True
    ref: Optional[str] = None  # code de parrainage (username du parrain) via ?ref=

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
    cover_pic: Optional[str] = None     # bannière de couverture (façon X)
    followers_count: int = 0
    following_count: int = 0
    is_verified: bool = False           # badge « identité vérifiée » (pièce validée)
    is_premium: bool = False            # abonné Nexus Premium (badge + avantages réels)
    premium_until: Optional[str] = None  # fin d'abonnement (ISO) ; None si non abonné
    # Parrainage : chaque membre partage ?ref=<username>. referral_count = filleuls
    # inscrits ; referral_rewards = mois Premium déjà offerts (1 tous les 3) ;
    # referred_by = id du parrain.
    referral_count: int = 0
    referral_rewards: int = 0
    referred_by: Optional[str] = None
    # Croissance : préférences de notifications utiles + liste d'amis proches
    # (renvoyées dans /auth/me pour que les réglages survivent au rechargement).
    smart_notif_prefs: Dict[str, bool] = {}
    close_friends: List[str] = []
    is_admin: bool = False
    # Vérification d'identité (RGPD : on n'expose JAMAIS la pièce ni la date de
    # naissance en clair ; seuls des statuts/booléens sont renvoyés au client).
    verification_status: str = "unverified"  # unverified | pending | verified | rejected
    age_verified: bool = False          # >= 15 ans confirmé à l'inscription (loi FR)
    email_verified: bool = False
    phone_verified: bool = False
    twofa_enabled: bool = False         # double authentification (code email à la connexion)
    is_private: bool = False            # compte privé (abonnés approuvés uniquement)
    # Protection des mineurs (loi FR / éthique produit). `is_minor` est calculé à
    # partir de la date de naissance (< 18 ans). Il active : compte privé forcé,
    # filtrage des DM d'adultes, barrière anti-scroll (30 min), couvre-feu de nuit
    # et masquage des mots vulgaires. Les adultes gardent l'expérience complète.
    is_minor: bool = False
    # Limite de temps quotidienne configurable (minutes) — bien-être numérique.
    # None = pas de limite. `time_limit_enabled` permet de désactiver l'option.
    daily_time_limit: Optional[int] = None
    time_limit_enabled: bool = True
    show_sports: bool = True            # widget scores de foot en direct (désactivable)
    show_mma: bool = True               # cartes de combat MMA/UFC (désactivable)
    # Confidentialité messagerie (façon Instagram).
    show_active_status: bool = True     # affiche le point de présence + « dernière connexion » aux autres
    read_receipts: bool = True          # confirmation de lecture (« Vu ») ; si False, réciproque coupée
    hide_political: bool = False        # exclut les contenus politiques du fil (bien-être)
    widget_stack_config: Optional[dict] = None  # pile de widgets : {smart_rotate, order}
    privacy_strict: bool = False        # Mode Confidentialité stricte : coupe les
                                        # analytics non essentiels + les pubs ciblées
    muted_words: List[str] = []         # mots/phrases masqués (filtrés du fil + notifs)
    accent_color: Optional[str] = None
    theme: Optional[str] = None
    created_at: str

class UserProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    bio: str = ""
    profile_pic: Optional[str] = None
    cover_pic: Optional[str] = None     # bannière de couverture (façon X)
    followers_count: int = 0
    following_count: int = 0
    is_following: bool = False
    is_verified: bool = False
    is_premium: bool = False  # membre Nexus Premium (badge + avantages)
    can_receive_tips: bool = False  # a un compte Stripe Connect → pourboire par carte
    paypal_receivable: bool = False  # PayPal Commerce activé → pourboire PayPal avec commission
    paypal_link: Optional[str] = None  # lien PayPal.me (repli sans commission)
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

    @model_validator(mode="before")
    @classmethod
    def _tolerate_nulls(cls, data):
        """Empêche qu'une publication ancienne/incomplète (champ requis à null,
        ex. content=None) ne fasse échouer TOUTE une liste de publications."""
        if isinstance(data, dict):
            for k in ("id", "author_id", "author_username", "content", "created_at"):
                if data.get(k) is None:
                    data[k] = ""
        return data

    id: str
    author_id: str
    author_username: str
    author_profile_pic: Optional[str] = None
    author_is_verified: bool = False
    author_is_premium: bool = False  # badge Premium sur la publication (avantage réel)
    author_can_receive_tips: bool = False  # auteur a un compte Stripe → bouton Pourboire
    author_is_following: bool = False  # l'utilisateur courant suit-il déjà l'auteur ? (bouton « + » Clips)
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
    author_is_premium: bool = False     # commentaire d'un abonné Premium (remonté en tête)
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
    is_online: bool = False             # présence de l'interlocuteur (si son statut est visible)

class Notification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    type: str
    # Optionnels : certaines notifications système (vérification d'identité, etc.)
    # n'ont pas d'expéditeur utilisateur — un défaut évite de casser TOUTE la
    # liste des notifications à cause d'une seule entrée sans from_user_id.
    from_user_id: str = ""
    from_username: str = "Nexus Social"
    from_profile_pic: Optional[str] = None
    post_id: Optional[str] = None
    comment_content: Optional[str] = None
    content: Optional[str] = None
    reason: Optional[str] = None
    url: Optional[str] = None
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
    text: Optional[str] = None            # légende / texte incrusté
    audience: str = "everyone"           # everyone | close_friends | custom
    music_url: Optional[str] = None       # extrait audio (preview iTunes, 30 s)
    music_title: Optional[str] = None
    music_artist: Optional[str] = None
    music_start: float = 0.0              # passage de départ (secondes)
    mirror: bool = False                  # vidéo frontale à remettre « à l'endroit »
    views_count: int = 0
    created_at: str
    expires_at: str
    has_viewed: bool = False
    is_mine: bool = False                 # story de l'utilisateur courant (autorité serveur)

class StoryGroup(BaseModel):
    user_id: str
    username: str
    profile_pic: Optional[str] = None
    stories: List[Story]
    last_story_time: str

# ==================== AUTH HELPERS ====================
# create_access_token · get_current_user · is_admin_user · require_admin sont
# désormais dans core/security.py (importés plus haut) — comportement inchangé.


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


# ==================== CONFORMITÉ LÉGALE PAR PAYS (Geo-routing) ====================
# Source de vérité UNIQUE, CÔTÉ SERVEUR. Le `cf.country` du front est contournable :
# l'enforcement des règles sensibles (âge minimum, mode « lecture seule ») DOIT être
# ici, sur le backend. Le front ne fait qu'AFFICHER la bonne UI (bannières, écrans).
#
# ⚠️ Ceci fournit des MÉCANISMES techniques best-effort, PAS une certification
# juridique. Les lois de localisation des données (FZ-152 RU, PIPL CN) exigent une
# infrastructure locale : on se contente ici de ne PAS traiter/stocker de données
# perso dans ces pays (inscription/publication/messagerie coupées). À faire valider
# par un juriste avant toute allégation publique de conformité.
LEGAL_GEO_ROUTING = os.environ.get("LEGAL_GEO_ROUTING", "true").lower() == "true"

# Pays « mode consultation » : navigation/lecture OK, mais écritures (inscription,
# publication, messagerie) refusées — décision produit (coût 0, pas d'infra locale).
READ_ONLY_COUNTRIES = {"RU", "CN"}

# Groupes de pays (repris du spec des 10 blocs légaux mondiaux).
CIS_COUNTRIES = {"RU", "BY", "KZ", "UZ", "AM", "AZ", "KG", "TJ", "TM"}
LATAM_COUNTRIES = {"BR", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU",
                   "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "JM"}

# Âge minimum d'inscription (consentement numérique) par pays. Défaut : 15.
# Seuils INDICATIFS à confirmer juridiquement (RGPD art. 8 = 16 par défaut, abaissé
# par transposition nationale ; COPPA US = 13).
DIGITAL_CONSENT_AGE = {
    "FR": 15,                                   # France
    "DE": 16, "IE": 16, "NL": 16, "LU": 16,     # UE à 16 ans
    # Reste de l'UE : plancher RGPD retenu à 13
    "AT": 13, "BE": 13, "BG": 13, "CY": 13, "CZ": 13, "DK": 13, "EE": 13,
    "ES": 13, "FI": 13, "GR": 13, "HR": 13, "HU": 13, "IT": 13, "LT": 13,
    "LV": 13, "MT": 13, "PL": 13, "PT": 13, "RO": 13, "SE": 13, "SI": 13, "SK": 13,
    "US": 13,   # COPPA
    "GB": 13,   # UK (ICO Age-Appropriate Design)
}

# Style de consentement / bannière par bloc légal (piloté côté front).
_CONSENT_STYLE = {
    "RGPD_EUROPE": "gdpr",
    "ONLINE_SAFETY_UK": "uk_osa",
    "COPPA_USA": "coppa",
    "PIPEDA_CANADA": "pipeda",
    "KVKK_TURQUIE": "kvkk",
    "FZ152_RUSSIE": "read_only",
    "PIPL_CHINE": "read_only",
    "APAC_STRICT": "appi",       # JP/KR/IN/AU : écran consentement + droits + suppression
    "LGPD_LATAM": "lgpd",
    "GLOBAL_STANDARD": "minimal",
}


def legal_block_for_country(country: Optional[str]) -> str:
    """Bloc légal applicable (code) selon le code pays ISO 3166-1 alpha-2.
    Reprend la cartographie des 10 blocs mondiaux du spec."""
    c = (country or "").upper()
    if not c:
        return "GLOBAL_STANDARD"
    if c in EU_COUNTRIES:
        return "RGPD_EUROPE"
    if c == "GB":
        return "ONLINE_SAFETY_UK"
    if c == "US":
        return "COPPA_USA"
    if c == "CA":
        return "PIPEDA_CANADA"
    if c == "TR":
        return "KVKK_TURQUIE"
    if c == "RU" or c in CIS_COUNTRIES:
        return "FZ152_RUSSIE"
    if c == "CN":
        return "PIPL_CHINE"
    if c in {"JP", "KR", "IN", "AU"}:
        return "APAC_STRICT"
    if c in LATAM_COUNTRIES:
        return "LGPD_LATAM"
    return "GLOBAL_STANDARD"


def age_gate_for_country(country: Optional[str]) -> int:
    """Âge minimum d'inscription pour le pays (défaut : 15)."""
    return DIGITAL_CONSENT_AGE.get((country or "").upper(), 15)


def legal_profile_for_country(country: Optional[str]) -> dict:
    """Profil de conformité complet d'un pays. Consommé par le BACKEND (enforcement)
    ET le FRONTEND (quelle UI de consentement afficher). Le reste du monde
    (GLOBAL_STANDARD) : aucune friction."""
    c = (country or "").upper() or None
    block = legal_block_for_country(c)
    is_eu = bool(c and c in EU_COUNTRIES)
    read_only = bool(LEGAL_GEO_ROUTING and c and c in READ_ONLY_COUNTRIES)
    ro_msg = None
    if read_only:
        if c == "RU":
            ro_msg = ("Vymix est actuellement disponible en mode consultation en Russie, "
                      "conformément à la loi FZ-152.")
        elif c == "CN":
            ro_msg = ("Vymix 目前在中国仅提供浏览模式，以遵守《个人信息保护法》(PIPL)。 — "
                      "Mode consultation uniquement (PIPL).")
        else:
            ro_msg = "Mode consultation uniquement dans votre pays."
    return {
        "country": c,
        "block": block,
        "consent_style": _CONSENT_STYLE.get(block, "minimal"),
        "min_age": age_gate_for_country(c),
        "read_only": read_only,
        "read_only_message": ro_msg,
        "eu": is_eu,
        # Bannière cookies : UE + UK. Écran de consentement dédié : APAC strict (APPI).
        "cookie_banner": bool(is_eu or block == "ONLINE_SAFETY_UK"),
        "consent_screen": block == "APAC_STRICT",
        # Par défaut, pas de traceurs pub en UE (et coupés pour les mineurs UE au signup).
        "ad_tracking_default": not is_eu,
    }


async def enforce_write_allowed(request: Request):
    """Dépendance FastAPI : refuse toute écriture (publication, messagerie…) depuis
    un pays en mode consultation (RU, CN). 451 = indisponible pour raison légale."""
    if not LEGAL_GEO_ROUTING:
        return True
    prof = legal_profile_for_country(country_for_request(request))
    if prof["read_only"]:
        raise HTTPException(status_code=451,
                            detail=prof["read_only_message"] or "Action indisponible dans votre pays.")
    return True


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

    Renvoie le PROFIL DE CONFORMITÉ complet du pays (bloc légal, âge minimum,
    style de consentement, mode lecture seule…) — le front s'en sert pour
    afficher la bonne UI. `restricted`/`eu` conservés pour rétro-compatibilité.
    Best-effort : si la base GeoIP est absente, profil « GLOBAL_STANDARD ».
    """
    country = country_for_request(request)
    prof = legal_profile_for_country(country)
    # Langue suggérée d'après le pays (signal géo combiné à navigator côté front).
    return {**prof, "restricted": prof["eu"], "suggested_language": lang_for_country(country)}


# ==================== AUTH ROUTES ====================
MIN_SIGNUP_AGE = 15  # Loi française : pas de réseau social avant 15 ans.


def _compute_age(birthdate_str):
    """Âge en années à partir d'une date AAAA-MM-JJ. None si illisible."""
    if not birthdate_str:
        return None
    try:
        d = datetime.fromisoformat(str(birthdate_str)[:10]).date()
    except Exception:
        return None
    today = datetime.now(timezone.utc).date()
    if d > today:
        return None
    return today.year - d.year - ((today.month, today.day) < (d.month, d.day))


# ── Masquage des mots vulgaires pour les comptes MINEURS ──────────────────────
# Pour un viewer `is_minor`, les grossièretés des posts/sondages/commentaires sont
# masquées (1re lettre conservée + astérisques). Liste FR + EN volontairement
# compacte, focalisée sur les insultes/vulgarités les plus courantes.
_PROFANITY_WORDS = [
    # Français
    "putain", "put1", "pute", "putes", "connard", "connards", "connasse", "connasses",
    "salope", "salopes", "salaud", "salauds", "enculé", "enculés", "enculer", "encule",
    "encules", "nique", "niquer", "niqué", "niquée", "bite", "bites", "couille",
    "couilles", "chatte", "pédé", "pede", "tarlouze", "batard", "bâtard", "batards",
    "bâtards", "foutre", "chier", "chiant", "chiante", "merde", "merdes", "merdique",
    "bordel", "conne", "connes", "pouffiasse", "ntm",
    # Anglais
    "fuck", "fucking", "fucker", "motherfucker", "shit", "bullshit", "bitch",
    "bitches", "asshole", "dick", "cunt", "bastard", "whore", "slut", "faggot",
    # Insultes/slurs graves (toujours masqués)
    "nigger", "negro",
]
_PROFANITY_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in sorted(_PROFANITY_WORDS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE | re.UNICODE,
)


def _mask_profanity(text):
    """Masque les grossièretés : conserve la 1re lettre, remplace le reste par des
    astérisques (min. 2). Rien si le texte est vide."""
    if not text:
        return text
    def _sub(m):
        w = m.group(0)
        return w[0] + "*" * max(2, len(w) - 1)
    return _PROFANITY_RE.sub(_sub, text)


def _mask_post_for_minor(post: dict) -> dict:
    """Masque le contenu et les options de sondage d'un post (in place) pour un
    spectateur mineur."""
    if post.get("content"):
        post["content"] = _mask_profanity(post["content"])
    poll = post.get("poll")
    if isinstance(poll, dict):
        for opt in (poll.get("options") or []):
            if isinstance(opt, dict) and opt.get("text"):
                opt["text"] = _mask_profanity(opt["text"])
    return post


@api_router.post("/auth/register")
async def register(user_data: UserCreate, background_tasks: BackgroundTasks, request: Request):
    """Enregistre un nouvel utilisateur"""
    # Conformité par géographie (source de vérité serveur).
    country = country_for_request(request)
    legal = legal_profile_for_country(country)
    # Pays en mode consultation (RU, CN) : pas de création de compte (FZ-152 / PIPL).
    if legal["read_only"]:
        raise HTTPException(status_code=451,
                            detail=legal["read_only_message"] or "Inscription indisponible dans votre pays.")
    # Contrôle d'âge OBLIGATOIRE, seuil selon le pays (COPPA 13 US, RGPD 15/16 UE…).
    min_age = legal["min_age"]
    age = _compute_age(user_data.birthdate)
    if age is None:
        raise HTTPException(status_code=400, detail="Date de naissance requise (format AAAA-MM-JJ).")
    if age < min_age:
        raise HTTPException(
            status_code=403,
            detail=f"Inscription refusée : l'âge minimum requis dans votre pays est de {min_age} ans.",
        )

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
    # Protection des mineurs : < 18 ans → is_minor. Un compte mineur est FORCÉ en
    # privé (les réglages/DM/scroll seront restreints côté serveur et client).
    is_minor = age < 18
    is_private = True if is_minor else bool(user_data.is_private)
    # RGPD/DSA : pour un MINEUR de l'UE, on coupe le suivi publicitaire et le
    # profilage algorithmique (le feed « Pour toi » retombe en chronologique).
    eu_minor = bool(legal["eu"] and is_minor)
    user_to_insert = {
        "id": user_id,
        "username": user_data.username,
        "email": user_data.email,
        "password": hashed_password,
        "bio": user_data.bio,
        "profile_pic": None,
        "followers_count": 0,
        "following_count": 0,
        # Date de naissance CHIFFRÉE au repos (RGPD) + booléen d'âge en clair.
        "birthdate_enc": encrypt(str(user_data.birthdate)[:10]),
        "age_verified": True,  # >= 15 vérifié ci-dessus
        "is_minor": is_minor,
        "verification_status": "unverified",
        # Vérification EMAIL : si l'envoi d'email est configuré, le compte doit
        # confirmer son adresse (gate). Sinon on n'enferme personne → auto-vérifié.
        "email_verified": not _EMAIL_ENABLED,
        "phone_verified": False,
        "twofa_enabled": False,
        # Compte privé (forcé pour les mineurs, sinon selon le choix d'inscription).
        "is_private": is_private,
        "time_limit_enabled": True,
        "muted_words": [],
        # Conformité par géographie (source : IP à l'inscription).
        "signup_country": country,
        "legal_block": legal["block"],
        # Suivi pub / profilage algo : coupés d'office pour les mineurs de l'UE.
        "ad_tracking": (False if eu_minor else True),
        "algorithmic_profiling": (False if eu_minor else True),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_to_insert)

    # Parrainage : rattache le nouvel inscrit à son parrain (?ref=<username>) et
    # déclenche l'éventuelle récompense Premium. Best-effort (jamais bloquant).
    if user_data.ref:
        await _apply_referral(
            user_id,
            {"id": user_id, "username": user_data.username, "profile_pic": None},
            user_data.ref,
        )

    token = create_access_token({"sub": user_id})

    # Email de bienvenue + code de confirmation (best-effort, en tâche de fond).
    if _EMAIL_ENABLED and send_brevo_email:
        code = await _issue_otp(user_id, "email")
        background_tasks.add_task(
            send_brevo_email,
            user_data.email,
            "Bienvenue sur Nexus Social 🎉 — confirme ton email",
            f"<h1>Bienvenue {user_data.username} !</h1>"
            "<p>Ton compte est presque prêt. Confirme ton adresse email avec ce code :</p>"
            f"<p style='font-size:26px;font-weight:bold;letter-spacing:4px'>{code}</p>"
            "<p>Ce code expire dans 10 minutes.</p>",
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
            "is_private": bool(user_to_insert.get("is_private")),
            "is_minor": is_minor,
            "time_limit_enabled": True,
            "privacy_strict": False,
            "muted_words": [],
            "created_at": user_to_insert["created_at"]
        }
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin, request: Request, background_tasks: BackgroundTasks):
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

    # Compte bloqué pour non-respect de l'âge minimum (mineur confirmé < 15 ans).
    if user_raw.get("age_blocked"):
        raise HTTPException(
            status_code=403,
            detail=f"Ce compte n'est pas éligible : l'âge minimum est de {MIN_SIGNUP_AGE} ans (loi française).",
        )

    # Double authentification (2FA) : mot de passe OK mais un code email est requis.
    # On n'émet PAS de token ici ; le client devra confirmer via /auth/login/2fa.
    if user_raw.get("twofa_enabled") and _EMAIL_ENABLED and send_brevo_email:
        code = await _issue_otp(user_raw["id"], "2fa")
        background_tasks.add_task(
            send_brevo_email, user_raw["email"], "Ton code de connexion Nexus Social",
            "<p>Voici ton code de connexion :</p>"
            f"<p style='font-size:26px;font-weight:bold;letter-spacing:4px'>{code}</p>"
            "<p>Ce code expire dans 10 minutes. Si ce n'est pas toi, change ton mot de passe.</p>")
        return {"twofa_required": True, "email": user_raw["email"]}

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
            "is_private": bool(user.get("is_private")),
            "is_minor": bool(user.get("is_minor")),
            "daily_time_limit": user.get("daily_time_limit"),
            "time_limit_enabled": user.get("time_limit_enabled", True),
            "created_at": user["created_at"]
        }
    }


def _auth_payload(user: dict) -> dict:
    """Réponse standard de connexion (token + profil minimal)."""
    return {
        "token": create_access_token({"sub": user["id"]}),
        "user": {
            "id": user["id"], "username": user["username"], "email": user["email"],
            "bio": user.get("bio", ""), "profile_pic": user.get("profile_pic"),
            "followers_count": user.get("followers_count", 0),
            "following_count": user.get("following_count", 0),
            "is_private": bool(user.get("is_private")),
            "is_minor": bool(user.get("is_minor")),
            "daily_time_limit": user.get("daily_time_limit"),
            "time_limit_enabled": user.get("time_limit_enabled", True),
            "privacy_strict": bool(user.get("privacy_strict")),
            "show_active_status": user.get("show_active_status") is not False,
            "read_receipts": user.get("read_receipts") is not False,
            "hide_political": bool(user.get("hide_political")),
            "muted_words": user.get("muted_words") or [],
            "created_at": user.get("created_at"),
        },
    }


class TwoFAConfirm(BaseModel):
    email: EmailStr
    code: str


@api_router.post("/auth/login/2fa")
async def login_2fa(data: TwoFAConfirm, request: Request):
    """2e étape de connexion : vérifie le code email (double authentification)."""
    if not rate_limit(f"login2fa:{client_ip(request)}", max_attempts=10, window_seconds=300):
        raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez plus tard.")
    user_raw = await db.users.find_one({"email": data.email})
    if not user_raw:
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    if not await _check_otp(user_raw["id"], "2fa", (data.code or "").strip()):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    return _auth_payload(convert_mongo_doc_to_dict(user_raw))


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    email: EmailStr
    code: str
    new_password: str


@api_router.post("/auth/password/forgot")
async def password_forgot(data: ForgotIn, background_tasks: BackgroundTasks, request: Request):
    """Envoie un code de réinitialisation par email. Réponse identique que le
    compte existe ou non (on ne révèle pas l'existence d'une adresse)."""
    if not rate_limit(f"forgot:{client_ip(request)}", max_attempts=5, window_seconds=600):
        raise HTTPException(status_code=429, detail="Trop de demandes. Réessayez plus tard.")
    user = await db.users.find_one({"email": data.email}, {"id": 1, "username": 1, "email": 1})
    if user and _EMAIL_ENABLED and send_brevo_email:
        code = await _issue_otp(user["id"], "reset")
        background_tasks.add_task(
            send_brevo_email, user["email"], "Réinitialisation de ton mot de passe Nexus Social",
            "<p>Voici ton code pour réinitialiser ton mot de passe :</p>"
            f"<p style='font-size:26px;font-weight:bold;letter-spacing:4px'>{code}</p>"
            "<p>Ce code expire dans 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>")
    return {"sent": True}


@api_router.post("/auth/password/reset")
async def password_reset(data: ResetIn):
    """Réinitialise le mot de passe après vérification du code email."""
    if len((data.new_password or "")) < 6:
        raise HTTPException(status_code=400, detail="Le mot de passe doit faire au moins 6 caractères.")
    user = await db.users.find_one({"email": data.email}, {"id": 1})
    if not user or not await _check_otp(user["id"], "reset", (data.code or "").strip()):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password": pwd_context.hash(data.new_password)}})
    return {"reset": True}


class TwoFAToggle(BaseModel):
    enabled: bool


@api_router.put("/users/me/2fa")
async def set_twofa(data: TwoFAToggle, current_user: dict = Depends(get_current_user)):
    """Active/désactive la double authentification par email à la connexion."""
    if data.enabled and not _EMAIL_ENABLED:
        raise HTTPException(status_code=400, detail="L'envoi d'email n'est pas configuré : impossible d'activer la 2FA.")
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"twofa_enabled": bool(data.enabled)}})
    return {"twofa_enabled": bool(data.enabled)}


@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Récupère le profil de l'utilisateur actuel"""
    current_user["is_admin"] = is_admin_user(current_user)
    return User(**current_user)


@api_router.put("/users/me/show-sports")
async def update_show_sports(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Active/désactive les widgets sportifs (foot et/ou MMA). Ne modifie que les
    champs présents dans la requête."""
    update = {}
    if "show_sports" in data:
        update["show_sports"] = bool(data.get("show_sports"))
    if "show_mma" in data:
        update["show_mma"] = bool(data.get("show_mma"))
    if update:
        await db.users.update_one({"id": current_user["id"]}, {"$set": update})
    return {
        "show_sports": update.get("show_sports", current_user.get("show_sports") is not False),
        "show_mma": update.get("show_mma", current_user.get("show_mma") is not False),
    }


@api_router.put("/users/me/time-limit")
async def update_time_limit(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Limite de temps quotidienne (bien-être numérique). `daily_time_limit` en
    minutes (None/0 = désactivée) ; `time_limit_enabled` permet de couper
    explicitement l'option."""
    update = {}
    if "daily_time_limit" in data:
        v = data.get("daily_time_limit")
        if v in (None, "", 0, "0"):
            update["daily_time_limit"] = None
        else:
            try:
                update["daily_time_limit"] = max(5, min(1440, int(v)))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Durée invalide (minutes).")
    if "time_limit_enabled" in data:
        update["time_limit_enabled"] = bool(data.get("time_limit_enabled"))
    if update:
        await db.users.update_one({"id": current_user["id"]}, {"$set": update})
    return {
        "daily_time_limit": update.get("daily_time_limit", current_user.get("daily_time_limit")),
        "time_limit_enabled": update.get("time_limit_enabled", current_user.get("time_limit_enabled", True)),
    }


# Les routes /users/me/screen-time sont désormais dans routers/growth.py.


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


@api_router.put("/users/me/preferences")
async def update_preferences(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Préférences booléennes de confidentialité/contenu (façon Instagram) :
    - show_active_status : afficher le statut en ligne aux autres ;
    - read_receipts : confirmation de lecture (« Vu ») ;
    - hide_political : masquer les contenus politiques du fil.
    Seuls les champs fournis sont modifiés (mise à jour partielle)."""
    allowed = ("show_active_status", "read_receipts", "hide_political")
    update = {k: bool(data[k]) for k in allowed if k in data}
    if not update:
        raise HTTPException(status_code=400, detail="Aucune préférence valide")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": current_user["id"]}, {"$set": update})
    return {"success": True, **{k: update[k] for k in update if k != "updated_at"}}


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
async def billing_plan(debug: int = 0):
    """Infos publiques du plan Premium (prix réel Stripe) pour la page « Devenir
    Premium ». Public : pas d'auth requise. Ne renvoie jamais de prix inventé —
    si Stripe n'est pas branché, `enabled=false` et le prix est nul.

    `?debug=1` ajoute un diagnostic non sensible (type + message d'erreur Stripe,
    identifiant de prix, longueur/empreinte de la clé) pour dépanner sans fouiller
    les logs Cloud Run. Aucune donnée secrète n'est exposée (jamais la clé brute).
    """
    out = {"enabled": STRIPE_ENABLED, "amount": None, "currency": None, "interval": None}
    if STRIPE_ENABLED:
        try:
            price = stripe.Price.retrieve(STRIPE_PRICE_ID)
            # stripe v12+ : les objets ressources ne supportent plus .get()
            # (« a Price is not a dict »). On repasse en dict simple (JSON).
            price = json.loads(str(price))
            out["amount"] = (price.get("unit_amount") or 0) / 100.0
            out["currency"] = (price.get("currency") or "eur").upper()
            rec = price.get("recurring") or {}
            out["interval"] = rec.get("interval")  # "month" | "year"
        except Exception as e:
            print(f"⚠️ billing_plan: prix Stripe illisible ({type(e).__name__}: {e})")
            if debug:
                k = STRIPE_SECRET_KEY or ""
                out["debug"] = {
                    "error_type": type(e).__name__,
                    "error": str(e)[:400],
                    "price_id": STRIPE_PRICE_ID,
                    "key_prefix": (k[:8] + "…") if k else "(vide)",
                    "key_len": len(k),
                    "key_all_ascii": all(33 <= ord(c) <= 126 for c in k),
                    "mode": ("test" if k.startswith("sk_test_") else ("live" if k.startswith("sk_live_") else "?")),
                }
    return out


@api_router.post("/billing/create-checkout-session")
async def create_checkout_session(data: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Crée une session Stripe Checkout d'abonnement et renvoie l'URL de paiement.
    Corps : {plan: "monthly" | "annual"}. Mensuel 3,99 €, Annuel 34,99 €."""
    if not STRIPE_ENABLED:
        raise HTTPException(status_code=503, detail="Les paiements ne sont pas configurés")
    plan = (data.get("plan") or "monthly").lower()
    if plan == "annual" and STRIPE_PRICE_ID_ANNUAL:
        price_id = STRIPE_PRICE_ID_ANNUAL
    else:
        plan = "monthly"
        price_id = STRIPE_PRICE_ID_MONTHLY or STRIPE_PRICE_ID
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            customer_email=current_user.get("email"),
            client_reference_id=current_user["id"],
            metadata={"user_id": current_user["id"], "plan": plan},
            subscription_data={"metadata": {"user_id": current_user["id"], "plan": plan}},
            success_url=f"{FRONTEND_URL}/settings?sub=success",
            cancel_url=f"{FRONTEND_URL}/settings?sub=cancel",
        )
        return {"url": session.url}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur Stripe: {e}")


async def _activate_premium(user_id: str, plan: str = None, customer: str = None, subscription: str = None):
    """Passe un compte en Premium : is_premium=True + fin d'abonnement (premium_until)
    calculée selon l'offre (mensuel ≈ 31 j, annuel ≈ 366 j). Idempotent."""
    if not user_id:
        return None
    now = datetime.now(timezone.utc)
    days = 366 if (plan == "annual") else 31
    until = (now + timedelta(days=days)).isoformat()
    fields = {
        "is_premium": True,
        "subscription_status": "active",
        "premium_until": until,
        "updated_at": now.isoformat(),
    }
    if plan:
        fields["premium_plan"] = plan
    if customer:
        fields["stripe_customer_id"] = customer
    if subscription:
        fields["stripe_subscription_id"] = subscription
    await db.users.update_one({"id": user_id}, {"$set": fields})
    return until


# ==================== PARRAINAGE (boucle de croissance) ====================
REFERRAL_PER_REWARD = 3  # nombre de filleuls pour 1 mois Premium offert


async def _grant_referral_premium(user_id: str, months: int = 1):
    """Offre `months` mois de Premium via parrainage. PROLONGE l'abonnement
    existant (jamais de réduction) et ne touche pas aux champs Stripe."""
    if not user_id or months <= 0:
        return None
    now = datetime.now(timezone.utc)
    base = now
    try:
        u = await db.users.find_one({"id": user_id}, {"premium_until": 1})
        cur = (u or {}).get("premium_until")
        if cur:
            dt = datetime.fromisoformat(str(cur).replace("Z", "+00:00"))
            if dt > now:
                base = dt
    except Exception:
        base = now
    until = (base + timedelta(days=30 * months)).isoformat()
    await db.users.update_one({"id": user_id}, {"$set": {
        "is_premium": True,
        "premium_until": until,
        "premium_source": "referral",
        "updated_at": now.isoformat(),
    }})
    return until


async def _apply_referral(new_user_id: str, new_user: dict, ref):
    """Rattache un nouvel inscrit à son parrain (?ref=<username>), les fait se
    suivre mutuellement, et offre 1 mois Premium au parrain tous les
    REFERRAL_PER_REWARD filleuls. Best-effort : n'interrompt jamais l'inscription."""
    try:
        code = (ref or "").strip().lstrip("@")
        if not code or len(code) > 40:
            return
        referrer = await db.users.find_one(
            {"username": {"$regex": f"^{re.escape(code)}$", "$options": "i"}},
            {"id": 1, "username": 1, "profile_pic": 1},
        )
        if not referrer or referrer["id"] == new_user_id:
            return
        await db.users.update_one({"id": new_user_id}, {"$set": {"referred_by": referrer["id"]}})
        await db.users.update_one({"id": referrer["id"]}, {"$inc": {"referral_count": 1}})

        # Auto-follow mutuel parrain ↔ filleul (connexion consentie).
        async def _link(follower, followed_id):
            try:
                if follower["id"] == followed_id:
                    return
                if await db.follows.find_one(
                    {"follower_id": follower["id"], "followed_id": followed_id}
                ):
                    return
                await _do_follow(follower, followed_id)
            except Exception:
                pass
        await _link(new_user, referrer["id"])
        await _link(referrer, new_user_id)

        # Récompense : 1 mois Premium par palier de REFERRAL_PER_REWARD filleuls.
        fresh = await db.users.find_one(
            {"id": referrer["id"]}, {"referral_count": 1, "referral_rewards": 1}
        )
        count = int((fresh or {}).get("referral_count") or 0)
        rewards = int((fresh or {}).get("referral_rewards") or 0)
        eligible = count // REFERRAL_PER_REWARD
        if eligible > rewards:
            await _grant_referral_premium(referrer["id"], eligible - rewards)
            await db.users.update_one(
                {"id": referrer["id"]}, {"$set": {"referral_rewards": eligible}}
            )
    except Exception:
        pass


@api_router.get("/users/me/referrals")
async def my_referrals(current_user: dict = Depends(get_current_user)):
    """État du parrainage : code, compteur, récompenses, palier restant."""
    count = int(current_user.get("referral_count") or 0)
    rewards = int(current_user.get("referral_rewards") or 0)
    per = REFERRAL_PER_REWARD
    return {
        "code": current_user["username"],
        "count": count,
        "rewards_granted": rewards,
        "per_reward": per,
        "to_next": per - (count % per),
        "is_premium": bool(current_user.get("is_premium")),
        "premium_until": current_user.get("premium_until"),
    }


# Les routes growth (salles de match, stats créateur, amis proches, notifs
# utiles) sont désormais dans routers/growth.py.


@api_router.post("/premium/subscribe")
async def premium_subscribe(request: Request, data: dict = Body(...)):
    """Active l'abonnement Premium d'un utilisateur (is_premium=True) en base.
    Route INTERNE, appelée par le webhook Stripe / les opérations : protégée par
    la clé interne (x-poll-key). N'expose jamais l'auto-attribution côté client."""
    if not SPORTS_POLL_KEY:
        raise HTTPException(status_code=503, detail="Activation non configurée")
    key = request.headers.get("x-poll-key") or request.query_params.get("key") or ""
    if key != SPORTS_POLL_KEY:
        raise HTTPException(status_code=403, detail="Clé invalide")
    user_id = str(data.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requis")
    plan = (data.get("plan") or "").lower() or None
    until = await _activate_premium(user_id, plan, data.get("customer"), data.get("subscription"))
    return {"success": True, "user_id": user_id, "premium_until": until}


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


@api_router.get("/users/me/tips")
async def my_tips_received(current_user: dict = Depends(get_current_user)):
    """Historique simple des pourboires REÇUS par le créateur (les plus récents
    d'abord) + total et nombre. Montants en centimes (le front divise par 100)."""
    rows = await db.tips.find(
        {"creator_id": current_user["id"]}
    ).sort("created_at", -1).to_list(length=200)
    tips, total = [], 0
    for r in rows:
        amt = int(r.get("amount_total") or 0)
        total += amt
        tips.append({
            "id": r.get("id"),
            "from_user_id": r.get("from_user_id"),
            "from_username": r.get("from_username") or "Quelqu'un",
            "amount_total": amt,
            "currency": (r.get("currency") or "eur"),
            "created_at": r.get("created_at"),
        })
    return {"total_amount": total, "count": len(tips), "currency": "eur", "tips": tips}


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
    if amount > 100000:
        raise HTTPException(status_code=400, detail="Montant maximum : 1 000 €")

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


# ── PayPal Commerce Platform : reversement direct au créateur + commission ──
@api_router.get("/billing/paypal/status")
async def paypal_status(current_user: dict = Depends(get_current_user)):
    """État de l'activation PayPal (Commerce Platform) du créateur : peut-il
    encaisser des pourboires ? Rafraîchit depuis PayPal si un Partner ID est
    configuré, sinon se fie au drapeau stocké."""
    if not PAYPAL_ENABLED:
        return {"enabled": False, "connected": False, "receivable": False}
    merchant_id = current_user.get("paypal_merchant_id")
    if PAYPAL_PARTNER_ID:
        try:
            r = await _paypal_call("GET", f"/v1/customer/partners/{PAYPAL_PARTNER_ID}/merchant-integrations?tracking_id={current_user['id']}")
            if r.ok:
                d = r.json()
                merchant_id = d.get("merchant_id") or merchant_id
                receivable = bool(d.get("payments_receivable"))
                await db.users.update_one({"id": current_user["id"]}, {"$set": {
                    "paypal_merchant_id": merchant_id, "paypal_payments_receivable": receivable}})
                return {"enabled": True, "connected": bool(merchant_id), "receivable": receivable,
                        "email_confirmed": bool(d.get("primary_email_confirmed")), "fee_percent": PLATFORM_FEE_PERCENT}
        except Exception:
            pass
    return {"enabled": True, "connected": bool(merchant_id),
            "receivable": bool(current_user.get("paypal_payments_receivable")), "fee_percent": PLATFORM_FEE_PERCENT}


@api_router.post("/billing/paypal/onboard")
async def paypal_onboard(current_user: dict = Depends(get_current_user)):
    """Lien d'onboarding PayPal (Partner Referrals) : le créateur connecte son
    compte PayPal à Nexus pour encaisser directement (commission auto)."""
    if not PAYPAL_ENABLED:
        raise HTTPException(status_code=503, detail="PayPal n'est pas configuré")
    body = {
        "tracking_id": current_user["id"],
        "partner_config_override": {"return_url": f"{FRONTEND_URL}/settings?paypal=done"},
        "operations": [{"operation": "API_INTEGRATION", "api_integration_preference": {"rest_api_integration": {
            "integration_method": "PAYPAL", "integration_type": "THIRD_PARTY",
            "third_party_details": {"features": ["PAYMENT", "REFUND", "PARTNER_FEE"]}}}}],
        "products": ["EXPRESS_CHECKOUT"],
        "legal_consents": [{"type": "SHARE_DATA_CONSENT", "granted": True}],
    }
    try:
        r = await _paypal_call("POST", "/v2/customer/partner-referrals", body)
        if not r.ok:
            raise HTTPException(status_code=502, detail=f"PayPal: {r.text[:300]}")
        links = r.json().get("links", [])
        action = next((l.get("href") for l in links if l.get("rel") == "action_url"), None)
        if not action:
            raise HTTPException(status_code=502, detail="Lien d'onboarding PayPal indisponible")
        return {"url": action}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur PayPal: {e}")


@api_router.post("/users/{user_id}/paypal-tip")
async def paypal_tip_create(user_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Crée une commande PayPal (pourboire) : le créateur est le bénéficiaire,
    Nexus prélève sa commission via platform_fees. Renvoie le lien d'approbation."""
    if not PAYPAL_ENABLED:
        raise HTTPException(status_code=503, detail="PayPal n'est pas configuré")
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous envoyer un pourboire")
    creator = await db.users.find_one({"id": user_id})
    if not creator:
        raise HTTPException(status_code=404, detail="Créateur introuvable")
    merchant_id = creator.get("paypal_merchant_id")
    if not (merchant_id and creator.get("paypal_payments_receivable")):
        raise HTTPException(status_code=400, detail="Ce créateur n'a pas encore activé PayPal")
    cents = int(data.get("amount_cents") or 0)
    if cents < 100 or cents > 100000:
        raise HTTPException(status_code=400, detail="Montant entre 1 € et 1 000 €")
    amount = cents / 100.0
    fee = round(amount * PLATFORM_FEE_PERCENT / 100.0, 2)
    body = {
        "intent": "CAPTURE",
        "purchase_units": [{
            "amount": {"currency_code": "EUR", "value": f"{amount:.2f}"},
            "payee": {"merchant_id": merchant_id},
            "description": (f"Pourboire à @{creator.get('username')} sur Nexus")[:127],
            "custom_id": (f"tip:{user_id}:{current_user['id']}")[:127],
            "payment_instruction": {"disbursement_mode": "INSTANT",
                                    "platform_fees": [{"amount": {"currency_code": "EUR", "value": f"{fee:.2f}"}}]},
        }],
        "application_context": {
            "brand_name": "Nexus", "user_action": "PAY_NOW", "shipping_preference": "NO_SHIPPING",
            "return_url": f"{FRONTEND_URL}/profil/{user_id}?paypal_tip=capture",
            "cancel_url": f"{FRONTEND_URL}/profil/{user_id}?paypal_tip=cancel",
        },
    }
    try:
        r = await _paypal_call("POST", "/v2/checkout/orders", body,
                               extra_headers={"PayPal-Auth-Assertion": _paypal_auth_assertion(merchant_id)})
        if not r.ok:
            raise HTTPException(status_code=502, detail=f"PayPal: {r.text[:300]}")
        d = r.json()
        approve = next((l.get("href") for l in d.get("links", []) if l.get("rel") in ("approve", "payer-action")), None)
        if not approve:
            raise HTTPException(status_code=502, detail="Lien de paiement PayPal indisponible")
        return {"url": approve, "order_id": d.get("id")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur PayPal: {e}")


@api_router.post("/billing/paypal/capture")
async def paypal_capture(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Capture une commande PayPal approuvée (au retour du payeur) et enregistre
    le pourboire. Idempotent (un même capture n'est jamais compté deux fois)."""
    order_id = (data.get("order_id") or "").strip()
    if not (PAYPAL_ENABLED and order_id):
        raise HTTPException(status_code=400, detail="Commande PayPal invalide")
    try:
        r = await _paypal_call("POST", f"/v2/checkout/orders/{order_id}/capture", {})
        if not r.ok:
            raise HTTPException(status_code=502, detail=f"PayPal: {r.text[:300]}")
        d = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur PayPal: {e}")
    try:
        pu = d["purchase_units"][0]
        cap = pu["payments"]["captures"][0]
        value = cap["amount"]["value"]; currency = cap["amount"]["currency_code"]
        custom = cap.get("custom_id") or pu.get("custom_id") or ""
        cap_id = cap.get("id")
    except Exception:
        return {"status": d.get("status")}
    parts = custom.split(":")
    creator_id = parts[1] if (len(parts) >= 3 and parts[0] == "tip") else None
    amount_total = int(round(float(value) * 100))
    if creator_id and cap_id and not await db.tips.find_one({"paypal_capture_id": cap_id}):
        await db.tips.insert_one({
            "id": str(uuid.uuid4()), "creator_id": creator_id,
            "from_user_id": current_user["id"], "from_username": current_user.get("username"),
            "amount_total": amount_total, "currency": (currency or "eur").lower(),
            "method": "paypal", "paypal_capture_id": cap_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "type": "tip", "user_id": creator_id,
                "from_user_id": current_user["id"], "from_username": current_user.get("username"),
                "message": f"@{current_user.get('username')} vous a envoyé un pourboire de {amount_total/100:.2f} € via PayPal",
                "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
    return {"status": d.get("status"), "amount": value, "currency": currency}


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

    # stripe v12+ : les StripeObject ne supportent plus .get() (« is not a dict »).
    # Sans cette conversion, TOUT le handler ci-dessous (Premium, cadeaux,
    # pourboires) planterait en AttributeError et aucun paiement ne serait validé.
    event = json.loads(str(event))
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
        meta_sub = obj.get("metadata") or {}
        user_id = meta_sub.get("user_id") or obj.get("client_reference_id")
        if user_id and meta_sub.get("type") not in ("gift", "tip"):
            # Abonnement Premium validé → is_premium=True + premium_until (helper).
            await _activate_premium(user_id, plan=(meta_sub.get("plan") or "monthly"),
                                    customer=obj.get("customer"), subscription=obj.get("subscription"))
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
    cover_pic: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Met à jour le profil de l'utilisateur"""
    update_data = {}

    if bio is not None:
        update_data["bio"] = bio

    if profile_pic:
        contents = await profile_pic.read()
        data_url = f"data:{profile_pic.content_type};base64,{base64.b64encode(contents).decode('utf-8')}"
        # Décharge l'avatar vers Cloudinary (URL légère au lieu de base64 en base).
        update_data["profile_pic"] = await store_media(data_url, folder="avatars")

    if cover_pic:
        contents = await cover_pic.read()
        data_url = f"data:{cover_pic.content_type};base64,{base64.b64encode(contents).decode('utf-8')}"
        # Bannière de couverture → Cloudinary (dossier dédié).
        update_data["cover_pic"] = await store_media(data_url, folder="covers")

    if update_data:
        await db.users.update_one({"id": current_user["id"]}, {"$set": update_data})
   
    updated_user_raw = await db.users.find_one({"id": current_user["id"]})
    updated_user = convert_mongo_doc_to_dict(updated_user_raw)
    return User(**updated_user)

def _sanitize_muted_words(words) -> list:
    """Nettoie une liste de mots masqués : chaînes non vides, sans doublon
    (insensible à la casse), longueur d'un terme et nombre total bornés
    (anti-abus). Conserve la casse d'origine pour l'affichage."""
    if not isinstance(words, list):
        return []
    out, seen = [], set()
    for w in words:
        if not isinstance(w, str):
            continue
        t = w.strip()[:60]
        if not t:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
        if len(out) >= 200:
            break
    return out


@api_router.put("/users/me/privacy")
async def update_privacy_settings(
    privacy_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Met à jour les réglages de confidentialité.

    On ne modifie QUE les champs réellement présents dans la requête (merge) :
    un appel qui ne change que `privacy_strict` ne doit pas réinitialiser
    `is_private`, et inversement.

    - is_private     : compte privé (abonnés approuvés uniquement).
    - privacy_strict : Mode Confidentialité stricte (coupe les analytics non
      essentiels côté serveur + les pubs ciblées côté client)."""
    try:
        update: dict = {"privacy_updated_at": datetime.now(timezone.utc).isoformat()}
        if "is_private" in privacy_data:
            update["is_private"] = bool(privacy_data.get("is_private"))
        if "privacy_strict" in privacy_data:
            update["privacy_strict"] = bool(privacy_data.get("privacy_strict"))
        if "muted_words" in privacy_data:
            update["muted_words"] = _sanitize_muted_words(privacy_data.get("muted_words"))

        await db.users.update_one({"id": current_user["id"]}, {"$set": update})

        # Mettre à jour l'utilisateur en mémoire
        updated_user = await db.users.find_one({"id": current_user["id"]})

        return {
            "success": True,
            "is_private": bool((updated_user or {}).get("is_private")),
            "privacy_strict": bool((updated_user or {}).get("privacy_strict")),
            "muted_words": (updated_user or {}).get("muted_words") or [],
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
            "phone", "birthdate", "gender", "website", "crypto_wallet", "paypal_link"
        ]

        update_data = {
            k: v for k, v in profile_data.items()
            if k in allowed_fields and v is not None
        }
        # PayPal : on stocke un lien PayPal.me normalisé (ou vide pour effacer).
        if "paypal_link" in update_data:
            update_data["paypal_link"] = normalize_paypal(update_data["paypal_link"]) or ""

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
                "crypto_wallet": user_dict.get("crypto_wallet", ""),
                "paypal_link": user_dict.get("paypal_link", "")
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

        # Mode Confidentialité stricte : on NE crée AUCUN enregistrement de
        # session (analytics de temps d'écran = non essentiel). Défense en
        # profondeur : même si le client oublie de couper le suivi, le serveur
        # ne stocke rien. On renvoie une session « factice » non persistée pour
        # ne pas casser le client.
        if current_user.get("privacy_strict"):
            return {"success": True, "session_id": "", "started_at": now.isoformat(), "privacy_strict": True}

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
        
        # Compter les likes/commentaires reçus — PROJECTION légère (surtout PAS
        # media_url : c'est du base64 potentiellement lourd, inutile pour un total,
        # et charger tous les médias en mémoire faisait grimper la RAM → OOM).
        posts = await db.posts.find(
            {"author_id": current_user["id"]},
            {"likes_count": 1, "comments_count": 1},
        ).to_list(length=5000)
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
async def create_post(post_data: PostCreate, current_user: dict = Depends(get_current_user),
                      _geo: bool = Depends(enforce_write_allowed)):
    """Créer un nouveau post"""
    # Modération auto (toxicité + NSFW) : bloque le contenu interdit avant insertion.
    verdict = await screen_content(text=post_data.content, media_url=post_data.media_url)

    # Décharge le média vers Cloudinary (URL légère) au lieu de base64 en base.
    post_data.media_url = await store_media(post_data.media_url, folder="posts")

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

# ── Filtre éthique « contenu politique » (bien-être) ────────────────────────
# Termes/hashtags à signal politique FORT (curés pour limiter les faux positifs).
# Quand `hide_political` est activé, ces publications sont retirées des fils algo.
_POLITICAL_TERMS = {
    "politique", "presidentielle", "election", "elections", "gouvernement",
    "ministre", "assemblee nationale", "senat", "depute", "parlement", "elysee",
    "matignon", "referendum", "campagne electorale", "reforme des retraites",
    "extreme droite", "extreme gauche", "rassemblement national", "front national",
    "macron", "le pen", "melenchon", "zemmour", "bardella", "trump", "biden",
    "poutine", "geopolitique", "parti politique", "scrutin", "legislatives",
}


def _norm_txt(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9# ]+", " ", s)


def _is_political(text: str) -> bool:
    norm = _norm_txt(text)
    if not norm:
        return False
    padded = f" {norm} "
    for kw in _POLITICAL_TERMS:
        needle = f" {kw} " if " " in kw else None
        if needle:
            if needle in padded:
                return True
        elif f" {kw} " in padded or f" #{kw} " in padded:
            return True
    return False


def _drop_political(posts, enabled):
    """Retire les publications à contenu politique si l'utilisateur l'a demandé."""
    if not enabled:
        return posts
    return [p for p in posts if not _is_political(getattr(p, "content", None) if not isinstance(p, dict) else p.get("content"))]


@api_router.get("/posts/feed", response_model=List[Post])
async def get_posts_feed(request: Request, skip: int = 0, limit: int = 10, current_user: dict = Depends(get_current_user)):
    """Feed « Abonnements » (comptes suivis), paginé (skip/limit) pour un premier
    affichage rapide + scroll infini. Charger 50 posts d'un coup rendait le fil
    lent (surtout avec des médias lourds) → petites pages.

    Le base64 des médias n'est PAS chargé (agrégation → sentinel/proxy) : anti-OOM."""
    limit = max(1, min(limit, 30))
    media_base = _media_public_base(request)
    # Récupère les utilisateurs suivis
    follows_raw = await db.follows.find({
        "follower_id": current_user["id"],
        "status": "following"  # ← IMPORTANT: seulement les follows confirmés
    }).to_list(length=2000)

    # Support ancien format (following_id) et nouveau (followed_id)
    followed_user_ids = []
    for f in follows_raw:
        f_dict = convert_mongo_doc_to_dict(f)
        # Essaie followed_id puis following_id (rétrocompatibilité)
        user_id = f_dict.get("followed_id") or f_dict.get("following_id")
        if user_id:
            followed_user_ids.append(user_id)

    followed_user_ids.append(current_user["id"])

    # Récupère les posts (page) — sans charger le base64 des médias.
    posts_raw = await db.posts.aggregate([
        {"$match": {"author_id": {"$in": followed_user_ids}}},
        {"$sort": {"created_at": -1}},
        {"$skip": max(0, skip)},
        {"$limit": limit},
        _drop_base64_media_stage(),
    ], allowDiskUse=True).to_list(length=limit)

    posts = []
    direct_ids = [p.get("id") for p in posts_raw]
    # Reposts : l'engagement (compteurs + is_liked) vit sur la publication D'ORIGINE.
    orig_ids = [p.get("repost_of") for p in posts_raw if p.get("repost_of")]
    saved_ids = await _saved_post_ids(current_user["id"], direct_ids)
    premium_ids = await _premium_author_ids([p.get("author_id") for p in posts_raw])
    tip_ids = await _tip_author_ids([p.get("author_id") for p in posts_raw])
    # BATCH (anti N+1) : un seul find pour tous les likes du spectateur (posts
    # directs + originaux des reposts), et un seul find pour l'engagement des
    # originaux — au lieu d'une requête par post dans la boucle.
    like_targets = list({*(i for i in direct_ids if i), *orig_ids})
    liked = {l.get("post_id") for l in await db.likes.find(
        {"post_id": {"$in": like_targets}, "user_id": current_user["id"]}, {"post_id": 1}
    ).to_list(length=len(like_targets) or 1)} if like_targets else set()
    orig_by_id = {}
    if orig_ids:
        for o in await db.posts.find(
            {"id": {"$in": list(set(orig_ids))}},
            {"id": 1, "likes_count": 1, "comments_count": 1, "shares_count": 1, "views": 1},
        ).to_list(length=len(orig_ids)):
            orig_by_id[o.get("id")] = o
    for post_raw in posts_raw:
        try:
            post = convert_mongo_doc_to_dict(post_raw)
            _resolve_media_sentinel(post, media_base)
            oid = post.get("repost_of")
            if oid:  # repost → compteurs + is_liked de l'original (façon TikTok)
                orig = orig_by_id.get(oid)
                if orig:
                    post["likes_count"] = orig.get("likes_count", 0) or 0
                    post["comments_count"] = orig.get("comments_count", 0) or 0
                    post["shares_count"] = orig.get("shares_count", 0) or 0
                    post["views"] = orig.get("views", 0) or 0
                post["is_liked"] = oid in liked
            else:
                post["is_liked"] = post["id"] in liked
            post["is_saved"] = post["id"] in saved_ids
            post["author_is_premium"] = post.get("author_id") in premium_ids
            post["author_can_receive_tips"] = post.get("author_id") in tip_ids
            enrich_post_poll(post, current_user["id"])
            if current_user.get("is_minor"):
                _mask_post_for_minor(post)
            posts.append(Post(**post))
        except Exception as e:
            logger.warning(f"/posts/feed — post ignoré {post_raw.get('id')}: {e}")

    return _drop_political(posts, current_user.get("hide_political") is True)

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
    author_id = post.get("author_id")
    author = await db.users.find_one({"id": author_id}, {"is_premium": 1, "is_private": 1}) if author_id else None
    # Confidentialité : une publication d'un compte privé n'est lisible que par
    # ses abonnés approuvés (et par l'auteur lui-même).
    if author and author.get("is_private") and author_id != current_user["id"]:
        if not await check_is_following(current_user["id"], author_id):
            raise HTTPException(status_code=403, detail="Ce compte est privé. Vous devez être abonné pour voir cette publication.")
    like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
    post["is_liked"] = bool(like_raw)
    post["is_saved"] = bool(await db.saved_posts.find_one({"post_id": post["id"], "user_id": current_user["id"]}))
    post["author_is_premium"] = bool(author and author.get("is_premium"))
    enrich_post_poll(post, current_user["id"])
    if current_user.get("is_minor"):
        _mask_post_for_minor(post)
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

async def _canonical_engagement_target(post_id: str):
    """Renvoie (id_canonique, doc) de la publication qui PORTE l'engagement.

    Pour un repost (repost_of défini), l'engagement — likes, commentaires, vues —
    vit sur la vidéo/publication D'ORIGINE (façon TikTok). On résout donc vers
    l'original. Sinon on renvoie la publication elle-même."""
    doc = await db.posts.find_one({"id": post_id})
    if not doc:
        return post_id, None
    oid = doc.get("repost_of")
    if oid:
        orig = await db.posts.find_one({"id": oid})
        if orig:
            return oid, orig
    return post_id, doc


async def _hydrate_repost_engagement(post: dict, viewer_id: str):
    """Pour un repost affiché dans un fil : montre l'engagement LIVE de la
    publication D'ORIGINE (likes, commentaires, partages, vues) et l'état
    is_liked du spectateur calculé sur l'original. Ainsi un repost n'a jamais de
    compteurs « à lui » : tout vit sur la vidéo originale (façon TikTok)."""
    oid = post.get("repost_of")
    if not oid:
        return post
    orig = await db.posts.find_one(
        {"id": oid},
        {"likes_count": 1, "comments_count": 1, "shares_count": 1, "views": 1},
    )
    if orig:
        post["likes_count"] = orig.get("likes_count", 0) or 0
        post["comments_count"] = orig.get("comments_count", 0) or 0
        post["shares_count"] = orig.get("shares_count", 0) or 0
        post["views"] = orig.get("views", 0) or 0
    post["is_liked"] = bool(await db.likes.find_one({"post_id": oid, "user_id": viewer_id}))
    return post


@api_router.post("/posts/{post_id}/like")
async def like_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Like/unlike un post. Un like sur un repost compte sur la publication
    d'origine (l'engagement reste sur la vidéo originale)."""
    post_id, post_raw = await _canonical_engagement_target(post_id)
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


async def _tip_author_ids(author_ids):
    """Sous-ensemble des author_ids pouvant recevoir un pourboire (compte Stripe
    Connect démarré). Même critère que le profil (bouton Pourboire). Batch."""
    ids = [a for a in set(author_ids or []) if a]
    if not ids:
        return set()
    rows = await db.users.find(
        {"id": {"$in": ids}, "stripe_account_id": {"$ne": None}}, {"id": 1}
    ).to_list(length=len(ids))
    return {r.get("id") for r in rows}


@api_router.post("/posts/{post_id}/save")
async def save_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Enregistre / retire des enregistrements un post ou un clip (façon signet)."""
    post_raw = await db.posts.find_one({"id": post_id}, {"id": 1, "author_id": 1, "content": 1})
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

    # Abonnés Premium parmi les auteurs → badge + remontée en tête (avantage réel).
    premium_ids = await _premium_author_ids([c.get("author_id") for c in comments_raw])

    minor = bool(current_user.get("is_minor"))
    comments = []
    for comment_raw in comments_raw:
        comment = convert_mongo_doc_to_dict(comment_raw)
        comment["is_liked"] = comment.get("id") in liked_ids
        comment["author_is_premium"] = comment.get("author_id") in premium_ids
        if minor and comment.get("content"):
            comment["content"] = _mask_profanity(comment["content"])
        comments.append(Comment(**comment))

    # Les commentaires des abonnés Premium remontent EN TÊTE (l'ordre par date
    # récente est conservé à l'intérieur de chaque groupe — tri stable).
    comments.sort(key=lambda c: 0 if c.author_is_premium else 1)

    return comments

@api_router.post("/posts/{post_id}/comments", response_model=Comment)
async def create_comment(post_id: str, comment_data: CommentCreate, current_user: dict = Depends(get_current_user),
                         _geo: bool = Depends(enforce_write_allowed)):
    """Ajoute un commentaire à un post. Un commentaire sur un repost est rattaché
    à la publication d'origine (l'engagement reste sur l'originale)."""
    post_id, post_raw = await _canonical_engagement_target(post_id)
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

    # Visite de profil (widget Premium « Visites du profil ») : on note QUI a vu
    # QUEL profil, dédoublonné par jour, jamais pour ses propres visites.
    if current_user["id"] != user_id:
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            await db.profile_views.update_one(
                {"profile_id": user_id, "viewer_id": current_user["id"], "day": today},
                {"$set": {"ts": datetime.now(timezone.utc).isoformat()},
                 "$setOnInsert": {"profile_id": user_id, "viewer_id": current_user["id"], "day": today}},
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"profile_views: enregistrement échoué ({e})")

    return UserProfile(
        id=user["id"],
        username=user["username"],
        bio=user.get("bio", ""),
        profile_pic=user.get("profile_pic"),
        cover_pic=user.get("cover_pic"),
        followers_count=user.get("followers_count", 0),
        following_count=user.get("following_count", 0),
        is_following=is_following,
        is_verified=user.get("is_verified", False),
        is_premium=user.get("is_premium", False),
        can_receive_tips=bool(user.get("stripe_account_id")),
        paypal_receivable=bool(user.get("paypal_merchant_id") and user.get("paypal_payments_receivable")),
        paypal_link=normalize_paypal(user.get("paypal_link")),
        crypto_wallet=user.get("crypto_wallet"),
        created_at=user["created_at"]
    )

@api_router.get("/users/me/profile-views")
async def my_profile_views(current_user: dict = Depends(get_current_user)):
    """Widget Premium « Visites du profil » : nombre total de visiteurs uniques
    (30 j) + aperçu des plus récents. Les avatars ne sont renvoyés qu'aux abonnés
    Premium (paywall : côté gratuit, le front floute et propose l'abonnement)."""
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    rows = await db.profile_views.find(
        {"profile_id": current_user["id"], "ts": {"$gte": since}}
    ).sort("ts", -1).to_list(length=500)
    # Visiteurs uniques (le plus récent d'abord).
    seen, ordered = set(), []
    for r in rows:
        vid = r.get("viewer_id")
        if vid and vid not in seen:
            seen.add(vid)
            ordered.append(vid)
    total = len(ordered)
    is_premium = bool(current_user.get("is_premium"))
    visitors = []
    if is_premium and ordered:
        top = ordered[:12]
        users = await db.users.find(
            {"id": {"$in": top}}, {"id": 1, "username": 1, "profile_pic": 1, "is_verified": 1, "is_premium": 1}
        ).to_list(length=len(top))
        by_id = {u["id"]: u for u in users}
        for vid in top:
            u = by_id.get(vid)
            if u:
                visitors.append({
                    "id": u["id"], "username": u.get("username"),
                    "profile_pic": u.get("profile_pic"),
                    "is_verified": bool(u.get("is_verified")), "is_premium": bool(u.get("is_premium")),
                })
    return {"count": total, "is_premium": is_premium, "visitors": visitors}


@api_router.get("/users/{user_id}/posts")
async def get_user_posts(user_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Récupère les posts d'un utilisateur (avec vérification privacy).

    NB : pas de `response_model=List[Post]`. Ce paramètre déclenchait une
    RE-validation Pydantic de la réponse APRÈS le retour de l'endpoint (hors
    de notre try/except) ; sur un document lourd/ancien, elle pouvait lever un
    500 non géré, masqué en « erreur CORS » côté navigateur. Les objets sont
    déjà validés (Post(**post)) dans la boucle ci-dessous ; on sérialise une
    seule fois via jsonable_encoder, sans double passe fragile.
    """
    
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
    # Tout est protégé : le profil doit TOUJOURS charger (au pire liste vide),
    # jamais un 500 (qui, non géré, était masqué en « erreur CORS » côté navigateur).
    media_base = _media_public_base(request)
    try:
        # allow_disk_use : les médias base64 gonflent les documents ; sans index
        # couvrant, le tri en mémoire dépasse la limite 32 Mo de MongoDB (erreur
        # 292). On autorise le tri sur disque (+ index créés au démarrage).
        # Agrégation avec _drop_base64_media_stage : le base64 des médias N'EST
        # PLUS chargé (remplacé par un sentinel → proxy) — sinon 50 documents
        # lourds saturaient la RAM et l'instance Cloud Run était TUÉE (OOM/500
        # masqué en « erreur CORS »).
        posts_raw = await db.posts.aggregate([
            {"$match": {"author_id": user_id, "repost_of": None}},
            {"$sort": {"pinned": -1, "created_at": -1}},
            {"$limit": 50},
            _drop_base64_media_stage(),
        ], allowDiskUse=True).to_list(length=50)
    except Exception as e:
        logger.exception(f"/users/{user_id}/posts — requête échouée: {e}")
        return []

    # Statut Premium + éligibilité aux pourboires de l'auteur : une seule lecture.
    author = await db.users.find_one({"id": user_id}, {"is_premium": 1, "stripe_account_id": 1})
    author_premium = bool(author and author.get("is_premium"))
    author_tips = bool(author and author.get("stripe_account_id"))

    posts = []
    for post_raw in posts_raw:
        # Tout le traitement d'une publication est protégé : une seule entrée
        # ancienne/incomplète ne doit JAMAIS faire échouer tout le profil.
        try:
            post = convert_mongo_doc_to_dict(post_raw)
            _resolve_media_sentinel(post, media_base)
            like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
            post["is_liked"] = bool(like_raw)
            post["author_is_premium"] = author_premium
            post["author_can_receive_tips"] = author_tips
            post["is_pinned"] = bool(post.get("pinned"))
            enrich_post_poll(post, current_user["id"])
            posts.append(Post(**post))
        except Exception as e:
            logger.warning(f"Publication ignorée (invalide) {post_raw.get('id')}: {e}")
            continue

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
        # Engagement (likes/commentaires/partages/vues) + is_liked : tout vient de
        # la publication d'origine (le repost n'a pas de compteurs propres).
        await _hydrate_repost_engagement(post, current_user["id"])
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
        try:
            post = convert_mongo_doc_to_dict(post_raw)
            like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
            post["is_liked"] = bool(like_raw)
            enrich_post_poll(post, current_user["id"])
            posts.append(Post(**post))
        except Exception as e:
            logger.warning(f"Publication ignorée (invalide) {post_raw.get('id')}: {e}")

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
    """Crée l'abonnement effectif (comptes publics ou requête acceptée).

    `status: "following"` est OBLIGATOIRE : plusieurs fils (Abonnements, Pour
    vous, Clips) et le calcul des abonnements filtrent dessus. Sans lui, un
    abonnement créé ici serait invisible pour tout le reste du système."""
    await db.follows.insert_one({
        "id": str(uuid.uuid4()),
        "follower_id": follower["id"],
        "followed_id": user_id,
        "status": "following",
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


# Durée MAX d'un direct : au-delà, une session encore marquée « active » est
# considérée comme FANTÔME (l'hôte a fermé l'app sans appeler /live/stop). On la
# filtre et on la nettoie → plus de « vous êtes en live » qui reste bloqué.
LIVE_MAX_HOURS = 3


@api_router.get("/live/active")
async def active_lives(current_user: dict = Depends(get_current_user)):
    """Directs EN COURS parmi les comptes suivis (abonnements) + soi-même.

    Anti-live-fantôme : une session « active » plus vieille que LIVE_MAX_HOURS est
    ignorée ET remise à active=False (nettoyage opportuniste)."""
    allowed = set(await _followed_ids(current_user["id"]))
    allowed.add(current_user["id"])
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=LIVE_MAX_HOURS)).isoformat()
    out, stale = [], []
    async for s in db.live_sessions.find({"active": True}):
        started = s.get("started_at") or ""
        # started_at est une chaîne ISO UTC → comparaison lexicographique = chrono.
        if not started or started < cutoff:
            stale.append(s.get("host_id"))
            continue
        if s.get("host_id") in allowed:
            out.append({
                "host_id": s.get("host_id"),
                "host_username": s.get("host_username"),
                "host_profile_pic": s.get("host_profile_pic"),
                "room_id": s.get("room_id"),
                "started_at": s.get("started_at"),
            })
    if stale:
        await db.live_sessions.update_many(
            {"host_id": {"$in": [h for h in stale if h]}}, {"$set": {"active": False}}
        )
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


# ==================== PRÉFÉRENCES DE NOTIFICATION ====================
@api_router.get("/notifications/settings")
async def get_notif_settings(current_user: dict = Depends(get_current_user)):
    """Préférences de notification de l'utilisateur (types désactivés + comptes
    coupés). `types` liste les types connus pour l'UI."""
    pref = await db.notification_prefs.find_one({"user_id": current_user["id"]}) or {}
    return {
        "types": NOTIF_TYPES,
        "disabled_types": pref.get("disabled_types", []),
        "muted_accounts": pref.get("muted_accounts", []),
    }


@api_router.put("/notifications/settings")
async def update_notif_settings(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Met à jour les types désactivés (liste complète remplacée)."""
    update = {}
    if "disabled_types" in data and isinstance(data["disabled_types"], list):
        # On ne garde que des types connus.
        update["disabled_types"] = [t for t in data["disabled_types"] if t in NOTIF_TYPES]
    if update:
        await db.notification_prefs.update_one(
            {"user_id": current_user["id"]}, {"$set": update}, upsert=True
        )
    return {"success": True}


@api_router.post("/notifications/mute/{target_id}")
async def toggle_mute_account(target_id: str, current_user: dict = Depends(get_current_user)):
    """Active/désactive la coupure des notifications d'un compte précis."""
    pref = await db.notification_prefs.find_one({"user_id": current_user["id"]}) or {}
    muted = set(pref.get("muted_accounts") or [])
    if target_id in muted:
        muted.discard(target_id)
        state = False
    else:
        muted.add(target_id)
        state = True
    await db.notification_prefs.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"muted_accounts": list(muted)}}, upsert=True,
    )
    return {"success": True, "muted": state}


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
        try:
            notifications.append(Notification(**notif))
        except Exception as e:
            # Une notification malformée ne doit JAMAIS casser toute la liste.
            logger.warning(f"Notification ignorée (invalide) : {e}")
            continue

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


class NotifPrefs(BaseModel):
    prefs: Dict[str, bool]


@api_router.get("/notifications/preferences")
async def get_notif_preferences(current_user: dict = Depends(get_current_user)):
    """Préférences de notification par type (tout activé par défaut)."""
    u = await db.users.find_one({"id": current_user["id"]}, {"notif_prefs": 1})
    prefs = (u or {}).get("notif_prefs") or {}
    return {t: bool(prefs.get(t, True)) for t in NOTIF_TYPES}


@api_router.put("/notifications/preferences")
async def set_notif_preferences(data: NotifPrefs, current_user: dict = Depends(get_current_user)):
    """Active/désactive des types de notification."""
    clean = {t: bool(v) for t, v in (data.prefs or {}).items() if t in NOTIF_TYPES}
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"notif_prefs": clean}})
    return {"success": True, "prefs": clean}


# ==================== MESSAGES ROUTES ====================
@api_router.get("/messages/conversations", response_model=List[Conversation])
async def get_conversations(current_user: dict = Depends(get_current_user)):
    """Récupère les conversations de l'utilisateur"""
    # Repli de livraison : envoie les messages planifiés échus de l'expéditeur
    # (au cas où le cron ne tournerait pas).
    try:
        await _dispatch_due_scheduled(current_user["id"])
    except Exception:
        pass
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
    # 1er passage : messages triés DESC → le premier message VISIBLE rencontré
    # pour chaque interlocuteur est le plus récent (aperçu + horodatage). On ne
    # touche PAS la base ici (anti N+1).
    latest_by_peer = {}
    for msg_raw in messages_raw:
        msg = convert_mongo_doc_to_dict(msg_raw)
        other_user_id = msg["recipient_id"] if msg["sender_id"] == current_user["id"] else msg["sender_id"]
        if other_user_id in latest_by_peer:
            continue  # déjà le plus récent pour cet interlocuteur
        exp = msg.get("expires_at")
        if exp and exp <= now_iso:
            continue  # message éphémère expiré → ne compte pas pour l'aperçu
        cleared_at = clears.get(other_user_id)
        if cleared_at and (msg.get("created_at") or "") <= cleared_at:
            continue  # message plus ancien que l'effacement → ignoré
        latest_by_peer[other_user_id] = msg

    peer_ids = list(latest_by_peer.keys())
    if not peer_ids:
        return []
    # BATCH (anti N+1) : un seul find pour tous les interlocuteurs, et une seule
    # agrégation pour tous les compteurs de non-lus — au lieu de 2 requêtes PAR
    # conversation (find_one utilisateur + count_documents non-lus).
    users_by_id = {u.get("id"): convert_mongo_doc_to_dict(u) for u in await db.users.find(
        {"id": {"$in": peer_ids}}, {"id": 1, "username": 1, "profile_pic": 1, "last_active": 1, "show_active_status": 1}
    ).to_list(length=len(peer_ids))}
    # Présence : « en ligne » = actif il y a moins de 2 min, ET l'interlocuteur
    # n'a PAS masqué son statut (show_active_status). Respect de la vie privée.
    _online_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    unread_by_peer = {r.get("_id"): r.get("n", 0) for r in await db.messages.aggregate([
        {"$match": {"sender_id": {"$in": peer_ids}, "recipient_id": current_user["id"], "read": False}},
        {"$group": {"_id": "$sender_id", "n": {"$sum": 1}}},
    ]).to_list(length=len(peer_ids))}

    conversations = []
    for other_user_id, msg in latest_by_peer.items():  # ordre = plus récent d'abord
        other_user = users_by_id.get(other_user_id)
        if not other_user:
            continue
        # Aperçu : texte déchiffré, ou « 📷 Photo » pour un média (ou une image
        # collée en texte, pour ne pas afficher un pavé de base64).
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
        peer_online = (other_user.get("show_active_status") is not False
                       and (other_user.get("last_active") or "") >= _online_cutoff)
        conversations.append(Conversation(
            user_id=other_user["id"],
            username=other_user["username"],
            profile_pic=other_user.get("profile_pic"),
            last_message=preview,
            last_message_time=msg["created_at"],
            unread_count=unread_by_peer.get(other_user_id, 0),
            pinned=p.get("pinned", False),
            muted=p.get("muted", False),
            marked_unread=p.get("marked_unread", False),
            is_online=peer_online,
        ))

    return conversations

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
async def get_messages_with_user(user_id: str, request: Request, current_user: dict = Depends(get_current_user)):
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

    # ANTI-OOM / fil léger : on NE transfère PAS le base64 des médias depuis
    # MongoDB. Une étape d'agrégation le remplace par un sentinel « nexusmedia:<id> »
    # (le base64 ne quitte jamais la base), puis on le résout en URL SIGNÉE du
    # proxy média (servi à la demande, avec Range + cache). Sans ça, ouvrir une
    # conversation contenant des photos/vidéos transférait des Mo de base64 inline
    # → affichage lent. Les URL Cloudinary (déjà externes) sont conservées.
    media_base = _media_public_base(request)
    messages_raw = await db.messages.aggregate([
        {"$match": query},
        {"$sort": {"created_at": -1}},
        {"$limit": 60},
        _drop_base64_media_stage(),
    ], allowDiskUse=True).to_list(length=60)
    messages_raw.reverse()

    messages = []
    for msg_raw in messages_raw:
        msg = convert_mongo_doc_to_dict(msg_raw)
        msg["content"] = decrypt_message(msg.get("content"))
        _resolve_media_sentinel(msg, media_base, "message")
        messages.append(Message(**msg))

    # Marquer les messages reçus comme lus. Confirmation de lecture (« Vu ») :
    # seulement si le LECTEUR l'autorise (read_receipts). Sinon on marque lu pour
    # SON propre compteur de non-lus, mais on ne révèle RIEN à l'expéditeur.
    now_read = datetime.now(timezone.utc).isoformat()
    if current_user.get("read_receipts") is not False:
        res = await db.messages.update_many(
            {"sender_id": user_id, "recipient_id": current_user["id"], "read": False},
            {"$set": {"read": True, "status": "read", "read_at": now_read}}
        )
        if res.modified_count:
            await push_realtime(user_id, {
                "type": "messages_read",
                "data": {"reader_id": current_user["id"], "read_at": now_read},
            })
    else:
        await db.messages.update_many(
            {"sender_id": user_id, "recipient_id": current_user["id"], "read": False},
            {"$set": {"read": True}}  # pas de status/read_at → aucun « Vu »
        )

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
async def send_message(message_data: MessageCreate, current_user: dict = Depends(get_current_user),
                       _geo: bool = Depends(enforce_write_allowed)):
    """Envoie un message"""
    # Anti-spam : max 30 messages / 60 s par utilisateur
    if not rate_limit(f"msg:{current_user['id']}", max_attempts=30, window_seconds=60):
        raise HTTPException(status_code=429, detail="Trop de messages envoyés. Ralentissez un peu.")

    recipient_raw = await db.users.find_one({"id": message_data.recipient_id})
    if not recipient_raw:
        raise HTTPException(status_code=404, detail="Recipient not found")

    # Protection des mineurs : un compte ADULTE (is_minor=false) ne peut pas
    # écrire à un compte MINEUR sans abonnement MUTUEL déjà existant.
    if recipient_raw.get("is_minor") and not current_user.get("is_minor"):
        _a = await check_is_following(current_user["id"], message_data.recipient_id)
        _b = await check_is_following(message_data.recipient_id, current_user["id"])
        if not (_a and _b):
            raise HTTPException(
                status_code=403,
                detail="Pour protéger les mineurs, un abonnement mutuel est requis pour envoyer un message à ce compte.",
            )

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
        # Décharge le média vers Cloudinary (URL légère au lieu de base64).
        message_data.media_url = await store_media(message_data.media_url, folder="messages")

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

    # Push navigateur (app fermée). On n'ajoute PAS d'entrée au fil de
    # notifications : les messages ont déjà leur propre pastille.
    if await _notif_allowed(message_data.recipient_id, "message", current_user["id"]):
        _mt, _mb, _mu = _push_content_for("message", current_user)
        await send_web_push(message_data.recipient_id, _mt, _mb, _mu, tag="message")

    return Message(**message)


# ==================== MESSAGES PLANIFIÉS (Scheduled DMs) ====================
# On écrit maintenant, on livre à l'heure H (utile la nuit sans réveiller le
# contact). Livraison : cron (endpoint interne) OU repli paresseux à l'ouverture
# de la messagerie par l'expéditeur.

async def _deliver_scheduled(sched: dict):
    """Matérialise un message planifié en vrai message (best-effort, idempotent)."""
    try:
        # Verrou léger : on ne livre que s'il est encore 'pending' (anti-double).
        claim = await db.scheduled_messages.update_one(
            {"id": sched["id"], "status": "pending"}, {"$set": {"status": "sending"}}
        )
        if claim.modified_count == 0:
            return False
        sender = await db.users.find_one({"id": sched["sender_id"]})
        recipient = await db.users.find_one({"id": sched["recipient_id"]})
        if not sender or not recipient:
            await db.scheduled_messages.update_one({"id": sched["id"]}, {"$set": {"status": "failed"}})
            return False
        now = datetime.now(timezone.utc)
        content_plain = decrypt_message(sched.get("content") or "")
        message_id = str(uuid.uuid4())
        ttl = await _ephemeral_ttl(sender["id"], recipient["id"])
        expires_at = (now + timedelta(seconds=ttl)).isoformat() if ttl > 0 else None
        doc = {
            "id": message_id,
            "sender_id": sender["id"], "sender_username": sender["username"], "sender_profile_pic": sender.get("profile_pic"),
            "recipient_id": recipient["id"], "recipient_username": recipient["username"],
            "content": sched.get("content") or "",   # déjà chiffré
            "media_url": sched.get("media_url"), "media_type": sched.get("media_type"),
            "reply_to_id": None, "expires_at": expires_at, "read": False,
            "created_at": now.isoformat(),
        }
        await db.messages.insert_one(doc)
        await db.scheduled_messages.update_one(
            {"id": sched["id"]}, {"$set": {"status": "sent", "sent_at": now.isoformat(), "message_id": message_id}}
        )
        await push_realtime(recipient["id"], {"type": "new_message", "data": {
            "id": message_id, "sender_id": sender["id"], "sender_username": sender["username"],
            "sender_profile_pic": sender.get("profile_pic"), "recipient_id": recipient["id"],
            "content": content_plain, "media_url": sched.get("media_url"), "media_type": sched.get("media_type"),
            "reply_to_id": None, "expires_at": expires_at, "created_at": doc["created_at"],
        }})
        if await _notif_allowed(recipient["id"], "message", sender["id"]):
            _mt, _mb, _mu = _push_content_for("message", sender)
            await send_web_push(recipient["id"], _mt, _mb, _mu, tag="message")
        return True
    except Exception as e:
        logger.warning(f"scheduled deliver failed ({sched.get('id')}): {e}")
        return False


async def _dispatch_due_scheduled(sender_id: str = None):
    """Livre tous les messages planifiés dont l'heure est passée."""
    now = datetime.now(timezone.utc).isoformat()
    q = {"status": "pending", "scheduled_at": {"$lte": now}}
    if sender_id:
        q["sender_id"] = sender_id
    due = await db.scheduled_messages.find(q).sort("scheduled_at", 1).to_list(length=200)
    n = 0
    for s in due:
        if await _deliver_scheduled(convert_mongo_doc_to_dict(s)):
            n += 1
    return n


def _sched_public(s: dict) -> dict:
    return {
        "id": s.get("id"),
        "recipient_id": s.get("recipient_id"),
        "content": decrypt_message(s.get("content") or ""),
        "media_type": s.get("media_type"),
        "scheduled_at": s.get("scheduled_at"),
        "created_at": s.get("created_at"),
    }


@api_router.post("/messages/scheduled")
async def create_scheduled_message(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Planifie un message privé pour plus tard. Corps : {recipient_id, content,
    media_url?, media_type?, scheduled_at (ISO)}."""
    recipient_id = str(data.get("recipient_id") or "").strip()
    content = (data.get("content") or "").strip()
    media_url = data.get("media_url")
    scheduled_at = str(data.get("scheduled_at") or "").strip()
    if not recipient_id or (not content and not media_url):
        raise HTTPException(status_code=400, detail="Destinataire et contenu requis")
    try:
        when = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Date de planification invalide")
    now = datetime.now(timezone.utc)
    if when <= now + timedelta(seconds=30):
        raise HTTPException(status_code=400, detail="Choisissez une heure dans le futur")
    if when > now + timedelta(days=30):
        raise HTTPException(status_code=400, detail="30 jours maximum")

    recipient_raw = await db.users.find_one({"id": recipient_id})
    if not recipient_raw:
        raise HTTPException(status_code=404, detail="Recipient not found")
    # Même garde mineurs que l'envoi direct.
    if recipient_raw.get("is_minor") and not current_user.get("is_minor"):
        _a = await check_is_following(current_user["id"], recipient_id)
        _b = await check_is_following(recipient_id, current_user["id"])
        if not (_a and _b):
            raise HTTPException(status_code=403, detail="Abonnement mutuel requis pour écrire à ce compte.")

    content, media_url = normalize_message_content(content, media_url)
    if media_url:
        await screen_content(media_url=media_url)
        media_url = await store_media(media_url, folder="messages")
    sched_id = str(uuid.uuid4())
    await db.scheduled_messages.insert_one({
        "id": sched_id, "sender_id": current_user["id"], "recipient_id": recipient_id,
        "content": encrypt_message(content or ""), "media_url": media_url,
        "media_type": data.get("media_type"), "scheduled_at": when.isoformat(),
        "status": "pending", "created_at": now.isoformat(),
    })
    return {"success": True, "id": sched_id, "scheduled_at": when.isoformat()}


@api_router.get("/messages/scheduled")
async def list_scheduled_messages(peer_id: str = "", current_user: dict = Depends(get_current_user)):
    """Messages planifiés EN ATTENTE de l'utilisateur (optionnellement filtrés par
    destinataire), du plus proche au plus lointain."""
    await _dispatch_due_scheduled(current_user["id"])  # livre les échus au passage
    q = {"sender_id": current_user["id"], "status": "pending"}
    if peer_id:
        q["recipient_id"] = peer_id
    rows = await db.scheduled_messages.find(q).sort("scheduled_at", 1).to_list(length=100)
    return [_sched_public(convert_mongo_doc_to_dict(r)) for r in rows]


@api_router.put("/messages/scheduled/{sched_id}")
async def update_scheduled_message(sched_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Modifie l'heure d'un message planifié."""
    s = await db.scheduled_messages.find_one({"id": sched_id, "sender_id": current_user["id"], "status": "pending"})
    if not s:
        raise HTTPException(status_code=404, detail="Message planifié introuvable")
    scheduled_at = str(data.get("scheduled_at") or "").strip()
    try:
        when = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Date invalide")
    now = datetime.now(timezone.utc)
    if when <= now + timedelta(seconds=30) or when > now + timedelta(days=30):
        raise HTTPException(status_code=400, detail="Heure hors limites")
    await db.scheduled_messages.update_one({"id": sched_id}, {"$set": {"scheduled_at": when.isoformat()}})
    return {"success": True, "scheduled_at": when.isoformat()}


@api_router.post("/messages/scheduled/{sched_id}/send-now")
async def send_scheduled_now(sched_id: str, current_user: dict = Depends(get_current_user)):
    """Envoie immédiatement un message planifié."""
    s = await db.scheduled_messages.find_one({"id": sched_id, "sender_id": current_user["id"], "status": "pending"})
    if not s:
        raise HTTPException(status_code=404, detail="Message planifié introuvable")
    ok = await _deliver_scheduled(convert_mongo_doc_to_dict(s))
    if not ok:
        raise HTTPException(status_code=409, detail="Envoi impossible")
    return {"success": True}


@api_router.delete("/messages/scheduled/{sched_id}")
async def delete_scheduled_message(sched_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime un message planifié en attente."""
    res = await db.scheduled_messages.delete_one({"id": sched_id, "sender_id": current_user["id"], "status": "pending"})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Message planifié introuvable")
    return {"success": True}


@api_router.post("/internal/dispatch-scheduled")
async def internal_dispatch_scheduled(request: Request):
    """Livraison des messages planifiés échus (déclencheur externe / Cloud
    Scheduler). Protégé par la même clé que le poll sportif."""
    if not SPORTS_POLL_KEY:
        raise HTTPException(status_code=503, detail="Dispatch non configuré")
    key = request.headers.get("x-poll-key") or request.query_params.get("key") or ""
    if key != SPORTS_POLL_KEY:
        raise HTTPException(status_code=403, detail="Clé invalide")
    n = await _dispatch_due_scheduled()
    return {"success": True, "delivered": n}


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
    # Confirmation de lecture désactivée par le lecteur → on ne révèle pas « Vu » :
    # on marque lu pour son compteur, sans exposer le statut « read » à l'expéditeur.
    hide_read = (status == "read") and (current_user.get("read_receipts") is False)
    if hide_read:
        await db.messages.update_one({"id": message_id}, {"$set": {"read": True, "updated_at": now}})
        return {"success": True, "status": "delivered"}

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
    reveal = current_user.get("read_receipts") is not False  # confirmation de lecture

    result = await db.messages.update_many(
        {
            "sender_id": user_id,
            "recipient_id": current_user["id"],
            "read": False
        },
        {"$set": ({"status": "read", "read": True, "read_at": now, "updated_at": now}
                  if reveal else {"read": True, "updated_at": now})}
    )

    # Ouvrir/lire une conversation annule le « marqué comme non lu » manuel.
    await db.conversation_prefs.update_one(
        {"user_id": current_user["id"], "target_id": user_id},
        {"$set": {"marked_unread": False}},
    )

    # Prévient l'expéditeur (« Vu ») UNIQUEMENT si le lecteur autorise les
    # confirmations de lecture.
    if result.modified_count and reveal:
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
            "avatar_url": await store_media(group_data.get("avatar_url"), folder="avatars"),
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
        # Décharge les médias vers Cloudinary (URLs légères au lieu de base64).
        media_urls = await store_media_list(media_urls, folder="groups")

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

        # Prévient les autres membres : temps réel (app ouverte) + push (app
        # fermée). Pas d'entrée dans le fil (pastille messages dédiée).
        _gt, _gb, _gu = _push_content_for("group_message", current_user, post_id=group_id)
        for _mid in group.get("member_ids", []):
            if _mid == current_user["id"]:
                continue
            await push_realtime(_mid, {"type": "new_message", "data": {
                "group_id": group_id,
                "sender_id": current_user["id"],
                "sender_username": current_user["username"],
                "content": text,
            }})
            if await _notif_allowed(_mid, "group_message", current_user["id"]):
                await send_web_push(_mid, _gt, _gb, _gu, tag="group_message")

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
            update_data["avatar_url"] = await store_media(group_data["avatar_url"], folder="avatars")

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
    # Appel entrant (offre) → Web Push : l'utilisateur est alerté même app
    # fermée (il peut rouvrir l'app et rappeler). Les calls ne sont pas dans
    # NOTIF_TYPES (toujours actifs), mais on respecte le mute d'un compte.
    if signal.get("kind") == "offer" and await _notif_allowed(to_user_id, "call", current_user["id"]):
        is_video = bool(signal.get("video"))
        body = f"📞 Appel {'vidéo ' if is_video else ''}entrant de @{current_user.get('username', '')}"
        await send_web_push(to_user_id, "Nexus Social", body, f"/messages/{current_user['id']}", tag="call")
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
        raw = await db.posts.find(query).sort(sort_field, -1).allow_disk_use(True).skip(sk).limit(lm).to_list(length=lm)
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
    audience: str = Form("everyone"),        # everyone | close_friends | custom
    recipient_ids: str = Form(""),           # ids séparés par des virgules (custom)
    text: str = Form(""),                    # texte incrusté / légende
    music_url: str = Form(""),               # extrait audio (preview iTunes)
    music_title: str = Form(""),
    music_artist: str = Form(""),
    music_start: str = Form("0"),            # passage de départ (secondes)
    mirror: str = Form(""),                  # vidéo caméra frontale à remettre à l'endroit
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

    # Décharge le média vers Cloudinary (URL légère au lieu de base64).
    media_url = await store_media(media_url, folder="stories")

    # Visibilité de la story.
    audience = audience if audience in ("everyone", "close_friends", "custom") else "everyone"
    custom_ids = []
    if audience == "custom":
        custom_ids = list(dict.fromkeys(
            [i.strip() for i in (recipient_ids or "").split(",") if i.strip() and i.strip() != current_user["id"]]
        ))

    story_to_insert = {
        "id": story_id,
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_profile_pic": current_user.get("profile_pic"),
        "author_is_verified": current_user.get("is_verified", False),
        "media_type": media_type,
        "media_url": media_url,
        "text": (text or "").strip()[:500] or None,
        "audience": audience,
        "recipient_ids": custom_ids,
        "music_url": (music_url or "").strip()[:500] or None,
        "music_title": (music_title or "").strip()[:200] or None,
        "music_artist": (music_artist or "").strip()[:200] or None,
        "music_start": (lambda s: (float(s) if s.replace(".", "", 1).isdigit() else 0.0))((music_start or "0").strip()),
        "mirror": (mirror in ("1", "true", "True")),
        "views_count": 0,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        # Champ Date (BSON) dédié à l'index TTL Mongo : les stories expirées sont
        # purgées automatiquement (l'index TTL ne marche PAS sur `expires_at` qui
        # est une chaîne ISO). Les requêtes du fil continuent d'utiliser
        # `expires_at` (string) — ce champ ne sert QU'À la suppression auto.
        "expire_dt": expires_at,
    }

    await db.stories.insert_one(story_to_insert)

    if _stverdict and _stverdict["action"] == "flag":
        await flag_for_review("story", story_id, current_user["id"], "", _stverdict, media_kind=media_type)

    # Diffusion temps réel : la nouvelle story apparaît immédiatement dans la
    # barre des abonnés (sans attendre leur prochain rafraîchissement).
    asyncio.create_task(_broadcast_to_followers(
        current_user["id"],
        {"type": "new_story", "data": {"story_id": story_id, "author_id": current_user["id"]}},
    ))

    story = convert_mongo_doc_to_dict(story_to_insert)
    story.pop("expire_dt", None)  # champ interne (TTL) — non exposé dans la réponse
    story["has_viewed"] = False
    return Story(**story)

@api_router.get("/stories/feed", response_model=List[StoryGroup])
async def get_stories_feed(request: Request, current_user: dict = Depends(get_current_user)):
    """Récupère les stories du feed (utilisateurs suivis + propres stories).

    Le base64 des médias n'est PAS chargé (agrégation → sentinel/proxy) : le fil
    chargeait jusqu'à 1000 stories, dont des vidéos base64 → OOM garanti."""
    now = datetime.now(timezone.utc).isoformat()
    media_base = _media_public_base(request)
    
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
    
    # Récupère toutes les stories non expirées des utilisateurs suivis — sans
    # charger le base64 des médias (agrégation → sentinel/proxy).
    stories_raw = await db.stories.aggregate([
        {"$match": {"author_id": {"$in": followed_user_ids}, "expires_at": {"$gt": now}}},
        {"$sort": {"created_at": -1}},
        {"$limit": 1000},
        _drop_base64_media_stage(),
    ], allowDiskUse=True).to_list(length=1000)

    # BATCH (anti N+1) : un seul find pour toutes les stories VUES par le
    # spectateur, au lieu d'une requête par story (jusqu'à 1000 stories → 1000
    # requêtes). On calcule has_viewed via cet ensemble.
    all_story_ids = [s.get("id") for s in stories_raw if s.get("id")]
    viewed_ids = {v.get("story_id") for v in await db.story_views.find(
        {"story_id": {"$in": all_story_ids}, "user_id": current_user["id"]}, {"story_id": 1}
    ).to_list(length=len(all_story_ids) or 1)} if all_story_ids else set()

    # Groupe les stories par auteur
    stories_by_user = {}
    close_friends_cache = {}
    for story_raw in stories_raw:
        story = convert_mongo_doc_to_dict(story_raw)
        _resolve_media_sentinel(story, media_base, "story")
        author_id = story["author_id"]

        # Visibilité : masque les stories non destinées à ce spectateur.
        aud = story.get("audience", "everyone")
        if author_id != current_user["id"] and aud != "everyone":
            if aud == "custom":
                if current_user["id"] not in (story.get("recipient_ids") or []):
                    continue
            elif aud == "close_friends":
                cf = close_friends_cache.get(author_id)
                if cf is None:
                    author_doc = await db.users.find_one({"id": author_id}, {"close_friends": 1})
                    cf = set((author_doc or {}).get("close_friends") or [])
                    close_friends_cache[author_id] = cf
                if current_user["id"] not in cf:
                    continue

        story["has_viewed"] = story["id"] in viewed_ids
        story["is_mine"] = (author_id == current_user["id"])

        if author_id not in stories_by_user:
            stories_by_user[author_id] = {
                "user_id": author_id,
                "username": story["author_username"],
                "profile_pic": story.get("author_profile_pic"),
                "stories": [],
                "last_story_time": story["created_at"]
            }
        
        stories_by_user[author_id]["stories"].append(Story(**story))

    # Ordre de LECTURE intra-groupe : CHRONOLOGIQUE (plus ancienne → plus récente),
    # comme Instagram. (L'agrégation trie DESC pour calculer last_story_time ; on
    # remet chaque groupe dans l'ordre croissant pour la lecture.)
    for g in stories_by_user.values():
        g["stories"].sort(key=lambda s: s.created_at)

    story_groups = [StoryGroup(**group_data) for group_data in stories_by_user.values()]

    # Ordre des RONDS (barre du haut), façon Instagram — JAMAIS aléatoire :
    #   1) sa propre story d'abord ;
    #   2) priorité aux comptes NON VUS ;
    #   3) puis aux comptes avec qui on interagit le plus (affinité) ;
    #   4) enfin les plus récents.
    me = current_user["id"]
    aff = await _user_affinity(me)
    fav = aff.get("creators", set()) if isinstance(aff, dict) else set()

    def _grp_key(g):
        has_unseen = any(not s.has_viewed for s in g.stories)
        return (g.user_id == me, has_unseen, g.user_id in fav, g.last_story_time)

    story_groups.sort(key=_grp_key, reverse=True)

    return story_groups

@api_router.get("/stories/user/{user_id}", response_model=List[Story])
async def get_user_stories(user_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Récupère les stories d'un utilisateur spécifique (médias servis par proxy,
    base64 non chargé → anti-OOM)."""
    now = datetime.now(timezone.utc).isoformat()
    media_base = _media_public_base(request)

    user_raw = await db.users.find_one({"id": user_id})
    if not user_raw:
        raise HTTPException(status_code=404, detail="User not found")

    # Confidentialité : les stories d'un compte privé sont réservées à ses
    # abonnés approuvés (et à lui-même).
    if user_id != current_user["id"] and user_raw.get("is_private", False):
        if not await check_is_following(current_user["id"], user_id):
            raise HTTPException(status_code=403, detail="Ce compte est privé. Vous devez être abonné pour voir ses stories.")

    stories_raw = await db.stories.aggregate([
        {"$match": {"author_id": user_id, "expires_at": {"$gt": now}}},
        {"$sort": {"created_at": 1}},
        {"$limit": 100},
        _drop_base64_media_stage(),
    ], allowDiskUse=True).to_list(length=100)

    stories = []
    for story_raw in stories_raw:
        story = convert_mongo_doc_to_dict(story_raw)
        _resolve_media_sentinel(story, media_base, "story")

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

async def _broadcast_to_followers(author_id: str, payload: dict, include_self: bool = True):
    """Diffuse un événement temps réel aux abonnés d'un auteur (best-effort, non
    bloquant). Sert à faire apparaître/disparaître les stories immédiatement pour
    tout le monde. push_realtime ne touche que les utilisateurs connectés.

    Gère les DEUX schémas de follow (`followed_id` récent et `following_id`
    ancien) pour ne manquer aucun abonné."""
    try:
        rows = await db.follows.find(
            {"$or": [{"followed_id": author_id}, {"following_id": author_id}]},
            {"follower_id": 1},
        ).to_list(length=5000)
        targets = {r.get("follower_id") for r in rows if r.get("follower_id")}
        if include_self:
            targets.add(author_id)
        for uid in targets:
            await push_realtime(uid, payload)
    except Exception:
        pass


@api_router.delete("/stories/{story_id}")
async def delete_story(story_id: str, current_user: dict = Depends(get_current_user)):
    """Supprime une story. La suppression est diffusée en temps réel aux abonnés :
    la story disparaît immédiatement pour tout le monde."""
    uid = current_user.get("id")

    # On retrouve la story par son champ `id` (UUID) ET, en repli, par son `_id`
    # Mongo — indispensable pour les anciennes stories sans champ `id` (sinon le
    # DELETE renvoyait 404 et la story n'était jamais réellement supprimée).
    story_raw = await db.stories.find_one({"id": story_id})
    found_by = "id"
    if not story_raw and ObjectId.is_valid(story_id):
        story_raw = await db.stories.find_one({"_id": ObjectId(story_id)})
        found_by = "_id" if story_raw else "aucune"
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story not found")

    story = convert_mongo_doc_to_dict(story_raw)
    if story.get("author_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Suppression FIABLE par _id (le document trouvé), qu'il ait ou non un champ `id`.
    res = await db.stories.delete_one({"_id": story_raw["_id"]})
    await db.story_views.delete_many({"story_id": story.get("id", story_id)})

    # Diffusion temps réel : les abonnés (et l'auteur sur ses autres appareils)
    # retirent la story sans attendre le prochain rafraîchissement.
    asyncio.create_task(_broadcast_to_followers(
        uid,
        {"type": "story_deleted", "data": {"story_id": story.get("id", story_id), "author_id": uid}},
    ))

    return {
        "message": "Story deleted successfully",
        "deleted_count": res.deleted_count,
        "found_by": found_by,
        "story_id": story.get("id", story_id),
    }

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
                "viewed_at": view["viewed_at"],
                "reaction": view.get("reaction"),
            })

    # Les plus récents d'abord.
    viewers.sort(key=lambda v: v.get("viewed_at", ""), reverse=True)
    return viewers


class StoryReact(BaseModel):
    emoji: str


@api_router.post("/stories/{story_id}/react")
async def react_story(story_id: str, data: StoryReact, current_user: dict = Depends(get_current_user)):
    """Réagit à une story avec un emoji (notifie l'auteur)."""
    emoji = (data.emoji or "").strip()[:8]
    if not emoji:
        raise HTTPException(status_code=400, detail="Emoji requis.")
    story_raw = await db.stories.find_one({"id": story_id})
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story introuvable.")
    story = convert_mongo_doc_to_dict(story_raw)
    now = datetime.now(timezone.utc).isoformat()
    # Upsert la vue avec la réaction (réagir implique avoir vu).
    await db.story_views.update_one(
        {"story_id": story_id, "user_id": current_user["id"]},
        {"$set": {"reaction": emoji, "reacted_at": now},
         "$setOnInsert": {"id": str(uuid.uuid4()), "story_id": story_id,
                          "user_id": current_user["id"], "viewed_at": now}},
        upsert=True,
    )
    author_id = story["author_id"]
    if author_id != current_user["id"]:
        await create_notification(author_id, "story_reaction", current_user)
        await push_realtime(author_id, {"type": "story_reaction", "data": {
            "story_id": story_id, "by": current_user["id"],
            "by_username": current_user["username"], "emoji": emoji,
        }})
    return {"success": True, "emoji": emoji}


class StoryReply(BaseModel):
    content: str


@api_router.post("/stories/{story_id}/reply")
async def reply_to_story_dm(story_id: str, data: StoryReply, current_user: dict = Depends(get_current_user)):
    """Répond à une story : la réponse arrive en MESSAGE PRIVÉ à l'auteur."""
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message vide.")
    story_raw = await db.stories.find_one({"id": story_id})
    if not story_raw:
        raise HTTPException(status_code=404, detail="Story introuvable.")
    story = convert_mongo_doc_to_dict(story_raw)
    if story["author_id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="C'est votre propre story.")
    author = convert_mongo_doc_to_dict(await db.users.find_one({"id": story["author_id"]}) or {})
    now = datetime.now(timezone.utc)
    mid = str(uuid.uuid4())
    msg = {
        "id": mid,
        "sender_id": current_user["id"],
        "sender_username": current_user["username"],
        "sender_profile_pic": current_user.get("profile_pic"),
        "recipient_id": story["author_id"],
        "recipient_username": author.get("username", ""),
        "content": encrypt_message(content),
        "media_url": None,
        "media_type": None,
        "reply_to_id": None,
        "story_id": story_id,
        "expires_at": None,
        "read": False,
        "created_at": now.isoformat(),
    }
    await db.messages.insert_one(msg)
    await push_realtime(story["author_id"], {"type": "new_message", "data": {
        "id": mid, "sender_id": current_user["id"], "sender_username": current_user["username"],
        "sender_profile_pic": current_user.get("profile_pic"), "recipient_id": story["author_id"],
        "content": content, "story_id": story_id, "created_at": now.isoformat(),
    }})
    return {"success": True}


_MUSIC_CACHE: Dict[str, list] = {}


@api_router.get("/stories/music/search")
async def stories_music_search(q: str = Query(...), current_user: dict = Depends(get_current_user)):
    """Recherche de musique via l'API publique iTunes Search → extraits 30 s
    gratuits (previewUrl). Proxifié par le backend (l'API iTunes n'envoie pas
    d'en-têtes CORS, donc l'appel direct navigateur échouerait)."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    if q in _MUSIC_CACHE:
        return _MUSIC_CACHE[q]

    import asyncio
    import urllib.request
    import urllib.parse

    def _fetch():
        params = urllib.parse.urlencode({"term": q, "media": "music", "entity": "song", "limit": 25})
        url = f"https://itunes.apple.com/search?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "NexusBot/1.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read(600000).decode("utf-8", "ignore"))

    try:
        data = await asyncio.get_event_loop().run_in_executor(None, _fetch)
    except Exception:
        raise HTTPException(status_code=503, detail="Recherche musique indisponible.")

    out = []
    for t in (data.get("results") or []):
        preview = t.get("previewUrl")
        if not preview:
            continue
        art = (t.get("artworkUrl100") or "").replace("100x100bb", "200x200bb")
        out.append({
            "id": t.get("trackId"),
            "title": t.get("trackName"),
            "artist": t.get("artistName"),
            "artwork": art,
            "preview_url": preview,
        })
    _MUSIC_CACHE[q] = out
    if len(_MUSIC_CACHE) > 500:
        _MUSIC_CACHE.clear()
    return out


# ==================== INSTANTANÉS (photos éphémères façon Instagram) ====================
# Un « instantané » est une photo prise EN DIRECT (pas d'import galerie, pas de
# retouche), envoyée à une audience choisie : ami·e·s proches / mutuels /
# sélection manuelle. Il n'est visible qu'UNE SEULE FOIS par destinataire, puis
# disparaît (ou au bout de 24 h). L'auteur garde une archive privée 1 an max.
# On réutilise les mêmes briques que les stories/messages (base64, follows,
# notifications, push temps réel, chiffrement des DM).

INSTANT_TTL_HOURS = 24
INSTANT_ARCHIVE_DAYS = 365
MAX_INSTANT_CAPTION = 200


async def _mutual_follow_ids(user_id: str) -> set:
    """Ids des utilisateurs en relation MUTUELLE (se suivent réciproquement).

    Compatible ancien format (following_id) et nouveau (followed_id).
    """
    following = set()
    async for f in db.follows.find({"follower_id": user_id, "status": "following"}):
        fid = f.get("followed_id") or f.get("following_id")
        if fid:
            following.add(fid)
    followers = set()
    async for f in db.follows.find(
        {"$or": [{"followed_id": user_id}, {"following_id": user_id}], "status": "following"}
    ):
        fid = f.get("follower_id")
        if fid:
            followers.add(fid)
    return following & followers


def _instant_is_active(doc: dict, now_iso: str) -> bool:
    return (not doc.get("canceled")) and doc.get("expires_at", "") > now_iso


class InstantCreate(BaseModel):
    media: str                              # data URL image (photo prise en direct)
    caption: Optional[str] = ""
    audience: str = "mutuals"               # close_friends | mutuals | manual
    recipient_ids: List[str] = []           # requis pour audience=manual


class InstantReact(BaseModel):
    emoji: str


class InstantReply(BaseModel):
    content: str


class CloseFriends(BaseModel):
    ids: List[str]


@api_router.get("/instants/inbox")
async def instants_inbox(current_user: dict = Depends(get_current_user)):
    """Instantanés reçus, non encore vus et non expirés (aperçu SANS la photo :
    le média n'est révélé qu'à l'ouverture, une seule fois)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    seen = await db.instant_views.find(
        {"user_id": current_user["id"]}, {"instant_id": 1}
    ).to_list(5000)
    seen_ids = {convert_mongo_doc_to_dict(v)["instant_id"] for v in seen}
    raw = await db.instants.find({
        "recipient_ids": current_user["id"],
        "canceled": {"$ne": True},
        "expires_at": {"$gt": now_iso},
    }).sort("created_at", -1).to_list(500)
    out = []
    for r in raw:
        d = convert_mongo_doc_to_dict(r)
        if d["id"] in seen_ids:
            continue
        out.append({
            "id": d["id"],
            "author_id": d["author_id"],
            "author_username": d["author_username"],
            "author_avatar": d.get("author_avatar"),
            "created_at": d["created_at"],
        })
    return out


@api_router.get("/instants/archive")
async def instants_archive(current_user: dict = Depends(get_current_user)):
    """Archive privée de l'auteur (instantanés envoyés, < 1 an)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    raw = await db.instants.find({
        "author_id": current_user["id"],
        "archive_expires_at": {"$gt": now_iso},
    }).sort("created_at", -1).to_list(500)
    out = []
    for r in raw:
        d = convert_mongo_doc_to_dict(r)
        views = await db.instant_views.find({"instant_id": d["id"]}).to_list(3000)
        vd = [convert_mongo_doc_to_dict(v) for v in views]
        out.append({
            "id": d["id"],
            "media_url": d["media_url"],
            "caption": d.get("caption", ""),
            "audience": d.get("audience"),
            "created_at": d["created_at"],
            "expires_at": d["expires_at"],
            "canceled": bool(d.get("canceled")),
            "recipients": len(d.get("recipient_ids") or []),
            "seen": len(vd),
            "reactions": [
                {"user_id": v["user_id"], "emoji": v.get("reaction")}
                for v in vd if v.get("reaction")
            ],
            "active": _instant_is_active(d, now_iso),
        })
    return out


@api_router.get("/instants/close-friends")
async def get_close_friends(current_user: dict = Depends(get_current_user)):
    """Liste « Ami·e·s proches » de l'utilisateur."""
    me = await db.users.find_one({"id": current_user["id"]}, {"close_friends": 1})
    ids = ((me or {}).get("close_friends")) or []
    if not ids:
        return []
    users = await db.users.find(
        {"id": {"$in": ids}}, {"id": 1, "username": 1, "profile_pic": 1}
    ).to_list(2000)
    return [
        {"id": u["id"], "username": u["username"], "profile_pic": u.get("profile_pic")}
        for u in [convert_mongo_doc_to_dict(x) for x in users]
    ]


@api_router.put("/instants/close-friends")
async def set_close_friends(data: CloseFriends, current_user: dict = Depends(get_current_user)):
    """Met à jour la liste « Ami·e·s proches »."""
    ids = list(dict.fromkeys(
        [i for i in (data.ids or []) if i and i != current_user["id"]]
    ))[:500]
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"close_friends": ids}})
    return {"success": True, "count": len(ids)}


@api_router.post("/instants")
async def create_instant(data: InstantCreate, current_user: dict = Depends(get_current_user)):
    """Envoie un instantané (photo prise en direct) à l'audience choisie."""
    if not rate_limit(f"instant:{current_user['id']}", max_attempts=20, window_seconds=300):
        raise HTTPException(status_code=429, detail="Trop d'instantanés envoyés. Réessayez plus tard.")

    media = (data.media or "").strip()
    is_image = media.startswith("data:image")
    is_video = media.startswith("data:video")
    if not (is_image or is_video):
        raise HTTPException(status_code=400, detail="Média invalide (photo ou vidéo prise en direct).")
    if len(media) > 12_000_000:
        raise HTTPException(status_code=413, detail="Média trop lourd.")

    # Modération NSFW : uniquement l'image (le service ne traite pas la vidéo).
    if is_image:
        await screen_content(media_url=media)

    # Décharge le média vers Cloudinary (URL légère au lieu de base64).
    media = await store_media(media, folder="instants")

    audience = data.audience if data.audience in ("close_friends", "mutuals", "manual") else "mutuals"
    if audience == "manual":
        recipients = [r for r in (data.recipient_ids or []) if r and r != current_user["id"]]
    elif audience == "mutuals":
        recipients = list(await _mutual_follow_ids(current_user["id"]))
    else:  # close_friends
        me = await db.users.find_one({"id": current_user["id"]}, {"close_friends": 1})
        recipients = [r for r in ((me or {}).get("close_friends") or []) if r != current_user["id"]]

    recipients = list(dict.fromkeys(recipients))
    # Ne garde que des utilisateurs existants. L'audience peut être VIDE : on
    # autorise la publication même sans destinataire (l'instantané existe et
    # reste dans l'archive de l'auteur).
    if recipients:
        valid_raw = await db.users.find({"id": {"$in": recipients}}, {"id": 1}).to_list(3000)
        valid_ids = {convert_mongo_doc_to_dict(u)["id"] for u in valid_raw}
        recipients = [r for r in recipients if r in valid_ids]

    now = datetime.now(timezone.utc)
    caption = (data.caption or "").strip()[:MAX_INSTANT_CAPTION]
    doc = {
        "id": str(uuid.uuid4()),
        "author_id": current_user["id"],
        "author_username": current_user["username"],
        "author_avatar": current_user.get("profile_pic"),
        "media_url": media,
        "caption": caption,
        "audience": audience,
        "recipient_ids": recipients,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=INSTANT_TTL_HOURS)).isoformat(),
        "archive_expires_at": (now + timedelta(days=INSTANT_ARCHIVE_DAYS)).isoformat(),
        "canceled": False,
    }
    await db.instants.insert_one(dict(doc))

    for rid in recipients:
        await create_notification(rid, "instant", current_user)
        await push_realtime(rid, {"type": "instant", "data": {
            "id": doc["id"],
            "author_id": current_user["id"],
            "author_username": current_user["username"],
            "author_avatar": current_user.get("profile_pic"),
        }})

    return {
        "success": True,
        "instant": {
            "id": doc["id"],
            "caption": caption,
            "audience": audience,
            "created_at": doc["created_at"],
            "expires_at": doc["expires_at"],
        },
        "recipients": len(recipients),
    }


@api_router.post("/instants/{instant_id}/view")
async def view_instant(instant_id: str, current_user: dict = Depends(get_current_user)):
    """Consomme un instantané : révèle la photo UNE seule fois pour ce destinataire."""
    now = datetime.now(timezone.utc)
    raw = await db.instants.find_one({"id": instant_id})
    if not raw:
        raise HTTPException(status_code=404, detail="Instantané introuvable.")
    d = convert_mongo_doc_to_dict(raw)
    if current_user["id"] not in (d.get("recipient_ids") or []):
        raise HTTPException(status_code=403, detail="Non autorisé.")
    if d.get("canceled") or d.get("expires_at", "") <= now.isoformat():
        raise HTTPException(status_code=410, detail="Cet instantané a disparu.")
    existing = await db.instant_views.find_one(
        {"instant_id": instant_id, "user_id": current_user["id"]}
    )
    if existing:
        raise HTTPException(status_code=410, detail="Déjà vu — un instantané n'est visible qu'une fois.")
    await db.instant_views.insert_one({
        "id": str(uuid.uuid4()),
        "instant_id": instant_id,
        "user_id": current_user["id"],
        "viewed_at": now.isoformat(),
        "reaction": None,
    })
    await push_realtime(d["author_id"], {"type": "instant_seen", "data": {
        "instant_id": instant_id, "by": current_user["id"], "by_username": current_user["username"],
    }})
    return {
        "id": d["id"],
        "media_url": d["media_url"],
        "caption": d.get("caption", ""),
        "author_id": d["author_id"],
        "author_username": d["author_username"],
        "author_avatar": d.get("author_avatar"),
        "created_at": d["created_at"],
    }


@api_router.post("/instants/{instant_id}/react")
async def react_instant(instant_id: str, data: InstantReact, current_user: dict = Depends(get_current_user)):
    """Réagit à un instantané avec un emoji (notifie l'auteur)."""
    emoji = (data.emoji or "").strip()[:8]
    if not emoji:
        raise HTTPException(status_code=400, detail="Emoji requis.")
    view = await db.instant_views.find_one(
        {"instant_id": instant_id, "user_id": current_user["id"]}
    )
    if not view:
        raise HTTPException(status_code=403, detail="Vous devez d'abord voir l'instantané.")
    await db.instant_views.update_one(
        {"instant_id": instant_id, "user_id": current_user["id"]},
        {"$set": {"reaction": emoji, "reacted_at": datetime.now(timezone.utc).isoformat()}},
    )
    raw = await db.instants.find_one({"id": instant_id}, {"author_id": 1})
    if raw:
        author_id = convert_mongo_doc_to_dict(raw)["author_id"]
        await push_realtime(author_id, {"type": "instant_reaction", "data": {
            "instant_id": instant_id, "by": current_user["id"],
            "by_username": current_user["username"], "emoji": emoji,
        }})
        await create_notification(author_id, "instant_reaction", current_user)
    return {"success": True, "emoji": emoji}


@api_router.post("/instants/{instant_id}/reply")
async def reply_instant(instant_id: str, data: InstantReply, current_user: dict = Depends(get_current_user)):
    """Répond à un instantané : la réponse arrive en MESSAGE PRIVÉ à l'auteur."""
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message vide.")
    raw = await db.instants.find_one({"id": instant_id})
    if not raw:
        raise HTTPException(status_code=404, detail="Instantané introuvable.")
    d = convert_mongo_doc_to_dict(raw)
    if current_user["id"] not in (d.get("recipient_ids") or []):
        raise HTTPException(status_code=403, detail="Non autorisé.")
    author = convert_mongo_doc_to_dict(await db.users.find_one({"id": d["author_id"]}) or {})
    now = datetime.now(timezone.utc)
    mid = str(uuid.uuid4())
    msg = {
        "id": mid,
        "sender_id": current_user["id"],
        "sender_username": current_user["username"],
        "sender_profile_pic": current_user.get("profile_pic"),
        "recipient_id": d["author_id"],
        "recipient_username": author.get("username", ""),
        "content": encrypt_message(content),
        "media_url": None,
        "media_type": None,
        "reply_to_id": None,
        "instant_id": instant_id,
        "expires_at": None,
        "read": False,
        "created_at": now.isoformat(),
    }
    await db.messages.insert_one(msg)
    await push_realtime(d["author_id"], {"type": "new_message", "data": {
        "id": mid,
        "sender_id": current_user["id"],
        "sender_username": current_user["username"],
        "sender_profile_pic": current_user.get("profile_pic"),
        "recipient_id": d["author_id"],
        "content": content,
        "instant_id": instant_id,
        "created_at": now.isoformat(),
    }})
    return {"success": True}


@api_router.delete("/instants/{instant_id}")
async def cancel_instant(instant_id: str, current_user: dict = Depends(get_current_user)):
    """« Annuler » : l'auteur retire son instantané (juste après l'envoi ou plus tard)."""
    raw = await db.instants.find_one({"id": instant_id})
    if not raw:
        raise HTTPException(status_code=404, detail="Instantané introuvable.")
    d = convert_mongo_doc_to_dict(raw)
    if d["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Non autorisé.")
    await db.instants.update_one({"id": instant_id}, {"$set": {"canceled": True}})
    for rid in (d.get("recipient_ids") or []):
        await push_realtime(rid, {"type": "instant_canceled", "data": {"instant_id": instant_id}})
    return {"success": True}


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
    """Politique de confidentialité (RGPD)."""
    return Response(content="""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Politique de Confidentialité - Nexus Social</title>
    <style>
        :root { --accent: #22d3ee; }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            max-width: 820px; margin: 0 auto; padding: 32px 22px 80px;
            line-height: 1.7; color: #dae2fd; background: #0b1326; font-size: 16px;
        }
        header { border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 8px; }
        h1 { font-size: 28px; margin: 0 0 6px; color: #ffffff; letter-spacing: -0.02em; }
        .meta { color: #859397; font-size: 14px; margin: 0; }
        .intro { color: #bbc9cd; }
        h2 { font-size: 19px; color: #ffffff; margin: 34px 0 10px; padding-top: 8px; }
        h2 .num { display: inline-block; min-width: 30px; color: var(--accent); font-weight: 800; }
        h3 { font-size: 16px; color: var(--accent); margin: 18px 0 6px; }
        p, li { color: #cdd6ea; }
        ul { padding-left: 22px; }
        li { margin: 5px 0; }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        strong { color: #eef2ff; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14.5px; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); vertical-align: top; }
        th { color: #eef2ff; }
        .callout { background: rgba(34,211,238,0.06); border: 1px solid rgba(34,211,238,0.2); border-radius: 12px; padding: 12px 16px; margin: 14px 0; }
        footer { margin-top: 44px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.1); color: #859397; font-size: 14px; }
    </style>
</head>
<body>
    <header>
        <h1>Politique de Confidentialité</h1>
        <p class="meta">Nexus Social &middot; Dernière mise à jour : 9 août 2026</p>
    </header>

    <p class="intro">La présente Politique de confidentialité explique comment Nexus Social collecte, utilise, partage et protège vos données personnelles, dans le respect du Règlement Général sur la Protection des Données (RGPD) et de la loi française &laquo;&nbsp;Informatique et Libertés&nbsp;&raquo;.</p>

    <h2><span class="num">1.</span> Introduction</h2>
    <p>Nexus Social est un réseau social permettant de publier des contenus et d'interagir avec une communauté. La protection de votre vie privée est une priorité : nous nous engageons à traiter vos données de manière loyale, transparente et sécurisée, à ne collecter que ce qui est nécessaire, et à vous donner le contrôle sur vos informations. En utilisant le Service, vous êtes informé des traitements décrits ci-dessous.</p>

    <h2><span class="num">2.</span> Responsable du traitement</h2>
    <p>Le responsable du traitement des données est&nbsp;:</p>
    <ul>
        <li><strong>Nexus Social</strong></li>
        <li>Adresse&nbsp;: [adresse postale de l'éditeur], France</li>
        <li>Email&nbsp;: <a href="mailto:privacy@nexussocial.com">privacy@nexussocial.com</a></li>
        <li>Délégué à la protection des données (DPO)&nbsp;: <a href="mailto:dpo@nexussocial.com">dpo@nexussocial.com</a></li>
    </ul>

    <h2><span class="num">3.</span> Quelles données nous collectons</h2>
    <ul>
        <li><strong>Données d'inscription&nbsp;:</strong> nom d'utilisateur, adresse email, date de naissance, mot de passe (chiffré), et le cas échéant photo de profil et biographie.</li>
        <li><strong>Données de contenu&nbsp;:</strong> les contenus que vous créez ou partagez (publications, stories, clips, commentaires, messages privés, notes).</li>
        <li><strong>Données techniques&nbsp;:</strong> adresse IP, type et identifiants de l'appareil, système d'exploitation, navigateur, données de connexion et journaux (logs).</li>
        <li><strong>Données d'utilisation&nbsp;:</strong> interactions (mentions J'aime, vues, temps de visionnage, abonnements, recherches) permettant de faire fonctionner et d'améliorer le Service.</li>
        <li><strong>Données de paiement&nbsp;:</strong> en cas d'abonnement ou de monétisation, des informations de facturation traitées par nos prestataires de paiement (nous ne stockons pas les numéros de carte complets).</li>
        <li><strong>Données de vérification d'identité&nbsp;:</strong> lorsque cela est applicable (par exemple pour la monétisation), des éléments justificatifs, traités de manière sécurisée, chiffrés et supprimés après vérification.</li>
    </ul>

    <h2><span class="num">4.</span> Comment nous collectons les données</h2>
    <ul>
        <li><strong>Directement&nbsp;:</strong> lorsque vous créez un compte, publiez du contenu ou nous contactez.</li>
        <li><strong>Automatiquement&nbsp;:</strong> lors de votre utilisation du Service (données techniques et d'usage).</li>
        <li><strong>Via des cookies</strong> et technologies similaires (voir section 6).</li>
        <li><strong>Via des tiers&nbsp;:</strong> nos prestataires (hébergement, paiement, envoi d'emails/SMS) qui agissent pour notre compte.</li>
    </ul>

    <h2><span class="num">5.</span> Pourquoi nous utilisons vos données (bases légales)</h2>
    <table>
        <tr><th>Finalité</th><th>Base légale (RGPD)</th></tr>
        <tr><td>Créer et gérer votre compte, fournir le Service</td><td>Exécution du contrat (art. 6.1.b)</td></tr>
        <tr><td>Personnalisation, cookies non essentiels, communications marketing</td><td>Consentement (art. 6.1.a)</td></tr>
        <tr><td>Sécurité, prévention de la fraude, amélioration et mesure d'audience</td><td>Intérêt légitime (art. 6.1.f)</td></tr>
        <tr><td>Contrôle de l'âge, réponses aux réquisitions, conservation légale</td><td>Obligation légale (art. 6.1.c)</td></tr>
    </table>

    <h2><span class="num">6.</span> Cookies et technologies similaires</h2>
    <p>Nous utilisons des cookies et technologies équivalentes pour faire fonctionner le Service, mémoriser vos préférences, sécuriser votre session et mesurer l'audience&nbsp;:</p>
    <ul>
        <li><strong>Cookies strictement nécessaires&nbsp;:</strong> indispensables au fonctionnement (authentification, sécurité). Exemptés de consentement.</li>
        <li><strong>Cookies de préférences&nbsp;:</strong> mémorisent vos réglages.</li>
        <li><strong>Cookies de mesure d'audience et analytiques&nbsp;:</strong> soumis à votre consentement.</li>
    </ul>
    <p>Vous pouvez accepter, refuser ou retirer votre consentement à tout moment via le bandeau de gestion des cookies ou les réglages de votre navigateur. Pour plus de détails, consultez notre <a href="/api/legal/cookie-policy">Politique relative aux cookies</a>.</p>

    <h2><span class="num">7.</span> Avec qui nous partageons vos données</h2>
    <ul>
        <li><strong>Prestataires (sous-traitants)&nbsp;:</strong> hébergement, stockage des médias, paiement, envoi d'emails/SMS, mesure d'audience. Ils n'agissent que sur nos instructions et sont tenus à la confidentialité.</li>
        <li><strong>Autorités&nbsp;:</strong> en cas d'obligation légale ou de réquisition judiciaire valable.</li>
        <li><strong>Autres utilisateurs&nbsp;:</strong> les contenus que vous rendez publics sont visibles selon les paramètres de visibilité que vous choisissez.</li>
    </ul>
    <div class="callout"><strong>Nous ne vendons pas vos données personnelles</strong> à des tiers.</div>

    <h2><span class="num">8.</span> Transferts hors de l'Union européenne</h2>
    <p>Vos données sont hébergées au sein de l'Union européenne dans la mesure du possible. Si certains prestataires impliquent un transfert hors de l'UE, celui-ci est encadré par des garanties appropriées conformément au RGPD (notamment les Clauses Contractuelles Types de la Commission européenne ou une décision d'adéquation), afin d'assurer un niveau de protection équivalent.</p>

    <h2><span class="num">9.</span> Durée de conservation des données</h2>
    <p>Nous conservons vos données uniquement le temps nécessaire aux finalités décrites&nbsp;:</p>
    <ul>
        <li><strong>Données de compte&nbsp;:</strong> pendant la durée de vie du compte, puis supprimées ou anonymisées après sa suppression.</li>
        <li><strong>Contenus&nbsp;:</strong> jusqu'à leur suppression par vos soins ou celle de votre compte.</li>
        <li><strong>Données de vérification d'identité&nbsp;:</strong> supprimées après la vérification.</li>
        <li><strong>Journaux techniques et données légales&nbsp;:</strong> conservés pour les durées imposées par la loi.</li>
    </ul>

    <h2><span class="num">10.</span> Sécurité des données</h2>
    <p>Nous mettons en oeuvre des mesures techniques et organisationnelles appropriées pour protéger vos données&nbsp;: chiffrement des données sensibles et des mots de passe, connexions sécurisées (HTTPS), contrôle des accès, journalisation, et minimisation des données. Aucun système n'étant infaillible, nous vous invitons à protéger vos identifiants et à nous signaler tout incident.</p>

    <h2><span class="num">11.</span> Vos droits RGPD</h2>
    <p>Conformément au RGPD, vous disposez des droits suivants&nbsp;:</p>
    <ul>
        <li><strong>Droit d'accès</strong> (art. 15)&nbsp;: obtenir une copie des données vous concernant.</li>
        <li><strong>Droit de rectification</strong> (art. 16)&nbsp;: corriger des données inexactes.</li>
        <li><strong>Droit à l'effacement</strong> (art. 17)&nbsp;: demander la suppression de vos données.</li>
        <li><strong>Droit à la portabilité</strong> (art. 20)&nbsp;: récupérer vos données dans un format réutilisable.</li>
        <li><strong>Droit d'opposition</strong> (art. 21)&nbsp;: vous opposer à certains traitements.</li>
        <li><strong>Droit à la limitation</strong> (art. 18)&nbsp;: restreindre temporairement un traitement.</li>
        <li><strong>Retrait du consentement</strong>&nbsp;: à tout moment, sans effet rétroactif, lorsque le traitement repose sur le consentement.</li>
        <li><strong>Droit de réclamation&nbsp;:</strong> vous pouvez introduire une réclamation auprès de la CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noopener">www.cnil.fr</a>).</li>
    </ul>
    <p>Pour exercer vos droits, utilisez le Centre de confidentialité de l'application ou écrivez à <a href="mailto:dpo@nexussocial.com">dpo@nexussocial.com</a>. Nous répondons dans un délai d'un mois.</p>

    <h2><span class="num">12.</span> Comptes de mineurs</h2>
    <p>Le Service est interdit aux mineurs de moins de <strong>15 ans</strong>, conformément à la législation française relative au consentement numérique des mineurs. Nous vérifions l'âge à l'inscription et pouvons suspendre tout compte ne respectant pas cette condition. Si vous pensez qu'un mineur de moins de 15 ans utilise le Service, contactez-nous afin que nous prenions les mesures nécessaires.</p>

    <h2><span class="num">13.</span> Modifications de la politique</h2>
    <p>Nous pouvons mettre à jour la présente Politique afin de refléter des évolutions du Service ou de la réglementation. En cas de modification substantielle, nous vous en informerons par un moyen approprié (par exemple une notification dans l'application). La date de dernière mise à jour figure en tête de ce document.</p>

    <h2><span class="num">14.</span> Contact</h2>
    <p>Pour toute question relative à vos données personnelles ou à la présente Politique&nbsp;:</p>
    <ul>
        <li>Service confidentialité&nbsp;: <a href="mailto:privacy@nexussocial.com">privacy@nexussocial.com</a></li>
        <li>Délégué à la protection des données (DPO)&nbsp;: <a href="mailto:dpo@nexussocial.com">dpo@nexussocial.com</a></li>
    </ul>

    <footer>
        &copy; 2026 Nexus Social. Tous droits réservés. Vos données, votre contrôle.
    </footer>
</body>
</html>
    """, media_type="text/html")

@app.get("/api/legal/terms-of-service")
async def get_terms_of_service():
    """Conditions Générales d'Utilisation (CGU)."""
    return Response(content="""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Conditions d'Utilisation - Nexus Social</title>
    <style>
        :root { --accent: #22d3ee; --accent2: #3b82f6; }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            max-width: 820px;
            margin: 0 auto;
            padding: 32px 22px 80px;
            line-height: 1.7;
            color: #dae2fd;
            background: #0b1326;
            font-size: 16px;
        }
        header { border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 8px; }
        h1 { font-size: 28px; margin: 0 0 6px; color: #ffffff; letter-spacing: -0.02em; }
        .meta { color: #859397; font-size: 14px; margin: 0; }
        .intro { color: #bbc9cd; }
        h2 {
            font-size: 19px; color: #ffffff; margin: 34px 0 10px; padding-top: 8px;
        }
        h2 .num {
            display: inline-block; min-width: 30px; color: var(--accent); font-weight: 800;
        }
        h3 { font-size: 16px; color: var(--accent); margin: 18px 0 6px; }
        p, li { color: #cdd6ea; }
        ul { padding-left: 22px; }
        li { margin: 5px 0; }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        strong { color: #eef2ff; }
        .callout {
            background: rgba(34,211,238,0.06); border: 1px solid rgba(34,211,238,0.2);
            border-radius: 12px; padding: 12px 16px; margin: 14px 0;
        }
        footer { margin-top: 44px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.1); color: #859397; font-size: 14px; }
    </style>
</head>
<body>
    <header>
        <h1>Conditions Générales d'Utilisation</h1>
        <p class="meta">Nexus Social &middot; Dernière mise à jour : 9 août 2026</p>
    </header>

    <p class="intro">Les présentes Conditions Générales d'Utilisation (les &laquo;&nbsp;Conditions&nbsp;&raquo;) régissent l'accès et l'utilisation de la plateforme Nexus Social, incluant le site web, l'application et l'ensemble des services associés (le &laquo;&nbsp;Service&nbsp;&raquo;). Veuillez les lire attentivement.</p>

    <h2><span class="num">1.</span> Acceptation des conditions</h2>
    <p>En créant un compte, en accédant au Service ou en l'utilisant, vous reconnaissez avoir lu, compris et accepté sans réserve les présentes Conditions, ainsi que notre <a href="/api/legal/privacy-policy">Politique de confidentialité</a> et notre <a href="/api/legal/cookie-policy">Politique relative aux cookies</a>. Si vous n'acceptez pas ces Conditions, vous ne devez pas utiliser le Service. Si vous utilisez le Service pour le compte d'une organisation, vous garantissez être habilité à l'engager.</p>

    <h2><span class="num">2.</span> Description du service</h2>
    <p>Nexus Social est un réseau social permettant à ses utilisateurs de créer un profil, de publier des contenus (textes, photos, vidéos, stories, clips), d'interagir avec d'autres utilisateurs (mentions J'aime, commentaires, partages, messages privés) et de découvrir des contenus. Le Service est fourni &laquo;&nbsp;en l'état&nbsp;&raquo; et peut évoluer, être modifié, suspendu ou interrompu, en tout ou partie, à tout moment. Certaines fonctionnalités peuvent être payantes ou réservées à des comptes vérifiés ou aux abonnés.</p>

    <h2><span class="num">3.</span> Conditions d'inscription</h2>
    <ul>
        <li><strong>Âge minimum :</strong> vous devez être âgé d'au moins <strong>15 ans</strong> pour créer un compte, conformément à la législation française relative au consentement numérique des mineurs. Les mineurs de moins de 15 ans ne sont pas autorisés à s'inscrire.</li>
        <li><strong>Véracité des informations :</strong> vous vous engagez à fournir des informations exactes, à jour et complètes lors de l'inscription, et à les maintenir à jour.</li>
        <li><strong>Un seul titulaire :</strong> un compte est personnel. Vous êtes responsable de l'exactitude de votre date de naissance et des informations déclarées.</li>
        <li>Nexus Social peut refuser une inscription ou fermer un compte ne respectant pas ces conditions.</li>
    </ul>

    <h2><span class="num">4.</span> Compte utilisateur</h2>
    <ul>
        <li><strong>Sécurité :</strong> vous êtes seul responsable de la confidentialité de vos identifiants et de toute activité réalisée depuis votre compte. Choisissez un mot de passe robuste et ne le partagez pas.</li>
        <li><strong>Alerte :</strong> vous devez nous informer immédiatement de toute utilisation non autorisée de votre compte ou de toute faille de sécurité.</li>
        <li><strong>Responsabilité :</strong> vous êtes responsable des contenus que vous publiez et des interactions menées depuis votre compte.</li>
        <li><strong>Suppression :</strong> vous pouvez supprimer votre compte à tout moment depuis les paramètres. La suppression entraîne l'effacement ou l'anonymisation de vos données, sous réserve des obligations légales de conservation.</li>
    </ul>

    <h2><span class="num">5.</span> Contenu interdit</h2>
    <p>Vous vous engagez à ne pas publier, transmettre ou diffuser, directement ou indirectement, des contenus qui relèvent notamment des catégories suivantes :</p>
    <ul>
        <li><strong>Contenus illégaux :</strong> tout contenu contraire aux lois et règlements applicables.</li>
        <li><strong>Harcèlement, menaces, doxxing :</strong> propos harcelants, intimidations, menaces, ou divulgation d'informations personnelles d'autrui sans son consentement.</li>
        <li><strong>Spam, bots et faux comptes :</strong> messages non sollicités, manipulation de l'engagement, automatisation non autorisée, comptes frauduleux ou trompeurs.</li>
        <li><strong>Contenu sexuel non consenti et CSAM :</strong> tout contenu à caractère sexuel impliquant des mineurs (strictement interdit et signalé aux autorités compétentes), ainsi que la diffusion d'images intimes sans consentement.</li>
        <li><strong>Incitation à la haine ou à la violence :</strong> propos ou contenus incitant à la discrimination, à la haine ou à la violence à l'encontre de personnes ou de groupes.</li>
        <li><strong>Usurpation d'identité :</strong> se faire passer pour une autre personne, marque ou organisation de manière trompeuse.</li>
        <li><strong>Violation des droits d'auteur :</strong> tout contenu portant atteinte aux droits de propriété intellectuelle de tiers.</li>
    </ul>
    <div class="callout">Cette liste n'est pas limitative. Nexus Social se réserve le droit de retirer tout contenu et de sanctionner tout compte contrevenant à ces Conditions ou à la loi.</div>

    <h2><span class="num">6.</span> Propriété intellectuelle</h2>
    <p>Vous conservez l'ensemble des droits de propriété intellectuelle sur les contenus que vous créez et publiez sur le Service (&laquo;&nbsp;Contenu Utilisateur&nbsp;&raquo;). Nexus Social ne revendique aucune propriété sur votre Contenu Utilisateur. En revanche, la marque &laquo;&nbsp;Nexus Social&nbsp;&raquo;, son logo, l'interface, le code et les éléments graphiques du Service demeurent la propriété exclusive de Nexus Social et sont protégés. Vous garantissez détenir les droits nécessaires sur les contenus que vous publiez.</p>

    <h2><span class="num">7.</span> Licence accordée à Nexus Social</h2>
    <p>En publiant un Contenu Utilisateur, vous accordez à Nexus Social une licence mondiale, non exclusive, transférable, sous-licenciable et gratuite permettant d'héberger, stocker, reproduire, adapter (par exemple pour le redimensionnement ou la mise en cache), afficher, représenter et distribuer ce contenu, dans le seul but de fournir, exploiter, promouvoir et améliorer le Service. Cette licence prend fin lorsque vous supprimez votre contenu ou votre compte, sous réserve des copies techniques résiduelles et des contenus repartagés par d'autres utilisateurs. Cette licence inclut le droit pour Nexus Social de modérer, filtrer ou retirer les contenus dans les conditions prévues à l'article 8.</p>

    <h2><span class="num">8.</span> Modération et sanctions</h2>
    <p>Afin de garantir un environnement sûr, Nexus Social peut examiner, modérer et retirer tout contenu, et prendre des mesures à l'encontre d'un compte, notamment de manière graduée :</p>
    <ul>
        <li><strong>Avertissement</strong> et/ou retrait du contenu litigieux ;</li>
        <li><strong>Limitation temporaire</strong> de certaines fonctionnalités ;</li>
        <li><strong>Suspension</strong> temporaire du compte ;</li>
        <li><strong>Bannissement</strong> définitif en cas de manquement grave ou répété.</li>
    </ul>
    <p>En cas d'infraction grave (notamment CSAM ou menaces crédibles), Nexus Social pourra agir sans avertissement préalable et transmettre les informations utiles aux autorités compétentes. Vous pouvez signaler un contenu ou contester une décision de modération en contactant notre équipe.</p>

    <h2><span class="num">9.</span> Données personnelles et RGPD</h2>
    <p>Le traitement de vos données personnelles est réalisé conformément au Règlement Général sur la Protection des Données (RGPD) et à la législation applicable. Vous disposez de droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité. Les modalités de collecte, d'utilisation et de conservation de vos données sont détaillées dans notre <a href="/api/legal/privacy-policy">Politique de confidentialité</a>, qui fait partie intégrante des présentes Conditions.</p>

    <h2><span class="num">10.</span> Responsabilité limitée</h2>
    <p>Le Service est fourni &laquo;&nbsp;en l'état&nbsp;&raquo; et &laquo;&nbsp;selon disponibilité&nbsp;&raquo;. Dans les limites autorisées par la loi, Nexus Social ne saurait être tenu responsable des contenus publiés par les utilisateurs, des interruptions, pertes de données, ou dommages indirects résultant de l'utilisation ou de l'impossibilité d'utiliser le Service. Nexus Social ne garantit pas que le Service sera exempt d'erreurs ou disponible sans interruption. Aucune stipulation des présentes ne vise à exclure la responsabilité qui ne peut légalement l'être.</p>

    <h2><span class="num">11.</span> Résiliation</h2>
    <p><strong>Par l'utilisateur :</strong> vous pouvez cesser d'utiliser le Service et supprimer votre compte à tout moment depuis les paramètres.</p>
    <p><strong>Par Nexus Social :</strong> nous pouvons suspendre ou résilier votre accès, avec ou sans préavis, en cas de violation des présentes Conditions, d'exigence légale, ou pour protéger le Service et ses utilisateurs. Les stipulations qui, par nature, doivent survivre à la résiliation (notamment la propriété intellectuelle et la limitation de responsabilité) demeurent applicables.</p>

    <h2><span class="num">12.</span> Modifications des conditions</h2>
    <p>Nexus Social peut modifier les présentes Conditions afin de refléter des évolutions du Service ou de la réglementation. En cas de modification substantielle, nous vous en informerons par un moyen approprié (par exemple une notification dans l'application). La poursuite de l'utilisation du Service après l'entrée en vigueur des modifications vaut acceptation des nouvelles Conditions.</p>

    <h2><span class="num">13.</span> Droit applicable et juridiction</h2>
    <p>Les présentes Conditions sont régies par le droit français et, le cas échéant, par le droit de l'Union européenne. Tout litige relatif à leur validité, leur interprétation ou leur exécution relève de la compétence des tribunaux français, sous réserve des dispositions protectrices applicables aux consommateurs. Une solution amiable sera recherchée préalablement à toute action contentieuse.</p>

    <h2><span class="num">14.</span> Contact</h2>
    <p>Pour toute question relative aux présentes Conditions, un signalement ou l'exercice de vos droits, vous pouvez nous contacter à l'adresse : <a href="mailto:legal@nexussocial.com">legal@nexussocial.com</a>.</p>

    <footer>
        &copy; 2026 Nexus Social. Tous droits réservés. En utilisant Nexus Social, vous reconnaissez avoir pris connaissance des présentes Conditions et les accepter.
    </footer>
</body>
</html>
    """, media_type="text/html")

@app.get("/api/legal/cookie-policy")
async def get_cookie_policy():
    """Politique relative aux cookies (RGPD / ePrivacy)."""
    return Response(content="""
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Politique relative aux cookies - Nexus Social</title>
    <style>
        :root { --accent: #22d3ee; }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            max-width: 820px; margin: 0 auto; padding: 32px 22px 80px;
            line-height: 1.7; color: #dae2fd; background: #0b1326; font-size: 16px;
        }
        header { border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 20px; margin-bottom: 8px; }
        h1 { font-size: 28px; margin: 0 0 6px; color: #ffffff; letter-spacing: -0.02em; }
        .meta { color: #859397; font-size: 14px; margin: 0; }
        .intro { color: #bbc9cd; }
        h2 { font-size: 19px; color: #ffffff; margin: 34px 0 10px; padding-top: 8px; }
        h2 .num { display: inline-block; min-width: 30px; color: var(--accent); font-weight: 800; }
        p, li, td { color: #cdd6ea; }
        ul { padding-left: 22px; }
        li { margin: 5px 0; }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        strong { color: #eef2ff; }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14.5px; min-width: 520px; }
        th, td { text-align: left; padding: 9px 11px; border-bottom: 1px solid rgba(255,255,255,0.08); vertical-align: top; }
        th { color: #eef2ff; }
        .callout { background: rgba(34,211,238,0.06); border: 1px solid rgba(34,211,238,0.2); border-radius: 12px; padding: 12px 16px; margin: 14px 0; }
        footer { margin-top: 44px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.1); color: #859397; font-size: 14px; }
    </style>
</head>
<body>
    <header>
        <h1>Politique relative aux cookies</h1>
        <p class="meta">Nexus Social &middot; Dernière mise à jour : 9 août 2026</p>
    </header>

    <p class="intro">La présente politique explique ce que sont les cookies, lesquels nous utilisons, pourquoi, et comment vous pouvez les contrôler. Elle complète notre <a href="/api/legal/privacy-policy">Politique de confidentialité</a> et s'inscrit dans le respect du RGPD et de la directive &laquo;&nbsp;ePrivacy&nbsp;&raquo;.</p>

    <div class="callout"><strong>En clair&nbsp;:</strong> aujourd'hui, Nexus Social n'utilise que des cookies <strong>strictement nécessaires</strong> au fonctionnement du service (authentification, sécurité, préférences). Nous n'utilisons <strong>ni cookies publicitaires ni traceurs tiers</strong>. Si cela devait changer (par exemple activation d'outils de mesure d'audience ou de publicité), votre consentement serait recueilli au préalable et cette politique serait mise à jour.</div>

    <h2><span class="num">1.</span> Qu'est-ce qu'un cookie&nbsp;?</h2>
    <p>Un cookie est un petit fichier texte déposé sur votre appareil (ordinateur, téléphone, tablette) lorsque vous visitez un site ou utilisez une application. Il permet de vous reconnaître, de mémoriser des informations (comme votre session de connexion ou vos préférences) et de faire fonctionner le service. Nous utilisons aussi des technologies équivalentes (stockage local du navigateur), regroupées ici sous le terme &laquo;&nbsp;cookies&nbsp;&raquo;.</p>

    <h2><span class="num">2.</span> Qui est responsable&nbsp;?</h2>
    <p>Les cookies déposés par le service sont sous la responsabilité de <strong>Nexus Social</strong>. Pour toute question, vous pouvez nous contacter à <a href="mailto:privacy@nexussocial.com">privacy@nexussocial.com</a> (ou notre DPO&nbsp;: <a href="mailto:dpo@nexussocial.com">dpo@nexussocial.com</a>).</p>

    <h2><span class="num">3.</span> Types de cookies que nous utilisons</h2>
    <ul>
        <li><strong>Cookies essentiels (strictement nécessaires)&nbsp;:</strong> indispensables au fonctionnement et à la sécurité (maintien de votre session de connexion, protection contre la fraude, équilibrage de charge). Ils ne nécessitent pas votre consentement. <strong>Actuellement utilisés.</strong></li>
        <li><strong>Cookies de préférence / fonctionnels&nbsp;:</strong> mémorisent vos réglages (langue, thème, couleur d'accent, consentement aux cookies). <strong>Actuellement utilisés</strong> (via le stockage local).</li>
        <li><strong>Cookies de performance / statistiques&nbsp;:</strong> mesureraient l'audience et l'usage pour améliorer le service. <strong>Non utilisés à ce jour</strong> ; le seront uniquement avec votre consentement.</li>
        <li><strong>Cookies publicitaires / de suivi&nbsp;:</strong> permettraient la personnalisation publicitaire. <strong>Non utilisés à ce jour.</strong> En cas d'activation future (par exemple Google AdSense), ils seraient soumis à votre consentement explicite.</li>
    </ul>

    <h2><span class="num">4.</span> Finalité de chaque type de cookie</h2>
    <div class="table-wrap">
    <table>
        <tr><th>Cookie / stockage</th><th>Type</th><th>Finalité</th><th>Durée</th></tr>
        <tr><td>token (session)</td><td>Essentiel</td><td>Vous maintenir connecté de façon sécurisée</td><td>Jusqu'à expiration / déconnexion</td></tr>
        <tr><td>nexus_user, préférences (thème, accent, langue)</td><td>Fonctionnel</td><td>Mémoriser vos réglages et éviter de tout ressaisir</td><td>Jusqu'à 12 mois</td></tr>
        <tr><td>consentement cookies</td><td>Essentiel</td><td>Enregistrer votre choix d'acceptation/refus</td><td>Jusqu'à 6 mois</td></tr>
        <tr><td>Mesure d'audience (le cas échéant)</td><td>Performance</td><td>Statistiques d'usage anonymisées</td><td>Sous consentement, max. 13 mois</td></tr>
        <tr><td>Publicité (le cas échéant)</td><td>Publicitaire</td><td>Personnalisation publicitaire</td><td>Sous consentement, max. 13 mois</td></tr>
    </table>
    </div>

    <h2><span class="num">5.</span> Durée de conservation des cookies</h2>
    <p>La durée dépend du type de cookie&nbsp;: les cookies de <strong>session</strong> expirent à la fermeture ou à la déconnexion, tandis que les cookies <strong>persistants</strong> (préférences) sont conservés pour une durée limitée, indiquée dans le tableau ci-dessus. Conformément aux recommandations de la CNIL, les cookies soumis à consentement ne dépassent pas <strong>13 mois</strong>, et les informations qu'ils collectent une durée proportionnée.</p>

    <h2><span class="num">6.</span> Cookies tiers</h2>
    <p>Un cookie tiers est déposé par un service externe. À ce jour, nous limitons au strict nécessaire le recours à des tiers&nbsp;:</p>
    <ul>
        <li><strong>Paiement (le cas échéant)&nbsp;:</strong> lors d'un paiement, notre prestataire (par exemple Stripe) peut déposer des cookies nécessaires à la sécurisation de la transaction et à la prévention de la fraude.</li>
        <li><strong>Mesure d'audience / publicité&nbsp;:</strong> aucun service tiers de type Google Analytics ou Google AdSense n'est actif à ce jour. En cas d'activation future, il serait explicitement mentionné ici et soumis à votre consentement.</li>
    </ul>

    <h2><span class="num">7.</span> Comment gérer ou refuser les cookies</h2>
    <ul>
        <li><strong>Via le bandeau de consentement&nbsp;:</strong> lors de votre première visite, vous pouvez accepter ou refuser les cookies non essentiels. Les cookies essentiels ne peuvent pas être désactivés car ils sont indispensables au service.</li>
        <li><strong>Via les paramètres de confidentialité du site&nbsp;:</strong> vous pouvez à tout moment modifier vos choix depuis le Centre de confidentialité de l'application.</li>
        <li><strong>Via votre navigateur&nbsp;:</strong> vous pouvez bloquer ou supprimer les cookies dans les réglages de votre navigateur (Chrome, Safari, Firefox, Edge...). Le blocage des cookies essentiels peut toutefois empêcher le bon fonctionnement du service.</li>
    </ul>

    <h2><span class="num">8.</span> Consentement</h2>
    <p>Pour les cookies non essentiels, votre <strong>consentement</strong> est recueilli via le bandeau dédié, de manière libre, éclairée et spécifique. Tant que vous n'avez pas donné votre accord, aucun cookie de mesure d'audience ou de publicité n'est déposé. Vous pouvez <strong>retirer votre consentement à tout moment</strong>, aussi facilement que vous l'avez donné, depuis le Centre de confidentialité ou en supprimant les cookies via votre navigateur. Le retrait n'affecte pas la licéité des traitements effectués avant celui-ci.</p>

    <h2><span class="num">9.</span> Mise à jour de la politique</h2>
    <p>Cette politique peut évoluer, notamment si nous ajoutons de nouveaux cookies ou services. Toute modification substantielle (par exemple l'activation d'outils de statistiques ou de publicité) sera signalée et, le cas échéant, un nouveau consentement vous sera demandé. La date de dernière mise à jour figure en tête de ce document.</p>

    <h2><span class="num">10.</span> Contact</h2>
    <p>Pour toute question relative aux cookies&nbsp;: <a href="mailto:privacy@nexussocial.com">privacy@nexussocial.com</a> &middot; DPO&nbsp;: <a href="mailto:dpo@nexussocial.com">dpo@nexussocial.com</a>.</p>

    <footer>
        &copy; 2026 Nexus Social. Tous droits réservés. Vous gardez le contrôle de vos cookies.
    </footer>
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

# ==================== SCORES DE FOOT EN DIRECT (ESPN, sans clé) ====================
# API publique JSON d'ESPN (site.api.espn.com) — pas de clé, pas de compte.
# Cache MÉMOIRE paresseux : on ne rafraîchit QUE lorsqu'un client demande et que
# le cache est périmé (60 s si un match est en cours, 1 h sinon). Pas de boucle
# de fond → compatible « scale-to-zero » (coût quasi nul).

ESPN_SOCCER_LEAGUES = [
    ("uefa.champions", "Ligue des Champions"),
    ("uefa.wchampions", "Women's Champions League"),
    ("uefa.europa", "Ligue Europa"),
    ("eng.1", "Premier League"),
    ("esp.1", "LaLiga"),
    ("ita.1", "Serie A"),
    ("ger.1", "Bundesliga"),
    ("fra.1", "Ligue 1"),
    ("fifa.world", "Coupe du Monde"),
    ("uefa.euro", "Euro"),
    ("usa.1", "MLS"),
]

_livescores_cache = {"data": [], "ts": 0.0}
_livescores_lock = asyncio.Lock()

# Fenêtre de récupération ESPN : aujourd'hui + 2 jours (couvre les prochaines
# 48 h). ESPN accepte une plage `dates=YYYYMMDD-YYYYMMDD` sur les scoreboards.
ESPN_UPCOMING_HOURS = 48


def _espn_dates_param(days_back: int = 1, days_ahead: int = 2) -> str:
    # Plage : hier → +2 jours. Inclure HIER permet d'afficher les résultats de la
    # veille en repli quand il n'y a aucun match en direct ni à venir proche.
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days_back)).strftime("%Y%m%d")
    end = (now + timedelta(days=days_ahead)).strftime("%Y%m%d")
    return f"{start}-{end}"


def _espn_keep_event(state, date_str) -> bool:
    """Garde : les matchs EN COURS (in) ; les À VENIR (pre) dans les 48 h ; les
    TERMINÉS (post) de la veille (< 48 h) → le widget affiche TOUJOURS du contenu
    (repli automatique quand aucun match n'est en direct)."""
    if state == "in":
        return True
    try:
        dt = datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
    except Exception:
        return state == "in"
    now = datetime.now(timezone.utc)
    if state == "pre":
        return dt <= now + timedelta(hours=ESPN_UPCOMING_HOURS)
    if state == "post":
        return dt >= now - timedelta(hours=48)
    return False


# En-têtes « navigateur » : l'API ESPN peut renvoyer vide / bloquer les
# User-Agent non navigateur ou certaines IP datacenter. On imite un vrai
# navigateur pour maximiser le taux de succès depuis Cloud Run.
_ESPN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.espn.com/",
    "Origin": "https://www.espn.com",
}


def _espn_fetch_league(slug: str, fallback_name: str):
    """Récupère (synchrone) les matchs d'une compétition ESPN → liste normalisée.
    Inclut les matchs EN COURS + À VENIR (48 h) + terminés récents."""
    out = []
    base_url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard"

    def _fetch(params):
        try:
            r = _requests.get(base_url, params=params, timeout=10, headers=_ESPN_HEADERS)
            if not r.ok:
                logger.warning(f"ESPN {slug}: HTTP {r.status_code}")
                return None
            return r.json()
        except Exception as e:
            logger.warning(f"ESPN {slug}: exception {type(e).__name__}: {e}")
            return None

    # Scoreboard DU JOUR (sans paramètre de dates) : source fiable des matchs du
    # jour — en direct, à venir et terminés. (Les plages de dates renvoyaient
    # parfois vide.)
    data = _fetch(None)
    if not data:
        logger.info(f"ESPN {slug}: 0 match (fetch vide/échoué)")
        return out
    try:
        league_name = (data.get("leagues") or [{}])[0].get("name") or fallback_name
        for ev in data.get("events", []) or []:
            comp = (ev.get("competitions") or [{}])[0]
            status = ev.get("status") or comp.get("status") or {}
            stype = status.get("type") or {}
            comps = comp.get("competitors") or []
            home = next((c for c in comps if c.get("homeAway") == "home"), None)
            away = next((c for c in comps if c.get("homeAway") == "away"), None)
            if not (home and away):
                continue
            state = stype.get("state")               # pre | in | post
            out.append({
                "id": str(ev.get("id") or ""),
                "sport": "foot",
                "league": league_name,
                "league_slug": slug,
                "is_ucl": slug in ("uefa.champions", "uefa.wchampions"),
                "home": (home.get("team") or {}).get("shortDisplayName") or (home.get("team") or {}).get("displayName") or "",
                "away": (away.get("team") or {}).get("shortDisplayName") or (away.get("team") or {}).get("displayName") or "",
                "home_id": str((home.get("team") or {}).get("id") or ""),
                "away_id": str((away.get("team") or {}).get("id") or ""),
                "home_logo": (home.get("team") or {}).get("logo"),
                "away_logo": (away.get("team") or {}).get("logo"),
                "home_score": home.get("score"),
                "away_score": away.get("score"),
                "state": state,                            # pre | in | post
                "clock": status.get("displayClock") or "",  # ex : « 43' »
                "detail": stype.get("shortDetail") or stype.get("description") or "",
                "date": ev.get("date"),
            })
    except Exception:
        pass
    try:
        logger.info(f"ESPN {slug}: events={len((data or {}).get('events', []))} → gardés={len(out)}")
    except Exception:
        pass
    return out


async def get_live_scores():
    """Scores de foot en direct (toutes compétitions suivies), triés : matchs EN
    COURS d'abord, puis à venir, puis terminés."""
    tasks = [asyncio.to_thread(_espn_fetch_league, slug, name) for slug, name in ESPN_SOCCER_LEAGUES]
    matches = []
    for res in await asyncio.gather(*tasks, return_exceptions=True):
        if isinstance(res, list):
            matches.extend(res)
    order = {"in": 0, "pre": 1, "post": 2}
    matches.sort(key=lambda m: (order.get(m.get("state"), 3), m.get("date") or ""))
    return matches


async def get_cached_live_scores():
    """Cache paresseux : rafraîchit si périmé. TTL = 60 s si un match est en
    cours, 1 h sinon. Un seul rafraîchissement concurrent (verrou)."""
    now = time.time()
    data = _livescores_cache["data"]
    has_live = any(m.get("state") == "in" for m in data)
    ttl = 20 if has_live else 3600  # ~temps réel pendant les matchs, économe sinon
    if _livescores_cache["ts"] > 0 and (now - _livescores_cache["ts"]) < ttl:
        return data
    async with _livescores_lock:
        # Un autre appel a pu rafraîchir pendant l'attente du verrou.
        now = time.time()
        if _livescores_cache["ts"] > 0 and (now - _livescores_cache["ts"]) < ttl:
            return _livescores_cache["data"]
        fresh = await get_live_scores()
        if fresh or _livescores_cache["ts"] == 0:
            _livescores_cache["data"] = fresh
            _livescores_cache["ts"] = now
        return _livescores_cache["data"]


# ── MMA / UFC (même API ESPN gratuite, même cache paresseux) ──
_mma_cache = {"data": [], "ts": 0.0}
_mma_lock = asyncio.Lock()

# ── Météo en direct (Open-Meteo, gratuit / sans clé) ──────────────────────────
# Cache mémoire par coordonnées arrondies (~11 km) pour éviter de spammer l'API.
_weather_cache = {}  # "lat,lon" -> {"data": {...}, "ts": float}
_weather_lock = asyncio.Lock()

# Décodage des codes météo WMO → état du ciel (catégorie + libellé FR).
# `cond` sert au frontend pour choisir l'icône SVG ; `label` est affiché.
def _wmo_decode(code, is_day=True):
    c = int(code) if code is not None else -1
    if c == 0:
        return ("clear", "Ensoleillé" if is_day else "Ciel dégagé")
    if c in (1, 2):
        return ("partly", "Peu nuageux")
    if c == 3:
        return ("cloudy", "Nuageux")
    if c in (45, 48):
        return ("fog", "Brouillard")
    if c in (51, 53, 55, 56, 57):
        return ("drizzle", "Bruine")
    if c in (61, 63, 65, 66, 67):
        return ("rain", "Pluie")
    if c in (80, 81, 82):
        return ("rain", "Averses")
    if c in (71, 73, 75, 77, 85, 86):
        return ("snow", "Neige")
    if c in (95, 96, 99):
        return ("storm", "Orage")
    return ("cloudy", "Nuageux")


def _weather_fetch_sync(lat: float, lon: float):
    """Appelle Open-Meteo (conditions actuelles) + un reverse-geocoding gratuit
    et sans clé pour le nom de la localisation. Best-effort, fail-open."""
    out = None
    try:
        r = _requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code",
                "timezone": "auto",
            },
            timeout=8, headers={"User-Agent": "NexusSocial/1.0"},
        )
        if not r.ok:
            return None
        cur = (r.json() or {}).get("current") or {}
        is_day = bool(cur.get("is_day", 1))
        cond, label = _wmo_decode(cur.get("weather_code"), is_day)
        out = {
            "temp": round(float(cur.get("temperature_2m"))) if cur.get("temperature_2m") is not None else None,
            "feels_like": round(float(cur.get("apparent_temperature"))) if cur.get("apparent_temperature") is not None else None,
            "humidity": cur.get("relative_humidity_2m"),
            "is_day": is_day,
            "code": cur.get("weather_code"),
            "cond": cond,
            "label": label,
            "location": None,
        }
    except Exception:
        return None

    # Nom de la localité (facultatif) — reverse-geocoding keyless BigDataCloud.
    try:
        g = _requests.get(
            "https://api.bigdatacloud.net/data/reverse-geocode-client",
            params={"latitude": lat, "longitude": lon, "localityLanguage": "fr"},
            timeout=6, headers={"User-Agent": "NexusSocial/1.0"},
        )
        if g.ok:
            gj = g.json() or {}
            out["location"] = gj.get("city") or gj.get("locality") or gj.get("principalSubdivision") or gj.get("countryName")
    except Exception:
        pass
    return out


async def get_weather_live(lat: float, lon: float):
    """Conditions météo actuelles pour des coordonnées, servies depuis un cache
    mémoire (TTL 10 min) ; arrondi des coordonnées pour regrouper les appels."""
    key = f"{round(float(lat), 1)},{round(float(lon), 1)}"
    now = time.time()
    entry = _weather_cache.get(key)
    if entry and (now - entry["ts"]) < 600:
        return entry["data"]
    async with _weather_lock:
        entry = _weather_cache.get(key)
        if entry and (time.time() - entry["ts"]) < 600:
            return entry["data"]
        fresh = await asyncio.to_thread(_weather_fetch_sync, float(lat), float(lon))
        if fresh:
            _weather_cache[key] = {"data": fresh, "ts": time.time()}
        return fresh


# ── Finance / Crypto en direct (CoinGecko, gratuit / sans clé) ────────────────
# Catalogue des actifs proposés (id CoinGecko → ticker + nom). Sert à la fois de
# liste de choix en mode Édition et de garde-fou (on n'interroge que ces ids).
FINANCE_ASSETS = {
    "bitcoin": {"symbol": "BTC", "name": "Bitcoin"},
    "ethereum": {"symbol": "ETH", "name": "Ethereum"},
    "solana": {"symbol": "SOL", "name": "Solana"},
    "binancecoin": {"symbol": "BNB", "name": "BNB"},
    "ripple": {"symbol": "XRP", "name": "XRP"},
    "cardano": {"symbol": "ADA", "name": "Cardano"},
    "dogecoin": {"symbol": "DOGE", "name": "Dogecoin"},
    "polkadot": {"symbol": "DOT", "name": "Polkadot"},
    "chainlink": {"symbol": "LINK", "name": "Chainlink"},
    "avalanche-2": {"symbol": "AVAX", "name": "Avalanche"},
    "litecoin": {"symbol": "LTC", "name": "Litecoin"},
    "matic-network": {"symbol": "MATIC", "name": "Polygon"},
}
DEFAULT_FINANCE_ASSETS = ["bitcoin", "ethereum", "solana"]
_finance_cache = {}  # "id,id,..." -> {"data": [...], "ts": float}
_finance_lock = asyncio.Lock()


def _finance_fetch_sync(ids):
    """Prix (EUR) + variation 24 h des actifs via l'API publique CoinGecko."""
    try:
        r = _requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={
                "ids": ",".join(ids),
                "vs_currencies": "eur",
                "include_24hr_change": "true",
            },
            timeout=8, headers={"User-Agent": "NexusSocial/1.0"},
        )
        if not r.ok:
            return None
        data = r.json() or {}
    except Exception:
        return None
    out = []
    for cid in ids:  # conserve l'ordre demandé
        row = data.get(cid)
        if not isinstance(row, dict):
            continue
        meta = FINANCE_ASSETS.get(cid, {})
        price = row.get("eur")
        change = row.get("eur_24h_change")
        out.append({
            "id": cid,
            "symbol": meta.get("symbol") or cid[:4].upper(),
            "name": meta.get("name") or cid,
            "price": round(float(price), 2) if price is not None else None,
            "change_24h": round(float(change), 2) if change is not None else None,
        })
    return out


async def get_finance_live(ids=None):
    """Cours des actifs demandés (Bitcoin, Ethereum, Solana par défaut), servis
    depuis un cache mémoire (TTL 60 s). Ne garde que des ids connus/valides."""
    ids = [i for i in (ids or DEFAULT_FINANCE_ASSETS) if i in FINANCE_ASSETS]
    if not ids:
        ids = list(DEFAULT_FINANCE_ASSETS)
    key = ",".join(ids)
    now = time.time()
    entry = _finance_cache.get(key)
    if entry and (now - entry["ts"]) < 60:
        return entry["data"]
    async with _finance_lock:
        entry = _finance_cache.get(key)
        if entry and (time.time() - entry["ts"]) < 60:
            return entry["data"]
        fresh = await asyncio.to_thread(_finance_fetch_sync, ids)
        if fresh is not None:
            _finance_cache[key] = {"data": fresh, "ts": time.time()}
            return fresh
        return (entry or {}).get("data", [])


def _espn_fetch_mma_sync():
    out = []
    mma_url = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"

    def _fetch(params):
        try:
            r = _requests.get(mma_url, params=params, timeout=10, headers=_ESPN_HEADERS)
            if not r.ok:
                logger.warning(f"ESPN mma/ufc: HTTP {r.status_code}")
                return None
            return r.json()
        except Exception as e:
            logger.warning(f"ESPN mma/ufc: exception {type(e).__name__}: {e}")
            return None

    # Scoreboard UFC du jour (source fiable, sans plage de dates).
    data = _fetch(None)
    if not data:
        logger.info("ESPN mma/ufc: 0 combat (fetch vide/échoué)")
        return out

    def fighter(c):
        a = c.get("athlete") or {}
        hs = a.get("headshot")
        avatar = hs.get("href") if isinstance(hs, dict) else (hs if isinstance(hs, str) else None)
        return {"name": a.get("displayName") or a.get("shortName") or "?", "avatar": avatar, "winner": bool(c.get("winner"))}

    for ev in (data.get("events") or []):
        event_name = ev.get("shortName") or ev.get("name") or "UFC"
        for comp in (ev.get("competitions") or []):
            cs = comp.get("status") or {}
            ctype = cs.get("type") or {}
            comps = comp.get("competitors") or []
            if len(comps) < 2:
                continue
            mstate = ctype.get("state")                      # pre | in | post
            f1, f2 = fighter(comps[0]), fighter(comps[1])
            result = cs.get("result") or {}
            method = result.get("shortDisplayName") or result.get("description") or ctype.get("detail") or ""
            winner = f1["name"] if f1["winner"] else (f2["name"] if f2["winner"] else None)
            out.append({
                "id": str(comp.get("id") or ev.get("id") or ""),
                "sport": "mma",
                "event": event_name,
                "f1": f1, "f2": f2,
                "state": mstate,                             # pre | in | post
                "round": cs.get("period"),                    # round en cours
                "clock": cs.get("displayClock") or "",
                "method": method,                             # KO/TKO, Décision…
                "winner": winner,
                "detail": ctype.get("shortDetail") or ctype.get("detail") or "",
                "date": comp.get("date") or ev.get("date"),
            })
    logger.info(f"ESPN mma/ufc: events={len((data or {}).get('events', []))} → gardés={len(out)}")
    return out


async def get_cached_mma():
    now = time.time()
    data = _mma_cache["data"]
    has_live = any(m.get("state") == "in" for m in data)
    ttl = 20 if has_live else 3600  # ~temps réel pendant les matchs, économe sinon
    if _mma_cache["ts"] > 0 and (now - _mma_cache["ts"]) < ttl:
        return data
    async with _mma_lock:
        now = time.time()
        if _mma_cache["ts"] > 0 and (now - _mma_cache["ts"]) < ttl:
            return _mma_cache["data"]
        fresh = await asyncio.to_thread(_espn_fetch_mma_sync)
        if fresh or _mma_cache["ts"] == 0:
            _mma_cache["data"] = fresh
            _mma_cache["ts"] = now
        return _mma_cache["data"]


@api_router.get("/livescores")
async def livescores(current_user: dict = Depends(get_current_user)):
    """Scores de foot en direct (ESPN), servis depuis le cache mémoire GLOBAL puis
    triés PAR UTILISATEUR : ses ligues/équipes favorites d'abord, puis le reste
    (matchs en cours prioritaires dans chaque groupe)."""
    show_foot = current_user.get("show_sports") is not False
    show_mma = current_user.get("show_mma") is not False
    order = {"in": 0, "pre": 1, "post": 2}
    fav_leagues = set(current_user.get("favorite_leagues") or [])
    fav_teams = set(current_user.get("favorite_teams") or [])

    foot, mma = [], []
    if show_foot:
        try:
            foot = await get_cached_live_scores()
        except Exception as e:
            logger.warning(f"/livescores (foot) a échoué: {e}")
            foot = _livescores_cache.get("data", [])

        def is_fav(m):
            return (m.get("league_slug") in fav_leagues) or (m.get("home_id") in fav_teams) or (m.get("away_id") in fav_teams)
        foot = sorted(foot, key=lambda m: (0 if is_fav(m) else 1, order.get(m.get("state"), 3), m.get("date") or ""))
    if show_mma:
        try:
            mma = await get_cached_mma()
        except Exception as e:
            logger.warning(f"/livescores (mma) a échoué: {e}")
            mma = _mma_cache.get("data", [])
        mma = sorted(mma, key=lambda m: (order.get(m.get("state"), 3), m.get("date") or ""))

    # Fusion : si les deux sports sont actifs, on ALTERNE foot / MMA ; sinon on
    # renvoie simplement la liste du sport actif.
    if foot and mma:
        items = []
        i = j = 0
        while i < len(foot) or j < len(mma):
            if i < len(foot):
                items.append(foot[i]); i += 1
            if j < len(mma):
                items.append(mma[j]); j += 1
    else:
        items = foot or mma

    return {
        "matches": items[:50],
        "updated_at": max(_livescores_cache.get("ts", 0), _mma_cache.get("ts", 0)),
        "favorites": {"leagues": sorted(fav_leagues), "teams": sorted(fav_teams)},
    }


# ── Match Center : chronologie détaillée d'un match (ESPN summary, sans clé) ──
_match_cache = {}  # "slug:event" -> {"data": ..., "ts": ...}


def _espn_map_event_type(text: str, ev: dict) -> str:
    t = (text or "").lower()
    if ev.get("ownGoal"):
        return "own_goal"
    if "goal" in t:
        return "penalty_goal" if ev.get("penaltyKick") else "goal"
    if "yellow" in t:
        return "yellow"
    if "red" in t:
        return "red"
    if "substitution" in t or "sub " in t or t == "sub":
        return "sub"
    if "var" in t:
        return "var"
    if "penalty" in t:
        return "penalty"
    if "injur" in t:
        return "injury"
    return "other"


def _espn_fetch_match_sync(event_id: str, slug: str):
    try:
        r = _requests.get(
            f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/summary?event={event_id}",
            timeout=9, headers={"User-Agent": "NexusSocial/1.0"},
        )
        if not r.ok:
            return None
        data = r.json()
    except Exception:
        return None
    # team.id -> "home"/"away"
    side_map = {}
    header = {}
    try:
        comp = ((data.get("header") or {}).get("competitions") or [{}])[0]
        comps = comp.get("competitors") or []
        for c in comps:
            tid = str((c.get("team") or {}).get("id") or c.get("id") or "")
            if tid:
                side_map[tid] = c.get("homeAway")
        h = next((x for x in comps if x.get("homeAway") == "home"), {})
        a = next((x for x in comps if x.get("homeAway") == "away"), {})
        st = comp.get("status") or {}
        stype = st.get("type") or {}

        def _logo(team):
            logos = (team or {}).get("logos") or []
            return (logos[0].get("href") if logos else None) or (team or {}).get("logo")
        header = {
            "home": (h.get("team") or {}).get("displayName") or (h.get("team") or {}).get("shortDisplayName"),
            "away": (a.get("team") or {}).get("displayName") or (a.get("team") or {}).get("shortDisplayName"),
            "home_logo": _logo(h.get("team")), "away_logo": _logo(a.get("team")),
            "home_score": h.get("score"), "away_score": a.get("score"),
            "state": stype.get("state"), "clock": st.get("displayClock") or "",
            "detail": stype.get("shortDetail") or stype.get("description") or "",
        }
    except Exception:
        pass
    events = []
    for ev in (data.get("keyEvents") or []):
        typ = ev.get("type") or {}
        text = typ.get("text") or typ.get("name") or ""
        team_id = str((ev.get("team") or {}).get("id") or "")
        players = [(a.get("displayName") or a.get("shortName") or "").strip()
                   for a in (ev.get("athletesInvolved") or []) if a]
        events.append({
            "minute": (ev.get("clock") or {}).get("displayValue") or "",
            "type": _espn_map_event_type(text, ev),
            "side": side_map.get(team_id),
            "text": text,
            "players": [p for p in players if p],
            "penalty": bool(ev.get("penaltyKick")),
            "own_goal": bool(ev.get("ownGoal")),
        })
    return {"header": header, "events": events}


async def get_match_details(event_id: str, slug: str):
    key = f"{slug}:{event_id}"
    now = time.time()
    hit = _match_cache.get(key)
    if hit and (now - hit["ts"]) < 30:
        return hit["data"]
    data = await asyncio.to_thread(_espn_fetch_match_sync, event_id, slug)
    if data is not None:
        _match_cache[key] = {"data": data, "ts": now}
        if len(_match_cache) > 500:
            _match_cache.clear()
        return data
    return (hit or {}).get("data") or {"header": {}, "events": []}


@api_router.get("/livescores/match")
async def livescores_match(event: str, league: str, current_user: dict = Depends(get_current_user)):
    """Détails d'un match (chronologie des événements) via l'API ESPN summary."""
    slug = (league or "").strip().lower()
    eid = (event or "").strip()
    # Validation stricte (ces valeurs entrent dans l'URL ESPN → anti-injection).
    if not re.fullmatch(r"[a-z0-9.\-]{2,30}", slug) or not re.fullmatch(r"[0-9]{3,20}", eid):
        raise HTTPException(status_code=400, detail="Paramètres invalides")
    try:
        return await get_match_details(eid, slug)
    except Exception as e:
        logger.warning(f"/livescores/match a échoué: {e}")
        return {"header": {}, "events": []}


@api_router.get("/users/me/sports-favorites")
async def get_sports_favorites(current_user: dict = Depends(get_current_user)):
    """Ligues et équipes favorites (scores de foot) de l'utilisateur."""
    return {
        "leagues": current_user.get("favorite_leagues") or [],
        "teams": current_user.get("favorite_teams") or [],
    }


@api_router.put("/users/me/sports-favorites")
async def set_sports_favorites(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Remplace les listes de favoris (utilisé par la modale de filtres)."""
    def clean(v):
        return [str(x)[:40] for x in v if isinstance(x, (str, int))][:100] if isinstance(v, list) else []
    leagues = clean(data.get("leagues"))
    teams = clean(data.get("teams"))
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"favorite_leagues": leagues, "favorite_teams": teams}})
    return {"leagues": leagues, "teams": teams}


@api_router.post("/users/me/sports-favorites/toggle")
async def toggle_sports_favorite(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Bascule un favori (clic sur l'étoile). kind ∈ {league, team}."""
    kind = (data.get("kind") or "").strip()
    fav_id = str(data.get("id") or "").strip()[:40]
    if kind not in ("league", "team") or not fav_id:
        raise HTTPException(status_code=400, detail="kind (league|team) et id requis")
    field = "favorite_leagues" if kind == "league" else "favorite_teams"
    current = list(current_user.get(field) or [])
    if fav_id in current:
        current.remove(fav_id)
        active = False
    else:
        current = (current + [fav_id])[:100]
        active = True
    await db.users.update_one({"id": current_user["id"]}, {"$set": {field: current}})
    return {"kind": kind, "id": fav_id, "active": active, field: current}


# ── Alertes sportives push (buts foot / résultats MMA) ──────────────────────
# Détection par DIFF d'état persistée en base (survit au scale-to-zero) : un
# déclencheur externe (Cloud Scheduler / UptimeRobot) appelle /internal/sports-poll
# ~toutes les minutes. On compare le scoreboard courant à l'état précédent, on
# envoie les push aux abonnés concernés, puis on mémorise le nouvel état.
SPORTS_POLL_KEY = os.environ.get("SPORTS_POLL_KEY", "").strip()


def _sport_alerts_of(user: dict) -> dict:
    a = user.get("sport_alerts") or {}
    return {"goals": a.get("goals", True), "match": a.get("match", False), "mma": a.get("mma", True)}


@api_router.get("/weather")
async def weather(lat: float, lon: float, current_user: dict = Depends(get_current_user)):
    """Météo en direct (Open-Meteo, gratuit / sans clé) pour les coordonnées
    fournies par le navigateur. Renvoie null si l'API est injoignable (fail-open)."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="Coordonnées invalides")
    try:
        data = await get_weather_live(lat, lon)
    except Exception as e:
        logger.warning(f"/weather a échoué: {e}")
        data = None
    return {"weather": data}


@api_router.get("/finance")
async def finance(ids: str = "", current_user: dict = Depends(get_current_user)):
    """Cours crypto/bourse en direct (CoinGecko, gratuit / sans clé). `ids` =
    liste d'identifiants CoinGecko séparés par des virgules ; à défaut, on prend
    les actifs suivis par l'utilisateur (ou BTC/ETH/SOL)."""
    if ids.strip():
        want = [x.strip() for x in ids.split(",") if x.strip()]
    else:
        cfg = current_user.get("widget_stack_config") or {}
        want = cfg.get("finance_assets") or DEFAULT_FINANCE_ASSETS
    try:
        data = await get_finance_live(want)
    except Exception as e:
        logger.warning(f"/finance a échoué: {e}")
        data = []
    return {"assets": data, "catalog": FINANCE_ASSETS}


WIDGET_STACK_IDS = ["trends", "screentime", "weather", "finance", "football", "mma", "wwe",
                    "profile_views", "ai_analytics", "astro_lifestyle"]


def _widget_stack_of(user: dict) -> dict:
    cfg = user.get("widget_stack_config") or {}
    order = [x for x in (cfg.get("order") or WIDGET_STACK_IDS) if x in WIDGET_STACK_IDS]
    # dédoublonne en gardant l'ordre
    seen, clean = set(), []
    for x in order:
        if x not in seen:
            seen.add(x); clean.append(x)
    fin = [a for a in (cfg.get("finance_assets") or DEFAULT_FINANCE_ASSETS) if a in FINANCE_ASSETS]
    fin_seen, fin_clean = set(), []
    for a in fin:
        if a not in fin_seen:
            fin_seen.add(a); fin_clean.append(a)
    wc = cfg.get("weather_city")
    weather_city = None
    if isinstance(wc, dict):
        try:
            lat, lon = float(wc.get("lat")), float(wc.get("lon"))
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                weather_city = {"name": str(wc.get("name") or "")[:80], "lat": lat, "lon": lon}
        except (TypeError, ValueError):
            weather_city = None
    return {
        "smart_rotate": cfg.get("smart_rotate", True),
        "order": clean or list(WIDGET_STACK_IDS),
        "finance_assets": fin_clean or list(DEFAULT_FINANCE_ASSETS),
        "weather_city": weather_city,
    }


@api_router.get("/users/me/widget-stack")
async def get_widget_stack(current_user: dict = Depends(get_current_user)):
    return _widget_stack_of(current_user)


@api_router.put("/users/me/widget-stack")
async def set_widget_stack(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    cfg = dict(current_user.get("widget_stack_config") or {})
    if "smart_rotate" in data:
        cfg["smart_rotate"] = bool(data.get("smart_rotate"))
    if "order" in data and isinstance(data.get("order"), list):
        seen, order = set(), []
        for x in data["order"]:
            x = str(x)
            if x in WIDGET_STACK_IDS and x not in seen:
                seen.add(x); order.append(x)
        cfg["order"] = order
    if "finance_assets" in data and isinstance(data.get("finance_assets"), list):
        seen, fin = set(), []
        for a in data["finance_assets"]:
            a = str(a)
            if a in FINANCE_ASSETS and a not in seen:
                seen.add(a); fin.append(a)
        cfg["finance_assets"] = fin
    if "weather_city" in data:
        wc = data.get("weather_city")
        if wc is None:
            cfg["weather_city"] = None  # retour à la géolocalisation auto
        elif isinstance(wc, dict):
            try:
                lat, lon = float(wc.get("lat")), float(wc.get("lon"))
                if -90 <= lat <= 90 and -180 <= lon <= 180:
                    cfg["weather_city"] = {"name": str(wc.get("name") or "")[:80], "lat": lat, "lon": lon}
            except (TypeError, ValueError):
                pass
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"widget_stack_config": cfg}})
    return _widget_stack_of({"widget_stack_config": cfg})


@api_router.get("/users/me/sport-alerts")
async def get_sport_alerts(current_user: dict = Depends(get_current_user)):
    return _sport_alerts_of(current_user)


@api_router.put("/users/me/sport-alerts")
async def set_sport_alerts(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    cur = current_user.get("sport_alerts") or {}
    for k in ("goals", "match", "mma"):
        if k in data:
            cur[k] = bool(data[k])
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"sport_alerts": cur}})
    return _sport_alerts_of({"sport_alerts": cur})


async def _notify_users(query: dict, title: str, body: str, url: str, tag: str) -> int:
    """Envoie un push (best-effort) à tous les utilisateurs correspondant au filtre.
    send_web_push est un no-op si l'utilisateur n'a pas d'abonnement."""
    users = await db.users.find(query, {"id": 1, "_id": 0}).to_list(length=5000)
    for u in users:
        try:
            await send_web_push(u["id"], title, body, url=url, tag=tag)
        except Exception:
            pass
    return len(users)


async def detect_and_notify_sports() -> int:
    """Un cycle de détection : buts de foot + fins de combats MMA → push. Renvoie
    le nombre d'événements notifiés. Sur le PREMIER passage (état vide), on
    n'envoie rien (on mémorise seulement) pour ne pas spammer l'existant."""
    doc = await db.sports_alert_state.find_one({"_id": "state"}) or {}
    prev_m, prev_f = (doc.get("matches") or {}), (doc.get("fights") or {})
    first_run = not prev_m and not prev_f
    new_m, new_f, events = {}, {}, 0

    # ── FOOT : diff de score ──
    try:
        foot = await get_live_scores()
    except Exception:
        foot = []
    for m in foot:
        mid = m.get("id")
        if not mid:
            continue
        try:
            hs, aw = int(m.get("home_score") or 0), int(m.get("away_score") or 0)
        except Exception:
            hs, aw = 0, 0
        new_m[mid] = {"h": hs, "a": aw, "s": m.get("state")}
        p = prev_m.get(mid)
        team_ids = [x for x in [m.get("home_id"), m.get("away_id")] if x]
        fav_or = [{"favorite_leagues": m.get("league_slug")}, {"favorite_teams": {"$in": team_ids}}]
        if first_run or not p:
            continue
        # But (score en hausse pendant un match en cours)
        if m.get("state") == "in" and (hs + aw) > (p.get("h", 0) + p.get("a", 0)):
            side = "home" if hs > p.get("h", 0) else "away"
            team = m.get("home") if side == "home" else m.get("away")
            scorer, minute = None, (m.get("clock") or "")
            try:
                det = await asyncio.to_thread(_espn_fetch_match_sync, mid, m.get("league_slug"))
                for ev in reversed((det or {}).get("events") or []):
                    if ev.get("type") in ("goal", "penalty_goal", "own_goal") and ev.get("side") == side:
                        scorer = (ev.get("players") or [None])[0]
                        minute = ev.get("minute") or minute
                        break
            except Exception:
                pass
            who = f" {scorer} ({minute})" if scorer else ""
            body = f"⚽ BUT pour {team} !{who} Le score est de {hs}-{aw}."
            await _notify_users(
                {"sport_alerts.goals": {"$ne": False}, "$or": fav_or},
                "But en direct", body, "/", f"goal-{mid}-{hs}-{aw}")
            events += 1
        # Début / fin de match
        if p.get("s") != m.get("state"):
            if m.get("state") == "in" and p.get("s") == "pre":
                await _notify_users({"sport_alerts.match": True, "$or": fav_or},
                                    "Coup d'envoi", f"\U0001f7e2 Coup d'envoi : {m.get('home')} - {m.get('away')}.", "/", f"start-{mid}")
            elif m.get("state") == "post":
                await _notify_users({"sport_alerts.match": True, "$or": fav_or},
                                    "Match terminé", f"⏱️ Fin du match : {m.get('home')} {hs}-{aw} {m.get('away')}.", "/", f"end-{mid}")

    # ── MMA : transition vers 'post' (combat terminé) ──
    try:
        mma = await asyncio.to_thread(_espn_fetch_mma_sync)
    except Exception:
        mma = []
    for f in mma:
        fid = f.get("id")
        if not fid:
            continue
        new_f[fid] = {"s": f.get("state")}
        p = prev_f.get(fid)
        if first_run or not p:
            continue
        if f.get("state") == "post" and p.get("s") != "post" and f.get("winner"):
            f1n, f2n = (f.get("f1") or {}).get("name"), (f.get("f2") or {}).get("name")
            loser = f1n if f2n == f.get("winner") else f2n
            rnd = f.get("round") or "?"
            body = f"\U0001f3c6 FIN DE COMBAT ! {f.get('winner')} s'impose par {f.get('method') or 'décision'} au Round {rnd} face à {loser}."
            await _notify_users({"sport_alerts.mma": {"$ne": False}}, "Résultat UFC", body, "/", f"mma-{fid}")
            events += 1

    await db.sports_alert_state.update_one(
        {"_id": "state"},
        {"$set": {"matches": new_m, "fights": new_f, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return events


@api_router.post("/internal/sports-poll")
async def sports_poll(request: Request):
    """Déclencheur externe (Cloud Scheduler / UptimeRobot) — protégé par une clé.
    Fait UN cycle de détection + envoi. Idéal ~toutes les 60 s. Compatible
    scale-to-zero : pas de boucle permanente côté serveur."""
    if not SPORTS_POLL_KEY:
        raise HTTPException(status_code=503, detail="Alertes sportives non configurées")
    key = request.headers.get("x-poll-key", "") or request.query_params.get("key", "")
    if not hmac.compare_digest(key, SPORTS_POLL_KEY):
        raise HTTPException(status_code=403, detail="Clé invalide")
    try:
        n = await detect_and_notify_sports()
    except Exception as e:
        logger.warning(f"sports-poll a échoué: {e}")
        n = 0
    return {"events": n}


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

    # Confidentialité : la recherche n'expose pas les publications des comptes
    # privés non suivis.
    blocked_private = await _private_blocked_authors(
        [p.get("author_id") for p in posts_raw], current_user["id"])

    posts = []
    for post_raw in posts_raw:
        if post_raw.get("author_id") in blocked_private:
            continue
        try:
            post = convert_mongo_doc_to_dict(post_raw)
            like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
            post["is_liked"] = bool(like_raw)
            enrich_post_poll(post, current_user["id"])
            posts.append(Post(**post))
        except Exception as e:
            logger.warning(f"Publication ignorée (invalide) {post_raw.get('id')}: {e}")

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
    recent_posts = await db.posts.find(q).sort("created_at", -1).allow_disk_use(True).limit(3000).to_list(length=3000)

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

    posts_raw = await db.posts.find({"content": regex}).sort("created_at", -1).allow_disk_use(True).limit(50).to_list(length=50)

    # Confidentialité : pas de publications de comptes privés non suivis.
    blocked_private = await _private_blocked_authors(
        [p.get("author_id") for p in posts_raw], current_user["id"])

    posts = []
    for post_raw in posts_raw:
        if post_raw.get("author_id") in blocked_private:
            continue
        try:
            post = convert_mongo_doc_to_dict(post_raw)
            like_raw = await db.likes.find_one({"post_id": post["id"], "user_id": current_user["id"]})
            post["is_liked"] = bool(like_raw)
            enrich_post_poll(post, current_user["id"])
            posts.append(Post(**post))
        except Exception as e:
            logger.warning(f"Publication ignorée (invalide) {post_raw.get('id')}: {e}")

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


# ═══════════════════════════════════════════════════════════════════════════
# ALGORITHME DE RECOMMANDATION — feed « Pour toi » + Clips
#
# Objectif : maximiser le temps passé en montrant le contenu le plus engageant.
# Signaux : engagement (likes/commentaires/partages), rétention des clips
# (taux de complétion + temps de visionnage), fraîcheur (décroissance dans le
# temps), personnalisation (comptes suivis + affinités créateurs/hashtags) et
# diversité (éviter le même créateur d'affilée, varier les découvertes).
#
# Performance : on classe un « pool » borné de candidats récents/engageants en
# Python (souple), avec un cache par utilisateur pour stabiliser la pagination
# du scroll infini. Render tourne en 1 worker → cache mémoire suffisant.
# ═══════════════════════════════════════════════════════════════════════════

_HASHTAG_RE = re.compile(r"#(\w{1,50})", re.UNICODE)


def _extract_tags(text):
    return {m.lower() for m in _HASHTAG_RE.findall(text or "")}


def _parse_iso_ts(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


# Affinités de l'utilisateur (créateurs & hashtags qu'il aime), cache 5 min.
_affinity_cache: Dict[str, tuple] = {}
AFFINITY_TTL = 300


async def _user_affinity(user_id):
    now = time.time()
    hit = _affinity_cache.get(user_id)
    if hit and hit[0] > now:
        return hit[1]
    creators, tags = set(), set()
    try:
        liked = await db.likes.find({"user_id": user_id}).sort("created_at", -1).limit(60).to_list(length=60)
        pids = [l.get("post_id") for l in liked if l.get("post_id")]
        if pids:
            posts = await db.posts.find(
                {"id": {"$in": pids}}, {"author_id": 1, "content": 1}
            ).to_list(length=len(pids))
            for p in posts:
                if p.get("author_id"):
                    creators.add(p["author_id"])
                tags |= _extract_tags(p.get("content"))
    except Exception:
        pass
    aff = {"creators": creators, "tags": set(list(tags)[:40])}
    # Borne mémoire : purge le cache s'il grossit trop (évite une fuite lente).
    if len(_affinity_cache) > 5000:
        _affinity_cache.clear()
    _affinity_cache[user_id] = (now + AFFINITY_TTL, aff)
    return aff


def _score_post(p, now_ts, followed, aff, is_clip, premium=frozenset()):
    """Score d'engagement d'un post/clip pour un utilisateur donné."""
    likes = p.get("likes_count", 0) or 0
    comments = p.get("comments_count", 0) or 0
    shares = p.get("shares_count", 0) or 0
    views = max(1, p.get("views", 0) or 0)
    ws = p.get("watch_sessions", 0) or 0
    comp_sum = p.get("completion_sum", 0.0) or 0.0
    watch_ms = p.get("watch_ms_total", 0) or 0
    avg_comp = (comp_sum / ws) if ws else 0.0
    avg_watch_s = (watch_ms / 1000.0 / ws) if ws else 0.0

    # Engagement absolu (portée) + taux d'engagement (qualité, par vue).
    eng = likes * 1.0 + comments * 2.0 + shares * 3.0
    eng_rate = eng / views
    quality = eng * 0.4 + eng_rate * 40.0
    if is_clip:
        # Rétention = signal fort côté clips (watch time + complétion).
        quality += avg_comp * 60.0 + min(avg_watch_s, 45.0) * 1.2

    # Fraîcheur : décroissance exponentielle (demi-vie ~33 h), avec un plancher
    # pour que la qualité compte encore sur du contenu un peu plus ancien.
    age_h = max(0.0, (now_ts - _parse_iso_ts(p.get("created_at"))) / 3600.0)
    recency = math.exp(-age_h / 48.0)
    # L'engagement (qualité) pèse davantage que la fraîcheur : le fil « Recommandé »
    # met ainsi le MEILLEUR contenu en tête (nettement différent du chronologique)
    # dès qu'il existe des interactions, au lieu de coller à l'ordre par date.
    score = quality * (0.6 + 0.4 * recency)

    # Boost « nouveau contenu prometteur » (jeune + déjà bon taux d'engagement).
    if age_h < 6 and eng_rate > 0.12:
        score += 20.0
    # Pénalité « fait quitter » : beaucoup vu mais peu complété.
    if is_clip and ws >= 5 and avg_comp < 0.25:
        score -= 30.0
    # Personnalisation.
    author = p.get("author_id")
    if author in followed:
        score += 18.0
    if author in aff["creators"]:
        score += 14.0
    if aff["tags"] and (_extract_tags(p.get("content")) & aff["tags"]):
        score += 10.0
    # Avantage Premium (bonus de visibilité, avantage réel des abonnés).
    if author in premium:
        score += 8.0
    return score


def _diversify(items, author_of, gap=2, max_per_author=4):
    """Réordonne (items déjà triés par score desc) pour éviter le même créateur
    d'affilée (fenêtre `gap`) et plafonner le nombre par créateur."""
    remaining = list(items)
    result, counts = [], {}
    while remaining:
        pick = None
        recent = [author_of(x) for x in result[-gap:]]
        for i, it in enumerate(remaining):
            a = author_of(it)
            if counts.get(a, 0) >= max_per_author or a in recent:
                continue
            pick = i
            break
        if pick is None:  # contrainte d'écart trop stricte → 1er sous quota
            for i, it in enumerate(remaining):
                if counts.get(author_of(it), 0) < max_per_author:
                    pick = i
                    break
        if pick is None:
            break  # tout le monde a atteint le quota
        it = remaining.pop(pick)
        a = author_of(it)
        counts[a] = counts.get(a, 0) + 1
        result.append(it)
    return result


# Cache de l'ordre de classement par utilisateur (stabilise la pagination).
_rank_cache: Dict[str, tuple] = {}
RANK_TTL = 180  # 3 min


async def _followed_ids(user_id):
    # La collection `follows` ne contient QUE des abonnements actifs (les demandes
    # en attente vivent dans `follow_requests`). On tolère donc les documents
    # hérités sans champ `status` (≠ "pending") pour ne jamais masquer à tort un
    # abonnement réel — décision critique pour la confidentialité.
    follows_raw = await db.follows.find(
        {"follower_id": user_id, "status": {"$ne": "pending"}}
    ).to_list(length=2000)
    out = set()
    for f in follows_raw:
        fid = f.get("followed_id") or f.get("following_id")
        if fid:
            out.add(fid)
    return out


async def _private_blocked_authors(author_ids, viewer_id, followed=None):
    """Parmi `author_ids`, l'ensemble des auteurs au compte PRIVÉ que `viewer_id`
    ne suit PAS activement (et qui ne sont pas lui-même).

    Règle de confidentialité (façon Instagram/X/TikTok) : le contenu d'un compte
    privé n'apparaît JAMAIS dans les fils algorithmiques (Pour vous, Clips) ni
    dans la recherche pour quelqu'un qui n'est pas un abonné approuvé. On calcule
    ici l'ensemble à EXCLURE, en une seule lecture users (bornée aux auteurs
    réellement présents)."""
    ids = list({a for a in author_ids if a and a != viewer_id})
    if not ids:
        return set()
    private_ids = {u["id"] for u in await db.users.find(
        {"id": {"$in": ids}, "is_private": True}, {"id": 1, "_id": 0}
    ).to_list(length=len(ids))}
    if not private_ids:
        return set()
    if followed is None:
        followed = await _followed_ids(viewer_id)
    return {a for a in private_ids if a not in followed}


async def _ranked_ids(kind, user_id, eu):
    """Renvoie l'ordre (liste d'ids) du feed classé, caché `RANK_TTL` s.
    kind = 'clips' (vidéos) | 'foryou' (posts)."""
    ckey = f"{kind}:{user_id}"
    hit = _rank_cache.get(ckey)
    if hit and hit[0] > time.time():
        return hit[1]

    is_clip = kind == "clips"
    # Nexus Clips = vidéos ORIGINALES uniquement : on exclut les reposts
    # (repost_of défini) pour éviter les doublons — un repost n'est pas une vidéo
    # originale (façon TikTok, l'engagement reste sur l'originale).
    base = {"media_type": "video", "media_url": {"$ne": None}, "repost_of": None} if is_clip \
        else {"repost_of": None}
    if is_clip and eu:
        base["$or"] = [{"eu_blocked": {"$ne": True}}, {"author_id": user_id}]

    proj = {"id": 1, "author_id": 1, "content": 1, "created_at": 1, "likes_count": 1,
            "comments_count": 1, "shares_count": 1, "views": 1, "watch_sessions": 1,
            "completion_sum": 1, "watch_ms_total": 1}
    # Pool : les 400 plus récents + les 200 plus engageants (pépites plus vieilles).
    # allow_disk_use : le tri par `likes_count` n'est pas couvert par un index de
    # préfixe ; sans autorisation disque, MongoDB trie EN MÉMOIRE et dépasse la
    # limite de 32 Mo dès que des médias base64 gonflent les documents (erreur 292).
    # Résultat : `_ranked_ids` levait → « Pour vous » (reco ET mix, qui appelle
    # ranked) tombait en repli chronologique → les 3 modes semblaient identiques.
    recent = await db.posts.find(base, proj).sort("created_at", -1).allow_disk_use(True).limit(400).to_list(length=400)
    top = await db.posts.find(base, proj).sort("likes_count", -1).allow_disk_use(True).limit(200).to_list(length=200)
    pool, seen = [], set()
    for p in recent + top:
        pid = p.get("id")
        if pid and pid not in seen:
            seen.add(pid)
            pool.append(p)

    followed = await _followed_ids(user_id)
    # Confidentialité : on retire du pool le contenu des comptes PRIVÉS que
    # l'utilisateur ne suit pas (jamais recommandé à un non-abonné).
    blocked_private = await _private_blocked_authors([p.get("author_id") for p in pool], user_id, followed)
    if blocked_private:
        pool = [p for p in pool if p.get("author_id") not in blocked_private]
    aff = await _user_affinity(user_id)
    premium = {u["id"] for u in await db.users.find({"is_premium": True}, {"id": 1}).to_list(length=5000)}
    now_ts = time.time()
    for p in pool:
        p["_score"] = _score_post(p, now_ts, followed, aff, is_clip, premium)
    pool.sort(key=lambda x: x["_score"], reverse=True)
    ordered = _diversify(pool, lambda x: x.get("author_id"), gap=2, max_per_author=4)
    ids = [p["id"] for p in ordered if p.get("id")]

    _rank_cache[ckey] = (now_ts + RANK_TTL, ids)
    if len(_rank_cache) > 20000:
        _rank_cache.clear()
    return ids


async def _fetch_posts_in_order(ids, user_id, media_base="", viewer_is_minor=False, hide_political=False):
    """Récupère et enrichit des posts en respectant l'ordre de `ids`.

    Le base64 des médias N'EST PAS chargé (étape d'agrégation → sentinel), pour
    ne jamais saturer la mémoire (anti-OOM). `media_base` (https://host) sert à
    reconstruire l'URL du proxy média servie au front."""
    if not ids:
        return []
    raw = await db.posts.aggregate(
        [{"$match": {"id": {"$in": ids}}}, _drop_base64_media_stage()],
        allowDiskUse=True,
    ).to_list(length=len(ids))
    by_id = {p.get("id"): p for p in raw}
    author_ids = [by_id[i].get("author_id") for i in ids if i in by_id]
    # Confidentialité (défense en profondeur, couvre aussi les replis
    # chronologiques des Clips) : on exclut le contenu des comptes privés non
    # suivis avant tout enrichissement/rendu.
    blocked_private = await _private_blocked_authors(author_ids, user_id)
    saved_ids = await _saved_post_ids(user_id, ids)
    premium_ids = await _premium_author_ids(author_ids)
    tip_ids = await _tip_author_ids(author_ids)
    liked = {l.get("post_id") for l in await db.likes.find(
        {"post_id": {"$in": ids}, "user_id": user_id}, {"post_id": 1}
    ).to_list(length=len(ids))}
    # Abonnements : quels auteurs le viewer suit-il déjà ? (pour masquer le « + »
    # de suivi dans le fil Clips). Un seul batch, deux formats de champ tolérés.
    uniq_authors = list({a for a in author_ids if a and a != user_id})
    followed_authors = set()
    if uniq_authors:
        followed_authors = {
            (f.get("followed_id") or f.get("following_id"))
            for f in await db.follows.find(
                {"follower_id": user_id, "$or": [
                    {"followed_id": {"$in": uniq_authors}},
                    {"following_id": {"$in": uniq_authors}},
                ]},
                {"followed_id": 1, "following_id": 1},
            ).to_list(length=len(uniq_authors))
        }
    out = []
    for pid in ids:
        pr = by_id.get(pid)
        if not pr:
            continue
        if pr.get("author_id") in blocked_private:
            continue  # compte privé non suivi → jamais dans un fil algorithmique
        post = convert_mongo_doc_to_dict(pr)
        _resolve_media_sentinel(post, media_base)
        post["is_liked"] = pid in liked
        post["is_saved"] = pid in saved_ids
        post["author_is_premium"] = post.get("author_id") in premium_ids
        post["author_can_receive_tips"] = post.get("author_id") in tip_ids
        post["author_is_following"] = post.get("author_id") in followed_authors
        try:
            enrich_post_poll(post, user_id)
            if viewer_is_minor:
                _mask_post_for_minor(post)
            out.append(Post(**post))
        except Exception as e:
            logger.warning(f"Clip/post ignoré (invalide) {post.get('id')}: {e}")
    return _drop_political(out, hide_political)


@api_router.get("/media/{kind}/{media_id}")
async def serve_media(kind: str, media_id: str, request: Request, exp: int = 0, sig: str = ""):
    """Sert un média À LA DEMANDE (un seul à la fois → mémoire bornée), au lieu
    d'inclure le base64 dans les flux (anti-OOM). kind ∈ {post, story, message}.

    - post / story : contenu public/entre abonnés, servi par UUID (non devinable).
      Les balises <video>/<img> n'envoient pas de jeton → pas d'auth.
    - message : PRIVÉ → exige une signature valide et non expirée (exp+sig),
      pour que le média d'un DM ne soit pas accessible publiquement par id.

    Si le média est déjà une URL externe (Cloudinary…), on redirige dessus.
    """
    entry = _MEDIA_KINDS.get(kind)
    if not entry:
        raise HTTPException(status_code=404, detail="Média introuvable")
    collection, field = entry
    # Contenu privé (DM) : signature obligatoire, valide et non expirée.
    if kind in _SIGNED_MEDIA_KINDS:
        now = int(time.time())
        if not sig or not exp or exp < now or not hmac.compare_digest(sig, _media_sign(kind, media_id, exp)):
            raise HTTPException(status_code=403, detail="Lien média invalide ou expiré")
    # Cache LRU des octets DÉCODÉS : une lecture vidéo enchaîne plusieurs requêtes
    # Range → on évite de recharger + redécoder tout le base64 depuis Mongo à
    # chaque tranche (gros gain de fluidité). Clé = kind:id (les id sont uniques).
    ckey = f"{kind}:{media_id}"
    cached = _media_cache_get(ckey)
    if cached is not None:
        data, content_type = cached
        return _ranged_media_response(request, data, content_type)
    try:
        doc = await db[collection].find_one({"id": media_id}, {field: 1, "_id": 0})
    except Exception:
        raise HTTPException(status_code=404, detail="Média introuvable")
    url = (doc or {}).get(field)
    if not isinstance(url, str) or not url:
        raise HTTPException(status_code=404, detail="Média introuvable")
    # Média externe déjà hébergé → redirection (léger, pas de décodage).
    if not url.startswith("data:"):
        return RedirectResponse(url, status_code=302)
    # Data URL base64 → on décode et on sert les octets (avec support Range).
    try:
        header, b64 = url.split(",", 1)
        content_type = header[5:].split(";")[0] or "application/octet-stream"
        data = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=404, detail="Média illisible")
    # Mise en cache des octets décodés (borné en taille totale, anti-OOM conservé)
    # → les Range suivantes de CETTE même vidéo sont servies sans retoucher Mongo.
    _media_cache_put(ckey, data, content_type)
    # Migration base64→Cloudinary opportuniste, UN média à la fois (mémoire
    # bornée) : allège progressivement la base à chaque lecture, sans jamais
    # charger plusieurs médias d'un coup. Best-effort (ne fait rien sans Cloudinary).
    schedule_lazy_media_migration(collection, {"id": media_id, field: url}, field=field)
    return _ranged_media_response(request, data, content_type)


# ==================== PAGES MIROIR DE PARTAGE (Open Graph) ====================
# Boucle de viralité : un lien /clip/:id ou /post/:id est servi par le backend
# (Cloud Run) avec des balises Open Graph générées dynamiquement depuis MongoDB,
# pour un aperçu riche sur WhatsApp/Discord/iMessage/X, + une page miroir noire
# épurée avec un gros bouton « Ouvrir dans Nexus ». Les robots sociaux
# n'exécutent pas de JS → l'HTML initial DOIT déjà contenir l'OG (SSR ici).

def _public_media_url_for_post(post: dict, base: str) -> Optional[str]:
    """URL média absolue et publiquement lisible (pas de data: ni de sentinel)."""
    mu = post.get("media_url")
    if not isinstance(mu, str) or not mu:
        return None
    if mu.startswith(_MEDIA_SENTINEL) or mu.startswith("data:"):
        pid = post.get("id") or ""
        return f"{base}/api/media/post/{pid}" if (base and pid) else None
    return _optimize_cloudinary(mu)


def _video_poster_url(media_url: Optional[str], base: str, post_id: str) -> Optional[str]:
    """Image d'aperçu (og:image) pour une vidéo. Cloudinary : 1re image extraite
    en JPG. Sinon on ne devine pas de poster (l'appelant retombe sur l'avatar)."""
    if not isinstance(media_url, str) or not media_url:
        return None
    if "res.cloudinary.com" in media_url and "/video/upload/" in media_url:
        head, _, rest = media_url.partition("/video/upload/")
        last = rest.rsplit("/", 1)[-1]
        if "." in last:
            rest = rest.rsplit(".", 1)[0]
        return f"{head}/video/upload/so_0/{rest}.jpg"
    return None


def _render_mirror_page(post: dict, base: str, kind: str) -> str:
    """Construit la page miroir HTML (OG + rendu épuré). kind ∈ {clip, post}."""
    pid = post.get("id") or ""
    author = post.get("author_username") or "quelqu'un"
    raw_caption = (post.get("content") or "").strip()
    is_video = post.get("media_type") == "video"
    media_url = _public_media_url_for_post(post, base)
    avatar = safe_http_url(post.get("author_profile_pic"))

    # og:image — pour une vidéo : poster Cloudinary sinon l'avatar (jamais l'URL
    # vidéo, qui ne s'afficherait pas comme miniature). Pour une image : elle-même.
    if is_video:
        og_image = _video_poster_url(post.get("media_url"), base, pid) or avatar
    else:
        og_image = media_url or avatar

    # CTA → deep-link dans l'app avec ?connect=1 : un membre connecté ouvre
    # directement le contenu ; un visiteur anonyme est mené vers l'inscription
    # (le front lit ce drapeau). Pas de boucle avec la page miroir.
    app_path = f"/nexus-clips/{pid}" if kind == "clip" else f"/post/{pid}"
    app_url = f"{FRONTEND_URL.rstrip('/')}{app_path}?connect=1"

    noun = "clip" if kind == "clip" else "publication"
    title = f"@{author} sur Nexus"
    desc = raw_caption[:180] if raw_caption else f"Découvre ce {noun} sur Nexus — le réseau social où tu es à ta place."

    e = _html.escape
    ea = lambda s: _html.escape(s or "", quote=True)

    og_tags = [
        f'<meta property="og:site_name" content="Nexus">',
        f'<meta property="og:type" content="{ "video.other" if is_video else "article" }">',
        f'<meta property="og:title" content="{ea(title)}">',
        f'<meta property="og:description" content="{ea(desc)}">',
        f'<meta property="og:url" content="{ea(base + "/" + kind + "/" + pid)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{ea(title)}">',
        f'<meta name="twitter:description" content="{ea(desc)}">',
    ]
    if og_image:
        og_tags.append(f'<meta property="og:image" content="{ea(og_image)}">')
        og_tags.append(f'<meta name="twitter:image" content="{ea(og_image)}">')
    if is_video and media_url:
        og_tags.append(f'<meta property="og:video" content="{ea(media_url)}">')
        og_tags.append(f'<meta property="og:video:secure_url" content="{ea(media_url)}">')
        og_tags.append('<meta property="og:video:type" content="video/mp4">')
        og_tags.append('<meta name="twitter:card" content="player">')

    # Média affiché dans la page miroir.
    if media_url and is_video:
        media_html = (
            f'<video src="{ea(media_url)}" controls autoplay loop muted playsinline '
            f'poster="{ea(og_image or "")}" style="width:100%;max-height:70vh;border-radius:20px;background:#000;object-fit:contain"></video>'
        )
    elif media_url:
        media_html = f'<img src="{ea(media_url)}" alt="" style="width:100%;max-height:70vh;border-radius:20px;object-fit:contain">'
    else:
        media_html = ""

    avatar_html = (
        f'<img src="{ea(avatar)}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover">'
        if avatar else
        f'<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;background:linear-gradient(135deg,#22d3ee,#3b82f6);color:#00363e">{e(author[:1].upper())}</div>'
    )
    caption_html = f'<p style="color:#c7d0e0;font-size:15px;line-height:1.5;margin:16px 0 0;text-align:left">{e(raw_caption)}</p>' if raw_caption else ""

    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{ea(title)} · Nexus</title>
{chr(10).join(og_tags)}
<style>
  * {{ box-sizing:border-box; }}
  html,body {{ margin:0; padding:0; background:#05070d; color:#e7ecf6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }}
  .wrap {{ min-height:100dvh; display:flex; flex-direction:column; align-items:center; }}
  .card {{ width:100%; max-width:520px; padding:20px 18px calc(env(safe-area-inset-bottom,0px) + 120px); }}
  .brand {{ display:flex; align-items:center; gap:8px; font-weight:900; font-size:20px; letter-spacing:-0.02em; padding:14px 2px 18px; }}
  .brand .dot {{ width:10px; height:10px; border-radius:50%; background:linear-gradient(135deg,#22d3ee,#3b82f6); box-shadow:0 0 12px rgba(34,211,238,.6); }}
  .author {{ display:flex; align-items:center; gap:10px; margin-top:16px; }}
  .author b {{ font-size:15px; }}
  .cta {{ position:fixed; left:0; right:0; bottom:0; padding:16px 18px calc(env(safe-area-inset-bottom,0px) + 16px); background:linear-gradient(to top,#05070d 60%,transparent); display:flex; justify-content:center; }}
  .cta a {{ width:100%; max-width:484px; text-align:center; text-decoration:none; padding:16px; border-radius:18px; font-weight:800; font-size:16px; color:#00363e; background:linear-gradient(135deg,#22d3ee,#3b82f6); box-shadow:0 8px 24px rgba(34,211,238,.35); }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="brand"><span class="dot"></span>Nexus</div>
      {media_html}
      <div class="author">{avatar_html}<b>@{e(author)}</b></div>
      {caption_html}
    </div>
  </div>
  <div class="cta"><a href="{ea(app_url)}">Ouvrir dans Nexus · Rejoindre la communauté</a></div>
</body>
</html>"""


async def _serve_mirror(kind: str, post_id: str, request: Request) -> HTMLResponse:
    base = _media_public_base(request)
    try:
        post = await db.posts.find_one({"id": post_id})
    except Exception:
        post = None
    if not post:
        # Lien mort → on renvoie vers l'app (feed) plutôt qu'une page vide.
        return HTMLResponse(
            f'<!doctype html><meta charset="utf-8">'
            f'<meta http-equiv="refresh" content="0; url={_html.escape(FRONTEND_URL, quote=True)}/feed">'
            f'<title>Nexus</title>', status_code=404)
    post = convert_mongo_doc_to_dict(post)
    # Confidentialité : le contenu d'un compte PRIVÉ n'est JAMAIS exposé
    # publiquement via le miroir (ni média, ni légende, ni balise OG d'aperçu).
    author = await db.users.find_one({"id": post.get("author_id")}, {"is_private": 1})
    if author and author.get("is_private"):
        home = f"{FRONTEND_URL.rstrip('/')}/auth"
        return HTMLResponse(
            f"""<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contenu privé · Nexus</title>
<meta property="og:title" content="Contenu privé · Nexus">
<meta property="og:description" content="Ce contenu provient d'un compte privé sur Nexus.">
<style>html,body{{margin:0;background:#05070d;color:#e7ecf6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;height:100dvh;display:flex;align-items:center;justify-content:center;text-align:center}}
.box{{padding:24px;max-width:360px}}.b{{font-weight:900;font-size:22px;margin-bottom:8px}}
a{{display:inline-block;margin-top:22px;padding:14px 22px;border-radius:16px;text-decoration:none;font-weight:800;color:#00363e;background:linear-gradient(135deg,#22d3ee,#3b82f6)}}</style>
</head><body><div class="box"><div class="b">🔒 Contenu privé</div>
<p style="color:#9fb0c8;line-height:1.5">Ce contenu provient d'un compte privé. Connecte-toi et abonne-toi pour le voir.</p>
<a href="{_html.escape(home, quote=True)}">Ouvrir dans Nexus</a></div></body></html>""",
            status_code=403, headers={"Cache-Control": "private, no-store"})
    html_page = _render_mirror_page(post, base, kind)
    return HTMLResponse(html_page, headers={"Cache-Control": "public, max-age=300"})


@app.get("/clip/{post_id}")
async def mirror_clip(post_id: str, request: Request):
    """Page miroir d'un clip (Open Graph + rendu épuré + CTA)."""
    return await _serve_mirror("clip", post_id, request)


@app.get("/post/{post_id}")
async def mirror_post(post_id: str, request: Request):
    """Page miroir d'une publication (Open Graph + rendu épuré + CTA)."""
    return await _serve_mirror("post", post_id, request)


@api_router.get("/clips")
async def get_clips_feed(request: Request, skip: int = 0, limit: int = 20, current_user: dict = Depends(get_current_user)):
    """
    Fil Nexus Clips classé par un algorithme d'engagement (watch time +
    complétion + interactions + fraîcheur + affinités), avec diversité des
    créateurs. Paginé (skip/limit) pour le scroll infini façon TikTok.

    Geo-block : pour un visiteur de l'UE, les clips eu_blocked sont retirés
    (l'auteur voit toujours les siens).
    """
    limit = max(1, min(limit, 40))
    media_base = _media_public_base(request)
    try:
        eu = CLIPS_EU_GEO_BLOCK and is_eu_request(request)
        ids = await _ranked_ids("clips", current_user["id"], eu)
        page = ids[skip: skip + limit]
        clips = await _fetch_posts_in_order(page, current_user["id"], media_base, viewer_is_minor=bool(current_user.get("is_minor")), hide_political=current_user.get("hide_political") is True)

        # Filet de sécurité : si le scroll dépasse le pool classé, on complète en
        # chronologique (clips plus anciens non inclus dans le pool). Projection
        # {id} : on ne charge PAS le base64 juste pour récupérer des ids (anti-OOM).
        if len(clips) < limit and skip >= len(ids):
            base = {"media_type": "video", "media_url": {"$ne": None}, "repost_of": None}
            if eu:
                base["$or"] = [{"eu_blocked": {"$ne": True}}, {"author_id": current_user["id"]}]
            extra_skip = skip - len(ids)
            raw = await db.posts.find(base, {"id": 1, "_id": 0}).sort("created_at", -1).allow_disk_use(True).skip(max(0, extra_skip)).limit(limit).to_list(length=limit)
            clips = await _fetch_posts_in_order([p.get("id") for p in raw], current_user["id"], media_base, viewer_is_minor=bool(current_user.get("is_minor")), hide_political=current_user.get("hide_political") is True)
        return clips
    except Exception as e:
        # Le classement a échoué → repli CHRONOLOGIQUE simple pour ne jamais
        # renvoyer un 500 (le fil doit toujours charger). Trace loggée.
        logger.exception(f"/clips (classement) a échoué, repli chronologique: {e}")
        try:
            raw = await db.posts.find(
                {"media_type": "video", "media_url": {"$ne": None}, "repost_of": None}, {"id": 1, "_id": 0}
            ).sort("created_at", -1).allow_disk_use(True).skip(max(0, skip)).limit(limit).to_list(length=limit)
            return await _fetch_posts_in_order([p.get("id") for p in raw], current_user["id"], media_base, viewer_is_minor=bool(current_user.get("is_minor")), hide_political=current_user.get("hide_political") is True)
        except Exception as e2:
            logger.exception(f"/clips repli chronologique a aussi échoué: {e2}")
            return []


async def _enrich_posts_for_user(raw, user_id):
    """Enrichit une liste de posts bruts (is_liked / is_saved / author_is_premium)
    en batch, puis renvoie une liste d'objets Post. Utilisé par la recherche."""
    # Confidentialité : exclut le contenu des comptes privés non suivis.
    blocked_private = await _private_blocked_authors([p.get("author_id") for p in raw], user_id)
    if blocked_private:
        raw = [p for p in raw if p.get("author_id") not in blocked_private]
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
        try:
            enrich_post_poll(p, user_id)
            out.append(Post(**p))
        except Exception as e:
            logger.warning(f"Post ignoré (invalide) {p.get('id')}: {e}")
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
        raw = await db.posts.find({"media_type": "video", "content": rx, "repost_of": None}) \
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
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=LIVE_MAX_HOURS)).isoformat()
        async for s in db.live_sessions.find({"active": True}).limit(50):
            if (s.get("started_at") or "") < cutoff:
                continue  # session fantôme (trop vieille) → ignorée
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
    _geo: bool = Depends(enforce_write_allowed),
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

    # Décharge la vidéo vers Cloudinary directement depuis les octets bruts (pas
    # de détour base64 en mémoire). Repli base64-en-base si Cloudinary absent.
    media_url = None
    if _CLOUDINARY_READY:
        try:
            def _up_clip():
                return _cloudinary_uploader.upload_large(
                    contents, folder="clips", resource_type="video",
                    unique_filename=True, overwrite=False, chunk_size=6_000_000,
                ) if len(contents) > 90_000_000 else _cloudinary_uploader.upload(
                    contents, folder="clips", resource_type="video",
                    unique_filename=True, overwrite=False,
                )
            res = await asyncio.to_thread(_up_clip)
            media_url = res.get("secure_url")
        except Exception as e:
            logger.warning(f"Upload clip Cloudinary échoué (repli base64): {e}")
    if not media_url:
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
async def create_clip_from_url(data: ExternalClip, current_user: dict = Depends(get_current_user),
                               _geo: bool = Depends(enforce_write_allowed)):
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
    """Compte une vue UNIQUE par utilisateur et par session (pas à chaque replay).
    Une vue sur un repost compte sur la vidéo d'origine (engagement centralisé)."""
    clip_id, _canon_doc = await _canonical_engagement_target(clip_id)
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


@api_router.post("/clips/{clip_id}/watch")
async def register_clip_watch(clip_id: str, data: dict = Body(default={}),
                              current_user: dict = Depends(get_current_user)):
    """Enregistre le temps de visionnage d'un clip (signal de rétention pour le
    classement). Corps : {watched_ms, duration_ms, completed}. Cumulé sur le
    clip (moyennes calculées au scoring). Best-effort, silencieux.

    Anti-abus : un visionnage < 300 ms est ignoré ; la complétion est bornée à
    [0,1] et le temps par session plafonné (évite de gonfler artificiellement).
    Un visionnage de repost est cumulé sur la vidéo d'origine."""
    clip_id, _canon_doc = await _canonical_engagement_target(clip_id)
    try:
        watched_ms = int(data.get("watched_ms") or 0)
        duration_ms = int(data.get("duration_ms") or 0)
    except (TypeError, ValueError):
        return {"success": False}
    if watched_ms < 300:
        return {"success": True, "counted": False}
    # Plafonne une session à 10 min pour éviter les valeurs aberrantes.
    watched_ms = min(watched_ms, 600_000)
    completed = bool(data.get("completed"))
    if duration_ms > 0:
        completion = min(1.0, watched_ms / duration_ms)
    else:
        completion = 1.0 if completed else 0.0
    if completed:
        completion = 1.0
    try:
        await db.posts.update_one(
            {"id": clip_id},
            {"$inc": {
                "watch_sessions": 1,
                "watch_ms_total": watched_ms,
                "completion_sum": completion,
            }},
        )
    except Exception:
        return {"success": False}

    # Historique de visionnage : on mémorise le clip dès 4 s de visionnage,
    # dédoublonné par (utilisateur, post) et rafraîchi à la dernière vue.
    if watched_ms >= 4000:
        try:
            now = datetime.now(timezone.utc).isoformat()
            await db.watch_history.update_one(
                {"user_id": current_user["id"], "post_id": clip_id},
                {"$set": {"ts": now, "kind": "clip"},
                 "$setOnInsert": {"user_id": current_user["id"], "post_id": clip_id, "created_at": now}},
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"watch_history: enregistrement échoué ({e})")
    return {"success": True, "counted": True}


@api_router.get("/users/me/watch-history", response_model=List[Post])
async def my_watch_history(request: Request, skip: int = 0, limit: int = 30,
                           current_user: dict = Depends(get_current_user)):
    """Historique de visionnage (clips/posts vus > 4 s), du plus récent au plus
    ancien — pour retrouver, liker ou partager facilement un contenu."""
    limit = max(1, min(limit, 60))
    rows = await db.watch_history.find(
        {"user_id": current_user["id"]}
    ).sort("ts", -1).skip(max(0, skip)).limit(limit).to_list(length=limit)
    ids = [r.get("post_id") for r in rows if r.get("post_id")]
    if not ids:
        return []
    media_base = _media_public_base(request)
    return await _fetch_posts_in_order(ids, current_user["id"], media_base,
                                       viewer_is_minor=bool(current_user.get("is_minor")))


@api_router.delete("/users/me/watch-history")
async def clear_watch_history(current_user: dict = Depends(get_current_user)):
    """Efface tout l'historique de visionnage de l'utilisateur."""
    res = await db.watch_history.delete_many({"user_id": current_user["id"]})
    return {"success": True, "deleted": res.deleted_count}


_mix_cache: Dict[str, tuple] = {}
MIX_TTL = 180  # 3 min — mélange stable le temps d'une session de scroll


async def _mixed_ids(user_id):
    """Ordre « Mix » : un VRAI mélange varié — ni chronologique, ni purement
    algorithmique. On réunit le pool recommandé et les publications récentes,
    puis on MÉLANGE avec une graine stable (utilisateur + fenêtre de temps) :
    l'ordre paraît aléatoire/varié mais reste stable pour la pagination du
    scroll (et change à la session suivante). Aucun base64 chargé (ids seuls)."""
    ckey = f"mix:{user_id}"
    hit = _mix_cache.get(ckey)
    if hit and hit[0] > time.time():
        return hit[1]

    ranked = await _ranked_ids("foryou", user_id, False)
    recent_raw = await db.posts.find(
        {"repost_of": None}, {"id": 1, "_id": 0}
    ).sort("created_at", -1).allow_disk_use(True).limit(600).to_list(length=600)

    pool, seen = [], set()
    for pid in ranked + [p.get("id") for p in recent_raw]:
        if pid and pid not in seen:
            seen.add(pid)
            pool.append(pid)

    # Mélange DÉTERMINISTE : graine = utilisateur + fenêtre de temps. Varié à
    # chaque session, mais stable durant la pagination (pas de doublons/trous).
    random.Random(f"{user_id}:{int(time.time() // MIX_TTL)}").shuffle(pool)

    _mix_cache[ckey] = (time.time() + MIX_TTL, pool)
    if len(_mix_cache) > 20000:
        _mix_cache.clear()
    return pool


async def _foryou_chronological(request, current_user, limit, skip):
    """Fil « Pour vous » en ordre STRICTEMENT chronologique (découverte,
    publications de tout le monde, hors reposts). Base64 non chargé (anti-OOM)."""
    media_base = _media_public_base(request)
    posts_raw = await db.posts.aggregate([
        {"$match": {"repost_of": None}},
        {"$sort": {"created_at": -1}},
        {"$skip": max(0, skip)},
        {"$limit": limit},
        _drop_base64_media_stage(),
    ], allowDiskUse=True).to_list(length=limit)

    posts = []
    ids = [p.get("id") for p in posts_raw]
    saved_ids = await _saved_post_ids(current_user["id"], ids)
    premium_ids = await _premium_author_ids([p.get("author_id") for p in posts_raw])
    tip_ids = await _tip_author_ids([p.get("author_id") for p in posts_raw])
    liked = {l.get("post_id") for l in await db.likes.find(
        {"post_id": {"$in": ids}, "user_id": current_user["id"]}, {"post_id": 1}
    ).to_list(length=len(ids) or 1)} if ids else set()
    for post_raw in posts_raw:
        try:
            post = convert_mongo_doc_to_dict(post_raw)
            _resolve_media_sentinel(post, media_base)
            post["is_liked"] = post["id"] in liked
            post["is_saved"] = post["id"] in saved_ids
            post["author_is_premium"] = post.get("author_id") in premium_ids
            post["author_can_receive_tips"] = post.get("author_id") in tip_ids
            enrich_post_poll(post, current_user["id"])
            posts.append(Post(**post))
        except Exception as e:
            logger.warning(f"/feed/foryou — post ignoré {post_raw.get('id')}: {e}")
    return _drop_political(posts, current_user.get("hide_political") is True)


@api_router.get("/feed/foryou", response_model=List[Post])
async def for_you_feed(request: Request, limit: int = 10, skip: int = 0,
                       mode: str = "reco", debug: int = 0, current_user: dict = Depends(get_current_user)):
    """
    Feed « Pour vous » — CONTRÔLABLE par l'utilisateur (transparence de l'algo).

    mode :
      - "chrono" : ordre strictement chronologique (découverte, tout le monde).
      - "reco"   : algorithme de recommandation « Pour toi » (engagement +
        fraîcheur + affinités + diversité) — réutilise le classeur existant.
      - "mix"    : entrelacement des deux (défaut : une pépite, une récente…).

    Paginé (skip/limit), base64 des médias non chargé (agrégation → proxy, anti-OOM).
    """
    limit = max(1, min(limit, 30))
    mode = (mode or "reco").strip().lower()
    if mode not in ("chrono", "reco", "mix"):
        mode = "reco"

    # RGPD/DSA : profilage algorithmique désactivé (ex. mineur de l'UE) → on force
    # le fil chronologique, quel que soit le `mode` demandé (pas de recommandation).
    if current_user.get("algorithmic_profiling") is False:
        return await _foryou_chronological(request, current_user, limit, skip)

    # Chronologique : chemin dédié (agrégation triée par date).
    if mode == "chrono":
        return await _foryou_chronological(request, current_user, limit, skip)

    media_base = _media_public_base(request)
    try:
        ids = await (_mixed_ids(current_user["id"]) if mode == "mix"
                     else _ranked_ids("foryou", current_user["id"], False))
        page = ids[skip: skip + limit]
        posts = await _fetch_posts_in_order(page, current_user["id"], media_base, viewer_is_minor=bool(current_user.get("is_minor")), hide_political=current_user.get("hide_political") is True)

        # Pool épuisé (scroll au-delà du classement) → on complète en
        # chronologique pour garder un scroll infini fluide.
        if len(posts) < limit and skip >= len(ids):
            extra = await _foryou_chronological(request, current_user, limit, skip - len(ids))
            have = {p.id for p in posts}
            posts += [p for p in extra if p.id not in have]
        return posts
    except Exception as e:
        # Le classement a échoué → repli chronologique (le fil doit TOUJOURS charger).
        logger.exception(f"/feed/foryou (mode={mode}) a échoué, repli chronologique: {e}")
        if debug:
            import traceback
            return JSONResponse(status_code=500, content={
                "mode": mode,
                "error": f"{type(e).__name__}: {e}",
                "trace": traceback.format_exc()[-1800:],
            })
        return await _foryou_chronological(request, current_user, limit, skip)


@api_router.get("/admin/metrics")
async def admin_metrics(current_user: dict = Depends(require_admin)):
    """Tableau de bord SANTÉ de l'app (admin uniquement) : total utilisateurs,
    nouveaux inscrits (jour / 7 j), DAU (utilisateurs actifs/jour) et rétention
    J+1 / J+7 / J+30. Basé sur les données déjà présentes :
      • users.created_at  → inscriptions
      • users.last_active → dernière activité (rétention)
      • sessions.started_at → activité par jour (DAU)

    Best-effort mais fiable : les comptes en Mode Confidentialité stricte (pas de
    suivi de session) n'apparaissent pas dans le DAU / la rétention — ils comptent
    quand même dans le total d'utilisateurs."""
    now = datetime.now(timezone.utc)
    DAYS = 14

    def day_str(dt):
        return dt.strftime("%Y-%m-%d")

    def parse(s):
        try:
            dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None

    since = (now - timedelta(days=DAYS - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    since_iso = since.isoformat()

    total_users = await db.users.count_documents({})

    # Nouveaux inscrits par jour (created_at est une chaîne ISO → on prend "YYYY-MM-DD").
    signup_rows = await db.users.aggregate([
        {"$match": {"created_at": {"$gte": since_iso}}},
        {"$project": {"day": {"$substrCP": [{"$ifNull": ["$created_at", ""]}, 0, 10]}}},
        {"$group": {"_id": "$day", "n": {"$sum": 1}}},
    ], allowDiskUse=True).to_list(length=1000)
    signup_by_day = {r["_id"]: r["n"] for r in signup_rows if r.get("_id")}

    # DAU par jour : utilisateurs DISTINCTS ayant une session ce jour-là.
    dau_rows = await db.sessions.aggregate([
        {"$match": {"started_at": {"$gte": since_iso}}},
        {"$project": {"user_id": 1, "day": {"$substrCP": [{"$ifNull": ["$started_at", ""]}, 0, 10]}}},
        {"$group": {"_id": {"day": "$day", "u": "$user_id"}}},
        {"$group": {"_id": "$_id.day", "dau": {"$sum": 1}}},
    ], allowDiskUse=True).to_list(length=1000)
    dau_by_day = {r["_id"]: r["dau"] for r in dau_rows if r.get("_id")}

    # Séries alignées sur les 14 jours (jours sans donnée = 0).
    signups_series, dau_series = [], []
    for i in range(DAYS):
        d = day_str(since + timedelta(days=i))
        signups_series.append({"day": d, "count": signup_by_day.get(d, 0)})
        dau_series.append({"day": d, "dau": dau_by_day.get(d, 0)})

    today = day_str(now)
    new_signups_today = signup_by_day.get(today, 0)
    dau_today = dau_by_day.get(today, 0)
    new_signups_7d = sum(signup_by_day.get(day_str(now - timedelta(days=k)), 0) for k in range(7))

    # Rétention J+N : parmi les inscrits d'il y a AU MOINS N jours (ils ont eu le
    # temps de revenir), part de ceux dont la dernière activité date d'AU MOINS
    # N jours après l'inscription (= revenus au moins N jours plus tard).
    users = await db.users.find({}, {"created_at": 1, "last_active": 1, "_id": 0}).to_list(length=500000)
    retention = {}
    for label, N in (("j1", 1), ("j7", 7), ("j30", 30)):
        threshold = now - timedelta(days=N)
        cohort = retained = 0
        for u in users:
            c = parse(u.get("created_at"))
            if not c or c > threshold:
                continue
            cohort += 1
            la = parse(u.get("last_active"))
            if la and (la - c) >= timedelta(days=N):
                retained += 1
        retention[label] = {
            "rate": round(100.0 * retained / cohort, 1) if cohort else None,
            "cohort": cohort,
            "retained": retained,
        }

    return {
        "generated_at": now.isoformat(),
        "total_users": total_users,
        "new_signups_today": new_signups_today,
        "new_signups_7d": new_signups_7d,
        "dau_today": dau_today,
        "signups_series": signups_series,
        "dau_series": dau_series,
        "retention": retention,
    }


@api_router.get("/admin/cloudinary-status")
async def cloudinary_status(current_user: dict = Depends(require_admin)):
    """Diagnostic Cloudinary (admin). Dit si Cloudinary est prêt ET fait un
    micro-upload de test (pixel 1×1, supprimé aussitôt) pour révéler la VRAIE
    cause d'un échec — typiquement un couple clé/secret invalide dans
    CLOUDINARY_URL (« Invalid Signature »). Aucun média utilisateur touché."""
    info = {
        "ready": _CLOUDINARY_READY,
        "has_CLOUDINARY_URL": bool(os.environ.get("CLOUDINARY_URL")),
        "has_separate_vars": bool(os.environ.get("CLOUDINARY_CLOUD_NAME")),
    }
    try:
        cfg = _cloudinary.config() if _CLOUDINARY_READY else None
        if cfg:
            info["cloud_name"] = getattr(cfg, "cloud_name", None)
            info["api_key_present"] = bool(getattr(cfg, "api_key", None))
            info["api_secret_present"] = bool(getattr(cfg, "api_secret", None))
    except Exception as e:
        info["config_error"] = str(e)
    # Combien de médias sont encore en base64 (progression de migration).
    try:
        rx = {"$regex": "^data:"}
        info["remaining_base64"] = {
            f"{c}.{f}": await db[c].count_documents({f: rx}) for c, f in _MEDIA_TARGETS
        }
    except Exception:
        pass
    if not _CLOUDINARY_READY:
        info["diagnostic"] = ("Cloudinary NON initialisé : la variable n'est pas lue "
                              "(absente au démarrage, ou lib non importée). Vérifie que "
                              "CLOUDINARY_URL existe bien sur la révision Cloud Run ACTIVE.")
        return info
    # Micro-upload de test (pixel PNG 1×1 transparent), supprimé aussitôt.
    tiny = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC"
            "AAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    try:
        res = await asyncio.to_thread(lambda: _cloudinary_uploader.upload(
            tiny, folder="nexus/_diagnostic", resource_type="image"))
        pid = res.get("public_id")
        if pid:
            try:
                await asyncio.to_thread(lambda: _cloudinary_uploader.destroy(pid))
            except Exception:
                pass
        info["upload_test"] = "OK"
        info["diagnostic"] = ("Cloudinary FONCTIONNE ✅ — les nouveaux uploads iront sur "
                              "Cloudinary. Lance /api/admin/migrate-media pour alléger l'ancien base64.")
    except Exception as e:
        info["upload_test"] = "ÉCHEC"
        info["error"] = str(e)
        info["diagnostic"] = ("Cloudinary est configuré mais l'upload ÉCHOUE — le plus souvent "
                              "un couple clé/secret invalide dans CLOUDINARY_URL (format attendu : "
                              "cloudinary://API_KEY:API_SECRET@CLOUD_NAME, sans guillemets ni espace).")
    return info


# ==================== MIGRATION MÉDIAS base64 → Cloudinary (admin) ====================
# Migre les médias EXISTANTS (stockés en base64) vers Cloudinary, PAR PETITS LOTS
# pour ne pas saturer la mémoire. À appeler en boucle (admin) jusqu'à ce que
# `remaining` tombe à 0. Chaque collection/champ est traité séparément.
_MEDIA_TARGETS = [
    ("posts", "media_url"),        # publications + clips (le plus lourd)
    ("stories", "media_url"),
    ("instants", "media_url"),
    ("messages", "media_url"),     # images/vidéos/vocaux des DM (fil lent sinon)
    ("users", "profile_pic"),
    ("group_chats", "avatar_url"),
]


@api_router.post("/admin/migrate-media")
async def migrate_media_to_cloudinary(collection: str = "posts", field: str = "media_url",
                                      batch: int = 10, current_user: dict = Depends(get_current_user)):
    """Migre un LOT de médias base64 → Cloudinary. Réservé aux administrateurs.

    Appeler en boucle (ex. batch=10) jusqu'à `remaining == 0`, pour chaque
    couple (collection, field) de `targets` renvoyé. Best-effort : un média qui
    échoue est laissé tel quel et réessayé au prochain passage.
    """
    if not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    if not _CLOUDINARY_READY:
        raise HTTPException(status_code=400, detail="Cloudinary n'est pas configuré (variables d'environnement).")
    if (collection, field) not in _MEDIA_TARGETS:
        raise HTTPException(status_code=400, detail="Cible non autorisée.")
    batch = max(1, min(batch, 25))
    coll = db[collection]
    rx = {"$regex": "^data:"}
    # Projection : uniquement id + le champ média (pas les autres gros champs).
    docs = await coll.find({field: rx}, {"id": 1, field: 1}).limit(batch).to_list(length=batch)
    migrated, failed = 0, 0
    for d in docs:
        new_url = await store_media(d.get(field), folder=f"migrated/{collection}")
        if new_url and not str(new_url).startswith("data:"):
            await coll.update_one({"id": d["id"]}, {"$set": {field: new_url}})
            migrated += 1
        else:
            failed += 1
    remaining = await coll.count_documents({field: rx})
    return {
        "collection": collection, "field": field,
        "migrated": migrated, "failed": failed, "remaining": remaining,
        "targets": [{"collection": c, "field": f} for c, f in _MEDIA_TARGETS],
    }


# ====================================================================
# VÉRIFICATION D'IDENTITÉ (3 niveaux) — conforme RGPD + loi FR
# --------------------------------------------------------------------
#  1) Basique   : âge >= 15 (à l'inscription) + email + téléphone (codes OTP)
#  2) Renforcée : upload d'une pièce d'identité → revue admin → badge « Vérifié »
#  3) Créateur  : identité vérifiée requise pour tips/abonnements/retraits (KYC)
#
# Sécurité/RGPD :
#  • les codes OTP sont HACHÉS (jamais en clair) et expirent ;
#  • la pièce d'identité est CHIFFRÉE au repos (Fernet), jamais servie
#    publiquement, consultable uniquement par un admin, et PURGÉE après décision
#    (minimisation des données) ;
#  • la date de naissance est chiffrée ; on n'expose que des statuts/booléens.
# ====================================================================
import secrets as _secrets

OTP_TTL_SECONDS = 600        # 10 min
ID_DOC_MAX_BYTES = 8_000_000  # 8 Mo
_SMS_ENABLED = bool(os.environ.get("SMS_PROVIDER_CONFIGURED"))  # placeholder provider


def _hash_code(code: str) -> str:
    return hashlib.sha256(("nexus-otp:" + str(code)).encode()).hexdigest()


def _gen_code() -> str:
    return f"{_secrets.randbelow(1_000_000):06d}"


async def _issue_otp(user_id: str, kind: str) -> str:
    """Génère + stocke (haché) un code OTP pour (user, kind). Renvoie le code clair
    (à ENVOYER, pas à stocker)."""
    code = _gen_code()
    exp = (datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS)).isoformat()
    await db.verification_codes.update_one(
        {"user_id": user_id, "kind": kind},
        {"$set": {"code_hash": _hash_code(code), "expires_at": exp, "attempts": 0}},
        upsert=True,
    )
    return code


async def _check_otp(user_id: str, kind: str, code: str) -> bool:
    rec = await db.verification_codes.find_one({"user_id": user_id, "kind": kind})
    if not rec:
        return False
    if (rec.get("expires_at") or "") < datetime.now(timezone.utc).isoformat():
        return False
    if int(rec.get("attempts", 0)) >= 5:
        return False
    ok = _secrets.compare_digest(rec.get("code_hash", ""), _hash_code(code))
    if not ok:
        await db.verification_codes.update_one(
            {"user_id": user_id, "kind": kind}, {"$inc": {"attempts": 1}})
        return False
    await db.verification_codes.delete_one({"user_id": user_id, "kind": kind})
    return True


class AgeIn(BaseModel):
    birthdate: str  # AAAA-MM-JJ


class OtpConfirm(BaseModel):
    code: str


class PhoneIn(BaseModel):
    phone: str
    code: Optional[str] = None


class RejectIn(BaseModel):
    reason: Optional[str] = ""


@api_router.post("/verify/age")
async def verify_age(data: AgeIn, current_user: dict = Depends(get_current_user)):
    """Contrôle d'âge pour les comptes EXISTANTS (créés avant le contrôle à
    l'inscription). Confirme >= 15 ans (loi FR) : au-dessous → compte bloqué.
    La date de naissance est chiffrée au repos ; on n'expose qu'un booléen."""
    age = _compute_age(data.birthdate)
    if age is None:
        raise HTTPException(status_code=400, detail="Date de naissance invalide (format AAAA-MM-JJ).")
    enc = encrypt(str(data.birthdate)[:10])
    if age < MIN_SIGNUP_AGE:
        await db.users.update_one({"id": current_user["id"]}, {"$set": {
            "age_verified": False, "age_blocked": True, "birthdate_enc": enc}})
        raise HTTPException(
            status_code=403,
            detail=f"Accès refusé : l'âge minimum est de {MIN_SIGNUP_AGE} ans (loi française).",
        )
    is_minor = age < 18
    upd = {"age_verified": True, "age_blocked": False, "birthdate_enc": enc, "is_minor": is_minor}
    if is_minor:
        upd["is_private"] = True  # compte mineur forcé en privé
    await db.users.update_one({"id": current_user["id"]}, {"$set": upd})
    return {"age_verified": True, "age": age, "is_minor": is_minor}


@api_router.get("/verify/status")
async def verify_get_status(current_user: dict = Depends(get_current_user)):
    """État de vérification de l'utilisateur (aucune donnée sensible exposée)."""
    u = await db.users.find_one({"id": current_user["id"]}, {
        "verification_status": 1, "age_verified": 1, "email_verified": 1,
        "phone_verified": 1, "is_verified": 1,
    }) or {}
    last = await db.identity_submissions.find_one(
        {"user_id": current_user["id"]}, sort=[("created_at", -1)])
    status = u.get("verification_status", "unverified")
    # is_verified fait autorité : si la pièce a été validée, le statut est
    # « verified » même si un ancien champ verification_status est resté « pending »
    # (évite d'afficher « Vérification en cours » sur un compte déjà vérifié).
    if u.get("is_verified"):
        status = "verified"
    return {
        "status": status,                                   # unverified|pending|verified|rejected
        "age_verified": bool(u.get("age_verified")),
        "email_verified": bool(u.get("email_verified")),
        "phone_verified": bool(u.get("phone_verified")),
        "identity_verified": bool(u.get("is_verified")),
        "can_resubmit": status in ("unverified", "rejected"),
        "rejection_reason": (last or {}).get("rejection_reason") if status == "rejected" else None,
    }


# ---- Niveau 1 : OTP email --------------------------------------------------
@api_router.post("/verify/email/send")
async def verify_email_send(background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    if not rate_limit(f"otp_email:{current_user['id']}", max_attempts=5, window_seconds=600):
        raise HTTPException(status_code=429, detail="Trop de demandes. Réessayez dans quelques minutes.")
    code = await _issue_otp(current_user["id"], "email")
    email = current_user.get("email")
    delivered = False
    if _EMAIL_ENABLED and send_brevo_email and email:
        background_tasks.add_task(
            send_brevo_email, email, "Ton code de vérification Nexus Social",
            f"<p>Ton code de vérification est : <b style='font-size:20px'>{code}</b></p>"
            "<p>Il expire dans 10 minutes.</p>")
        delivered = True
    # Si l'envoi d'email n'est pas configuré, on renvoie le code (mode dev) pour
    # que le flux reste testable. En prod, configure Brevo pour que le code parte
    # par email au lieu d'être renvoyé ici.
    return {"sent": True, "delivered": delivered, "dev_code": None if delivered else code}


# ==================== NEXUS AI (assistant de messagerie) ====================
# Assistant conversationnel « Nexus AI ». Branché sur Gemini si GEMINI_API_KEY est
# défini (« l'ami de Gemini »), sinon repli amical le temps de la configuration.
NEXUS_AI_SYSTEM = (
    "Tu es Nexus AI, l'assistant intégré du réseau social Nexus Social. Réponds "
    "dans la langue de l'utilisateur (français par défaut), de façon amicale, "
    "concise et utile. Tu aides à utiliser l'app, rédiger des publications, "
    "trouver des idées de clips/stories, et répondre aux questions."
)


class AIChatIn(BaseModel):
    message: str
    history: Optional[list] = None  # [{role: "user"|"assistant", text: str}]


def _gemini_reply_sync(message: str, history):
    """Appelle Gemini (REST) si GEMINI_API_KEY est configurée.

    Renvoie un tuple (statut, valeur) :
      • ("nokey", None)  → aucune clé configurée
      • ("ok", texte)    → réponse de Gemini
      • ("error", détail)→ clé présente mais l'appel a échoué (modèle, API non
                           activée, quota, clé invalide…). Best-effort, jamais bloquant.
    """
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return ("nokey", None)
    try:
        import requests as _rq
        contents = []
        for h in (history or [])[-10:]:
            txt = str((h or {}).get("text") or "")[:2000]
            if not txt:
                continue
            role = "user" if (h or {}).get("role") == "user" else "model"
            contents.append({"role": role, "parts": [{"text": txt}]})
        contents.append({"role": "user", "parts": [{"text": message}]})
        body = {
            "system_instruction": {"parts": [{"text": NEXUS_AI_SYSTEM}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 800},
        }
        # Les noms de modèles évoluent côté Google (les 1.5 ont été retirés). On
        # essaie le modèle configuré puis des valeurs récentes jusqu'à succès.
        preferred = os.environ.get("GEMINI_MODEL")
        candidates = [preferred, "gemini-2.0-flash", "gemini-2.5-flash",
                      "gemini-flash-latest", "gemini-1.5-flash"]
        tried = [m for m in dict.fromkeys(candidates) if m]  # dédup, sans None
        last_err = "inconnu"
        for model in tried:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            r = _rq.post(url, json=body, timeout=30)
            if r.status_code == 200:
                data = r.json()
                cand = (data.get("candidates") or [{}])[0]
                parts = ((cand.get("content") or {}).get("parts") or [])
                text = "".join(p.get("text", "") for p in parts).strip()
                if text:
                    return ("ok", text)
                last_err = "réponse vide (contenu bloqué ?)"
                continue
            last_err = f"HTTP {r.status_code}"
            logger.warning(f"Gemini {model} → {r.status_code}: {r.text[:200]}")
            # 404 = modèle inconnu → on tente le suivant ; 400/403 = clé/API →
            # inutile d'insister mais on laisse la boucle finir vite.
        return ("error", last_err)
    except Exception as e:
        logger.warning(f"Gemini indisponible : {e}")
        return ("error", str(e)[:120])


async def _nexus_ai_reply(message: str, history, user: dict) -> str:
    status, value = await asyncio.to_thread(_gemini_reply_sync, message, history)
    if status == "ok" and value:
        return value
    if status == "error":
        # Clé présente mais l'appel échoue → message clair pour débloquer la config.
        return (
            "🤖 Je suis connecté mais je n'arrive pas à joindre mon moteur Gemini "
            f"({value}). Vérifie que la variable GEMINI_API_KEY est valide et que "
            "l'API « Generative Language » est activée sur ton projet Google."
        )
    # Aucune clé → repli amical (l'endpoint reste fonctionnel).
    return (
        "👋 Salut ! Je suis Nexus AI. Mon cerveau complet arrive très bientôt — "
        "je pourrai alors t'aider à rédiger tes publications, trouver des idées de "
        "clips et répondre à tes questions sur Nexus Social. À très vite ! 🤖"
    )


@api_router.post("/ai/chat")
async def ai_chat(data: AIChatIn, current_user: dict = Depends(get_current_user)):
    """Répond à un message adressé à Nexus AI."""
    msg = (data.message or "").strip()[:2000]
    if not msg:
        raise HTTPException(status_code=400, detail="Message vide.")
    if not rate_limit(f"ai_chat:{current_user['id']}", max_attempts=30, window_seconds=60):
        raise HTTPException(status_code=429, detail="Trop de messages — patiente un instant.")
    reply = await _nexus_ai_reply(msg, data.history, current_user)
    return {"reply": reply, "ai": True}
# ==================== END NEXUS AI ====================


@api_router.post("/verify/email/confirm")
async def verify_email_confirm(data: OtpConfirm, current_user: dict = Depends(get_current_user)):
    if not await _check_otp(current_user["id"], "email", (data.code or "").strip()):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"email_verified": True}})
    return {"email_verified": True}


# ---- Niveau 1 : OTP téléphone (envoi SMS réel) ----------------------------
def _send_sms_sync(phone: str, text: str) -> bool:
    """Envoi SMS best-effort. Essaie Twilio puis Brevo SMS selon la config env.
    Renvoie True si un fournisseur a accepté l'envoi, False sinon."""
    import requests as _rq
    digits = re.sub(r"\D", "", phone or "")          # chiffres seuls (Brevo)
    e164 = ("+" + digits) if digits else ""           # format E.164 (Twilio)

    # Twilio (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    tok = os.environ.get("TWILIO_AUTH_TOKEN")
    frm = os.environ.get("TWILIO_FROM")
    if sid and tok and frm and e164:
        try:
            r = _rq.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={"From": frm, "To": e164, "Body": text}, auth=(sid, tok), timeout=15)
            if r.status_code < 300:
                return True
        except Exception:
            pass

    # Brevo SMS (BREVO_API_KEY / BREVO_SMS_SENDER) — recipient sans « + ».
    bk = os.environ.get("BREVO_API_KEY")
    sender = os.environ.get("BREVO_SMS_SENDER")
    if bk and sender and digits:
        try:
            r = _rq.post(
                "https://api.brevo.com/v3/transactionalSMS/sms",
                headers={"api-key": bk, "Content-Type": "application/json", "accept": "application/json"},
                json={"type": "transactional", "sender": sender[:11], "recipient": digits, "content": text},
                timeout=15)
            if r.status_code < 300:
                return True
        except Exception:
            pass
    return False


async def send_sms(phone: str, text: str) -> bool:
    try:
        return await asyncio.to_thread(_send_sms_sync, phone, text)
    except Exception:
        return False


@api_router.post("/verify/phone/send")
async def verify_phone_send(data: PhoneIn, current_user: dict = Depends(get_current_user)):
    phone = (data.phone or "").strip()
    if len(phone) < 6:
        raise HTTPException(status_code=400, detail="Numéro de téléphone invalide.")
    if not rate_limit(f"otp_phone:{current_user['id']}", max_attempts=5, window_seconds=600):
        raise HTTPException(status_code=429, detail="Trop de demandes. Réessayez dans quelques minutes.")
    # Numéro CHIFFRÉ au repos (RGPD).
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"phone_enc": encrypt(phone)}})
    code = await _issue_otp(current_user["id"], "phone")
    delivered = await send_sms(phone, f"Ton code de vérification Nexus Social : {code} (valable 10 min).")
    # Si aucun fournisseur SMS n'est configuré (delivered=False), on renvoie le
    # code (mode démo) pour rester testable. En prod, configure Twilio/Brevo SMS.
    return {"sent": True, "delivered": delivered, "dev_code": None if delivered else code}


@api_router.post("/verify/phone/confirm")
async def verify_phone_confirm(data: OtpConfirm, current_user: dict = Depends(get_current_user)):
    if not await _check_otp(current_user["id"], "phone", (data.code or "").strip()):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré.")
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"phone_verified": True}})
    return {"phone_verified": True}


# ---- Niveau 2 : pièce d'identité (chiffrée) → revue admin ------------------
async def _admin_ids() -> list:
    """IDs des comptes administrateurs (via ADMIN_EMAILS)."""
    if not ADMIN_EMAILS:
        return []
    try:
        rows = await db.users.find({"email": {"$in": list(ADMIN_EMAILS)}}, {"id": 1}).to_list(length=50)
        return [r["id"] for r in rows if r.get("id")]
    except Exception:
        return []


async def _notify_admins_new_verification(username: str):
    """Prévient les admins (push navigateur, même déconnectés) + notif in-app."""
    for aid in await _admin_ids():
        try:
            await send_web_push(
                aid, "Nexus Social",
                f"@{username} a soumis une vérification d'identité",
                "/admin/verifications", tag="verification")
        except Exception:
            pass
        try:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "user_id": aid, "type": "verification",
                "from_user_id": "", "from_username": username, "post_id": None,
                "content": f"@{username} a soumis une vérification d'identité",
                "url": "/admin/verifications", "read": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await push_realtime(aid, {"type": "notification", "data": {"type": "verification"}})
        except Exception:
            pass


async def _read_id_upload(f: UploadFile, label: str) -> str:
    """Lit + valide + CHIFFRE un fichier de vérification. Renvoie le base64 chiffré."""
    ctype = (f.content_type or "")
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"{label} invalide (image attendue).")
    contents = await f.read()
    if not contents:
        raise HTTPException(status_code=400, detail=f"{label} vide.")
    if len(contents) > ID_DOC_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} trop lourd (max 8 Mo).")
    return encrypt(base64.b64encode(contents).decode())


@api_router.post("/verify/identity/submit")
async def verify_identity_submit(
    file: UploadFile = File(...),               # photo de la pièce (caméra arrière)
    selfie: UploadFile = File(None),            # selfie visage (caméra avant) — liveness
    doc_type: str = Form("id_card"),            # id_card | passport | residence_permit
    current_user: dict = Depends(get_current_user),
):
    """Soumission pièce d'identité + selfie pour la vérification renforcée.

    Documents CHIFFRÉS au repos (jamais servis en clair), mis en revue admin,
    purgés après décision. Re-soumission autorisée après un refus.
    """
    u = await db.users.find_one({"id": current_user["id"]}, {"verification_status": 1, "is_verified": 1})
    if (u or {}).get("is_verified") or (u or {}).get("verification_status") == "verified":
        raise HTTPException(status_code=400, detail="Votre identité est déjà vérifiée.")
    if (u or {}).get("verification_status") == "pending":
        raise HTTPException(status_code=409, detail="Une vérification est déjà en cours.")

    document_enc = await _read_id_upload(file, "Pièce d'identité")
    selfie_enc = await _read_id_upload(selfie, "Selfie") if selfie is not None else None

    sub_id = str(uuid.uuid4())
    await db.identity_submissions.insert_one({
        "id": sub_id,
        "user_id": current_user["id"],
        "username": current_user.get("username"),
        "doc_type": doc_type if doc_type in ("id_card", "passport", "residence_permit") else "id_card",
        "content_type": file.content_type or "image/jpeg",
        "document_enc": document_enc,   # CHIFFRÉ — purgé après décision
        "selfie_enc": selfie_enc,       # CHIFFRÉ — purgé après décision
        "has_selfie": bool(selfie_enc),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"verification_status": "pending"}})
    # Prévient les admins (push même déconnectés). Best-effort.
    await _notify_admins_new_verification(current_user.get("username") or "Un utilisateur")
    return {"submitted": True, "status": "pending"}


# ---- Niveau 3 : monétisation (identité vérifiée requise) -------------------
async def require_identity_verified(current_user: dict):
    """À appeler avant d'activer tips/abonnements/retraits. Lève 403 sinon."""
    u = await db.users.find_one({"id": current_user["id"]}, {"is_verified": 1})
    if not (u or {}).get("is_verified"):
        raise HTTPException(
            status_code=403,
            detail="Vérification d'identité requise pour la monétisation (tips, abonnements, retraits).",
        )
    return True


@api_router.get("/verify/can-monetize")
async def verify_can_monetize(current_user: dict = Depends(get_current_user)):
    """Le compte peut-il activer la monétisation ? (identité vérifiée + KYC Stripe)."""
    u = await db.users.find_one({"id": current_user["id"]}, {"is_verified": 1}) or {}
    verified = bool(u.get("is_verified"))
    return {
        "allowed": verified,
        "identity_verified": verified,
        "reason": None if verified else "Vérifiez votre identité (pièce d'identité) pour débloquer la monétisation.",
        "next_step": None if verified else "identity",
    }


# ---- Revue ADMIN -----------------------------------------------------------
@api_router.get("/admin/verifications")
async def admin_list_verifications(status: str = "pending", current_user: dict = Depends(get_current_user)):
    if not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    status = status if status in ("pending", "verified", "rejected") else "pending"
    rows = await db.identity_submissions.find(
        {"status": status},
        {"id": 1, "user_id": 1, "username": 1, "doc_type": 1, "content_type": 1,
         "has_selfie": 1, "status": 1, "created_at": 1},  # JAMAIS les documents ici
    ).sort("created_at", -1).limit(100).to_list(length=100)
    return [convert_mongo_doc_to_dict(r) for r in rows]


@api_router.get("/admin/verifications/{sub_id}/document")
async def admin_get_verification_document(sub_id: str, kind: str = "document",
                                          current_user: dict = Depends(get_current_user)):
    """Renvoie la pièce (kind=document) ou le selfie (kind=selfie) déchiffré,
    pour la revue (admin uniquement)."""
    if not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    sub = await db.identity_submissions.find_one({"id": sub_id})
    field = "selfie_enc" if kind == "selfie" else "document_enc"
    if not sub or not sub.get(field):
        raise HTTPException(status_code=404, detail="Média indisponible (déjà purgé ou introuvable).")
    try:
        raw = base64.b64decode(decrypt(sub[field]))
    except Exception:
        raise HTTPException(status_code=500, detail="Déchiffrement impossible.")
    return Response(content=raw, media_type=sub.get("content_type") or "image/jpeg")


@api_router.post("/admin/verifications/{sub_id}/approve")
async def admin_approve_verification(sub_id: str, current_user: dict = Depends(get_current_user)):
    if not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    sub = await db.identity_submissions.find_one({"id": sub_id})
    if not sub:
        raise HTTPException(status_code=404, detail="Soumission introuvable")
    await db.users.update_one({"id": sub["user_id"]}, {"$set": {
        "verification_status": "verified", "is_verified": True, "age_verified": True}})
    # Minimisation RGPD : on PURGE la pièce + le selfie après validation.
    await db.identity_submissions.update_one({"id": sub_id}, {
        "$set": {"status": "verified", "reviewed_at": datetime.now(timezone.utc).isoformat()},
        "$unset": {"document_enc": "", "selfie_enc": ""}})
    # Prévient l'utilisateur (push même déconnecté + temps réel + notif in-app).
    uid = sub["user_id"]
    try:
        await send_web_push(uid, "Nexus Social", "Ton identité a été vérifiée ✓ Badge activé.",
                            "/profil/" + uid, tag="verif-result")
    except Exception:
        pass
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid, "type": "verification_approved",
            "from_user_id": "", "from_username": "Nexus Social", "content": "Ton identité a été vérifiée ✓",
            "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await push_realtime(uid, {"type": "verification_approved"})
    except Exception:
        pass
    return {"status": "verified"}


@api_router.post("/admin/verifications/{sub_id}/reject")
async def admin_reject_verification(sub_id: str, data: RejectIn, current_user: dict = Depends(get_current_user)):
    if not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    sub = await db.identity_submissions.find_one({"id": sub_id})
    if not sub:
        raise HTTPException(status_code=404, detail="Soumission introuvable")
    reason = (data.reason or "Document non conforme")[:300]
    await db.users.update_one({"id": sub["user_id"]}, {"$set": {"verification_status": "rejected"}})
    await db.identity_submissions.update_one({"id": sub_id}, {
        "$set": {"status": "rejected", "rejection_reason": reason,
                 "reviewed_at": datetime.now(timezone.utc).isoformat()},
        "$unset": {"document_enc": "", "selfie_enc": ""}})  # purge aussi en cas de refus
    # Prévient l'utilisateur : push (même déconnecté) + notif in-app + temps réel
    # (le front affichera un pop-up bloquant l'invitant à recommencer).
    uid = sub["user_id"]
    try:
        await send_web_push(uid, "Nexus Social",
                            f"Vérification refusée : {reason}. Merci de recommencer.",
                            "/settings", tag="verif-result")
    except Exception:
        pass
    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid, "type": "verification_rejected",
            "from_user_id": "", "from_username": "Nexus Social", "content": f"Vérification refusée : {reason}",
            "reason": reason, "url": "/settings", "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await push_realtime(uid, {"type": "verification_rejected", "reason": reason})
    except Exception:
        pass
    return {"status": "rejected"}

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

# Routeurs extraits par domaine (refactor progressif — voir routers/).
try:
    try:
        from backend.routers.growth import router as growth_router
    except ImportError:
        from routers.growth import router as growth_router
    app.include_router(growth_router)
    print("✅ Growth router registered")
except Exception as e:
    print(f"⚠️ Growth router non enregistré : {e}")

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
async def _startup_warmup():
    """Réchauffe la base EN TÂCHE DE FOND : ping + création d'index.

    IMPORTANT (cold start Render) : on ne bloque PAS le démarrage avec ces
    opérations. Uvicorn devient « prêt » immédiatement et peut répondre aux
    requêtes pendant que la base se connecte — ce qui réduit la fenêtre de
    502 après un réveil du service.
    """
    try:
        await client.admin.command('ping')
        logger.info("✅ MongoDB connection successful")
    except Exception as e:
        # Motor se connecte de toute façon paresseusement à la 1re requête :
        # on n'interrompt PAS le démarrage (sinon boucle de redémarrage Render).
        logger.warning(f"MongoDB ping différé (connexion paresseuse): {e}")
    # Index (idempotents) — best-effort, n'empêchent jamais de servir.
    try:
        await db.clip_views.create_index(
            [("clip_id", 1), ("user_id", 1)], unique=True, name="uniq_clip_user"
        )
    except Exception as e:
        logger.warning(f"Index clip_views non créé (peut déjà exister): {e}")
    try:
        await db.push_subscriptions.create_index("endpoint", unique=True, name="uniq_endpoint")
        await db.push_subscriptions.create_index("user_id", name="by_user")
    except Exception as e:
        logger.warning(f"Index push_subscriptions non créé (peut déjà exister): {e}")
    try:
        # Temps d'écran : 1 total par (utilisateur, jour) — lecture/écriture ciblée.
        await db.screen_time.create_index([("user_id", 1), ("day", 1)], unique=True, name="uniq_user_day")
    except Exception as e:
        logger.warning(f"Index screen_time non créé (peut déjà exister): {e}")
    try:
        # Vérification d'identité : 1 code OTP par (user, canal) ; revue par statut.
        await db.verification_codes.create_index([("user_id", 1), ("kind", 1)], unique=True)
        await db.identity_submissions.create_index([("status", 1), ("created_at", -1)])
        await db.identity_submissions.create_index("user_id")
    except Exception as e:
        logger.warning(f"Index vérification non créé (peut déjà exister): {e}")
    try:
        # Index de TRI des publications : sans eux, MongoDB trie en mémoire et
        # dépasse la limite 32 Mo dès que des médias base64 gonflent les documents
        # (erreur 292 → profil/clips en 500). Ces index rendent les tris « couverts ».
        await db.posts.create_index([("author_id", 1), ("pinned", -1), ("created_at", -1)], name="by_author_pinned_recent")
        await db.posts.create_index([("media_type", 1), ("created_at", -1)], name="by_type_recent")
        await db.posts.create_index([("media_type", 1), ("likes_count", -1)], name="by_type_likes")
        await db.posts.create_index([("created_at", -1)], name="by_recent")
        # Tri « Pour vous / Recommandé » par engagement : un index likes_count
        # AUTONOME (pas seulement le compound media_type+likes_count, dont
        # likes_count n'est pas le préfixe) rend le tri du pool « top » couvert
        # → plus de tri en mémoire, plus d'erreur 292 sur documents base64.
        await db.posts.create_index([("likes_count", -1)], name="by_likes")
    except Exception as e:
        logger.warning(f"Index posts (tri) non créé (peut déjà exister): {e}")

    # ── Abonnements : rétro-compatibilité + index ────────────────────────────
    # Anciens abonnements créés sans champ `status` → "following". Plusieurs fils
    # (Abonnements, Pour vous, Clips) et le calcul des abonnements filtrent sur
    # status="following" ; sans ce champ, un abonnement existant serait invisible
    # (fil vide) et un compte privé suivi resterait masqué à tort. Idempotent :
    # ne modifie que les documents dépourvus du champ.
    try:
        res = await db.follows.update_many(
            {"status": {"$exists": False}}, {"$set": {"status": "following"}}
        )
        if getattr(res, "modified_count", 0):
            logger.info(f"Backfill follows.status → following : {res.modified_count} document(s)")
    except Exception as e:
        logger.warning(f"Backfill follows.status ignoré: {e}")
    try:
        await db.follows.create_index([("follower_id", 1), ("status", 1)], name="by_follower_status")
        await db.follows.create_index([("followed_id", 1), ("status", 1)], name="by_followed_status")
    except Exception as e:
        logger.warning(f"Index follows non créé (peut déjà exister): {e}")

    # ── Index de PERFORMANCE critiques ──────────────────────────────────────
    # Sans eux, chaque recherche par `id` (UUID) ou par clé de relation faisait
    # un SCAN COMPLET de la collection. Or on cherche users/posts par `id` à
    # CHAQUE requête authentifiée (get_current_user), à chaque enrichissement de
    # fil, like, notif, story… → ralentissement massif quand les données
    # grossissent. create_index est idempotent (ne recrée pas un index existant).
    async def _safe_index(coll, keys, **kw):
        try:
            await coll.create_index(keys, **kw)
        except Exception as e:
            logger.warning(f"Index {getattr(coll, 'name', '?')} {keys} non créé: {e}")

    # Recherches par identifiant (les plus fréquentes de toute l'app).
    await _safe_index(db.users, "id", name="by_id")
    await _safe_index(db.posts, "id", name="by_id")
    await _safe_index(db.stories, "id", name="by_id")
    # Éligibilité pourboires / Premium (enrichissement des fils).
    await _safe_index(db.users, "stripe_account_id", name="by_stripe")
    await _safe_index(db.users, "is_premium", name="by_premium")
    # Relations d'abonnement (les deux schémas).
    await _safe_index(db.follows, "follower_id", name="by_follower")
    await _safe_index(db.follows, "followed_id", name="by_followed")
    await _safe_index(db.follows, "following_id", name="by_following")
    # Likes / commentaires (enrichissement is_liked, compteurs).
    await _safe_index(db.likes, [("post_id", 1), ("user_id", 1)], name="by_post_user")
    await _safe_index(db.likes, "user_id", name="by_user")
    await _safe_index(db.comments, "post_id", name="by_post")
    # Stories (fil + purge des expirées).
    await _safe_index(db.stories, [("author_id", 1), ("expires_at", -1)], name="by_author_exp")
    await _safe_index(db.stories, "expires_at", name="by_exp")
    # TTL : purge automatique des stories expirées (Mongo supprime le document dès
    # que `expire_dt` <= maintenant). Champ Date dédié (le string `expires_at` ne
    # peut pas servir de TTL). expireAfterSeconds=0 → suppression à l'échéance.
    await _safe_index(db.stories, "expire_dt", name="ttl_expire", expireAfterSeconds=0)
    await _safe_index(db.story_views, [("story_id", 1), ("user_id", 1)], name="by_story_user")
    # Notifications, enregistrements, pourboires.
    await _safe_index(db.notifications, [("user_id", 1), ("created_at", -1)], name="by_user_recent")
    await _safe_index(db.saved_posts, [("user_id", 1), ("post_id", 1)], name="by_user_post")
    await _safe_index(db.tips, [("creator_id", 1), ("created_at", -1)], name="by_creator_recent")
    # Messages directs (fil de conversation).
    await _safe_index(db.messages, [("recipient_id", 1), ("sender_id", 1), ("created_at", -1)], name="by_convo")
    await _safe_index(db.messages, [("sender_id", 1), ("recipient_id", 1), ("created_at", -1)], name="by_convo_rev")
    logger.info("✅ Index de performance (id/relations) vérifiés/créés")


async def _keep_alive_loop():
    """Auto-ping régulier pour empêcher l'hébergeur d'endormir le service (scale
    to zero) → plus de « cold start » de 20-30 s au réveil (status 0 côté front,
    bannière « Le serveur se réveille… »).

    URL publique cherchée dans, par ordre de priorité :
      • SELF_PING_URL / KEEP_ALIVE_URL / PUBLIC_BASE_URL (générique, ex. Cloud Run)
      • RENDER_EXTERNAL_URL (fourni automatiquement par Render)
    En local (aucune variable), la boucle ne fait rien.

    ⚠️ Sur Cloud Run, un self-ping garde chaude une instance DÉJÀ démarrée pendant
    les périodes d'activité, mais ne réveille pas une instance déjà tombée à zéro.
    Pour supprimer TOTALEMENT les cold starts : `min-instances=1` (voir README) ou
    un pinger externe (Cloud Scheduler / UptimeRobot) sur /healthz.

    Best-effort : les échecs sont ignorés. Intervalle réglable via
    KEEP_ALIVE_SECONDS (défaut 300 s = 5 min)."""
    base = ""
    for var in ("SELF_PING_URL", "KEEP_ALIVE_URL", "PUBLIC_BASE_URL", "RENDER_EXTERNAL_URL"):
        val = (os.environ.get(var) or "").strip()
        if val:
            base = val.rstrip("/")
            break
    if not base:
        logger.info("ℹ️ Keep-alive désactivé (définir SELF_PING_URL avec l'URL publique pour l'activer)")
        return
    ping_url = base + "/healthz"
    try:
        interval = max(60, int(os.environ.get("KEEP_ALIVE_SECONDS", "300")))
    except ValueError:
        interval = 300
    import urllib.request
    logger.info(f"✅ Keep-alive actif : ping {ping_url} toutes les {interval}s")

    def _ping():
        try:
            with urllib.request.urlopen(ping_url, timeout=30) as r:
                r.read()
        except Exception:
            pass

    while True:
        await asyncio.sleep(interval)
        try:
            await asyncio.to_thread(_ping)
        except Exception:
            pass


async def _ensure_stable_cipher():
    """Garantit une clé de chiffrement STABLE, même sans ENCRYPTION_KEY définie.

    Sans clé stable, les pièces d'identité chiffrées deviennent ILLISIBLES après
    un redémarrage — ou depuis une autre instance (Cloud Run peut en lancer
    plusieurs). L'admin voit alors « Indisponible » et ne peut jamais valider →
    l'utilisateur reste bloqué « en attente ». On persiste donc UNE clé en base
    (partagée par toutes les instances, conservée entre les déploiements) et on
    l'utilise pour (dé)chiffrer. Si ENCRYPTION_KEY est fournie, elle prime."""
    global cipher
    if _encryption_key:
        return  # clé d'environnement = déjà stable, on n'y touche pas
    try:
        doc = await asyncio.wait_for(db.app_secrets.find_one({"_id": "encryption_key"}), timeout=10)
        if doc and doc.get("key"):
            cipher = Fernet(doc["key"].encode())
            logger.info("✅ Clé de chiffrement stable chargée depuis la base")
            return
        # Aucune clé encore stockée : on en génère une et on la persiste. Le
        # $setOnInsert + relecture gère la course entre plusieurs instances
        # (une seule clé « gagne », toutes les instances la relisent ensuite).
        key = Fernet.generate_key().decode()
        await db.app_secrets.update_one(
            {"_id": "encryption_key"},
            {"$setOnInsert": {"key": key, "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        doc = await db.app_secrets.find_one({"_id": "encryption_key"})
        cipher = Fernet((doc.get("key") if doc else key).encode())
        logger.info("✅ Clé de chiffrement stable générée et persistée en base")
    except Exception as e:
        logger.warning(f"⚠️ Clé de chiffrement stable indisponible (repli éphémère) : {e}")


@app.on_event("startup")
async def startup_db_client():
    """Démarrage NON bloquant : on lance le réchauffage DB, la boucle « tendance »
    et le keep-alive en tâches de fond, pour que le serveur réponde tout de suite."""
    # Clé de chiffrement stable AVANT tout (dé)chiffrement (pièces d'identité).
    try:
        await _ensure_stable_cipher()
    except Exception as e:
        logger.warning(f"Init clé de chiffrement différée : {e}")

    try:
        asyncio.create_task(_startup_warmup())
        asyncio.create_task(trending_notifier_loop())
        asyncio.create_task(_keep_alive_loop())
        logger.info("✅ Démarrage : réchauffage DB + trending + keep-alive lancés en fond")
    except Exception as e:
        logger.error(f"Impossible de lancer les tâches de démarrage: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    """Ferme la connexion MongoDB à l'arrêt"""
    client.close()
    logger.info("MongoDB connection closed")
