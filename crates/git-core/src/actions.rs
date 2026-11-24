use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::model::{CommandResult, PluginCommand, RemoteInfo};
use crate::repo::Repo;

/// 分支/引用名白名单。全部写操作走 git CLI，参数在进入进程前先过这一层，
/// 避免 `-x` 这类参数注入。
pub fn valid_ref(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && !s.contains("..")
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let out = crate::proc::command("git")
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutcome {
    pub ok: bool,
    pub branch: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RawCommand {
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    shell: bool,
}

fn read_commands_file(file: &Path, source: &str) -> Vec<(PluginCommand, RawCommand)> {
    let Ok(text) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    let Ok(list) = serde_json::from_str::<Vec<RawCommand>>(&text) else {
        return Vec::new();
    };
    list.into_iter()
        .filter(|c| !c.id.is_empty() && !c.command.is_empty())
        .map(|c| {
            let meta = PluginCommand {
                id: c.id.clone(),
                title: c.title.clone().unwrap_or_else(|| c.id.clone()),
                description: c.description.clone().unwrap_or_default(),
                source: source.to_string(),
            };
            (meta, c)
        })
        .collect()
}

fn user_commands_file() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".gitpanel").join("commands.json"))
}

impl Repo {
    fn all_commands(&self) -> Vec<(PluginCommand, RawCommand)> {
        let mut list = read_commands_file(&self.path().join(".gitpanel").join("commands.json"), "repo");
        if let Some(user) = user_commands_file() {
            list.extend(read_commands_file(&user, "user"));
        }
        // 同 id 以仓库级为准
        let mut seen = std::collections::HashSet::new();
        list.retain(|(meta, _)| seen.insert(meta.id.clone()));
        list
    }

    pub fn commands(&self) -> Vec<PluginCommand> {
        self.all_commands().into_iter().map(|(meta, _)| meta).collect()
    }

    pub fn run_command(&self, id: &str) -> Result<CommandResult> {
        let Some((_, cmd)) = self.all_commands().into_iter().find(|(m, _)| m.id == id) else {
            bail!("未知命令: {id}");
        };

        let started = Instant::now();
        let mut builder = if cmd.shell {
            let line = std::iter::once(cmd.command.clone())
                .chain(cmd.args.clone())
                .collect::<Vec<_>>()
                .join(" ");
            if cfg!(windows) {
                let mut c = crate::proc::command("cmd");
                c.arg("/C").arg(line);
                c
            } else {
                let mut c = crate::proc::command("sh");
                c.arg("-c").arg(line);
                c
            }
        } else {
            let mut c = crate::proc::command(&cmd.command);
            c.args(&cmd.args);
            c
        };
        builder.current_dir(self.path());

        let output = builder.output().context("命令启动失败")?;
        Ok(CommandResult {
            code: output.status.code().unwrap_or(1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }

    pub fn remotes(&self) -> Result<Vec<RemoteInfo>> {
        let mut out = Vec::new();
        let text = match git(self.path(), &["config", "--get-regexp", "^remote\\..*\\.url$"]) {
            Ok(t) => t,
            Err(_) => return Ok(out),
        };
        for line in text.lines() {
            let Some((key, url)) = line.split_once(' ') else { continue };
            let name = key
                .strip_prefix("remote.")
                .and_then(|k| k.strip_suffix(".url"))
                .unwrap_or(key)
                .to_string();
            out.push(RemoteInfo {
                name,
                url: url.trim().to_string(),
                web: to_web_url(url.trim()),
            });
        }
        Ok(out)
    }

    pub fn checkout(&self, refname: &str) -> Result<ActionOutcome> {
        if !valid_ref(refname) {
            bail!("非法的引用名");
        }
        git(self.path(), &["checkout", refname])?;
        self.head_outcome()
    }

    pub fn create_branch(&self, name: &str, from: Option<&str>) -> Result<ActionOutcome> {
        if !valid_ref(name) {
            bail!("非法的分支名");
        }
        if let Some(f) = from {
            if !valid_ref(f) {
                bail!("非法的起点");
            }
        }
        let mut args = vec!["checkout", "-b", name];
        if let Some(f) = from {
            args.push(f);
        }
        git(self.path(), &args)?;
        self.head_outcome()
    }

    fn head_outcome(&self) -> Result<ActionOutcome> {
        let branch = git(self.path(), &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();
        Ok(ActionOutcome { ok: true, branch })
    }
}

pub fn to_web_url(url: &str) -> String {
    let mut u = url.trim().to_string();
    if let Some(rest) = u.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            u = format!("https://{host}/{path}");
        }
    } else if let Some(rest) = u.strip_prefix("ssh://git@") {
        u = format!("https://{rest}");
    }
    if let Some(stripped) = u.strip_suffix(".git") {
        u = stripped.to_string();
    }
    if u.starts_with("http://") || u.starts_with("https://") {
        u
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_injection_like_refs() {
        assert!(valid_ref("feature/login"));
        assert!(valid_ref("v1.2.3"));
        assert!(!valid_ref("-D"));
        assert!(!valid_ref("main..evil"));
        assert!(!valid_ref("a b"));
        assert!(!valid_ref(""));
    }

    #[test]
    fn converts_remote_urls() {
        assert_eq!(
            to_web_url("git@github.com:owner/repo.git"),
            "https://github.com/owner/repo"
        );
        assert_eq!(
            to_web_url("https://github.com/owner/repo.git"),
            "https://github.com/owner/repo"
        );
        assert_eq!(to_web_url("D:/local/repo"), "");
    }
}
