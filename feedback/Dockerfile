FROM python:3.11-slim-bookworm

WORKDIR /app

# 国内镜像加速：apt 源
RUN sed -i -e 's|deb.debian.org|mirrors.aliyun.com|g' -e 's|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libmariadb-dev \
    && rm -rf /var/lib/apt/lists/*

# pip 国内镜像
ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend

ENV FEEDBACK_DATA_DIR=/app/data
ENV FEEDBACK_UPLOADS_DIR=/app/uploads
ENV OWUI_BASE_URL=http://host.docker.internal:8080
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
