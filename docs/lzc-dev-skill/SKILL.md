---
name: lzc-app-dev
description: 懒猫微服（LazyCat Cloud）应用开发技能。当需要在懒猫微服平台上开发、打包、部署应用（LPK/lzcapp）时使用，涵盖 lzc-cli、lzc-manifest.yml、package.yml、Docker 镜像、路由/端口、OIDC 单点登录、数据持久化（/lzcapp/var）与商店上架的全部关键规范。适用于开发 Rust/Go/Node 后端 + React/Vue 前端 + SQLite 的单容器 Web 应用。
---

# 懒猫微服（LazyCat Cloud）应用开发 Skill

> 本文全部事实提炼自官方开发者文档仓库 `https://gitee.com/lazycatcloud/lzc-developer-doc`（master 分支）。
> 文中标注【文档未覆盖】的条目表示文档中没有明确说明，实现时需自行验证或向官方确认。

## 0. 一句话心智模型

懒猫微服应用（lzcapp）= 一个 **LPK 包**（tar/zip 归档）+ 平台托管运行。
开发者把「镜像/二进制 + 静态资源 + 运行结构声明（lzc-manifest.yml）+ 元数据（package.yml）」打成 `.lpk`；
平台负责：HTTPS 终结、子域名分配、**登录鉴权（单点登录）**、反向代理、容器编排、数据目录挂载、应用唤醒。
**用户访问应用不需要处理端口映射**——平台按子域名（`<subdomain>.<微服名>.heiyu.space`）把所有 443 流量反代到应用。

## 1. 平台与运行机制

### 1.1 平台分层（framework.md）

1. **底层系统**：Mini 系统，只负责网络、安全认证、业务 OS 启动/更新。
2. **业务操作系统（lzcos）**：应用资源调度、网络隔离、应用管理。
3. **LPK 应用**：应用包格式，本质是容器技术，比 Docker 更强调安全与隔离（lzcos 1.3.x 起应用间网络隔离，应用之间默认不能互访）。
4. **开发者模式**：KVM / LightOS（传统 NAS 玩法，Docker 应在 LightOS 内使用），与标准应用分发无关。

开发模式分两种：**应用模式（lzcapp，本文档主题）** 与传统模式（KVM/LightOS）。面向普通用户分发必须走应用模式。

### 1.2 流量路径（lpk-how-it-works.md / http-request-headers.md）

```
客户端 → hportal 虚拟隧道 → 微服接入解密 → lzc-ingress
  ├─ HTTPS/HTTP：按 Host 子域名定位应用实例 → 校验登录态（cookie `HC-Auth-Token`）
  │    未登录且路径不在 public_path → 重定向到登录页
  │    → 注入用户身份 headers → 转发到应用 app service 的 lzcinit → 按 manifest routes/upstreams 分流
  └─ TCP/UDP：按 application.ingress 规则做 4 层转发（无鉴权、无 HTTP 语义）
```

关键推论：

- 应用**永远监听容器内端口**（如 `127.0.0.1:3000`），不需要、也不应该自己对外发布端口；「export 一个 web 端口给宿主机」在懒猫平台上等价于**在 manifest 里写一条 `routes` 规则**。
- 鉴权在平台 ingress 已完成；应用后端**直接信任 ingress 注入的 `X-HC-User-ID` 等 header** 即可（除非有对外公开 API 需求）。
- 容器内有一个特殊的内置 service 叫 `app`（由 application 段配置），`lzcinit` 是其中的 init/分流进程；其余容器在 `services` 下声明。

### 1.3 LPK 包格式（spec/lpk-format.md）

`.lpk` 是可打开的归档（v1=zip，v2=tar，v2 要求 lzcos v1.5.0+、lzc-cli v2.0.0+）：

```
.
├── manifest.yml      # 运行结构（lzc-manifest.yml 经 #@build 预处理后的产物）
├── package.yml       # 静态包元数据（LPK v2 必须）
├── content.tar[.gz]  # 可选，contentdir 打包的静态内容 → 运行时只读挂载到 /lzcapp/pkg/content
├── images/, images.lock  # 可选，embed 镜像 OCI layout
└── META/
```

