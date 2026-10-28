"""Connexion MongoDB (client Motor + handle `db`) — source unique.

Reprend à l'identique la validation d'URI qui existait dans server.py, mais
au même endroit pour que tous les modules partagent le MÊME client/handle.
"""
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import InvalidURI

from .config import DB_NAME, MONGO_URL

if not MONGO_URL:
    raise ValueError(
        "❌ MongoDB URL non configurée ! "
        "Définis MONGODB_URI, MONGO_URL ou DATABASE_URL dans l'environnement."
    )

if not (MONGO_URL.startswith("mongodb://") or MONGO_URL.startswith("mongodb+srv://")):
    raise InvalidURI(
        "Schéma d'URI MongoDB invalide : l'URI doit commencer par "
        f"'mongodb://' ou 'mongodb+srv://'. Actuel : {MONGO_URL[:20]}"
    )

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
print(f"✅ MongoDB client initialisé — base : {DB_NAME}")
