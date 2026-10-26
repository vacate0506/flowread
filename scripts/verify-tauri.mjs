/**
 * End-to-end check inside the running Tauri desktop app (WebView2).
 *
 * Start the app with WebView2 remote debugging enabled first:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   apps/desktop/src-tauri/target/debug/flowread.exe
 *
 * Then (with scripts/mock-ai.mjs running on :9999):
 *   node scripts/verify-tauri.mjs
 */
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const cdp = process.env.TAURI_CDP ?? 'http://127.0.0.1:9222'
const mockAi = process.env.MOCK_AI ?? 'http://127.0.0.1:9999/v1'
const opml = resolve('scripts/fixtures/test-feeds.opml')

const browser = await chromium.connectOverCDP(cdp)
const page = browser.contexts().flatMap((context) => context.pages())[0]
if (!page) throw new Error('没有找到 Tauri WebView 页面，请确认应用已启动并开启远程调试')

const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
assert.equal(await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__)), true, 'should run inside Tauri')

if ((await page.locator('article').count()) === 0) {
  await page.locator('input[type="file"]').first().setInputFiles(opml)
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 180_000 })
  await page.waitForTimeout(2500)
}
console.log('✓ feeds imported through Rust fetch:', await page.locator('aside a[href^="/feed/"]').count())
await page.screenshot({ path: 'docs/screenshots/20-tauri-window.png' })

await page.locator('aside').getByRole('button', { name: '设置' }).click()
const settings = page.getByRole('dialog')
await settings.waitFor()
// The server settings only apply to the web build and should be hidden here.
assert.equal(await settings.getByText('服务地址').count(), 0, 'server section must be hidden in Tauri')
await settings.getByLabel('服务商').selectOption({ label: '自定义 (OpenAI 兼容)' })
await settings.getByPlaceholder('https://api.deepseek.com/v1').fill(mockAi)
await settings.getByPlaceholder(/sk-…/).fill('sk-tauri-test')
await settings.getByRole('button', { name: '获取模型' }).click()
await settings.locator('option[value="mock-gpt"]').waitFor({ state: 'attached', timeout: 20_000 })
await settings.getByLabel('模型', { exact: true }).selectOption('mock-gpt')
await settings.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(300)

await page.locator('aside a', { hasText: '阮一峰的网络日志' }).first().click()
await page.waitForTimeout(600)
const item = page.locator('article').first()
await item.hover()
await page.waitForTimeout(250)
await item.getByRole('button', { name: '摘要帖子' }).click()
await page.getByText('核心观点').first().waitFor({ timeout: 40_000 })
await page.waitForTimeout(800)
await page.screenshot({ path: 'docs/screenshots/21-tauri-summary.png' })
console.log('✓ AI summary streamed through the Rust channel')

assert.equal(errors.length, 0, `Tauri console should be clean: ${errors.join('; ')}`)
await browser.close()
console.log('\nTauri checks passed (SQLite persists across restarts: verify manually by relaunching).')
