// 开发期数据桥：直接调用本机 git，向前端提供与 Rust 内核完全一致的契约。
// 用途：前端可在浏览器里独立开发、独立压测，不必等 Rust 工具链。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { layout } from './layout.mjs'
import * as ops from './ops.mjs'
import * as conflict from './conflict.mjs'

const run = promisify(execFile)
const PORT = Number(process.env.GITPANEL_PORT || 7717)
const MAX_BUFFER = 64 * 1024 * 1024

async function git(repo, args) {
  const { stdout } = await run('git', ['-C', repo, '-c', 'core.quotepath=false', ...args], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    encoding: 'utf8',
  })
  return stdout
}

async function gitRaw(repo, args) {
  const { stdout } = await run('git', ['-C', repo, ...args], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    encoding: 'buffer',
  })
  return stdout
}

const MAX_TEXT = 400_000

function looksBinary(buf) {
  return buf.subarray(0, 8000).includes(0)
}

async function tryBlob(repo, revPath) {
  try {
    return await gitRaw(repo, ['show', revPath])
  } catch {
    return Buffer.alloc(0)
  }
}

/** 取某文件在「父提交 vs 当前提交」两个版本的全文，交给前端做并排合并视图 */
async function fileDiff(repoPath, oid, file) {
  let parent = ''
  try {
    parent = (await git(repoPath, ['rev-parse', `${oid}^`])).trim()
  } catch {
    parent = ''
  }

  const oldBuf = parent ? await tryBlob(repoPath, `${parent}:${file}`) : Buffer.alloc(0)
  const newBuf = await tryBlob(repoPath, `${oid}:${file}`)

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

const SEP = '\x1f'
const REC = '\x1e'

function parseRefs(out) {
  const refs = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [refname, oid, type, peeled] = line.split(SEP)
    let kind = null
    let name = refname
    if (refname.startsWith('refs/heads/')) {
      kind = 'branch'
      name = refname.slice('refs/heads/'.length)
    } else if (refname.startsWith('refs/remotes/')) {
      kind = 'remote'
      name = refname.slice('refs/remotes/'.length)
    } else if (refname.startsWith('refs/tags/')) {
      kind = 'tag'
      name = refname.slice('refs/tags/'.length)
    } else continue
    refs.push({ name, kind, oid: type === 'commit' ? oid : peeled || oid })
  }
  return refs
}

function badgeMap(refs, headOid, headBranch) {
  const map = new Map()
  for (const r of refs) {
    const list = map.get(r.oid) || []
    if (r.kind === 'branch' && r.name === headBranch) list.unshift({ name: r.name, kind: 'head' })
    else list.push({ name: r.name, kind: r.kind })
    map.set(r.oid, list)
  }
  if (headBranch === 'HEAD' && headOid) {
    const list = map.get(headOid) || []
    list.unshift({ name: 'HEAD', kind: 'head' })
    map.set(headOid, list)
  }
  return map
}

async function openRepo(repoPath) {
  const top = (await git(repoPath, ['rev-parse', '--show-toplevel'])).trim()
  const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  let headOid = ''
  try {
    headOid = (await git(repoPath, ['rev-parse', 'HEAD'])).trim()
  } catch {
    headOid = ''
  }
  const refs = parseRefs(
    await git(repoPath, [
      'for-each-ref',
      `--format=%(refname)${SEP}%(objectname)${SEP}%(objecttype)${SEP}%(*objectname)`,
    ]),
  )
  return {
    path: top,
    name: top.split(/[\\/]/).filter(Boolean).pop() || top,
    branch,
    headOid,
    refs,
  }
}

