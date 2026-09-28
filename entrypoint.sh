#!/bin/sh
# Container entrypoint: ensure the dsh runtime home is writable by the
# unprivileged runtime user, then drop privileges and start Next.js.
set -e

mkdir -p /app/work/dsh-home
chown -R nextjs:nodejs /app/work/dsh-home

cd /app
exec su nextjs -s /bin/sh -c "node server.js"
