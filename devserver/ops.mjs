// 工作区与写操作：状态解析、暂存/提交、推拉、安全网快照。
// 设计约定：读路径用 git 结构化解剖，写路径走 git CLI；破坏性操作前自动打快照。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { buildFileDiff } from './textwin.mjs'

const run = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024
const SNAP_PREFIX = 'refs/gitpanel/snapshots'

export function makeGit(repo) {
  return async (args, opts = {}) => {
    const { stdout } = await run('git', ['-C', repo, '-c', 'core.quotepath=false', ...args], {
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
      ...opts,
    })
    return stdout
  }
}

async function gitRaw(repo, args) {
  const { stdout } = await run('git', ['-C', repo, ...args], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    encoding: 'buffer',
  })
  return stdout
}

/* ────────────────────────── 状态 ────────────────────────── */

/**
 * 解析 `git status --porcelain=v2 -z`
 * 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 * 2 <XY> ... <X><score> <path>\0<origPath>
 * u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 * ? <path>
 */
export function parseStatus(raw) {
  const parts = raw.split('\0')
  const out = {
    branch: '',
    oid: '',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  }

  const split = (xy, p, orig) => {
    const x = xy[0]
    const y = xy[1]
    if (x !== '.' && x !== '?') out.staged.push({ path: p, status: x, origPath: orig || '' })
    if (y !== '.' && y !== '?') out.unstaged.push({ path: p, status: y, origPath: orig || '' })
  }

  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec) continue

    if (rec.startsWith('# branch.head ')) {
      out.branch = rec.slice(14)
    } else if (rec.startsWith('# branch.oid ')) {
      out.oid = rec.slice(13)
    } else if (rec.startsWith('# branch.ab ')) {
      const m = rec.match(/\+(\d+)\s+-(\d+)/)
      if (m) {
        out.ahead = Number(m[1])
        out.behind = Number(m[2])
      }
    } else if (rec[0] === '1') {
      const f = rec.split(' ')
      split(f[1], f.slice(8).join(' '))
    } else if (rec[0] === '2') {
      const f = rec.split(' ')
      const orig = parts[i + 1] || ''
      split(f[1], f.slice(9).join(' '), orig)
      i++
    } else if (rec[0] === 'u') {
      const f = rec.split(' ')
      out.conflicted.push({ path: f.slice(10).join(' '), status: f[1] })
    } else if (rec[0] === '?') {
      out.untracked.push({ path: rec.slice(2) })
    }
  }

  out.clean =
    out.staged.length === 0 &&
    out.unstaged.length === 0 &&
    out.untracked.length === 0 &&
    out.conflicted.length === 0
  return out
}

export async function worktreeStatus(repo) {
  const buf = await gitRaw(repo, [
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    '--untracked-files=normal',
  ])
  return parseStatus(buf.toString('utf8'))
}

/* ────────────────────────── 工作区 Diff ────────────────────────── */

async function blob(repo, spec) {
  try {
    return await gitRaw(repo, ['show', spec])
  } catch {
    return Buffer.alloc(0)
  }
}

/** staged=true: HEAD vs index；staged=false: index vs 工作区文件 */
export async function worktreeDiff(repo, file, staged, win = {}) {
  let oldBuf
  let newBuf

  if (staged) {
    oldBuf = await blob(repo, `HEAD:${file}`)
    newBuf = await blob(repo, `:0:${file}`)
  } else {
    oldBuf = await blob(repo, `:0:${file}`)
    const abs = path.join(repo, file)
    try {
      newBuf = fs.readFileSync(abs)
    } catch {
      newBuf = Buffer.alloc(0)
    }
  }

  return buildFileDiff(file, oldBuf, newBuf, win)
}

/* ────────────────────────── 安全网快照 ────────────────────────── */

export async function createSnapshot(repo, label) {
  const git = makeGit(repo)
  let head = ''
  try {
    head = (await git(['rev-parse', 'HEAD'])).trim()
  } catch {
    return null
  }
  const safeLabel = String(label || 'op').replace(/[^a-zA-Z0-9_-]/g, '')
  const ref = `${SNAP_PREFIX}/${Date.now()}-${safeLabel}`
  await git(['update-ref', ref, head])
  return ref
}

export async function listSnapshots(repo) {
  const git = makeGit(repo)
  let out = ''
  try {
    out = await git([
      'for-each-ref',
      '--format=%(refname)%1f%(objectname)%1f%(committerdate:unix)%1f%(subject)',
      SNAP_PREFIX,
    ])
  } catch {
    return { snapshots: [] }
  }

  const snapshots = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [refname, oid, at, subject] = line.split('\x1f')
      const name = refname.slice(SNAP_PREFIX.length + 1)
      // 快照名格式：<创建时间戳ms>-<label>
      const dash = name.indexOf('-')
      const createdMs = Number(name.slice(0, dash)) || 0
      const label = (dash >= 0 ? name.slice(dash + 1) : name) || name
      return {
        ref: refname,
        label,
        oid,
        short: oid.slice(0, 7),
        // 排序/展示都用创建时间，而不是被指向提交的时间
        time: createdMs ? Math.floor(createdMs / 1000) : Number(at) || 0,
        subject: subject || '',
      }
    })
    .sort((a, b) => b.time - a.time)

  return { snapshots }
}

/** 恢复前先给当前 HEAD 再打一个快照，避免二次误操作丢失 */
export async function deleteSnapshot(repo, ref) {
  if (!ref || !ref.startsWith(SNAP_PREFIX + '/')) throw new Error('不是安全网快照')
  const git = makeGit(repo)
  await git(['update-ref', '-d', ref])
  return { ok: true }
}

