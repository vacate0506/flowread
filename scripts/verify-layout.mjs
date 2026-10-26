/**
 * Desktop layout + real drag-and-drop check:
 *  - long articles expose a back-to-top control
 *  - hide / restore the subscription sidebar and article list
 *  - layout preferences survive a reload
 *  - dragging a feed with the mouse reorders it
 *
 *   pnpm build && pnpm start
 *   node scripts/verify-layout.mjs
 */
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const opml = resolve('scripts/fixtures/test-feeds.opml')
const outDir = resolve('docs/screenshots')

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  serviceWorkers: 'block',
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(base, { waitUntil: 'domcontentloaded' })
if ((await page.locator('article').count()) === 0) {
  await page.locator('input[type="file"]').first().setInputFiles(opml)
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 120_000 })
  await page.waitForTimeout(1500)
}
await page.locator('aside a', { hasText: '阮一峰的网络日志' }).first().click()
await page.waitForTimeout(600)
await page.locator('article').first().click()
await page.waitForTimeout(700)

// Long articles expose a floating back-to-top control once scrolled.
assert.equal(await page.getByRole('button', { name: '返回顶部' }).count(), 0)
const scrollTop = await page.evaluate(() => {
  const heading = [...document.querySelectorAll('h1')].find(
    (node) => node.offsetParent && node.closest('.overflow-y-auto'),
  )
  const container = heading?.closest('.overflow-y-auto')
  if (!container) return -1
  container.scrollTop = 900
  container.dispatchEvent(new Event('scroll', { bubbles: true }))
  return container.scrollTop
})
assert.ok(scrollTop > 0, 'reader should be scrollable')
await page.getByRole('button', { name: '返回顶部' }).waitFor({ state: 'visible', timeout: 3000 })
await page.getByRole('button', { name: '返回顶部' }).click()
await page.waitForTimeout(800)
assert.ok(
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h1')].find(
      (node) => node.offsetParent && node.closest('.overflow-y-auto'),
    )
    const container = heading?.closest('.overflow-y-auto')
    return (container?.scrollTop ?? -1) < 10
  }),
  'back-to-top should scroll the article to the start',
)
console.log('✓ article back-to-top')

const sidebar = page.locator('aside')
await page.getByRole('button', { name: '收起侧栏' }).click()
await page.waitForTimeout(300)
assert.equal(await sidebar.isVisible(), false, 'sidebar should be hidden')
assert.ok(
  await page.getByRole('button', { name: '展开侧栏' }).first().isVisible(),
  'a show-sidebar control should remain',
)

await page.getByRole('button', { name: '收起文章列表' }).first().click()
await page.waitForTimeout(400)
assert.ok(
  await page.getByRole('button', { name: '展开文章列表' }).first().isVisible(),
  'a show-list control should remain',
)
await page.screenshot({ path: `${outDir}/23-panes-hidden.png` })
console.log('✓ hide sidebar and article list')

await page.getByRole('button', { name: '展开文章列表' }).first().click()
await page.getByRole('button', { name: '展开侧栏' }).first().click()
await page.waitForTimeout(400)
assert.ok(await sidebar.isVisible(), 'sidebar should be restored')
console.log('✓ restore both panes')

const order = () =>
  page
    .locator('aside a[href^="/feed/"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))
const before = (await order()).join('|')
await page
  .locator('aside a', { hasText: '月球背面' })
  .first()
  .dragTo(page.locator('aside a', { hasText: '奇客Solidot' }).first())
await page.waitForTimeout(800)
const after = (await order()).join('|')
assert.notEqual(after, before, 'drag should change the feed order')
assert.ok(after.indexOf('月球背面') < after.indexOf('奇客'), 'feed should be inserted before the target')
console.log('✓ real mouse drag reorders subscriptions')

await page.getByRole('button', { name: '收起侧栏' }).click()
await page.getByRole('button', { name: '收起文章列表' }).first().click()
await page.waitForTimeout(300)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
assert.ok(
  await page.getByRole('button', { name: '展开侧栏' }).first().isVisible(),
  'sidebar hidden state should survive reload',
)
assert.ok(
  await page.getByRole('button', { name: '展开文章列表' }).first().isVisible(),
  'list hidden state should survive reload',
)
console.log('✓ layout preferences persist')

await browser.close()
if (errors.length > 0) {
  console.error('BROWSER ERRORS', errors)
  process.exitCode = 1
} else {
  console.log('\nLayout checks passed. Screenshot: 23-panes-hidden.png')
}
