# CircleChat

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
![Vue 3](https://img.shields.io/badge/Vue-3-42b883.svg)
![Nitro](https://img.shields.io/badge/Nitro-node--server-00DC82.svg)
![i18n](https://img.shields.io/badge/i18n-zh%20%7C%20en%20%7C%20ja-blue.svg)

<!-- 若仓库镜像到 GitHub，可再加 CI 徽标（把 OWNER/REPO 换成实际路径）：
[![Lint](https://github.com/OWNER/REPO/actions/workflows/lint.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/lint.yml)
-->

自托管的轻量多人聊天服务器。单进程部署，支持群组 / 私聊，含好友关系、开放注册审核、在线状态、消息撤回、表情回应、举报处罚与审计日志。服务端零第三方运行时依赖。基于 [GPL-3.0](LICENSE) 开源。

## 环境要求

- Node.js ≥ 22.5（使用内建 `node:sqlite`，低版本会启动崩溃）
- 运行时自动生成 `data/`、`public/uploads/`

## 快速开始

```bash
npm install      # 首次安装前端构建依赖（仅构建期需要）
npm run build    # 构建前端与后端
npm start        # 启动服务，默认监听 0.0.0.0:8090
```

浏览器访问 `http://服务器IP:8090`，根路径 `/` 自动跳转登录页。

生产环境建议经 Nginx 反向代理并启用 HTTPS（WebSocket 升级需 `Upgrade` / `Connection` 头透传）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖（首次，或依赖变更后） |
| `npm run build` | 构建前端（Vite）与后端（Nitro） |
| `npm start` | 启动生产服务（默认 `0.0.0.0:8090`） |
| `npm run dev` | 开发模式：监听 `src/` 增量构建 + 启动后端（Nitro dev），改代码即时生效 |
| `npm run typecheck` | 类型检查（前端 `vue-tsc` + 后端 `tsc`，与 CI 一致） |
| `npm run adduser -- <用户名> [新密码]` | 用户管理：新增用户或重置密码 |

> CI：`.github/workflows/lint.yml` 在 push / PR 时执行 `npm run typecheck`。

## 分支与协作

- `main`：**默认 / 稳定分支**，用于发布；生产服务器从 `main` 拉取部署。
- `dev`：日常开发分支，功能完成后再合并回 `main`。

```bash
git checkout dev                 # 日常在 dev 上开发、提交
git push                         # 推送 dev

# 发布：把 dev 合入 main 并推送（服务器据此部署）
git checkout main && git merge dev && git push
```

> 远端名为 `CircleChat`（可用 `git remote -v` 查看）。

## 配置

| 项 | 方式 |
| --- | --- |
| 监听端口 | `PORT=8080 npm start`（默认 8090；由 `.output/server/index.mjs` 监听） |
| 上传保留天数 | `FILE_TTL_DAYS=30 npm start`（默认 15 天） |
| 显示 / 请求地址分离 | 编辑 `public/js/config.js` 的 `apiBase` / `displayBase`（无需重新构建） |

`public/js/config.js` 支持三种部署：同源（两项留空）、反代子路径（`apiBase: '/chat'`）、跨域（`apiBase: 'https://api.example.com'`）。

## 内置账号

首次启动若用户表为空，自动创建管理员 `admin` / `Admin1234`，部署后请尽快改密。老库升级自动补建 `admin` 且不覆盖任何已有密码。

## 安全与数据

- 密码 SHA256 加盐存储；HttpOnly 会话 Cookie（7 天）；同 IP 登录限速（5 次失败锁 10 分钟）。
- 上传类型白名单 + 图片魔数校验 + 路径穿越防护，单文件上限 20MB。
- 每个房间保留最近 500 条消息，持久化于 `data/chatplus.db`（SQLite）。
- 所有 HTTP 请求与 WebSocket 连接写入 `data/access.log`（应用层网络监控）。
- 后端核心模块位于 `server/lib/`（Nitro 版，由原 `server.js` + `lib/` 整体迁移而来），修改后端前请谨慎。
- 公共频道功能已移除，以「群组为主」；服务端房间模型仍保留群聊 / 私聊两类。

## 目录结构

```
CircleChat/
├── nitro.config.ts        # Nitro 配置（node-server 预设；serveStatic:false，静态由内部 serveStatic 服务）
├── tsconfig.json          # 前端类型检查（vue-tsc，覆盖 src/）
├── tsconfig.server.json   # 后端类型检查（tsc，覆盖 server/lib/）
├── server/
│   ├── lib/     # 后端模块（原 server.js + lib/ 的 1:1 迁移）：runtime/auth/store/groups/friends/ws/moderate/audit/log/migrate
│   ├── routes/  # routes/[...].ts 全量兜底路由，把请求转交 runtime.handleHttp
│   └── plugins/ # bootstrap（启动初始化）、ws（WebSocket 升级）
├── tools/       # adduser.ts（用户管理）、hljs-entry.mjs（highlight.js 打包入口）、security-test.js（安全自检）
├── src/         # 前端源码（Vue3 + TS）：main-{login,chat,group,admin}.ts、components/、core/、i18n/
├── public/      # 页面壳、js/config.js、dist/ 构建产物、css/、vendor/（本地自托管 highlight.js）
├── .github/     # workflows/lint.yml（CI：类型检查）
├── .output/     # Nitro 构建产物（node-server）：server/index.mjs
└── data/        # 运行时生成：chatplus.db、access.log
```

## 许可证

本项目以 [GNU GPL v3.0](LICENSE) 开源。使用、复制、修改与分发请遵守 GPL-3.0 条款；再分发时须附带本许可证并保留许可声明。本项目按「原样」提供，不提供任何担保。