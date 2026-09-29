# 拿下大结果

一个把模糊目标拆成可执行路线的 AI 规划器。它会先通过对话厘清你想拿到的结果，再补齐时间、基础、限制和验收证据，最后生成一条可以马上开始执行的路线。

## 能做什么

- 用对话把一个模糊念头整理成清晰的大结果
- 识别目标、时间、现有筹码、投入成本、偏好、限制和完成证据
- 按阶段生成行动路线，并展示每一步的任务、资源、工具和验收标准
- 支持继续补充信息、重新生成路线和微调已有路线
- 在侧栏保存多个项目，并在浏览器本地恢复项目状态
- 提供演示模式：未配置 API 密钥时可以使用本地演示数据

## 技术栈

- Next.js 15 + React 19 + TypeScript
- `lucide-react` 图标
- Zod 数据结构校验
- DeepSeek / DSH 运行时，用于对话、资源检索和路线生成
- 浏览器 `localStorage` 保存项目、主题和布局设置

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

至少填写：

```env
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODEL=deepseek-flash
```

没有配置 `DEEPSEEK_API_KEY` 时，页面会自动使用演示模式，不会联网调用模型。

### 3. 启动开发服务器

```bash
npm run dev
```

打开 <http://localhost:3001>。

常用命令：

```bash
npm run typecheck  # TypeScript 类型检查
npm run build      # 构建生产版本
npm run start      # 启动生产版本
```

## 运行时说明

配置 API 密钥后，服务端会启动 `dsh` 子进程处理智能规划。需要确保以下条件满足：

1. 当前环境已经安装 `dsh`，并且命令可以在 PATH 中找到。
2. DeepSeek API 密钥有效，模型和兼容接口地址配置正确。
3. 如果使用代理，代理变量应由启动应用的终端或部署平台注入，不要把启动环境专用变量写进项目 `.env`。

未能启动 DSH 时，页面会保留已有信息，并显示运行诊断；修复运行时后可以重新尝试。

## API

- `POST /api/agent`：非流式规划接口
- `POST /api/agent/stream`：SSE 流式规划接口
- `GET /api/health`：健康检查
- `GET /api/resource-preview`：资源预览接口

健康检查示例：

```bash
curl http://localhost:3001/api/health
```

## Docker 部署

项目包含 `Dockerfile` 和香港服务器部署说明，具体步骤见 [README.deploy.md](./README.deploy.md)。生产环境建议：

- 使用 HTTPS 和反向代理
- 为 `/api/agent/stream` 关闭代理缓冲并设置足够长的读取超时
- 使用 Docker volume 持久化 DSH 运行时目录
- 将 API 密钥放在服务器环境变量或密钥管理服务中，不要提交到 Git

## 当前限制

- 项目数据目前保存在浏览器 `localStorage`，更适合个人使用或邀请制内测
- 尚未接入登录、数据库、云端同步、备份和细粒度权限控制
- 公开部署前应补充鉴权、限流、日志脱敏和 API 用量控制

## 项目结构

```text
app/
  page.tsx                 主界面和项目状态管理
  globals.css              全局样式
  api/agent/               智能规划接口
  api/health/              健康检查
lib/
  schema.ts                目标、问题和路线数据结构
  agent.ts                 演示模式与 DSH 模式入口
  dsh-agent.ts             DSH 运行时适配
  demo-agent.ts            本地演示数据
README.deploy.md           服务器部署说明
```

## License

当前仓库为私有产品项目，暂未发布开源许可证。