- LPK v2 起，`package`/`version`/`name`/`description`/`locales`/`author`/`license`/`homepage`/`min_os_version`/`unsupported_platforms` **只能写在 `package.yml`**，不要写进 manifest。
- `.lpk` 可直接分享，用户把文件放进懒猫网盘点击即可安装；也可 `lzc-cli lpk install app.lpk` 安装。

## 2. 开发工具链：lzc-cli

### 2.1 环境搭建（lzc-cli.md / getting-started/env-setup.md）

```bash
# 前置：Node.js 18+（建议 LTS）；安装并登录懒猫微服客户端；商店里装「懒猫开发者工具」
npm install -g @lazycatcloud/lzc-cli
lzc-cli --version

# 系统依赖：Ubuntu/Debian: sudo apt install openssh-client rsync；macOS: brew install rsync openssh
# 首次准备 SSH key
[ -f ~/.ssh/id_ed25519.pub ] || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# 选择目标微服
lzc-cli box list && lzc-cli box switch <boxname> && lzc-cli box default
# 无客户端环境（WSL/LightOS）可改用 SSH 接入（需微服已开通 SSH，IP 必须是局域网 IP）
lzc-cli box add-by-ssh root <微服局域网IP>
# hclient 模式首次需授权公钥（add-by-ssh 模式不要执行这条）
lzc-cli box add-public-key
```

### 2.2 核心命令

| 命令 | 作用 |
| --- | --- |
| `lzc-cli project create <dir> -t <模板>` | 创建项目（模板如 `hello-vue`、`todolist-golang`） |
| `lzc-cli project deploy` | 构建并部署到目标微服（优先读 `lzc-build.dev.yml`） |
| `lzc-cli project info` | 查看部署状态、`Target URL`、`Build config` |
| `lzc-cli project start` | 启动应用 |
| `lzc-cli project exec [-s <service>] /bin/sh` | 进入容器 |
| `lzc-cli project log [-s <service>] -f` | 看日志 |
| `lzc-cli project sync --watch` | 持续同步本地代码到容器（后端调试用） |
| `lzc-cli project cp` | 拷贝文件 |
| `lzc-cli project build [-o out.lpk]` | 只构建 LPK（默认读 `lzc-build.yml`，可用 `-f` 指定） |
| `lzc-cli project release -o app.lpk` | 产出发布包（**永远使用 `lzc-build.yml`**） |
| `lzc-cli lpk install ./app.lpk` / `lzc-cli lpk info app.lpk` | 安装 / 查看 LPK |
| `lzc-cli appstore publish ./app.lpk` | 提交商店审核 |
| `lzc-cli appstore copy-image <公网镜像>` | 把镜像复制到官方 registry（上架前必须做，见 §7） |

约定：所有 `project` 命令输出里都有一行 `Build config`，告诉你本次实际使用了哪个构建配置；显式操作发布配置加 `--release`。

### 2.3 项目标准文件布局

```
.
├── package.yml          # 静态元数据（LPK v2 必备）
├── lzc-manifest.yml     # 运行结构：subdomain/routes/services/oidc...
├── lzc-build.yml        # 默认（release）构建配置
├── lzc-build.dev.yml    # 可选，开发态差异覆盖（dev 包名、DEV_MODE 等）
├── lzc-deploy-params.yml# 可选，安装时向用户收集的参数
└── icon.png             # 应用图标（仅允许 png）
```

`lzc-build.yml` 字段（spec/build.md）：`buildscript`（构建脚本/sh 命令）、`manifest`、`contentdir`（静态内容目录，空则不产出 content.tar）、`pkgout`、`icon`、`package_override`（顶层整体覆盖 package.yml）、`envs`（构建期 `KEY=VALUE` 数组）、`images`（Dockerfile 构建 embed 镜像）、`compose_override`、`resource_exports`。

典型 dev 覆盖：

