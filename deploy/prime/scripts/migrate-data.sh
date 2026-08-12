#!/usr/bin/env bash
# PRIME AI 数据迁移脚本（服务器上执行）
#
# 原则：只读复制旧数据 → 复制到 prime/data，全程不影响现有服务运行。
# OWU 卷用 docker 临时容器复制（无需 sudo）；其余目录直接 cp。
# 已有 prime/data 时跳过（不重复覆盖）。
#
# 用法：bash scripts/migrate-data.sh

set -euo pipefail

PRIME_DIR="/home/liyang/jvkit/prime"
DATA_DIR="${PRIME_DIR}/data"

echo "==> 迁移开始：${DATA_DIR}"

# ---------- 1. Open WebUI 数据（volume: open-webui_open-webui）----------
DST_OWU="${DATA_DIR}/open-webui"
if [ -f "${DST_OWU}/webui.db" ] || [ -d "${DST_OWU}/webui.db" ]; then
    echo "==> 跳过 Open WebUI（已存在数据）"
else
    echo "==> 复制 Open WebUI 卷数据（docker 临时容器，只读挂载旧卷）"
    mkdir -p "${DST_OWU}"
    docker run --rm \
        -v open-webui_open-webui:/src:ro \
        -v "${DST_OWU}:/dst" \
        alpine:3 cp -a /src/. /dst/
    echo "    Open WebUI 数据已复制: $(du -sh ${DST_OWU} | cut -f1)"
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

# ---------- 3. Feedback 数据（docker 卷：feedback-data / feedback-uploads）----------
DST_FB="${DATA_DIR}/feedback"
DST_FBU="${DATA_DIR}/feedback-uploads"
if [ -f "${DST_FB}/feedback.db" ]; then
    echo "==> 跳过 Feedback data（已存在）"
else
    echo "==> 复制 Feedback 数据卷（feedback-data）"
    mkdir -p "${DST_FB}"
    docker run --rm -v feedback-data:/src:ro -v "${DST_FB}:/dst" alpine:3 cp -a /src/. /dst/
fi
if [ -d "${DST_FBU}" ] && [ -n "$(ls -A ${DST_FBU} 2>/dev/null)" ]; then
    echo "==> 跳过 Feedback uploads（已存在）"
else
    echo "==> 复制 Feedback 上传卷（feedback-uploads）"
    mkdir -p "${DST_FBU}"
    docker run --rm -v feedback-uploads:/src:ro -v "${DST_FBU}:/dst" alpine:3 cp -a /src/. /dst/
fi

echo "==> 迁移完成。目录结构："
ls -la "${DATA_DIR}"
echo ""
echo "提示：迁移后修改 ${PRIME_DIR}/.env 中各项敏感配置（参考 .env.example）"
