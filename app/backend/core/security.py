"""Sécurité : hachage de mot de passe, JWT et dépendances d'authentification.

Extrait de server.py à l'identique (comportement inchangé). Les routes
importent `get_current_user` / `require_admin` comme dépendances FastAPI.
"""
from datetime import datetime, timedelta, timezone

import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from .config import ADMIN_EMAILS, ALGORITHM, SECRET_KEY
from .database import db
from .serialization import convert_mongo_doc_to_dict

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


def create_access_token(data: dict):
    """Crée un token JWT avec expiration de 7 jours."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Récupère l'utilisateur courant depuis le token JWT."""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Nouveau format : champ "id" (UUID).
        user = await db.users.find_one({"id": user_id})

        # Repli : anciens tokens indexés sur _id (ObjectId).
        if not user:
            try:
                user = await db.users.find_one({"_id": ObjectId(user_id)})
            except Exception:
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
