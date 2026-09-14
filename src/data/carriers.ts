export type Carrier = {
  id: string
  name: string
  code: string
  aliases: string[]
  trackingUrlTemplate: string
  apiKey?: string
  requiresLogin?: boolean
  loginUser?: string
  loginPassword?: string
}

/**
 * CSDL mặc định 10 hãng tàu lớn (có thể thêm/sửa trên giao diện).
 * trackingUrlTemplate dùng {booking} làm placeholder số booking.
 */
export const DEFAULT_CARRIERS: Carrier[] = [
  {
    id: 'maersk',
    name: 'Maersk',
    code: 'MAEU',
    aliases: ['maersk', 'maersk line', 'msk', 'maeu', 'sealand'],
    trackingUrlTemplate: 'https://www.maersk.com/tracking/{booking}',
  },
  {
    id: 'msc',
    name: 'MSC',
    code: 'MSCU',
    aliases: [
      'msc',
      'mediterranean shipping',
      'mediterranean shipping company',
      'mscu',
    ],
    trackingUrlTemplate: 'https://www.msc.com/en/track-a-shipment',
  },
  {
    id: 'cma-cgm',
    name: 'CMA CGM',
    code: 'CMDU',
    aliases: ['cma cgm', 'cma-cgm', 'cmacgm', 'cma', 'cmdu', 'anl', 'cnc'],
    trackingUrlTemplate:
      'https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Reference&Reference={booking}&search=Search',
  },
  {
    id: 'cosco',
    name: 'COSCO',
    code: 'COSU',
    aliases: ['cosco', 'cosco shipping', 'cosu', 'cscl', 'oocl'],
    trackingUrlTemplate:
      'https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=booking&number={booking}',
  },
  {
    id: 'hapag-lloyd',
    name: 'Hapag-Lloyd',
    code: 'HLCU',
    aliases: ['hapag-lloyd', 'hapag lloyd', 'hapag', 'hpl', 'hlcu', 'hapaglloyd'],
    trackingUrlTemplate:
      'https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html?blno={booking}',
  },
  {
    id: 'one',
    name: 'ONE',
    code: 'ONEY',
    aliases: [
      'one',
      'ocean network express',
      'oney',
      'nyk',
      'mol',
      'k line',
      'kline',
    ],
    trackingUrlTemplate:
      'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?tracking-number={booking}',
  },
  {
    id: 'evergreen',
    name: 'Evergreen',
    code: 'EGLV',
    aliases: ['evergreen', 'evergreen marine', 'emc', 'eglv', 'evergreen line'],
    trackingUrlTemplate:
      'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do',
  },
  {
    id: 'hmm',
    name: 'HMM',
    code: 'HDMU',
    aliases: ['hmm', 'hyundai', 'hyundai merchant marine', 'hdmu'],
    trackingUrlTemplate:
      'https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do?numbers={booking}',
  },
  {
    id: 'yang-ming',
    name: 'Yang Ming',
    code: 'YMLU',
    aliases: ['yang ming', 'yangming', 'yml', 'ymlu', 'yang ming marine'],
    trackingUrlTemplate:
      'https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx?type=BK&no={booking}',
  },
  {
    id: 'sitc',
    name: 'SITC',
    code: 'SITU',
    aliases: ['sitc', 'sitc line', 'sitcline', 'situ', 'sitc container'],
    trackingUrlTemplate:
      'https://www.sitcline.com/track-trace?bookingNo={booking}',
  },
]

export function buildTrackingUrl(template: string, bookingNo: string): string {
  return template.replaceAll('{booking}', encodeURIComponent(bookingNo.trim()))
}

export function inferGenericSearchUrl(
  carrierName: string,
  bookingNo: string,
): string {
  const query = [carrierName, bookingNo, 'booking tracking']
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}
