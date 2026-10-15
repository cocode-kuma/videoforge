由 **cocode 酷码工作室** 开发，品牌归属 **cocode**。

# Cocode Studio VideoForge 部署手册

本手册对应随包交付的源码及 `package-lock.json`。应用使用 TypeScript、React、DSH / Cordis、Hyperframes 和 FFmpeg；三个业务插件均在 `plugins/` 中，DSH 核心未修改。

默认创作已升级为持久 Agent Harness，支持 Remotion、Blender、Python 和多种配音。新增环境准备、配置与公开部署隔离边界请同时阅读 [创作 Harness](docs/creative-harness.md)。本机 Python/Blender 执行面向可信桌面主人，公开多租户部署不能直接沿用本机模式。

## 1. 收到源码包后

解压 `Cocode-Studio-VideoForge-1.0.0-source-with-dsh.zip`，进入其中的 `Cocode-Studio-VideoForge` 目录。Windows 建议使用较短路径，如 `C:\cocode\videoforge`；Linux 示例目录为 `/opt/cocode-videoforge`。

交付内容包括：

- 应用与三个插件完整源码、前端、测试、启动脚本、锁定依赖配置。
- `Dockerfile`、`compose.yaml`、Nginx 与 systemd 示例。
- `vendor/dsh/deepseek-harness-0.1.0-rc.6-source.tar.gz`：官方 DSH 发布提交的完整仓库源码归档，保持原始字节。
- `vendor/dsh/dsh-0.1.0-rc.6.tgz`：官方 npm CLI 原包，已核对 npm 发布的 SHA-512。
- DSH 许可证、第三方声明、来源及 SHA-256 记录，见 `vendor/dsh/README.md` 和 `provenance.json`。
- `SOURCE-MANIFEST.sha256`：外层包内各文件的 SHA-256 清单。

源码包不携带服务器 `.env`、真实账号、用户项目、会话、日志或本机 `node_modules`。这是**联网安装的源码交付包**；执行 `npm ci` 需要 npm 网络，首次安装无头浏览器需要下载浏览器。FFmpeg、系统字体和浏览器二进制不包含在源码包中。

## 2. 环境要求

推荐 Node.js 22 的最新维护版本（至少 22.19），npm 10+，FFmpeg / FFprobe，以及 Chrome Headless Shell。项目声明最低 Node 22.18，但依赖闭包中有包声明 22.19，因此新服务器按更高要求安装。建议至少 4 核 CPU、8 GB 内存，默认渲染并发为 1；磁盘按保存的视频量扩容。

先检查：

```text
node --version
npm --version
ffmpeg -version
ffprobe -version
```

`npm start` 会先构建插件和前端，因此必须安装 devDependencies。**不要使用 `npm ci --omit=dev`**。随包 `.npmrc` 使用 `legacy-peer-deps=true`，用于 DSH 的循环 peer 依赖；保留该文件及 `package-lock.json`，不要自行改装最新版 DSH。

## 3. Windows 本地启动

先安装 Node.js 和 FFmpeg；已有 FFmpeg 可跳过安装。PowerShell：

```powershell
winget install Gyan.FFmpeg
# 安装后重新打开终端，让 PATH 生效。
cd C:\cocode\videoforge
npm ci --include=dev
Copy-Item .env.example .env
notepad .env
```

`.env` 中填写自己的服务端模型配置，保留本地 HTTP 设置：

```dotenv
# cocode 酷码工作室 · Cocode Studio VideoForge
NODE_ENV=development
HOST=127.0.0.1
PORT=3088
PUBLIC_ORIGIN=http://localhost:3088
COOKIE_SECURE=false
TRUST_PROXY_HOPS=0
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=替换为服务端密钥
```

`DEEPSEEK_BASE_URL` 填接口基地址；插件会在其后追加 `/chat/completions`，自建兼容服务如果要求 `/v1`，把 `/v1` 包含在基地址里。模型名称和密钥由管理员配置，所有 SaaS 用户共享该配置。