export async function deleteAllSnapshots(repo) {
  const { snapshots } = await listSnapshots(repo)
  const git = makeGit(repo)
  let count = 0
  for (const s of snapshots) {
    try {
      await git(['update-ref', '-d', s.ref])
      count += 1
    } catch {
      /* 单个失败继续 */
    }
  }
  return { ok: true, count }
}

/* ── 分支上游状态 ── */

export async function branchStatus(repo) {
  const git = makeGit(repo)
  let out = ''
  try {
    out = await git([
      'for-each-ref',
      '--format=%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(HEAD)',
      'refs/heads',
    ])
  } catch {
    return { branches: [] }
  }
  const branches = out
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [name, upstream, track, at, head] = line.split('\x1f')
      let ahead = 0
      let behind = 0
      const m = /^\[(.*)\]$/.exec((track || '').trim())
      if (m) {
        for (const piece of m[1].split(',')) {
          const p = piece.trim()
          if (p.startsWith('ahead ')) ahead = Number(p.slice(6)) || 0
          if (p.startsWith('behind ')) behind = Number(p.slice(7)) || 0
        }
      }
      return {
        name,
        upstream: upstream || '',
        ahead,
        behind,
        current: (head || '').trim() === '*',
        lastCommit: Number(at) || 0,
      }
    })
  branches.sort((a, b) => a.name.localeCompare(b.name))
  return { branches }
}

export async function deleteRemoteBranch(repo, name) {
  if (!name || name.startsWith('-')) throw new Error('非法的分支名')
  const git = makeGit(repo)
  let upstream = ''
  try {
    upstream = (await git(['rev-parse', '--abbrev-ref', `${name}@{upstream}`])).trim()
  } catch {
    upstream = ''
  }
  const slash = upstream.indexOf('/')
  const remote = slash > 0 ? upstream.slice(0, slash) : 'origin'
  const branch = slash > 0 ? upstream.slice(slash + 1) : name
  const out = await git(['push', remote, '--delete', branch])
  return { ok: true, output: String(out || '').trim() }
}

export async function restoreSnapshot(repo, ref) {
  if (!String(ref).startsWith(SNAP_PREFIX + '/')) throw new Error('非法的快照引用')
  const git = makeGit(repo)
  await createSnapshot(repo, 'before-restore')
  await git(['reset', '--hard', ref])
  return { ok: true }
}

/* ────────────────────────── 暂存 / 提交 ────────────────────────── */

export async function stageFiles(repo, files) {
  const git = makeGit(repo)
  await git(['add', '--', ...files])
  return { ok: true }
}

export async function unstageFiles(repo, files) {
  const git = makeGit(repo)
  try {
    await git(['restore', '--staged', '--', ...files])
  } catch {
    await git(['reset', '-q', 'HEAD', '--', ...files])
  }
  return { ok: true }
}

export async function discardFiles(repo, files, untracked) {
  const git = makeGit(repo)
  const snap = await createSnapshot(repo, 'discard')
  if (untracked) {
    await git(['clean', '-fd', '--', ...files])
  } else {
    await git(['checkout', '--', ...files])
  }
  return { ok: true, snapshot: snap }
}

export async function commitChanges(repo, message, amend, addAll) {
  const git = makeGit(repo)
  if (!message || !message.trim()) throw new Error('提交信息不能为空')
  if (addAll) await git(['add', '-A'])

  const args = ['commit']
  if (amend) args.push('--amend')
  for (const para of message.split(/\n\s*\n/).filter(Boolean)) {
    args.push('-m', para)
  }
  const out = await git(args)
  const oid = (await git(['rev-parse', 'HEAD'])).trim()
  return { ok: true, oid, short: oid.slice(0, 7), output: out.trim() }
}

/* ────────────────────────── 同步 ────────────────────────── */

const SYNC_TIMEOUT = 120_000

export async function fetchRepo(repo) {
  const out = await makeGit(repo)(['fetch', '--all', '--prune'], { timeout: SYNC_TIMEOUT })
  return { ok: true, output: out.trim() }
}

export async function pullRepo(repo) {
  const snap = await createSnapshot(repo, 'before-pull')
  const out = await makeGit(repo)(['pull', '--no-rebase', '--autostash'], { timeout: SYNC_TIMEOUT })
  return { ok: true, output: out.trim(), snapshot: snap }
}

export async function pushRepo(repo, force) {
  const args = ['push']
  if (force) args.push('--force-with-lease')
  const out = await makeGit(repo)(args, { timeout: SYNC_TIMEOUT })
  return { ok: true, output: out.trim() }
}

/* ────────────────────────── 暂存（stash） ────────────────────────── */

const SAFE_NAME = /^[A-Za-z0-9._\-\/]+$/

function assertRef(value, label = '引用名') {
  if (!value || value.startsWith('-') || value.includes('..') || !SAFE_NAME.test(value)) {
    throw new Error(`非法的${label}`)
  }
}

export async function listStashes(repo) {
  const git = makeGit(repo)
  let out = ''
  try {
    out = await git(['stash', 'list', '--format=%gd%x1f%ct%x1f%gs'])
  } catch {
    return { stashes: [] }
  }

  const stashes = out
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      const [ref, at, message] = line.split('\x1f')
      return {
        index: i,
        ref: ref || `stash@{${i}}`,
        time: Number(at) || 0,
        message: message || '',
      }
    })
  return { stashes }
}

export async function createStash(repo, message, includeUntracked) {
  const git = makeGit(repo)
  const args = ['stash', 'push']
  if (message && message.trim()) args.push('-m', message.trim())
  if (includeUntracked) args.push('-u')
  const out = await git(args)
  return { ok: true, output: out.trim() }
}

