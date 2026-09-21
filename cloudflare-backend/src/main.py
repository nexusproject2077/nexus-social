from datetime import datetime, timedelta, timezone

import jwt
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from js import Object, Request
from pyodide.ffi import to_js
from workers import asgi, env

app = FastAPI(title="Nexus Social API", version="0.2.2")


class LoginIn(BaseModel):
    email: str
    password: str


async def mongo_post(path: str, payload: dict):
    service = getattr(env, "MONGO_SERVICE", None)
    if service is None:
        raise HTTPException(status_code=503, detail="Database service is not configured")

    init = to_js(
        {
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "body": __import__("json").dumps(payload),
        },
        dict_converter=Object.fromEntries,
    )
    request = Request.new("https://nexus-social-mongo.internal" + path, init)
    response = await service.fetch(request)
    data = await response.json()
    return int(response.status), data


def jwt_secret() -> str:
    secret = getattr(env, "SECRET_KEY", None)
    if not secret:
        raise HTTPException(status_code=503, detail="Authentication secret is not configured")
    return str(secret)


def issue_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "iat": now, "exp": now + timedelta(days=7)},
        jwt_secret(),
        algorithm="HS256",
    )


def bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return authorization.split(" ", 1)[1].strip()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "nexus-social-api",
        "runtime": "cloudflare-workers",
        "mongo_service_configured": bool(getattr(env, "MONGO_SERVICE", None)),
        "secret_key_configured": bool(getattr(env, "SECRET_KEY", None)),
    }


@app.post("/api/auth/login")
async def login(credentials: LoginIn):
    status, data = await mongo_post(
        "/internal/auth/verify",
        {"email": credentials.email.strip().lower(), "password": credentials.password},
    )
    if status == 401:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if status == 403 and data.get("age_blocked"):
        raise HTTPException(status_code=403, detail="Ce compte n'est pas eligible.")
    if status >= 400 or not data.get("authenticated"):
        raise HTTPException(status_code=503, detail="Authentication service unavailable")

    user = data["user"]
    return {"token": issue_token(str(user["id"])), "user": user}


@app.get("/api/auth/me")
async def me(authorization: str | None = Header(default=None)):
    token = bearer_token(authorization)
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    status, data = await mongo_post("/internal/auth/user-by-id", {"id": user_id})
    if status == 404:
        raise HTTPException(status_code=401, detail="User not found")
    if status >= 400 or not data.get("found"):
        raise HTTPException(status_code=503, detail="Authentication service unavailable")
    return data["user"]


@app.get("/")
async def root():
    return {"service": "Nexus Social API", "status": "migration-in-progress"}


Default = asgi.entrypoint(app)
