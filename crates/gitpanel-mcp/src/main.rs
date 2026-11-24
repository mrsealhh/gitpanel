//! GitPanel MCP 服务端（stdio）。
//!
//! 第三方 AI（Claude Desktop / Cursor / Continue…）通过 Model Context Protocol
//! 调用本进程，即可读取仓库信息并执行常见写操作。
//!
//! 安全：默认全量能力；设置环境变量 `GITPANEL_MCP_READ_ONLY=1` 后只保留读工具。

use std::io::{self, BufRead, Write};

use git_core::Repo;
use serde_json::{json, Value};

const PROTOCOL_VERSION: &str = "2025-06-18";

fn main() {
    let stdin = io::stdin();
    let mut out = io::stdout();
    let read_only = std::env::var("GITPANEL_MCP_READ_ONLY").map(|v| v == "1").unwrap_or(false);

    for line in stdin.lock().lines() {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        // 通知类消息（没有 id）不需要回复
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(json!({}));

        let response = match method {
            "initialize" => Some(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "gitpanel", "version": env!("CARGO_PKG_VERSION") }
            })),
            "notifications/initialized" => None,
            "ping" => Some(json!({})),
            "tools/list" => Some(json!({ "tools": tool_list(read_only) })),
            "tools/call" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                Some(match call_tool(name, &args, read_only) {
                    Ok(value) => json!({
                        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&value).unwrap_or_default() }]
                    }),
                    Err(e) => json!({
                        "content": [{ "type": "text", "text": e.to_string() }],
                        "isError": true
                    }),
                })
            }
            _ => None,
        };

        if let (Some(id), Some(result)) = (id, response) {
            let payload = json!({ "jsonrpc": "2.0", "id": id, "result": result });
            let _ = writeln!(out, "{payload}");
            let _ = out.flush();
        }
    }
}

fn p(desc: &str, ty: &str) -> Value {
    json!({ "description": desc, "type": ty })
}

