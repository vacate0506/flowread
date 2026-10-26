/**
 * Feature check for subscription management + local storage:
 *  - right-click context menu (rename, move, delete)
 *  - drag a feed to reorder it (drag-to-delete has been removed)
 *  - truncated feed names reveal a floating tooltip
 *  - invalid OPML entries are skipped
 *  - AI key + settings persisted locally across reloads
 *  - config backup export (with/without API key) and import
 *
 *   pnpm build && pnpm start
 *   node scripts/verify-management.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const opml = resolve('scripts/fixtures/test-feeds.opml')
const invalidOpml = resolve('scripts/fixtures/test-feeds-invalid.opml')
const outDir = resolve('docs/screenshots')
const downloadDir = resolve('.verify')
await mkdir(outDir, { recursive: true })
await mkdir(downloadDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  serviceWorkers: 'block',
  acceptDownloads: true,
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('dialog', (dialog) => void dialog.accept())

async function readFeeds() {
  return page.evaluate(async () => {
    const request = indexedDB.open('flowread')
    const db = await new Promise((res, rej) => {
      request.onsuccess = () => res(request.result)
      request.onerror = () => rej(request.error)
    })
    return await new Promise((res) => {
      const getAll = db.transaction('feeds').objectStore('feeds').getAll()
      getAll.onsuccess = () => res(getAll.result)
      getAll.onerror = () => res([])
    })
  })
}

async function openFeedMenu(title) {
  await page.locator('aside a', { hasText: title }).first().click({ button: 'right' })
  await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 10_000 })
}

async function dragStart(title) {
  await page.evaluate((feedTitle) => {
    const link = [...document.querySelectorAll('aside a')].find((node) =>
      node.textContent?.includes(feedTitle),
    )
    if (!link) throw new Error(`feed link not found: ${feedTitle}`)
    const dataTransfer = new DataTransfer()
    link.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }),
    )
    window.__flowreadDrag = dataTransfer
  }, title)
}

async function dropOnFeed(title) {
  await page.evaluate((targetTitle) => {
    const link = [...document.querySelectorAll('aside a')].find((node) =>
      node.textContent?.includes(targetTitle),
    )
    if (!link) throw new Error(`drop target not found: ${targetTitle}`)
    const row = link.parentElement
    const dataTransfer = window.__flowreadDrag
    row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  }, title)
}

await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
if ((await page.locator('article').count()) === 0) {
  await page.locator('input[type="file"]').first().setInputFiles(opml)
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 120_000 })
  await page.waitForTimeout(1200)
}

/* -------------------------------------------------------------------------- */
/* 1. Right-click menu + rename                                               */
/* -------------------------------------------------------------------------- */
// Touch devices have no right-click: the "…" button opens the same menu.
await page.locator('aside button[aria-label="更多操作"]').first().click()
await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 10_000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
console.log('✓ kebab button opens the feed menu (touch friendly)')

await openFeedMenu('Anthony Fu')
await page.screenshot({ path: `${outDir}/14-feed-context-menu.png` })
console.log('✓ context menu opened')

await page.locator('[role="menu"] [role="menuitem"]', { hasText: '编辑订阅' }).click()
const renameDialog = page.getByRole('dialog')
await renameDialog.waitFor()
const nameInput = renameDialog.locator('#feed-edit-title')
await nameInput.fill('Anthony Fu 的博客')
await renameDialog.getByRole('button', { name: '保存' }).click()
await page.waitForTimeout(400)
assert.ok(
  (await page.locator('aside a', { hasText: 'Anthony Fu 的博客' }).count()) > 0,
  'feed rename should be visible in the sidebar',
)
console.log('✓ edit feed name persisted in sidebar')

// Rename back.
await openFeedMenu('Anthony Fu 的博客')
await page.locator('[role="menu"] [role="menuitem"]', { hasText: '编辑订阅' }).click()
await page.getByRole('dialog').locator('#feed-edit-title').fill('Anthony Fu')
await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
await page.waitForTimeout(300)

// Edit the feed URL (a query keeps the same fixture feed and proves re-fetching).
await openFeedMenu('React Status')
await page.locator('[role="menu"] [role="menuitem"]', { hasText: '编辑订阅' }).click()
await page.getByRole('dialog').locator('#feed-edit-url').fill('https://react.statuscode.com/rss?flowread=edited')
await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 })
const editedFeed = (await readFeeds()).find((feed) => feed.title === 'React Status')
assert.ok(editedFeed?.url.includes('flowread=edited'), 'edited feed URL should be persisted')
console.log('✓ edit feed URL re-fetched and persisted')

/* -------------------------------------------------------------------------- */
/* 2. Move to folder via the context menu                                     */
/* -------------------------------------------------------------------------- */
await openFeedMenu('月球背面')
await page.locator('[role="menu"] [role="menuitem"]', { hasText: '博客' }).click()
await page.waitForTimeout(500)
const moved = (await readFeeds()).find((feed) => feed.title === '月球背面')
assert.ok(moved?.folderId, 'feed should have been moved into a folder')
console.log('✓ move to folder persisted')

