// 工作区状态、写操作、安全网快照、冲突解析。
// 与 devserver/ops.mjs、devserver/conflict.mjs 保持同一份契约：
// 读路径结构化解剖 git 输出，写路径走 git CLI（避免 libgit2 在 rebase/merge 上的行为差异）。
use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::repo::Repo;

pub const SNAP_PREFIX: &str = "refs/gitpanel/snapshots";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    pub path: String,
    pub status: String,
    #[serde(default)]
    pub orig_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub branch: String,
    pub oid: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<StatusFile>,
    pub unstaged: Vec<StatusFile>,
    pub untracked: Vec<StatusFile>,
    pub conflicted: Vec<StatusFile>,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub r#ref: String,
    pub label: String,
    pub oid: String,
    pub short: String,
    pub time: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictBlock {    /// text | conflict
    pub kind: String,
    pub text: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub ours_label: String,
    pub theirs_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDetail {
    pub path: String,
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub working: String,
    pub has_markers: bool,
    pub blocks: Vec<ConflictBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: usize,
    pub r#ref: String,
    pub time: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashDiff {
    pub r#ref: String,
    pub files: Vec<StashFile>,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashFile {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub annotated: bool,
    pub time: i64,
    pub subject: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub oid: String,
    pub short: String,
    pub selector: String,
    pub time: i64,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub ok: bool,
    pub conflicts: bool,
    pub output: String,
    pub snapshot: Option<String>,
    pub conflicted: Vec<StatusFile>,
}

fn looks_binary(buf: &[u8]) -> bool {
    buf.iter().take(8000).any(|b| *b == 0)
}

fn blob_to_text(buf: Option<&[u8]>, max: usize) -> String {
    match buf {
        Some(b) => {
            let end = b.len().min(max);
            String::from_utf8_lossy(&b[..end]).to_string()
        }
        None => String::new(),
    }
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .context("无法启动 git")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        bail!("{}", if err.is_empty() { "git 执行失败".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn git_allow_fail(repo: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(repo).args(args).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        None
    }
}

/* ────────────────────────── 状态解析 ────────────────────────── */

/// 解析 `git status --porcelain=v2 -z`
pub fn parse_status(raw: &str) -> WorktreeStatus {
    let mut st = WorktreeStatus::default();
    let parts: Vec<&str> = raw.split('\0').collect();
    let mut i = 0usize;

    while i < parts.len() {
        let rec = parts[i];
        if rec.is_empty() {
            i += 1;
            continue;
        }

        if let Some(rest) = rec.strip_prefix("# branch.head ") {
            st.branch = rest.to_string();
        } else if let Some(rest) = rec.strip_prefix("# branch.oid ") {
            st.oid = rest.to_string();
        } else if let Some(rest) = rec.strip_prefix("# branch.ab ") {
            for tok in rest.split_whitespace() {
                if let Some(v) = tok.strip_prefix('+') {
                    st.ahead = v.parse().unwrap_or(0);
                } else if let Some(v) = tok.strip_prefix('-') {
                    st.behind = v.parse().unwrap_or(0);
                }
            }
        } else if rec.starts_with("1 ") {
            let f: Vec<&str> = rec.split(' ').collect();
            if f.len() >= 9 {
                push_xy(&mut st, f[1], &f[8..].join(" "), "");
            }
        } else if rec.starts_with("2 ") {
            let f: Vec<&str> = rec.split(' ').collect();
            let orig = parts.get(i + 1).copied().unwrap_or("");
            if f.len() >= 10 {
                push_xy(&mut st, f[1], &f[9..].join(" "), orig);
            }
            i += 1;
        } else if rec.starts_with("u ") {
            let f: Vec<&str> = rec.split(' ').collect();
            if f.len() >= 11 {
                st.conflicted.push(StatusFile {
                    path: f[10..].join(" "),
                    status: f[1].to_string(),
                    orig_path: String::new(),
                });
            }
        } else if let Some(rest) = rec.strip_prefix("? ") {
            st.untracked.push(StatusFile {
                path: rest.to_string(),
                status: "?".into(),
                orig_path: String::new(),
            });
        }

        i += 1;
    }

    st.clean = st.staged.is_empty()
        && st.unstaged.is_empty()
        && st.untracked.is_empty()
        && st.conflicted.is_empty();
    st
}

fn push_xy(st: &mut WorktreeStatus, xy: &str, path: &str, orig: &str) {
    let x = xy.chars().next().unwrap_or('.');
    let y = xy.chars().nth(1).unwrap_or('.');
    if x != '.' && x != '?' {
        st.staged.push(StatusFile {
            path: path.to_string(),
            status: x.to_string(),
            orig_path: orig.to_string(),
        });
    }
    if y != '.' && y != '?' {
        st.unstaged.push(StatusFile {
            path: path.to_string(),
            status: y.to_string(),
            orig_path: orig.to_string(),
        });
    }
}

/* ────────────────────────── 冲突解析 ────────────────────────── */

pub fn parse_conflict_blocks(text: &str) -> Vec<ConflictBlock> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut blocks: Vec<ConflictBlock> = Vec::new();
    let mut buf: Vec<&str> = Vec::new();
    let mut i = 0usize;

    let text_block = |buf: &[&str]| ConflictBlock {
        kind: "text".into(),
        text: Some(buf.join("\n")),
        ours: None,
        theirs: None,
        ours_label: String::new(),
        theirs_label: String::new(),
    };

    while i < lines.len() {
        let line = lines[i];
        if line.starts_with("<<<<<<<") {
            if !buf.is_empty() {
                blocks.push(text_block(&buf));
                buf.clear();
            }
            let ours_label = line.trim_start_matches('<').trim().to_string();

            i += 1;
            let mut ours: Vec<&str> = Vec::new();
            while i < lines.len()
                && !lines[i].starts_with("=======")
                && !lines[i].starts_with("|||||||")
            {
                ours.push(lines[i]);
                i += 1;
            }

            if i < lines.len() && lines[i].starts_with("|||||||") {
                i += 1;
                while i < lines.len() && !lines[i].starts_with("=======") {
                    i += 1;
                }
            }
            if i < lines.len() && lines[i].starts_with("=======") {
                i += 1;
            }

            let mut theirs: Vec<&str> = Vec::new();
            while i < lines.len() && !lines[i].starts_with(">>>>>>>") {
                theirs.push(lines[i]);
                i += 1;
            }
            let theirs_label = if i < lines.len() {
                lines[i].trim_start_matches('>').trim().to_string()
            } else {
                String::new()
            };
            if i < lines.len() {
                i += 1;
            }

            blocks.push(ConflictBlock {
                kind: "conflict".into(),
                text: None,
                ours: Some(ours.join("\n")),
                theirs: Some(theirs.join("\n")),
                ours_label,
                theirs_label,
            });
        } else {
            buf.push(line);
            i += 1;
        }
    }

    if !buf.is_empty() {
        blocks.push(text_block(&buf));
    }
    blocks
}

/// choices 与 blocks 等长：ours | theirs | both | none
pub fn compose_resolution(blocks: &[ConflictBlock], choices: &[String]) -> String {
    blocks
        .iter()
        .enumerate()
        .map(|(i, b)| {
            if b.kind != "conflict" {
                return b.text.clone().unwrap_or_default();
            }
            let choice = choices.get(i).map(|s| s.as_str()).unwrap_or("ours");
            let ours = b.ours.clone().unwrap_or_default();
            let theirs = b.theirs.clone().unwrap_or_default();
            match choice {
                "theirs" => theirs,
                "both" => format!("{ours}\n{theirs}"),
                "none" => String::new(),
                _ => ours,
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/* ────────────────────────── Repo 方法 ────────────────────────── */

impl Repo {
    pub fn worktree_status(&self) -> Result<WorktreeStatus> {
        let out = git(
            self.path(),
            &[
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=normal",
            ],
        )?;
        Ok(parse_status(&out))
    }

    pub fn stage(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let mut args = vec!["add", "--"];
        args.extend(files.iter().map(|s| s.as_str()));
        git(self.path(), &args)?;
        Ok(())
    }

    pub fn unstage(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let mut args = vec!["restore", "--staged", "--"];
        args.extend(files.iter().map(|s| s.as_str()));
        if git(self.path(), &args).is_err() {
            let mut fallback = vec!["reset", "-q", "HEAD", "--"];
            fallback.extend(files.iter().map(|s| s.as_str()));
            git(self.path(), &fallback)?;
        }
        Ok(())
    }

    pub fn discard(&self, files: &[String], untracked: bool) -> Result<String> {
        if files.is_empty() {
            bail!("没有需要丢弃的文件");
        }
        let snap = self.create_snapshot("discard")?.unwrap_or_default();
        let mut args: Vec<&str> = if untracked {
            vec!["clean", "-fd", "--"]
        } else {
            vec!["checkout", "--"]
        };
        args.extend(files.iter().map(|s| s.as_str()));
        git(self.path(), &args)?;
        Ok(snap)
    }

    pub fn commit_changes(&self, message: &str, amend: bool, add_all: bool) -> Result<String> {
        if message.trim().is_empty() {
            bail!("提交信息不能为空");
        }
        if add_all {
            git(self.path(), &["add", "-A"])?;
        }
        let mut args: Vec<String> = vec!["commit".into()];
        if amend {
            args.push("--amend".into());
        }
        for para in message.split("\n\n").filter(|p| !p.trim().is_empty()) {
            args.push("-m".into());
            args.push(para.to_string());
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        git(self.path(), &refs)?;
        Ok(git(self.path(), &["rev-parse", "HEAD"])?.trim().to_string())
    }

    pub fn create_snapshot(&self, label: &str) -> Result<Option<String>> {
        let Some(head) = git_allow_fail(self.path(), &["rev-parse", "HEAD"]) else {
            return Ok(None);
        };
        let head = head.trim();
        if head.is_empty() {
            return Ok(None);
        }
        let safe: String = label
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let name = format!("{SNAP_PREFIX}/{ts}-{}", if safe.is_empty() { "op" } else { &safe });
        git(self.path(), &["update-ref", &name, head])?;
        Ok(Some(name))
    }

    pub fn list_snapshots(&self) -> Result<Vec<Snapshot>> {
        let Some(out) = git_allow_fail(
            self.path(),
            &[
                "for-each-ref",
                "--format=%(refname)%1f%(objectname)%1f%(subject)",
                SNAP_PREFIX,
            ],
        ) else {
            return Ok(Vec::new());
        };

        let mut list = Vec::new();
        for line in out.lines().filter(|l| !l.trim().is_empty()) {
            let mut it = line.split('\u{1f}');
            let refname = it.next().unwrap_or("").to_string();
            let oid = it.next().unwrap_or("").to_string();
            let subject = it.next().unwrap_or("").to_string();
            let name = refname
                .strip_prefix(&format!("{SNAP_PREFIX}/"))
                .unwrap_or(&refname)
                .to_string();
            let (ts_str, label) = match name.split_once('-') {
                Some((t, l)) => (t.to_string(), l.to_string()),
                None => (String::new(), name.clone()),
            };
            let created_ms: i64 = ts_str.parse().unwrap_or(0);
            list.push(Snapshot {
                r#ref: refname,
                label,
                short: oid.chars().take(7).collect(),
                oid,
                time: if created_ms > 0 { created_ms / 1000 } else { 0 },
                subject,
            });
        }
        list.sort_by(|a, b| b.time.cmp(&a.time));
        Ok(list)
    }

    pub fn restore_snapshot(&self, reference: &str) -> Result<()> {
        if !reference.starts_with(&format!("{SNAP_PREFIX}/")) {
            bail!("非法的快照引用");
        }
        self.create_snapshot("before-restore")?;
        git(self.path(), &["reset", "--hard", reference])?;
        Ok(())
    }

    /* ── 冲突 ── */

    fn stage_blob(&self, file: &str, stage: u8) -> String {
        git_allow_fail(self.path(), &["show", &format!(":{stage}:{file}")])
            .unwrap_or_default()
    }

    pub fn conflict_detail(&self, file: &str) -> Result<ConflictDetail> {
        let base = self.stage_blob(file, 1);
        let ours = self.stage_blob(file, 2);
        let theirs = self.stage_blob(file, 3);

        let working = fs::read_to_string(self.path().join(file)).unwrap_or_default();
        let blocks = parse_conflict_blocks(&working);
        let has_markers = blocks.iter().any(|b| b.kind == "conflict");

        Ok(ConflictDetail {
            path: file.to_string(),
            base,
            ours,
            theirs,
            working,
            has_markers,
            blocks,
        })
    }

    pub fn resolve_conflict(&self, file: &str, content: &str) -> Result<()> {
        let abs = self.path().join(file);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&abs, content)?;
        git(self.path(), &["add", "--", file])?;
        Ok(())
    }

    pub fn resolve_side(&self, file: &str, theirs: bool) -> Result<()> {
        let content = self.stage_blob(file, if theirs { 3 } else { 2 });
        self.resolve_conflict(file, &content)
    }
    /* ── 暂存 ── */

    pub fn list_stashes(&self) -> Result<Vec<Stash>> {
        let out = match git_allow_fail(
            self.path(),
            &["stash", "list", "--format=%gd%x1f%ct%x1f%gs"],
        ) {
            Some(o) => o,
            None => return Ok(Vec::new()),
        };

        Ok(out
            .lines()
            .filter(|l| !l.trim().is_empty())
            .enumerate()
            .map(|(i, line)| {
                let mut it = line.split('\u{1f}');
                let r = it.next().unwrap_or("").to_string();
                let time = it.next().unwrap_or("0").parse().unwrap_or(0);
                let message = it.next().unwrap_or("").to_string();
                Stash {
                    index: i,
                    r#ref: if r.is_empty() { format!("stash@{{{i}}}") } else { r },
                    time,
                    message,
                }
            })
            .collect())
    }

    pub fn create_stash(&self, message: &str, include_untracked: bool) -> Result<String> {
        let mut args = vec!["stash", "push"];
        let msg = message.trim();
        if !msg.is_empty() {
            args.push("-m");
            args.push(msg);
        }
        if include_untracked {
            args.push("-u");
        }
        Ok(git(self.path(), &args)?.trim().to_string())
    }

    pub fn stash_action(&self, reference: &str, action: &str) -> Result<String> {
        if !reference.starts_with("stash@{") || !reference.ends_with('}') {
            bail!("非法的 stash 引用");
        }
        let sub = match action {
            "apply" => "apply",
            "pop" => "pop",
            "drop" => "drop",
            _ => bail!("未知的 stash 操作: {action}"),
        };
        Ok(git(self.path(), &["stash", sub, reference])?.trim().to_string())
    }

    pub fn stash_diff(&self, reference: &str) -> Result<StashDiff> {
        if !reference.starts_with("stash@{") || !reference.ends_with('}') {
            bail!("非法的 stash 引用");
        }
        let patch = git_allow_fail(
            self.path(),
            &["stash", "show", "-p", "--no-color", reference],
        )
        .unwrap_or_default();

        let mut files = Vec::new();
        if let Some(numstat) = git_allow_fail(self.path(), &["stash", "show", "--numstat", reference]) {
            for line in numstat.lines().filter(|l| !l.trim().is_empty()) {
                let mut it = line.split('\t');
                let a = it.next().unwrap_or("0");
                let d = it.next().unwrap_or("0");
                let path = it.collect::<Vec<_>>().join("\t");
                files.push(StashFile {
                    path,
                    additions: if a == "-" { 0 } else { a.parse().unwrap_or(0) },
                    deletions: if d == "-" { 0 } else { d.parse().unwrap_or(0) },
                });
            }
        }

        Ok(StashDiff {
            r#ref: reference.to_string(),
            files,
            patch,
        })
    }

    /* ── 标签 ── */

    pub fn list_tags(&self) -> Result<Vec<TagInfo>> {
        let out = match git_allow_fail(
            self.path(),
            &[
                "for-each-ref",
                "--format=%(refname:short)%1f%(objecttype)%1f%(taggerdate:unix)%1f%(subject)%1f%(*objectname)%1f%(objectname)",
                "refs/tags",
            ],
        ) {
            Some(o) => o,
            None => return Ok(Vec::new()),
        };

        let mut tags: Vec<TagInfo> = out
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                let mut it = line.split('\u{1f}');
                let name = it.next().unwrap_or("").to_string();
                let objtype = it.next().unwrap_or("");
                let time = it.next().unwrap_or("0").parse().unwrap_or(0);
                let subject = it.next().unwrap_or("").to_string();
                let peeled = it.next().unwrap_or("").to_string();
                let oid = it.next().unwrap_or("").to_string();
                TagInfo {
                    name,
                    annotated: objtype == "tag",
                    time,
                    subject,
                    oid: if peeled.is_empty() { oid } else { peeled },
                }
            })
            .collect();

        tags.sort_by(|a, b| b.time.cmp(&a.time));
        Ok(tags)
    }

    pub fn create_tag(&self, name: &str, message: &str, oid: &str) -> Result<()> {
        if !crate::actions::valid_ref(name) {
            bail!("非法的标签名");
        }
        let mut args: Vec<String> = vec!["tag".into()];
        if !message.trim().is_empty() {
            args.push("-a".into());
            args.push("-m".into());
            args.push(message.trim().to_string());
        }
        args.push(name.to_string());
        if !oid.is_empty() {
            if !oid.chars().all(|c| c.is_ascii_hexdigit()) {
                bail!("非法的提交");
            }
            args.push(oid.to_string());
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        git(self.path(), &refs)?;
        Ok(())
    }

    pub fn delete_tag(&self, name: &str) -> Result<()> {
        if !crate::actions::valid_ref(name) {
            bail!("非法的标签名");
        }
        git(self.path(), &["tag", "-d", name])?;
        Ok(())
    }

    /* ── reflog ── */

    pub fn reflog(&self, limit: usize) -> Result<Vec<ReflogEntry>> {
        let n = limit.clamp(1, 500).to_string();
        let out = match git_allow_fail(
            self.path(),
            &["reflog", "--format=%H%x1f%gd%x1f%ct%x1f%gs", "-n", &n],
        ) {
            Some(o) => o,
            None => return Ok(Vec::new()),
        };

        Ok(out
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                let mut it = line.split('\u{1f}');
                let oid = it.next().unwrap_or("").to_string();
                let selector = it.next().unwrap_or("").to_string();
                let time = it.next().unwrap_or("0").parse().unwrap_or(0);
                let action = it.next().unwrap_or("").to_string();
                ReflogEntry {
                    short: oid.chars().take(7).collect(),
                    oid,
                    selector,
                    time,
                    action,
                }
            })
            .collect())
    }

    pub fn reset_to(&self, oid: &str, mode: &str) -> Result<Option<String>> {
        if !oid.chars().all(|c| c.is_ascii_hexdigit()) || oid.len() < 4 {
            bail!("非法的提交");
        }
        if !matches!(mode, "soft" | "mixed" | "hard") {
            bail!("非法的重置模式");
        }
        let snap = self.create_snapshot(&format!("before-reset-{mode}"))?;
        git(self.path(), &["reset", &format!("--{mode}"), oid])?;
        Ok(snap)
    }

    /* ── 工作区 Diff / 同步 / 分支 ── */

    fn stage_blob_bytes(&self, spec: &str) -> Option<Vec<u8>> {
        let out = Command::new("git")
            .arg("-C")
            .arg(self.path())
            .args(["show", spec])
            .output()
            .ok()?;
        if out.status.success() {
            Some(out.stdout)
        } else {
            None
        }
    }

    pub fn worktree_diff(&self, file: &str, staged: bool) -> Result<crate::model::FileDiff> {
        const MAX: usize = 400_000;

        let (old, new) = if staged {
            (
                self.stage_blob_bytes(&format!("HEAD:{file}")),
                self.stage_blob_bytes(&format!(":0:{file}")),
            )
        } else {
            (
                self.stage_blob_bytes(&format!(":0:{file}")),
                fs::read(self.path().join(file)).ok(),
            )
        };

        let is_binary = old.as_deref().map(looks_binary).unwrap_or(false)
            || new.as_deref().map(looks_binary).unwrap_or(false);
        let truncated = old.as_ref().map(|b| b.len() > MAX).unwrap_or(false)
            || new.as_ref().map(|b| b.len() > MAX).unwrap_or(false);

        let (old_text, new_text) = if is_binary {
            (String::new(), String::new())
        } else {
            (blob_to_text(old.as_deref(), MAX), blob_to_text(new.as_deref(), MAX))
        };

        Ok(crate::model::FileDiff {
            path: file.to_string(),
            old_text,
            new_text,
            is_binary,
            truncated,
        })
    }

    pub fn fetch(&self) -> Result<String> {
        Ok(git(self.path(), &["fetch", "--all", "--prune"])?.trim().to_string())
    }

    pub fn pull(&self) -> Result<String> {
        Ok(git(self.path(), &["pull", "--no-rebase", "--autostash"])?.trim().to_string())
    }

    pub fn push(&self, force: bool) -> Result<String> {
        let args: Vec<&str> = if force {
            vec!["push", "--force-with-lease"]
        } else {
            vec!["push"]
        };
        Ok(git(self.path(), &args)?.trim().to_string())
    }

    pub fn merge_branch(&self, name: &str) -> Result<MergeResult> {
        if !crate::actions::valid_ref(name) {
            bail!("非法的分支名");
        }
        let snapshot = self.create_snapshot("before-merge")?;
        let current = git(self.path(), &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();
        if current == name {
            bail!("不能合并当前分支到自己");
        }

        match git(self.path(), &["merge", "--no-ff", "--no-edit", name]) {
            Ok(out) => Ok(MergeResult {
                ok: true,
                conflicts: false,
                output: out.trim().to_string(),
                snapshot,
                conflicted: Vec::new(),
            }),
            Err(e) => {
                let st = self.worktree_status()?;
                Ok(MergeResult {
                    ok: false,
                    conflicts: !st.conflicted.is_empty(),
                    output: e.to_string(),
                    snapshot,
                    conflicted: st.conflicted,
                })
            }
        }
    }

    pub fn delete_branch(&self, name: &str, force: bool) -> Result<Option<String>> {
        if !crate::actions::valid_ref(name) {
            bail!("非法的分支名");
        }
        let current = git(self.path(), &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();
        if current == name {
            bail!("不能删除当前所在分支");
        }
        let snapshot = self.create_snapshot("before-delete-branch")?;
        git(self.path(), &["branch", if force { "-D" } else { "-d" }, name])?;
        Ok(snapshot)
    }

    pub fn rename_branch(&self, from: &str, to: &str) -> Result<()> {
        if !crate::actions::valid_ref(from) || !crate::actions::valid_ref(to) {
            bail!("非法的分支名");
        }
        git(self.path(), &["branch", "-m", from, to])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# branch.oid abc123\0# branch.head main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 aaa bbb src/app.ts\0\
1 A. N... 100644 100644 100644 aaa bbb new.txt\0\
? notes.md\0\
u UU N... 100644 100644 100644 100644 aaa bbb ccc app.txt\0";

    #[test]
    fn parses_porcelain_v2() {
        let st = parse_status(SAMPLE);
        assert_eq!(st.branch, "main");
        assert_eq!(st.ahead, 2);
        assert_eq!(st.behind, 1);
        assert!(!st.clean);
        assert_eq!(st.staged.len(), 1);
        assert_eq!(st.staged[0].path, "new.txt");
        assert_eq!(st.unstaged.len(), 1);
        assert_eq!(st.unstaged[0].path, "src/app.ts");
        assert_eq!(st.untracked.len(), 1);
        assert_eq!(st.conflicted.len(), 1);
        assert_eq!(st.conflicted[0].status, "UU");
    }

    const CONFLICT: &str = "line 1\n<<<<<<< HEAD\nours value\n=======\ntheirs value\n>>>>>>> feature\nline 3";

    #[test]
    fn parses_and_composes_conflict_blocks() {
        let blocks = parse_conflict_blocks(CONFLICT);
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0].kind, "text");
        assert_eq!(blocks[1].kind, "conflict");
        assert_eq!(blocks[1].ours.as_deref(), Some("ours value"));
        assert_eq!(blocks[1].theirs.as_deref(), Some("theirs value"));
        assert_eq!(blocks[1].theirs_label, "feature");

        let ours = compose_resolution(&blocks, &[]);
        assert_eq!(ours, "line 1\nours value\nline 3");

        let theirs = compose_resolution(&blocks, &["text".into(), "theirs".into(), "text".into()]);
        assert_eq!(theirs, "line 1\ntheirs value\nline 3");

        let both = compose_resolution(&blocks, &["text".into(), "both".into(), "text".into()]);
        assert_eq!(both, "line 1\nours value\ntheirs value\nline 3");
    }

    #[test]
    fn detects_clean_status() {
        let st = parse_status("# branch.head main\0");
        assert!(st.clean);
        assert!(st.staged.is_empty());
    }
}