export async function stashAction(repo, ref, action) {
  const git = makeGit(repo)
  if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('非法的 stash 引用')
  if (action === 'apply') {
    const out = await git(['stash', 'apply', ref])
    return { ok: true, output: out.trim() }
  }
  if (action === 'pop') {
    const out = await git(['stash', 'pop', ref])
    return { ok: true, output: out.trim() }
  }
  if (action === 'drop') {
    const out = await git(['stash', 'drop', ref])
    return { ok: true, output: out.trim() }
  }
  throw new Error(`未知的 stash 操作: ${action}`)
}

export async function stashDiff(repo, ref) {
  const git = makeGit(repo)
  if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('非法的 stash 引用')
  let patch = ''
  try {
    patch = await git(['stash', 'show', '-p', '--no-color', ref])
  } catch {
    patch = ''
  }
  let numstat = ''
  try {
    numstat = await git(['stash', 'show', '--numstat', ref])
  } catch {
    numstat = ''
  }
  const files = numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split('\t')
      return {
        path: rest.join('\t'),
        additions: a === '-' ? 0 : Number(a) || 0,
        deletions: d === '-' ? 0 : Number(d) || 0,
      }
    })
  return { ref, files, patch }
}

/* ────────────────────────── 标签 ────────────────────────── */

export async function listTags(repo) {
  const git = makeGit(repo)
  let out = ''
  try {
    out = await git([
      'for-each-ref',
      '--format=%(refname:short)%1f%(objecttype)%1f%(taggerdate:unix)%1f%(subject)%1f%(*objectname)%1f%(objectname)',
      'refs/tags',
    ])
  } catch {
    return { tags: [] }
  }

  const tags = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, type, at, subject, peeled, oid] = line.split('\x1f')
      return {
        name,
        annotated: type === 'tag',
        time: Number(at) || 0,
        subject: subject || '',
        oid: peeled || oid,
      }
    })
    .sort((a, b) => b.time - a.time)

  return { tags }
}

export async function createTag(repo, name, message, oid) {
  assertRef(name, '标签名')
  const git = makeGit(repo)
  const args = ['tag']
  if (message && message.trim()) args.push('-a', '-m', message.trim())
  args.push(name)
  if (oid) {
    if (!/^[0-9a-f]{4,40}$/i.test(oid)) throw new Error('非法的提交')
    args.push(oid)
  }
  await git(args)
  return { ok: true }
}

export async function deleteTag(repo, name) {
  assertRef(name, '标签名')
  await makeGit(repo)(['tag', '-d', name])
  return { ok: true }
}

/* ────────────────────────── 分支操作 ────────────────────────── */

export async function mergeBranch(repo, name) {
  assertRef(name, '分支名')
  const git = makeGit(repo)
  const snap = await createSnapshot(repo, 'before-merge')

  const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (current === name) throw new Error('不能合并当前分支到自己')

  try {
    const out = await git(['merge', '--no-ff', '--no-edit', name])
    return { ok: true, conflicts: false, output: out.trim(), snapshot: snap }
  } catch (e) {
    const st = await worktreeStatus(repo)
    return {
      ok: false,
      conflicts: st.conflicted.length > 0,
      output: String(e.stderr || e.message || '').trim(),
      snapshot: snap,
      conflicted: st.conflicted,
    }
  }
}

export async function deleteBranch(repo, name, force) {
  assertRef(name, '分支名')
  const git = makeGit(repo)
  const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (current === name) throw new Error('不能删除当前所在分支')
  const snap = await createSnapshot(repo, 'before-delete-branch')
  await git(['branch', force ? '-D' : '-d', name])
  return { ok: true, snapshot: snap }
}

export async function renameBranch(repo, from, to) {
  assertRef(from, '分支名')
  assertRef(to, '分支名')
  await makeGit(repo)(['branch', '-m', from, to])
  return { ok: true }
}

/* ────────────────────────── 工作树（worktree） ────────────────────────── */

const AI_HINT_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursor', '.github/copilot-instructions.md']

function parseWorktreeList(out) {
  const entries = []
  let cur = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur)
      cur = { path: line.slice('worktree '.length), head: '', branch: '', bare: false, detached: false, locked: false, prunable: false }
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line === 'detached') {
      cur.detached = true
    } else if (line.startsWith('locked')) {
      cur.locked = true
    } else if (line.startsWith('prunable')) {
      cur.prunable = true
    }
  }
  if (cur) entries.push(cur)
  return entries
}

/** 列出所有工作树，并补充脏文件数 / ahead·behind / 最近提交时间 / AI 配置标记 */
export async function listWorktrees(repo) {
  const git = makeGit(repo)
  const raw = await git(['worktree', 'list', '--porcelain'])
  const entries = parseWorktreeList(raw)

  // 是否已合回主干
  let trunk = 'HEAD'
  for (const b of ['main', 'master']) {
    try {
      await git(['rev-parse', '--verify', `refs/heads/${b}`])
      trunk = b
      break
    } catch {
      /* 试下一个 */
    }
  }
  let mergedList = ''
  try {
    mergedList = await git(['branch', '--merged', trunk, '--format=%(refname:short)'])
  } catch {
    mergedList = ''
  }
  const mergedSet = new Set(mergedList.split('\n').map((s) => s.trim()).filter(Boolean))

  const enriched = await Promise.all(
    entries.map(async (wt) => {
      const item = {
        path: wt.path.replace(/\\/g, '/'),
        head: wt.head,
        short: wt.head.slice(0, 7),
        branch: wt.branch || (wt.detached ? '（分离头指针）' : ''),
        bare: wt.bare,
        detached: wt.detached,
        locked: wt.locked,
        prunable: wt.prunable,
        isCurrent: path.resolve(wt.path) === path.resolve(repo),
        exists: fs.existsSync(wt.path),
        dirty: 0,
        ahead: 0,
        behind: 0,
        lastCommit: 0,
        aiHints: [],
        merged: wt.branch ? mergedSet.has(wt.branch) : false,
      }

      if (item.exists && !item.bare) {
        try {
          const st = await makeGit(wt.path)(['status', '--porcelain=v2', '--branch', '-uno'])
          const parsed = parseStatus(st)
          item.dirty = parsed.staged.length + parsed.unstaged.length + parsed.conflicted.length
          item.ahead = parsed.ahead
          item.behind = parsed.behind
        } catch {
          /* 忽略单个工作树的读取失败 */
        }
        try {
          const t = await makeGit(wt.path)(['log', '-1', '--format=%ct'])
          item.lastCommit = Number(t.trim()) || 0
        } catch {
          /* 空仓库 */
        }
        item.aiHints = AI_HINT_FILES.filter((f) => fs.existsSync(path.join(wt.path, f)))
      }

      return item
    }),
  )

  return { worktrees: enriched }
}