async function graphPage(repoPath, { offset = 0, limit = 400, tip = '' } = {}) {
  const take = Math.max(1, Math.min(offset + limit, 20000))
  const args = [
    'log',
    '--no-color',
    '--date-order',
    '--parents',
    `--pretty=format:%H${SEP}%P${SEP}%an${SEP}%ae${SEP}%at${SEP}%s${REC}`,
    `-n${take}`,
  ]
  if (tip) args.push(tip)
  else args.push('--all')

  let raw = ''
  try {
    raw = await git(repoPath, args)
  } catch (e) {
    raw = ''
  }

  const commits = []
  for (const rec of raw.split(REC)) {
    const line = rec.replace(/^\n/, '')
    if (!line.trim()) continue
    const [oid, parents, author, email, at, summary] = line.split(SEP)
    commits.push({
      oid,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      email,
      time: Number(at) || 0,
      summary: summary || '',
    })
  }

  const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const refs = parseRefs(
    await git(repoPath, [
      'for-each-ref',
      `--format=%(refname)${SEP}%(objectname)${SEP}%(objecttype)${SEP}%(*objectname)`,
    ]),
  )
  let headOid = ''
  try {
    headOid = (await git(repoPath, ['rev-parse', 'HEAD'])).trim()
  } catch {
    headOid = ''
  }

  const { rows, laneCount } = layout(commits, badgeMap(refs, headOid, branch))
  const slice = rows.slice(offset, offset + limit)
  return {
    rows: slice,
    nextOffset: offset + slice.length,
    done: rows.length < take || slice.length === 0,
    laneCount,
    total: rows.length,
  }
}

async function commitDetail(repoPath, oid) {
  const meta = (
    await git(repoPath, [
      'show',
      '-s',
      `--format=%H${SEP}%P${SEP}%an${SEP}%ae${SEP}%at${SEP}%s%n%b---BODYEND---`,
      oid,
    ])
  ).replace(/^\n+/, '')
  const bodyEnd = meta.indexOf('---BODYEND---')
  const headPart = meta.slice(0, bodyEnd)
  const body = meta.slice(bodyEnd + '---BODYEND---'.length).trim()
  const [full, parents, author, email, at, summary] = headPart.split(SEP)

  const numstat = await git(repoPath, ['show', '--no-color', '--numstat', '--format=', oid])
  const files = []
  let additions = 0
  let deletions = 0
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [a, d, ...rest] = line.split('\t')
    const filePath = rest.join('\t')
    const add = a === '-' ? 0 : Number(a) || 0
    const del = d === '-' ? 0 : Number(d) || 0
    additions += add
    deletions += del
    files.push({ path: filePath, additions: add, deletions: del, status: 'M' })
  }

  return {
    oid: full,
    short: (full || '').slice(0, 7),
    author,
    email,
    time: Number(at) || 0,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    refs: [],
    summary,
    body,
    files,
    additions,
    deletions,
  }
}

// ── 插件 / 自定义命令 ────────────────────────────────────────────────

function readCommandFile(file, source) {
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(arr)) return []
    return arr
      .filter((c) => c && typeof c.id === 'string' && typeof c.command === 'string')
      .map((c) => ({
        id: c.id,
        title: String(c.title || c.id),
        description: c.description ? String(c.description) : '',
        command: c.command,
        args: Array.isArray(c.args) ? c.args.map(String) : [],
        shell: !!c.shell,
        source,
      }))
  } catch {
    return []
  }
}

function allCommands(repoPath) {
  const list = [
    ...readCommandFile(path.join(repoPath, '.gitpanel', 'commands.json'), 'repo'),
    ...readCommandFile(path.join(os.homedir(), '.gitpanel', 'commands.json'), 'user'),
  ]
  const seen = new Set()
  return list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

async function listCommands(repoPath) {
  return {
    commands: allCommands(repoPath).map(({ id, title, description, source }) => ({
      id,
      title,
      description,
      source,
    })),
  }
}

async function runCommand(repoPath, id) {
  const cmd = allCommands(repoPath).find((c) => c.id === id)
  if (!cmd) throw new Error(`未知命令: ${id}`)
  const started = Date.now()
  try {
    const { stdout, stderr } = await run(cmd.command, cmd.args, {
      cwd: repoPath,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      shell: cmd.shell,
      encoding: 'utf8',
    })
    return { code: 0, stdout, stderr, durationMs: Date.now() - started }
  } catch (e) {
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout || '',
      stderr: e.stderr || String(e.message || e),
      durationMs: Date.now() - started,
    }
  }
}

// ── 远程与分支操作 ──────────────────────────────────────────────────

function toWebUrl(url) {
  let u = String(url || '').trim()
  const scp = u.match(/^git@([^:]+):(.+)$/)
  if (scp) u = `https://${scp[1]}/${scp[2]}`
  const ssh = u.match(/^ssh:\/\/git@([^/]+)\/(.+)$/)
  if (ssh) u = `https://${ssh[1]}/${ssh[2]}`
  u = u.replace(/\.git$/, '')
  return /^https?:\/\//.test(u) ? u : ''
}

