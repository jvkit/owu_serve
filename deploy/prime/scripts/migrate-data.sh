#!/usr/bin/env bash
# PRIME AI 数据迁移脚本（服务器上执行）
#
# 原则：只读复制旧数据 → 复制到 prime/data，全程不影响现有服务运行。
# 已有 prime/data 时跳过（不重复覆盖）。
#
# 用法：sudo bash scripts/migrate-data.sh

set -euo pipefail

PRIME_DIR="/home/liyang/jvkit/prime"
DATA_DIR="${PRIME_DIR}/data"

echo "==> 迁移开始：${DATA_DIR}"

# ---------- 1. Open WebUI 数据（volume: open-webui_open-webui）----------
SRC_OWU_VOL="/var/lib/docker/volumes/open-webui_open-webui/_data"
DST_OWU="${DATA_DIR}/open-webui"
if [ ! -d "${DST_OWU}/webui.db" ] && [ ! -s "${DST_OWU}/webui.db" ]; then
    echo "==> 复制 Open WebUI 卷数据"
    mkdir -p "${DST_OWU}"
    # sqlite 运行中复制：连同 -wal/-shm 一并复制，避免只复制主文件导致 WAL 丢失
    cp -a "${SRC_OWU_VOL}/." "${DST_OWU}/"
    echo "    Open WebUI 数据已复制: $(du -sh ${DST_OWU} | cut -f1)"
else
    echo "==> 跳过 Open WebUI（已存在数据）"
fi

# ---------- 2. Gateway 数据（旧版裸跑，db 在 /home/liyang/*.db）----------
DST_GW="${DATA_DIR}/gateway"
mkdir -p "${DST_GW}"
for f in user_tokens.db users.db user_storage.db; do
    if [ -f "/home/liyang/${f}" ] && [ ! -f "${DST_GW}/${f}" ]; then
        cp -a "/home/liyang/${f}" "${DST_GW}/${f}"
        echo "==> 复制 ${f}"
    fi
done
if [ -d "/home/liyang/owu-gateway/data" ]; then
    cp -an "/home/liyang/owu-gateway/data/." "${DST_GW}/" || true
    echo "==> 复制 owu-gateway/data"
fi
# 注意：新版 gateway 使用 gateway.db（better-sqlite3），若旧版是分表 db 需要额外转换，
# 由部署时人工确认。

# ---------- 3. Feedback 数据（裸跑 uvicorn 或旧容器 3333）----------
SRC_FB="${DATA_DIR}/feedback"
mkdir -p "${SRC_FB}" "${DATA_DIR}/feedback-uploads"
if [ -d "/home/liyang/jvkit/owu-feedback/data" ]; then
    cp -an "/home/liyang/jvkit/owu-feedback/data/." "${SRC_FB}/" || true
    echo "==> 复制 feedback/data"
fi
if [ -d "/home/liyang/jvkit/owu-feedback/uploads" ]; then
    cp -an "/home/liyang/jvkit/owu-feedback/uploads/." "${DATA_DIR}/feedback-uploads/" || true
    echo "==> 复制 feedback/uploads"
fi

echo "==> 迁移完成。目录结构："
ls -la "${DATA_DIR}"
echo ""
echo "提示：迁移后修改 ${PRIME_DIR}/.env 中各项敏感配置（参考 .env.example）"