export async function addWorktree(repo, opts) {
  const git = makeGit(repo)
  const target = path.resolve(String(opts.target || ''))
  if (!target) throw new Error('缺少工作树路径')
  if (fs.existsSync(target)) throw new Error('目标目录已存在')
  if (target.includes(`${path.sep}.git${path.sep}`)) throw new Error('不能建在 .git 目录里')

  const args = ['worktree', 'add']
  if (opts.newBranch) {
    assertRef(opts.branch, '分支名')
    args.push('-b', opts.branch)
    args.push(target)
    args.push(opts.base && String(opts.base).trim() ? String(opts.base).trim() : 'HEAD')
  } else {
    if (!opts.branch) throw new Error('缺少分支名')
    args.push(target, opts.branch)
  }

  await git(args)
  return { ok: true, path: target.replace(/\\/g, '/') }
}

export async function removeWorktree(repo, wtPath, force) {
  const target = path.resolve(String(wtPath || ''))
  if (path.resolve(repo) === target) throw new Error('不能移除当前正在使用的工作树')
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(target)
  await makeGit(repo)(args)
  return { ok: true }
}

export async function pruneWorktrees(repo) {
  const out = await makeGit(repo)(['worktree', 'prune', '-v'])
  return { ok: true, output: out.trim() }
}

/* ────────────────────────── 文件历史 / Blame / 体检 ────────────────────────── */

export async function fileHistory(repo, file, limit = 200) {
  if (!file || file.startsWith('-')) throw new Error('非法的文件路径')
  const git = makeGit(repo)
  const out = await git([
    'log',
    '--follow',
    `--max-count=${Math.min(500, Math.max(1, limit))}`,
    '--format=%H%x1f%s%x1f%an%x1f%ct',
    '--',
    file,
  ])
  return {
    file,
    commits: out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [oid, subject, author, at] = line.split('\x1f')
        return { oid, short: oid.slice(0, 7), subject: subject || '', author: author || '', time: Number(at) || 0 }
      }),
  }
}

export async function blameFile(repo, file, max = 2000) {
  const git = makeGit(repo)
  const out = await git(['blame', '--line-porcelain', '--', file])
  const limit = Math.min(5000, Math.max(1, max))
  const lines = []
  let oid = ''
  let author = ''
  let time = 0
  let lineNo = 0

  for (const raw of out.split('\n')) {
    if (raw.startsWith('\t')) {
      if (lines.length < limit) {
        lines.push({ line: lineNo, oid, short: oid.slice(0, 7), author, time, content: raw.slice(1) })
      }
      continue
    }
    if (raw.startsWith('author ')) author = raw.slice(7)
    else if (raw.startsWith('author-time ')) time = Number(raw.slice(12)) || 0
    else if (raw.length > 40 && raw[40] === ' ') {
      const head = raw.split(' ')
      if (head.length >= 3 && /^[0-9a-f]{40}$/.test(head[0])) {
        oid = head[0]
        lineNo = Number(head[2]) || 0
      }
    }
  }
  return { file, lines, truncated: lines.length >= limit }
}

function dirSize(p) {
  let total = 0
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name)
      try {
        if (e.isDirectory()) total += dirSize(full)
        else total += fs.statSync(full).size
      } catch {
        /* 忽略单个文件 */
      }
    }
  } catch {
    /* 忽略 */
  }
  return total
}

/* ────────────────────── 本地文件（查看 / 编辑） ────────────────────── */

/** 相对路径 → 仓库内绝对路径，越界直接拒绝 */
function safeJoin(repo, rel) {
  const root = path.resolve(repo)
  const joined = path.resolve(root, String(rel || '').replace(/^[\\/]+/, ''))
  if (joined !== root && !joined.startsWith(root + path.sep)) {
    throw new Error(`路径越界：${rel}`)
  }
  return joined
}

function relOf(root, p) {
  return path.relative(root, p).replace(/\\/g, '/')
}

function detectEncoding(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: 'utf8bom', editable: true }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return { encoding: 'utf8', editable: true }
  } catch {
    return { encoding: 'other', editable: false }
  }
}

/** 仓库内所有可编辑文件（已跟踪 + 未跟踪），文件面板全局搜索用 */
export async function repoFiles(repo) {
  const git = makeGit(repo)
  const out = await git(['ls-files', '-co', '--exclude-standard', '-z'])
  const files = out
    .split('\0')
    .filter(Boolean)
    .map((s) => s.replace(/\\/g, '/'))
  files.sort()
  return { files: [...new Set(files)] }
}

