export type TrackResult = {
  etd: string
  vessel: string
  voyage: string
  pod: string
  status: 'found' | 'not_found' | 'error'
  message: string
}

export async function requestTracking(input: {
  bookingNo: string
  carrierId?: string
  carrierCode?: string
  trackingUrl: string
  apiKey?: string
  requiresLogin?: boolean
  loginUser?: string
  loginPassword?: string
}): Promise<TrackResult> {
  const response = await fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    return {
      etd: '',
      vessel: '',
      voyage: '',
      pod: '',
      status: 'error',
      message: 'Không kết nối được máy chủ tra cứu.',
    }
  }
  return (await response.json()) as TrackResult
}
