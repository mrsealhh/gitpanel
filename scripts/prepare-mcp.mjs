// 把 MCP 服务端编译产物搬进安装包。
//
// Tauri 的 externalBin 需要在打包前就存在「带 target triple 后缀」的文件，
// 而 beforeBuildCommand 正好在主程序 cargo build 之前执行，所以在这里
// 先 cargo build -p gitpanel-mcp，再按 triple 命名复制一份。
// Windows 带 .exe，macOS / Linux 不带扩展名。
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const isWin = process.platform === 'win32'
const ext = isWin ? '.exe' : ''

const shell = (cmd, args) =>
  spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: isWin })

// 用 rustc 的 host triple，避免硬编码；交叉编译时可用 TAURI_TARGET_TRIPLE 覆盖
const hostOut = shell('rustc', ['-vV'])
const hostTriple =
  (hostOut.stdout || '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('host:'))
    ?.slice(5)
    .trim() || ''
const triple = process.env.TAURI_TARGET_TRIPLE || hostTriple || 'x86_64-pc-windows-msvc'

const build = spawnSync('cargo', ['build', '--release', '-p', 'gitpanel-mcp'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
})
if (build.status !== 0) {
  console.error('[prepare-mcp] cargo build 失败，跳过打包 MCP 服务端')
  process.exit(1)
}

const targetDir = process.env.CARGO_TARGET_DIR || (isWin ? 'C:/cargo-target/gitpanel' : 'target')
const src = path.resolve(root, targetDir, 'release', `gitpanel-mcp${ext}`)
if (!existsSync(src)) {
  console.error(`[prepare-mcp] 找不到 ${src}`)
  process.exit(1)
}

const outDir = path.join(root, 'src-tauri', 'binaries')
mkdirSync(outDir, { recursive: true })
const dst = path.join(outDir, `gitpanel-mcp-${triple}${ext}`)
copyFileSync(src, dst)
if (!isWin) {
  // 保证可执行权限（copyFileSync 会带上，这里再显式设一次）
  spawnSync('chmod', ['+x', dst])
}
console.log(`[prepare-mcp] ${dst}`)
