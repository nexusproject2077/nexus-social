# Image du backend Nexus Social (FastAPI) pour Google Cloud Run.
# PLACÉ À LA RACINE du dépôt car le déploiement continu Cloud Run/Cloud Build
# cherche le Dockerfile à `/workspace/Dockerfile` (racine), avec la racine du
# dépôt comme contexte de build → d'où les COPY préfixés `app/backend/`.
#
# Cloud Run injecte PORT (8080 par défaut). On lance uvicorn directement (pas
# gunicorn) car il gère proprement les WebSockets (temps réel + lives).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Certificats racine système : indispensables pour la vérification TLS des
# clients HTTP qui utilisent le magasin système (ex. le SDK Stripe via urllib).
# Sans eux, api.stripe.com échoue en « APIConnectionError » sur l'image slim.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
