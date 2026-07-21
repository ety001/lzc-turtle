mod auth;
mod config;
mod db;
mod error;
mod routes;

use std::sync::{Arc, Mutex};
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub config: config::Config,
    pub db: Mutex<rusqlite::Connection>,
    pub http: reqwest::Client,
    pub oidc: Option<auth::oidc::OidcEndpoints>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let cfg = match config::Config::load() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[turtle-server] 配置错误: {e}");
            std::process::exit(1);
        }
    };
    tracing::info!(config = %cfg.describe(), "effective config");

    let conn = match db::open(&cfg.config_dir) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[turtle-server] 数据库初始化失败: {e}");
            std::process::exit(1);
        }
    };

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("build reqwest client");

    // OIDC 模式：启动时做 discovery，失败直接清晰报错退出
    let oidc = if cfg.auth_mode == config::AuthMode::Oidc {
        match auth::oidc::discover(&http, cfg.oidc_issuer.as_deref().unwrap()).await {
            Ok(ep) => {
                tracing::info!(
                    authorization_endpoint = %ep.authorization_endpoint,
                    token_endpoint = %ep.token_endpoint,
                    jwks_uri = %ep.jwks_uri,
                    "oidc discovery ok"
                );
                Some(ep)
            }
            Err(e) => {
                eprintln!("[turtle-server] {e}");
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    let state = Arc::new(AppState {
        config: cfg.clone(),
        db: Mutex::new(conn),
        http,
        oidc,
    });

    let app = routes::build_router(state);
    let addr = format!("{}:{}", cfg.listen_addr, cfg.port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[turtle-server] 监听 {addr} 失败: {e}");
            std::process::exit(1);
        }
    };
    tracing::info!(addr = %addr, "turtle-server listening");
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[turtle-server] 服务异常退出: {e}");
        std::process::exit(1);
    }
}
