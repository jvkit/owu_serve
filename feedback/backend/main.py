import logging
import os
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from backend.logger_config import setup_logging
from backend.router import router

setup_logging()
log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        log.info(
            "[REQUEST] %s %s from %s",
            request.method,
            request.url.path,
            request.client.host if request.client else "?",
        )
        try:
            response = await call_next(request)
            log.info(
                "[RESPONSE] %s %s -> %s in %.2fms",
                request.method,
                request.url.path,
                response.status_code,
                (time.time() - start) * 1000,
            )
            return response
        except Exception as e:
            log.exception("[REQUEST] %s %s failed: %s", request.method, request.url.path, e)
            raise


class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    """Disable caching for frontend HTML/JS so updates take effect immediately."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.endswith((".html", ".js")) or path in ("/", "/widget.html", "/admin.html"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


app = FastAPI(title="Feedback Service", version="1.0.0")
app.add_middleware(RequestLogMiddleware)
app.add_middleware(NoCacheStaticMiddleware)

# CORS: allow OWU to load iframe and call APIs.
# In production, restrict allow_origins to the OWU domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Serve static frontend files
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
