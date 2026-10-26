import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadOptions } from './config'

async function main(): Promise<void> {
  const options = await loadOptions()
  const app = createApp(options)

  serve({ fetch: app.fetch, port: options.port, hostname: options.host }, (info) => {
    const label = options.webDir ? `web + api` : 'api only'
    console.log(`\n  FlowRead ${options.version}  (${label})`)
    console.log(`  ➜  http://localhost:${info.port}`)
    if (!options.webDir) {
      console.log(`  ➜  web build not found – run \`pnpm build\` or set WEB_DIR`)
    }
    console.log('')
  })
}

main().catch((error) => {
  console.error('[flowread] failed to start:', error)
  process.exitCode = 1
})
