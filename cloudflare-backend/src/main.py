from fastapi import FastAPI, Request
from workers import asgi

app = FastAPI(title="Nexus Social API", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-social-api", "runtime": "cloudflare-workers"}


@app.get("/health/mongodb")
async def mongodb_health(request: Request):
    # PyMongo must be imported after Worker startup because BSON initializes
    # ObjectId entropy during import. Cloudflare bindings are exposed through
    # the ASGI request scope, not Python's os.environ.
    from pymongo import MongoClient

    env = request.scope["env"]
    mongo_url = getattr(env, "MONGO_URL", None)
    db_name = getattr(env, "DB_NAME", "nexus_db")

    if not mongo_url:
        return {"status": "error", "database": db_name, "detail": "MONGO_URL binding is not configured"}

    client = None
    try:
        client = MongoClient(str(mongo_url), serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)
        client.admin.command("ping")
        collections = client[str(db_name)].list_collection_names()
        return {
            "status": "ok",
            "database": str(db_name),
            "connected": True,
            "collections_count": len(collections),
        }
    except Exception as exc:
        return {
            "status": "error",
            "database": str(db_name),
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
