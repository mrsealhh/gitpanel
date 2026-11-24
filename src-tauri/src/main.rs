#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Result};
use git_core::Repo;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

/* ───────────────────────── RPC 入口 ───────────────────────── */

/// 单一 RPC 入口：前端 `invoke('git_call', { cmd, payload })`，
/// cmd 与 devserver 的 /api/<cmd> 一一对应，payload 与 HTTP body 同构。
#[tauri::command]
fn git_call(cmd: String, payload: Value) -> Result<Value, String> {
    dispatch(&cmd, payload).map_err(|e| e.to_string())
}

fn s(p: &Value, k: &str) -> String {
    p.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn b(p: &Value, k: &str) -> bool {
    p.get(k).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn n(p: &Value, k: &str, default: u32) -> u32 {
    p.get(k).and_then(|v| v.as_u64()).map(|v| v as u32).unwrap_or(default)
}

fn arr(p: &Value, k: &str) -> Vec<String> {
    p.get(k)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn opt_s(p: &Value, k: &str) -> Option<String> {
    p.get(k).and_then(|v| v.as_str()).map(|v| v.to_string())
}

fn opt_n(p: &Value, k: &str) -> Option<u32> {
    p.get(k).and_then(|v| v.as_u64()).map(|v| v as u32)
}

/// 前端传来的大文件窗口参数（行数 / 字节数 / 起始行）
fn diff_window(p: &Value) -> git_core::text::DiffWindow {
    git_core::text::DiffWindow::new(
        opt_n(p, "fromLine"),
        opt_n(p, "maxLines"),
        opt_n(p, "maxBytes"),
    )
}

fn dispatch(cmd: &str, p: Value) -> Result<Value> {
    let path = s(&p, "path");
    if path.is_empty() {
        return Err(anyhow!("path required"));
    }
    let repo = Repo::open(&path)?;

    let out = match cmd {
        "open" => serde_json::to_value(repo.info()?)?,
        "graph" => serde_json::to_value(repo.graph_page(n(&p, "offset", 0), n(&p, "limit", 400), &s(&p, "tip"))?)?,
        "commit" => serde_json::to_value(repo.commit_detail(&s(&p, "oid"))?)?,
        "file-diff" => {
            let win = diff_window(&p);
            serde_json::to_value(repo.file_diff_window(&s(&p, "oid"), &s(&p, "file"), win)?)?
        }

        "commands" => json!({ "commands": repo.commands() }),
        "run-command" => serde_json::to_value(repo.run_command(&s(&p, "id"))?)?,
        "remotes" => json!({ "remotes": repo.remotes()? }),

        "checkout" => serde_json::to_value(repo.checkout(&s(&p, "ref"))?)?,
        "create-branch" => {
            let from = opt_s(&p, "from");
            serde_json::to_value(repo.create_branch(&s(&p, "name"), from.as_deref())?)?
        }

        "worktree-status" => serde_json::to_value(repo.worktree_status()?)?,
        "worktree-diff" => {
            let win = diff_window(&p);
            serde_json::to_value(repo.worktree_diff_window(&s(&p, "file"), b(&p, "staged"), win)?)?
        }
        "stage" => {
            repo.stage(&arr(&p, "files"))?;
            json!({ "ok": true })
        }
        "unstage" => {
            repo.unstage(&arr(&p, "files"))?;
            json!({ "ok": true })
        }
        "discard" => {
            let snapshot = repo.discard(&arr(&p, "files"), b(&p, "untracked"))?;
            json!({ "ok": true, "snapshot": snapshot })
        }
        "commit-changes" => {
            let oid = repo.commit_changes(&s(&p, "message"), b(&p, "amend"), b(&p, "addAll"))?;
            json!({ "ok": true, "oid": oid, "short": oid.chars().take(7).collect::<String>(), "output": "" })
        }

        "fetch" => json!({ "ok": true, "output": repo.fetch()? }),
        "pull" => {
            let snapshot = repo.create_snapshot("before-pull")?;
            let output = repo.pull()?;
            json!({ "ok": true, "output": output, "snapshot": snapshot })
        }
        "push" => json!({ "ok": true, "output": repo.push(b(&p, "force"))? }),

        "snapshots" => json!({ "snapshots": repo.list_snapshots()? }),
        "restore-snapshot" => {
            repo.restore_snapshot(&s(&p, "ref"))?;
            json!({ "ok": true })
        }

        "conflict" => serde_json::to_value(repo.conflict_detail(&s(&p, "file"))?)?,
        "resolve" => {
            repo.resolve_conflict(&s(&p, "file"), &s(&p, "content"))?;
            json!({ "ok": true })
        }
        "resolve-side" => {
            repo.resolve_side(&s(&p, "file"), s(&p, "side") == "theirs")?;
            json!({ "ok": true })
        }

        "stashes" => json!({ "stashes": repo.list_stashes()? }),
        "stash-create" => json!({ "ok": true, "output": repo.create_stash(&s(&p, "message"), b(&p, "includeUntracked"))? }),
        "stash-action" => json!({ "ok": true, "output": repo.stash_action(&s(&p, "ref"), &s(&p, "action"))? }),
        "stash-diff" => serde_json::to_value(repo.stash_diff(&s(&p, "ref"))?)?,

        "tags" => json!({ "tags": repo.list_tags()? }),
        "tag-create" => {
            repo.create_tag(&s(&p, "name"), &s(&p, "message"), &s(&p, "oid"))?;
            json!({ "ok": true })
        }
        "tag-delete" => {
            repo.delete_tag(&s(&p, "name"))?;
            json!({ "ok": true })
        }

        "merge-branch" => serde_json::to_value(repo.merge_branch(&s(&p, "name"))?)?,
        "delete-branch" => {
            let snapshot = repo.delete_branch(&s(&p, "name"), b(&p, "force"))?;
            json!({ "ok": true, "snapshot": snapshot })
        }
        "rename-branch" => {
            repo.rename_branch(&s(&p, "from"), &s(&p, "to"))?;
            json!({ "ok": true })
        }

        "reflog" => json!({ "entries": repo.reflog(n(&p, "limit", 60) as usize)? }),
        "reset-to" => {
            let snapshot = repo.reset_to(&s(&p, "oid"), &s(&p, "mode"))?;
            json!({ "ok": true, "snapshot": snapshot })
        }

        "rebase-preview" => {
            let base = s(&p, "base");
            json!({ "base": base, "commits": repo.rebase_preview(&base)? })
        }
        "rebase-start" => {
            let steps: Vec<git_core::RebaseStep> =
                serde_json::from_value(p.get("steps").cloned().unwrap_or_else(|| json!([])))?;
            serde_json::to_value(repo.rebase_start(&s(&p, "base"), &steps)?)?
        }
        "rebase-status" => serde_json::to_value(repo.rebase_status()?)?,
        "rebase-action" => serde_json::to_value(repo.rebase_action(&s(&p, "action"))?)?,

        "worktrees" => json!({ "worktrees": repo.worktrees()? }),
        "worktree-add" => {
            let path = repo.add_worktree(
                &s(&p, "target"),
                &s(&p, "branch"),
                b(&p, "newBranch"),
                &s(&p, "base"),
            )?;
            json!({ "ok": true, "path": path })
        }
        "worktree-remove" => {
            repo.remove_worktree(&s(&p, "target"), b(&p, "force"))?;
            json!({ "ok": true })
        }
        "worktree-prune" => json!({ "ok": true, "output": repo.prune_worktrees()? }),

        "file-history" => json!({
            "file": s(&p, "file"),
            "commits": repo.file_history(&s(&p, "file"), n(&p, "limit", 200) as usize)?
        }),
        "blame" => {
            let lines = repo.blame(&s(&p, "file"), n(&p, "max", 2000) as usize)?;
            json!({ "file": s(&p, "file"), "lines": lines, "truncated": false })
        }
        "repo-health" => serde_json::to_value(repo.repo_health()?)?,

        /* ── 本地文件的查看 / 编辑（省去开别的编辑器） ── */
        "fs-list" => fs_list(repo.path(), &s(&p, "dir"))?,
        "fs-files" => repo_files(repo.path())?,
        "fs-read" => fs_read(repo.path(), &s(&p, "file"), n(&p, "maxBytes", 2 * 1024 * 1024))?,
        "fs-write" => fs_write(repo.path(), &s(&p, "file"), &s(&p, "content"))?,

        other => return Err(anyhow!("未知命令: {other}")),
    };

    Ok(out)
}

/* ───────────────────────── 本地文件（查看 / 编辑） ───────────────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

/// 仓库内所有可编辑文件（已跟踪 + 未跟踪），用于文件面板的全局搜索
fn repo_files(root: &std::path::Path) -> Result<Value> {
    let out = git_core::proc::command("git")
        .arg("-C")
        .arg(root)
        .args(["ls-files", "-co", "--exclude-standard", "-z"])
        .output()?;
    if !out.status.success() {
        return Err(anyhow!("git ls-files 失败"));
    }
    let mut files: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| s.replace('\\', "/"))
        .collect();
    files.sort();
    files.dedup();
    Ok(json!({ "files": files }))
}

/// 把相对路径解析到仓库内，越界（../、绝对路径外跳）直接拒绝
fn safe_join(root: &std::path::Path, rel: &str) -> Result<std::path::PathBuf> {
    let rel = rel.trim_start_matches(['/', '\\']);
    let joined = root.join(rel.replace('\\', "/"));
    let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    // 目标可能还不存在（新建文件），先按父目录校验
    let probe = if joined.exists() {
        joined.clone()
    } else {
        joined.parent().map(|p| p.to_path_buf()).unwrap_or(joined.clone())
    };
    let canon = probe.canonicalize().unwrap_or(probe);
    if !canon.starts_with(&canon_root) {
        return Err(anyhow!("路径越界：{rel}"));
    }
    Ok(joined)
}

fn rel_display(root: &std::path::Path, p: &std::path::Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

fn fs_list(root: &std::path::Path, dir: &str) -> Result<Value> {    let target = safe_join(root, dir)?;
    let mut entries: Vec<FsEntry> = Vec::new();
    for item in std::fs::read_dir(&target)?.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        let meta = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        entries.push(FsEntry {
            name,
            path: rel_display(root, &item.path()),
            is_dir: meta.is_dir(),
            size: meta.len(),
        });
    }
    // 目录在前，同类按名字排
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(json!({ "dir": rel_display(root, &target), "entries": entries }))
}

/// 编码判定：utf8 / utf8bom；其它（例如 GBK）只读，避免写回时改坏文件
fn detect_encoding(bytes: &[u8]) -> (&'static str, bool) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return ("utf8bom", true);
    }
    match std::str::from_utf8(bytes) {
        Ok(_) => ("utf8", true),
        Err(_) => ("other", false),
    }
}

fn fs_read(root: &std::path::Path, file: &str, max_bytes: u32) -> Result<Value> {
    let target = safe_join(root, file)?;
    if !target.is_file() {
        return Err(anyhow!("不是文件：{file}"));
    }
    let bytes = std::fs::read(&target)?;
    let size = bytes.len() as u64;
    let is_binary = bytes.iter().take(8000).any(|b| *b == 0);
    let (encoding, editable) = detect_encoding(&bytes);
    let max = max_bytes as usize;
    let truncated = bytes.len() > max;
    let slice = &bytes[..bytes.len().min(max)];

    let content = if is_binary {
        String::new()
    } else {
        let text = String::from_utf8_lossy(slice).to_string();
        text.strip_prefix('\u{feff}').map(|s| s.to_string()).unwrap_or(text)
    };
    let lines = if content.is_empty() { 0 } else { content.lines().count() };

    Ok(json!({
        "file": rel_display(root, &target),
        "content": content,
        "size": size,
        "isBinary": is_binary,
        "truncated": truncated,
        "encoding": encoding,
        "editable": editable && !is_binary && !truncated,
        "lines": lines,
    }))
}

fn fs_write(root: &std::path::Path, file: &str, content: &str) -> Result<Value> {
    let target = safe_join(root, file)?;
    // 已有文件：只允许写 UTF-8（含 BOM），其它编码一律拒绝，避免二次破坏
    let keep_bom = match std::fs::read(&target) {
        Ok(old) => {
            let (encoding, editable) = detect_encoding(&old);
            if !editable {
                return Err(anyhow!("这个文件不是 UTF-8 编码（可能是 GBK/GB18030），为避免写坏已拒绝保存"));
            }
            encoding == "utf8bom"
        }
        Err(_) => false,
    };
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut out = Vec::with_capacity(content.len() + 3);
    if keep_bom {
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    out.extend_from_slice(content.as_bytes());
    std::fs::write(&target, &out)?;
    Ok(json!({
        "ok": true,
        "file": rel_display(root, &target),
        "size": out.len(),
        "lines": content.lines().count(),
    }))
}

/* ───────────────────────── 最近打开（SQLite） ───────────────────────── */

struct Db(Mutex<Connection>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentRepo {
    path: String,
    name: String,
    alias: String,
    opened_at: i64,
    pinned: bool,
}

fn open_db(app: &AppHandle) -> Result<Connection> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("无法定位数据目录: {e}"))?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("gitpanel.db"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS recent (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            opened_at INTEGER NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS worktree_meta (
            path TEXT PRIMARY KEY,
            agent TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL
        );",
    )?;
    // 老库升级：补 alias 列（已存在会报错，忽略即可）
    let _ = conn.execute("ALTER TABLE recent ADD COLUMN alias TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE worktree_meta ADD COLUMN task TEXT NOT NULL DEFAULT ''", []);
    Ok(conn)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
fn recent_list(db: tauri::State<Db>) -> Result<Vec<RecentRepo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT path, name, alias, opened_at, pinned FROM recent ORDER BY pinned DESC, opened_at DESC LIMIT 50")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(RecentRepo {
                path: r.get(0)?,
                name: r.get(1)?,
                alias: r.get(2)?,
                opened_at: r.get(3)?,
                pinned: r.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 项目重命名：名字全局唯一，重复时自动补 1、2、3
#[tauri::command]
fn project_rename(path: String, alias: String, db: tauri::State<Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut taken: Vec<String> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT path, name, alias FROM recent")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            if row.0 == path {
                continue;
            }
            let display = if row.2.trim().is_empty() { row.1 } else { row.2 };
            taken.push(display.to_lowercase());
        }
    }

    let base = alias.trim().to_string();
    if base.is_empty() {
        conn.execute("UPDATE recent SET alias = '' WHERE path = ?1", [path])
            .map_err(|e| e.to_string())?;
        return Ok(String::new());
    }

    let mut final_name = base.clone();
    let mut n = 1;
    while taken.contains(&final_name.to_lowercase()) {
        final_name = format!("{base}{n}");
        n += 1;
    }

    conn.execute(
        "UPDATE recent SET alias = ?2 WHERE path = ?1",
        rusqlite::params![path, final_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(final_name)
}

/// 克隆仓库到指定目录
#[tauri::command]
fn clone_repo(url: String, target: String) -> Result<String, String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://") || u.starts_with("git@") || u.starts_with("ssh://")) {
        return Err("只支持 http(s) / ssh / git@ 形式的仓库地址".into());
    }
    let t = std::path::PathBuf::from(target.trim());
    if target.trim().is_empty() {
        return Err("请选择目标目录".into());
    }
    if t.exists() && std::fs::read_dir(&t).map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("目标目录已存在且非空".into());
    }

    let out = git_core::proc::command("git")
        .args(["clone", "--progress", u])
        .arg(&t)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        Ok(t.to_string_lossy().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let human = if err.contains("Authentication failed")
            || err.contains("could not read Username")
            || err.contains("terminal prompts disabled")
            || err.contains("Permission denied")
        {
            "这台机器还没登录过该仓库。请先在终端执行一次 git clone（或登录 Git 凭据管理器），成功后回来再点克隆；GitPanel 不保存任何账号密码。"
                .to_string()
        } else if err.contains("already exists") {
            "目标目录已经有内容了，换一个空目录再试".to_string()
        } else if err.contains("not found") || err.contains("Repository not found") {
            "仓库地址不存在，或者当前账号没有权限".to_string()
        } else {
            err
        };
        Err(human)
    }
}

