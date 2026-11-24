//! 大文件文本分块：把超长文件按「行窗口」切出来返回给前端。
//!
//! 目标是不再因为字节上限把文件「截断丢内容」，而是按性能优先只发前 N 行，
//! 前端需要时再往后取（`fromLine` 递增），直到 `hasMore == false`。

use crate::model::FileDiff;

/// 单次 diff 取多大的窗口
#[derive(Debug, Clone, Copy)]
pub struct DiffWindow {
    /// 从第几行开始（0 基）
    pub from_line: usize,
    /// 最多取多少行；0 表示不限制
    pub max_lines: usize,
    /// 最多取多少字节；0 表示不限制
    pub max_bytes: usize,
}

impl Default for DiffWindow {
    fn default() -> Self {
        Self { from_line: 0, max_lines: 0, max_bytes: 400_000 }
    }
}

impl DiffWindow {
    pub fn new(from_line: Option<u32>, max_lines: Option<u32>, max_bytes: Option<u32>) -> Self {
        Self {
            from_line: from_line.unwrap_or(0) as usize,
            max_lines: max_lines.unwrap_or(0) as usize,
            max_bytes: max_bytes.map(|b| b as usize).unwrap_or(400_000),
        }
    }

    /// 按设置来的阈值：行数与字节数都限
    pub fn clamped(max_lines: u32, max_kb: u32) -> Self {
        Self {
            from_line: 0,
            max_lines: max_lines.max(1) as usize,
            max_bytes: (max_kb.max(1) as usize) * 1024,
        }
    }
}

pub fn looks_binary(buf: &[u8]) -> bool {
    buf.iter().take(8000).any(|b| *b == 0)
}

/// 按行窗口切一段文本。
/// 返回 (片段, 总行数, 是否还有更多)。
pub fn window_text(full: &str, from: usize, max_lines: usize, max_bytes: usize) -> (String, usize, bool) {
    let mut total = 0usize;
    let mut taken = 0usize;
    let mut bytes = 0usize;
    let mut buf = String::new();

    for (i, line) in full.lines().enumerate() {
        total = i + 1;
        if i < from {
            continue;
        }
        if max_lines > 0 && taken >= max_lines {
            continue;
        }
        let cost = line.len() + if taken > 0 { 1 } else { 0 };
        // 行数为 0（不限行）时才用字节上限兜底，避免两边按不同行数切分而错位
        if max_lines == 0 && max_bytes > 0 && bytes + cost > max_bytes && taken > 0 {
            continue;
        }
        if taken > 0 {
            buf.push('\n');
            bytes += 1;
        }
        buf.push_str(line);
        bytes += line.len();
        taken += 1;
    }

    (buf, total, from + taken < total)
}

fn text_of(buf: Option<&[u8]>) -> String {
    match buf {
        Some(b) => String::from_utf8_lossy(b).to_string(),
        None => String::new(),
    }
}

/// 用两个版本的原始字节造一个 FileDiff（自动判断二进制 + 行窗口）
pub fn build_file_diff(path: &str, old: Option<&[u8]>, new: Option<&[u8]>, win: &DiffWindow) -> FileDiff {
    let is_binary = old.map(looks_binary).unwrap_or(false) || new.map(looks_binary).unwrap_or(false);
    let old_bytes = old.map(|b| b.len()).unwrap_or(0);
    let new_bytes = new.map(|b| b.len()).unwrap_or(0);

    if is_binary {
        return FileDiff {
            path: path.to_string(),
            old_text: String::new(),
            new_text: String::new(),
            is_binary: true,
            truncated: false,
            old_total_lines: 0,
            new_total_lines: 0,
            old_from: win.from_line,
            new_from: win.from_line,
            has_more: false,
            old_bytes,
            new_bytes,
        };
    }

    let (old_text, old_total, old_more) =
        window_text(&text_of(old), win.from_line, win.max_lines, win.max_bytes);
    let (new_text, new_total, new_more) =
        window_text(&text_of(new), win.from_line, win.max_lines, win.max_bytes);

    FileDiff {
        path: path.to_string(),
        old_text,
        new_text,
        is_binary: false,
        // 「截断」现在指还有没取完的行；前端据此显示「继续加载」
        truncated: old_more || new_more,
        old_total_lines: old_total,
        new_total_lines: new_total,
        old_from: win.from_line,
        new_from: win.from_line,
        has_more: old_more || new_more,
        old_bytes,
        new_bytes,
    }
}
