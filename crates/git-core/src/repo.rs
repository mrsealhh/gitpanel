use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use git2::{Delta, DiffOptions, Repository, Sort};

use crate::graph;
use crate::model::*;

pub struct Repo {
    inner: Repository,
    workdir: PathBuf,
}

fn status_char(d: Delta) -> &'static str {
    match d {
        Delta::Added => "A",
        Delta::Deleted => "D",
        Delta::Modified => "M",
        Delta::Renamed => "R",
        Delta::Copied => "C",
        Delta::Typechange => "T",
        _ => "M",
    }
}

impl Repo {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let inner = Repository::discover(path.as_ref()).context("不是有效的 Git 仓库")?;
        let workdir = inner
            .workdir()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| inner.path().to_path_buf());
        Ok(Self { inner, workdir })
    }

    pub fn path(&self) -> &Path {
        &self.workdir
    }

    pub fn head_branch(&self) -> String {
        self.inner
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| "HEAD".to_string())
    }

    pub fn refs(&self) -> Result<Vec<RepoRef>> {
        let mut out = Vec::new();
        for r in self.inner.references()? {
            let r = r?;
            let Some(full) = r.name() else { continue };
            let (kind, name) = if let Some(s) = full.strip_prefix("refs/heads/") {
                ("branch", s)
            } else if let Some(s) = full.strip_prefix("refs/remotes/") {
                ("remote", s)
            } else if let Some(s) = full.strip_prefix("refs/tags/") {
                ("tag", s)
            } else {
                continue;
            };
            let Ok(commit) = r.peel_to_commit() else {
                continue;
            };
            out.push(RepoRef {
                name: name.to_string(),
                kind: kind.to_string(),
                oid: commit.id().to_string(),
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    pub fn info(&self) -> Result<RepoInfo> {
        let refs = self.refs()?;
        let branch = self.head_branch();
        let head_oid = self
            .inner
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.id().to_string())
            .unwrap_or_default();
        let name = self
            .workdir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| self.workdir.display().to_string());
        Ok(RepoInfo {
            path: self.workdir.display().to_string(),
            name,
            branch,
            head_oid,
            refs,
        })
    }

    fn badge_map(&self, refs: &[RepoRef]) -> HashMap<String, Vec<RefBadge>> {
        let head = self.head_branch();
        let mut map: HashMap<String, Vec<RefBadge>> = HashMap::new();
        for r in refs {
            let entry = map.entry(r.oid.clone()).or_default();
            if r.kind == "branch" && r.name == head {
                entry.insert(
                    0,
                    RefBadge {
                        name: r.name.clone(),
                        kind: "head".into(),
                    },
                );
            } else {
                entry.push(RefBadge {
                    name: r.name.clone(),
                    kind: r.kind.clone(),
                });
            }
        }
        map
    }

    /// 分页取提交图。
    /// 说明：v0 每次从起点重走到 offset+limit，布局缓存（见架构文档 §5）是后续优化项。
    pub fn graph_page(&self, offset: u32, limit: u32, tip: &str) -> Result<GraphPage> {
        let refs = self.refs()?;
        let badges = self.badge_map(&refs);

        let mut walk = self.inner.revwalk()?;
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

        if tip.trim().is_empty() {
            for r in &refs {
                if let Ok(oid) = git2::Oid::from_str(&r.oid) {
                    let _ = walk.push(oid);
                }
            }
        } else {
            let obj = self.inner.revparse_single(tip).context("无效的修订版本")?;
            walk.push(obj.peel_to_commit()?.id())?;
        }

        let take = (offset.saturating_add(limit)).min(20_000) as usize;
        let mut raw: Vec<RawCommit> = Vec::with_capacity(take.min(4096));
        for oid in walk {
            let oid = oid?;
            let c = self.inner.find_commit(oid)?;
            raw.push(RawCommit {
                oid: oid.to_string(),
                parents: c.parent_ids().map(|p| p.to_string()).collect(),
                author: c.author().name().unwrap_or("").to_string(),
                email: c.author().email().unwrap_or("").to_string(),
                time: c.time().seconds(),
                summary: c.summary().unwrap_or("").to_string(),
            });
            if raw.len() >= take {
                break;
            }
        }

        let (rows, lane_count) = graph::layout(&raw, &badges);
        let total = rows.len() as u32;
        let start = (offset as usize).min(rows.len());
        let end = (start + limit as usize).min(rows.len());

        Ok(GraphPage {
            rows: rows[start..end].to_vec(),
            next_offset: end as u32,
            done: end >= rows.len(),
            lane_count,
            total,
        })
    }

    pub fn commit_detail(&self, rev: &str) -> Result<CommitDetail> {
        let obj = self.inner.revparse_single(rev)?;
        let commit = obj.peel_to_commit()?;
        let tree = commit.tree()?;
        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };

        let mut opts = DiffOptions::new();
        opts.context_lines(0);
        let diff =
            self.inner
                .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;

        let mut files = Vec::with_capacity(diff.deltas().len());
        let mut additions = 0u32;
        let mut deletions = 0u32;
        for (idx, delta) in diff.deltas().enumerate() {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let (add, del) = match git2::Patch::from_diff(&diff, idx)? {
                Some(p) => {
                    let (_, a, d) = p.line_stats()?;
                    (a as u32, d as u32)
                }
                None => (0, 0),
            };
            additions += add;
            deletions += del;
            files.push(ChangedFile {
                path,
                additions: add,
                deletions: del,
                status: status_char(delta.status()).to_string(),
            });
        }

        let badges = self.badge_map(&self.refs()?);
        let refs = badges
            .get(&commit.id().to_string())
            .cloned()
            .unwrap_or_default();

        let author_sig = commit.author();
        let author = author_sig.name().unwrap_or("").to_string();
        let email = author_sig.email().unwrap_or("").to_string();

        Ok(CommitDetail {
            oid: commit.id().to_string(),
            short: commit.id().to_string().chars().take(7).collect(),
            author,
            email,
            time: commit.time().seconds(),
            parents: commit.parent_ids().map(|p| p.to_string()).collect(),
            refs,
            summary: commit.summary().unwrap_or("").to_string(),
            body: commit.body().unwrap_or("").to_string(),
            files,
            additions,
            deletions,
        })
    }

    /// 取某个文件在「父提交 vs 当前提交」两个版本的全文，供前端做并排合并视图。
    /// 与 devserver 的 fileDiff 保持同一份契约。
    pub fn file_diff(&self, rev: &str, path: &str) -> Result<FileDiff> {
        self.file_diff_window(rev, path, crate::text::DiffWindow::default())
    }

    /// 带行窗口的版本：大文件只取一段，前端按 `fromLine` 往后翻。
    pub fn file_diff_window(
        &self,
        rev: &str,
        path: &str,
        win: crate::text::DiffWindow,
    ) -> Result<FileDiff> {
        let commit = self.inner.revparse_single(rev)?.peel_to_commit()?;
        let new_blob = self.blob_at(&commit.tree()?, path)?;
        let old_blob = if commit.parent_count() > 0 {
            self.blob_at(&commit.parent(0)?.tree()?, path)?
        } else {
            None
        };

        Ok(crate::text::build_file_diff(
            path,
            old_blob.as_deref(),
            new_blob.as_deref(),
            &win,
        ))
    }

    fn blob_at(&self, tree: &git2::Tree, path: &str) -> Result<Option<Vec<u8>>> {
        match tree.get_path(Path::new(path)) {
            Ok(entry) => {
                if entry.kind() != Some(git2::ObjectType::Blob) {
                    return Ok(None);
                }
                Ok(Some(self.inner.find_blob(entry.id())?.content().to_vec()))
            }
            Err(_) => Ok(None),
        }
    }

    /// 取某个提交里某个文件的原始字节（跨提交对比用）
    pub fn blob_bytes_at(&self, rev: &str, path: &str) -> Result<Option<Vec<u8>>> {
        let commit = self.inner.revparse_single(rev)?.peel_to_commit()?;
        self.blob_at(&commit.tree()?, path)
    }
}
