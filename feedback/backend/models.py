from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class ProfileForm(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    remark: Optional[str] = None
    join_ranking: int = Field(default=1, ge=0, le=1)


class ProfileResponse(ProfileForm):
    id: int
    account: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class FeedbackForm(BaseModel):
    category: str
    type: str = Field(default="other")
    description: str = Field(..., min_length=10, max_length=2000)
    remark: Optional[str] = Field(default=None, max_length=500)


class FeedbackUpdateForm(BaseModel):
    status: Optional[str] = None
    handler: Optional[str] = None
    handle_note: Optional[str] = None
    is_carousel: Optional[int] = Field(default=None, ge=0, le=1)
    carousel_text: Optional[str] = None


class AttachmentResponse(BaseModel):
    id: int
    feedback_id: int
    file_path: str
    file_name: Optional[str] = None
    created_at: Optional[str] = None


class FeedbackResponse(BaseModel):
    id: int
    account: str
    category: str
    type: str
    description: str
    status: str
    handler: Optional[str] = None
    handle_note: Optional[str] = None
    handled_at: Optional[str] = None
    is_carousel: int = 0
    carousel_text: Optional[str] = None
    remark: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    attachments: List[AttachmentResponse] = []
    profile: Optional[ProfileResponse] = None


class FeedbackListResponse(BaseModel):
    items: List[FeedbackResponse]
    total: int


class LeaderboardItem(BaseModel):
    account: str
    name: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    effective_count: int
    latest_feedback_at: Optional[str] = None


class CarouselItem(BaseModel):
    carousel_text: str
    handled_at: Optional[str] = None


class UserInfo(BaseModel):
    id: str
    email: str
    name: str
    role: str
