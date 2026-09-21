from datetime import datetime, timedelta, timezone
import hashlib
import json
import secrets

import jwt
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from js import Object, Request, fetch
from pyodide.ffi import to_js
from workers import asgi, env

app = FastAPI(title="Nexus Social API", version="0.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://nexus-social.merickoken54.workers.dev"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginIn(BaseModel):
    email: str
    password: str


class TwoFAIn(BaseModel):
    email: str
    code: str


def otp_hash(code: str) -> str:
    return hashlib.sha256(("nexus-otp:" + str(code)).encode()).hexdigest()


async def send_brevo_email(to_email: str, subject: str, html_content: str) -> None:
    api_key = getattr(env, "BREVO_API_KEY", None)
    if not api_key:
        raise HTTPException(status_code=503, detail="Email service is not configured")
    sender_email = str(getattr(env, "BREVO_SENDER_EMAIL", "noreply@nexussocial.com"))
    sender_name = str(getattr(env, "BREVO_SENDER_NAME", "Nexus Social"))
    init = to_js({
        "method": "POST",
        "headers": {"Content-Type": "application/json", "api-key": str(api_key), "accept": "application/json"},
        "body": json.dumps({"sender": {"email": sender_email, "name": sender_name}, "to": [{"email": to_email}], "subject": subject, "htmlContent": html_content}),
    }, dict_converter=Object.fromEntries)
    response = await fetch("https://api.brevo.com/v3/smtp/email", init)
    if int(response.status) >= 400:
        try:
            error_body = await response.text()
        except Exception:
            error_body = ""
        print(f"Brevo rejected email: status={int(response.status)} body={error_body[:1000]}")
        raise HTTPException(status_code=503, detail="Unable to send authentication email")
    print(f"Brevo accepted authentication email: status={int(response.status)}")


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
    # Yield immediately while the bound JS Worker performs MongoDB I/O.
    # Using the binding's fetch directly through Pyodide can burn Python Worker
    # CPU while several feed requests are in flight.
    response = await service.fetch(request)
    try:
        body = await response.text()
        data = json.loads(body) if body else {}
    except Exception:
        data = {}
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
    if status == 428 and data.get("twofa_required"):
        email = str(data.get("email") or credentials.email).strip().lower()
        code = f"{secrets.randbelow(1_000_000):06d}"
        expires = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        otp_status, _ = await mongo_post("/internal/auth/otp/issue", {"email": email, "kind": "2fa", "code_hash": otp_hash(code), "expires_at": expires})
        if otp_status >= 400:
            raise HTTPException(status_code=503, detail="Unable to create authentication code")
        await send_brevo_email(email, "Ton code de connexion Nexus Social", f"<p>Voici ton code de connexion :</p><p style=\'font-size:26px;font-weight:bold;letter-spacing:4px\'>{code}</p><p>Ce code expire dans 10 minutes. Si ce n\'est pas toi, change ton mot de passe.</p>")
        return {"twofa_required": True, "email": email}
    if status >= 400 or not data.get("authenticated"):
        raise HTTPException(status_code=503, detail="Authentication service unavailable")

    user = data["user"]
    return {"token": issue_token(str(user["id"])), "user": user}


@app.post("/api/auth/login/2fa")
async def login_2fa(data: TwoFAIn):
    code = (data.code or "").strip()
    if len(code) != 6 or not code.isdigit():
        raise HTTPException(status_code=400, detail="Code invalide ou expire.")
    status, result = await mongo_post("/internal/auth/otp/verify", {"email": data.email.strip().lower(), "kind": "2fa", "code_hash": otp_hash(code)})
    if status >= 400 or not result.get("valid"):
        raise HTTPException(status_code=400, detail="Code invalide ou expire.")
    user = result["user"]
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


def current_user_id(authorization: str | None) -> str:
    token = bearer_token(authorization)
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return str(user_id)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


async def mongo_data(path: str, payload: dict):
    status, data = await mongo_post(path, payload)
    if status == 401:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if status >= 400:
        raise HTTPException(status_code=503, detail="Database service unavailable")
    return data


@app.get("/api/feed/foryou")
async def feed_foryou(skip: int = 0, limit: int = 10, mode: str = "reco", authorization: str | None = Header(default=None)):
    user_id = current_user_id(authorization)
    return await mongo_data("/internal/feed/foryou", {"user_id": user_id, "skip": skip, "limit": limit, "mode": mode})


@app.get("/api/posts/feed")
async def posts_feed(skip: int = 0, limit: int = 10, authorization: str | None = Header(default=None)):
    user_id = current_user_id(authorization)
    return await mongo_data("/internal/feed/following", {"user_id": user_id, "skip": skip, "limit": limit})


@app.get("/api/stories/feed")
async def stories_feed(authorization: str | None = Header(default=None)):
    user_id = current_user_id(authorization)
    return await mongo_data("/internal/stories/feed", {"user_id": user_id})


@app.get("/api/badges")
async def badges(authorization: str | None = Header(default=None)):
    user_id = current_user_id(authorization)
    return await mongo_data("/internal/badges", {"user_id": user_id})



@app.get("/api/users/{user_id}")
async def user_profile(user_id: str, authorization: str | None = Header(default=None)):
    viewer_id = current_user_id(authorization)
    return await mongo_data("/internal/users/profile", {"user_id": user_id, "viewer_id": viewer_id})


@app.get("/api/users/{user_id}/stats")
async def user_stats(user_id: str, authorization: str | None = Header(default=None)):
    current_user_id(authorization)
    return await mongo_data("/internal/users/stats", {"user_id": user_id})


@app.get("/api/users/{user_id}/posts")
async def user_posts(user_id: str, authorization: str | None = Header(default=None)):
    viewer_id = current_user_id(authorization)
    return await mongo_data("/internal/users/posts", {"user_id": user_id, "viewer_id": viewer_id})


@app.get("/api/geo/language")
async def geo_language():
    return {"country": None, "language": "en", "supported": ["ar","de","en","es","fr","it","ja","ko","pt","ru","tr","zh"]}


@app.get("/api/geo/status")
async def geo_status():
    return {"profile": "GLOBAL_STANDARD", "country": None, "eu": False, "restricted": False, "read_only": False, "read_only_message": None, "min_age": 13, "consent_style": "standard", "suggested_language": "en"}


@app.get("/api/users/search")
async def users_search(q: str = "", authorization: str | None = Header(default=None)):
    uid=current_user_id(authorization)
    return await mongo_data("/internal/users/search", {"user_id":uid,"q":q})


@app.get("/api/users/me/profile-views")
async def profile_views(authorization: str | None = Header(default=None)):
    uid=current_user_id(authorization)
    return await mongo_data("/internal/users/profile-views", {"user_id":uid})


@app.get("/api/trending/hashtags")
async def trending_hashtags(limit: int = 10, authorization: str | None = Header(default=None)):
    current_user_id(authorization)
    return await mongo_data("/internal/trending/hashtags", {"limit":limit})


@app.post("/api/users/me/sessions/start")
async def session_start(authorization: str | None = Header(default=None)):
    uid=current_user_id(authorization)
    return await mongo_data("/internal/sessions/start", {"user_id":uid})


@app.post("/api/users/me/sessions/{session_id}/ping")
async def session_ping(session_id: str, authorization: str | None = Header(default=None)):
    uid=current_user_id(authorization)
    return await mongo_data("/internal/sessions/ping", {"user_id":uid,"session_id":session_id})


class SessionEnd(BaseModel):
    duration: float = 0


@app.post("/api/users/me/sessions/{session_id}/end")
async def session_end(session_id: str, data: SessionEnd, authorization: str | None = Header(default=None)):
    uid=current_user_id(authorization)
    return await mongo_data("/internal/sessions/end", {"user_id":uid,"session_id":session_id,"duration":data.duration})


class ScreenTimeAdd(BaseModel):
    day: str | None = None
    delta_seconds: float = 0


@app.post("/api/users/me/screen-time")
async def screen_time_add(data: ScreenTimeAdd, authorization: str | None = Header(default=None)):
    uid=current_user_id(authorization)
    return await mongo_data("/internal/screen-time/add", {"user_id":uid,"day":data.day,"delta_seconds":data.delta_seconds})



@app.get("/api/analytics/me/stats")
async def analytics_stats(authorization: str | None = Header(default=None)):
    return await mongo_data("/internal/analytics/stats", {"user_id": current_user_id(authorization)})


@app.get("/api/analytics/me/trends")
async def analytics_trends(days: int = 30, authorization: str | None = Header(default=None)):
    return await mongo_data("/internal/analytics/trends", {"user_id": current_user_id(authorization), "days": max(1,min(365,days))})


@app.get("/api/live/active")
async def live_active(authorization: str | None = Header(default=None)):
    return await mongo_data("/internal/live/active", {"user_id": current_user_id(authorization)})


@app.get("/api/weather")
async def weather(lat: float, lon: float, authorization: str | None = Header(default=None)):
    current_user_id(authorization)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="Coordonnées invalides")
    import json
    from js import fetch
    u = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto"
    try:
        r = await fetch(u)
        return {"weather": json.loads(await r.text()) if r.ok else None}
    except Exception:
        return {"weather": None}


