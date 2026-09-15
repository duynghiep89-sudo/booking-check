export type TrackResult = {
  etd: string
  vessel: string
  voyage: string
  pod: string
  status: 'found' | 'not_found' | 'error'
  message: string
}

type TrackInput = {
  bookingNo: string
  carrierId?: string
  carrierCode?: string
  trackingUrl: string
  apiKey?: string
  requiresLogin?: boolean
  loginUser?: string
  loginPassword?: string
}

const SOURCE_PAGE = 'booking-check'
const SOURCE_EXT = 'booking-check-extension'

function empty(status: TrackResult['status'], message: string): TrackResult {
  return { etd: '', vessel: '', voyage: '', pod: '', status, message }
}

function pingExtension(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID()
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (data?.source !== SOURCE_EXT || data?.type !== 'PONG' || data?.requestId !== requestId) return
      cleanup()
      resolve(true)
    }
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ source: SOURCE_PAGE, type: 'PING', requestId }, '*')
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
  })
}

function requestViaExtension(input: TrackInput, timeoutMs = 120000): Promise<TrackResult> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID()
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (data?.source !== SOURCE_EXT || data?.type !== 'TRACK_RESULT' || data?.requestId !== requestId) return
      cleanup()
      resolve((data.result as TrackResult) || empty('error', 'Extension không trả kết quả.'))
    }
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ source: SOURCE_PAGE, type: 'TRACK_REQUEST', requestId, payload: input }, '*')
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(empty('error', 'Extension timeout — trang hãng phản hồi quá lâu.'))
    }, timeoutMs)
  })
}

async function requestViaLocalApi(input: TrackInput): Promise<TrackResult> {
  try {
    const response = await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) return empty('error', 'Không kết nối được máy chủ tra cứu.')
    return (await response.json()) as TrackResult
  } catch {
    return empty('error', 'Không kết nối được máy chủ tra cứu.')
  }
}

/**
 * Local (npm run dev): luôn dùng Playwright /api/track — không dùng extension.
 * Bản internet: dùng Chrome extension nếu đã cài.
 */
export async function requestTracking(input: TrackInput): Promise<TrackResult> {
  if (import.meta.env.DEV) return requestViaLocalApi(input)

  if (await pingExtension()) return requestViaExtension(input)

  return empty(
    'error',
    'Cần Chrome extension Booking Check Helper 0.2.0 (Load unpacked). Local thì chạy npm run dev.',
  )
}
