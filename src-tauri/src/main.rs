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
        "file-diff" => serde_json::to_value(repo.file_diff(&s(&p, "oid"), &s(&p, "file"))?)?,

        "commands" => json!({ "commands": repo.commands() }),
        "run-command" => serde_json::to_value(repo.run_command(&s(&p, "id"))?)?,
        "remotes" => json!({ "remotes": repo.remotes()? }),

        "checkout" => serde_json::to_value(repo.checkout(&s(&p, "ref"))?)?,
        "create-branch" => {
            let from = opt_s(&p, "from");
            serde_json::to_value(repo.create_branch(&s(&p, "name"), from.as_deref())?)?
        }

        "worktree-status" => serde_json::to_value(repo.worktree_status()?)?,
        "worktree-diff" => serde_json::to_value(repo.worktree_diff(&s(&p, "file"), b(&p, "staged"))?)?,
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

        other => return Err(anyhow!("未知命令: {other}")),
    };

    Ok(out)
}

/* ───────────────────────── 最近打开（SQLite） ───────────────────────── */

struct Db(Mutex<Connection>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentRepo {
    path: String,
    name: String,
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
        );",
    )?;
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
        .prepare("SELECT path, name, opened_at, pinned FROM recent ORDER BY pinned DESC, opened_at DESC LIMIT 50")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(RecentRepo {
                path: r.get(0)?,
                name: r.get(1)?,
                opened_at: r.get(2)?,
                pinned: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
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
            recent_pin
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitPanel");
}
