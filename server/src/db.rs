use rusqlite::{params, Connection};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn open(config_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("创建 CONFIG_DIR {} 失败: {e}", config_dir.display()))?;
    let db_path = config_dir.join("turtle.db");
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("打开数据库 {} 失败: {e}", db_path.display()))?;
    migrate(&conn).map_err(|e| format!("数据库迁移失败: {e}"))?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS drawings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner TEXT NOT NULL,
          title TEXT NOT NULL,
          code TEXT NOT NULL,
          thumbnail TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_drawings_owner ON drawings(owner, updated_at DESC);

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          uid TEXT NOT NULL,
          name TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS oidc_states (
          state TEXT PRIMARY KEY,
          nonce TEXT NOT NULL,
          verifier TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        "#,
    )
}

// ---------- sessions ----------

pub fn create_session(
    conn: &Connection,
    token_hash: &str,
    uid: &str,
    name: &str,
    avatar: Option<&str>,
    expires_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO sessions (token_hash, uid, name, avatar, expires_at) VALUES (?1,?2,?3,?4,?5)",
        params![token_hash, uid, name, avatar, expires_at],
    )?;
    // 顺手清理过期会话
    conn.execute("DELETE FROM sessions WHERE expires_at < ?1", params![now_secs()])?;
    Ok(())
}

/// 返回 (uid, name, avatar, expires_at)
pub fn get_session(
    conn: &Connection,
    token_hash: &str,
) -> rusqlite::Result<Option<(String, String, Option<String>, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT uid, name, avatar, expires_at FROM sessions WHERE token_hash = ?1",
    )?;
    let mut rows = stmt.query(params![token_hash])?;
    match rows.next()? {
        Some(row) => Ok(Some((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))),
        None => Ok(None),
    }
}

pub fn touch_session(conn: &Connection, token_hash: &str, expires_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET expires_at = ?2 WHERE token_hash = ?1",
        params![token_hash, expires_at],
    )?;
    Ok(())
}

pub fn delete_session(conn: &Connection, token_hash: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM sessions WHERE token_hash = ?1",
        params![token_hash],
    )?;
    Ok(())
}

// ---------- oidc_states ----------

pub fn save_oidc_state(
    conn: &Connection,
    state: &str,
    nonce: &str,
    verifier: &str,
    expires_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO oidc_states (state, nonce, verifier, expires_at) VALUES (?1,?2,?3,?4)",
        params![state, nonce, verifier, expires_at],
    )?;
    conn.execute(
        "DELETE FROM oidc_states WHERE expires_at < ?1",
        params![now_secs()],
    )?;
    Ok(())
}

/// 一次性取出并删除（防重放）。返回 (nonce, verifier, expires_at)
pub fn take_oidc_state(
    conn: &Connection,
    state: &str,
) -> rusqlite::Result<Option<(String, String, i64)>> {
    let mut stmt =
        conn.prepare("SELECT nonce, verifier, expires_at FROM oidc_states WHERE state = ?1")?;
    let mut rows = stmt.query(params![state])?;
    let found = match rows.next()? {
        Some(row) => Some((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
        None => None,
    };
    drop(rows);
    drop(stmt);
    if found.is_some() {
        conn.execute("DELETE FROM oidc_states WHERE state = ?1", params![state])?;
    }
    Ok(found)
}