新账号注册需邀请码 `kuma`。默认每个注册 IP 共享 5 个成功视频名额，之后使用官网额度。可通过 `INVITE_CODE`、`INVITE_FREE_VIDEOS_PER_IP` 调整活动参数。请备份 `video_projects/users.json`，其中保存了 HMAC IP 标识密钥。

```powershell
npx hyperframes browser ensure
npm run doctor
npm start
```

打开 `http://localhost:3088`，注册账号。首次浏览器下载受网络影响，若已有 Chrome Headless Shell，可将其完整可执行文件路径填入 `PRODUCER_HEADLESS_SHELL_PATH`，例如 `C:/tools/chrome-headless-shell/chrome-headless-shell.exe`。不要复制开发机器的用户目录路径到另一台服务器。

`doctor` 中未配置的语音识别和 TTS 不影响当前不配音流程。代码音乐由本地音频合成器生成，无需云音乐供应商。应重点确认 FFmpeg、FFprobe 和渲染浏览器可用。没有模型密钥也能启动、登录和管理项目，但生成请求会返回明确的 503 提示。

## 4. Linux + systemd + Nginx

以下适用于已安装 Node.js 22.19+、npm 的 Debian 主机；Ubuntu 的 Chromium 包方式可能不同，本应用渲染浏览器仍通过 Hyperframes 安装。

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg fonts-noto-cjk fonts-liberation ca-certificates nginx \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
sudo useradd --system --create-home --home-dir /var/lib/videoforge --shell /usr/sbin/nologin videoforge
sudo mkdir -p /opt/cocode-videoforge
# 将解压后项目目录的全部内容（含 .npmrc、.env.example）放进 /opt/cocode-videoforge。
sudo chown -R videoforge:videoforge /opt/cocode-videoforge
sudo -u videoforge -H bash -c 'cd /opt/cocode-videoforge && npm ci --include=dev && npx hyperframes browser ensure'
sudo -u videoforge cp /opt/cocode-videoforge/.env.example /opt/cocode-videoforge/.env
sudoedit /opt/cocode-videoforge/.env
sudo chmod 600 /opt/cocode-videoforge/.env
```

如果发行版使用 `t64` 系统库包名，请安装其对应包（例如 `libasound2t64`）。浏览器安装必须使用实际运行服务的 `videoforge` 用户，使运行时能找到该用户的浏览器缓存；也可以指定服务器上固定的 `PRODUCER_HEADLESS_SHELL_PATH`。

生产 `.env` 配置：

```dotenv
# cocode 酷码工作室 · Cocode Studio VideoForge
NODE_ENV=production
HOST=127.0.0.1
PORT=3088
PUBLIC_ORIGIN=https://studio.example.com
COOKIE_SECURE=true
TRUST_PROXY_HOPS=1
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=替换为服务端密钥
RENDER_CONCURRENCY=1
MAX_QUEUED_JOBS=20
MAX_DAILY_GENERATIONS=20
MAX_PROJECTS_PER_USER=100
RENDER_TIMEOUT_MS=600000
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

先将真实域名解析到服务器并准备有效的 TLS 证书，再编辑 `deploy/nginx.conf` 中的域名和证书路径，将它安装到 Nginx 配置目录。示例假设 Nginx 在同一宿主机上，直接代理到 `127.0.0.1:3088`，不适用于独立 Nginx 容器未经修改的配置。

```bash
sudo cp /opt/cocode-videoforge/deploy/cocode-videoforge.service /etc/systemd/system/
# 确认 service 的 ExecStart=/usr/bin/npm 与 command -v npm 一致。
sudo systemctl daemon-reload
sudo systemctl enable --now cocode-videoforge
sudo cp /opt/cocode-videoforge/deploy/nginx.conf /etc/nginx/conf.d/cocode-videoforge.conf
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status cocode-videoforge
sudo journalctl -u cocode-videoforge -f
```

