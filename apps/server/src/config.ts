import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ServerOptions {
  port: number
  host: string
  /** Directory containing the built web app (enables single-port deployments). */
  webDir?: string
  /** Allow fetching feeds served from private network addresses. */
  allowPrivateNetwork: boolean
  version: string
}

function envFlag(name: string, fallback = false): boolean {
  const value = process.env[name]
  if (value == null) return fallback
  return /^(1|true|yes|on)$/i.test(value.trim())
}

const here = dirname(fileURLToPath(import.meta.url))

/** The web build can live in a few places depending on how the server is started. */
async function resolveWebDir(): Promise<string | undefined> {
  const candidates = [
    process.env.WEB_DIR,
    join(process.cwd(), 'apps/web/dist'),
    join(process.cwd(), '../web/dist'),
    resolve(here, '../../web/dist'),
    resolve(here, '../../../apps/web/dist'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      const info = await stat(join(candidate, 'index.html'))
      if (info.isFile()) return resolve(candidate)
    } catch {
      /* try the next candidate */
    }
  }
  return undefined
}

export async function loadOptions(): Promise<ServerOptions> {
  const port = Number.parseInt(process.env.PORT ?? '8787', 10)
  const webDir = await resolveWebDir()

  return {
    port: Number.isFinite(port) ? port : 8787,
    host: process.env.HOST ?? '0.0.0.0',
    ...(webDir ? { webDir } : {}),
    allowPrivateNetwork: envFlag('ALLOW_PRIVATE_NETWORK', false),
    version: process.env.npm_package_version ?? '0.1.0',
  }
}
