import os
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

# Use env var in deployments; keep a dev fallback for local startup.
_ENVIRONMENT = (
    os.getenv("ENVIRONMENT")
    or os.getenv("APP_ENV")
    or os.getenv("NODE_ENV")
    or ""
).lower()
_SECRET_KEY = os.getenv("DEERFLOW_JWT_SECRET_KEY")
if not _SECRET_KEY and _ENVIRONMENT in {"prod", "production"}:
    raise RuntimeError("DEERFLOW_JWT_SECRET_KEY must be set in production")

SECRET_KEY = _SECRET_KEY or "deer-flow-local-dev-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 10080  # 7 天，减少频繁重登录造成的“刷新感”

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None
