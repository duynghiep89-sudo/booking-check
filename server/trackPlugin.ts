import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export function trackingApiPlugin(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/track')) {
      next()
      return
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, { message: 'Method not allowed' })
      return
    }
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        bookingNo?: string
        carrierId?: string
        carrierCode?: string
        trackingUrl?: string
        apiKey?: string
        requiresLogin?: boolean
        loginUser?: string
        loginPassword?: string
      }
      const { trackShipment } = await import('./trackShipment.ts')
      const result = await trackShipment({
        bookingNo: body.bookingNo ?? '',
        carrierId: body.carrierId,
        carrierCode: body.carrierCode,
        trackingUrl: body.trackingUrl ?? '',
        apiKey: body.apiKey,
        requiresLogin: body.requiresLogin,
        loginUser: body.loginUser,
        loginPassword: body.loginPassword,
      })
      send(res, 200, result)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Lỗi máy chủ tra cứu.'
      send(res, 500, {
        etd: '',
        vessel: '',
        voyage: '',
        pod: '',
        status: 'error',
        message: detail,
      })
    }
  }

  return {
    name: 'tracking-api',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
