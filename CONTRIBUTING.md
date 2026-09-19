# 贡献指南

感谢你愿意为 CircleChat 做贡献！本项目基于 [GPL-3.0-or-later](LICENSE) 开源。

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 环境准备

- Node.js ≥ 22.5（使用内建 `node:sqlite`，低版本会启动崩溃）。
- 其余环境要求与命令见 [README](README.md)。

```bash
npm install
npm run dev        # 开发模式：监听 src/ 增量构建 + 启动后端
```

## 分支模型

- `main`：**默认 / 稳定分支**，用于发布；生产服务器从 `main` 拉取部署。
- `dev`：日常开发分支，功能完成后再合并回 `main`。

请基于 `dev` 开发或开特性分支，通过 Pull Request / 合并请求提交。

## 提交前自检

请确保以下命令通过（CI 也会执行 `typecheck`）：

```bash
npm run typecheck  # 前端 vue-tsc + 后端 tsc
npm run build      # 确认可构建
```

## 提交信息

使用简洁的约定式提交前缀，例如：
`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` / `test:` / `build:` / `ci:`。

## 代码风格

- 前端使用 Vue 3 `<script setup lang="ts">`；后端位于 `server/lib/*.ts`。
- 遵循仓库根目录的 `.editorconfig`；行尾统一 LF（见 `.gitattributes`）。
- 不要提交 `data/`、`.output/`、`.nitro/`、`node_modules/` 等生成物（已在 `.gitignore` 忽略）。

## 安全

发现安全问题请**勿公开开 issue**，请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

提交贡献即表示你同意以 **GPL-3.0-or-later** 授权你的贡献。