```yml
# lzc-build.dev.yml
package_override:
  package: cloud.lazycat.app.turtle.dev   # 独立 dev 包名，不覆盖正式安装
contentdir:                                # 显式置空，避免误打包本地未构建产物
envs:
  - DEV_MODE=1
```

`lzc-manifest.yml` 支持构建期预处理指令（写在 YAML 注释里）：`#@build if profile=dev` / `#@build if env.DEV_MODE=1` / `#@build else` / `#@build end` / `#@build include ./x.yml`。用于让 dev-only 配置（如 request inject 代理到本机 dev server）不进入 release 包。

## 3. lzc-manifest.yml 核心字段（spec/manifest.md）

顶层：`usage`（首次访问渲染的使用须知）、`application`（lzcapp 核心配置）、`services`（附加容器）、`ext_config`。

### 3.1 application 关键字段

| 字段 | 说明 |
| --- | --- |
| `subdomain` | 应用入站子域名，最终域名 `<subdomain>.<微服名>.heiyu.space`（实际值可能带尾巴，运行时从环境变量 `LAZYCAT_APP_DOMAIN` 取） |
| `image` | app 容器镜像；支持 `embed:<alias>`；留空用系统默认镜像（alpine3.21） |
| `routes` | 简化 HTTP 路由，见 §4 |
| `upstreams` | 高级 HTTP 路由（可保留路径前缀、按域名前缀分流等），与 routes 共存 |
| `public_path` | 独立鉴权路径列表：未登录不跳登录页；鉴权失败会清空 X-HC-* headers |
| `oidc_redirect_path` | OIDC 回调路径；**设置后系统才会注入 OIDC 相关环境变量**，见 §5 |
| `environment` | app 容器环境变量（map 或 list） |
| `workdir` | app 容器工作目录 |
| `multi_instance` | 多实例（每用户独立容器，数据天然隔离）；默认单实例 |
| `ingress` | TCP/UDP 4 层转发，见 §4.4 |
| `injects` | 脚本注入（browser/request/response 三阶段） |
| `entries` | 多入口（启动器右键菜单展示多入口；lzcos v1.4.3+） |
| `health_check` | 健康检测；`test_url` 可直接给 HTTP URL 而不依赖容器内 curl |
| `user` / `run_as` | 容器运行用户。`run_as`（lzcos v1.6.0+）只接受数字 UID/GID，并会把 `/lzcapp` 持久目录 owner 映射为同身份；与 `user` 互斥 |
| `file_handler` | 声明可打开的文件类型，供网盘「打开方式」调用 |
| `depends_on` | 依赖本应用内其他 service（强制 healthy 检测） |

### 3.2 services（附加容器）关键字段

`image`、`environment`、`entrypoint`、`command`、`user`/`run_as`、`healthcheck`、`depends_on`、`cpu_shares`/`cpus`/`mem_limit`/`shm_size`、`network_mode`（仅 `host` 或空）、`runtime`（`runc`/`sysbox-runc`）、`setup_script`（以 root 先执行一段脚本再跑原始 entrypoint；与 entrypoint/command 冲突）、**`binds`**（数据持久化的关键，见 §6）。

注意：**service 名字不能用 `app`**（app 是内置特殊 service）。

## 4. 端口与路由（advanced-route.md / getting-started/http-route-backend.md）

### 4.1 routes 三种上游协议

规则形式：`URL_PATH=UPSTREAM`，按声明顺序匹配（更精确的规则放前面）。

- `file:///$dir` —— 静态文件，通常为打包进去的 `/lzcapp/pkg/content/...`（只读）
- `exec://$port,$exec_file` —— 启动该可执行文件，并把流量转发到 `http://127.0.0.1:$port`（host 隐含 127.0.0.1）
- `http(s)://$host/$path` —— 转发到本应用某个 service（`http://<service名>:<port>`，service 名运行时自动解析为容器 IP）或任意内外网地址

