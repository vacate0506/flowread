/** Server-sent events helper shared by the AI routes. */
export type SseEmit = (event: string, data: unknown) => void

export function sseResponse(run: (emit: SseEmit) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const emit: SseEmit = (event, data) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }
      try {
        await run(emit)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = (error as { code?: string }).code ?? 'error'
        emit('error', { message, code })
      } finally {
        emit('done', {})
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed by the client */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  })
}

/** Read a JSON body with a friendly error message. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400, code: 'invalid_json' })
  }
}
