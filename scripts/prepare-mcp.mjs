// 把 MCP 服务端编译产物搬进安装包。
//
// Tauri 的 externalBin 需要在打包前就存在「带 target triple 后缀」的文件，
// 而 beforeBuildCommand 正好在主程序 cargo build 之前执行，所以在这里
// 先 cargo build -p gitpanel-mcp，再按 triple 命名复制一份。
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'src-tauri', 'binaries')

// 用 rustc 的 host triple，避免硬编码（CI 是 x86_64-pc-windows-msvc，本地一般也是）
const hostOut = spawnSync('rustc', ['-vV'], { encoding: 'utf8', shell: process.platform === 'win32' })
const triple =
  (hostOut.stdout || '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('host:'))
    ?.slice(5)
    .trim() || 'x86_64-pc-windows-msvc'

const targetDir = process.env.CARGO_TARGET_DIR || 'C:/cargo-target/gitpanel'
const dst = path.join(outDir, `gitpanel-mcp-${triple}.exe`)

const build = spawnSync('cargo', ['build', '--release', '-p', 'gitpanel-mcp'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (build.status !== 0) {
  console.error('[prepare-mcp] cargo build 失败，跳过打包 MCP 服务端')
  process.exit(1)
}

const src = path.join(targetDir, 'release', 'gitpanel-mcp.exe')
if (!existsSync(src)) {
  console.error(`[prepare-mcp] 找不到 ${src}`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
copyFileSync(src, dst)
console.log(`[prepare-mcp] ${dst}`)
