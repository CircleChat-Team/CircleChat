# CircleChat 聊天服务器

自托管的轻量聊天服务：前后端一体、单进程部署，支持公共频道 / 群组 / 私聊，含好友关系、开放注册审核、在线状态、消息撤回、表情回应、系统通知与审计日志。本项目基于 GNU GPL v3.0 开源协议发布，欢迎自由使用、修改与分发。

版权 © 2026 Ctoy && EndlessPixel。详见 `LICENSE`。

## 特性

- **零第三方运行时依赖**：服务端仅用 Node.js 内建模块，包含自研 WebSocket（RFC 6455）。
- **多用户架构**：公共频道、群组、私聊三种房间；好友双向互加与好友申请；开放注册 + 管理员审核。
- **账号安全**：SHA256 加盐存储密码；登录会话 HttpOnly Cookie（7 天有效）；登录限速（同 IP 5 次失败锁定 10 分钟）。
- **上传安全**：上传类型白名单 + 图片魔数校验；路径穿越防护；单文件上限 20MB；上传文件 15 天后自动过期清理。
- **防注入 / XSS**：`image`/`file` 消息仅接受本服务器上传目录的合法 URL（服务端 + 前端双重校验，杜绝 `javascript:` 伪造链接）；WebSocket 强制客户端掩码帧（RFC 6455）；非法 URL 编码与超限请求体不崩溃。
- **数据**：每个房间各保留最近 500 条消息，持久化于 `data/chatplus.db`（SQLite）。被裁剪/撤回消息关联的上传文件自动删除。
- **在线状态与通知**：在线/离线 presence；每账号独立的 Windows 系统通知开关（保存在账号数据里，换设备生效），页面在后台收到新消息时弹出系统通知。
- **审计**：所有账号/群组/消息类敏感操作写入审计日志（仅管理员可见）；所有 HTTP 请求与 WebSocket 连接写入 `data/access.log`（应用层网络监控）。
- **前端**：基于 Vue 3 + TypeScript + Tailwind v4 构建，无任何外部 CDN 资源；代码高亮用本地自托管的 highlight.js（无 CDN）；内置中文 / 英文 / 日文三语言（vue-i18n）与深色模式。
- **部署灵活**：显示地址与请求地址分离配置，支持同源、反代子路径、跨域三种部署方式。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 服务端 | Node.js 原生 `http` + 自研 WebSocket（RFC 6455），零第三方运行时依赖 |
| 数据存储 | Node 内建 `node:sqlite`（SQLite，文件 `data/chatplus.db`） |
| 前端框架 | Vue 3 + TypeScript（多页：每个 HTML 壳一个挂载点） |
| 构建 | Vite 8 + `@vitejs/plugin-vue` + `@tailwindcss/vite`（Tailwind v4） |
| 国际化 | vue-i18n v11（中文 / 英文 / 日文） |
| 代码高亮 | highlight.js v11（本地自托管 `public/vendor/highlight.min.js`） |

## 环境要求

- **Node.js ≥ 22.5**（服务端使用了内建 `node:sqlite`，低版本会启动崩溃）。
- 一个可写入的本地目录（运行时生成 `data/`、`public/uploads/`）。

## 内置账号（SHA256 加盐存储）

首次启动若用户表为空，自动创建以下账号：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `Admin1234` | 管理员（可管理用户、撤回任意人的消息） |

> 密码哈希存于数据库（格式：`盐$SHA256(盐+密码)`），无明文。部署后请尽快修改密码。
> 修改 / 新建密码：`node tools/adduser.js <用户名> [新密码]`（不传新密码则交互输入）。
> 老库升级时会自动补建 `admin` 账号且不覆盖任何已存在的密码；旧版 JSON 用户数据会在首次启动时自动迁移进 SQLite 一次。

## 部署步骤

### 1. 上传与启动

```bash
cd /opt/circlechat
npm install          # 安装前端构建依赖（仅开发/构建阶段需要）
node server.js       # 默认监听 0.0.0.0:8090
```

指定端口启动：`PORT=8080 node server.js`
指定上传文件保留天数：`FILE_TTL_DAYS=30 node server.js`

浏览器访问 `http://服务器IP:8090` 即可（根路径 `/` 自动跳转登录页）。

### 2.（推荐）Nginx 反向代理 + HTTPS

```nginx
server {
    listen 80;
    server_name chat.example.com;

    # 可选：HTTPS 证书配置（certbot 等）
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # WebSocket 升级必需
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 3.（推荐）systemd 常驻服务

`/etc/systemd/system/circlechat.service`：

```ini
[Unit]
Description=CircleChat Private Chat
After=network.target

[Service]
WorkingDirectory=/opt/circlechat
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=PORT=8090

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now circlechat
```

### 4. 防火墙

放行所用端口（示例）：`ufw allow 8090/tcp`

## 配置说明（显示地址 / 请求地址分离）

编辑 `public/js/config.js`（部署时改此文件即可，无需重新构建）：

```js
window.CHAT_CONFIG = {
  apiBase: '',       // 请求地址：所有 API 与 WebSocket 连接前缀（同源留空）
  displayBase: ''    // 展示地址：页面展示/复制分享的服务器地址（同源留空）
};
```

- 同源部署：两项均留空。
- 反代挂子路径（如 `/chat`）：`apiBase: '/chat'`。
- 前后端跨域：`apiBase: 'https://api.example.com'`，并确保 Nginx 允许跨域。

## 启动与开发

### 生产运行

```bash
npm install      # 首次安装构建依赖（仅构建期需要）
npm run build    # 构建前端到 public/dist/
npm start        # 启动服务（node server.js），默认监听 0.0.0.0:8090
```

也可在构建后直接用 `node server.js` 启动，无需经 npm。

### 开发模式

前端源码在 `src/`，构建产物输出到 `public/dist/`，由 `server.js` 直接提供静态文件，因此开发时需同时运行「前端监听构建」与「后端服务」两个进程：

```bash
# 终端 1：监听 src/ 改动，自动增量构建到 public/dist/
npm run dev:web