export async function fsList(repo, dir = '') {  const root = path.resolve(repo)
  const target = safeJoin(root, dir)
  const entries = []
  for (const item of fs.readdirSync(target, { withFileTypes: true })) {
    if (item.name === '.git') continue
    let size = 0
    try {
      size = fs.statSync(path.join(target, item.name)).size
    } catch {
      size = 0
    }
    entries.push({
      name: item.name,
      path: relOf(root, path.join(target, item.name)),
      isDir: item.isDirectory(),
      size,
    })
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.isDir ? -1 : 1))
  return { dir: relOf(root, target), entries }
}

/** 在文件内容里搜索（git grep，含未跟踪文件） */
export async function fsGrep(repo, query, max = 300) {
  const q = String(query || '')
  if (!q.trim()) return { hits: [] }
  const r = spawnSync(
    'git',
    ['-C', repo, 'grep', '-n', '-I', '-F', '--untracked', '--no-color', '-e', q, '--', '.'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  )
  const text = r.stdout || ''
  const limit = Math.max(1, max)
  const hits = []
  for (const line of text.split('\n')) {
    if (hits.length >= limit) break
    const first = line.indexOf(':')
    if (first < 0) continue
    const second = line.indexOf(':', first + 1)
    if (second < 0) continue
    const file = line.slice(0, first).replace(/^\.\//, '')
    const no = Number(line.slice(first + 1, second))
    if (!Number.isFinite(no)) continue
    hits.push({ file, line: no, text: line.slice(second + 1).trimEnd() })
  }
  return { hits, limitReached: hits.length >= limit }
}

export async function fsRead(repo, file, maxBytes = 2 * 1024 * 1024) {  const root = path.resolve(repo)
  const target = safeJoin(root, file)
  const stat = fs.statSync(target)
  if (!stat.isFile()) throw new Error(`不是文件：${file}`)
  const bytes = fs.readFileSync(target)
  const isBinary = bytes.subarray(0, 8000).includes(0)
  const { encoding, editable } = detectEncoding(bytes)
  const truncated = bytes.length > maxBytes
  const slice = bytes.subarray(0, Math.min(maxBytes, bytes.length))
  let content = ''
  if (!isBinary) {
    content = slice.toString('utf8')
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
  }
  return {
    file: relOf(root, target),
    content,
    size: stat.size,
    isBinary,
    truncated,
    encoding,
    editable: editable && !isBinary && !truncated,
    lines: content ? content.split('\n').length : 0,
  }
}

export async function fsWrite(repo, file, content) {
  const root = path.resolve(repo)
  const target = safeJoin(root, file)
  let keepBom = false
  if (fs.existsSync(target)) {
    const old = fs.readFileSync(target)
    const { encoding, editable } = detectEncoding(old)
    if (!editable) throw new Error('这个文件不是 UTF-8 编码（可能是 GBK/GB18030），为避免写坏已拒绝保存')
    keepBom = encoding === 'utf8bom'
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const text = keepBom ? '\uFEFF' + content : content
  fs.writeFileSync(target, text, 'utf8')
  return {
    ok: true,
    file: relOf(root, target),
    size: Buffer.byteLength(text, 'utf8'),
    lines: content ? content.split('\n').length : 0,
  }
}

export async function repoHealth(repo) {  const git = makeGit(repo)
  const safe = async (args) => {
    try {
      return await git(args)
    } catch {
      return ''
    }
  }

  let gitSize = 0
  let packSize = 0
  let packCount = 0
  const large = []

  const gitDir = (await safe(['rev-parse', '--absolute-git-dir'])).trim()
  if (gitDir) {
    gitSize = dirSize(gitDir)
    const packDir = path.join(gitDir, 'objects', 'pack')
    let files = []
    try {
      files = fs.readdirSync(packDir)
    } catch {
      files = []
    }
    const packs = files.filter((f) => f.endsWith('.pack'))
    const idxs = files.filter((f) => f.endsWith('.idx'))
    for (const f of packs) {
      try {
        packSize += fs.statSync(path.join(packDir, f)).size
      } catch {
        /* ignore */
      }
    }
    for (const idx of idxs.slice(0, 3)) {
      const out = await safe(['verify-pack', '-v', path.join(packDir, idx)])
      for (const line of out.split('\n')) {
        const f = line.trim().split(/\s+/)
        if (f.length >= 5 && f[1] === 'blob') {
          const size = Number(f[2]) || 0
          if (size > 0) large.push({ oid: f[0], short: f[0].slice(0, 7), size })
        }
      }
    }
    large.sort((a, b) => b.size - a.size)
    large.length = Math.min(large.length, 8)

    packCount = idxs.length
  }

  const counts = await safe(['count-objects', '-v'])
  let loose = 0
  let inPack = 0
  let garbage = 0
  let sizePackKb = 0
  for (const line of counts.split('\n')) {
    const [k, v] = line.trim().split(/\s+/)
    if (k === 'count:') loose = Number(v) || 0
    else if (k === 'in-pack:') inPack = Number(v) || 0
    else if (k === 'garbage:') garbage = Number(v) || 0
    else if (k === 'size-pack:') sizePackKb = Number(v) || 0
  }
  if (!packSize) packSize = sizePackKb * 1024

  const commits = Number((await safe(['rev-list', '--count', '--all'])).trim()) || 0
  const branches = (await safe(['for-each-ref', '--format=%(refname)', 'refs/heads'])).split('\n').filter(Boolean).length
  const tags = (await safe(['for-each-ref', '--format=%(refname)', 'refs/tags'])).split('\n').filter(Boolean).length
  const files = (await safe(['ls-files'])).split('\n').filter(Boolean).length

  const suggestions = []
  if (garbage > 0) suggestions.push(`有 ${garbage} 个垃圾对象，建议执行 git gc`)
  if (loose > 5000) suggestions.push(`松散对象 ${loose} 个，git gc 可明显提速`)
  if (large.length && large[0].size > 20 * 1024 * 1024) {
    suggestions.push(`历史中存在超大对象 ${large[0].short}（${(large[0].size / 1048576).toFixed(1)} MB），可考虑 git filter-repo 清理`)
  }
  if (typeof packCount === 'number' && packCount > 10) suggestions.push(`pack 文件 ${packCount} 个，gc 后可合并`)

  return {
    gitSize,
    packSize,
    packCount,
    looseObjects: loose,
    inPack,
    garbage,
    commits,
    branches,
    tags,
    files,
    largeObjects: large,
    suggestions,
  }
}

/* ────────────────────────── 工作树元数据 / 多仓库看板 ────────────────────────── */

function metaFile(repo) {
  return path.join(repo, '.gitpanel', 'worktree-meta.json')
}

export async function worktreeMetaList(repo) {
  try {
    return { meta: JSON.parse(fs.readFileSync(metaFile(repo), 'utf8')) }
  } catch {
    return { meta: {} }
  }
}

export async function worktreeMetaSet(repo, wtPath, agent, note, task) {
  const file = metaFile(repo)
  let all = {}
  try {
    all = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    all = {}
  }
  const key = String(wtPath).replace(/\\/g, '/')
  const prev = all[key] || {}
  const now = Date.now()
  all[key] = {
    agent: agent ?? prev.agent ?? '',
    note: note ?? prev.note ?? '',
    task: task ?? prev.task ?? '',
    createdAt: prev.createdAt ?? now,
    lastUsedAt: now,
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(all, null, 2), 'utf8')
  return { ok: true, meta: all }
}

export async function worktreeMetaTouch(repo, wtPath) {
  return worktreeMetaSet(repo, wtPath, undefined, undefined, undefined)
}

/** 多仓库看板：把给定的仓库路径补上分支/漂移/脏文件/工作树数 */
export async function reposOverview(paths) {
  const list = Array.isArray(paths) ? paths.slice(0, 20) : []
  const out = await Promise.all(
    list.map(async (p) => {
      const name = String(p).split(/[\\/]/).filter(Boolean).pop() || String(p)
      const base = { path: p, name, exists: false, branch: '', ahead: 0, behind: 0, dirty: 0, lastCommit: 0, worktrees: 0, error: null }
      if (!fs.existsSync(p)) return { ...base, error: '目录不存在' }
      try {
        const st = await worktreeStatus(p)
        const git = makeGit(p)
        let last = 0
        try {
          last = Number((await git(['reflog', '--format=%ct', '-n', '1'])).trim()) || 0
        } catch {
          last = 0
        }
        let wts = 1
        try {
          wts = (await listWorktrees(p)).worktrees.length
        } catch {
          wts = 1
        }
        return {
          ...base,
          exists: true,
          branch: st.branch,
          ahead: st.ahead,
          behind: st.behind,
          dirty: st.staged.length + st.unstaged.length + st.untracked.length + st.conflicted.length,
          lastCommit: last,
          worktrees: wts,
        }
      } catch (e) {
        return { ...base, exists: true, error: String(e.message || e) }
      }
    }),
  )
  return { repos: out }
}

/* ────────────────────────── 项目 / 克隆 / 身份 ────────────────────────── */

export async function cloneRepo(url, target) {
  const u = String(url || '').trim()
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(u)) throw new Error('只支持 http(s) / ssh / git@ 形式的仓库地址')
  const t = path.resolve(String(target || '').trim())
  if (!target || !String(target).trim()) throw new Error('请选择目标目录')
  if (fs.existsSync(t) && fs.readdirSync(t).length > 0) throw new Error('目标目录已存在且非空')

  try {
    const { stdout, stderr } = await run('git', ['clone', '--progress', u, t], {
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      timeout: 300_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8',
    })
    return { ok: true, path: t.replace(/\\/g, '/'), output: (stdout + stderr).trim() }
  } catch (e) {
    throw new Error(String(e.stderr || e.message || e))
  }
}

export async function gitIdentity() {
  const get = async (key) => {
    try {
      const out = await run('git', ['config', '--global', '--get', key], { encoding: 'utf8', windowsHide: true })
      return (out.stdout || '').trim()
    } catch {
      return ''
    }
  }
  return { name: await get('user.name'), email: await get('user.email') }
}

/* ────────────────────────── 交互式 rebase ────────────────────────── */

const SAFE_ACTION = new Set(['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'])

/** rebase 基点允许 HEAD~3 / main^2 这类修订表达式 */
function assertRev(value, label = '基点') {
  if (
    !value ||
    value.startsWith('-') ||
    value.includes('..') ||
    !/^[A-Za-z0-9._\-\/~^]+$/.test(value)
  ) {
    throw new Error(`非法的${label}`)
  }
}

function assertOid(oid) {
  if (!/^[0-9a-f]{7,40}$/i.test(oid)) throw new Error('非法的提交')
}

export async function rebasePreview(repo, base) {
  const git = makeGit(repo)
  assertRev(base)
  const baseOid = (await git(['rev-parse', '--verify', `${base}^{commit}`])).trim()
  const out = await git([
    'log',
    '--reverse',
    '--format=%H%x1f%s%x1f%an%x1f%ct',
    `${baseOid}..HEAD`,
  ])

  const commits = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [oid, subject, author, at] = line.split('\x1f')
      return { oid, short: oid.slice(0, 7), subject: subject || '', author: author || '', time: Number(at) || 0 }
    })

  if (!commits.length) throw new Error('该基点之后没有提交')
  return { base: baseOid, commits }
}