FINANCE_CATALOG = {
    "bitcoin":{"symbol":"BTC","name":"Bitcoin"},"ethereum":{"symbol":"ETH","name":"Ethereum"},
    "solana":{"symbol":"SOL","name":"Solana"},"cardano":{"symbol":"ADA","name":"Cardano"},
    "dogecoin":{"symbol":"DOGE","name":"Dogecoin"}
}


@app.get("/api/finance")
async def finance(ids: str = "bitcoin,ethereum,solana", authorization: str | None = Header(default=None)):
    current_user_id(authorization)
    import json
    from js import fetch
    want=[x.strip() for x in ids.split(",") if x.strip()][:10]
    try:
        u="https://api.coingecko.com/api/v3/simple/price?ids="+",".join(want)+"&vs_currencies=eur&include_24hr_change=true"
        r=await fetch(u); raw=json.loads(await r.text()) if r.ok else {}
        assets=[{"id":x,**FINANCE_CATALOG.get(x,{"symbol":x.upper(),"name":x}),"price":raw.get(x,{}).get("eur"),"change_24h":raw.get(x,{}).get("eur_24h_change")} for x in want]
    except Exception:
        assets=[]
    return {"assets":assets,"catalog":FINANCE_CATALOG}


@app.get("/api/livescores")
async def livescores(authorization: str | None = Header(default=None)):
    current_user_id(authorization)
    import json
    from js import fetch
    matches=[]
    leagues=["eng.1","esp.1","ger.1","ita.1","fra.1","tur.1","uefa.champions"]
    try:
        for league in leagues:
            r=await fetch(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard")
            if not r.ok: continue
            data=json.loads(await r.text())
            for ev in data.get("events",[]):
                comp=(ev.get("competitions") or [{}])[0]; teams=comp.get("competitors") or []
                h=next((x for x in teams if x.get("homeAway")=="home"),{}); a=next((x for x in teams if x.get("homeAway")=="away"),{})
                st=ev.get("status") or {}; typ=st.get("type") or {}
                matches.append({"id":ev.get("id"),"league_slug":league,"home":(h.get("team") or {}).get("displayName"),"away":(a.get("team") or {}).get("displayName"),"home_id":(h.get("team") or {}).get("id"),"away_id":(a.get("team") or {}).get("id"),"home_score":h.get("score"),"away_score":a.get("score"),"state":typ.get("state"),"clock":st.get("displayClock") or "","date":ev.get("date")})
    except Exception:
        pass
    return {"matches":matches[:50],"updated_at":0,"favorites":{"leagues":[],"teams":[]}}


@app.get("/")
async def root():
    return {"service": "Nexus Social API", "status": "migration-in-progress"}


Default = asgi.entrypoint(app)
