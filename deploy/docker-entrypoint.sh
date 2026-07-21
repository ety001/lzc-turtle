#!/bin/sh
# 小海龟画图 容器入口：支持 PUID/PGID 降权运行（默认 root）
set -e

CONFIG_DIR=${CONFIG_DIR:-/config}
mkdir -p "$CONFIG_DIR"

PUID=${PUID:-0}
PGID=${PGID:-0}

if [ "$PUID" != "0" ]; then
  chown -R "$PUID:$PGID" "$CONFIG_DIR" 2>/dev/null || true
  exec su-exec "$PUID:$PGID" /app/turtle-server
fi

exec /app/turtle-server
