import logging
import os
from typing import Optional

import httpx
from fastapi import Cookie, HTTPException, Request, status

from backend.models import UserInfo

log = logging.getLogger(__name__)

OWUI_BASE_URL = os.environ.get("OWUI_BASE_URL", "http://localhost:8080")


async def get_current_user(token: Optional[str] = Cookie(None, alias="token")) -> UserInfo:
    """Validate the OWU token cookie by calling OWU's session endpoint."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{OWUI_BASE_URL}/api/v1/auths/",
                headers={"Authorization": f"Bearer {token}"},
                cookies={"token": token},
                timeout=10.0,
            )
    except Exception as e:
        log.error(f"Failed to validate token with OWU: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to validate authentication",
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    data = resp.json()
    return UserInfo(
        id=data.get("id", ""),
        email=data.get("email", ""),
        name=data.get("name", ""),
        role=data.get("role", "pending"),
    )


async def get_current_user_or_guest(
    token: Optional[str] = Cookie(None, alias="token"),
) -> Optional[UserInfo]:
    """Validate token if present; return None for guests instead of raising."""
    if not token:
        return None

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{OWUI_BASE_URL}/api/v1/auths/",
                headers={"Authorization": f"Bearer {token}"},
                cookies={"token": token},
                timeout=5.0,
            )
    except Exception:
        return None

    if resp.status_code != 200:
        return None

    data = resp.json()
    return UserInfo(
        id=data.get("id", ""),
        email=data.get("email", ""),
        name=data.get("name", ""),
        role=data.get("role", "pending"),
    )


async def get_admin_user(token: Optional[str] = Cookie(None, alias="token")) -> UserInfo:
    user = await get_current_user(token)
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return user
