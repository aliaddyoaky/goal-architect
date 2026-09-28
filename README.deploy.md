# 香港服务器部署

## 1. 准备服务器

使用香港 VPS 或云服务器，安装 Docker 和 Docker Compose。将域名解析到服务器公网 IP，并在服务器上配置 HTTPS 证书。

## 2. 构建和启动

```bash
cp .env.example .env
vi .env
docker build -t goal-architect:latest .
docker run -d \
  --name goal-architect \
  --restart unless-stopped \
  --env-file .env \
  -p 127.0.0.1:3001:3001 \
  -v goal-architect-dsh:/app/work/dsh-home \
  goal-architect:latest
```

容器启动后检查：

```bash
curl http://127.0.0.1:3001/api/health
```

## 3. 反向代理要求

`/api/agent/stream` 是 SSE 流式接口。反向代理需要关闭缓冲，增加读取超时，并透传 `text/event-stream`。不要让 CDN 缓存这个路径。

## 4. 运行时依赖

当前应用会启动 `DSH_COMMAND` 指定的 `dsh` 命令。正式部署前必须把 dsh 运行时和它需要的搜索工具装入镜像，或将 `DSH_COMMAND` 指向服务器上的可执行文件。

## 5. 当前版本限制

项目数据仍保存在浏览器 localStorage 中，适合个人或邀请制内测。公开使用前需要接入登录、数据库、备份和权限控制。
