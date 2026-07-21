use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// 统一错误格式：{"error":"message"} + 合适 HTTP 状态码
pub fn err_response(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

pub fn internal(msg: impl std::fmt::Display) -> Response {
    tracing::error!(error = %msg, "internal error");
    err_response(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
}
