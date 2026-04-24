#!/usr/bin/env python3
"""Bootstrap admin user for local development."""

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.gateway.auth.models import (  # noqa: E402
    create_user,
    get_db,
    get_user_by_username,
    update_user_role,
)
from src.gateway.auth.security import get_password_hash  # noqa: E402


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def reset_password(user_id: int, password: str) -> None:
    conn = get_db()
    try:
        conn.execute(
            "UPDATE users SET hashed_password = ? WHERE id = ?",
            (get_password_hash(password), user_id),
        )
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    username = os.getenv("DEERFLOW_ADMIN_USERNAME", "admin").strip()
    password = os.getenv("DEERFLOW_ADMIN_PASSWORD", "admin123").strip()
    email = os.getenv("DEERFLOW_ADMIN_EMAIL", "admin@local.dev").strip()
    should_reset_password = parse_bool(os.getenv("DEERFLOW_ADMIN_RESET_PASSWORD", "0"))

    if not username:
        raise ValueError("DEERFLOW_ADMIN_USERNAME 不能为空")
    if len(password) < 6:
        raise ValueError("管理员密码长度不能少于 6 位")
    if not email:
        raise ValueError("DEERFLOW_ADMIN_EMAIL 不能为空")

    user = get_user_by_username(username)

    if user is None:
        create_user(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
            role="admin",
        )
        print(f"created admin user: {username}")
        return

    if user["role"] != "admin":
        update_user_role(user["id"], "admin")
        print(f"updated role to admin: {username}")

    if should_reset_password:
        reset_password(user["id"], password)
        print(f"reset password for admin user: {username}")
    else:
        print(f"admin user already exists: {username}")


if __name__ == "__main__":
    main()
