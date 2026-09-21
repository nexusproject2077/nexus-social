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
    db_name = getattr(env, "DB_NAME", "nexus_db")

    if not mongo_url:
        return {"status": "error", "database": str(db_name), "detail": "MONGO_URL binding is not configured"}

    # PyMongo currently triggers a nested Pyodide promising-task failure when
    # imported/executed inside the FastAPI ASGI request. Keep this endpoint
    # explicit while we validate bindings separately.
    return {
        "status": "blocked",
        "database": str(db_name),
        "connected": False,
        "detail": "MongoDB driver compatibility test pending",
    }


@app.get("/")
async def root():
    return {"service": "Nexus Social API", "status": "migration-in-progress"}


Default = asgi.entrypoint(app)
