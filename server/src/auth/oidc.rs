use crate::auth::{
    clear_session_cookie_header, cookie_value, session_cookie_header, sha256_hex, SESSION_COOKIE,
    SESSION_TTL_SECS,
};
use crate::config::AuthMode;
use crate::db;
use crate::error::{err_response, internal};
use crate::AppState;
use axum::extract::{Query, State};
use axum::http::header;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;

const STATE_TTL_SECS: i64 = 600; // state/nonce/PKCE 10 分钟有效

#[derive(Clone, Debug)]
pub struct OidcEndpoints {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
}

/// 启动时做 OIDC discovery，失败给出清晰报错
pub async fn discover(http: &reqwest::Client, issuer: &str) -> Result<OidcEndpoints, String> {
    let issuer = issuer.trim_end_matches('/');
    let url = format!("{issuer}/.well-known/openid-configuration");
    let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("OIDC discovery 失败: GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "OIDC discovery 失败: GET {url} 返回 {}",
            resp.status()
        ));
    }
    let doc: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("OIDC discovery 失败: 解析 {url} 响应 JSON 出错: {e}"))?;
    let get_str = |key: &str| -> Result<String, String> {
        doc.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("OIDC discovery 失败: {url} 缺少字段 '{key}'"))
    };
    Ok(OidcEndpoints {
        issuer: issuer.to_string(),
        authorization_endpoint: get_str("authorization_endpoint")?,
        token_endpoint: get_str("token_endpoint")?,
        jwks_uri: get_str("jwks_uri")?,
    })
}