fn tool_list(read_only: bool) -> Vec<Value> {
    let mut tools = vec![
        json!({
            "name": "repo_info",
            "description": "仓库基本信息：路径、当前分支、refs 列表",
            "inputSchema": { "type": "object", "properties": { "path": p("仓库路径", "string") }, "required": ["path"] }
        }),
        json!({
            "name": "graph",
            "description": "提交图（含泳道布局），按时间倒序返回",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"),
                "limit": p("返回条数，默认 100", "number"),
                "tip": p("只看某个引用，如 main", "string")
            }, "required": ["path"] }
        }),
        json!({
            "name": "commit_detail",
            "description": "单个提交的详情与文件变更统计",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "oid": p("提交 SHA", "string")
            }, "required": ["path", "oid"] }
        }),
        json!({
            "name": "file_diff",
            "description": "某文件在某个提交里相对父提交的完整前后文",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "oid": p("提交 SHA", "string"), "file": p("文件路径", "string")
            }, "required": ["path", "oid", "file"] }
        }),
        json!({
            "name": "file_history",
            "description": "单文件提交历史（跟随重命名）",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "file": p("文件路径", "string"),
                "limit": p("条数，默认 50", "number")
            }, "required": ["path", "file"] }
        }),
        json!({
            "name": "working_status",
            "description": "工作区状态：已暂存 / 未暂存 / 未跟踪 / 冲突",
            "inputSchema": { "type": "object", "properties": { "path": p("仓库路径", "string") }, "required": ["path"] }
        }),
        json!({
            "name": "branches",
            "description": "分支、远端、标签列表",
            "inputSchema": { "type": "object", "properties": { "path": p("仓库路径", "string") }, "required": ["path"] }
        }),
        json!({
            "name": "worktrees",
            "description": "所有工作树（并行副本）：分支、脏文件、是否已合回主干",
            "inputSchema": { "type": "object", "properties": { "path": p("仓库路径", "string") }, "required": ["path"] }
        }),
        json!({
            "name": "repo_health",
            "description": "仓库体检：体积、pack、松散对象、历史最大对象与建议",
            "inputSchema": { "type": "object", "properties": { "path": p("仓库路径", "string") }, "required": ["path"] }
        }),
        json!({
            "name": "reflog",
            "description": "HEAD 变更历史（可据此撤销操作）",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "limit": p("条数，默认 30", "number")
            }, "required": ["path"] }
        }),
    ];

    if read_only {
        return tools;
    }

    tools.extend(vec![
        json!({
            "name": "stage",
            "description": "暂存指定文件",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "files": { "type": "array", "items": { "type": "string" } }
            }, "required": ["path", "files"] }
        }),
        json!({
            "name": "unstage",
            "description": "取消暂存指定文件",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "files": { "type": "array", "items": { "type": "string" } }
            }, "required": ["path", "files"] }
        }),
        json!({
            "name": "commit",
            "description": "提交已暂存的改动",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "message": p("提交信息（空行分段）", "string"),
                "amend": p("是否 amend 上一个提交", "boolean"), "addAll": p("提交前先 git add -A", "boolean")
            }, "required": ["path", "message"] }
        }),
        json!({
            "name": "create_branch",
            "description": "新建分支并切过去",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "name": p("分支名", "string"), "from": p("起点，默认当前 HEAD", "string")
            }, "required": ["path", "name"] }
        }),
        json!({
            "name": "checkout",
            "description": "检出分支或提交",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "ref": p("分支名或 SHA", "string")
            }, "required": ["path", "ref"] }
        }),
        json!({
            "name": "merge_branch",
            "description": "把某个分支合并到当前分支",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "name": p("要合并的分支", "string")
            }, "required": ["path", "name"] }
        }),
        json!({
            "name": "worktree_add",
            "description": "新建工作树（并行副本）",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "target": p("目标目录", "string"),
                "branch": p("分支名", "string"), "newBranch": p("是否新建分支", "boolean"),
                "base": p("起点，默认 HEAD", "string")
            }, "required": ["path", "target", "branch"] }
        }),
        json!({
            "name": "worktree_remove",
            "description": "移除工作树（不删除分支）",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "target": p("工作树目录", "string"),
                "force": p("有改动时强制移除", "boolean")
            }, "required": ["path", "target"] }
        }),
        json!({
            "name": "stash_create",
            "description": "把当前改动存进 stash",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "message": p("描述", "string"),
                "includeUntracked": p("是否包含未跟踪文件", "boolean")
            }, "required": ["path"] }
        }),
        json!({
            "name": "stash_action",
            "description": "apply / pop / drop 某个 stash",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "ref": p("stash@{0}", "string"),
                "action": p("apply | pop | drop", "string")
            }, "required": ["path", "ref", "action"] }
        }),
        json!({
            "name": "tag_create",
            "description": "创建轻量或附注标签",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "name": p("标签名", "string"),
                "message": p("说明（填了就是附注标签）", "string"), "oid": p("指向的提交，默认 HEAD", "string")
            }, "required": ["path", "name"] }
        }),
        json!({
            "name": "reset_to",
            "description": "重置到某个提交（soft / mixed / hard），会先自动打安全网快照",
            "inputSchema": { "type": "object", "properties": {
                "path": p("仓库路径", "string"), "oid": p("目标提交", "string"),
                "mode": p("soft | mixed | hard", "string")
            }, "required": ["path", "oid", "mode"] }
        }),
    ]);

    tools
}