**重要：`routes` 转发时默认去掉 URL_PATH 前缀。** 例如 `- /api/=http://127.0.0.1:3000`，浏览器请求 `/api/v1/draw`，后端实际收到 `/v1/draw`。如需保留前缀，用 `upstreams` 并设 `disable_trim_location: true`（lzcos v1.3.9+）。

### 4.2 单容器 Web 应用的推荐形态（Rust 后端 + React 前端适用）

懒猫网盘官方应用的模式可直接套用：

```yml
# lzc-manifest.yml
application:
  subdomain: turtle
  routes:
    - /api/=exec://3000,/lzcapp/pkg/content/backend   # 启动后端二进制，转发到 127.0.0.1:3000
    - /=file:///lzcapp/pkg/content/dist               # React 构建产物
```

或更显式的 upstreams 写法（v1.3.8+）：

```yml
application:
  subdomain: turtle
  routes:
    - /=file:///lzcapp/pkg/content/dist
  upstreams:
    - location: /api
      backend: http://127.0.0.1:3000/
      backend_launch_command: /lzcapp/pkg/content/backend -listen :3000
      disable_trim_location: true   # 后端收到完整 /api/... 路径（lzcos v1.3.9+）
```

静态资源说明：`lzc-build.yml` 的 `contentdir` 内容在运行时**只读**出现在 `/lzcapp/pkg/content/`。React `build/dist` 产物放进 contentdir 即可；注意 SPA 的 history 路由 fallback 行为文档未专门说明【文档未覆盖，建议前端用 hash 路由或实测验证】。

### 4.3 public_path

默认所有路径受登录态保护。`public_path` 列表中的路径未登录也能访问（不跳登录页），但鉴权失败时 `X-HC-*` headers 会被清空——后端无需区分，**直接信任 `X-HC-User-ID`，为空即未登录**。只放开必要路径（如 `/api/health`）。

### 4.4 TCP/UDP（ingress，advanced-l4forward.md）

HTTP 服务不要用它。仅当需要非 HTTP 协议（SSH、数据库直连等）时：

```yml
application:
  ingress:
    - protocol: tcp
      port: 3306          # 目标端口；留空则等于实际入站端口
      service: mysql      # 目标 service，留空为 app
      publish_port: 1000-50000   # 允许的入站端口或范围
      send_port_info: false      # true 时 TCP 流开头写入 2 字节 little-endian 原始入站端口
```

警告：4 层转发**没有鉴权**；`port` 为 80/443 需显式 `yes_i_want_80_443: true`，且会绕过平台鉴权/证书/唤醒/routes，几乎不应使用。

## 5. 用户系统与 OIDC（http-request-headers.md / advanced-oidc.md）

懒猫平台有两种「免密登录」接入方式（上架审核**必须支持免密登录**，见 §7）。

### 5.1 方案 A（推荐，最简）：信任 ingress 注入的用户身份 header

lzc-ingress 鉴权成功后、转发给应用前会设置：

| Header | 含义 |
| --- | --- |
| `X-HC-User-ID` | 登录用户 UID（用户名） |
| `X-HC-User-Role` | `NORMAL` 普通用户 / `ADMIN` 管理员 |
| `X-HC-Device-ID` | 客户端在本微服内的唯一设备 ID |
| `X-HC-Device-PeerID` | 客户端 peerid（仅内部使用） |
| `X-HC-Device-Version` | 客户端内核版本号 |
| `X-HC-Login-Time` | 客户端最后一次登录时间（unix 时间戳 int32） |
| `X-HC-SOURCE` | 请求来源：`client` / `app:self` / `app:<pkg_id>` / `system`（系统生成，不可信客户端自传值） |
| `X-Forwarded-Proto` | 固定 `https` |
| `X-Forwarded-By` | 固定 `lzc-ingress` |
| `X-HC-User-Ticket` | 用户票据（lzcos v1.5.2+；当前版本可能默认提供，**未来需显式授权，不要依赖其默认存在**） |

后端规范（文档原文结论）：「lzcapp 开发者在编写后端代码时，不用考虑是否为 public_path，**直接信任 `X-HC-User-ID`** 即可」。

