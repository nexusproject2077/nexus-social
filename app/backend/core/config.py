"""Configuration centralisée — point unique de lecture de l'environnement.

En développement, charge le `.env` du dossier backend ; en production
(Cloud Run) les variables viennent de l'environnement du conteneur.

Première brique du refactor progressif : le reste du code importe ces
constantes au lieu de relire `os.environ` un peu partout.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Ce fichier est dans .../backend/core/ → le dossier backend est deux niveaux
# au-dessus.
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# --- MongoDB ---
MONGO_URL = (
    os.environ.get("MONGODB_URI")
    or os.environ.get("MONGO_URL")
    or os.environ.get("DATABASE_URL")
)
DB_NAME = os.environ.get("DB_NAME", "nexus_social")

# --- Sécurité / JWT ---
SECRET_KEY = os.environ.get("SECRET_KEY", "76f267dbc69c6b4e639a50a7ccdd3783")
ALGORITHM = "HS256"

# Comptes administrateurs (emails séparés par des virgules), exposés via
# `is_admin` sur /auth/me. Optionnel.
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
}