export async function rebaseStart(repo, base, steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('没有可整理的提交')
  for (const st of steps) {
    if (!SAFE_ACTION.has(st.action)) throw new Error(`未知的 rebase 动作: ${st.action}`)
    assertOid(st.oid)
  }
  const first = steps.find((st) => st.action !== 'drop')
  if (!first || (first.action !== 'pick' && first.action !== 'reword' && first.action !== 'edit')) {
    throw new Error('第一条保留的提交必须是 pick / reword / edit')
  }

  const git = makeGit(repo)
  assertRev(base)
  const baseOid = (await git(['rev-parse', '--verify', `${base}^{commit}`])).trim()
  const snap = await createSnapshot(repo, 'before-rebase')

  const tmp = path.join(os.tmpdir(), `gitpanel-rebase-${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  const todoFile = path.join(tmp, 'todo.txt')
  const todo = steps
    .map((st) => `${st.action} ${st.oid} ${String(st.subject || '').replace(/\r?\n/g, ' ')}`.trim())
    .join('\n')
  fs.writeFileSync(todoFile, `${todo}\n`, 'utf8')

  let editor
  if (process.platform === 'win32') {
    editor = path.join(tmp, 'seq-editor.cmd')
    fs.writeFileSync(editor, `@echo off\r\ncopy /y "${todoFile}" "%~1" >nul\r\n`, 'utf8')
  } else {
    editor = path.join(tmp, 'seq-editor.sh')
    fs.writeFileSync(editor, `#!/bin/sh\ncp "${todoFile}" "$1"\n`, { mode: 0o755 })
  }
  // git 通过 sh 执行编辑器，Windows 反斜杠会被当转义符吃掉，统一用正斜杠
  const editorArg = editor.replace(/\\/g, '/')

  try {
    const { stdout } = await run('git', ['-C', repo, 'rebase', '-i', baseOid], {
      env: { ...process.env, GIT_SEQUENCE_EDITOR: editorArg, GIT_EDITOR: 'true' },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      timeout: 120_000,
    })
    return { ok: true, conflicts: false, output: stdout.trim(), snapshot: snap }
  } catch (e) {
    return {
      ok: false,
      conflicts: true,
      output: String(e.stderr || e.message || '').trim(),
      snapshot: snap,
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* 忽略清理失败 */
    }
  }
}

