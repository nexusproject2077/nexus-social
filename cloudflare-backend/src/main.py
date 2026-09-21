import asyncio
import os

# PyMongo initializes BSON ObjectId process randomness while importing. Cloudflare
# does not allow entropy during Worker startup, so use a startup-only seed for
# that internal process value, then immediately restore os.urandom. Nexus Social
# does not create ObjectIds in this health check.
_real_urandom = os.urandom
os.urandom = lambda n: b"\x00" * n
try:
    from pymongo import MongoClient
finally:
    os.urandom = _real_urandom

from fastapi import FastAPI
from workers import asgi, env

app = FastAPI(title="Nexus Social API", version="0.1.0")
mongo_lock = asyncio.Lock()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-social-api", "runtime": "cloudflare-workers"}


@app.get("/health/bindings")
async def bindings_health():
    return {
        "mongo_url_configured": bool(getattr(env, "MONGO_URL", None)),
        "db_name": str(getattr(env, "DB_NAME", "nexus_db")),
    }


@app.get("/health/mongodb")
async def mongodb_health():
    mongo_url = getattr(env, "MONGO_URL", None)
    db_name = str(getattr(env, "DB_NAME", "nexus_db"))

    if not mongo_url:
        return {"status": "error", "database": db_name, "detail": "MONGO_URL binding is not configured"}

    client = None
    try:
        # Python Workers expose synchronous socket APIs over Cloudflare's
        # asynchronous TCP implementation. Serialize this read-only probe.
        async with mongo_lock:
            client = MongoClient(
                str(mongo_url),
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                socketTimeoutMS=5000,
            )
            client.admin.command("ping")
            collections = client[db_name].list_collection_names()

        return {
            "status": "ok",
            "database": db_name,
            "connected": True,
            "collection_count": len(collections),
        }
    except Exception as exc:
        return {
            "status": "error",
            "database": db_name,
            "connected": False,
            "error_type": type(exc).__name__,
            "detail": str(exc)[:500],
        }
    finally:
        if client is not None:
            client.close()


@app.get("/")
async def root():
    return {"service": "Nexus Social API", "status": "migration-in-progress"}


Default = asgi.entrypoint(app)
