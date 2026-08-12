# PRIME AI 部署手册（服务器 `/home/liyang/jvkit/prime`）

> **铁律：不碰服务器上现有的一切镜像/容器/配置。**
> 全部操作只发生在 `prime/` 目录内；数据迁移只读复制；新增 nginx 独立 conf 文件。
> 构建/运行注意内存水位，避免 OOM（见下文"资源与 OOM"）。

## 架构

```
公网 3304 → 宿主机 nginx（现有入口，Prime 阶段一用 3305 验证，阶段二并入 3304）
   ├─ /              → open-webui 容器  127.0.0.1:3011  (内部 8080)
   ├─ /feedback*     → feedback 容器    127.0.0.1:3013  (内部 8000)
   ├─ /dashboard     → gateway 容器     127.0.0.1:3012  (内部 3019)
   └─ /api/*         → gateway 容器
内部网络 prime-net；容器端口只绑 127.0.0.1，外部不可直达。
```

- Open WebUI：模型网关指向 `gateway:3019`（接棒旧版 openwebui_2 的模型网关角色）
- gateway：模型网关 + 用户中心 + 知识库管理
- feedback：反馈服务

## 目录结构

```
prime/
├── docker-compose.yml
├── .env                  # 敏感配置（从旧配置迁移，不入库）
├── nginx/prime.conf      # 阶段一 3305 测试入口
├── scripts/migrate-data.sh
├── data/                 # 全部数据挂载（从旧卷只读复制）
│   ├── open-webui/
│   ├── gateway/
│   └── feedback/ + feedback-uploads/
└── src/                  # 源码（git 管理，服务器为长期构建机）
    ├── webui/            # git@github.com:jvkit/webui.git
    └── owu_serve/        # git@github.com:jvkit/owu_serve.git
```

## 初始化（一次性）

```bash
# 1. 目录与源码
mkdir -p /home/liyang/jvkit/prime/{data,src,nginx,scripts}
cd /home/liyang/jvkit/prime
git clone git@github.com:jvkit/webui.git src/webui
git clone git@github.com:jvkit/owu_serve.git src/owu_serve
cp src/owu_serve/deploy/prime/docker-compose.yml ./
cp src/owu_serve/deploy/prime/nginx/prime.conf nginx/
cp src/owu_serve/deploy/prime/scripts/migrate-data.sh scripts/
chmod +x scripts/migrate-data.sh
cp src/owu_serve/deploy/prime/.env.example .env

# 2. 数据迁移（只读复制，不影响现有服务）
sudo bash scripts/migrate-data.sh

# 3. 配置 .env —— 从旧环境迁移：
#    open-webui:  WEBUI_SECRET_KEY 必须与旧容器一致
#    gateway:     NEW_API_BASEURL / NEWAPI_ADMIN_ACCESS_TOKEN / OPENWEBUI_EMAIL / OPENWEBUI_PASSWORD
#                从旧 /home/liyang/owu-gateway/.env 迁移；SESSION_SECRET 重新生成
#    参考旧 open-webui 容器环境：docker inspect open-webui --format '{{range .Config.Env}}{{println .}}{{end}}'

# 4. 磁盘检查（构建需要空间，镜像约 7GB + 缓存若干）
df -h /home/liyang

# 5. 分步构建（先小后大，避免一次失败全卡；构建限内存防 OOM）
docker compose build feedback gateway
docker compose build open-webui        # 首次约 20-40 分钟，可 nohup 后台
docker compose up -d

# 6. nginx 阶段一（3305 测试，不动现有配置）
sudo cp nginx/prime.conf /etc/nginx/conf.d/prime.conf
sudo nginx -t && sudo systemctl reload nginx
# 访问 http://<host>:3305/ 验证；3305 仅供内网测试，可临时 iptables/防火墙放行本机
```

## 日常更新（每次）

```bash
cd /home/liyang/jvkit/prime
git -C src/webui pull
git -C src/owu_serve pull
docker compose build feedback gateway     # 先小服务（秒级~分钟）
docker compose build open-webui           # 依赖层命中缓存，几分钟
docker compose up -d
```

## 回滚

- 镜像 tag 版本化：构建时打 `prime-open-webui:<date>` 与 `:latest`；
  回滚 `docker tag prime-open-webui:<旧date> prime-open-webui:latest && docker compose up -d`
- 数据回滚：`data/` 目录先整体备份（`cp -a data data.bak.<date>`）
- nginx 回滚：删除 `/etc/nginx/conf.d/prime.conf` 并 reload 即回到原状

## 资源与 OOM

- 构建前 `free -h` 确认内存；npm build/vite 是 CPU+内存密集，torch/pip 下载是 IO 密集
- 构建限制（防 OOM）：`docker compose build` 可用
  `docker build --memory=4g --cpus=2` 等价参数，或先构建小服务验证环境
- 运行期资源限制见 compose（可按机器内存调整 limits）

## 已知注意事项

- 外部 nginx 对 `PUT` 连接重置 → 反馈服务已用 POST 兼容，nginx 配置勿改方法
- OWU 数据卷 `open-webui_open-webui` 全包（db/uploads/cache），迁移用 `cp -a` 连 `-wal/-shm` 一起复制
- 旧 gateway（openwebui_2, 3019）在切换前保持运行；OWU 旧容器的
  `OPENAI_API_BASE_URL=http://172.16.16.110:3019/v1` 指向它 —— 切换时新 OWU 改指 `gateway:3019`
- 新 OWU 首次启动会下载 embedding 模型缓存（若 volume 已有则跳过）
