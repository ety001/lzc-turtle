# syntax=docker/dockerfile:1

########## 阶段 1：前端构建 ##########
FROM node:20-alpine AS ui-build
WORKDIR /build
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

########## 阶段 2：Rust 后端构建（musl 静态） ##########
FROM rust:1-alpine AS server-build
WORKDIR /build
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
RUN cargo build --release --locked

########## 阶段 3：精简运行时 ##########
FROM alpine:3.21
RUN apk add --no-cache su-exec ca-certificates tzdata
WORKDIR /app
COPY --from=server-build /build/target/release/turtle-server /app/turtle-server
COPY --from=ui-build /build/dist /app/dist
COPY deploy/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# 运行时契约：挂载 /config（SQLite + 可选 config.toml），暴露 8000 端口
ENV CONFIG_DIR=/config \
    STATIC_DIR=/app/dist \
    PORT=8000 \
    AUTH_MODE=oidc
VOLUME ["/config"]
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
