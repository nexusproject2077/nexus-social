import os

from fastapi import FastAPI
from pymongo import MongoClient
from workers import asgi

app = FastAPI(title="Nexus Social API", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-social-api", "runtime": "cloudflare-workers"}


@app.get("/health/mongodb")
async def mongodb_health():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "nexus_db")

    if not mongo_url:
        return {"status": "error", "database": db_name, "detail": "MONGO_URL is not configured"}

    client = None
    try:
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)
        client.admin.command("ping")
        collections = client[db_name].list_collection_names()
        return {
            "status": "ok",
            "database": db_name,
            "connected": True,
            "collections_count": len(collections),
        }
    except Exception as exc:
        return {
            "status": "error",
            "database": db_name,
            "connected": False,
            "error_type": type(exc).__name__,
        }
    finally:
        if client is not None:
            client.close()


@app.get("/")
async def root():
    return {"service": "Nexus Social API", "status": "migration-in-progress"}


Default = asgi.entrypoint(app)
