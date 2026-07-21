pub mod oidc;

use crate::config::AuthMode;
use crate::db;
use crate::error::err_response;
use crate::AppState;
use axum::extract::{Request, State};
use axum::http::header;
use axum::http::{HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub const SESSION_COOKIE: &str = "turtle_session";
pub const SESSION_TTL_SECS: i64 = 7 * 24 * 3600; // 7 天

#[derive(Clone, Debug)]
pub struct CurrentUser {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    /// 仅 OIDC 模式且 id_token 带 picture claim 时有值
    pub avatar: Option<String>,
}

pub fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    let mut s = String::with_capacity(digest.len() * 2);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub fn cookie_value<'a>(cookie_header: &'a str, name: &str) -> Option<&'a str> {
    cookie_header.split(';').filter_map(|part| {
        let part = part.trim();
        let (k, v) = part.split_once('=')?;
        if k == name {
            Some(v)
        } else {
            None
        }
    }).next()
}

pub fn session_cookie_header(token: &str, max_age: i64, secure: bool) -> String {
    let mut s =
        format!("{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    if secure {
        s.push_str("; Secure");
    }
    s
}

pub fn clear_session_cookie_header(secure: bool) -> String {
    let mut s = format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    if secure {
        s.push_str("; Secure");
    }
    s
}

/// 受保护 API 的鉴权中间件：按 AUTH_MODE 解析当前用户，注入 request extensions。
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Response {
    match state.config.auth_mode {
        AuthMode::Dev => {
            req.extensions_mut().insert(CurrentUser {
                id: "dev-user".to_string(),
                name: "dev-user".to_string(),
                role: Some("ADMIN".to_string()),
                avatar: None,
            });
            next.run(req).await
        }
        AuthMode::Header => {
            // 懒猫模式：直接信任 lzc-ingress 注入的 X-HC-User-ID / X-HC-User-Role
            let uid = req
                .headers()
                .get("X-HC-User-ID")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            match uid {
                Some(uid) => {
                    let role = req
                        .headers()
                        .get("X-HC-User-Role")
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string());
                    req.extensions_mut().insert(CurrentUser {
                        name: uid.clone(),
                        id: uid,
                        role,
                        avatar: None,
                    });
                    next.run(req).await
                }
                None => err_response(StatusCode::UNAUTHORIZED, "unauthorized"),
            }
        }
        AuthMode::Oidc => {
            let token = req
                .headers()
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|h| cookie_value(h, SESSION_COOKIE))
                .map(|s| s.to_string());
            let Some(token) = token else {
                return err_response(StatusCode::UNAUTHORIZED, "unauthorized");
            };
            let token_hash = sha256_hex(token.as_bytes());
            let now = db::now_secs();
            let session = {
                let conn = state.db.lock().unwrap();
                match db::get_session(&conn, &token_hash) {
                    Ok(Some((uid, name, avatar, exp))) if exp > now => {
                        // 7 天滚动续期
                        let _ = db::touch_session(&conn, &token_hash, now + SESSION_TTL_SECS);
                        Some((uid, name, avatar))
                    }
                    _ => None,
                }
            };
            match session {
                Some((uid, name, avatar)) => {
                    req.extensions_mut().insert(CurrentUser {
                        id: uid,
                        name,
                        role: None,
                        avatar,
                    });
                    let mut resp = next.run(req).await;
                    // 滚动续期：同步刷新 cookie Max-Age
                    if let Ok(v) = HeaderValue::from_str(&session_cookie_header(
                        &token,
                        SESSION_TTL_SECS,
                        state.config.cookie_secure,
                    )) {
                        resp.headers_mut().append(header::SET_COOKIE, v);
                    }
                    resp
                }
                None => err_response(StatusCode::UNAUTHORIZED, "unauthorized"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_cookie_secure_flag() {
        let plain = session_cookie_header("tok", 3600, false);
        assert!(plain.contains("turtle_session=tok"));
        assert!(!plain.contains("Secure"));

        let secure = session_cookie_header("tok", 3600, true);
        assert!(secure.contains("turtle_session=tok"));
        assert!(secure.contains("HttpOnly"));
        assert!(secure.ends_with("; Secure"));

        let cleared = clear_session_cookie_header(true);
        assert!(cleared.contains("Max-Age=0"));
        assert!(cleared.ends_with("; Secure"));
        assert!(!clear_session_cookie_header(false).contains("Secure"));
    }
}
