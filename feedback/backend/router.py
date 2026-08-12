import logging
import os
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from backend.auth import get_admin_user, get_current_user, get_current_user_or_guest
from backend.database import get_db, init_db
from backend.models import (
    CarouselItem,
    FeedbackForm,
    FeedbackListResponse,
    FeedbackResponse,
    FeedbackUpdateForm,
    LeaderboardItem,
    ProfileForm,
    ProfileResponse,
    UserInfo,
)
from backend.service import FeedbackSvc

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])
init_db()


def _account_from_user(user: UserInfo) -> str:
    return user.email or user.id


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(user: UserInfo = Depends(get_current_user)):
    return FeedbackSvc.get_or_create_profile(_account_from_user(user))


@router.put("/profile", response_model=ProfileResponse)
@router.post("/profile", response_model=ProfileResponse)
async def update_profile(
    form: ProfileForm,
    user: UserInfo = Depends(get_current_user),
):
    return FeedbackSvc.update_profile(_account_from_user(user), form)


@router.post("/", response_model=FeedbackResponse)
async def create_feedback(
    category: str = Form(...),
    type: str = Form(default="other"),
    description: str = Form(...),
    remark: Optional[str] = Form(default=None),
    guest_account: Optional[str] = Form(default=None),
    screenshots: List[UploadFile] = File(default=[]),
    user: Optional[UserInfo] = Depends(get_current_user_or_guest),
):
    account = _account_from_user(user) if user else (guest_account or "anonymous")
    form = FeedbackForm(category=category, type=type, description=description, remark=remark)
    return FeedbackSvc.create_feedback(account, form, screenshots)


@router.get("/me", response_model=List[FeedbackResponse])
async def list_my_feedback(user: UserInfo = Depends(get_current_user)):
    return FeedbackSvc.list_feedback_by_account(_account_from_user(user))


@router.get("/", response_model=FeedbackListResponse)
async def list_feedback(
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    feedback_type: Optional[str] = Query(default=None, alias="type"),
    account: Optional[str] = Query(default=None),
    keyword: Optional[str] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=30, ge=1, le=200),
    admin_user: UserInfo = Depends(get_admin_user),
):
    return FeedbackSvc.list_feedback(
        status=status,
        category=category,
        feedback_type=feedback_type,
        account=account,
        keyword=keyword,
        skip=skip,
        limit=limit,
    )


@router.put("/{feedback_id}", response_model=FeedbackResponse)
@router.post("/{feedback_id}", response_model=FeedbackResponse)
async def update_feedback(
    feedback_id: int,
    form: FeedbackUpdateForm,
    admin_user: UserInfo = Depends(get_admin_user),
):
    result = FeedbackSvc.update_feedback(feedback_id, form)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    return result


@router.get("/leaderboard", response_model=List[LeaderboardItem])
async def get_leaderboard(
    department: Optional[str] = Query(default=None),
    start_at: Optional[str] = Query(default=None),
    end_at: Optional[str] = Query(default=None),
    user: UserInfo = Depends(get_current_user),
):
    return FeedbackSvc.leaderboard(
        department=department, start_at=start_at, end_at=end_at
    )


@router.get("/carousel", response_model=List[CarouselItem])
async def get_carousel(limit: int = Query(default=10, ge=1, le=50)):
    items = FeedbackSvc.carousel_items(limit=limit)
    return [CarouselItem(**item) for item in items]


@router.get("/attachments/{attachment_id}")
async def get_attachment(
    attachment_id: int,
    user: UserInfo = Depends(get_current_user),
):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM fb_attachment WHERE id = ?", (attachment_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
        file_path = row["file_path"]
        if not os.path.isfile(file_path):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        return FileResponse(file_path, filename=row["file_name"] or os.path.basename(file_path))