修改 `.env` 后执行 `sudo systemctl restart cocode-videoforge`。公网只开放需要的 HTTP / HTTPS 入口，3088 监听本机。生产模式要求 `PUBLIC_ORIGIN` 使用 HTTPS 并开启 Secure Cookie；用 HTTP 直接打开生产站点会导致认证不符合预期。

## 5. Docker Compose 部署

需要 Docker Engine 和 Compose v2。项目目录执行：

```bash
cp .env.example .env
# 编辑 .env，填写真实 HTTPS PUBLIC_ORIGIN、模型基地址、模型名和密钥。
# PRODUCER_HEADLESS_SHELL_PATH 保持空：镜像会以 node 用户安装浏览器。
mkdir -p video_projects logs
sudo chown -R 1000:1000 video_projects logs
docker compose up --build -d
docker compose ps
docker compose logs -f studio
```

Compose 强制 `NODE_ENV=production`、`HOST=0.0.0.0`、`COOKIE_SECURE=true` 和 `TRUST_PROXY_HOPS=1`，所以 `.env` 中必须填写真实 HTTPS 地址。它将端口绑定到宿主 `127.0.0.1:3088`，按上一节配置宿主 Nginx。

镜像包含 FFmpeg、字体、Chromium 和 Hyperframes 安装的 Chrome Headless Shell，首次构建需要外网下载。不要把 Windows 浏览器路径传进 Linux 容器。数据与日志通过目录绑定持久化，镜像更新不会替代这两个目录。渲染共享内存为 1 GB；首次启动仍会构建应用。

```bash
docker compose logs --tail=100 studio
docker compose restart studio
# 更新源码后重建：
docker compose up --build -d
```

## 6. 配置与启动原理

| 配置 | 作用 |
| --- | --- |
| `PUBLIC_ORIGIN` | 用户实际访问的完整来源，协议、域名、端口必须匹配 |
| `COOKIE_SECURE` | HTTPS 生产环境设为 `true` |
| `TRUST_PROXY_HOPS` | 直连设 0，本例单层 Nginx 设 1 |
| `DEEPSEEK_MODEL / BASE_URL / API_KEY` | 服务端固定模型；修改后重启 |
| `RENDER_CONCURRENCY` | 全局生成任务并发，1–4，默认 1 |
| `MAX_QUEUED_JOBS` | 队列上限，默认 20 |
| `MAX_DAILY_GENERATIONS` | 每用户每日生成次数，UTC 日期，失败尝试也计数 |
| `MAX_PROJECTS_PER_USER` | 每用户项目数，默认 100 |
| `RENDER_TIMEOUT_MS` | 渲染子进程超时，默认 600000 毫秒 |
| `FFMPEG_PATH / FFPROBE_PATH` | 可执行文件名或完整路径 |
| `PRODUCER_HEADLESS_SHELL_PATH` | 可选，自行安装的 Headless Shell 路径 |

完整默认配置见 `.env.example`。项目根 `.env` 优先使用；可选的 `~/.dsh/settings.yaml` 与 `.credentials.yaml` 回退格式见 README，容器部署推荐统一用环境变量。

只需执行 `npm start`。启动脚本构建源码、创建独立空 profile，再调用锁定版本的真实 DSH CLI：`dsh --profile videoforge`。该版本没有 `dsh start --plugins ...` 命令。profile 固定仅加载三个自有插件，不启动默认 Web UI、默认 Agent 会话或内置工具栈；不要运行上游 README 的默认 `dsh web` 命令作为本产品入口。

数据路径固定为项目根的 `video_projects/`，日志为 `logs/`。`.dsh-videoforge/` 是可重建的启动配置，不保存产品账号或项目。DSH 源码归档供审阅和二次开发参考，正常部署无需解压编译该仓库，运行依赖由本项目锁定的 npm 包提供。

## 7. 多租户、备份与升级

账号使用密码哈希和 Cookie Session，业务接口从 Session 得到用户身份。项目、分镜、视频读取与下载均按真实用户 ID 校验归属；项目侧边「⋯」支持重命名和删除，删除前提示项目名称。正在生成的项目不能删除。

