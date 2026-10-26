/**
 * End-to-end visual check. Imports a small OPML file, exercises the AI summary
 * and bilingual translation flows against the local mock AI server, and writes
 * screenshots for the desktop (light/dark), subscriptions, settings and mobile
 * layouts.
 *
 *   node scripts/mock-ai.mjs &
 *   node scripts/screenshots.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8790'
const executablePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const opml = resolve(process.env.OPML_PATH ?? 'scripts/fixtures/test-feeds.opml')
const outDir = resolve('docs/screenshots')

await mkdir(outDir, { recursive: true })
// Clear only the screenshots this script owns (01–13); management captures
// (14–19) and Tauri captures (20–21) come from the other verify scripts.
const owned = /^(0[1-9]|1[0-3])-.*\.png$/
for (const file of await readdir(outDir)) {
  if (owned.test(file)) await unlink(join(outDir, file))
}

const errors = []
function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${label}] console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`[${label}] pageerror: ${error.message}`))
}

async function waitForImages(page, timeout = 15_000) {
  await page
    .evaluate(async (limit) => {
      const images = [...document.images]
      await Promise.race([
        Promise.all(
          images.map((image) =>
            image.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  image.addEventListener('load', resolve, { once: true })
                  image.addEventListener('error', resolve, { once: true })
                }),
          ),
        ),
        new Promise((resolve) => setTimeout(resolve, limit)),
      ])
    }, timeout)
    .catch(() => undefined)
}

async function waitForRefresh(page, timeout = 180_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const aside = await page
      .locator('aside')
      .innerText()
      .catch(() => '')
    if (!aside.includes('正在更新')) return
    await page.waitForTimeout(500)
  }
}

async function importFeeds(page) {
  await page.locator('input[type="file"]').first().setInputFiles(opml)
  await page.locator('article').first().waitFor({ state: 'visible', timeout: 180_000 })
  await waitForRefresh(page)
  await page.waitForTimeout(800)
  await waitForImages(page)
}

async function openFeed(page, title) {
  const viewport = page.viewportSize()
  if (viewport && viewport.width < 1024) {
    await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.waitForTimeout(350)
  }
  await page.locator('aside a', { hasText: title }).first().click()
  await page.waitForTimeout(600)
  try {
    await page.locator('article').first().waitFor({ state: 'visible', timeout: 60_000 })
  } catch {
    await page.locator('aside').getByRole('link', { name: '时间线' }).click()
    await page.locator('article').first().waitFor({ state: 'visible', timeout: 30_000 })
  }
  await waitForImages(page)
}

async function openSettings(page) {
  await page.locator('aside').getByRole('button', { name: '设置' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

async function configureMockAi(page) {
  const dialog = await openSettings(page)
  await dialog.getByLabel('服务商').selectOption({ label: '自定义 (OpenAI 兼容)' })
  await dialog.getByPlaceholder('https://api.deepseek.com/v1').fill('http://127.0.0.1:9999/v1')
  await dialog.getByPlaceholder(/sk-…/).fill('test-key')
  await dialog.getByRole('button', { name: '获取模型' }).click()
  await dialog.locator('option[value="mock-gpt"]').waitFor({ state: 'attached', timeout: 15_000 })
  await dialog.getByLabel('模型', { exact: true }).selectOption('mock-gpt')
  await dialog.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(300)
}

async function waitForTranslation(page, timeout = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const text = await page.locator('main').innerText()
    if (!text.includes('正在翻译')) return
    await page.waitForTimeout(400)
  }
}

const browser = await chromium.launch({ executablePath, headless: true })

/* -------------------------------------------------------------------------- */
/* Desktop                                                                    */
/* -------------------------------------------------------------------------- */
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  serviceWorkers: 'block',
})
const page = await desktop.newPage()
watch(page, 'desktop')

await page.goto(base, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${outDir}/01-welcome.png` })

await importFeeds(page)
await openFeed(page, 'Anthony Fu')
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/02-timeline.png` })

