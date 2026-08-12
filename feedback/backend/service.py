import logging
import os
import shutil
import sqlite3
import uuid
from datetime import datetime
from typing import List, Optional

from backend.database import get_db, get_uploads_dir
from backend.models import (
    AttachmentResponse,
    FeedbackForm,
    FeedbackListResponse,
    FeedbackResponse,
    FeedbackUpdateForm,
    LeaderboardItem,
    ProfileForm,
    ProfileResponse,
)

log = logging.getLogger(__name__)
FEEDBACK_STATUS_VALID = {"pending", "processing", "done", "closed"}


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _row_to_profile(row: sqlite3.Row) -> ProfileResponse:
    return ProfileResponse(
        id=row["id"],
        account=row["account"],
        name=row["name"],
        department=row["department"],
        phone=row["phone"],
        email=row["email"],
        remark=row["remark"],
        join_ranking=row["join_ranking"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_attachment(row: sqlite3.Row) -> AttachmentResponse:
    return AttachmentResponse(
        id=row["id"],
        feedback_id=row["feedback_id"],
        file_path=row["file_path"],
        file_name=row["file_name"],
        created_at=row["created_at"],
    )


def _fetch_attachments(conn: sqlite3.Connection, feedback_id: int) -> List[AttachmentResponse]:
    rows = conn.execute(
        "SELECT * FROM fb_attachment WHERE feedback_id = ? ORDER BY id",
        (feedback_id,),
    ).fetchall()
    return [_row_to_attachment(r) for r in rows]


def _fetch_profile(conn: sqlite3.Connection, account: str) -> Optional[ProfileResponse]:
    row = conn.execute("SELECT * FROM fb_profile WHERE account = ?", (account,)).fetchone()
    return _row_to_profile(row) if row else None


def _row_to_feedback(conn: sqlite3.Connection, row: sqlite3.Row) -> FeedbackResponse:
    profile = _fetch_profile(conn, row["account"]) if row["account"] else None
    return FeedbackResponse(
        id=row["id"],
        account=row["account"],
        category=row["category"],
        type=row["type"],
        description=row["description"],
        status=row["status"],
        handler=row["handler"],
        handle_note=row["handle_note"],
        handled_at=row["handled_at"],
        is_carousel=row["is_carousel"],
        carousel_text=row["carousel_text"],
        remark=row["remark"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        attachments=_fetch_attachments(conn, row["id"]),
        profile=profile,
    )


class FeedbackService:
    def get_or_create_profile(self, account: str) -> ProfileResponse:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM fb_profile WHERE account = ?", (account,)).fetchone()
            if row:
                return _row_to_profile(row)
            conn.execute("INSERT INTO fb_profile (account) VALUES (?)", (account,))
            conn.commit()
            return self.get_or_create_profile(account)

    def update_profile(self, account: str, form: ProfileForm) -> ProfileResponse:
        with get_db() as conn:
            self.get_or_create_profile(account)
            conn.execute(
                """
                UPDATE fb_profile
                SET name = ?, department = ?, phone = ?, email = ?,
                    remark = ?, join_ranking = ?, updated_at = ?
                WHERE account = ?
                """,
                (
                    form.name,
                    form.department,
                    form.phone,
                    form.email,
                    form.remark,
                    form.join_ranking,
                    _now(),
                    account,
                ),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM fb_profile WHERE account = ?", (account,)).fetchone()
            return _row_to_profile(row)

    def create_feedback(
        self,
        account: str,
        form: FeedbackForm,
        screenshots: List,
    ) -> FeedbackResponse:
        log.info(
            "[FEEDBACK] create start account=%s category=%s type=%s description_len=%d screenshots=%d",
            account,
            form.category,
            form.type,
            len(form.description or ""),
            len(screenshots),
        )
        try:
            with get_db() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO fb_feedback
                    (account, category, type, description, remark, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
                    """,
                    (account, form.category, form.type, form.description, form.remark, _now(), _now()),
                )
                feedback_id = cur.lastrowid
                uploads_dir = get_uploads_dir()
                saved_count = 0
                for screenshot in screenshots:
                    if not screenshot.filename:
                        log.warning("[FEEDBACK] screenshot with empty filename skipped")
                        continue
                    ext = os.path.splitext(screenshot.filename)[1].lower()
                    safe_name = f"{uuid.uuid4().hex}{ext}"
                    file_path = os.path.join(uploads_dir, safe_name)
                    try:
                        with open(file_path, "wb") as f:
                            shutil.copyfileobj(screenshot.file, f)
                        file_size = os.path.getsize(file_path)
                        conn.execute(
                            "INSERT INTO fb_attachment (feedback_id, file_path, file_name) VALUES (?, ?, ?)",
                            (feedback_id, file_path, screenshot.filename),
                        )
                        saved_count += 1
                        log.info("[FEEDBACK] screenshot saved id=%d name=%s size=%d", feedback_id, screenshot.filename, file_size)
                    except Exception as e:
                        log.error("[FEEDBACK] screenshot save failed id=%d name=%s: %s", feedback_id, screenshot.filename, e, exc_info=True)
                        raise
                conn.commit()
                row = conn.execute("SELECT * FROM fb_feedback WHERE id = ?", (feedback_id,)).fetchone()
                log.info("[FEEDBACK] create success id=%d account=%s saved_screenshots=%d", feedback_id, account, saved_count)
                return _row_to_feedback(conn, row)
        except Exception as e:
            log.error("[FEEDBACK] create failed account=%s: %s", account, e, exc_info=True)
            raise

    def get_feedback_by_id(self, feedback_id: int) -> Optional[FeedbackResponse]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM fb_feedback WHERE id = ?", (feedback_id,)).fetchone()
            return _row_to_feedback(conn, row) if row else None

    def list_feedback_by_account(self, account: str) -> List[FeedbackResponse]:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT * FROM fb_feedback WHERE account = ? ORDER BY created_at DESC", (account,)
            ).fetchall()
            return [_row_to_feedback(conn, r) for r in rows]

    def list_feedback(
        self,
        status: Optional[str] = None,
        category: Optional[str] = None,
        feedback_type: Optional[str] = None,
        account: Optional[str] = None,
        keyword: Optional[str] = None,
        skip: int = 0,
        limit: int = 30,
    ) -> FeedbackListResponse:
        with get_db() as conn:
            where = ["1=1"]
            params: List = []
            if status:
                where.append("status = ?")
                params.append(status)
            if category:
                where.append("category = ?")
                params.append(category)
            if feedback_type:
                where.append("type = ?")
                params.append(feedback_type)
            if account:
                where.append("account = ?")
                params.append(account)
            if keyword:
                where.append("(description LIKE ? OR account LIKE ?)")
                params.extend([f"%{keyword}%", f"%{keyword}%"])

            where_sql = " AND ".join(where)
            total = conn.execute(
                f"SELECT COUNT(*) FROM fb_feedback WHERE {where_sql}", params
            ).fetchone()[0]

            rows = conn.execute(
                f"""
                SELECT * FROM fb_feedback
                WHERE {where_sql}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                params + [limit, skip],
            ).fetchall()
            items = [_row_to_feedback(conn, r) for r in rows]
            return FeedbackListResponse(items=items, total=total)

    def update_feedback(
        self,
        feedback_id: int,
        form: FeedbackUpdateForm,
    ) -> Optional[FeedbackResponse]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM fb_feedback WHERE id = ?", (feedback_id,)).fetchone()
            if not row:
                return None

            updates = {"updated_at": _now()}
            if form.status is not None:
                if form.status not in FEEDBACK_STATUS_VALID:
                    raise ValueError(f"Invalid status: {form.status}")
                updates["status"] = form.status
                if form.status in ("done", "closed"):
                    updates["handled_at"] = _now()
            if form.handler is not None:
                updates["handler"] = form.handler
            if form.handle_note is not None:
                updates["handle_note"] = form.handle_note
            if form.is_carousel is not None:
                updates["is_carousel"] = form.is_carousel
            if form.carousel_text is not None:
                updates["carousel_text"] = form.carousel_text

            if len(updates) > 1:
                set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
                values = list(updates.values()) + [feedback_id]
                conn.execute(f"UPDATE fb_feedback SET {set_clause} WHERE id = ?", values)
                conn.commit()

            row = conn.execute("SELECT * FROM fb_feedback WHERE id = ?", (feedback_id,)).fetchone()
            return _row_to_feedback(conn, row)

    def leaderboard(
        self,
        department: Optional[str] = None,
        start_at: Optional[str] = None,
        end_at: Optional[str] = None,
    ) -> List[LeaderboardItem]:
        with get_db() as conn:
            where = [
                "f.status IN ('pending', 'processing', 'done')",
                "p.join_ranking = 1",
                "p.name IS NOT NULL AND p.name <> ''",
            ]
            params: List = []
            if department:
                where.append("p.department = ?")
                params.append(department)
            if start_at:
                where.append("f.created_at >= ?")
                params.append(start_at)
            if end_at:
                where.append("f.created_at <= ?")
                params.append(end_at)

            where_sql = " AND ".join(where)
            rows = conn.execute(
                f"""
                SELECT
                    f.account,
                    p.name,
                    p.department,
                    p.phone,
                    p.email,
                    COUNT(*) AS effective_count,
                    MAX(f.created_at) AS latest_feedback_at
                FROM fb_feedback f
                JOIN fb_profile p ON p.account = f.account
                WHERE {where_sql}
                GROUP BY f.account
                ORDER BY effective_count DESC, latest_feedback_at DESC
                """,
                params,
            ).fetchall()
            return [
                LeaderboardItem(
                    account=r["account"],
                    name=r["name"],
                    department=r["department"],
                    phone=r["phone"],
                    email=r["email"],
                    effective_count=r["effective_count"],
                    latest_feedback_at=r["latest_feedback_at"],
                )
                for r in rows
            ]

    def carousel_items(self, limit: int = 10) -> List[dict]:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT carousel_text, handled_at
                FROM fb_feedback
                WHERE status = 'done' AND is_carousel = 1 AND carousel_text IS NOT NULL
                ORDER BY handled_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [
                {"carousel_text": r["carousel_text"], "handled_at": r["handled_at"]}
                for r in rows
            ]


FeedbackSvc = FeedbackService()
