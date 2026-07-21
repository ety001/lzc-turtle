use std::env;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthMode {
    Header,
    Oidc,
    Dev,
}

impl AuthMode {
    /// 生效模式字符串："header"/"oidc"/"dev"
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthMode::Header => "header",
            AuthMode::Oidc => "oidc",
            AuthMode::Dev => "dev",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub config_dir: PathBuf,
    pub listen_addr: String,
    pub port: u16,
    pub static_dir: PathBuf,
    pub auth_mode: AuthMode,
    pub cookie_secure: bool,
    pub oidc_issuer: Option<String>,
    pub oidc_client_id: Option<String>,
    pub oidc_client_secret: Option<String>,
    pub oidc_redirect_url: String,
    pub oidc_scopes: String,
}

impl Config {
    /// 优先级：env > $CONFIG_DIR/config.toml > 默认值
    pub fn load() -> Result<Self, String> {
        let config_dir = PathBuf::from(
            env::var("CONFIG_DIR")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "./data".to_string()),
        );

        // 读取 config.toml（可选，纯字符串/数字键值）
        let toml_conf: toml::Value = {
            let path = config_dir.join("config.toml");
            match std::fs::read_to_string(&path) {
                Ok(content) => content
                    .parse::<toml::Value>()
                    .map_err(|e| format!("解析 {} 失败: {e}", path.display()))?,
                Err(_) => toml::Value::Table(toml::map::Map::new()),
            }
        };
        let toml_get = |key: &str| -> Option<String> {
            match toml_conf.get(key) {
                Some(toml::Value::String(s)) if !s.is_empty() => Some(s.clone()),
                Some(toml::Value::Integer(i)) => Some(i.to_string()),
                _ => None,
            }
        };
        let get = |key: &str, default: Option<&str>| -> Option<String> {
            env::var(key)
                .ok()
                .filter(|s| !s.is_empty())
                .or_else(|| toml_get(key))
                .or_else(|| default.map(|s| s.to_string()))
        };

        let listen_addr = get("LISTEN_ADDR", Some("0.0.0.0")).unwrap();
        let port: u16 = get("PORT", Some("8000"))
            .unwrap()
            .parse()
            .map_err(|_| "PORT 必须是合法端口号".to_string())?;
        let cookie_secure = matches!(
            get("COOKIE_SECURE", Some("false"))
                .unwrap()
                .to_ascii_lowercase()
                .as_str(),
            "true" | "1" | "yes" | "on"
        );
        let static_dir = PathBuf::from(get("STATIC_DIR", Some("./dist")).unwrap());
        let auth_mode = match get("AUTH_MODE", Some("oidc")).unwrap().as_str() {
            "header" => AuthMode::Header,
            "oidc" => AuthMode::Oidc,
            "dev" => AuthMode::Dev,
            other => {
                return Err(format!(
                    "AUTH_MODE 只能是 header/oidc/dev，当前为 '{other}'"
                ))
            }
        };

        let cfg = Config {
            config_dir,
            listen_addr,
            port,
            static_dir,
            auth_mode,
            cookie_secure,
            oidc_issuer: get("OIDC_ISSUER", None),
            oidc_client_id: get("OIDC_CLIENT_ID", None),
            oidc_client_secret: get("OIDC_CLIENT_SECRET", None),
            oidc_redirect_url: get(
                "OIDC_REDIRECT_URL",
                Some("http://localhost:8000/api/auth/callback"),
            )
            .unwrap(),
            oidc_scopes: get("OIDC_SCOPES", Some("openid profile email")).unwrap(),
        };

        if cfg.auth_mode == AuthMode::Oidc {
            if cfg.oidc_issuer.is_none() {
                return Err("AUTH_MODE=oidc 必须配置 OIDC_ISSUER（env 或 config.toml）".into());
            }
            if cfg.oidc_client_id.is_none() {
                return Err("AUTH_MODE=oidc 必须配置 OIDC_CLIENT_ID（env 或 config.toml）".into());
            }
        }
        Ok(cfg)
    }

    /// 打印生效配置（脱敏 secret）
    pub fn describe(&self) -> String {
        let mask = |s: &Option<String>| match s {
            None => "<unset>".to_string(),
            Some(v) if v.is_empty() => "<empty>".to_string(),
            Some(_) => "****".to_string(),
        };
        let mut s = format!(
            "listen={}:{} auth_mode={} cookie_secure={} config_dir={} static_dir={}",
            self.listen_addr,
            self.port,
            self.auth_mode.as_str(),
            self.cookie_secure,
            self.config_dir.display(),
            self.static_dir.display()
        );
        if self.auth_mode == AuthMode::Oidc {
            s.push_str(&format!(
                " oidc_issuer={} oidc_client_id={} oidc_client_secret={} oidc_redirect_url={} oidc_scopes=\"{}\"",
                self.oidc_issuer.as_deref().unwrap_or("<unset>"),
                self.oidc_client_id.as_deref().unwrap_or("<unset>"),
                mask(&self.oidc_client_secret),
                self.oidc_redirect_url,
                self.oidc_scopes
            ));
        }
        s
    }
}
