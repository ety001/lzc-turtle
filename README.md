# 小海龟画图（lzc-turtle）

用 Logo 风格命令指挥小海龟在画布上作画的 Web 应用。

- **后端**：Rust（axum 0.8）+ SQLite（rusqlite，零外部服务依赖）
- **前端**：React 18 + TypeScript + Vite，Canvas 渲染，支持中英文命令
- **用户系统**：仅 OIDC（独立部署走标准 OIDC 授权码 + PKCE 流程；懒猫微服上由平台 SSO 接管）
- **部署**：单容器、单端口；只需挂载一个配置目录 + 映射一个 Web 端口即可使用

## 功能

- 海龟命令编辑器：行号、语法错误带行号提示、6 个内置示例（含中文命令示例）
- Canvas 实时作画：速度调节（1x/5x/20x/瞬时）、停止、清屏
- 作品管理：保存（自动生成缩略图）、加载、更新、删除；按用户隔离
- 双部署模式：独立 Docker / 懒猫微服（LazyCat Cloud）LPK

## 一、独立 Docker 部署（通用）

### 构建并运行

```bash
docker build -t lzc-turtle .
docker run -d --name lzc-turtle \
  -p 8080:8000 \
  -v /srv/turtle-config:/config \
  -e OIDC_ISSUER="https://your-idp.example.com" \
  -e OIDC_CLIENT_ID="turtle" \
  -e OIDC_CLIENT_SECRET="change-me" \
  -e OIDC_REDIRECT_URL="http://localhost:8080/api/auth/callback" \
  -e PUID=1000 -e PGID=1000 \
  lzc-turtle
```

访问 `http://localhost:8080`，自动跳转 OIDC 登录，登录成功回到应用。

也可 `docker compose up -d`（先编辑 `docker-compose.yml` 里的 OIDC 参数）。

### OIDC 配置要点

- `OIDC_ISSUER`：必须支持 discovery（`{issuer}/.well-known/openid-configuration`），Keycloak / Authentik / Authelia / 懒猫微服 issuer 均可
- `OIDC_REDIRECT_URL`：必须在 IdP 侧登记为合法回调地址，且协议+主机+端口与外部访问地址完全一致
- 放到 HTTPS 反代之后时，建议 `-e COOKIE_SECURE=true`

### 配置项（环境变量优先，也可用 `$CONFIG_DIR/config.toml`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CONFIG_DIR` | `/config` | 配置目录（turtle.db + 可选 config.toml），**务必挂载** |
| `PORT` | `8000` | Web 端口 |
| `LISTEN_ADDR` | `0.0.0.0` | 监听地址 |
| `STATIC_DIR` | `/app/dist` | 前端静态文件目录（镜像内置，无需改） |
| `AUTH_MODE` | `oidc` | `oidc` / `header` / `dev`（见安全警告） |
| `OIDC_ISSUER` | — | oidc 模式必填 |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | — | oidc 模式必填（secret 可留空走 PKCE 公共客户端） |
| `OIDC_REDIRECT_URL` | `http://localhost:8000/api/auth/callback` | 回调地址 |
| `OIDC_SCOPES` | `openid profile email` | 按需 |
| `COOKIE_SECURE` | `false` | HTTPS 部署设 `true` |
| `PUID` / `PGID` | `0` | 非 0 时以该 uid/gid 运行并 chown 配置目录 |
| `TZ` | UTC | 时区 |

配置文件方式示例见 `deploy/config.example.toml`，放进挂载的配置目录即可。

### 安全警告

- `AUTH_MODE=header` **仅限懒猫微服 lzc-ingress 之后使用**（平台已完成鉴权并注入身份头）。独立部署开启等于无鉴权裸奔，严禁。
- `AUTH_MODE=dev` 是固定用户 dev-user 的免登录模式，**仅限本地开发**。

### 数据与备份

所有数据（作品、会话）都在 `$CONFIG_DIR/turtle.db` 一个 SQLite 文件里，备份 = 备份该文件。

## 二、懒猫微服部署（LPK）

平台已由 lzc-ingress 完成 SSO（OIDC），应用直接信任注入的 `X-HC-User-ID` 身份头，用户经懒猫入口访问无需二次登录。数据落 `/lzcapp/var` 由平台自动持久化，无需映射端口。

```bash
# 前置：Node 18+，npm i -g @lazycatcloud/lzc-cli，已登录并 box switch 到目标微服

# 开发态部署（独立 dev 包名 cloud.lazycat.app.turtle.dev）
lzc-cli project deploy

# 发布包（默认 x86_64 微服；ARM64 微服先 export TARGET=aarch64-unknown-linux-musl 并配好交叉链接器）
lzc-cli project release -o turtle.lpk
lzc-cli lpk install ./turtle.lpk    # 本机验证安装
```

项目根的四件套：`package.yml`（元数据）、`lzc-manifest.yml`（路由/upstreams/header 模式注入）、`lzc-build.yml` / `lzc-build.dev.yml`（构建配置，调用 `deploy/build.sh` 产出 `build-out/`）。完整的懒猫开发规范摘要见 `docs/lzc-dev-skill/SKILL.md`。

## 三、本地开发

```bash
# 后端（终端 1）
cd server
AUTH_MODE=dev CONFIG_DIR=./data PORT=8000 STATIC_DIR=../ui/dist cargo run

# 前端（终端 2，vite dev server 代理 /api → :8000）
cd ui && npm install && npm run dev
```

## 海龟命令速查

| 命令 | 中文别名 | 说明 |
| --- | --- | --- |
| `FD n` / `BK n` | 前进 / 后退 | 移动 n 像素 |
| `RT deg` / `LT deg` | 右转 / 左转 | 旋转角度 |
| `PU` / `PD` | 抬笔 / 落笔 | 画笔状态 |
| `SETPC c` | 画笔颜色 | `#rrggbb` 或颜色名 |
| `SETPW n` | 画笔粗细 | 线宽 |
| `HOME` / `CS` | 回家 / 清屏 | 复位 / 清屏复位 |
| `REPEAT n [ ... ]` | 重复 | 循环，支持嵌套 |

大小写不敏感；`;` 行内注释，`#` 整行注释。

示例（五角星）：`REPEAT 5 [FD 200 RT 144]`

## 项目结构

```
.
├── Dockerfile              # 多阶段：node 构建前端 → rust 构建后端 → alpine 运行时
├── docker-compose.yml      # 便捷启动（非必需）
├── package.yml             # 懒猫 LPK 元数据
├── lzc-manifest.yml        # 懒猫运行结构（路由/upstreams/环境变量）
├── lzc-build.yml           # 懒猫 release 构建
├── lzc-build.dev.yml       # 懒猫 dev 构建
├── deploy/                 # build.sh、docker-entrypoint.sh、config.example.toml、icon.png
├── server/                 # Rust 后端（axum + rusqlite）
│   └── src/                # config / db / auth(header,oidc,dev) / routes
├── ui/                     # React 前端
│   └── src/turtle/         # 海龟命令解释器（lexer → parser → 指令流）
└── docs/                   # API 契约 + lzc-dev-skill（懒猫开发规范摘要）
```

## 已知限制

- 并发写经全局互斥串行化（个人/家庭规模足够）
- OIDC 的 JWKS 每次回调现拉未缓存
- 懒猫 SPA history 路由 fallback 平台行为未明确，前端采用 hash 路由规避
- 上架懒猫商店前需 `lzc-cli appstore copy-image` 及补齐多语言等信息（见 docs/lzc-dev-skill/SKILL.md §7）