> 对「小海龟画图」这类自研应用，方案 A 足够：请求里没有 `X-HC-User-ID` 就说明未登录（public_path 场景）或请求不可能到达（受保护路径 ingress 已拦截）。用 `X-HC-User-ID` 做数据归属字段、用 `X-HC-User-Role == "ADMIN"` 做管理员判断即可。

### 5.2 方案 B：应用内对接标准 OIDC（lzcos v1.3.5+）

适用于应用自身已有 OIDC 登录模块的场景（如移植 Outline 等开源应用）。

1. manifest 中设置 `application.oidc_redirect_path`（常见为 `/oauth2/callback` 或 `/auth/oidc.callback`；不确定可先随便填，登录报错页会显示正确值）。
2. 设置后，系统在部署阶段注入以下变量，manifest 里用 `${VAR}` 引用（advanced-envs.md）：

| 变量 | 说明 |
| --- | --- |
| `LAZYCAT_AUTH_OIDC_CLIENT_ID` | OAuth client id（通常为 appid） |
| `LAZYCAT_AUTH_OIDC_CLIENT_SECRET` | 安装阶段随机生成，**每次容器重启都会变，不要入库** |
| `LAZYCAT_AUTH_OIDC_ISSUER_URI` | issuer 地址 |
| `LAZYCAT_AUTH_OIDC_AUTH_URI` / `_TOKEN_URI` / `_USERINFO_URI` | 各 endpoint |

完整 issuer 信息：`https://$微服名.heiyu.space/sys/oauth/.well-known/openid-configuration`（RS256；支持 grant: authorization_code/refresh_token/device_code/token-exchange；scope: openid/email/groups/profile/offline_access）。

3. 将变量映射给应用自身要求的环境变量，例如：

```yml
application:
  subdomain: myapp
  oidc_redirect_path: /auth/oidc.callback
services:
  myapp:
    image: registry.lazycat.cloud/<user>/<img>:<hash>
    environment:
      - OIDC_CLIENT_ID=${LAZYCAT_AUTH_OIDC_CLIENT_ID}
      - OIDC_CLIENT_SECRET=${LAZYCAT_AUTH_OIDC_CLIENT_SECRET}
      - OIDC_AUTH_URI=${LAZYCAT_AUTH_OIDC_AUTH_URI}
      - OIDC_TOKEN_URI=${LAZYCAT_AUTH_OIDC_TOKEN_URI}
      - OIDC_USERINFO_URI=${LAZYCAT_AUTH_OIDC_USERINFO_URI}
```

适配后可自动获取 uid 与权限组（`ADMIN` 代表管理员）。

### 5.3 其他

- ingress 侧鉴权 cookie 名：`HC-Auth-Token`（浏览器场景；客户端内走内部方式）。
- 脚本/CI 访问系统 API 可用 API Auth Token（lzcos v1.4.3+）：微服上 `hc api_auth_token gen`，调用时带 header `Lzc-Api-Auth-Token: <token>`；该 header 转发到应用前会被移除。
- 容器内与系统交互可用 Lzc-SDK（目前仅 Go 与 JS/TS：npm `@lazycatcloud/sdk`、go `gitee.com/linakesi/lzc-sdk/lang/go`；**Rust 版 SDK 文档未提供**——Rust 后端不需要 SDK 也能完成上述全部能力，header/环境变量机制与语言无关）。

## 6. 数据持久化（advanced-file.md / spec/manifest.md binds）

### 6.1 容器内挂载点

| 路径 | 语义 |
| --- | --- |
| `/lzcapp/var` | **应用持久化数据目录。重启、升级保留；卸载时用户勾选「并清理数据」才删除。SQLite 数据库文件放这里** |
| `/lzcapp/cache` | 缓存目录，用户可手动清理；放日志/临时文件 |
| `/lzcapp/pkg` | 应用静态资源（含 manifest），**只读** |
| `/lzcapp/pkg/content` | contentdir 打包内容，**只读** |
| `/lzcapp/run` | 运行态目录（如渲染后的 `/lzcapp/run/manifest.yml`） |
| `/lzcapp/documents/<uid>` | 应用文稿目录（需在 package.yml 声明 `document.private` 权限；按用户隔离；**只放用户能直接理解的文件，不放数据库/索引/配置**） |
| `/lzcapp/run/mnt/home` | 已废弃的用户文稿兼容路径（v1.7.0 起需管理员授权） |