这是**单服务进程的文件存储部署**，不可开启 PM2 cluster、Compose 多副本或多个实例共享数据目录。应用启动锁会阻止同一数据目录的另一个正常实例。若需要横向扩容，先更换数据库和持久化队列。

升级前等待渲染结束，停止服务，对 `video_projects/` 做完整备份，并单独保管 `.env`。其中 `users.json` 保存账号、会话哈希和独立计量，不能只备份项目视频。Linux systemd 示例：

```bash
sudo systemctl stop cocode-videoforge
sudo install -d -m 700 /var/backups/cocode-videoforge
sudo sh -c 'umask 077; tar -czf /var/backups/cocode-videoforge/data-$(date +%Y%m%d-%H%M%S).tar.gz -C /opt/cocode-videoforge video_projects .env'
sudo systemctl start cocode-videoforge
```

Compose 使用 `docker compose stop studio` / `docker compose start studio` 对应停启。恢复时先停服，保留旧数据副本，再从备份恢复整个 `video_projects/` 与 `.env`，校正服务用户权限后启动。不要将两套 `users.json` 或项目目录直接合并。跨机器恢复前，在确认没有实例运行后删除备份中的旧 `.server.lock`，避免旧 PID 与新机器进程碰巧重号。

部署新源码应保留 `.env`、`video_projects/`、`logs/`，然后执行 `npm ci --include=dev` 再启动；Docker 则重建镜像。重启会把未完成任务标记为中断失败，需要用户重新提交，不自动重复消耗模型额度。日志和渲染产物需按磁盘容量定期归档。

## 8. 验收与排错

基础检查：

```bash
npm run check
npm run doctor
curl http://127.0.0.1:3088/api/health
```

`npm run check` 包含 TypeScript、自动测试、构建和打包后插件 HTTP 冒烟检查，不调用真实模型。`npm run test:render` 使用测试样例执行真实 Hyperframes / FFmpeg 渲染；`npm run test:browser` 会向正在运行的本地站点注册测试账号，适合开发验收，不建议在正式用户库中例行运行。

上线后用两个自建测试账号检查项目彼此不可见，再通过已配置模型提交一条视频创意，确认从排队到 MP4 下载全过程。当前交付已验证 Windows 本地环境、账号隔离、项目菜单、HTTP 错误状态和真实渲染样例；**未使用你的真实模型密钥验证生成，也未在本机实际运行 Docker / Linux 部署**。

| 现象 | 排查 |
| --- | --- |
| 登录或操作显示来源错误 / 403 | `PUBLIC_ORIGIN` 与浏览器地址是否完全一致，不混用 localhost / 127.0.0.1 |
| 生产启动提示 HTTPS 配置 | 设置真实 HTTPS 来源、Secure Cookie 并配置 Nginx 证书 |
| 生成返回 503 | 模型 Key 是否为空；修改环境后是否重启 |
| 模型返回 401 / 404 | 核对提供商密钥、基地址和模型名称 |
| 显示 500 | 读取当日 `logs/YYYY-MM-DD.jsonl` 和服务日志，按失败阶段定位，不把服务端日志暴露在前端 |
| 浏览器缺失 / spawn ENOENT | 用运行服务的同一用户安装 Headless Shell，检查 FFmpeg / FFprobe 路径 |
| 中文缺字 | 安装中文字体，确保运行用户可读，再重新渲染 |
| npm 安装 peer 冲突或很慢 | 保留随包 `.npmrc` 和 lock，检查 npm 网络；不要随意删 lock 改装依赖 |
| 显示已有实例或端口占用 | 停止已有服务后再启动，不删除活跃实例锁 |
| 重启后任务失败 | 属于中断恢复机制，用户重新提交 |
| 没有配音 | 本轮按要求暂停 TTS；音乐可由代码合成或上传，并混入 MP4 |

源码归档校验与重新打包方法见 `vendor/dsh/README.md` 及 `scripts/package-source.py`。