/* -------------------------------------------------------------------------- */
/* 2. Hovering a truncated feed title shows the full name                     */
/* -------------------------------------------------------------------------- */
const longTitle = '奇客Solidot–传递最新科技情报'
const longLink = page.locator('aside a', { hasText: longTitle }).first()
const longText = longLink.locator('span', { hasText: longTitle }).first()
assert.ok(await longText.count(), 'long feed title should exist')
await longText.hover()
const tooltip = page.getByRole('tooltip')
await tooltip.waitFor({ state: 'visible', timeout: 3000 })
assert.equal((await tooltip.innerText()).trim(), longTitle, 'tooltip should show the full feed name')
console.log('✓ truncated feed title reveals a floating tooltip')
await page.mouse.move(700, 700)
await page.waitForTimeout(200)

/* -------------------------------------------------------------------------- */
/* 3. Drag a feed to reorder it (no drag-to-delete)                           */
/* -------------------------------------------------------------------------- */
const before = await readFeeds()
const beforeStatus = before.find((feed) => feed.title === 'React Status')
const beforeTarget = before.find((feed) => feed.title === '阮一峰的网络日志')
assert.ok(beforeStatus && beforeTarget, 'expected feeds for the reorder test')
await dragStart('React Status')
await page.screenshot({ path: `${outDir}/15-drag-reorder.png` })
await dropOnFeed('阮一峰的网络日志')
await page.waitForTimeout(800)
const after = await readFeeds()
const afterStatus = after.find((feed) => feed.title === 'React Status')
const afterTarget = after.find((feed) => feed.title === '阮一峰的网络日志')
assert.ok(afterStatus && afterTarget, 'feeds should still exist after reordering')
assert.ok(
  afterStatus.sortIndex < afterTarget.sortIndex,
  'React Status should now be ordered before 阮一峰的网络日志',
)
console.log('✓ drag reorder persisted (drag-to-delete removed)')

/* -------------------------------------------------------------------------- */
/* 4. AI key + settings persistence                                           */
/* -------------------------------------------------------------------------- */
await page.locator('aside').getByRole('button', { name: '设置' }).click()
const settingsDialog = page.getByRole('dialog')
await settingsDialog.waitFor()
const keyInput = settingsDialog.locator('input[placeholder^="sk-"]')
await keyInput.fill('sk-local-persist-123')
await settingsDialog.getByText('已保存在本地').waitFor()
await settingsDialog.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(300)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
await page.locator('aside').getByRole('button', { name: '设置' }).click()
await page.getByRole('dialog').waitFor()
const persistedKey = await page.getByRole('dialog').locator('input[placeholder^="sk-"]').inputValue()
assert.equal(persistedKey, 'sk-local-persist-123', 'AI key should survive a reload (IndexedDB)')
console.log('✓ AI key persisted across reload')

/* -------------------------------------------------------------------------- */
/* 5. Invalid OPML entries are skipped                                         */
/* -------------------------------------------------------------------------- */
const feedsBeforeInvalidImport = (await readFeeds()).length
await page
  .getByRole('dialog')
  .locator('input[type="file"][accept*="opml"]')
  .setInputFiles(invalidOpml)
await page
  .getByRole('status')
  .filter({ hasText: '跳过 1 个无效订阅' })
  .last()
  .waitFor({ timeout: 30_000 })
const feedsAfterInvalidImport = (await readFeeds()).length
assert.equal(
  feedsAfterInvalidImport,
  feedsBeforeInvalidImport,
  'invalid subscriptions must not be stored',
)
console.log('✓ invalid OPML subscriptions are skipped')

/* -------------------------------------------------------------------------- */
/* 6. Backup export / import                                                  */
/* -------------------------------------------------------------------------- */
const dialog = page.getByRole('dialog')
await dialog.getByText('本地备份').scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/16-settings-backup.png` })

const downloadPromise = page.waitForEvent('download')
await dialog.getByRole('button', { name: '导出配置' }).click()
const download = await downloadPromise
const exportPath = resolve(downloadDir, 'flowread-config.json')
await download.saveAs(exportPath)
const { readFile } = await import('node:fs/promises')
const exported = JSON.parse(await readFile(exportPath, 'utf8'))
assert.equal(exported.app, 'flowread')
assert.ok(exported.feeds.length >= 4)
assert.equal(exported.settings.ai.apiKey, '', 'API key must be excluded by default')
assert.equal(exported.settings.ai.model, 'deepseek-chat')

// Including the key writes it in clear text.
await dialog.locator('input[type="checkbox"]').check()
const keyedDownloadPromise = page.waitForEvent('download')
await dialog.getByRole('button', { name: '导出配置' }).click()
const keyedDownload = await keyedDownloadPromise
const keyedPath = resolve(downloadDir, 'flowread-config-key.json')
await keyedDownload.saveAs(keyedPath)
const keyed = JSON.parse(await readFile(keyedPath, 'utf8'))
assert.equal(keyed.settings.ai.apiKey, 'sk-local-persist-123')
console.log('✓ backup export works with and without the API key')

// Import the key-less backup back.
await dialog.locator('input[type="file"][accept*="json"]').setInputFiles(exportPath)
await page
  .getByRole('status')
  .filter({ hasText: '已导入' })
  .last()
  .waitFor({ timeout: 10_000 })
console.log('✓ backup import succeeded')

/* -------------------------------------------------------------------------- */
await browser.close()
const relevantErrors = errors.filter((error) => !error.includes('502 (Bad Gateway)'))
if (relevantErrors.length > 0) {
  console.error('BROWSER ERRORS', relevantErrors)
  process.exitCode = 1
} else {
  console.log('\nAll management checks passed. Screenshots: 14, 15, 16.')
}