规则：**lzcapp 容器 rootfs 重启后丢失，仅 `/lzcapp/var` 与 `/lzcapp/cache` 永久保留**。manifest 的 `binds` 只支持把 `/lzcapp` 开头的路径绑到容器内其他路径，格式 `/lzcapp/var/<subdir>:<容器内路径>`：

```yml
services:
  mysql:
    image: registry.lazycat.cloud/mysql
    binds:
      - /lzcapp/var/mysql:/var/lib/mysql
```

注意（faq-dev.md）：打进镜像/包的资源文件**不能放在 `/lzcapp/` 目录下**（运行时被覆盖）；`/lzcapp/pkg/content` 只读，脚本需要写文件时改写到 `/lzcapp/var` 或 `/lzcapp/cache`，或用 `application.workdir` 改工作目录。权限问题用 `user`/`run_as`，不要 `chown`（advanced-file.md 明确禁止用 setup_script chown）。

### 6.2 本项目（Rust + SQLite）落点

- SQLite 文件路径：容器内固定写 `/lzcapp/var/data/turtle.db`（或 `/lzcapp/var/turtle.db`），首次启动自行 `CREATE TABLE IF NOT EXISTS`。
- 「把配置目录挂载进容器」在懒猫上的对应做法：配置/数据一律写 `/lzcapp/var`（平台自动持久化）；若程序硬编码了别的路径，用 `binds` 把 `/lzcapp/var/xxx` 绑过去。
- 用户保存的画作若希望用户在网盘里直接看到 → 申请 `document.private` 权限并写 `/lzcapp/documents/<uid>`；否则留在 `/lzcapp/var`。

### 6.3 运行时/部署时环境变量（advanced-envs.md）

每个容器运行时自动注入：`LAZYCAT_APP_ID`、`LAZYCAT_APP_SERVICE_NAME`、`LAZYCAT_APP_DOMAIN`（不要永久存储，重启可能变）、`LAZYCAT_BOX_DOMAIN`、`LAZYCAT_BOX_NAME`、`LAZYCAT_APP_DEPLOY_UID`（多实例时所属用户，单实例为空）。

部署阶段（系统解析 manifest 时）可用 `${...}` 引用的变量：上述全部（除 SERVICE_NAME）+ `LAZYCAT_APP_DEPLOY_ID` + OIDC 系列（仅当设置了 `oidc_redirect_path`）。

### 6.4 部署参数与 manifest 渲染（spec/deploy-params.md / advanced-manifest-render.md）

- `lzc-deploy-params.yml` 定义安装时向用户收集的参数：`id`、`type`（`bool`/`string`/`secret`/`lzc_uid`）、`name`、`description`、`optional`、`default_value`（支持 `$random(len=5)`）、`hidden`。
- 安装时系统用 text/template 渲染 manifest：用户参数 `{{ .U.xxx }}`（含点的 key 用 `{{ index .U "a.b" }}`），系统参数 `{{ .S.BoxName }}` / `.S.BoxDomain` / `.S.OSVersion` / `.S.AppDomain` / `.S.IsMultiInstance` / `.S.DeployUID` / `.S.DeployID`；支持 sprig 函数（除 env/expandenv）和 `{{ stable_secret "seed" }}`（同微服同应用内稳定的随机密码）。
- 最终渲染结果写入 `/lzcapp/run/manifest.yml`，可 `cat` 调试。

## 7. Docker 镜像要求与商店上架

### 7.1 镜像来源三种方式

