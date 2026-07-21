# 小海龟画图 — 产品与 API 契约（草案 v1，OIDC/打包细节待 lzc 文档调研回填）

## 功能范围（MVP）
1. 海龟命令编辑器：Logo 风格命令，支持英文核心命令 + 中文别名
2. Canvas 实时渲染：海龟位置/朝向、画笔轨迹、清屏、示例模板
3. 作品管理：保存（标题+源码+缩略图）、我的作品列表、加载、删除
4. 用户体系：仅 OIDC（按懒猫微服平台约定接入，细节待回填）

## 海龟命令语言（前后端共享契约，解释器在前端 TS 实现）
| 命令 | 别名 | 参数 | 语义 |
|---|---|---|---|
| FD n | 前进 | 像素 | 前进 |
| BK n | 后退 | 像素 | 后退 |
| RT deg | 右转 | 角度 | 顺时针转 |
| LT deg | 左转 | 角度 | 逆时针转 |
| PU / PD | 抬笔 / 落笔 | - | 画笔状态 |
| SETPC color | 画笔颜色 | #rrggbb 或颜色名 | 设置颜色 |
| SETPW n | 画笔粗细 | 像素 | 线宽 |
| HOME | 回家 | - | 回原点朝正上 |
| CS | 清屏 | - | 清空画布并复位 |
| REPEAT n [ ... ] | 重复 | 次数+块 | 循环（支持嵌套） |
| WAIT ms | 等待 | 毫秒 | 动画步进（可选） |

词法：大小写不敏感；注释以 `;` 或 `#` 开头到行尾；方括号成对。
执行模型：解析为 AST → 生成有序绘图指令流（moveTo/lineTo/pen 状态变更）→ Canvas 播放（可调速）。

## REST API 契约（前端 ↔ Rust 后端）
统一前缀 `/api`，鉴权方式待回填（lzc OIDC 约定）。所有接口需登录；作品按 owner 隔离。

- `GET  /api/health` → `{status:"ok"}`（无需登录）
- `GET  /api/me` → `{id, name, avatar?}`（当前 OIDC 用户）
- `GET  /api/drawings` → `[{id,title,thumbnail,created_at,updated_at}]`（当前用户的）
- `POST /api/drawings` body `{title, code, thumbnail(dataURL,<=200KB)}` → `{id}`
- `GET  /api/drawings/:id` → `{id,title,code,thumbnail,created_at,updated_at}`（仅 owner）
- `PUT  /api/drawings/:id` body `{title?, code?, thumbnail?}` → `{ok:true}`
- `DELETE /api/drawings/:id` → `{ok:true}`

错误格式：`{error:"message"}` + 合适 HTTP 状态码（401 未登录 / 403 非owner / 404 不存在）。

## SQLite 数据模型
```sql
CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,            -- OIDC 用户唯一标识（sub 或平台用户id）
  title TEXT NOT NULL,
  code TEXT NOT NULL,
  thumbnail TEXT,                 -- dataURL 缩略图
  created_at INTEGER NOT NULL,    -- unix 秒
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drawings_owner ON drawings(owner, updated_at DESC);
```
DB 文件位置：`$CONFIG_DIR/turtle.db`（配置目录挂载约定待回填）。

## 前端页面（React + TS + Vite）
- 单页：左侧编辑器（textarea + 示例下拉 + 运行/清屏/速度），右侧 Canvas（800x600 逻辑分辨率），顶栏（用户头像/名、保存、我的作品抽屉）
- 作品抽屉：缩略图网格，点击加载，删除按钮
- 未登录态：按 OIDC 流程引导（待回填）

## 后端技术选型
- Rust + axum + tokio + rusqlite(bundled) + serde + tower-http
- 依赖保持精简（沙箱 2 核编译，控制依赖树规模）
- 单二进制：内嵌/托管前端 dist 静态文件 + /api 路由

## 已定稿的部署与鉴权决策（v2 定稿，前后端必须遵守）

### 双部署模式
1. **懒猫 LPK 模式**：`lzc-manifest.yml` 用 `upstreams` + `disable_trim_location: true`（保留 `/api` 前缀，前后端路径全平台一致）+ `backend_launch_command` 启动 Rust 二进制；前端静态产物走 `routes: /=file:///lzcapp/pkg/content/dist`；环境变量 `AUTH_MODE=header`、`CONFIG_DIR=/lzcapp/var`、`STATIC_DIR=/lzcapp/pkg/content/dist`、`PORT=8000`。SQLite 落 `/lzcapp/var/turtle.db`。
2. **独立 Docker 模式**：单容器单端口。`docker run -v /host/config:/config -p 8080:8000 <image>`。二进制自己托管 `/api/*` + 静态前端（SPA fallback 到 index.html）。`AUTH_MODE=oidc`，OIDC 参数由环境变量或 `$CONFIG_DIR/config.toml` 提供。

### 三种 AUTH_MODE（后端实现，env `AUTH_MODE` 显式指定）
- `header`（懒猫用）：信任 `X-HC-User-ID`（uid）/`X-HC-User-Role`；无该 header → 401。**仅限 lzc-ingress 之后使用，独立部署严禁开启。**
- `oidc`（独立 Docker 默认）：标准 OIDC Authorization Code + PKCE。
  - 配置：`OIDC_ISSUER`（必需，做 `.well-known/openid-configuration` discovery）、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_REDIRECT_URL`（默认 `http://localhost:8000/api/auth/callback`）、`OIDC_SCOPES`（默认 `openid profile email`）。
  - 端点：`GET /api/auth/login`（跳 issuer，state/nonce/PKCE 存服务端临时表）、`GET /api/auth/callback`（换 token、JWKS 验签 id_token、校验 iss/aud/exp/nonce，建会话后 302 到 `/#/`）、`POST /api/auth/logout`。
  - 会话：sqlite `sessions` 表，cookie 名 `turtle_session`，HttpOnly + SameSite=Lax，32 字节随机 token（库内只存 sha256），默认 7 天过期滚动续期。用户唯一标识 = id_token `sub`，显示名取 `name`→`preferred_username`→`email`。
- `dev`（仅本地开发/冒烟测试）：固定用户 `dev-user`，无需任何配置。**文档中标注严禁生产使用。**

### 通用运行时配置（env 优先，其次 `$CONFIG_DIR/config.toml`）
- `CONFIG_DIR`：默认 `/config`（Docker）/ `./data`（本地 dev）；懒猫注入 `/lzcapp/var`
- `PORT`：默认 `8000`，监听 `0.0.0.0:$PORT`（懒猫模式由 ingress 转发，容器内监听即可）
- `STATIC_DIR`：默认 `./dist`（本地）/ `/app/dist`（Docker）；懒猫 `/lzcapp/pkg/content/dist`
- SQLite：`$CONFIG_DIR/turtle.db`，启动自动建表

### 前端约定
- hash 路由（`/#/`），所有 API 走相对路径 `/api/...`，同源无 CORS
- `GET /api/me` 返回 401 时显示登录页（oidc 模式跳 `/api/auth/login`；header 模式提示经懒猫入口访问）
- 缩略图：画布导出缩至 ~256px 宽 PNG dataURL（≤200KB）随保存上传
