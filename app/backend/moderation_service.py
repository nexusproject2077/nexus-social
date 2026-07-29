"""
Micro-service de modération — À DÉPLOYER SUR UN VPS (avec assez de RAM).

Il charge les modèles lourds (toxic-bert + NudeNet) et expose une petite API HTTP
que le backend principal (sur Render) appelle. Ainsi Render reste léger, et toute
l'inférence tourne sur le VPS.

Réutilise la logique de moderation.py (mode LOCAL) : sur le VPS, ne définissez PAS
MODERATION_SERVICE_URL (sinon il s'appellerait lui-même).

Lancement (exemple) :
    pip install -r requirements-moderation-service.txt
    export MODERATION_ENABLED=true
    export MODERATION_SERVICE_TOKEN="un-secret-partagé-avec-render"
    gunicorn moderation_service:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8080 --timeout 120

Endpoints :
    GET  /health           -> état + modèles chargés
    POST /moderate/text    -> {"text": "..."}      => verdict
    POST /moderate/media   -> {"data_url": "..."}  => verdict (image ou vidéo)

Sécurité : si MODERATION_SERVICE_TOKEN est défini, chaque requête doit envoyer
l'en-tête  Authorization: Bearer <token>.
"""
import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

import moderation  # même module ; en mode LOCAL ici (MODERATION_SERVICE_URL non défini)

app = FastAPI(title="Nexus Moderation Service", version="1.0.0")

SERVICE_TOKEN = os.environ.get("MODERATION_SERVICE_TOKEN", "")


def _check_auth(authorization: str):
    if SERVICE_TOKEN and authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="Non autorisé")


class TextIn(BaseModel):
    text: str = ""


class MediaIn(BaseModel):
    data_url: str = ""


@app.get("/health")
def health():
    # Déclenche le chargement paresseux pour signaler l'état réel des modèles.
    text_ok = moderation._get_text_pipe() is not None
    nude_ok = moderation._get_nude_detector() is not None
    return {
        "ok": True,
        "enabled": moderation.MODERATION_ENABLED,
        "text_model": text_ok,
        "nsfw_model": nude_ok,
    }


@app.post("/moderate/text")
def moderate_text(body: TextIn, authorization: str = Header(default="")):
    _check_auth(authorization)
    return moderation.moderate_text(body.text)


@app.post("/moderate/media")
def moderate_media(body: MediaIn, authorization: str = Header(default="")):
    _check_auth(authorization)
    return moderation.moderate_media(body.data_url)