async function listRemotes(repoPath) {
  let out = ''
  try {
    out = await git(repoPath, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  } catch {
    out = ''
  }
  const remotes = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const sep = line.indexOf(' ')
    if (sep < 0) continue
    const key = line.slice(0, sep)
    const url = line.slice(sep + 1).trim()
    const name = key.slice('remote.'.length, key.length - '.url'.length)
    remotes.push({ name, url, web: toWebUrl(url) })
  }
  return { remotes }
}

const SAFE_REF = /^[A-Za-z0-9._\-\/]+$/

async function checkoutRef(repoPath, ref) {
  if (!ref || ref.startsWith('-') || !SAFE_REF.test(ref)) throw new Error('非法的引用名')
  await git(repoPath, ['checkout', ref])
  const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return { ok: true, branch }
}

async function createBranch(repoPath, name, from) {
  if (!name || name.startsWith('-') || !SAFE_REF.test(name)) throw new Error('非法的分支名')
  const args = ['checkout', '-b', name]
  if (from) {
    if (from.startsWith('-') || !SAFE_REF.test(from)) throw new Error('非法的起点')
    args.push(from)
  }
  await git(repoPath, args)
  const branch = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return { ok: true, branch }
}

function send(res, code, payload) {  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(text ? JSON.parse(text) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, port: PORT })

    const body = req.method === 'POST' ? await readBody(req) : {}
    if (!body.path && url.pathname !== '/api/repos-overview') {
      return send(res, 400, { error: 'path required' })
    }

    if (url.pathname === '/api/open') return send(res, 200, await openRepo(body.path))
    if (url.pathname === '/api/graph') return send(res, 200, await graphPage(body.path, body))
    if (url.pathname === '/api/commit') return send(res, 200, await commitDetail(body.path, body.oid))
    if (url.pathname === '/api/file-diff') {
      return send(res, 200, await fileDiff(body.path, body.oid, body.file))
    }
    if (url.pathname === '/api/commands') return send(res, 200, await listCommands(body.path))
    if (url.pathname === '/api/run-command') return send(res, 200, await runCommand(body.path, body.id))
    if (url.pathname === '/api/remotes') return send(res, 200, await listRemotes(body.path))
    if (url.pathname === '/api/checkout') return send(res, 200, await checkoutRef(body.path, body.ref))
    if (url.pathname === '/api/create-branch') {
      return send(res, 200, await createBranch(body.path, body.name, body.from))
    }

    // ── 工作区 / 写操作 / 安全网 / 冲突 ──
    if (url.pathname === '/api/worktree-status') {
      return send(res, 200, await ops.worktreeStatus(body.path))
    }
    if (url.pathname === '/api/worktree-diff') {
      return send(res, 200, await ops.worktreeDiff(body.path, body.file, !!body.staged))
    }
    if (url.pathname === '/api/stage') {
      return send(res, 200, await ops.stageFiles(body.path, body.files || []))
    }
    if (url.pathname === '/api/unstage') {
      return send(res, 200, await ops.unstageFiles(body.path, body.files || []))
    }
    if (url.pathname === '/api/discard') {
      return send(res, 200, await ops.discardFiles(body.path, body.files || [], !!body.untracked))
    }
    if (url.pathname === '/api/commit-changes') {
      return send(
        res,
        200,
        await ops.commitChanges(body.path, body.message, !!body.amend, !!body.addAll),
      )
    }
    if (url.pathname === '/api/fetch') return send(res, 200, await ops.fetchRepo(body.path))
    if (url.pathname === '/api/pull') return send(res, 200, await ops.pullRepo(body.path))
    if (url.pathname === '/api/push') return send(res, 200, await ops.pushRepo(body.path, !!body.force))
    if (url.pathname === '/api/snapshots') return send(res, 200, await ops.listSnapshots(body.path))
    if (url.pathname === '/api/restore-snapshot') {
      return send(res, 200, await ops.restoreSnapshot(body.path, body.ref))
    }

    // ── 暂存 / 标签 / 分支操作 / reflog ──
    if (url.pathname === '/api/stashes') return send(res, 200, await ops.listStashes(body.path))
    if (url.pathname === '/api/stash-create') {
      return send(res, 200, await ops.createStash(body.path, body.message, !!body.includeUntracked))
    }
    if (url.pathname === '/api/stash-action') {
      return send(res, 200, await ops.stashAction(body.path, body.ref, body.action))
    }
    if (url.pathname === '/api/stash-diff') {
      return send(res, 200, await ops.stashDiff(body.path, body.ref))
    }
    if (url.pathname === '/api/tags') return send(res, 200, await ops.listTags(body.path))
    if (url.pathname === '/api/tag-create') {
      return send(res, 200, await ops.createTag(body.path, body.name, body.message, body.oid))
    }
    if (url.pathname === '/api/tag-delete') {
      return send(res, 200, await ops.deleteTag(body.path, body.name))
    }
    if (url.pathname === '/api/merge-branch') {
      return send(res, 200, await ops.mergeBranch(body.path, body.name))
    }
    if (url.pathname === '/api/delete-branch') {
      return send(res, 200, await ops.deleteBranch(body.path, body.name, !!body.force))
    }
    if (url.pathname === '/api/rename-branch') {
      return send(res, 200, await ops.renameBranch(body.path, body.from, body.to))
    }
    if (url.pathname === '/api/reflog') {
      return send(res, 200, await ops.listReflog(body.path, body.limit))
    }
    if (url.pathname === '/api/reset-to') {
      return send(res, 200, await ops.resetTo(body.path, body.oid, body.mode))
    }

    // ── 工作树 ──
    if (url.pathname === '/api/worktrees') return send(res, 200, await ops.listWorktrees(body.path))
    if (url.pathname === '/api/worktree-add') {
      return send(res, 200, await ops.addWorktree(body.path, body))
    }
    if (url.pathname === '/api/worktree-remove') {
      return send(res, 200, await ops.removeWorktree(body.path, body.target, !!body.force))
    }
    if (url.pathname === '/api/worktree-prune') {
      return send(res, 200, await ops.pruneWorktrees(body.path))
    }

    // ── 文件历史 / Blame / 体检 ──
    if (url.pathname === '/api/file-history') {
      return send(res, 200, await ops.fileHistory(body.path, body.file, body.limit))
    }
    if (url.pathname === '/api/blame') {
      return send(res, 200, await ops.blameFile(body.path, body.file, body.max))
    }
    if (url.pathname === '/api/repo-health') {
      return send(res, 200, await ops.repoHealth(body.path))
    }

    // ── 工作树元数据 / 多仓库看板 ──
    if (url.pathname === '/api/worktree-meta-list') {
      return send(res, 200, await ops.worktreeMetaList(body.path))
    }
    if (url.pathname === '/api/worktree-meta-set') {
      return send(res, 200, await ops.worktreeMetaSet(body.path, body.wtPath, body.agent, body.note, body.task))
    }
    if (url.pathname === '/api/worktree-meta-touch') {
      return send(res, 200, await ops.worktreeMetaTouch(body.path, body.wtPath))
    }
    if (url.pathname === '/api/repos-overview') {
      return send(res, 200, await ops.reposOverview(body.paths))
    }
    if (url.pathname === '/api/clone') {
      return send(res, 200, await ops.cloneRepo(body.url, body.target))
    }
    if (url.pathname === '/api/git-identity') {
      return send(res, 200, await ops.gitIdentity())
    }

    // ── 交互式 rebase ──
    if (url.pathname === '/api/rebase-preview') {
      return send(res, 200, await ops.rebasePreview(body.path, body.base))
    }
    if (url.pathname === '/api/rebase-start') {
      return send(res, 200, await ops.rebaseStart(body.path, body.base, body.steps))
    }
    if (url.pathname === '/api/rebase-status') {
      return send(res, 200, await ops.rebaseStatus(body.path))
    }
    if (url.pathname === '/api/rebase-action') {
      return send(res, 200, await ops.rebaseAction(body.path, body.action))
    }
    if (url.pathname === '/api/conflict') {
      return send(res, 200, await conflict.conflictDetail(body.path, body.file))
    }
    if (url.pathname === '/api/resolve') {
      return send(res, 200, await conflict.resolveConflict(body.path, body.file, body.content ?? ''))
    }
    if (url.pathname === '/api/resolve-side') {
      return send(res, 200, await conflict.resolveSide(body.path, body.file, body.side))
    }

    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 500, { error: String(e?.stderr || e?.message || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gitpanel] dev bridge listening on http://127.0.0.1:${PORT}`)
})