/// 本机 git 身份（只读，不保存任何凭据）
#[tauri::command]
fn git_identity() -> Value {
    let get = |key: &str| {
        git_core::proc::command("git")
            .args(["config", "--global", "--get", key])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    json!({ "name": get("user.name"), "email": get("user.email") })
}

#[tauri::command]
fn recent_touch(path: String, name: String, db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO recent (path, name, opened_at, pinned) VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(path) DO UPDATE SET name = ?2, opened_at = ?3",
        rusqlite::params![path, name, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn recent_remove(path: String, db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM recent WHERE path = ?1", [path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn recent_pin(path: String, pinned: bool, db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE recent SET pinned = ?2 WHERE path = ?1",
        rusqlite::params![path, if pinned { 1 } else { 0 }],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/* ─────────────── 工作树 ↔ AI 会话元数据 ─────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeMeta {
    agent: String,
    note: String,
    task: String,
    created_at: i64,
    last_used_at: i64,
}

#[tauri::command]
fn worktree_meta_list(
    db: tauri::State<Db>,
) -> Result<std::collections::HashMap<String, WorktreeMeta>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT path, agent, note, task, created_at, last_used_at FROM worktree_meta")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                WorktreeMeta {
                    agent: r.get(1)?,
                    note: r.get(2)?,
                    task: r.get(3)?,
                    created_at: r.get(4)?,
                    last_used_at: r.get(5)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (path, meta) = row.map_err(|e| e.to_string())?;
        map.insert(path, meta);
    }
    Ok(map)
}

#[tauri::command]
fn worktree_meta_set(
    path: String,
    agent: String,
    note: String,
    task: String,
    db: tauri::State<Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO worktree_meta (path, agent, note, task, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(path) DO UPDATE SET agent = ?2, note = ?3, task = ?4",
        rusqlite::params![path, agent, note, task, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 打开某个工作树时刷新「最后活动」
#[tauri::command]
fn worktree_meta_touch(path: String, db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO worktree_meta (path, agent, note, created_at, last_used_at)
         VALUES (?1, '', '', ?2, ?2)
         ON CONFLICT(path) DO UPDATE SET last_used_at = ?2",
        rusqlite::params![path, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/* ─────────────── 多仓库看板 ─────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoOverview {
    path: String,
    name: String,
    exists: bool,
    branch: String,
    ahead: u32,
    behind: u32,
    dirty: u32,
    last_commit: i64,
    worktrees: u32,
    error: Option<String>,
}

#[tauri::command]
fn repos_overview(paths: Vec<String>) -> Vec<RepoOverview> {
    paths
        .into_iter()
        .take(20)
        .map(|path| {
            let name = std::path::Path::new(&path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());

            if !std::path::Path::new(&path).exists() {
                return RepoOverview {
                    path,
                    name,
                    exists: false,
                    branch: String::new(),
                    ahead: 0,
                    behind: 0,
                    dirty: 0,
                    last_commit: 0,
                    worktrees: 0,
                    error: Some("目录不存在".into()),
                };
            }

            match Repo::open(&path) {
                Ok(repo) => {
                    let status = repo.worktree_status().ok();
                    let last = repo
                        .reflog(1)
                        .ok()
                        .and_then(|l| l.first().map(|e| e.time))
                        .unwrap_or(0);
                    let wt = repo.worktrees().map(|w| w.len() as u32).unwrap_or(1);
                    RepoOverview {
                        path,
                        name,
                        exists: true,
                        branch: status.as_ref().map(|s| s.branch.clone()).unwrap_or_default(),
                        ahead: status.as_ref().map(|s| s.ahead).unwrap_or(0),
                        behind: status.as_ref().map(|s| s.behind).unwrap_or(0),
                        dirty: status
                            .as_ref()
                            .map(|s| {
                                (s.staged.len() + s.unstaged.len() + s.untracked.len() + s.conflicted.len())
                                    as u32
                            })
                            .unwrap_or(0),
                        last_commit: last,
                        worktrees: wt,
                        error: None,
                    }
                }
                Err(e) => RepoOverview {
                    path,
                    name,
                    exists: true,
                    branch: String::new(),
                    ahead: 0,
                    behind: 0,
                    dirty: 0,
                    last_commit: 0,
                    worktrees: 0,
                    error: Some(e.to_string()),
                },
            }
        })
        .collect()
}

/* ───────────────────────── 桌面能力 ───────────────────────── */

/// 启动参数里的仓库路径（`gitpanel.exe <repo>`）
#[tauri::command]
fn startup_repo() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with('-'))
}

/// 打开外部链接，只允许 http(s)
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只允许打开 http(s) 链接".into());
    }
    #[cfg(windows)]
    {
        git_core::proc::command("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        git_core::proc::command("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 GitPanel", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("GitPanel")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let conn = open_db(&handle).expect("无法初始化本地数据库");
            app.manage(Db(Mutex::new(conn)));
            build_tray(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮走前端逻辑；这里兜住 Alt+F4 等系统关闭，默认收进托盘
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            git_call,
            startup_repo,
            open_external,
            hide_to_tray,
            exit_app,
            recent_list,
            recent_touch,
            recent_remove,
            recent_pin,
            worktree_meta_list,
            worktree_meta_set,
            worktree_meta_touch,
            repos_overview,
            project_rename,
            clone_repo,
            git_identity
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitPanel");
}
