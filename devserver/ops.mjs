// 工作区与写操作：状态解析、暂存/提交、推拉、安全网快照。
// 设计约定：读路径用 git 结构化解剖，写路径走 git CLI；破坏性操作前自动打快照。
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024
const MAX_TEXT = 400_000
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

function looksBinary(buf) {
  return buf.subarray(0, 8000).includes(0)
}

async function blob(repo, spec) {
  try {
    return await gitRaw(repo, ['show', spec])
  } catch {
    return Buffer.alloc(0)
  }
}

/** staged=true: HEAD vs index；staged=false: index vs 工作区文件 */
export async function worktreeDiff(repo, file, staged) {
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

  if (looksBinary(oldBuf) || looksBinary(newBuf)) {
    return { path: file, oldText: '', newText: '', isBinary: true, truncated: false }
  }

  return {
    path: file,
    oldText: oldBuf.subarray(0, MAX_TEXT).toString('utf8'),
    newText: newBuf.subarray(0, MAX_TEXT).toString('utf8'),
    isBinary: false,
    truncated: oldBuf.length > MAX_TEXT || newBuf.length > MAX_TEXT,
  }
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
