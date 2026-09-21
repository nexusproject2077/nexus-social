from fastapi import FastAPI
from workers import asgi, env

app = FastAPI(title="Nexus Social API", version="0.1.0")


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

    # PyMongo cannot currently be imported at Worker startup because BSON
    # initializes secure randomness, which Cloudflare forbids during snapshot
    # creation. Importing it from this async ASGI handler also triggers a
    # Pyodide nested-promising-task failure, so keep production deployable while
    # the database adapter is replaced/tested separately.
    return {
        "status": "blocked",
        "database": db_name,
        "connected": False,
        "detail": "PyMongo is not compatible with this Python Worker execution path",
    }


@app.get("/")
async def root():
    return {"service": "Nexus Social API", "status": "migration-in-progress"}


Default = asgi.entrypoint(app)