1. **远程镜像引用**：`image: registry.lazycat.cloud/<社区用户名>/<镜像>:<IMAGE_ID哈希tag>`。上架前必须先用 `lzc-cli appstore copy-image <公网镜像>` 把镜像复制到官方 registry 并改用返回的引用（tag 会被替换成 IMAGE_ID；服务端强制 pull，因此镜像必须先存在于公网；registry.lazycat.cloud 微服外使用限速）。
2. **embed 内嵌镜像**（LPK v2）：在 `lzc-build.yml` 的 `images` 里用 Dockerfile 构建，manifest 里用 `embed:<alias>` 引用：

```yml
# lzc-build.yml
images:
  app-runtime:
    dockerfile: ./Dockerfile        # 或 dockerfile-content（二选一）
    context: .                      # 可选
    upstream-match: registry.lazycat.cloud   # 可选，默认此前缀；命中上游则混合分发，未命中全量内嵌
```

3. **application.image 留空**：使用系统默认镜像（alpine3.21），二进制通过 contentdir 带入（适合静态编译的 Rust/Go 单二进制）。

### 7.2 镜像内允许/禁止

- 默认以 root 运行；可用 `user`/`run_as` 调整（run_as 会同步 `/lzcapp` 持久目录 owner，lzcos v1.6.0+）。
- 不要把需要保留的数据写到 `/lzcapp/var`、`/lzcapp/cache` 之外；rootfs 重启即丢。
- 不要把打包资源放 `/lzcapp/` 下（被覆盖）。
- `network_mode: host` 可用但非必要不用；监听务必鉴权，非必要不要监听 `0.0.0.0`。
- **CPU 架构要求（amd64/arm64）与基础镜像限制：【文档未覆盖】**。中文文档中未规定镜像架构或多架构 manifest 要求，仅在社区心得文章中提到「ARM 机器运行 X86 镜像」的玩法。打包 Rust 应用时建议按目标微服实际架构编译（微服常见为 x86_64 与 ARM64 设备），上架前向官方确认。

### 7.3 上架要求摘要（store-submission-guide.md / store-rule.md / publish-app.md）

- 名称、描述、使用须知需多语言：`package.yml` 的 `locales`（BCP 47 key，如 `zh-CN`/`en`），未命中语言回退顶层 `name`/`description`。
- 图标 png（`lzc-build.yml` 的 `icon` 字段，仅允许 png）。
- **必须支持免密登录**：OIDC 对接或 inject 自动填充（`builtin://simple-inject-password`），用户安装后无需手动输账号密码。
- 有上传/下载功能的应用必须接入懒猫网盘文件选择器自动拦截（见 lazycat-file-picker-auto-intercept.md）。
- 数据持久化要经得起重启/升级；升级已有应用不要轻易做实例变更（会导致存储路径变化，需自行迁移数据）。
- 应用启动/响应不超过 5 分钟；复杂应用需配攻略；纯英文界面不予上架。
- 镜像必须引用 registry.lazycat.cloud（先 copy-image），否则审核人员无法安装会审核失败。
- 提交流程：注册开发者 → `lzc-cli project build` → `lzc-cli appstore publish ./app.lpk`（或在开发者中心网页提交）。

## 8. 典型开发流程（getting-started/*）

```bash
# 1. 创建（可选，也可手写 4 个配置文件）
lzc-cli project create turtle -t hello-vue && cd turtle

# 2. 开发态部署（使用 lzc-build.dev.yml，落到独立 dev 包名）
lzc-cli project deploy
lzc-cli project info        # 看 Build config / Target URL / 是否 running

# 3a. 前端联调：打开应用后启动本机 dev server（request inject 把流量转到开发机）
npm run dev

# 3b. 后端联调（Rust）：代码同步进真实容器运行
lzc-cli project sync --watch
lzc-cli project exec /bin/sh   # 进容器手动启动后端
lzc-cli project log -f

# 4. 发布
lzc-cli project release -o turtle.lpk
lzc-cli lpk install ./turtle.lpk      # 本地验证安装
```

## 9. 小海龟画图应用（Rust + SQLite + React）配置骨架

