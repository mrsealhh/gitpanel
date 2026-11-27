// 工作区状态、写操作、安全网快照、冲突解析。
// 与 devserver/ops.mjs、devserver/conflict.mjs 保持同一份契约：
// 读路径结构化解剖 git 输出，写路径走 git CLI（避免 libgit2 在 rebase/merge 上的行为差异）。
use std::fs;
use std::path::Path;

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

/// 工作区文件的一个 diff 块（hunk），支持按块暂存 / 取消暂存 / 丢弃
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// 块内的行，带 +/-/空格 前缀
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHunks {
    pub path: String,
    pub staged: bool,
    /// diff --git / index / --- / +++ 这些文件级行
    pub file_header: Vec<String>,
    pub hunks: Vec<DiffHunk>,
    pub is_binary: bool,
}

/// 分支的上游与领先/落后（左侧分支树用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    pub name: String,
    pub upstream: String,
    pub ahead: u32,
    pub behind: u32,
    pub current: bool,
    pub last_commit: i64,
}

/// cherry-pick / revert 的进行中状态（冲突时需要「继续 / 跳过 / 中止」）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceStatus {
    /// "" / "cherry-pick" / "revert"
    pub kind: String,
    pub in_progress: bool,
    pub conflicted: Vec<StatusFile>,
    /// 还剩多少个提交要处理（cherry-pick 多个时才有意义）
    pub pending: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseCommit {
    pub oid: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub oid: String,
    pub action: String,
    #[serde(default)]
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseOutcome {
    pub ok: bool,
    pub conflicts: bool,
    pub output: String,
    pub snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStatus {
    pub in_progress: bool,
    pub stopped: bool,
    pub subject: String,
    pub conflicts: bool,
    pub conflicted: Vec<StatusFile>,
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    git_env(repo, args, &[])
}

/// 带环境变量的 git 调用（例如 --continue 时把 GIT_EDITOR 指到 true）
fn git_env(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String> {
    let mut cmd = crate::proc::command("git");
    cmd.arg("-C").arg(repo).args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output().context("无法启动 git")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        bail!("{}", if err.is_empty() { "git 执行失败".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 带 stdin 的 git 调用（git apply 用）
fn git_stdin(repo: &Path, args: &[&str], input: &str) -> Result<String> {
    use std::io::Write;
    let mut child = crate::proc::command("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("无法启动 git")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes())?;
    }
    let out = child.wait_with_output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        bail!("{}", if err.is_empty() { "git apply 失败".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 解析 `git diff -U3` 输出：文件头 + 各个 hunk
fn parse_hunks(text: &str) -> (Vec<String>, Vec<DiffHunk>, bool) {
    let mut header: Vec<String> = Vec::new();
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut cur: Option<DiffHunk> = None;
    let mut is_binary = false;

    for line in text.lines() {
        if line.starts_with("Binary files") || line.starts_with("GIT binary patch") {
            is_binary = true;
        }
        if line.starts_with("@@") {
            if let Some(h) = cur.take() {
                hunks.push(h);
            }
            let (os, ol, ns, nl) = parse_hunk_header(line);
            cur = Some(DiffHunk {
                header: line.to_string(),
                old_start: os,
                old_lines: ol,
                new_start: ns,
                new_lines: nl,
                lines: Vec::new(),
            });
        } else if let Some(h) = cur.as_mut() {
            h.lines.push(line.to_string());
        } else {
            header.push(line.to_string());
        }
    }
    if let Some(h) = cur {
        hunks.push(h);
    }
    (header, hunks, is_binary)
}

/// `@@ -12,7 +12,8 @@` → (12, 7, 12, 8)
fn parse_hunk_header(line: &str) -> (u32, u32, u32, u32) {
    let mut old_start = 0;
    let mut old_lines = 1;
    let mut new_start = 0;
    let mut new_lines = 1;
    for (i, part) in line.split_whitespace().enumerate() {
        let (sign, body) = match part.chars().next() {
            Some('-') => ('-', &part[1..]),
            Some('+') => ('+', &part[1..]),
            _ => continue,
        };
        let mut nums = body.split(',');
        let start: u32 = nums.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let count: u32 = nums.next().and_then(|s| s.parse().ok()).unwrap_or(1);
        if sign == '-' {
            old_start = start;
            old_lines = count;
        } else {
            new_start = start;
            new_lines = count;
        }
        let _ = i;
    }
    (old_start, old_lines, new_start, new_lines)
}

fn git_allow_fail(repo: &Path, args: &[&str]) -> Option<String> {    let out = crate::proc::command("git").arg("-C").arg(repo).args(args).output().ok()?;
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
        let out = crate::proc::command("git")
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
        self.worktree_diff_window(file, staged, crate::text::DiffWindow::default())
    }

    /// 带行窗口的工作区 diff（大文件按块取）
    pub fn worktree_diff_window(
        &self,
        file: &str,
        staged: bool,
        win: crate::text::DiffWindow,
    ) -> Result<crate::model::FileDiff> {
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

        Ok(crate::text::build_file_diff(
            file,
            old.as_deref(),
            new.as_deref(),
            &win,
        ))
    }

    pub fn fetch(&self) -> Result<String> {
        Ok(git(self.path(), &["fetch", "--all", "--prune"])?.trim().to_string())
    }

    pub fn pull(&self, strategy: &str) -> Result<String> {
        let mut args = vec!["pull", "--autostash"];
        match strategy {
            "rebase" => args.push("--rebase"),
            "ff-only" => args.push("--ff-only"),
            _ => args.push("--no-rebase"),
        }
        Ok(git(self.path(), &args)?.trim().to_string())
    }

    /// 推送：分支还没有上游时自动 `--set-upstream` 到 origin（或第一个远端），
    /// 避免「no upstream branch」这种新手常见报错。
    pub fn push(&self, force: bool) -> Result<String> {
        let branch = git(self.path(), &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();
        if branch == "HEAD" {
            bail!("当前处于分离头指针状态，请先切到一个分支");
        }
        let upstream = git_allow_fail(
            self.path(),
            &["rev-parse", "--abbrev-ref", &format!("{branch}@{{upstream}}")],
        );
        let has_upstream = upstream.map(|u| !u.trim().is_empty()).unwrap_or(false);

        let mut args: Vec<String> = vec!["push".to_string()];
        if force {
            args.push("--force-with-lease".to_string());
        }
        if !has_upstream {
            let remote = git_allow_fail(self.path(), &["remote"])
                .unwrap_or_default()
                .lines()
                .map(|l| l.trim().to_string())
                .find(|l| l == "origin")
                .or_else(|| {
                    git_allow_fail(self.path(), &["remote"])
                        .unwrap_or_default()
                        .lines()
                        .map(|l| l.trim().to_string())
                        .find(|l| !l.is_empty())
                });
            let Some(remote) = remote else {
                bail!("这个仓库没有配置远端，先添加一个 remote 再推送");
            };
            args.push("--set-upstream".to_string());
            args.push(remote);
            args.push(branch);
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        Ok(git(self.path(), &refs)?.trim().to_string())
    }

    /// 推送指定本地分支到同名远端分支，并建立跟踪（不要求先切到该分支）
    pub fn push_branch(&self, branch: &str, force: bool) -> Result<String> {
        if !crate::actions::valid_ref(branch) {
            bail!("非法的分支名");
        }
        if git_allow_fail(
            self.path(),
            &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
        )
        .is_none()
        {
            bail!("本地分支不存在：{branch}");
        }
        let remotes = git_allow_fail(self.path(), &["remote"]).unwrap_or_default();
        let remote = remotes
            .lines()
            .map(|l| l.trim())
            .find(|l| *l == "origin")
            .or_else(|| remotes.lines().map(|l| l.trim()).find(|l| !l.is_empty()));
        let Some(remote) = remote else {
            bail!("这个仓库没有配置远端，先添加一个 remote 再推送");
        };

        let mut args: Vec<&str> = vec!["push"];
        if force {
            args.push("--force-with-lease");
        }
        args.push("--set-upstream");
        args.push(remote);
        args.push(branch);
        let out = git(self.path(), &args)?.trim().to_string();
        if out.is_empty() {
            Ok(format!("{branch} 已推送到 {remote}/{branch}"))
        } else {
            Ok(out)
        }
    }

    /// 把文件加入 .gitignore（忽略单个文件）
    pub fn ignore_file(&self, file: &str) -> Result<String> {
        let rel = file.replace('\\', "/");
        if rel.trim().is_empty() {
            bail!("缺少文件路径");
        }
        let gi = self.path().join(".gitignore");
        let mut content = fs::read_to_string(&gi).unwrap_or_default();
        let entry = format!("/{rel}");
        if content.lines().any(|l| l.trim() == entry) {
            return Ok(entry);
        }
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&entry);
        content.push('\n');
        fs::write(&gi, content)?;
        Ok(entry)
    }

    /* ── 分支状态（上游 / 领先 / 落后） ── */

    pub fn branch_status(&self) -> Result<Vec<BranchStatus>> {
        let fmt = "%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(HEAD)";
        let out = git(self.path(), &["for-each-ref", &format!("--format={fmt}"), "refs/heads"])?;
        let mut list = Vec::new();
        for line in out.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let parts: Vec<&str> = line.split('\u{1f}').collect();
            if parts.len() < 5 {
                continue;
            }
            let track = parts[2];
            let mut ahead = 0;
            let mut behind = 0;
            if let Some(inner) = track.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
                for piece in inner.split(',') {
                    let piece = piece.trim();
                    if let Some(n) = piece.strip_prefix("ahead ") {
                        ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = piece.strip_prefix("behind ") {
                        behind = n.parse().unwrap_or(0);
                    }
                }
            }
            list.push(BranchStatus {
                name: parts[0].to_string(),
                upstream: parts[1].to_string(),
                ahead,
                behind,
                current: parts[4].trim() == "*",
                last_commit: parts[3].parse().unwrap_or(0),
            });
        }
        list.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(list)
    }

    /* ── hunk 级暂存 / 取消暂存 / 丢弃 ── */

    fn raw_file_diff(&self, file: &str, staged: bool) -> Result<String> {
        let mut args = vec!["diff", "-U3", "--no-color", "--no-ext-diff"];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.push(file);
        git_allow_fail(self.path(), &args).ok_or_else(|| anyhow::anyhow!("读取 diff 失败"))
    }

    pub fn file_hunks(&self, file: &str, staged: bool) -> Result<FileHunks> {
        let text = self.raw_file_diff(file, staged)?;
        let (file_header, hunks, is_binary) = parse_hunks(&text);
        Ok(FileHunks {
            path: file.to_string(),
            staged,
            file_header,
            hunks,
            is_binary,
        })
    }

    /// mode: stage（暂存所选） / unstage（取消暂存所选） / discard（丢弃所选）
    pub fn apply_hunks(&self, file: &str, staged: bool, indexes: &[usize], mode: &str) -> Result<String> {
        let text = self.raw_file_diff(file, staged)?;
        let (file_header, hunks, _) = parse_hunks(&text);
        if hunks.is_empty() {
            bail!("这个文件没有可操作的 diff 块（可能是二进制或未跟踪文件）");
        }
        let mut patch = String::new();
        for line in &file_header {
            patch.push_str(line);
            patch.push('\n');
        }
        let mut picked = 0;
        for idx in indexes {
            if let Some(h) = hunks.get(*idx) {
                patch.push_str(&h.header);
                patch.push('\n');
                for l in &h.lines {
                    patch.push_str(l);
                    patch.push('\n');
                }
                picked += 1;
            }
        }
        if picked == 0 {
            bail!("没有选中任何 diff 块");
        }

        let mut args: Vec<&str> = vec!["apply", "--whitespace=nowarn"];
        match mode {
            "stage" => {
                args.push("--cached");
            }
            "unstage" => {
                args.push("--cached");
                args.push("--reverse");
            }
            "discard" => {
                args.push("--reverse");
            }
            other => bail!("未知操作：{other}"),
        }
        let out = git_stdin(self.path(), &args, &patch)?;
        Ok(out.trim().to_string())
    }

    /* ── 两个提交 / 分支之间的对比 ── */

    /// a..b 之间变更的文件（含状态字母）
    pub fn compare(&self, a: &str, b: &str) -> Result<Vec<crate::model::CompareFile>> {
        let out = git(self.path(), &["diff", "--name-status", "-z", a, b])?;
        let mut files = Vec::new();
        let mut it = out.split('\0').filter(|s| !s.is_empty());
        while let Some(status) = it.next() {
            let Some(path) = it.next() else { break };
            // 重命名/复制会多一个原路径
            let first = status.chars().next().unwrap_or('M');
            if first == 'R' || first == 'C' {
                let _ = it.next();
            }
            files.push(crate::model::CompareFile {
                path: path.to_string(),
                status: first.to_string(),
            });
        }
        files.sort_by(|x, y| x.path.cmp(&y.path));
        Ok(files)
    }

    pub fn compare_file(
        &self,
        a: &str,
        b: &str,
        file: &str,
        win: crate::text::DiffWindow,
    ) -> Result<crate::model::FileDiff> {
        let old = self.blob_bytes_at(a, file)?;
        let new = self.blob_bytes_at(b, file)?;
        Ok(crate::text::build_file_diff(
            file,
            old.as_deref(),
            new.as_deref(),
            &win,
        ))
    }

    /* ── cherry-pick / revert ── */

    fn check_oid(&self, oid: &str) -> Result<String> {
        let ok = !oid.is_empty()
            && oid.len() <= 40
            && oid.len() >= 4
            && oid.chars().all(|c| c.is_ascii_hexdigit());
        if !ok {
            bail!("非法的提交：{oid}");
        }
        Ok(oid.to_string())
    }

    /// 把某个提交摘到当前分支（冲突时留在冲突态，走 sequence_action）
    pub fn cherry_pick(&self, oid: &str) -> Result<MergeResult> {
        let oid = self.check_oid(oid)?;
        let snapshot = self.create_snapshot("before-cherry-pick")?;
        match git(self.path(), &["cherry-pick", &oid]) {
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

    /// 撤销某个提交（生成一个反向提交）
    pub fn revert_commit(&self, oid: &str) -> Result<MergeResult> {
        let oid = self.check_oid(oid)?;
        let snapshot = self.create_snapshot("before-revert")?;
        match git(self.path(), &["revert", "--no-edit", &oid]) {
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

    fn git_dir(&self) -> Option<std::path::PathBuf> {
        let out = git_allow_fail(self.path(), &["rev-parse", "--git-dir"])?;
        let p = std::path::PathBuf::from(out.trim());
        Some(if p.is_absolute() { p } else { self.path().join(p) })
    }

    /// cherry-pick / revert 是否在进行中
    pub fn sequence_status(&self) -> Result<SequenceStatus> {
        let st = self.worktree_status()?;
        let dir = self.git_dir();
        let has = |name: &str| dir.as_ref().map(|d| d.join(name).exists()).unwrap_or(false);
        let kind = if has("CHERRY_PICK_HEAD") || has("sequencer") {
            "cherry-pick"
        } else if has("REVERT_HEAD") {
            "revert"
        } else {
            ""
        };
        let pending = dir
            .as_ref()
            .and_then(|d| std::fs::read_to_string(d.join("sequencer").join("todo")).ok())
            .map(|t| {
                t.lines()
                    .filter(|l| {
                        let l = l.trim();
                        !l.is_empty() && !l.starts_with('#')
                    })
                    .count()
            })
            .unwrap_or(0);
        Ok(SequenceStatus {
            kind: kind.to_string(),
            in_progress: !kind.is_empty(),
            conflicted: st.conflicted,
            pending,
        })
    }

    /// continue / skip / abort（kind: cherry-pick | revert）
    pub fn sequence_action(&self, kind: &str, action: &str) -> Result<String> {
        let kind = match kind {
            "cherry-pick" | "revert" => kind,
            _ => bail!("未知的序列操作：{kind}"),
        };
        let action = match action {
            "continue" | "skip" | "abort" => action,
            _ => bail!("未知动作：{action}"),
        };
        // --continue 会打开编辑器写提交信息，这里用 true 直接接受默认信息
        let out = git_env(
            self.path(),
            &[kind, &format!("--{action}")],
            &[("GIT_EDITOR", "true")],
        )?;
        Ok(out.trim().to_string())
    }

    /// 删除分支对应的远端分支（origin/xxx）
    pub fn delete_remote_branch(&self, name: &str) -> Result<String> {
        if !crate::actions::valid_ref(name) {
            bail!("非法的分支名");
        }
        let remotes = git_allow_fail(self.path(), &["remote"]).unwrap_or_default();
        let is_remote = |r: &str| remotes.lines().any(|l| l.trim() == r);

        // 支持两种入参：远端分支 origin/feat/x，或本地分支 feat/x（按它的上游推断）
        let mut remote = String::new();
        let mut branch = String::new();
        if let Some((r, b)) = name.split_once('/') {
            if !r.is_empty() && !b.is_empty() && is_remote(r) {
                remote = r.to_string();
                branch = b.to_string();
            }
        }

        if remote.is_empty() {
            let upstream = git_allow_fail(
                self.path(),
                &["rev-parse", "--abbrev-ref", &format!("{name}@{{upstream}}")],
            )
            .unwrap_or_default();
            match upstream.trim().split_once('/') {
                Some((r, b)) if !r.is_empty() && !b.is_empty() => {
                    remote = r.to_string();
                    branch = b.to_string();
                }
                _ => {}
            }
        }

        if remote.is_empty() {
            remote = "origin".to_string();
            branch = name.to_string();
        }

        let out = git(self.path(), &["push", &remote, "--delete", &branch])?;
        Ok(out.trim().to_string())
    }

    /// 彻底删除一个安全网快照
    pub fn delete_snapshot(&self, reference: &str) -> Result<()> {
        if !reference.starts_with(&format!("{SNAP_PREFIX}/")) {
            bail!("不是安全网快照：{reference}");
        }
        if !crate::actions::valid_ref(reference) {
            bail!("非法的快照引用");
        }
        git(self.path(), &["update-ref", "-d", reference])?;
        Ok(())
    }

    /// 清空所有安全网快照
    pub fn delete_all_snapshots(&self) -> Result<usize> {
        let all = self.list_snapshots()?;
        let mut n = 0;
        for s in all {
            if self.delete_snapshot(&s.r#ref).is_ok() {
                n += 1;
            }
        }
        Ok(n)
    }

    /// 自动清理早于 `days` 天的安全网快照（默认由前端设置决定是否启用）
    pub fn prune_snapshots(&self, days: u32) -> Result<usize> {
        if days == 0 {
            bail!("保留天数必须大于 0");
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let cutoff = now.saturating_sub(days as i64 * 86_400);
        let all = self.list_snapshots()?;
        let mut n = 0;
        for s in all {
            // 没有解析出创建时间的旧引用不动，避免误删
            if s.time > 0 && s.time < cutoff && self.delete_snapshot(&s.r#ref).is_ok() {
                n += 1;
            }
        }
        Ok(n)
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

    pub fn delete_branch(&self, name: &str, force: bool) -> Result<Option<String>> {        if !crate::actions::valid_ref(name) {
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

    /* ── 交互式 rebase ── */

    fn resolve_commit(&self, rev: &str) -> Result<String> {
        if !crate::actions::valid_ref(rev) && !rev.contains('~') && !rev.contains('^') {
            bail!("非法的基点");
        }
        Ok(git(self.path(), &["rev-parse", "--verify", &format!("{rev}^{{commit}}")])?
            .trim()
            .to_string())
    }

    pub fn rebase_preview(&self, base: &str) -> Result<Vec<RebaseCommit>> {
        let base_oid = self.resolve_commit(base)?;
        let out = git(
            self.path(),
            &["log", "--reverse", "--format=%H%x1f%s%x1f%an%x1f%ct", &format!("{base_oid}..HEAD")],
        )?;

        let commits: Vec<RebaseCommit> = out
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                let mut it = line.split('\u{1f}');
                let oid = it.next().unwrap_or("").to_string();
                let subject = it.next().unwrap_or("").to_string();
                let author = it.next().unwrap_or("").to_string();
                let time = it.next().unwrap_or("0").parse().unwrap_or(0);
                RebaseCommit {
                    short: oid.chars().take(7).collect(),
                    oid,
                    subject,
                    author,
                    time,
                }
            })
            .collect();

        if commits.is_empty() {
            bail!("该基点之后没有提交");
        }
        Ok(commits)
    }

    pub fn rebase_start(&self, base: &str, steps: &[RebaseStep]) -> Result<RebaseOutcome> {
        if steps.is_empty() {
            bail!("没有可整理的提交");
        }
        for st in steps {
            if !matches!(st.action.as_str(), "pick" | "reword" | "edit" | "squash" | "fixup" | "drop") {
                bail!("未知的 rebase 动作: {}", st.action);
            }
            if !st.oid.chars().all(|c| c.is_ascii_hexdigit()) || st.oid.len() < 7 {
                bail!("非法的提交");
            }
        }
        let first_kept = steps.iter().find(|s| s.action != "drop");
        match first_kept {
            Some(s) if matches!(s.action.as_str(), "pick" | "reword" | "edit") => {}
            _ => bail!("第一条保留的提交必须是 pick / reword / edit"),
        }

        let base_oid = self.resolve_commit(base)?;
        let snapshot = self.create_snapshot("before-rebase")?;

        let tmp = std::env::temp_dir().join(format!(
            "gitpanel-rebase-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&tmp)?;

        let todo_file = tmp.join("todo.txt");
        let todo: String = steps
            .iter()
            .map(|s| {
                let subject = s.subject.clone().unwrap_or_default().replace(['\r', '\n'], " ");
                format!("{} {} {}\n", s.action, s.oid, subject.trim())
            })
            .collect();
        fs::write(&todo_file, todo)?;

        let editor = if cfg!(windows) {
            let p = tmp.join("seq-editor.cmd");
            fs::write(
                &p,
                format!("@echo off\r\ncopy /y \"{}\" \"%~1\" >nul\r\n", todo_file.display()),
            )?;
            p
        } else {
            let p = tmp.join("seq-editor.sh");
            fs::write(&p, format!("#!/bin/sh\ncp \"{}\" \"$1\"\n", todo_file.display()))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o755));
            }
            p
        };

        let output = crate::proc::command("git")
            .arg("-C")
            .arg(self.path())
            .args(["rebase", "-i", &base_oid])
            // git 通过 sh 执行编辑器，Windows 反斜杠会被吞掉，统一用正斜杠
            .env(
                "GIT_SEQUENCE_EDITOR",
                editor.to_string_lossy().replace('\\', "/"),
            )
            .env("GIT_EDITOR", "true")
            .output();

        let _ = fs::remove_dir_all(&tmp);

        match output {
            Ok(out) if out.status.success() => Ok(RebaseOutcome {
                ok: true,
                conflicts: false,
                output: String::from_utf8_lossy(&out.stdout).trim().to_string(),
                snapshot,
            }),
            Ok(out) => Ok(RebaseOutcome {
                ok: false,
                conflicts: true,
                output: String::from_utf8_lossy(&out.stderr).trim().to_string(),
                snapshot,
            }),
            Err(e) => Err(e.into()),
        }
    }

    pub fn rebase_status(&self) -> Result<RebaseStatus> {
        for dir in ["rebase-merge", "rebase-apply"] {
            if let Some(rel) = git_allow_fail(self.path(), &["rev-parse", "--git-path", dir]) {
                let rel = rel.trim();
                let abs = {
                    let p = std::path::Path::new(rel);
                    if p.is_absolute() {
                        p.to_path_buf()
                    } else {
                        self.path().join(p)
                    }
                };
                if abs.exists() {
                    let st = self.worktree_status()?;
                    let stopped = abs.join("stopped-sha").exists();
                    let subject = fs::read_to_string(abs.join("msg"))
                        .ok()
                        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
                        .unwrap_or_default();
                    return Ok(RebaseStatus {
                        in_progress: true,
                        stopped,
                        subject,
                        conflicts: !st.conflicted.is_empty(),
                        conflicted: st.conflicted,
                    });
                }
            }
        }
        Ok(RebaseStatus {
            in_progress: false,
            stopped: false,
            subject: String::new(),
            conflicts: false,
            conflicted: Vec::new(),
        })
    }

    pub fn rebase_action(&self, action: &str) -> Result<RebaseOutcome> {
        if !matches!(action, "continue" | "abort" | "skip") {
            bail!("未知的 rebase 操作");
        }
        let out = crate::proc::command("git")
            .arg("-C")
            .arg(self.path())
            .args(["rebase", &format!("--{action}")])
            .env("GIT_EDITOR", "true")
            .output()?;

        let st = self.worktree_status()?;
        Ok(RebaseOutcome {
            ok: out.status.success(),
            conflicts: !st.conflicted.is_empty(),
            output: if out.status.success() {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                String::from_utf8_lossy(&out.stderr).trim().to_string()
            },
            snapshot: None,
        })
    }

    /* ── 工作树 ── */

    pub fn worktrees(&self) -> Result<Vec<WorktreeInfo>> {
        let out = git(self.path(), &["worktree", "list", "--porcelain"])?;
        let mut list = parse_worktree_list(&out);
        let current = norm_path(&self.path().to_string_lossy());

        // 判定「是否已合回主干」用主干分支（main / master），没有就用 HEAD
        let trunk = ["main", "master"]
            .iter()
            .find(|b| {
                git_allow_fail(self.path(), &["rev-parse", "--verify", &format!("refs/heads/{b}")])
                    .is_some()
            })
            .copied()
            .unwrap_or("HEAD");
        let merged_list = git_allow_fail(
            self.path(),
            &["branch", "--merged", trunk, "--format=%(refname:short)"],
        )
        .unwrap_or_default();

        for wt in list.iter_mut() {
            wt.is_current = wt.path.eq_ignore_ascii_case(&current);
            wt.exists = std::path::Path::new(&wt.path).exists();
            if !wt.exists || wt.bare {
                continue;
            }

            let wt_path = std::path::PathBuf::from(&wt.path);
            if let Some(st) = git_allow_fail(
                &wt_path,
                &[
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--branch",
                    "--untracked-files=normal",
                ],
            ) {
                let parsed = parse_status(&st);
                // 未跟踪文件也算「不干净」：不然移除时 git 会因未跟踪文件拒绝删除
                wt.dirty = (parsed.staged.len()
                    + parsed.unstaged.len()
                    + parsed.untracked.len()
                    + parsed.conflicted.len()) as u32;
                wt.ahead = parsed.ahead;
                wt.behind = parsed.behind;
            }
            if let Some(t) = git_allow_fail(&wt_path, &["log", "-1", "--format=%ct"]) {
                wt.last_commit = t.trim().parse().unwrap_or(0);
            }
            wt.ai_hints = AI_HINT_FILES
                .iter()
                .filter(|f| wt_path.join(f).exists())
                .map(|f| f.to_string())
                .collect();
            wt.merged = !wt.branch.is_empty()
                && merged_list.lines().any(|l| l.trim() == wt.branch);
        }

        Ok(list)
    }

    pub fn add_worktree(&self, target: &str, branch: &str, new_branch: bool, base: &str) -> Result<String> {
        if !crate::actions::valid_ref(branch) {
            bail!("非法的分支名");
        }
        let raw = std::path::Path::new(target);
        let abs = if raw.is_absolute() {
            raw.to_path_buf()
        } else {
            self.path().join(raw)
        };
        if abs.exists() {
            bail!("目标目录已存在");
        }

        let abs_s = abs.to_string_lossy().to_string();
        let mut args: Vec<&str> = vec!["worktree", "add"];
        if new_branch {
            args.push("-b");
            args.push(branch);
            args.push(&abs_s);
            args.push(if base.trim().is_empty() { "HEAD" } else { base.trim() });
        } else {
            // 远端分支（origin/foo）→ 在工作树里建同名本地分支并跟踪；本地分支直接检出
            let is_remote = git_allow_fail(
                self.path(),
                &["rev-parse", "--verify", &format!("refs/remotes/{branch}")],
            )
            .is_some();
            if is_remote {
                let local = branch.split_once('/').map(|(_, b)| b).unwrap_or(branch);
                if local.is_empty() {
                    bail!("非法的工作树分支：{branch}");
                }
                if git_allow_fail(
                    self.path(),
                    &["rev-parse", "--verify", &format!("refs/heads/{local}")],
                )
                .is_some()
                {
                    bail!("本地分支 {local} 已存在，改用「新建分支」或先删除它");
                }
                args.push("-b");
                args.push(local);
                args.push(&abs_s);
                args.push(branch);
            } else {
                args.push(&abs_s);
                args.push(branch);
            }
        }

        git(self.path(), &args)?;
        Ok(norm_path(&abs_s))
    }

    pub fn remove_worktree(&self, target: &str, force: bool) -> Result<()> {
        let target_path = std::path::PathBuf::from(target);
        // 真实路径比较：符号链接 / 大小写 / 正反斜杠都不能影响「是不是当前工作树」的判断
        let canon = |p: &std::path::Path| -> String {
            let real = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
            norm_path(&real.to_string_lossy())
        };
        if canon(&target_path).eq_ignore_ascii_case(&canon(self.path())) {
            bail!("不能移除当前正在使用的工作树");
        }

        // 目录已经不在了：只是登记残留，直接 prune
        if !target_path.exists() {
            git(self.path(), &["worktree", "prune"])?;
            return Ok(());
        }

        let mut args: Vec<&str> = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.push(target);
        match git(self.path(), &args) {
            Ok(_) => Ok(()),
            Err(e) => {
                // 被 lock 的工作树先解锁再删（例如手动 lock 过）
                if e.to_string().contains("locked") {
                    let _ = git(self.path(), &["worktree", "unlock", target]);
                    let mut retry: Vec<&str> = vec!["worktree", "remove"];
                    if force {
                        retry.push("--force");
                    }
                    retry.push(target);
                    git(self.path(), &retry)?;
                    return Ok(());
                }
                Err(e)
            }
        }
    }

    pub fn prune_worktrees(&self) -> Result<String> {
        Ok(git(self.path(), &["worktree", "prune", "-v"])?.trim().to_string())
    }

    /* ── 文件历史 / Blame / 仓库体检 ── */

    pub fn file_history(&self, file: &str, limit: usize) -> Result<Vec<FileHistoryEntry>> {
        let n = limit.clamp(1, 500).to_string();
        let out = git(
            self.path(),
            &[
                "log",
                "--follow",
                "--max-count",
                &n,
                "--format=%H%x1f%s%x1f%an%x1f%ct",
                "--",
                file,
            ],
        )?;

        Ok(out
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                let mut it = line.split('\u{1f}');
                let oid = it.next().unwrap_or("").to_string();
                FileHistoryEntry {
                    short: oid.chars().take(7).collect(),
                    oid,
                    subject: it.next().unwrap_or("").to_string(),
                    author: it.next().unwrap_or("").to_string(),
                    time: it.next().unwrap_or("0").parse().unwrap_or(0),
                }
            })
            .collect())
    }

    /// 内容级历史搜索：`git log -S<query>`，找出新增/删除过这段文本的提交
    pub fn search_history(&self, query: &str, limit: usize) -> Result<Vec<FileHistoryEntry>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let n = limit.clamp(1, 500).to_string();
        let needle = format!("-S{q}");
        let out = git(
            self.path(),
            &[
                "log",
                "--no-merges",
                "--max-count",
                &n,
                "--format=%H%x1f%s%x1f%an%x1f%ct",
                &needle,
            ],
        )?;

        Ok(out
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                let mut it = line.split('\u{1f}');
                let oid = it.next().unwrap_or("").to_string();
                FileHistoryEntry {
                    short: oid.chars().take(7).collect(),
                    oid,
                    subject: it.next().unwrap_or("").to_string(),
                    author: it.next().unwrap_or("").to_string(),
                    time: it.next().unwrap_or("0").parse().unwrap_or(0),
                }
            })
            .collect())
    }

    pub fn blame(&self, file: &str, max: usize) -> Result<Vec<BlameLine>> {
        let out = git(self.path(), &["blame", "--line-porcelain", "--", file])?;
        let limit = max.clamp(1, 5000);
        let mut lines: Vec<BlameLine> = Vec::new();
        let mut oid = String::new();
        let mut author = String::new();
        let mut time = 0i64;
        let mut line_no = 0u32;

        for raw in out.lines() {
            if let Some(content) = raw.strip_prefix('\t') {
                if lines.len() < limit {
                    lines.push(BlameLine {
                        line: line_no,
                        short: oid.chars().take(7).collect(),
                        oid: oid.clone(),
                        author: author.clone(),
                        time,
                        content: content.to_string(),
                    });
                }
                continue;
            }
            if let Some(rest) = raw.strip_prefix("author ") {
                author = rest.to_string();
            } else if let Some(rest) = raw.strip_prefix("author-time ") {
                time = rest.trim().parse().unwrap_or(0);
            } else if raw.len() > 40 && raw.as_bytes()[40] == b' ' {
                let head: Vec<&str> = raw.split(' ').collect();
                if head.len() >= 3
                    && head[0].len() == 40
                    && head[0].chars().all(|c| c.is_ascii_hexdigit())
                {
                    oid = head[0].to_string();
                    line_no = head[2].parse().unwrap_or(0);
                }
            }
        }

        Ok(lines)
    }

    pub fn repo_health(&self) -> Result<RepoHealth> {
        let mut git_size = 0u64;
        let mut pack_size = 0u64;
        let mut pack_count = 0u32;
        let mut large_objects: Vec<LargeObject> = Vec::new();

        if let Some(dir) = git_allow_fail(self.path(), &["rev-parse", "--absolute-git-dir"]) {
            let root = std::path::PathBuf::from(dir.trim());
            git_size = dir_size(&root);

            let pack_dir = root.join("objects").join("pack");
            let mut idxs: Vec<std::path::PathBuf> = Vec::new();
            if let Ok(entries) = fs::read_dir(&pack_dir) {
                for e in entries.flatten() {
                    let p = e.path();
                    match p.extension().and_then(|s| s.to_str()) {
                        Some("pack") => pack_size += e.metadata().map(|m| m.len()).unwrap_or(0),
                        Some("idx") => idxs.push(p),
                        _ => {}
                    }
                }
            }
            pack_count = idxs.len() as u32;

            // 只解析前 3 个包，避免超大仓库把界面卡住
            for idx in idxs.iter().take(3) {
                let arg = idx.to_string_lossy().to_string();
                if let Some(out) = git_allow_fail(self.path(), &["verify-pack", "-v", &arg]) {
                    for line in out.lines() {
                        let f: Vec<&str> = line.split_whitespace().collect();
                        if f.len() >= 5 && f[1] == "blob" {
                            if let Ok(sz) = f[2].parse::<u64>() {
                                large_objects.push(LargeObject {
                                    oid: f[0].to_string(),
                                    short: f[0].chars().take(7).collect(),
                                    size: sz,
                                });
                            }
                        }
                    }
                }
            }
        }
        large_objects.sort_by(|a, b| b.size.cmp(&a.size));
        large_objects.truncate(8);

        let mut loose = 0u32;
        let mut in_pack = 0u32;
        let mut garbage = 0u32;
        let mut size_pack_kb = 0u64;
        if let Some(out) = git_allow_fail(self.path(), &["count-objects", "-v"]) {
            for line in out.lines() {
                let mut it = line.split_whitespace();
                let key = it.next().unwrap_or("");
                let val = it.next().unwrap_or("0");
                match key {
                    "count:" => loose = val.parse().unwrap_or(0),
                    "in-pack:" => in_pack = val.parse().unwrap_or(0),
                    "garbage:" => garbage = val.parse().unwrap_or(0),
                    "size-pack:" => size_pack_kb = val.parse().unwrap_or(0),
                    _ => {}
                }
            }
        }
        if pack_size == 0 {
            pack_size = size_pack_kb * 1024;
        }

        let commits = git_allow_fail(self.path(), &["rev-list", "--count", "--all"])
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let branches = git_allow_fail(self.path(), &["for-each-ref", "--format=%(refname)", "refs/heads"])
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0);
        let tags = git_allow_fail(self.path(), &["for-each-ref", "--format=%(refname)", "refs/tags"])
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0);
        let files = git_allow_fail(self.path(), &["ls-files"])
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0);

        let mut suggestions: Vec<String> = Vec::new();
        if garbage > 0 {
            suggestions.push(format!("有 {garbage} 个垃圾对象，建议执行 git gc"));
        }
        if loose > 5000 {
            suggestions.push(format!("松散对象 {loose} 个，git gc 可明显提速"));
        }
        if let Some(l) = large_objects.first() {
            if l.size > 20 * 1024 * 1024 {
                suggestions.push(format!(
                    "历史中存在超大对象 {}（{:.1} MB），可考虑 git filter-repo 清理",
                    l.short,
                    l.size as f64 / 1_048_576.0
                ));
            }
        }
        if pack_count > 10 {
            suggestions.push(format!("pack 文件 {pack_count} 个，gc 后可合并"));
        }

        Ok(RepoHealth {
            git_size,
            pack_size,
            pack_count,
            loose_objects: loose,
            in_pack,
            garbage,
            commits,
            branches,
            tags,
            files,
            large_objects,
            suggestions,
        })
    }
}

/* ────────────────────────── 工作树 ────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub head: String,
    pub short: String,
    pub branch: String,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
    pub is_current: bool,
    pub exists: bool,
    pub dirty: u32,
    pub ahead: u32,
    pub behind: u32,
    pub last_commit: i64,
    pub ai_hints: Vec<String>,
    /// 该分支是否已合回主干（main / master）
    pub merged: bool,
}

const AI_HINT_FILES: [&str; 4] = ["AGENTS.md", "CLAUDE.md", ".cursor", ".github/copilot-instructions.md"];

fn norm_path(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_string()
}

fn parse_worktree_list(out: &str) -> Vec<WorktreeInfo> {
    let mut list: Vec<WorktreeInfo> = Vec::new();
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            list.push(WorktreeInfo {
                path: norm_path(rest),
                head: String::new(),
                short: String::new(),
                branch: String::new(),
                bare: false,
                detached: false,
                locked: false,
                prunable: false,
                is_current: false,
                exists: false,
                dirty: 0,
                ahead: 0,
                behind: 0,
                last_commit: 0,
                ai_hints: Vec::new(),
                merged: false,
            });
        } else if let Some(cur) = list.last_mut() {
            if let Some(rest) = line.strip_prefix("HEAD ") {
                cur.head = rest.to_string();
                cur.short = rest.chars().take(7).collect();
            } else if let Some(rest) = line.strip_prefix("branch ") {
                cur.branch = rest.trim_start_matches("refs/heads/").to_string();
            } else if line == "bare" {
                cur.bare = true;
            } else if line == "detached" {
                cur.detached = true;
            } else if line.starts_with("locked") {
                cur.locked = true;
            } else if line.starts_with("prunable") {
                cur.prunable = true;
            }
        }
    }
    list
}

/* ────────────────────────── 文件历史 / Blame / 体检 ────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub oid: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: u32,
    pub oid: String,
    pub short: String,
    pub author: String,
    pub time: i64,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeObject {
    pub oid: String,
    pub short: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoHealth {
    pub git_size: u64,
    pub pack_size: u64,
    pub pack_count: u32,
    pub loose_objects: u32,
    pub in_pack: u32,
    pub garbage: u32,
    pub commits: u32,
    pub branches: u32,
    pub tags: u32,
    pub files: u32,
    pub large_objects: Vec<LargeObject>,
    pub suggestions: Vec<String>,
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            total += dir_size(&entry.path());
        } else {
            total += meta.len();
        }
    }
    total
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
    fn rebase_squash_two_commits() {
        let dir = std::env::temp_dir().join(format!("gitpanel-rebase-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let run = |args: &[&str]| {
            let out = crate::proc::command("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .output()
                .expect("git 启动失败");
            assert!(
                out.status.success(),
                "git {:?} 失败: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
            out
        };

        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.name", "tester"]);
        run(&["config", "user.email", "tester@example.com"]);
        for i in 1..=3 {
            std::fs::write(dir.join(format!("f{i}.txt")), format!("content {i}")).unwrap();
            run(&["add", "-A"]);
            run(&["commit", "-q", "-m", &format!("commit {i}")]);
        }

        let repo = Repo::open(&dir).unwrap();
        let commits = repo.rebase_preview("HEAD~2").unwrap();
        assert_eq!(commits.len(), 2, "HEAD~2 之后应有 2 个提交");

        let steps = vec![
            RebaseStep {
                oid: commits[0].oid.clone(),
                action: "pick".into(),
                subject: None,
            },
            RebaseStep {
                oid: commits[1].oid.clone(),
                action: "squash".into(),
                subject: None,
            },
        ];
        let outcome = repo.rebase_start("HEAD~2", &steps).unwrap();
        assert!(outcome.ok, "rebase 失败: {}", outcome.output);

        let log = String::from_utf8_lossy(&run(&["log", "--oneline"]).stdout).to_string();
        assert_eq!(
            log.lines().count(),
            2,
            "两个提交应被合并成一个，实际:\n{log}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_clean_status() {        let st = parse_status("# branch.head main\0");
        assert!(st.clean);
        assert!(st.staged.is_empty());
    }
}
