#!/usr/bin/env bash
# 用法: 在 Mac 上运行 ./deploy.sh
# 功能: 把项目同步到服务器，并在服务器上构建 + 启动 (docker compose up --build)
set -euo pipefail

# ============ 修改这里 ============
SERVER_USER="root"            # 服务器 SSH 用户名
SERVER_HOST="YOUR_SERVER_IP"  # 服务器公网 IP 或域名
REMOTE_DIR="/opt/goal-architect"
SSH_KEY="${SSH_KEY:-~/.ssh/id_ed25519}"
# ===================================

echo ">> 同步文件到 ${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}"
rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env.local' --exclude '.DS_Store' \
  -e "ssh -i ${SSH_KEY}" \
  ./ "${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}/"

echo ">> 在服务器上构建并启动"
ssh -i "${SSH_KEY}" "${SERVER_USER}@${SERVER_HOST}" \
  "cd ${REMOTE_DIR} && docker compose up -d --build"

echo ">> 完成。访问 https://${SITE_ADDRESS:-你的域名}"
