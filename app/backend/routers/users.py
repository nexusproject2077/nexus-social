from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.hash import bcrypt
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
import os
from datetime import datetime, timedelta
Config
MONGO_URL = os.getenv("MONGO_URL", "mongodb+srv://nexus_api_user:JU0wu9t542tK9Av@nexussocial.a8wimcp.mongodb.net/nexus_db?retryWrites=true&w=majority&appName=nexussocial")
SECRET_KEY = os.getenv("SECRET_KEY","76f267dbc69c6b4e639a50a7ccdd3783")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 1 jour
client = AsyncIOMotorClient(MONGO_URL)
db = client.get_database("nexus_db")
user_router = APIRouter(prefix="/users", tags=["users"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="users/login")
Modèles
class UserIn(BaseModel):
username: str = Field(..., min_length=3)
email: EmailStr
password: str = Field(..., min_length=6)
class UserOut(BaseModel):
username: str
email: EmailStr
class Token(BaseModel):
access_token: str
token_type: str
Fonctions utilitaires
async def get_user_by_email(email: str):
return await db.users.find_one({"email": email})
async def authenticate_user(email: str, password: str):
user = await get_user_by_email(email)
if not user:
    return False
if not bcrypt.verify(password, user["password"]):
    return False
return user
def create_access_token(data: dict, expires_delta: timedelta = None):
to_encode = data.copy()
expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
to_encode.update({"exp": expire})
encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
return encoded_jwt
async def get_current_user(token: str = Depends(oauth2_scheme)):
credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Token invalide",
    headers={"WWW-Authenticate": "Bearer"},
)
try:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    email = payload.get("sub")
    if email is None:
        raise credentials_exception
except JWTError:
    raise credentials_exception
user = await get_user_by_email(email)
if user is None:
    raise credentials_exception
return user
Routes
@user_router.post("/register", response_model=UserOut)
async def register(user: UserIn):
if await get_user_by_email(user.email):
    raise HTTPException(status_code=400, detail="Email déjà utilisé")
hashed_password = bcrypt.hash(user.password)
user_doc = {"username": user.username, "email": user.email, "password": hashed_password}
await db.users.insert_one(user_doc)
return {"username": user.username, "email": user.email}
@user_router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
user = await authenticate_user(form_data.username, form_data.password)
if not user:
    raise HTTPException(status_code=400, detail="Email ou mot de passe incorrect")
access_token = create_access_token(data={"sub": user["email"]})
return {"access_token": access_token, "token_type": "bearer"}
@user_router.get("/me", response_model=UserOut)
async def read_users_me(current_user: dict = Depends(get_current_user)):
return {"username": current_user["username"], "email": current_user["email"]}
Route test
@user_router.get("/ping")
async def ping():
return {"status": "ok"}
