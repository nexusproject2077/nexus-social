from fastapi 
import APIRouter, HTTPException, status, Depends
from pydantic 
import BaseModel, EmailStr, Fieldfrom motor.motor_asyncio import AsyncIOMotorClientfrom passlib.hash import bcryptfrom jose import JWTError, jwtimport osfrom datetime import datetime, timedeltafrom typing import Optional
# ================= CONFIG =================
MONGO_URL = os.getenv(    "MONGO_URL",    "mongodb+srv://nexus_api_user:JU0wu9t542tK9Av@nexussocial.a8wimcp.mongodb.net/nexus_db?retryWrites=true&w=majority")SECRET_KEY = os.getenv("SECRET_KEY", "76f267dbc69c6b4e639a50a7ccdd3783")ALGORITHM = "HS256"ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 1 jour
client = AsyncIOMotorClient(MONGO_URL)db = client.get_database("nexus_db")
user_router = APIRouter(prefix="/users", tags=["users"])

# ================= MODELS =================
class UserIn(BaseModel):    username: str = Field(..., min_length=3)    email: EmailStr    phone: Optional[str] = None    password: str = Field(..., min_length=6)

class LoginModel(BaseModel):    identifier: str # email OR username OR phone      password: str

class UserOut(BaseModel):    username: str    email: EmailStr    phone: Optional[str] = None

class Token(BaseModel):    access_token: str    token_type: str

# ================== UTILS ==================
async def get_user(identifier: str):    return await db.users.find_one({        "$or": [            {"email": identifier},            {"username": identifier},            {"phone": identifier},        ]    })

async def authenticate_user(identifier: str, password: str):    user = await get_user(identifier)    if not user:        return False    if not bcrypt.verify(password, user["password"]):        return False    return user

def create_access_token(data: dict, expires_delta: timedelta = None):    to_encode = data.copy()    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))    to_encode.update({"exp": expire})    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends()):    try:        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])        email = payload.get("sub")        if not email:            raise HTTPException(status_code=401, detail="Token invalide")    except JWTError:        raise HTTPException(status_code=401, detail="Token invalide")
    user = await db.users.find_one({"email": email})    if not user:        raise HTTPException(status_code=401, detail="Utilisateur introuvable")    return user

# ================= ROUTES ==================
# -------- REGISTER --------@user_router.post("/register", response_model=UserOut)async def register(user: UserIn):
    # Vérifier email / username / phone uniques    existing = await db.users.find_one({        "$or": [            {"email": user.email},            {"username": user.username},            {"phone": user.phone}        ]    })
    if existing:        raise HTTPException(status_code=400, detail="Email, username ou numéro déjà utilisé")
    hashed_password = bcrypt.hash(user.password)
    user_doc = {        "username": user.username,        "email": user.email,        "phone": user.phone,        "password": hashed_password,        "created_at": datetime.utcnow().isoformat()    }
    await db.users.insert_one(user_doc)
    return {        "username": user.username,        "email": user.email,        "phone": user.phone    }

# -------- LOGIN (email OR username OR phone) --------@user_router.post("/login", response_model=Token)async def login(credentials: LoginModel):
    user = await authenticate_user(credentials.identifier, credentials.password)
    if not user:        raise HTTPException(status_code=400, detail="Identifiants incorrects")
    token = create_access_token({"sub": user["email"]})
    return {"access_token": token, "token_type": "bearer"}

# -------- GET PROFILE --------@user_router.get("/me", response_model=UserOut)async def read_me(current_user: dict = Depends(get_current_user)):
    return {        "username": current_user["username"],        "email": current_user["email"],        "phone": current_user.get("phone")    }

# -------- PING --------@user_router.get("/ping")async def ping():    return {"status": "ok"}