fn rand_b64url(n: usize) -> String {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn oidc_not_enabled() -> Response {
    err_response(StatusCode::NOT_FOUND, "oidc not enabled")
}

/// GET /api/auth/login —— 生成 state/nonce/PKCE，302 到 issuer authorize 端点
pub async fn login(State(state): State<Arc<AppState>>) -> Response {
    if state.config.auth_mode != AuthMode::Oidc {
        return oidc_not_enabled();
    }
    let endpoints = state.oidc.as_ref().unwrap();
    let cfg = &state.config;

    let oauth_state = rand_b64url(32);
    let nonce = rand_b64url(32);
    let verifier = rand_b64url(32);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    {
        let conn = state.db.lock().unwrap();
        if let Err(e) = db::save_oidc_state(
            &conn,
            &oauth_state,
            &nonce,
            &verifier,
            db::now_secs() + STATE_TTL_SECS,
        ) {
            return internal(e);
        }
    }

    let mut url = match reqwest::Url::parse(&endpoints.authorization_endpoint) {
        Ok(u) => u,
        Err(e) => return internal(format!("非法 authorization_endpoint: {e}")),
    };
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", cfg.oidc_client_id.as_deref().unwrap());
        q.append_pair("redirect_uri", &cfg.oidc_redirect_url);
        q.append_pair("scope", &cfg.oidc_scopes);
        q.append_pair("state", &oauth_state);
        q.append_pair("nonce", &nonce);
        q.append_pair("code_challenge", &challenge);
        q.append_pair("code_challenge_method", "S256");
    }
    (StatusCode::FOUND, [(header::LOCATION, url.to_string())]).into_response()
}

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IdClaims {
    sub: String,
    nonce: Option<String>,
    name: Option<String>,
    preferred_username: Option<String>,
    email: Option<String>,
    picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: Option<String>,
    kty: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

/// GET /api/auth/callback —— 换 token、JWKS 验签、建会话，302 到 /#/
pub async fn callback(
    State(state): State<Arc<AppState>>,
    Query(q): Query<CallbackQuery>,
) -> Response {
    if state.config.auth_mode != AuthMode::Oidc {
        return oidc_not_enabled();
    }
    let endpoints = state.oidc.as_ref().unwrap().clone();
    let cfg = &state.config;

    if let Some(err) = q.error {
        let desc = q.error_description.unwrap_or_default();
        return err_response(
            StatusCode::BAD_REQUEST,
            format!("oidc 授权失败: {err} {desc}"),
        );
    }
    let (Some(code), Some(oauth_state)) = (q.code, q.state) else {
        return err_response(StatusCode::BAD_REQUEST, "缺少 code 或 state 参数");
    };

    // 一次性消费 state，校验未过期
    let (nonce, verifier) = {
        let conn = state.db.lock().unwrap();
        match db::take_oidc_state(&conn, &oauth_state) {
            Ok(Some((nonce, verifier, exp))) if exp > db::now_secs() => (nonce, verifier),
            Ok(_) => {
                return err_response(StatusCode::BAD_REQUEST, "state 无效或已过期，请重新登录")
            }
            Err(e) => return internal(e),
        }
    };

    // code -> token
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", cfg.oidc_redirect_url.clone()),
        ("client_id", cfg.oidc_client_id.clone().unwrap()),
        ("code_verifier", verifier),
    ];
    if let Some(secret) = &cfg.oidc_client_secret {
        form.push(("client_secret", secret.clone()));
    }
    let token_resp = match state
        .http
        .post(&endpoints.token_endpoint)
        .form(&form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return internal(format!("请求 token 端点失败: {e}")),
    };
    let status = token_resp.status();
    let token_body: TokenResponse = match token_resp.json().await {
        Ok(v) => v,
        Err(e) => return internal(format!("解析 token 响应失败: {e}")),
    };
    if !status.is_success() {
        let msg = token_body.error.unwrap_or_else(|| status.to_string());
        let desc = token_body.error_description.unwrap_or_default();
        return err_response(
            StatusCode::BAD_GATEWAY,
            format!("token 端点返回错误: {msg} {desc}"),
        );
    }
    let Some(id_token) = token_body.id_token else {
        return err_response(StatusCode::BAD_GATEWAY, "token 响应缺少 id_token");
    };

    // JWKS 验签（RS256）+ iss/aud/exp 校验
    let header_jwt = match jsonwebtoken::decode_header(&id_token) {
        Ok(h) => h,
        Err(e) => return internal(format!("id_token header 解析失败: {e}")),
    };
    let jwks: Jwks = match state.http.get(&endpoints.jwks_uri).send().await {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return internal(format!("JWKS 解析失败: {e}")),
        },
        Err(e) => return internal(format!("拉取 JWKS 失败: {e}")),
    };
    let jwk = jwks
        .keys
        .iter()
        .find(|k| {
            k.kty.as_deref() == Some("RSA")
                && (header_jwt.kid.is_none() || k.kid == header_jwt.kid)
        })
        .or_else(|| jwks.keys.iter().find(|k| k.kty.as_deref() == Some("RSA")));
    let Some(jwk) = jwk else {
        return internal("JWKS 中找不到匹配的 RSA 公钥");
    };
    let (Some(n), Some(e_)) = (&jwk.n, &jwk.e) else {
        return internal("JWKS 公钥缺少 n/e");
    };
    let decoding_key = match DecodingKey::from_rsa_components(n, e_) {
        Ok(k) => k,
        Err(e) => return internal(format!("构造 RSA 公钥失败: {e}")),
    };
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[endpoints.issuer.as_str()]);
    validation.set_audience(&[cfg.oidc_client_id.as_deref().unwrap()]);
    let claims = match decode::<IdClaims>(&id_token, &decoding_key, &validation) {
        Ok(d) => d.claims,
        Err(e) => {
            return err_response(
                StatusCode::UNAUTHORIZED,
                format!("id_token 校验失败: {e}"),
            )
        }
    };
    if claims.nonce.as_deref() != Some(nonce.as_str()) {
        return err_response(StatusCode::UNAUTHORIZED, "id_token nonce 不匹配");
    }

    // 建会话：库存 sha256(token)，7 天过期
    let uid = claims.sub;
    let name = claims
        .name
        .or(claims.preferred_username)
        .or(claims.email)
        .unwrap_or_else(|| uid.clone());
    // 头像：id_token 的 picture claim，有则存会话，/api/me 返回
    let avatar = claims.picture.filter(|s| !s.is_empty());
    let token = rand_b64url(32);
    let token_hash = sha256_hex(token.as_bytes());
    {
        let conn = state.db.lock().unwrap();
        if let Err(e) = db::create_session(
            &conn,
            &token_hash,
            &uid,
            &name,
            avatar.as_deref(),
            db::now_secs() + SESSION_TTL_SECS,
        ) {
            return internal(e);
        }
    }
    tracing::info!(uid = %uid, "oidc login success");
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, "/#/".to_string()),
            (
                header::SET_COOKIE,
                session_cookie_header(&token, SESSION_TTL_SECS, cfg.cookie_secure),
            ),
        ],
    )
        .into_response()
}

/// POST /api/auth/logout —— 清会话
pub async fn logout(State(state): State<Arc<AppState>>, req: axum::extract::Request) -> Response {
    if state.config.auth_mode != AuthMode::Oidc {
        return oidc_not_enabled();
    }
    if let Some(token) = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| cookie_value(h, SESSION_COOKIE))
    {
        let token_hash = sha256_hex(token.as_bytes());
        let conn = state.db.lock().unwrap();
        let _ = db::delete_session(&conn, &token_hash);
    }
    (
        StatusCode::OK,
        [(
            header::SET_COOKIE,
            clear_session_cookie_header(state.config.cookie_secure),
        )],
        Json(json!({ "ok": true })),
    )
        .into_response()
}
