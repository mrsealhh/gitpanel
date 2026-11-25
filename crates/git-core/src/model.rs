use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefBadge {
    pub name: String,
    /// head | branch | remote | tag
    pub kind: String,
}

/// 行内线段：x 为泳道下标，y 为行内相对位置（0=顶, 0.5=节点, 1=底）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub curve: bool,
    pub color: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub oid: String,
    pub short: String,
    pub parents: Vec<String>,
    pub lane: usize,
    pub color: u8,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub refs: Vec<RefBadge>,
    pub summary: String,
    pub segments: Vec<Segment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    pub rows: Vec<CommitRow>,
    pub next_offset: u32,
    pub done: bool,
    pub lane_count: usize,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub name: String,
    pub kind: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub head_oid: String,
    pub refs: Vec<RepoRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub oid: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub parents: Vec<String>,
    pub refs: Vec<RefBadge>,
    pub summary: String,
    pub body: String,
    pub files: Vec<ChangedFile>,
    pub additions: u32,
    pub deletions: u32,
}

/// 两个提交 / 分支之间对比时的一个变更文件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFile {
    pub path: String,
    /// M / A / D / R / C
    pub status: String,
}

/// 单个文件的「父版本 / 当前版本」全文，用于并排合并视图
///
/// 大文件不再一次性被截断丢弃内容，而是按「行窗口」分块返回：
/// `oldFrom` / `newFrom` 是本次返回的起始行（0 基），
/// `oldTotalLines` / `newTotalLines` 是文件总行数，`hasMore` 表示还能继续加载。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_text: String,
    pub new_text: String,
    pub is_binary: bool,
    pub truncated: bool,
    #[serde(default)]
    pub old_total_lines: usize,
    #[serde(default)]
    pub new_total_lines: usize,
    #[serde(default)]
    pub old_from: usize,
    #[serde(default)]
    pub new_from: usize,
    #[serde(default)]
    pub has_more: bool,
    /// 两边的原始字节数，用于前端提示「文件多大」
    #[serde(default)]
    pub old_bytes: usize,
    #[serde(default)]
    pub new_bytes: usize,
}

/// 插件/自定义命令（来自 .gitpanel/commands.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommand {
    pub id: String,
    pub title: String,
    pub description: String,
    /// repo = 仓库级配置，user = 用户级配置
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    /// 可点击的网页地址
    pub web: String,
}

/// 布局输入：只保留算法需要的字段
#[derive(Debug, Clone)]
pub struct RawCommit {
    pub oid: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
}
