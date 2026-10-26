/**
 * Subscription management checkbox/bulk-action check.
 *
 *   pnpm build && pnpm start
 *   node scripts/verify-subscriptions.mjs
 */
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const opml = resolve('scripts/fixtures/test-feeds.opml')
const outDir = resolve('docs/screenshots')

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(base, { waitUntil: 'domcontentloaded' })
if ((await page.locator('article').count()) === 0) {
  await page.locator('input[type="file"]').first().setInputFiles(opml)
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 120_000 })
  await page.waitForTimeout(1500)
}
await page.locator('aside').getByRole('link', { name: /订阅源/ }).click()
await page.waitForTimeout(500)

const boxes = page.getByRole('checkbox')
assert.ok((await boxes.count()) >= 4, 'expected select-all and per-feed checkboxes')
await boxes.nth(1).check()
await boxes.nth(2).check()
await page.getByText('2 项已选中').waitFor({ timeout: 3000 })
console.log('✓ selecting feeds shows the bulk action bar')

await boxes.nth(0).check()
const checked = await page.locator('input[type="checkbox"]:checked').count()
assert.ok(checked >= 7, 'select all should check every visible feed')
const closeToast = page.getByRole('button', { name: '关闭' })
if (await closeToast.count()) await closeToast.last().click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/25-subscriptions-checkbox.png` })
console.log('✓ select all works')

await page.getByRole('button', { name: '清空' }).click()
assert.equal(await page.getByText(/项已选中/).count(), 0)
console.log('✓ clear selection')

await boxes.nth(1).check()
await boxes.nth(2).check()
await page.getByRole('button', { name: '取消订阅' }).click()
const dialog = page.getByRole('dialog')
await dialog.waitFor()
assert.ok(
  (await dialog.innerText()).includes('确定取消订阅选中的 2 个订阅源？'),
  'confirmation message should be visible',
)
assert.ok(
  !(await dialog.innerText()).includes('tauri.localhost'),
  'confirmation must not expose the webview origin',
)
await page.screenshot({ path: `${outDir}/26-confirm-dialog.png` })
await dialog.getByRole('button', { name: '取消', exact: true }).click()
await page.waitForTimeout(250)
assert.equal(await page.getByRole('dialog').count(), 0)
console.log('✓ custom confirmation dialog (no tauri.localhost)')

await page.getByRole('button', { name: '移动订阅' }).click()
await page.locator('button', { hasText: '科技' }).last().click()
const movedToast = page.getByRole('status').filter({ hasText: '已移动' }).last()
await movedToast.waitFor({ timeout: 10_000 })
const toastBox = await movedToast.boundingBox()
assert.ok(toastBox && toastBox.y < 200, 'toast should be anchored near the top')
await page.screenshot({ path: `${outDir}/27-toast-top.png` })
console.log('✓ bulk move works; toast appears at the top')

await browser.close()
if (errors.length > 0) {
  console.error('BROWSER ERRORS', errors)
  process.exitCode = 1
} else {
  console.log('\nSubscription checkbox checks passed. Screenshots: 25–27.')
}
