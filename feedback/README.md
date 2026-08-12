# Feedback Service

独立的产品反馈服务，与 Open WebUI 解耦，通过 iframe 嵌入 OWU 页面。

## 架构

- **后端**：FastAPI + SQLite（`data/feedback.db`）
- **前端**：纯 HTML/JS，无构建链
- **认证**：读取 OWU 的 `token` cookie，调用 OWU `/api/v1/auths/` 验证
- **部署**：Docker / docker-compose

## 目录

```
feedback-service/
├── backend/           # FastAPI 后端
│   ├── main.py
│   ├── router.py
│   ├── service.py
│   ├── database.py
│   ├── models.py
│   └── auth.py
├── frontend/          # 静态前端
│   ├── widget.html    # 悬浮反馈组件
│   ├── admin.html     # 管理面板
│   └── api.js
├── data/              # SQLite 数据（容器内 /app/data）
├── uploads/           # 截图附件（容器内 /app/uploads）
├── Dockerfile
├── docker-compose.yaml
└── requirements.txt
```

## 本地一键启动

```bash
cd /home/jvkit/workspace/owu-feed/feedback-service
docker-compose up -d
```

服务运行在 `http://localhost:3003`：

- 反馈组件：`http://localhost:3003/widget.html`
- 管理面板：`http://localhost:3003/admin.html`
- API：`http://localhost:3003/api/v1/feedback/...`

## OWU 集成

已在 OWU 中完成 iframe 注入：

- 全局 layout (`src/routes/+layout.svelte`)：登录后右下角显示反馈组件 iframe。
- `/admin/feedback` 页面：嵌入管理面板 iframe。

iframe 默认指向 `http://localhost:3003/widget.html` / `admin.html`，生产环境请替换为实际域名。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OWUI_BASE_URL` | OWU 地址，用于验证 token | `http://host.docker.internal:8080` |
| `FEEDBACK_DATA_DIR` | SQLite 数据目录 | `/app/data` |
| `FEEDBACK_UPLOADS_DIR` | 截图上传目录 | `/app/uploads` |
| `PORT` | 服务端口 | `8000` |

## API 列表

- `GET /api/v1/feedback/profile` 获取当前用户 profile
- `PUT /api/v1/feedback/profile` 更新 profile
- `POST /api/v1/feedback/` 提交反馈（multipart，含 screenshots）
- `GET /api/v1/feedback/me` 当前用户反馈历史
- `GET /api/v1/feedback/` 管理员列表
- `PUT /api/v1/feedback/{id}` 管理员更新状态
- `GET /api/v1/feedback/leaderboard` 排行榜
- `GET /api/v1/feedback/carousel` 轮播数据
- `GET /api/v1/feedback/attachments/{id}` 下载截图

## 数据迁移

数据库表结构在启动时自动创建（`init_db()`）。
