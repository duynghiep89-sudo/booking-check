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
 * Trang tracking gốc. Không gắn số booking vào URL — nhập booking trên form search.
 */
export const DEFAULT_CARRIERS: Carrier[] = [
  {
    id: 'maersk',
    name: 'Maersk',
    code: 'MAEU',
    aliases: ['maersk', 'maersk line', 'msk', 'maeu', 'sealand'],
    trackingUrlTemplate: 'https://www.maersk.com/tracking',
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
    trackingUrlTemplate: 'https://www.cma-cgm.com/ebusiness/tracking',
  },
  {
    id: 'cosco',
    name: 'COSCO',
    code: 'COSU',
    aliases: ['cosco', 'cosco shipping', 'cosu', 'cscl', 'oocl'],
    trackingUrlTemplate: 'https://elines.coscoshipping.com/ebusiness/cargoTracking',
  },
  {
    id: 'hapag-lloyd',
    name: 'Hapag-Lloyd',
    code: 'HLCU',
    aliases: ['hapag-lloyd', 'hapag lloyd', 'hapag', 'hpl', 'hlcu', 'hapaglloyd'],
    trackingUrlTemplate:
      'https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html',
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
    trackingUrlTemplate: 'https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking',
  },
  {
    id: 'evergreen',
    name: 'Evergreen',
    code: 'EGLV',
    aliases: ['evergreen', 'evergreen marine', 'emc', 'eglv', 'evergreen line'],
    trackingUrlTemplate: 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do',
  },
  {
    id: 'hmm',
    name: 'HMM',
    code: 'HDMU',
    aliases: ['hmm', 'hyundai', 'hyundai merchant marine', 'hdmu'],
    trackingUrlTemplate: 'https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do',
  },
  {
    id: 'yang-ming',
    name: 'Yang Ming',
    code: 'YMLU',
    aliases: ['yang ming', 'yangming', 'yml', 'ymlu', 'yang ming marine'],
    trackingUrlTemplate:
      'https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx',
  },
  {
    id: 'sitc',
    name: 'SITC',
    code: 'SITU',
    aliases: ['sitc', 'sitc line', 'sitcline', 'situ', 'sitc container'],
    trackingUrlTemplate: 'https://www.sitcline.com/track-trace',
  },
  {
    id: 'zim',
    name: 'ZIM',
    code: 'ZIMU',
    aliases: ['zim', 'zim line', 'zim integrated', 'zimu'],
    trackingUrlTemplate: 'https://www.zim.com/tools/track-a-shipment',
  },
]

export function stripBookingFromTrackingUrl(template: string, bookingNo = ''): string {
  const raw = template.trim()
  if (!raw) return raw
  const booking = bookingNo.trim()
  try {
    const url = new URL(raw.replaceAll('{booking}', ''))
    const dropKeys = [
      'booking',
      'bookingno',
      'blno',
      'number',
      'numbers',
      'no',
      'reference',
      'searchby',
      'search',
      'searchnumber',
      'searchtype',
      'tracking-number',
      'trackingnumber',
      'trackingtype',
      'params',
      'type',
    ]
    for (const key of [...url.searchParams.keys()]) {
      const value = url.searchParams.get(key) ?? ''
      if (
        dropKeys.includes(key.toLowerCase()) ||
        !value ||
        value.includes('{booking}') ||
        (booking && value.toLowerCase() === booking.toLowerCase())
      ) {
        url.searchParams.delete(key)
      }
    }
    url.pathname = url.pathname
      .replace(/\/tracking\/[^/]+$/i, '/tracking')
      .replace(/\/track(?:ing)?\/[^/]+$/i, (m) => m.replace(/\/[^/]+$/, ''))
    if (booking) {
      url.pathname = url.pathname.replace(new RegExp(`/${booking.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`, 'i'), '/')
    }
    url.hash = ''
    const search = url.searchParams.toString()
    return `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}${search ? `?${search}` : ''}`
  } catch {
    return raw.replaceAll('{booking}', '').replace(/\?.*$/, '').replace(/\/+$/, '')
  }
}

export function buildTrackingUrl(template: string, bookingNo?: string): string {
  return stripBookingFromTrackingUrl(template, bookingNo)
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