以下为依据上述规范推导的骨架（标注【假设】处为文档未明确给出、按惯例补全）：

```yml
# package.yml
package: cloud.lazycat.app.turtle
version: 0.1.0
name: 小海龟画图
description: 小海龟画图（Logo/Turtle 绘图）
locales:
  zh-CN:
    name: 小海龟画图
    description: 小海龟画图（Logo/Turtle 绘图）
  en:
    name: Turtle Drawing
    description: Turtle graphics drawing app
permissions:
  required:
    - net.internet        # 【假设】如不需要外网可去掉
```

```yml
# lzc-manifest.yml
application:
  subdomain: turtle
  # 方案A：不配 oidc，后端直接信任 X-HC-User-ID（推荐，平台已完成 SSO）
  routes:
    - /api/=exec://3000,/lzcapp/pkg/content/turtle-server
    - /=file:///lzcapp/pkg/content/dist
```

```yml
# lzc-build.yml
buildscript: ./build.sh    # cargo build --release && npm run build，产物归置到 dist/
contentdir: ./dist         # 内含 turtle-server（静态编译的 Rust 二进制）+ dist/（React 产物）
pkgout: ./
icon: ./icon.png
```

```bash
# build.sh 内容要点【假设，按惯例】：
#   cargo build --release --target <目标微服架构>
#   mkdir -p dist && cp target/<arch>/release/turtle-server dist/
#   cd ui && npm ci && npm run build && cp -r dist ../dist/dist
```

后端约定：

- 监听 `127.0.0.1:3000`（exec 路由隐含 host 为 127.0.0.1）；处理路径时注意 `routes` 已去掉 `/api/` 前缀。
- SQLite 打开 `/lzcapp/var/turtle.db`（自动持久化）。
- 从请求头 `X-HC-User-ID` 取用户、`X-HC-User-Role` 判管理员；无需自行实现登录。
- 二进制放在只读的 `/lzcapp/pkg/content/` 下，日志/临时文件写 `/lzcapp/cache`。

## 10. 速查表

| 需求 | 做法 |
| --- | --- |
| 暴露 web 服务 | `application.routes: - /=exec://<port>,<二进制>` 或 `http://<service>:<port>`；无需发布端口 |
| 静态前端 | contentdir 打包 → `file:///lzcapp/pkg/content/dist` |
| 知道当前用户 | 读 header `X-HC-User-ID`；管理员 = `X-HC-User-Role: ADMIN` |
| 应用内 OIDC | `application.oidc_redirect_path` + `${LAZYCAT_AUTH_OIDC_*}` |
| 数据持久化 | 写 `/lzcapp/var`（SQLite 就放这）；重启/升级保留 |
| 免登录公开接口 | `application.public_path` |
| 非 HTTP 端口 | `application.ingress`（无鉴权，自行处理安全） |
| 多用户隔离 | 默认单实例自行按 uid 分库分表；或 `multi_instance: true` 每用户一个容器 |
| 安装时收参 | `lzc-deploy-params.yml` + manifest 里 `{{ .U.x }}` |
| 稳定随机密码 | manifest 里 `{{ stable_secret "seed" }}` |
| 进容器调试 | `lzc-cli project exec /bin/sh`；日志 `lzc-cli project log -f` |
| 发布 | `lzc-cli project release -o app.lpk` |

## 11. 文档未覆盖/需验证清单

1. 镜像 CPU 架构（amd64/arm64）要求、多架构 manifest 支持：未明确规定。
2. SPA history 路由在 `file://` 路由下的 fallback（404 回退 index.html）行为：未说明。
3. Rust 版 Lzc-SDK：不存在（仅 Go/JS）；Rust 后端用 header/env 机制即可。
4. 应用级备份/恢复 API 与升级钩子：文档只有「/lzcapp/var 升级保留」「升级勿轻易变更实例」的约定，无专门备份机制说明。
5. `X-HC-User-Ticket` 的长期可用性：当前默认注入是临时行为，lzcos v1.7.x 起将改为需用户显式授权。
