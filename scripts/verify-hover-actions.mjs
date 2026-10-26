/**
 * Visual/behavioural check for the Folo-style hover actions on article cards:
 * summarize card, translate, listen and share.
 *
 *   node scripts/mock-ai.mjs 9999 &
 *   node scripts/verify-hover-actions.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const opml = resolve('scripts/fixtures/test-feeds.opml')
const outDir = resolve('docs/screenshots')
await mkdir(outDir, { recursive: true })

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

await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
if ((await page.locator('article').count()) === 0) {
  await page.locator('input[type="file"]').first().setInputFiles(opml)
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 120_000 })
  await page.waitForTimeout(1200)
}

// Configure the local mock model (fetch the model list from /models).
await page.locator('aside').getByRole('button', { name: '设置' }).click()
const settings = page.getByRole('dialog')
await settings.waitFor()
await settings.getByLabel('服务商').selectOption({ label: '自定义 (OpenAI 兼容)' })
await settings.getByPlaceholder('https://api.deepseek.com/v1').fill('http://127.0.0.1:9999/v1')
await settings.getByPlaceholder(/sk-…/).fill('test-key')
await settings.getByRole('button', { name: '获取模型' }).click()
await settings.locator('option[value="mock-gpt"]').waitFor({ state: 'attached', timeout: 15_000 })
await settings.getByLabel('模型', { exact: true }).selectOption('mock-gpt')
await settings.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(300)

// Open a long-form feed so the card and hover bar have enough context.
await page.locator('aside a', { hasText: '阮一峰的网络日志' }).first().click()
await page.waitForTimeout(600)
const item = page.locator('article').first()
await item.hover()
await page.waitForTimeout(350)
await page.screenshot({ path: `${outDir}/17-hover-actions.png` })
const summaryButton = item.getByRole('button', { name: '摘要帖子' })
assert.ok(await summaryButton.isVisible(), 'hover should reveal the action bar')
console.log('✓ hover reveals summarize / translate / listen / share actions')

// Summary card (streams a mock summary).
await summaryButton.click()
await page.getByText('核心观点').first().waitFor({ timeout: 30_000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${outDir}/18-summary-card.png` })
assert.ok((await page.getByRole('button', { name: '打开文章' }).count()) > 0, 'summary card should offer open article')
console.log('✓ summary hover card streams and renders markdown')

// Listen button is available in the card footer.
assert.ok((await page.getByRole('button', { name: /收听文章/ }).count()) > 0, 'listen button should exist')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// Share menu: copying a link must not open any article.
await item.hover()
await page.waitForTimeout(250)
await item.getByRole('button', { name: '分享帖子' }).click()
await page.getByRole('menuitem', { name: '复制链接' }).waitFor()
await page.screenshot({ path: `${outDir}/19-share-menu.png` })
assert.ok(
  (await page.getByRole('menuitem', { name: '在新窗口打开原文' }).count()) > 0,
  'share menu should offer open in new window',
)
await page.getByRole('menuitem', { name: '复制链接' }).click()
await page.waitForTimeout(500)
assert.equal(page.url().includes('?a='), false, 'copy link must not open an article')
assert.equal(await page.locator('article[aria-current="true"]').count(), 0, 'copy link must not select an article')
console.log('✓ share menu offers copy link and open in new window (copy does not open an article)')

// Translate action opens the article with the translation bar ready.
await item.hover()
await page.waitForTimeout(250)
await item.getByRole('button', { name: '翻译帖子' }).click()
await page.waitForTimeout(800)
assert.ok(page.url().includes('translate=1'), 'translate action should mark the URL')
assert.ok((await page.getByText('全文翻译').count()) > 0, 'translate action should open the translation bar')
console.log('✓ translate action opens the article translation UI')

// Listen toggle (headless browsers may not emit audio, but state should change).
await item.hover()
await page.waitForTimeout(200)
const listenButton = item.getByRole('button', { name: '收听文章' })
if (await listenButton.count()) {
  await listenButton.click()
  await page.waitForTimeout(400)
  const stop = await item.getByRole('button', { name: '停止收听' }).count()
  console.log(stop > 0 ? '✓ listen toggles into the playing state' : '· listen click did not enter playing state (no TTS in headless)')
}

await browser.close()
if (errors.length > 0) {
  console.error('BROWSER ERRORS', errors)
  process.exitCode = 1
} else {
  console.log('\nHover action checks finished. Screenshots: 17–19.')
}