export async function rebaseStatus(repo) {
  const git = makeGit(repo)
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    try {
      const rel = (await git(['rev-parse', '--git-path', dir])).trim()
      const abs = path.isAbsolute(rel) ? rel : path.join(repo, rel)
      if (fs.existsSync(abs)) {
        const st = await worktreeStatus(repo)
        // edit 暂停：stopped-sha 存在；msg 里是正在处理的提交说明
        const stopped = fs.existsSync(path.join(abs, 'stopped-sha'))
        let subject = ''
        try {
          subject = fs.readFileSync(path.join(abs, 'msg'), 'utf8').trim().split('\n')[0] || ''
        } catch {
          subject = ''
        }
        return {
          inProgress: true,
          kind: dir,
          stopped,
          subject,
          conflicts: st.conflicted.length > 0,
          conflicted: st.conflicted,
        }
      }
    } catch {
      /* 忽略 */
    }
  }
  return { inProgress: false, stopped: false, subject: '', conflicts: false, conflicted: [] }
}

export async function rebaseAction(repo, action) {
  if (!['continue', 'abort', 'skip'].includes(action)) throw new Error('未知的 rebase 操作')
  try {
    const { stdout } = await run('git', ['-C', repo, 'rebase', `--${action}`], {
      env: { ...process.env, GIT_EDITOR: 'true' },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      timeout: 120_000,
    })
    return { ok: true, conflicts: false, output: stdout.trim() }
  } catch (e) {
    const st = await worktreeStatus(repo)
    return {
      ok: false,
      conflicts: st.conflicted.length > 0,
      output: String(e.stderr || e.message || '').trim(),
      conflicted: st.conflicted,
    }
  }
}

export async function listReflog(repo, limit = 60) {
  const git = makeGit(repo)
  let out = ''
  try {
    out = await git(['reflog', '--format=%H%x1f%gd%x1f%ct%x1f%gs', '-n', String(limit)])
  } catch {
    return { entries: [] }
  }

  const entries = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [oid, selector, at, action] = line.split('\x1f')
      return {
        oid,
        short: oid.slice(0, 7),
        selector,
        time: Number(at) || 0,
        action: action || '',
      }
    })

  return { entries }
}

export async function resetTo(repo, oid, mode) {
  if (!/^[0-9a-f]{4,40}$/i.test(oid)) throw new Error('非法的提交')
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw new Error('非法的重置模式')
  const snap = await createSnapshot(repo, `before-reset-${mode}`)
  await makeGit(repo)(['reset', `--${mode}`, oid])
  return { ok: true, snapshot: snap }
}

/* ────────────────── cherry-pick / revert ────────────────── */

async function sequenceResult(repo, output, snapshot) {
  return {
    ok: true,
    conflicts: false,
    output: String(output || '').trim(),
    snapshot,
    conflicted: [],
  }
}

export async function cherryPick(repo, oid) {
  if (!/^[0-9a-f]{4,40}$/i.test(oid)) throw new Error('非法的提交')
  const snap = await createSnapshot(repo, 'before-cherry-pick')
  const git = makeGit(repo)
  try {
    const out = await git(['cherry-pick', oid])
    return await sequenceResult(repo, out, snap)
  } catch (e) {
    const st = await worktreeStatus(repo)
    return {
      ok: false,
      conflicts: st.conflicted.length > 0,
      output: String(e.message || e),
      snapshot: snap,
      conflicted: st.conflicted,
    }
  }
}

