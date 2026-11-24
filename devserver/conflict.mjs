// 冲突读取与解决：解析工作区里的冲突标记，支持块级取舍。
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024

async function gitRaw(repo, args) {
  const { stdout } = await run('git', ['-C', repo, ...args], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    encoding: 'buffer',
  })
  return stdout
}

/**
 * 解析 conflict markers：
 *   <<<<<<< ours
 *   ...
 *   ||||||| base      (diff3 才有)
 *   ...
 *   =======
 *   ...
 *   >>>>>>> theirs
 */
export function parseConflictBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let buf = []
  let i = 0

  const flush = () => {
    if (buf.length) {
      blocks.push({ type: 'text', text: buf.join('\n') })
      buf = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('<<<<<<<')) {
      flush()
      const oursLabel = line.replace(/^<{7}\s*/, '').trim()

      i++
      const ours = []
      while (i < lines.length && !lines[i].startsWith('=======') && !lines[i].startsWith('|||||||')) {
        ours.push(lines[i])
        i++
      }

      let base = null
      if (lines[i] && lines[i].startsWith('|||||||')) {
        i++
        const b = []
        while (i < lines.length && !lines[i].startsWith('=======')) {
          b.push(lines[i])
          i++
        }
        base = b.join('\n')
      }

      if (lines[i] && lines[i].startsWith('=======')) i++

      const theirs = []
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirs.push(lines[i])
        i++
      }
      const theirsLabel = lines[i] ? lines[i].replace(/^>{7}\s*/, '').trim() : ''
      if (i < lines.length) i++

      blocks.push({
        type: 'conflict',
        oursLabel,
        theirsLabel,
        ours: ours.join('\n'),
        theirs: theirs.join('\n'),
        base,
      })
    } else {
      buf.push(line)
      i++
    }
  }
  flush()
  return blocks
}

export function composeResolution(blocks, choices) {
  return blocks
    .map((b, idx) => {
      if (b.type !== 'conflict') return b.text
      const c = choices[idx] || 'ours'
      if (c === 'theirs') return b.theirs
      if (c === 'both') return `${b.ours}\n${b.theirs}`
      if (c === 'none') return ''
      return b.ours
    })
    .join('\n')
}

async function stageContent(repo, file, n) {
  try {
    const buf = await gitRaw(repo, ['show', `:${n}:${file}`])
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

export async function conflictDetail(repo, file) {
  const base = await stageContent(repo, file, 1)
  const ours = await stageContent(repo, file, 2)
  const theirs = await stageContent(repo, file, 3)

  let working = ''
  try {
    working = fs.readFileSync(path.join(repo, file), 'utf8')
  } catch {
    working = ''
  }

  const blocks = parseConflictBlocks(working)
  return {
    path: file,
    base,
    ours,
    theirs,
    working,
    hasMarkers: blocks.some((b) => b.type === 'conflict'),
    blocks,
  }
}

export async function resolveConflict(repo, file, content) {
  const abs = path.join(repo, file)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
  await run('git', ['-C', repo, 'add', '--', file], { windowsHide: true })
  return { ok: true }
}

/** 整文件采用某一侧 */
export async function resolveSide(repo, file, side) {
  const stage = side === 'theirs' ? 3 : 2
  const content = await stageContent(repo, file, stage)
  return resolveConflict(repo, file, content)
}