fn arg_str(a: &Value, key: &str) -> String {
    a.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn arg_arr(a: &Value, key: &str) -> Vec<String> {
    a.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn arg_bool(a: &Value, key: &str) -> bool {
    a.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn open(a: &Value) -> anyhow::Result<Repo> {
    let path = arg_str(a, "path");
    if path.is_empty() {
        anyhow::bail!("缺少参数 path");
    }
    Ok(Repo::open(&path)?)
}

fn call_tool(name: &str, args: &Value, read_only: bool) -> anyhow::Result<Value> {
    let read_tool = matches!(
        name,
        "repo_info"
            | "graph"
            | "commit_detail"
            | "file_diff"
            | "file_history"
            | "working_status"
            | "branches"
            | "worktrees"
            | "repo_health"
            | "reflog"
    );
    if read_only && !read_tool {
        anyhow::bail!("当前 MCP 服务运行在只读模式（GITPANEL_MCP_READ_ONLY=1）");
    }

    let repo = open(args)?;

    Ok(match name {
        "repo_info" => serde_json::to_value(repo.info()?)?,
        "graph" => {
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as u32;
            serde_json::to_value(repo.graph_page(0, limit, &arg_str(args, "tip"))?)?
        }
        "commit_detail" => serde_json::to_value(repo.commit_detail(&arg_str(args, "oid"))?)?,
        "file_diff" => serde_json::to_value(
            repo.file_diff(&arg_str(args, "oid"), &arg_str(args, "file"))?,
        )?,
        "file_history" => {
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
            serde_json::to_value(repo.file_history(&arg_str(args, "file"), limit)?)?
        }
        "working_status" => serde_json::to_value(repo.worktree_status()?)?,
        "branches" => json!({
            "refs": repo.refs()?,
            "tags": repo.list_tags()?,
            "head": repo.head_branch(),
        }),
        "worktrees" => json!({ "worktrees": repo.worktrees()? }),
        "repo_health" => serde_json::to_value(repo.repo_health()?)?,
        "reflog" => {
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(30) as usize;
            json!({ "entries": repo.reflog(limit)? })
        }

        "stage" => {
            repo.stage(&arg_arr(args, "files"))?;
            json!({ "ok": true })
        }
        "unstage" => {
            repo.unstage(&arg_arr(args, "files"))?;
            json!({ "ok": true })
        }
        "commit" => {
            let oid = repo.commit_changes(
                &arg_str(args, "message"),
                arg_bool(args, "amend"),
                arg_bool(args, "addAll"),
            )?;
            json!({ "ok": true, "oid": oid })
        }
        "create_branch" => {
            let from = arg_str(args, "from");
            serde_json::to_value(
                repo.create_branch(&arg_str(args, "name"), if from.is_empty() { None } else { Some(&from) })?,
            )?
        }
        "checkout" => serde_json::to_value(repo.checkout(&arg_str(args, "ref"))?)?,
        "merge_branch" => serde_json::to_value(repo.merge_branch(&arg_str(args, "name"))?)?,
        "worktree_add" => {
            let p = repo.add_worktree(
                &arg_str(args, "target"),
                &arg_str(args, "branch"),
                arg_bool(args, "newBranch"),
                &arg_str(args, "base"),
            )?;
            json!({ "ok": true, "path": p })
        }
        "worktree_remove" => {
            repo.remove_worktree(&arg_str(args, "target"), arg_bool(args, "force"))?;
            json!({ "ok": true })
        }
        "stash_create" => json!({
            "ok": true,
            "output": repo.create_stash(&arg_str(args, "message"), arg_bool(args, "includeUntracked"))?
        }),
        "stash_action" => json!({
            "ok": true,
            "output": repo.stash_action(&arg_str(args, "ref"), &arg_str(args, "action"))?
        }),
        "tag_create" => {
            repo.create_tag(
                &arg_str(args, "name"),
                &arg_str(args, "message"),
                &arg_str(args, "oid"),
            )?;
            json!({ "ok": true })
        }
        "reset_to" => {
            let snapshot = repo.reset_to(&arg_str(args, "oid"), &arg_str(args, "mode"))?;
            json!({ "ok": true, "snapshot": snapshot })
        }

        other => anyhow::bail!("未知工具: {other}"),
    })
}
