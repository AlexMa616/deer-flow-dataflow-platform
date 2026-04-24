from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr

from .models import (
    create_user,
    delete_user,
    get_all_users,
    get_user_by_id,
    get_user_by_username,
    init_db,
    update_last_login,
    update_user_role,
    update_user_status,
)
from .security import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

# 确保数据库初始化
init_db()

# ========== 请求/响应模型 ==========

class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class UserStatusUpdate(BaseModel):
    is_active: bool

class UserRoleUpdate(BaseModel):
    role: str

# ========== 认证依赖 ==========

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="未登录")
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Token 无效或已过期")
    user = get_user_by_id(payload.get("user_id"))
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="账号已被禁用")
    return user

async def require_admin(user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user

# ========== 公开接口 ==========

@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest):
    username = req.username.strip()
    email = str(req.email).strip().lower()
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="用户名至少 2 个字符")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 个字符")
    try:
        # 第一个注册的用户自动成为管理员
        users = get_all_users()
        role = "admin" if len(users) == 0 else "user"
        hashed = get_password_hash(req.password)
        user = create_user(username, email, hashed, role)
        update_last_login(user["id"])
        token = create_access_token({"user_id": user["id"], "role": user["role"]})
        return TokenResponse(
            access_token=token,
            user={"id": user["id"], "username": user["username"], "email": user["email"], "role": user["role"]},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    user = get_user_by_username(req.username.strip())
    if not user or not verify_password(req.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="账号已被禁用")
    update_last_login(user["id"])
    token = create_access_token({"user_id": user["id"], "role": user["role"]})
    return TokenResponse(
        access_token=token,
        user={"id": user["id"], "username": user["username"], "email": user["email"], "role": user["role"]},
    )

@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "username": user["username"], "email": user["email"], "role": user["role"]}

# ========== 管理员接口 ==========

@router.get("/admin/users")
async def list_users(admin: dict = Depends(require_admin)):
    return get_all_users()

@router.put("/admin/users/{user_id}/status")
async def set_user_status(user_id: int, req: UserStatusUpdate, admin: dict = Depends(require_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user["id"] == admin["id"]:
        raise HTTPException(status_code=400, detail="不能禁用自己")
    update_user_status(user_id, req.is_active)
    return {"message": "更新成功"}

@router.put("/admin/users/{user_id}/role")
async def set_user_role(user_id: int, req: UserRoleUpdate, admin: dict = Depends(require_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="角色只能是 admin 或 user")
    update_user_role(user_id, req.role)
    return {"message": "更新成功"}

@router.delete("/admin/users/{user_id}")
async def remove_user(user_id: int, admin: dict = Depends(require_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user["id"] == admin["id"]:
        raise HTTPException(status_code=400, detail="不能删除自己")
    delete_user(user_id)
    return {"message": "删除成功"}
