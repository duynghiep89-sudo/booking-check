import * as XLSX from 'xlsx'
import type { Carrier } from '../data/carriers'
import type { BookingRow } from '../types'
import { buildBookingRow } from './bookings'
import { cellText, normalizeKey } from './text'

const HEADER_ALIASES = {
  bookingNo: [
    'so booking',
    'booking',
    'booking no',
    'booking number',
    'bkg',
    'bkg no',
    'so bkg',
    'bookingno',
  ],
  carrierRaw: [
    'hang tau',
    'hang tau bien',
    'carrier',
    'shipping line',
    'line',
    'carrier name',
    'hang',
  ],
} as const

function mapHeader(header: string): keyof typeof HEADER_ALIASES | null {
  const key = normalizeKey(header)
  if (!key) return null
  if ((HEADER_ALIASES.bookingNo as readonly string[]).includes(key)) return 'bookingNo'
  if ((HEADER_ALIASES.carrierRaw as readonly string[]).includes(key)) return 'carrierRaw'
  return null
}

export function parseBookingWorkbook(data: ArrayBuffer, carriers: Carrier[]): BookingRow[] {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const sheet = workbook.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(
    sheet,
    { header: 1, defval: '', raw: true },
  )

  if (matrix.length < 2) return []

  const headerRow = matrix[0] ?? []
  const columnMap = new Map<number, keyof typeof HEADER_ALIASES>()
  headerRow.forEach((cell, index) => {
    const field = mapHeader(cellText(cell))
    if (field && !Array.from(columnMap.values()).includes(field)) {
      columnMap.set(index, field)
    }
  })

  if (!Array.from(columnMap.values()).includes('bookingNo') || !Array.from(columnMap.values()).includes('carrierRaw')) {
    throw new Error('File Excel chỉ cần 2 cột: “Số Booking” và “Hãng tàu”.')
  }

  const rows: BookingRow[] = []
  matrix.slice(1).forEach((raw) => {
    const values: Partial<Record<keyof typeof HEADER_ALIASES, string>> = {}
    raw.forEach((cell, col) => {
      const field = columnMap.get(col)
      if (field) values[field] = cellText(cell)
    })
    const bookingNo = values.bookingNo ?? ''
    const carrierRaw = values.carrierRaw ?? ''
    if (!bookingNo && !carrierRaw) return
    rows.push(buildBookingRow({ bookingNo, carrierRaw }, carriers))
  })

  return rows
}

export function downloadExcelTemplate() {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Số Booking', 'Hãng tàu'],
    ['259123456', 'Maersk'],
    ['MEDU1234567', 'MSC'],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Bookings')
  XLSX.writeFile(workbook, 'mau-booking.xlsx')
}
