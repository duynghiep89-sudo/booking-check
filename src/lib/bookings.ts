import type { Carrier } from '../data/carriers'
import type { BookingRow } from '../types'
import { matchCarrier } from './matchCarrier'

export function buildBookingRow(
  input: {
    bookingNo: string
    carrierRaw: string
    id?: string
  },
  carriers: Carrier[],
): BookingRow {
  const matched = matchCarrier(input.carrierRaw, input.bookingNo, carriers)
  return {
    id: input.id ?? crypto.randomUUID(),
    bookingNo: input.bookingNo.trim(),
    carrierRaw: input.carrierRaw.trim(),
    carrier: matched.carrier,
    matchStatus: matched.status,
    trackingUrl: matched.trackingUrl,
    etd: '',
    vessel: '',
    voyage: '',
    pod: '',
    checkStatus: 'idle',
    checkMessage: '',
  }
}

export function rematchBookings(rows: BookingRow[], carriers: Carrier[]): BookingRow[] {
  return rows.map((row) => {
    const next = buildBookingRow(
      {
        id: row.id,
        bookingNo: row.bookingNo,
        carrierRaw: row.carrierRaw,
      },
      carriers,
    )
    return {
      ...next,
      etd: row.etd,
      vessel: row.vessel,
      voyage: row.voyage,
      pod: row.pod,
      checkStatus: row.checkStatus ?? 'idle',
      checkMessage: row.checkMessage ?? '',
    }
  })
}
