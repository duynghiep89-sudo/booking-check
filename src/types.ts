import type { Carrier } from './data/carriers'

export type CheckStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'error'

export type BookingRow = {
  id: string
  bookingNo: string
  carrierRaw: string
  carrier: Carrier | null
  matchStatus: 'matched' | 'unknown'
  trackingUrl: string
  etd: string
  vessel: string
  voyage: string
  pod: string
  checkStatus: CheckStatus
  checkMessage: string
}
