import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { ServerOptions } from './config'
import { createAiRoutes } from './routes/ai'
import { createFeedRoutes } from './routes/feed'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

async function serveWebFile(webDir: string, requestPath: string): Promise<Response | null> {
  const root = resolve(webDir)
  const decoded = decodeURIComponent(requestPath)
  const target = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)
  if (target !== root && !target.startsWith(root + sep)) return null
  try {
    const info = await stat(target)
    if (!info.isFile()) return null
    const body = await readFile(target)
    const extension = extname(target).toLowerCase()
    const isHashedAsset = target.includes(`${sep}assets${sep}`)
    return new Response(body, {
      headers: {
        'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
        'content-length': String(body.byteLength),
        'cache-control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return null
  }
}

export function createApp(options: ServerOptions): Hono {
  const app = new Hono()

  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['content-type', 'authorization'],
      maxAge: 86400,
    }),
  )

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      name: 'FlowRead',
      version: options.version,
      features: ['feed', 'discover', 'extract', 'ai-summary', 'ai-translate'],
      web: Boolean(options.webDir),
    }),
  )

  app.route('/api', createFeedRoutes({ allowPrivateNetwork: options.allowPrivateNetwork }))
  app.route('/api/ai', createAiRoutes())

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: '接口不存在', code: 'not_found' }, 404)
    }
    return c.text('Not Found', 404)
  })

  app.onError((error, c) => {
    const status = (error as { status?: number }).status ?? 500
    const code = (error as { code?: string }).code ?? 'internal_error'
    if (status >= 500) console.error('[flowread]', error)
    return c.json({ error: error.message || '服务器内部错误', code }, status as 400)
  })

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: '接口不存在', code: 'not_found' }, 404)
    }
    if (!options.webDir) return c.text('FlowRead API is running. Web build not found (set WEB_DIR).', 200)
    const file = await serveWebFile(options.webDir, c.req.path)
    if (file) return file
    // SPA fallback
    const index = await serveWebFile(options.webDir, '/index.html')
    if (index) return index
    return c.text('Web build missing index.html', 500)
  })

  return app
}
