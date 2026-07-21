use crate::auth::CurrentUser;
use crate::db;
use crate::error::{err_response, internal};
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

const MAX_THUMBNAIL_BYTES: usize = 200 * 1024; // 契约：缩略图 dataURL <= 200KB

#[derive(Debug, Deserialize)]
pub struct CreateReq {
    title: String,
    code: String,
    thumbnail: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReq {
    title: Option<String>,
    code: Option<String>,
    thumbnail: Option<String>,
}

/// GET /api/drawings —— 当前用户的作品列表（不含 code）
pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<CurrentUser>,
) -> Response {
    let conn = state.db.lock().unwrap();
    let mut stmt = match conn.prepare(
        "SELECT id, title, thumbnail, created_at, updated_at FROM drawings \
         WHERE owner = ?1 ORDER BY updated_at DESC",
    ) {
        Ok(s) => s,
        Err(e) => return internal(e),
    };
    let rows = stmt.query_map(params![user.id], |row| {
        Ok(json!({
            "id": row.get::<_, i64>(0)?,
            "title": row.get::<_, String>(1)?,
            "thumbnail": row.get::<_, Option<String>>(2)?,
            "created_at": row.get::<_, i64>(3)?,
            "updated_at": row.get::<_, i64>(4)?,
        }))
    });
    match rows {
        Ok(mapped) => {
            let mut out = Vec::new();
            for r in mapped {
                match r {
                    Ok(v) => out.push(v),
                    Err(e) => return internal(e),
                }
            }
            Json(Value::Array(out)).into_response()
        }
        Err(e) => internal(e),
    }
}

/// POST /api/drawings —— 新建作品
pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<CurrentUser>,
    Json(body): Json<CreateReq>,
) -> Response {
    if body.title.trim().is_empty() {
        return err_response(StatusCode::BAD_REQUEST, "title 不能为空");
    }
    if let Some(t) = &body.thumbnail {
        if t.len() > MAX_THUMBNAIL_BYTES {
            return err_response(StatusCode::PAYLOAD_TOO_LARGE, "thumbnail 超过 200KB 限制");
        }
    }
    let now = db::now_secs();
    let conn = state.db.lock().unwrap();
    let r = conn.execute(
        "INSERT INTO drawings (owner, title, code, thumbnail, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![user.id, body.title, body.code, body.thumbnail, now, now],
    );
    match r {
        Ok(_) => Json(json!({ "id": conn.last_insert_rowid() })).into_response(),
        Err(e) => internal(e),
    }
}

/// 取 (owner, title, code, thumbnail, created_at, updated_at)；None = 不存在
fn fetch(
    conn: &rusqlite::Connection,
    id: i64,
) -> rusqlite::Result<Option<(String, String, String, Option<String>, i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT owner, title, code, thumbnail, created_at, updated_at FROM drawings WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        ))),
        None => Ok(None),
    }
}

/// GET /api/drawings/{id} —— 仅 owner；不存在 404，非 owner 403
pub async fn get_one(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<i64>,
) -> Response {
    let conn = state.db.lock().unwrap();
    match fetch(&conn, id) {
        Ok(None) => err_response(StatusCode::NOT_FOUND, "drawing 不存在"),
        Err(e) => internal(e),
        Ok(Some((owner, title, code, thumbnail, created_at, updated_at))) => {
            if owner != user.id {
                return err_response(StatusCode::FORBIDDEN, "无权访问他人作品");
            }
            Json(json!({
                "id": id,
                "title": title,
                "code": code,
                "thumbnail": thumbnail,
                "created_at": created_at,
                "updated_at": updated_at,
            }))
            .into_response()
        }
    }
}

/// PUT /api/drawings/{id} —— 部分更新
pub async fn update(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateReq>,
) -> Response {
    if let Some(t) = &body.thumbnail {
        if t.len() > MAX_THUMBNAIL_BYTES {
            return err_response(StatusCode::PAYLOAD_TOO_LARGE, "thumbnail 超过 200KB 限制");
        }
    }
    let conn = state.db.lock().unwrap();
    let existing = match fetch(&conn, id) {
        Ok(v) => v,
        Err(e) => return internal(e),
    };
    let Some((owner, title, code, thumbnail, _, _)) = existing else {
        return err_response(StatusCode::NOT_FOUND, "drawing 不存在");
    };
    if owner != user.id {
        return err_response(StatusCode::FORBIDDEN, "无权修改他人作品");
    }
    let title = body.title.unwrap_or(title);
    let code = body.code.unwrap_or(code);
    let thumbnail = body.thumbnail.or(thumbnail);
    if title.trim().is_empty() {
        return err_response(StatusCode::BAD_REQUEST, "title 不能为空");
    }
    let r = conn.execute(
        "UPDATE drawings SET title=?2, code=?3, thumbnail=?4, updated_at=?5 WHERE id=?1",
        params![id, title, code, thumbnail, db::now_secs()],
    );
    match r {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(e) => internal(e),
    }
}

/// DELETE /api/drawings/{id}
pub async fn remove(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<CurrentUser>,
    Path(id): Path<i64>,
) -> Response {
    let conn = state.db.lock().unwrap();
    let existing = match fetch(&conn, id) {
        Ok(v) => v,
        Err(e) => return internal(e),
    };
    let Some((owner, _, _, _, _, _)) = existing else {
        return err_response(StatusCode::NOT_FOUND, "drawing 不存在");
    };
    if owner != user.id {
        return err_response(StatusCode::FORBIDDEN, "无权删除他人作品");
    }
    match conn.execute("DELETE FROM drawings WHERE id=?1", params![id]) {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(e) => internal(e),
    }
}
