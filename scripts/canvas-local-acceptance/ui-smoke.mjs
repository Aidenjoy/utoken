#!/usr/bin/env node
/**
 * 智能画布 UI 冒烟（headless Chrome + CDP，零依赖）
 *
 * 覆盖任务书要求的点击路径：
 *   侧边栏「智能画布」→ 项目列表 → 新建画布 → 编辑器 → 上传图片（生成图层）
 *   → 选择工具 → 自动保存 → 刷新恢复 → 导出 PNG
 *
 * 全部请求打在本机 mock 上游与本地存储替身上，不触碰真实模型渠道与云存储。
 *
 * 用法：
 *   node scripts/canvas-local-acceptance/ui-smoke.mjs --binary /tmp/newapi_canvas
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MODEL = 'doubao-seedream-4-0-250828'
const ROOT_USER = 'canvasroot'
const ROOT_PASS = 'CanvasRoot123'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
  return new Promise((res) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => res(port))
    })
  })
}

/** 生成纯色 PNG（与 mock_upstream.py 的输出等价） */
function solidPng(width, height) {
  const crcTable = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(tag), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(width * 3 + 1, 0)
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = 200
    row[2 + x * 3] = 120
    row[3 + x * 3] = 80
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, 6)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message}`))
        else res(msg.result)
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    this.id += 1
    const id = this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 30000)
    })
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) {
      throw new Error(exceptionDetails.text || '页面脚本执行失败')
    }
    return result.value
  }

  async waitFor(expression, timeout = 15000, label = expression) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return true
      } catch {
        /* 导航过程中执行上下文会短暂失效 */
      }
      await sleep(250)
    }
    throw new Error(`等待超时: ${label}`)
  }

  async goto(url) {
    await this.send('Page.navigate', { url })
  }
}

async function waitHttp(url, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(300)
  }
  throw new Error(`等待服务就绪超时: ${url}`)
}

function parseArgs() {
  const args = { binary: '/tmp/newapi_canvas', clean: false }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--binary') args.binary = argv[i + 1]
    if (argv[i] === '--clean') args.clean = true
  }
  return args
}

async function main() {
  const args = parseArgs()
  if (!existsSync(args.binary)) {
    console.error(`找不到服务端二进制：${args.binary}`)
    return 2
  }
  if (!existsSync(CHROME)) {
    console.error(`找不到 Chrome：${CHROME}`)
    return 2
  }

  const workdir = mkdtempSync(join(tmpdir(), 'canvas_ui_'))
  const storage = join(workdir, 'storage')
  const downloads = join(workdir, 'downloads')
  mkdirSync(storage, { recursive: true })
  mkdirSync(downloads, { recursive: true })
  const sourcePath = join(workdir, 'source.png')
  writeFileSync(sourcePath, solidPng(512, 512))

  const mockPort = await freePort()
  const appPort = await freePort()
  const cdpPort = await freePort()

  const mock = spawn('python3', [resolve(HERE, 'mock_upstream.py'), String(mockPort)], {
    stdio: 'ignore',
  })
  const app = spawn(args.binary, [], {
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(appPort),
      SQLITE_PATH: join(workdir, 'canvas.db'),
      SESSION_SECRET: 'canvas-ui-smoke-session-secret',
      CRYPTO_SECRET: 'canvas-ui-smoke-crypto-secret',
      CANVAS_IMAGE_MODEL: MODEL,
      CANVAS_RELAY_BASE: `http://127.0.0.1:${mockPort}`,
      CANVAS_MEDIAKIT_BASE_URL: `http://127.0.0.1:${mockPort}`,
      CANVAS_MEDIAKIT_API_KEY: 'mock-mediakit-key',
      CANVAS_LOCAL_STORAGE_DIR: storage,
      CANVAS_LOCAL_STORAGE_BASE: `http://127.0.0.1:${appPort}`,
      CANVAS_UPSTREAM_TIMEOUT: '30',
    },
  })
  let chrome
  try {
    await waitHttp(`http://127.0.0.1:${mockPort}/_state`)
    await waitHttp(`http://127.0.0.1:${appPort}/api/status`)
    const base = `http://127.0.0.1:${appPort}`

    // 初始化 + 登录 + 渠道（都给本地 mock）
    const api = async (path, body) => {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'New-Api-User': '1' },
        body: JSON.stringify(body ?? {}),
      })
      return res.json()
    }
    await api('/api/setup', {
      username: ROOT_USER,
      password: ROOT_PASS,
      confirmPassword: ROOT_PASS,
      SelfUseModeEnabled: true,
      DemoSiteEnabled: false,
    })
    await api('/api/channel/', {
      mode: 'single',
      channel: {
        name: 'canvas-mock-ark',
        type: 45,
        key: 'mock-ark-key',
        base_url: `http://127.0.0.1:${mockPort}`,
        models: MODEL,
        group: 'default',
        groups: ['default'],
        status: 1,
        priority: 0,
      },
    })

    chrome = spawn(
      CHROME,
      [
        '--headless=new',
        // Chrome 会往 ~/Library 写 RLZ/组件缓存：把 HOME 指到临时目录，避免动到用户目录
        `--user-data-dir=${join(workdir, 'chrome-profile')}`,
        '--disable-features=Translate,OptimizationHints,MediaRouter',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-sync',
        '--no-service-autorun',
        `--remote-debugging-port=${cdpPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--lang=zh-CN',
        '--window-size=1440,900',
        'about:blank',
      ],
      { stdio: 'ignore', env: { ...process.env, HOME: workdir } }
    )
    await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`)

    const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, {
      method: 'PUT',
    }).then((r) => r.json())
    const cdp = await Cdp.connect(created.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloads,
    })

    // 登录（页面上下文内 fetch，鉴权 cookie 由浏览器保存）
    await cdp.goto(`${base}/sign-in`)
    await cdp.waitFor('document.readyState === "complete"', 20000, '登录页加载')
    const login = await cdp.evaluate(`
      fetch('/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '${ROOT_USER}', password: '${ROOT_PASS}' })
      }).then((r) => r.json()).then((d) => Boolean(d && d.success))
    `)
    check('浏览器内登录成功', login === true)

    // 1) 侧边栏菜单入口
    await cdp.goto(`${base}/canvas`)
    await cdp.waitFor(
      'document.querySelector(\'a[href="/canvas"]\') !== null',
      25000,
      '侧边栏出现智能画布入口'
    )
    const menuText = await cdp.evaluate(`(() => {
      const link = document.querySelector('a[href="/canvas"]');
      return link ? link.textContent.trim() : '';
    })()`)
    check('侧边栏「智能画布」入口可见', menuText.length > 0, `文本=${menuText}`)

    // 2) 点击菜单进入项目列表
    await cdp.evaluate(`document.querySelector('a[href="/canvas"]').click()`)
    await cdp.waitFor(
      'location.pathname === "/canvas" || location.pathname === "/canvas/"',
      15000,
      '路由跳转到 /canvas'
    )
    await cdp.waitFor(
      '[...document.querySelectorAll("button")].some((b) => b.textContent.includes("新建画布"))',
      15000,
      '列表页出现「新建画布」按钮'
    )
    check('从菜单进入画布项目列表', true)

    // 3) 新建画布
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新建画布'));
      btn && btn.click();
      return Boolean(btn);
    })()`)
    await cdp.waitFor('document.querySelector("#canvas-title") !== null', 10000, '新建对话框')
    await cdp.evaluate(`(() => {
      const input = document.querySelector('#canvas-title');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'UI 冒烟画布');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '创建');
      btn && btn.click();
      return Boolean(btn);
    })()`)
    await cdp.waitFor('location.pathname.startsWith("/canvas/")', 20000, '进入编辑器')
    await cdp.waitFor('document.querySelector("input[type=file]") !== null', 15000, '编辑器加载')
    check('新建画布后进入编辑器', true)

    // 4) 工具面板列出 10 个工具
    const toolCount = await cdp.evaluate(`(() => {
      const aside = document.querySelector('aside');
      if (!aside) return 0;
      const labels = ['文生图','单图参考生成','多图参考生成','涂抹消除','提示词局部编辑','参考图局部编辑','智能扩图','主体分割 / 透明抠图','普通超分','生成式超分'];
      return labels.filter((l) => aside.textContent.includes(l)).length;
    })()`)
    check('工具面板展示 10 个工具', toolCount === 10, `匹配 ${toolCount} 个`)

    // 5) 上传图片 → 生成图层
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type=file]',
    })
    await cdp.send('DOM.setFileInputFiles', { files: [sourcePath], nodeId })
    await cdp.waitFor('document.querySelectorAll("[data-layer-id]").length >= 1', 30000, '图层出现')
    check('上传图片后生成画布图层', true)

    // 6) 选择工具（涂抹消除）
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('aside button')].find((b) => b.textContent.includes('涂抹消除'));
      btn && btn.click();
      return Boolean(btn);
    })()`)
    await cdp.waitFor(
      '[...document.querySelectorAll("aside *")].some((el) => el.textContent === "蒙版")',
      10000,
      '工具参数面板显示蒙版区域'
    )
    check('切换工具后展示蒙版与参数（含不可用原因的位置）', true)

    // 7) 自动保存
    await cdp.waitFor(
      '[...document.querySelectorAll("span")].some((s) => s.textContent.includes("已保存"))',
      25000,
      '自动保存完成'
    )
    check('文档自动保存成功', true)

    // 8) 刷新恢复
    await cdp.send('Page.reload')
    await cdp.waitFor('document.querySelectorAll("[data-layer-id]").length >= 1', 30000, '刷新后图层恢复')
    check('刷新后图层与编辑状态恢复', true)

    // 9) 导出 PNG
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '导出');
      btn && btn.click();
      return Boolean(btn);
    })()`)
    await sleep(600)
    await cdp.evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"], button, div')].find(
        (el) => el.textContent.trim() === '导出为 PNG'
      );
      item && item.click();
      return Boolean(item);
    })()`)
    let exported = null
    for (let i = 0; i < 40; i += 1) {
      const files = readdirSync(downloads).filter((f) => f.endsWith('.png'))
      if (files.length > 0) {
        exported = files[0]
        break
      }
      await sleep(300)
    }
    check('导出 PNG 生成文件', Boolean(exported), exported ? `文件=${exported}` : '未检测到下载文件')
  } finally {
    chrome?.kill('SIGKILL')
    app.kill('SIGTERM')
    mock.kill('SIGTERM')
    // 默认保留临时目录（含 Chrome profile、下载的导出文件），清理需显式 --clean
    if (args.clean) {
      const { rmSync } = await import('node:fs')
      rmSync(workdir, { recursive: true, force: true })
      console.log(`[clean] 已按 --clean 清理 ${workdir}`)
    } else {
      console.log(`[keep] 临时目录 ${workdir}`)
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n===== UI 汇总 =====')
  console.log(`通过 ${results.length - failed.length} / ${results.length} 项`)
  failed.forEach((f) => console.log(`  FAIL · ${f.name} — ${f.detail}`))
  return failed.length === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
