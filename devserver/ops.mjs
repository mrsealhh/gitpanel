// 工作区与写操作：状态解析、暂存/提交、推拉、安全网快照。
// 设计约定：读路径用 git 结构化解剖，写路径走 git CLI；破坏性操作前自动打快照。
import fs from 'node:fs'
import os from 'node:os'
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
        return {
          inProgress: true,
          kind: dir,
          conflicts: st.conflicted.length > 0,
          conflicted: st.conflicted,
        }
      }
    } catch {
      /* 忽略 */
    }
  }
  return { inProgress: false, conflicts: false, conflicted: [] }
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
