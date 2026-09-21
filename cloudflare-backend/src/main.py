from fastapi import FastAPI
from workers import asgi

app = FastAPI(title="Nexus Social API", version="0.1.0")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-social-api", "runtime": "cloudflare-workers"}

@app.get("/")
async def root():
    return {"service": "Nexus Social API", "status": "migration-in-progress"}

Default = asgi.entrypoint(app)