await configureMockAi(page)

// Use a long-form blog post for the reading, AI and translation screenshots.
await openFeed(page, '阮一峰的网络日志')
await page.locator('article').first().click()
await page.locator('h1').nth(1).waitFor({ state: 'visible' })
await page.waitForTimeout(1800)
await page.screenshot({ path: `${outDir}/03-reader.png` })

await page.locator('button[title="AI 摘要"]').click()
const generate = page.getByRole('button', { name: '生成摘要' })
if (await generate.count()) await generate.first().click()
await page.locator('.ai-markdown').first().waitFor({ state: 'visible', timeout: 30_000 })
await page.waitForTimeout(5000)
await page.screenshot({ path: `${outDir}/04-ai-summary.png` })

await page.locator('button[title="翻译"]').click()
const translateButton = page.getByRole('button', { name: '开始翻译' })
await translateButton.waitFor({ state: 'visible' })
await translateButton.click()
await page.locator('.flowread-translation').first().waitFor({ state: 'visible', timeout: 90_000 })
await waitForTranslation(page)
await page.waitForTimeout(700)
await page.mouse.move(1100, 700)
await page.mouse.wheel(0, 620)
await page.waitForTimeout(600)
await page.screenshot({ path: `${outDir}/05-translation.png` })

const onlyButton = page.getByRole('button', { name: '仅译文' })
if (await onlyButton.count()) {
  await onlyButton.click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${outDir}/06-translation-only.png` })
  await page.getByRole('button', { name: '双语对照' }).click()
}
await page.mouse.wheel(0, -1400)
await page.waitForTimeout(400)

// Dark mode, with the AI panel and translations visible.
const darkDialog = await openSettings(page)
await darkDialog.getByRole('button', { name: '深色' }).click()
await darkDialog.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${outDir}/07-dark.png` })

const lightDialog = await openSettings(page)
await lightDialog.getByRole('button', { name: '浅色' }).click()
await lightDialog.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(300)

// Subscriptions and settings screens.
await page.locator('aside').getByRole('link', { name: '订阅源' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${outDir}/08-subscriptions.png` })

// Reset the AI form to the default provider for documentation screenshots.
const resetDialog = await openSettings(page)
await resetDialog.getByLabel('服务商').selectOption({ label: 'DeepSeek' })
await resetDialog.getByPlaceholder(/sk-…/).fill('')
await resetDialog.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(300)

await openSettings(page)
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/09-settings.png` })
const settingsDialog = page.getByRole('dialog')
await settingsDialog.getByText('测试连接').scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/09b-settings-ai.png` })
await page.getByRole('dialog').getByRole('button', { name: '完成' }).click()

await desktop.close()

/* -------------------------------------------------------------------------- */
/* Mobile                                                                     */
/* -------------------------------------------------------------------------- */
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  serviceWorkers: 'block',
})
const mobilePage = await mobile.newPage()
watch(mobilePage, 'mobile')
await mobilePage.goto(base, { waitUntil: 'networkidle' })
await mobilePage.screenshot({ path: `${outDir}/10-mobile-welcome.png` })
await importFeeds(mobilePage)
await openFeed(mobilePage, 'Anthony Fu')
await mobilePage.waitForTimeout(400)
await mobilePage.screenshot({ path: `${outDir}/11-mobile-timeline.png` })
await openFeed(mobilePage, '阮一峰的网络日志')
await mobilePage.locator('article').first().click()
await mobilePage.locator('h1').nth(1).waitFor({ state: 'visible' })
await mobilePage.waitForTimeout(1500)
await mobilePage.screenshot({ path: `${outDir}/12-mobile-reader.png` })
await mobile.close()

await browser.close()

if (errors.length > 0) {
  console.log('BROWSER ERRORS:')
  for (const error of errors) console.log(' -', error)
} else {
  console.log('No browser errors.')
}
console.log('Screenshots written to', outDir)
