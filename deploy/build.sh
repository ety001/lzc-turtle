#!/usr/bin/env bash
# 小海龟画图 — 懒猫 LPK 构建脚本（产出 contentdir = ./build-out）
# 用法：
#   ./deploy/build.sh                      # 默认 x86_64 微服
#   TARGET=aarch64-unknown-linux-musl ./deploy/build.sh   # ARM64 微服（需配置交叉链接器，见 README）
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${TARGET:-x86_64-unknown-linux-musl}"

echo "==> [1/3] 构建前端"
(cd ui && npm ci --no-audit --no-fund && npm run build)

echo "==> [2/3] 构建后端 ($TARGET, musl 静态)"
rustup target add "$TARGET" >/dev/null 2>&1 || true
(cd server && cargo build --release --locked --target "$TARGET")

echo "==> [3/3] 归置 contentdir -> ./build-out"
rm -rf build-out
mkdir -p build-out
cp "server/target/$TARGET/release/turtle-server" build-out/turtle-server
cp -r ui/dist build-out/dist

echo "完成。contentdir 内容："
ls -la build-out build-out/dist
