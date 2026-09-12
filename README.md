# ChatPlus 私人聊天服务器

两人专用的私有聊天网页（文字 / 表情 / 图片 / 文件），纯公益用途。
版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。

## 特性

- 零第三方依赖：Node.js 原生 HTTP + 自研 WebSocket（RFC 6455）
- 账号：SHA256 加盐存储密码，登录会话 Cookie（7 天有效）
- 安全：登录限速（5 次失败锁定 10 分钟）、上传类型白名单 + 图片魔数校验、路径穿越防护
- 防注入：image/file 消息仅接受本服务器上传目录的合法 URL（服务器 + 前端双重校验，杜绝 `javascript:` 伪造链接 XSS）；WS 强制客户端掩码帧（RFC 6455）；非法 URL 编码与超限请求体不崩溃
- 数据：仅保留最近 500 条消息，持久化于 `data/messages.json`，被清理消息的上传文件自动删除
- Windows 系统通知：每账号独立开关（设置保存在账号数据里，换设备生效），页面在后台收到新消息时弹出系统通知
- 监控：所有 HTTP 请求与 WebSocket 连接写入 `data/access.log`（应用层网络监控）
- 前端：无任何外部 CDN 资源，秒开加载；显示地址与请求地址分离配置

## 内置账号（SHA256 加盐存储）

| 账号 | 密码 |
| --- | --- |
| `admin` | `Admin1234` |
> 密码哈希存于数据库（格式：`盐$SHA256(盐+密码)`），内无明文。
> 修改密码：`node tools/adduser.js <用户名> [新密码]`（不传新密码则交互输入）。

## 部署步骤

### 1. 环境要求

- Node.js 16 及以上（`node -v` 确认）

### 2. 上传与启动

将整个项目目录上传到服务器（如 `/opt/chatplus`），然后：

```bash
cd /opt/chatplus
node server.js          # 默认监听 0.0.0.0:8080
```

指定端口启动：`PORT=3000 node server.js`

浏览器访问 `http://服务器IP:8080` 即可。

### 3.（推荐）Nginx 反向代理 + HTTPS

```nginx
server {
    listen 80;
    server_name chat.example.com;

    # 可选：HTTPS 证书配置（certbot 等）
    location / {
        proxy_pass http://127.0.0.1:8080;
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

### 4.（推荐）systemd 常驻服务

`/etc/systemd/system/chatplus.service`：

```ini
[Unit]
Description=ChatPlus Private Chat
After=network.target

[Service]
WorkingDirectory=/opt/chatplus
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now chatplus
```

### 5. 防火墙

放行所用端口（示例）：

```bash
ufw allow 8080/tcp
```

## 配置说明（显示地址 / 请求地址分离）

编辑 `public/js/config.js`：

```js
window.CHAT_CONFIG = {
  apiBase: '',       // 请求地址：所有 API 与 WebSocket 的前缀（同源留空）
  displayBase: ''    // 展示地址：页面展示/分享的服务器地址（同源留空）
};
```

- 同源部署：两项均留空即可。
- 反代挂子路径（如 `/chat`）：`apiBase: '/chat'`。
- 前后端跨域：`apiBase: 'https://api.example.com'`，并确保 Nginx 允许跨域。

## 目录结构

```
ChatPlus/
├── server.js           # 主服务（HTTP + WebSocket + 上传 + 日志）
├── lib/
│   ├── auth.js         # SHA256 认证 / 会话 / 限速
│   ├── store.js        # 消息存储（最近 500 条）
│   ├── ws.js           # 自研 WebSocket 协议
│   └── log.js          # 访问日志
├── tools/
│   └── adduser.js      # 用户管理工具
├── data/
│   ├── users.json      # 账号（SHA256 加盐哈希）
│   ├── messages.json   # 最近消息
│   └── access.log      # 网络访问日志
└── public/
    ├── index.html      # 入口，自动跳转登录页
    ├── login.html      # 登录页（独立页面）
    ├── chat.html       # 聊天页（独立页面，未登录自动跳转登录）
    ├── css/style.css   # 登录页 + 聊天页共用样式（内联 SVG 图标，无外部 CDN）
    ├── js/config.js    # 前端配置（显示地址 / 请求地址分离）
    ├── js/login.js     # 登录页逻辑
    ├── js/chat.js      # 聊天页逻辑（含鉴权守卫）
    └── uploads/        # 上传的图片 / 文件
```

## 安全自检（可选）

```bash
node tools/security-test.js
```

模拟注入攻击实测：路径穿越、WS 伪造消息注入、未掩码帧、未授权访问、错误密码等，全部通过显示 ✔。

## 数据与隐私

- 消息、账号、日志均保存在 `data/` 目录，请定期备份该目录。
- 消息仅保留最近 500 条，超出自动裁剪。
- 上传上限单文件 20MB。