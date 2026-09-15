# CircleChat

自托管的轻量多人聊天服务器。单进程部署，支持群组 / 私聊，含好友关系、开放注册审核、在线状态、消息撤回、表情回应、举报处罚与审计日志。服务端零第三方运行时依赖。基于 GPL-3.0 开源。

版权 © 2026 Ctoy && EndlessPixel。详见 `LICENSE`。

## 环境要求

- Node.js ≥ 22.5（使用内建 `node:sqlite`，低版本会启动崩溃）
- 运行时自动生成 `data/`、`public/uploads/`

## 快速开始

```bash
npm install      # 首次安装前端构建依赖（仅构建期需要）
npm run build    # 构建前端到 public/dist/
npm start        # 启动服务，默认监听 0.0.0.0:8090
```

浏览器访问 `http://服务器IP:8090`，根路径 `/` 自动跳转登录页。

生产环境建议经 Nginx 反向代理并启用 HTTPS（WebSocket 升级需 `Upgrade` / `Connection` 头透传）。

## 开发

```bash
npm run dev:web     # 终端1：监听 src/ 改动，增量构建到 public/dist/
npm run dev:server  # 终端2：启动后端服务
npm run typecheck   # Vue + TS 类型检查
npm run adduser     # 用户管理：node tools/adduser.js <用户名> [新密码]
npm run build:hljs  # 重新打包本地自托管的 highlight.js
```

## 配置

| 项 | 方式 |
| --- | --- |
| 监听端口 | `PORT=8080 node server.js`（默认 8090） |
| 上传保留天数 | `FILE_TTL_DAYS=30 node server.js`（默认 15 天） |
| 显示 / 请求地址分离 | 编辑 `public/js/config.js` 的 `apiBase` / `displayBase`（无需重新构建） |

`public/js/config.js` 支持三种部署：同源（两项留空）、反代子路径（`apiBase: '/chat'`）、跨域（`apiBase: 'https://api.example.com'`）。

## 内置账号

首次启动若用户表为空，自动创建管理员 `admin` / `Admin1234`，部署后请尽快改密。老库升级自动补建 `admin` 且不覆盖任何已有密码。

## 安全与数据

- 密码 SHA256 加盐存储；HttpOnly 会话 Cookie（7 天）；同 IP 登录限速（5 次失败锁 10 分钟）。
- 上传类型白名单 + 图片魔数校验 + 路径穿越防护，单文件上限 20MB。
- 每个房间保留最近 500 条消息，持久化于 `data/chatplus.db`（SQLite）。
- 所有 HTTP 请求与 WebSocket 连接写入 `data/access.log`（应用层网络监控）。
- 部分后端核心文件（`lib/` 下）带完整性水印，改动可能触发校验，修改后端前请谨慎。
- 公共频道功能已移除，以「群组为主」；服务端房间模型仍保留群聊 / 私聊两类。

## 目录结构

```
CircleChat/
├── server.js   # 主服务（HTTP 路由 + WebSocket + 上传 + 管理员守卫）
├── lib/        # 后端模块：auth store groups friends ws moderate audit log migrate
├── tools/      # adduser.js（用户管理）、security-test.js（安全自检）
├── src/        # 前端源码（Vue3 + TS）：main-{login,chat,group,admin}.ts、components/、core/、i18n/
├── public/     # 页面壳、js/config.js、dist/ 构建产物、css/、vendor/（本地自托管 highlight.js）
├── data/       # 运行时生成：chatplus.db、access.log
└── server/     # 未接入的 TypeScript 版后端（保留参考，未使用）
```

## 许可证

本项目以 [GNU GPL v3.0](LICENSE) 开源。使用、复制、修改与分发请遵守 GPL-3.0 条款；再分发时须附带本许可证并保留版权与许可声明。本项目按「原样」提供，不提供任何担保。

版权 © 2026 Ctoy && EndlessPixel。