// 开发期数据桥：直接调用本机 git，向前端提供与 Rust 内核完全一致的契约。
// 用途：前端可在浏览器里独立开发、独立压测，不必等 Rust 工具链。
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { layout } from './layout.mjs'

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

function send(res, code, payload) {
  const body = JSON.stringify(payload)
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
    if (!body.path) return send(res, 400, { error: 'path required' })

    if (url.pathname === '/api/open') return send(res, 200, await openRepo(body.path))
    if (url.pathname === '/api/graph') return send(res, 200, await graphPage(body.path, body))
    if (url.pathname === '/api/commit') return send(res, 200, await commitDetail(body.path, body.oid))
    if (url.pathname === '/api/file-diff') {
      return send(res, 200, await fileDiff(body.path, body.oid, body.file))
    }

    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 500, { error: String(e?.stderr || e?.message || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gitpanel] dev bridge listening on http://127.0.0.1:${PORT}`)
})
