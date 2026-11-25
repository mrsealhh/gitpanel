#!/usr/bin/env node
// 按平台选择 Rust 编译产物目录，再执行 cargo / tauri。
// - Windows 本机开发：默认重定向到 C 盘 SSD（可用 CARGO_TARGET_DIR 覆盖）
// - macOS / Linux：不设置，沿用 Cargo 默认的 target/，保证跨平台可编译
import { spawn } from 'node:child_process'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: node scripts/with-cargo-target.mjs <cargo|tauri> [...args]')
  process.exit(2)
}

if (process.platform === 'win32' && !process.env.CARGO_TARGET_DIR) {
  process.env.CARGO_TARGET_DIR = 'C:\\cargo-target\\gitpanel'
}

/** Windows 下 npm 脚本里的 cargo / tauri 是 .exe / .cmd，统一交给 cmd 解析 */
function winQuote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

const child =
  process.platform === 'win32'
    ? spawn(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', [command, ...args].map(winQuote).join(' ')],
        { stdio: 'inherit', env: process.env },
      )
    : spawn(command, args, { stdio: 'inherit', env: process.env })

child.on('error', (err) => {
  console.error(`[gitpanel] 启动 ${command} 失败: ${err.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
