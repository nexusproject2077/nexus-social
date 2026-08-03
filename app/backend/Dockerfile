# Image du backend Nexus Social (FastAPI) pour Google Cloud Run.
# Cloud Run injecte la variable PORT (8080 par défaut) : on écoute dessus.
# On lance uvicorn directement (et non gunicorn) car il gère proprement les
# WebSockets (temps réel + lives), essentiels à l'app.
#
# ⚠️ CONTEXTE DE BUILD = RACINE DU DÉPÔT. Le déploiement continu Cloud Run
# (Cloud Build) construit avec la racine du repo comme contexte et ce Dockerfile
# via son chemin `app/backend/Dockerfile`. D'où les COPY préfixés `app/backend/`.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Dépendances Python d'abord (cache Docker efficace).
COPY app/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Code de l'application (server.py + modules locaux : follows, moderation, …).
COPY app/backend/ ./

EXPOSE 8080

# 1 seul worker : l'app garde des états EN MÉMOIRE (salles de live, caches de
# classement, rate-limit) qui supposent un unique process. Pour scaler au-delà,
# il faudra déporter ces états (Redis) — voir MIGRATION.md.
CMD exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 \
    --proxy-headers --forwarded-allow-ips="*"
