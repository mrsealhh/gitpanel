// 大文件 diff 的行窗口（与 Rust 侧 crates/git-core/src/text.rs 同一份契约）

/** 按行窗口切文本，返回 { text, total, more } */
export function windowText(full, from = 0, maxLines = 0, maxBytes = 400_000) {
  const lines = String(full ?? '').split('\n')
  // split 会为末尾换行多产生一个空串，按「行」语义去掉
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const total = lines.length
  const start = Math.max(0, from)
  const out = []
  let bytes = 0
  for (let i = start; i < total; i++) {
    if (maxLines > 0 && out.length >= maxLines) break
    const cost = lines[i].length + (out.length ? 1 : 0)
    // 行数不限时才用字节上限兜底，避免两边行数不一致导致错位
    if (maxLines === 0 && maxBytes > 0 && out.length && bytes + cost > maxBytes) break
    out.push(lines[i])
    bytes += cost
  }
  return { text: out.join('\n'), total, more: start + out.length < total }
}

/** 统一的两个版本 → FileDiff（行窗口 + 二进制判断） */
export function buildFileDiff(file, oldBuf, newBuf, win = {}) {
  const from = win.fromLine ?? 0
  const maxLines = win.maxLines ?? 0
  const maxBytes = win.maxBytes ?? 400_000

  const isBinary = looksBinary(oldBuf) || looksBinary(newBuf)
  if (isBinary) {
    return {
      path: file,
      oldText: '',
      newText: '',
      isBinary: true,
      truncated: false,
      oldTotalLines: 0,
      newTotalLines: 0,
      oldFrom: from,
      newFrom: from,
      hasMore: false,
      oldBytes: oldBuf?.length ?? 0,
      newBytes: newBuf?.length ?? 0,
    }
  }

  const a = windowText(oldBuf?.toString('utf8') ?? '', from, maxLines, maxBytes)
  const b = windowText(newBuf?.toString('utf8') ?? '', from, maxLines, maxBytes)
  return {
    path: file,
    oldText: a.text,
    newText: b.text,
    isBinary: false,
    truncated: a.more || b.more,
    oldTotalLines: a.total,
    newTotalLines: b.total,
    oldFrom: from,
    newFrom: from,
    hasMore: a.more || b.more,
    oldBytes: oldBuf?.length ?? 0,
    newBytes: newBuf?.length ?? 0,
  }
}

export function looksBinary(buf) {
  if (!buf || !buf.length) return false
  return buf.subarray(0, 8000).includes(0)
}
