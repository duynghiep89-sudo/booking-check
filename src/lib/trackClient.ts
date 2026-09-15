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

export function pingExtension(timeoutMs = 900): Promise<boolean> {
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
      if (data?.source !== SOURCE_EXT || data?.type !== 'TRACK_RESULT' || data?.requestId !== requestId) {
        return
      }
      cleanup()
      resolve((data.result as TrackResult) || empty('error', 'Extension không trả kết quả.'))
    }
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
    window.addEventListener('message', onMessage)
    window.postMessage(
      {
        source: SOURCE_PAGE,
        type: 'TRACK_REQUEST',
        requestId,
        payload: input,
      },
      '*',
    )
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(empty('error', 'Extension timeout — trang hãng phản hồi quá lâu.'))
    }, timeoutMs)
  })
}

async function requestViaLocalApi(input: TrackInput): Promise<TrackResult | null> {
  try {
    const response = await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) return null
    return (await response.json()) as TrackResult
  } catch {
    return null
  }
}

export async function requestTracking(input: TrackInput): Promise<TrackResult> {
  // Ưu tiên extension nếu đã cài (cả Vercel lẫn local).
  const hasExtension = await pingExtension()
  if (hasExtension) return requestViaExtension(input)

  if (import.meta.env.DEV) {
    const local = await requestViaLocalApi(input)
    if (local) return local
  }

  return empty(
    'error',
    'Chưa kết nối Booking Check Helper. Cài extension → Reload extension → F5 trang web, đợi dòng “Extension đã kết nối”.',
  )
}