# 终端 2：启动后端服务
npm run dev:server
```

> Linux / macOS 也可用一步命令 `npm run dev`（`vite build --watch` 在后台运行，并同时启动 `node server.js`）。

### 其它脚本

```bash
npm run typecheck   # 仅做 Vue + TS 类型检查（vue-tsc --noEmit），不产出构建
npm run build:hljs  # （可选）重新打包 highlight.js 到 public/vendor/highlight.min.js
npm run adduser     # 新建 / 修改用户密码：node tools/adduser.js <用户名> [新密码]
```

> 构建采用「手写 HTML 壳 + 固定文件名产物」模式：`public/*.html` 由服务端直接提供（其中 `/admin.html` 有服务端管理员守卫，不要改名以免绕过保护），`src/` 的构建产物输出到 `public/dist/assets/`，HTML 引用固定文件名。

## 安全自检（可选）

```bash
node tools/security-test.js
```

模拟注入攻击实测：路径穿越、WS 伪造消息注入、未掩码帧、未授权访问、错误密码等，通过显示 ✔。

## 目录结构

```
CircleChat/
├── server.js            # 主服务（HTTP + WebSocket + 上传 + 日志 + 管理员守卫）
├── lib/
│   ├── auth.js          # SHA256 认证 / 会话 / 登录限速 / 用户与角色
│   ├── store.js         # 消息存储（每房间 500 条裁剪、撤回、表情、文件过期）
│   ├── ws.js            # 自研 WebSocket 协议（RFC 6455）
│   ├── groups.js        # 群组 / 成员 / 入群申请
│   ├── friends.js       # 好友关系 / 私聊房间
│   ├── audit.js         # 审计日志
│   ├── log.js           # 访问日志
│   └── migrate.js       # 启动时表结构校验 / 自动补齐（向前兼容旧库）
├── tools/
│   ├── adduser.js       # 用户管理（新建 / 改密）
│   └── security-test.js # 安全自检脚本
├── src/                 # 前端源码（Vue3 + TS）
│   ├── main-{admin,login,group,chat}.ts   # 4 个入口，对应 4 个 HTML 页面
│   ├── App*.vue         # 各页根组件
│   ├── components/      # 24 个组件（admin / group / chat / common / login 分类）
│   ├── core/            # api / chat / config / dialog / emojis / format / i18n / nav / theme
│   ├── i18n/            # vue-i18n 实例与 zh/en/ja 文案
│   └── styles/          # Tailwind v4 入口
├── public/
│   ├── index.html / login.html / chat.html / group.html / admin.html  # 页面壳
│   ├── js/config.js     # 前端配置（显示地址 / 请求地址分离）
│   ├── dist/            # 构建产物（assets/ 下固定文件名）
│   ├── css/ styles/ vendor/   # 样式与本地自托管资源（highlight.js 等）
│   └── uploads/         # 上传的图片 / 文件（运行时生成）
└── data/
    ├── chatplus.db      # 账号 / 消息 / 群组 / 好友 / 审计（SQLite）
    └── access.log       # 网络访问日志
```

## 功能说明

- **房间类型**：公共频道（演进中）、群组、私聊（好友之间）；切换房间实时加载各自最近 500 条历史。
- **群组**：建群、入群申请与审核、成员管理与移除、群主转让、解散、群文件管理。
- **好友**：双向互加、好友申请、基于好友关系的私聊。
- **开放注册**：用户可提交注册申请，管理员在后台审核通过 / 拒绝。
- **消息能力**：文本（4096 字上限）、表情、图片 / 文件上传（20MB 上限，类型白名单 + 魔数校验）、引用回复、@提及、消息撤回（软删除）、表情回应（reaction）、正在输入（typing）提示。
- **多语言与主题**：内置中文 / 英文 / 日文切换；支持深色模式（跟随系统或手动）。

## 数据与隐私

- 账号、消息、群组、好友、审计均保存在 `data/chatplus.db`，访问日志在 `data/access.log`，请定期备份该目录。
- 每个房间仅保留最近 500 条消息，超出自动裁剪；关联的上传文件随之删除。
- 上传文件默认 15 天（可用 `FILE_TTL_DAYS` 覆盖）后从磁盘删除，过期消息展示「图片/文件已过期」。

## 备注

- 部分后端核心文件（`lib/` 下）带有完整性水印，改动可能触发作者预设的校验机制，修改后端前请谨慎。
- 公共频道正逐步被「群组为主」取代，属于演进中的中间态，服务端仍完整支持。

## 许可证

本项目以 [GNU General Public License v3.0](LICENSE)（GPL-3.0）开源发布。你可以自由地使用、复制、修改和分发本软件，但须遵守 GPL-3.0 的条款：再分发时须附带本许可证、保留版权与许可声明，并以相同协议（GPL-3.0 或更新版本）开源你修改后发布的版本。本项目按「原样」提供，不提供任何担保。

版权 © 2026 Ctoy && EndlessPixel。
