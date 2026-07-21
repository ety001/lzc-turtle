pub mod drawings;

use crate::auth::{oidc, require_auth, CurrentUser};
use crate::AppState;
use axum::extract::{Request, State};
use axum::http::{header, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{middleware, Extension, Json, Router};
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

pub fn build_router(state: Arc<AppState>) -> Router {
    let protected = Router::new()
        .route("/me", get(me))
        .route(
            "/drawings",
            get(drawings::list).post(drawings::create),
        )
        .route(
            "/drawings/{id}",
            get(drawings::get_one)
                .put(drawings::update)
                .delete(drawings::remove),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_auth,
        ));

    // API 子路由：挂在 /api 下，未匹配路径返回 JSON 404（契约错误格式），
    // 不会被 SPA fallback 吃掉
    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", get(oidc::login))
        .route("/auth/callback", get(oidc::callback))
        .route("/auth/logout", post(oidc::logout))
        .merge(protected)
        .fallback(api_not_found);

    // 静态托管：非 /api 路径 -> STATIC_DIR，缺失 fallback index.html（SPA，自带 mime）
    let index = state.config.static_dir.join("index.html");
    let serve = ServeDir::new(&state.config.static_dir)
        .not_found_service(ServeFile::new(index));

    Router::new()
        .nest("/api", api)
        .fallback_service(serve)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            spa_fallback_200,
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// /api 未匹配路径：统一 JSON 404（契约错误格式）
async fn api_not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "接口不存在" })),
    )
}

/// SPA 语义：GET 非 /api 路径未命中静态文件时，fallback index.html 且状态码 200
/// （ServeDir 的 not_found_service 会保留 404，这里统一改写；/api 的 404 不受影响）
async fn spa_fallback_200(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    let eligible = req.method() == Method::GET
        && !req.uri().path().starts_with("/api/");
    let resp = next.run(req).await;
    if eligible && resp.status() == StatusCode::NOT_FOUND {
        let index = state.config.static_dir.join("index.html");
        if let Ok(bytes) = tokio::fs::read(&index).await {
            return (
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                bytes,
            )
                .into_response();
        }
    }
    resp
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn me(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<CurrentUser>,
) -> Json<Value> {
    let mut v = json!({
        "id": user.id,
        "name": user.name,
        "auth_mode": state.config.auth_mode.as_str(),
    });
    if let Some(role) = user.role {
        v["role"] = json!(role);
    }
    if let Some(avatar) = user.avatar {
        v["avatar"] = json!(avatar);
    }
    Json(v)
}
