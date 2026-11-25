// 开发期视觉回归工具：通过 Chrome DevTools Protocol 打开页面、执行动作并截图。
// 前置：先起一个带 --remote-debugging-port=9222 的 Chromium（Edge 即可）。
//
// 用法：
//   node scripts/shot.mjs <url> <out.png> [action ...]
// 动作：
//   wait:1200            等待毫秒
//   click:设置            点击文本包含「设置」的第一个按钮
//   key:Control+k        派发组合键
//   eval:<js>            执行任意 JS
import fs from 'node:fs/promises'

const [, , url, out, ...actions] = process.argv
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url|-> <out.png> [action ...]')
  process.exit(2)
}

const CDP_PORT = process.env.CDP_PORT || '9222'
const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('没有可用的 page target')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})

let nextId = 1
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
})

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1680,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})
if (url !== '-') {
  await send('Page.navigate', { url })
  await sleep(2600)
}

for (const action of actions) {
  const idx = action.indexOf(':')
  const kind = idx < 0 ? action : action.slice(0, idx)
  const arg = idx < 0 ? '' : action.slice(idx + 1)

  if (kind === 'wait') {
    await sleep(Number(arg) || 500)
  } else if (kind === 'click') {
    const ok = await evaluate(`(() => {
      const all = [...document.querySelectorAll('button, a, [role=button]')]
        .filter((b) => (b.textContent || '').trim().includes(${JSON.stringify(arg)}));
      if (!all.length) return false;
      // 取文本最短的（最具体的）那个，避免点到包含同样文字的大容器
      all.sort((a, b) => a.textContent.trim().length - b.textContent.trim().length);
      all[0].click();
      return true;
    })()`)
    if (!ok) console.warn(`[shot] 未找到可点击元素: ${arg}`)
    await sleep(400)
  } else if (kind === 'key') {
    const parts = arg.split('+')
    const key = parts.pop() ?? ''
    const isCtrl = parts.some((m) => /^(control|ctrl)$/i.test(m))
    const isShift = parts.some((m) => /^shift$/i.test(m))
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: ${isCtrl}, shiftKey: ${isShift}, bubbles: true }))`,
    )
    await sleep(400)
  } else if (kind === 'eval') {
    const r = await evaluate(arg)
    if (r !== undefined && r !== null) console.log('[eval]', r)
    await sleep(300)
  }
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(out, Buffer.from(shot.data, 'base64'))
console.log(`saved ${out}`)
ws.close()
