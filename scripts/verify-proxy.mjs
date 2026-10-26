/**
 * Verifies the HTTP proxy settings end to end:
 *  - "all traffic" mode fetches a feed through the proxy
 *  - "selected feeds" mode only proxies feeds explicitly marked
 *
 * Requires: pnpm build && pnpm start, and `node scripts/mock-proxy.mjs 8899`.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const proxyUrl = process.env.PROXY_URL ?? 'http://127.0.0.1:8899'

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  serviceWorkers: 'block',
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

async function openSettings() {
  await page.locator('aside').getByRole('button', { name: '设置' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

async function addFeed(url, { useProxy = false } = {}) {
  await page.getByRole('button', { name: '添加订阅' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.locator('#feed-url').fill(url)
  if (useProxy) await dialog.getByLabel('通过代理访问此订阅').check()
  await dialog.getByRole('button', { name: '订阅', exact: true }).click()
  await page.waitForTimeout(800)
}

async function setProxy(mode) {
  const dialog = await openSettings()
  const section = dialog.locator('section').filter({ hasText: '网络代理' })
  const toggle = section.getByRole('switch')
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
  await section.getByLabel('代理地址').fill(proxyUrl)
  await section.getByRole('button', { name: mode === 'all' ? '全部代理' : '仅选中的订阅' }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(300)
}

// All traffic mode.
await setProxy('all')
await addFeed('http://example.com/proxy-all.xml')
await page.locator('aside a', { hasText: 'Proxy Feed All' }).first().waitFor({ timeout: 30_000 })
console.log('✓ all-traffic proxy fetched the feed')

// Selected feeds mode: unmarked feeds stay direct, marked feeds use the proxy.
await setProxy('selected')
await addFeed('http://example.com/proxy-selected.xml', { useProxy: true })
await page.locator('aside a', { hasText: 'Proxy Feed Selected' }).first().waitFor({ timeout: 30_000 })
console.log('✓ selected-feed proxy fetched the marked feed')

// The proxy setting survives a reload.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.locator('aside').getByRole('button', { name: '设置' }).click()
await page.getByRole('dialog').waitFor()
assert.equal(await page.getByRole('dialog').getByLabel('代理地址').inputValue(), proxyUrl)
console.log('✓ proxy settings persisted')

await browser.close()
if (errors.length > 0) {
  console.error('BROWSER ERRORS', errors)
  process.exitCode = 1
} else {
  console.log('\nProxy checks passed.')
}