export async function revertCommit(repo, oid) {
  if (!/^[0-9a-f]{4,40}$/i.test(oid)) throw new Error('非法的提交')
  const snap = await createSnapshot(repo, 'before-revert')
  const git = makeGit(repo)
  try {
    const out = await git(['revert', '--no-edit', oid])
    return await sequenceResult(repo, out, snap)
  } catch (e) {
    const st = await worktreeStatus(repo)
    return {
      ok: false,
      conflicts: st.conflicted.length > 0,
      output: String(e.message || e),
      snapshot: snap,
      conflicted: st.conflicted,
    }
  }
}

export async function sequenceStatus(repo) {
  const st = await worktreeStatus(repo)
  const git = makeGit(repo)
  let kind = ''
  try {
    const dir = (await git(['rev-parse', '--git-dir'])).trim()
    const abs = path.isAbsolute(dir) ? dir : path.join(repo, dir)
    const has = (n) => fs.existsSync(path.join(abs, n))
    if (has('CHERRY_PICK_HEAD') || has('sequencer')) kind = 'cherry-pick'
    else if (has('REVERT_HEAD')) kind = 'revert'
    let pending = 0
    try {
      const todo = fs.readFileSync(path.join(abs, 'sequencer', 'todo'), 'utf8')
      pending = todo.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length
    } catch {
      pending = 0
    }
    return { kind, inProgress: !!kind, conflicted: st.conflicted, pending }
  } catch {
    return { kind: '', inProgress: false, conflicted: st.conflicted, pending: 0 }
  }
}

/* ────────────────── hunk 级暂存 / 跨提交对比 ────────────────── */

/** 解析 git diff -U3：文件头 + hunks */
function parseHunks(text) {
  const header = []
  const hunks = []
  let cur = null
  let isBinary = false
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) isBinary = true
    if (line.startsWith('@@')) {
      if (cur) hunks.push(cur)
      cur = { header: line, lines: [] }
    } else if (cur) {
      cur.lines.push(line)
    } else if (line !== '' || header.length) {
      header.push(line)
    }
  }
  if (cur) hunks.push(cur)
  return { header, hunks, isBinary }
}

async function rawFileDiff(repo, file, staged) {
  const git = makeGit(repo)
  const args = ['diff', '-U3', '--no-color', '--no-ext-diff']
  if (staged) args.push('--cached')
  args.push('--', file)
  try {
    return await git(args)
  } catch {
    return ''
  }
}

export async function fileHunks(repo, file, staged) {
  const text = await rawFileDiff(repo, file, staged)
  const { header, hunks, isBinary } = parseHunks(text)
  return { path: file, staged: !!staged, fileHeader: header, hunks, isBinary }
}

/** mode: stage / unstage / discard */
export async function applyHunks(repo, file, staged, indexes, mode) {
  const text = await rawFileDiff(repo, file, staged)
  const { header, hunks } = parseHunks(text)
  if (!hunks.length) throw new Error('这个文件没有可操作的 diff 块（可能是二进制或未跟踪文件）')
  const picked = (indexes || []).filter((i) => hunks[i])
  if (!picked.length) throw new Error('没有选中任何 diff 块')
  const parts = [...header]
  for (const i of picked) {
    parts.push(hunks[i].header, ...hunks[i].lines)
  }
  const patch = parts.join('\n') + '\n'
  const args = ['apply', '--whitespace=nowarn']
  if (mode === 'stage') args.push('--cached')
  else if (mode === 'unstage') args.push('--cached', '--reverse')
  else if (mode === 'discard') args.push('--reverse')
  else throw new Error(`未知操作：${mode}`)

  const r = spawnSync('git', ['-C', repo, ...args], {
    input: patch,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error((r.stderr || '').trim() || 'git apply 失败')
  return { ok: true, output: (r.stdout || '').trim() }
}

/** a..b 之间变更的文件 */
export async function compareCommits(repo, a, b) {
  const git = makeGit(repo)
  const out = await git(['diff', '--name-status', '-z', a, b])
  const parts = out.split('\0').filter((s) => s !== '')
  const files = []
  for (let i = 0; i < parts.length; i += 1) {
    const status = parts[i]
    const path = parts[i + 1]
    if (!path) break
    const first = status[0] || 'M'
    if (first === 'R' || first === 'C') i += 1
    files.push({ path, status: first })
    i += 1
  }
  files.sort((x, y) => x.path.localeCompare(y.path))
  return { a, b, files }
}

export async function compareFile(repo, a, b, file, win = {}) {
  const show = async (rev) => {
    try {
      return await gitRaw(repo, ['show', `${rev}:${file}`])
    } catch {
      return Buffer.alloc(0)
    }
  }
  const oldBuf = await show(a)
  const newBuf = await show(b)
  return buildFileDiff(file, oldBuf, newBuf, win)
}

export async function ignoreFile(repo, file) {
  const rel = String(file || '').replace(/\\/g, '/')
  if (!rel.trim()) throw new Error('缺少文件路径')
  const gi = path.join(repo, '.gitignore')
  let content = ''
  try {
    content = fs.readFileSync(gi, 'utf8')
  } catch {
    content = ''
  }
  const entry = `/${rel}`
  if (content.split('\n').some((l) => l.trim() === entry)) return { ok: true, entry }
  if (content && !content.endsWith('\n')) content += '\n'
  content += entry + '\n'
  fs.writeFileSync(gi, content, 'utf8')
  return { ok: true, entry }
}

export async function sequenceAction(repo, kind, action) {  if (!['cherry-pick', 'revert'].includes(kind)) throw new Error(`未知的序列操作：${kind}`)
  if (!['continue', 'skip', 'abort'].includes(action)) throw new Error(`未知动作：${action}`)
  const git = makeGit(repo)
  const out = await git([kind, `--${action}`], { env: { ...process.env, GIT_EDITOR: 'true' } })
  return { ok: true, output: String(out || '').trim() }
}
