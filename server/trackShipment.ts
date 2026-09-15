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

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

let browserQueue: Promise<unknown> = Promise.resolve()

function enqueueBrowser<T>(work: () => Promise<T>): Promise<T> {
  const run = browserQueue.then(work, work)
  browserQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function emptyResult(status: TrackResult['status'], message: string): TrackResult {
  return { etd: '', vessel: '', voyage: '', pod: '', status, message }
}

function formatDate(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('vi-VN')
  }
  const text = String(value).trim()
  if (/^\d{8}$/.test(text)) {
    const parsedYmd = Date.parse(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`)
    if (!Number.isNaN(parsedYmd)) return new Date(parsedYmd).toLocaleDateString('vi-VN')
  }
  const cma = text.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (cma) {
    const parsedCma = Date.parse(`${cma[1]} ${cma[2]} ${cma[3]}`)
    if (!Number.isNaN(parsedCma)) return new Date(parsedCma).toLocaleDateString('vi-VN')
  }
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const parsedDmy = Date.parse(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`)
    if (!Number.isNaN(parsedDmy)) return new Date(parsedDmy).toLocaleDateString('vi-VN')
  }
  const parsed = Date.parse(text)
  if (!Number.isNaN(parsed)) return new Date(parsed).toLocaleDateString('vi-VN')
  return text
}

function asText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return asText(
      record.name ??
        record.vesselName ??
        record.locationName ??
        record.portName ??
        record.code ??
        record.unlocode ??
        record.value,
    )
  }
  return String(value).trim()
}

function scoreKey(key: string, kind: 'etd' | 'vessel' | 'voyage' | 'pod'): number {
  const k = key.toLowerCase()
  if (kind === 'etd') {
    if (/(pol).*(etd|departure)|etd.*(pol)|estimateddeparture|departuredate|atd|etddt|etddate|poletd/.test(k)) return 3
    if (/(^|_)etd(_|$)|etd|departure/.test(k)) return 2
    return 0
  }
  if (kind === 'vessel') {
    if (/vesselname|vslname|shipname/.test(k)) return 3
    if (/^vessel$|^vsl$|vessel/.test(k) && !/imo|mmsi|code/.test(k)) return 2
    return 0
  }
  if (kind === 'voyage') {
    if (/voyagenumber|voyageno|voyage/.test(k)) return 2
    if (/^voy$/.test(k)) return 1
    return 0
  }
  if (/(pod|portofdischarge|dischargeport|destinationport|destport)/.test(k)) return 3
  if (/destination/.test(k) && /port|name|code|city|location/.test(k)) return 2
  if (/^destination$|^discharge$/.test(k)) return 2
  return 0
}

function walk(value: unknown, path: string, acc: Record<'etd' | 'vessel' | 'voyage' | 'pod', { score: number; value: string }>) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}.${index}`, acc))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`
    const kinds = ['etd', 'vessel', 'voyage', 'pod'] as const
    for (const kind of kinds) {
      const score = scoreKey(key, kind)
      const text = kind === 'etd' ? formatDate(child) : asText(child)
      if (score > 0 && text && score >= acc[kind].score) {
        acc[kind] = { score, value: text }
      }
    }
    if (child && typeof child === 'object') walk(child, nextPath, acc)
  }
}

function extractFromData(data: unknown): Partial<TrackResult> {
  const acc = {
    etd: { score: 0, value: '' },
    vessel: { score: 0, value: '' },
    voyage: { score: 0, value: '' },
    pod: { score: 0, value: '' },
  }
  walk(data, '', acc)
  return {
    etd: acc.etd.value,
    vessel: acc.vessel.value,
    voyage: acc.voyage.value,
    pod: acc.pod.value,
  }
}

function extractFromHtml(html: string): Partial<TrackResult> {
  const jsonBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter((block) => block.startsWith('{') || block.startsWith('['))
  for (const block of jsonBlocks) {
    try {
      const extracted = extractFromData(JSON.parse(block))
      if (extracted.etd || extracted.vessel || extracted.voyage || extracted.pod) return extracted
    } catch {
      /* ignore invalid JSON in page scripts */
    }
  }

  const pick = (labels: string[]) => {
    for (const label of labels) {
      const regex = new RegExp(`${label}[^A-Za-z0-9]{0,12}([A-Za-z0-9][A-Za-z0-9 .\\-/_]{1,40})`, 'i')
      const match = html.replace(/<[^>]+>/g, ' ').match(regex)
      if (match?.[1]) return match[1].trim()
    }
    return ''
  }

  return {
    etd: pick(['ETD', 'Departure', 'Khởi hành']),
    vessel: pick(['Vessel Name', 'Vessel', 'Tên tàu']),
    voyage: pick(['Voyage', 'Số chuyến']),
    pod: pick(['Port of Discharge', 'POD', 'Cảng đến', 'Destination']),
  }
}

function isLabelValue(value: string) {
  return /^(vessel(?: name| departure| arrival)?|voyage(?: no(?:mber)?)?|port of (?:discharge|loading|destination)|destination(?: port)?|estimated departure|departure date|etd|eta|pod|pol|tracking)$/i.test(
    value.trim(),
  )
}

function isDateLike(value: string) {
  return (
    /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4})/.test(
      value,
    ) &&
    value.length >= 8 &&
    value.length <= 40 &&
    !isLabelValue(value)
  )
}

function isVesselLike(value: string) {
  return (
    value.length >= 4 &&
    /[A-Za-z]/.test(value) &&
    !/^(true|false|null|undefined)$/i.test(value) &&
    !isLabelValue(value)
  )
}

function isVoyageLike(value: string) {
  return value.length >= 2 && value.length <= 12 && /\d/.test(value) && !isLabelValue(value)
}

function isPodLike(value: string) {
  return value.length >= 3 && value.length <= 48 && !isLabelValue(value)
}

function cleanExtracted(extracted: Partial<TrackResult>): Partial<TrackResult> {
  const etd = isDateLike(extracted.etd ?? '') ? extracted.etd : ''
  const vessel = isVesselLike(extracted.vessel ?? '') ? extracted.vessel : ''
  const voyage = isVoyageLike(extracted.voyage ?? '') ? extracted.voyage : ''
  const pod = isPodLike(extracted.pod ?? '') ? extracted.pod : ''
  return { etd, vessel, voyage, pod }
}

function hasResult(result: Partial<TrackResult>) {
  const etd = result.etd ?? ''
  const vessel = result.vessel ?? ''
  const voyage = result.voyage ?? ''
  const pod = result.pod ?? ''
  return isDateLike(etd) || (isVesselLike(vessel) && (isVoyageLike(voyage) || isPodLike(pod)))
}

async function fetchText(url: string): Promise<{ ok: boolean; contentType: string; text: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
  })
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  return { ok: response.ok, contentType, text }
}

function parsePayload(contentType: string, text: string): Partial<TrackResult> {
  if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      return extractFromData(JSON.parse(text))
    } catch {
      return extractFromHtml(text)
    }
  }
  return extractFromHtml(text)
}

function isCosco(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'cosco' || input.carrierCode === 'COSU'
}

function parseCoscoPage(text: string): Partial<TrackResult> {
  const normalized = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
  if (/No results found/i.test(normalized) && !/Schedule Detail|Booking Information/i.test(normalized)) {
    return {}
  }

  const etdRaw = normalized.match(/\bETD\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ?? ''
  const podRaw =
    normalized.match(/\bPOD\s*:\s*([A-Za-z][A-Za-z0-9 ,.'()-]{2,60})/i)?.[1]?.trim() ?? ''
  const pod = podRaw.replace(/-.*/, '').trim() || podRaw

  const schedule = normalized.split(/Schedule Detail/i)[1] ?? ''
  const firstSailing = schedule.match(
    /\n([A-Z][A-Z0-9 .'-]{2,40})\s+([A-Z0-9]{2,8})\s+(\d{2,4}[A-Z])\s+/,
  )

  return {
    etd: etdRaw ? formatDate(etdRaw) : '',
    vessel: firstSailing?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
    voyage: firstSailing?.[3]?.trim() ?? '',
    pod,
  }
}

function isZim(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return (
    id === 'zim' ||
    id.startsWith('zim-') ||
    input.carrierCode === 'ZIMU' ||
    /zim\.com/i.test(input.trackingUrl)
  )
}

function parseZimPage(text: string): Partial<TrackResult> {
  const normalized = text.replace(/\u00a0/g, ' ')
  if (!/Port of Discharge \(POD\)|Vessel \/ Voyage|Track a Shipment/i.test(normalized)) return {}

  const overview = normalized.split(/Routing Details|SI Tracker|Container\n/i)[0] ?? normalized
  const sailing = overview.match(/Port of Loading \(POL\)[\s\S]{0,220}?Sailing\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i)
  const vesselVoyage = overview.match(/Vessel \/ Voyage\s+([A-Z][A-Z0-9 .'-]+?)\/(\d{1,4}\/?[A-Z]?)/i)
  const pod =
    overview.match(/Port of Discharge \(POD\)\s+([A-Za-z0-9 ,.'()]{3,60})/i)?.[1]?.replace(/\s+/g, ' ').trim() ||
    ''

  return {
    etd: sailing?.[1] ? formatDate(sailing[1]) : '',
    vessel: (vesselVoyage?.[1] ?? '').replace(/\s+/g, ' ').trim(),
    voyage: (vesselVoyage?.[2] ?? '').trim(),
    pod,
  }
}

function isOne(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'one' || input.carrierCode === 'ONEY'
}

function parseOnePage(text: string): Partial<TrackResult> {
  const normalized = text.replace(/\u00a0/g, ' ')
  if (!/Recent Track|Booking Ref|Sailing Information|Search by BL No/i.test(normalized)) return {}

  const sailing = normalized.split(/Sailing Information/i)[1] ?? ''
  const firstLeg = sailing.match(/([A-Z][A-Z0-9 .'-]{2,40}?)\s+(\d{2,4}[A-Z])\s+\([A-Z]{2,6}\)/)
  const etdRaw =
    normalized.match(/Vessel Departure from Port of Loading\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ||
    sailing.match(/Port of Loading[\s\S]{0,120}?(\d{4}-\d{2}-\d{2})/)?.[1] ||
    ''
  const vessel = firstLeg?.[1]?.replace(/\s+/g, ' ').trim() || ''
  const voyage = firstLeg?.[2]?.trim() || ''
  const pod =
    normalized.match(/Place of Delivery\s+([A-Za-z0-9 ,.'-]{3,60})/i)?.[1]?.replace(/, UNITED STATES/i, '').trim() ||
    normalized.match(/\b([A-Z][A-Z .]+,\s*[A-Z]{2},\s*UNITED STATES)\b/)?.[1]?.replace(/, UNITED STATES/i, '').trim() ||
    ''

  return {
    etd: etdRaw ? formatDate(etdRaw) : '',
    vessel,
    voyage,
    pod,
  }
}

function isCma(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'cma-cgm' || input.carrierCode === 'CMDU'
}

function isMsc(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'msc' || input.carrierCode === 'MSCU'
}

function parseMscPage(text: string): Partial<TrackResult> {
  const normalized = text.replace(/\u00a0/g, ' ')
  if (!/BOOKING NUMBER|Port of Discharge|Estimated Time of Departure/i.test(normalized)) return {}

  const events = [
    ...normalized.matchAll(
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+([A-Za-z][A-Za-z0-9 ,.'-]{2,40})\s+(Estimated Time of Departure|Estimated Time of Arrival|Full Intended Transshipment|Empty to Shipper)\s+(MSC [A-Z0-9 .'-]+?)\s+([A-Z]{1,3}\d{2,4}[A-Z]|EMPTY)/gi,
    ),
  ]
  const departures = events.filter((event) => /Estimated Time of Departure/i.test(event[3] ?? ''))
  const polDeparture =
    departures.find((event) => /da[-\s]?nang/i.test(event[2] ?? '')) || departures.at(-1)

  const pod =
    normalized.match(/Port of Discharge\s+([A-Za-z0-9 ,.'-]{3,48})/i)?.[1]?.replace(/\s+/g, ' ').trim() ||
    ''

  return {
    etd: polDeparture?.[1] ? formatDate(polDeparture[1]) : '',
    vessel: (polDeparture?.[4] ?? '').replace(/\s+/g, ' ').trim(),
    voyage: /EMPTY/i.test(polDeparture?.[5] ?? '') ? '' : (polDeparture?.[5] ?? '').trim(),
    pod,
  }
}

function isEvergreen(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'evergreen' || input.carrierCode === 'EGLV'
}

function parseEvergreenPage(text: string): Partial<TrackResult> {
  const vesselVoyage = text.match(
    /Vessel Voyage\s+([A-Z][A-Z0-9 .'-]*?)\s+(\d{3,5}-\d{2,4}[A-Z])/i,
  )
  const pod =
    text.match(/Port of Discharge\s+([A-Z][A-Z0-9 ,.'()]{3,48})/i)?.[1]?.trim() ?? ''
  const loadingBlock = text.split(/Port of Discharge/i)[0]?.split(/Port of Loading/i)[1] ?? ''
  const dates = [...loadingBlock.matchAll(/([A-Z]{3}-\d{2}-\d{4})/g)].map((match) => match[1])
  const etdRaw = dates[2] || dates[1] || dates[0] || ''

  return {
    etd: etdRaw ? formatDate(etdRaw.replace(/-/g, ' ')) : '',
    vessel: vesselVoyage?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
    voyage: vesselVoyage?.[2]?.trim() ?? '',
    pod,
  }
}

function portBeforeLastArrival(text: string): string {
  const chunks = text.split(/Vessel arrival/i)
  if (chunks.length < 2) return ''
  const window = chunks[chunks.length - 2].replace(/\s+/g, ' ').trim().slice(-180)
  const duplicated = window.match(
    /\b([A-Za-z][A-Za-z]+(?:\s+[A-Za-z][A-Za-z]+)?)\s+\1\b/i,
  )
  if (duplicated?.[1]) return duplicated[1].replace(/\s+/g, ' ').trim()

  const cleaned = window
    .replace(/Vessel departure[\s\S]*$/i, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d{1,2}\s+[A-Za-z]{3}\s+\d{4}[\s\d:]*/g, ' ')
    .replace(/\b(TERMINAL|LTD|GARDEN|CITY|MODERN|TERMINALS|L\d+)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter((word) => /^[A-Za-z]{3,}$/.test(word))
  return words.slice(-2).join(' ')
}

function isMaersk(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'maersk' || input.carrierCode === 'MAEU'
}

function parseMaerskPage(text: string): Partial<TrackResult> {
  const departure = text.match(
    /Vessel departure\s*\(\s*([^/)]+?)\s*\/\s*([^)]+?)\s*\)\s*(\d{1,2} [A-Za-z]{3} \d{4})/i,
  )

  return {
    etd: departure?.[3] ? formatDate(departure[3]) : '',
    vessel: departure?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
    voyage: departure?.[2]?.trim() ?? '',
    pod: portBeforeLastArrival(text),
  }
}

function parseDcsaEvents(data: unknown): Partial<TrackResult> {
  const events = Array.isArray(data) ? data : []
  let etd = ''
  let vessel = ''
  let voyage = ''
  let pod = ''

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const row = event as Record<string, unknown>
    const transportCall = (row.transportCall ?? {}) as Record<string, unknown>
    const vesselObj = (transportCall.vessel ?? {}) as Record<string, unknown>
    const code = String(row.transportEventTypeCode ?? row.eventTypeCode ?? '')
    const location = asText(transportCall.UNLocationCode ?? transportCall.location ?? '')
    const when = formatDate(row.eventDateTime ?? transportCall.timestamp)
    const vesselName = asText(vesselObj.vesselName ?? vesselObj.name)
    const voy = asText(
      transportCall.exportVoyageNumber ?? transportCall.importVoyageNumber ?? transportCall.carrierVoyageNumber,
    )

    if (vesselName) vessel = vesselName
    if (voy) voyage = voy
    if ((code === 'DEPA' || /depart/i.test(String(row.eventType ?? ''))) && when && !etd) etd = when
    if (code === 'ARRI' || /arriv/i.test(String(row.eventType ?? ''))) {
      if (location) pod = location
    }
    if (!pod && location) pod = location
  }

  const extracted = extractFromData(data)
  return {
    etd: etd || extracted.etd,
    vessel: vessel || extracted.vessel,
    voyage: voyage || extracted.voyage,
    pod: pod || extracted.pod,
  }
}

async function trackViaCmaOfficial(input: TrackInput): Promise<TrackResult | null> {
  if (!isCma(input)) return null
  const apiKey = input.apiKey?.trim() || process.env.CMA_CGM_API_KEY
  if (!apiKey) return null

  const url = new URL('https://apis.cma-cgm.net/operation/trackandtrace/v1/events')
  url.searchParams.set('carrierBookingReference', input.bookingNo)
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': BROWSER_UA,
      'Ocp-Apim-Subscription-Key': apiKey,
      'API-Key': apiKey,
    },
  })
  const text = await response.text()
  if (!response.ok) {
    return emptyResult(
      'error',
      `CMA API ${response.status}: kiểm tra API key trên api-portal.cma-cgm.com`,
    )
  }
  try {
    const extracted = cleanExtracted(parseDcsaEvents(JSON.parse(text)))
    if (!hasResult(extracted)) {
      return emptyResult('not_found', 'CMA API không có sự kiện lịch trình cho booking này.')
    }
    return {
      etd: extracted.etd ?? '',
      vessel: extracted.vessel ?? '',
      voyage: extracted.voyage ?? '',
      pod: extracted.pod ?? '',
      status: 'found',
      message: 'Đã lấy từ CMA CGM Track & Trace API.',
    }
  } catch {
    return emptyResult('error', 'Không đọc được dữ liệu CMA API.')
  }
}

function parseGenericGuestPage(text: string): Partial<TrackResult> {
  const normalized = text.replace(/\u00a0/g, ' ')
  const labeled = (labels: string[]) => {
    for (const label of labels) {
      const match = normalized.match(
        new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]{3,60})`, 'i'),
      )
      const value = match?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
      if (value && !/^(n\/?a|-|—)$/i.test(value)) return value
    }
    return ''
  }

  const vesselVoyage = normalized.match(
    /([A-Z][A-Z0-9 .'-]{3,40})\s*\(\s*([A-Z0-9]{3,14})\s*\)/,
  )

  const etd = labeled(['ETD', 'ATD', 'Estimated Departure', 'Departure Date', 'Khởi hành'])
  const vessel =
    labeled(['Vessel Name', 'Vessel', 'VSL', 'Ship Name', 'Tên tàu']) ||
    vesselVoyage?.[1]?.trim() ||
    ''
  const voyage =
    labeled(['Voyage No', 'Voyage Number', 'Voyage', 'VYG', 'Số chuyến']) ||
    vesselVoyage?.[2]?.trim() ||
    ''
  const pod =
    labeled([
      'Port of Discharge',
      'Port of Destination',
      'Discharge Port',
      'Destination Port',
      'POD',
      'Cảng đến',
    ]) || portBeforeLastArrival(normalized)

  return { etd: etd ? formatDate(etd) : '', vessel, voyage, pod }
}

function parseCmaVesselFromMove(block: string) {
  const tagged = block.match(/([\s\S]{0,160}?)\(\s*([A-Z0-9]{4,14})\s*\)/)
  const voyage = tagged?.[2]?.trim() ?? ''
  const left = (tagged?.[1] ?? block.split('(')[0] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .trim()
  const afterPlace = left.replace(/^.*\b(?:TERMINAL|PORT)\s*\/?\s*/i, '').replace(/^\/\s*/, '').trim()
  const branded = left.match(/((?:CMA CGM|CNC|ANL|APL)[A-Z0-9 .'-]*)$/i)?.[1]?.trim()
  const vessel = (
    afterPlace && afterPlace !== left
      ? afterPlace
      : branded || left.split(' ').slice(-3).join(' ')
  )
    .replace(/^\/\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { vessel, voyage }
}

function parseCmaGuestPage(text: string): Partial<TrackResult> {
  const normalized = text.replace(/\u00a0/g, ' ')
  if (!/Tracking details|Booking reference|PLANNED VESSEL DEPARTURE/i.test(normalized)) {
    return {}
  }

  const pod =
    normalized.match(/POD\s+([A-Z][A-Z0-9 ,.'()]{2,48}(?:\s*\([A-Z]{2}\))?)/i)?.[1]?.replace(/\s+/g, ' ').trim() ||
    ''

  const [beforeFirst = '', afterFirst = ''] = normalized.split(/PLANNED VESSEL DEPARTURE/i)
  const firstSailing = afterFirst.split(/PLANNED VESSEL ARRIVAL/i)[0] ?? ''
  const { vessel, voyage } = parseCmaVesselFromMove(firstSailing)

  const etdBefore = [...beforeFirst.matchAll(/(\d{1,2}-[A-Z]{3}-\d{4})/gi)].at(-1)?.[1]
  const etdAfter = firstSailing.match(/(\d{1,2}-[A-Z]{3}-\d{4})/i)?.[1]
  const etdRaw = etdBefore || etdAfter || ''

  return {
    etd: etdRaw ? formatDate(etdRaw) : '',
    vessel,
    voyage,
    pod,
  }
}

async function trackViaSearates(input: TrackInput): Promise<TrackResult | null> {
  const apiKey = process.env.SEARATES_API_KEY
  if (!apiKey) return null
  const url = new URL('https://tracking.searates.com/tracking')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('number', input.bookingNo)
  url.searchParams.set('type', 'BK')
  url.searchParams.set('route', 'true')
  if (input.carrierCode) url.searchParams.set('sealine', input.carrierCode)
  const { ok, text } = await fetchText(url.toString())
  if (!ok) return emptyResult('error', 'SeaRates không trả dữ liệu.')
  try {
    const extracted = cleanExtracted(extractFromData(JSON.parse(text)))
    if (!hasResult(extracted)) return emptyResult('not_found', 'Hãng chưa có lịch trình cho booking này.')
    return {
      etd: extracted.etd ?? '',
      vessel: extracted.vessel ?? '',
      voyage: extracted.voyage ?? '',
      pod: extracted.pod ?? '',
      status: 'found',
      message: 'Đã lấy ETD / tàu / chuyến / POD.',
    }
  } catch {
    return emptyResult('error', 'Không đọc được dữ liệu SeaRates.')
  }
}

async function launchTrackingBrowser() {
  const { chromium } = await import('playwright')
  const launch = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  }
  try {
    return await chromium.launch({ ...launch, channel: 'chrome' })
  } catch {
    return await chromium.launch(launch)
  }
}

async function dismissConsent(page: import('playwright').Page) {
  const selectors = [
    '#onetrust-accept-btn-handler',
    '#accept-recommended-btn-handler',
    '#coi-banner__selectAll',
    'button:has-text("Allow all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("I Agree")',
    'button:has-text("I Accept")',
    'button:has-text("Agree")',
  ]
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const hit = frame.locator(selector).first()
      if (await hit.isVisible().catch(() => false)) {
        await hit.click({ timeout: 2000 }).catch(() => {})
      }
    }
  }
}

async function loginMsc(
  page: import('playwright').Page,
  loginUser: string,
  loginPassword: string,
): Promise<string | null> {
  await dismissConsent(page)
  await page.locator('#onetrust-accept-btn-handler').click({ timeout: 5000 }).catch(() => {})
  await page.getByRole('button', { name: /^Accept All$/i }).click({ timeout: 3000 }).catch(() => {})

  if (!/b2clogin\.com/i.test(page.url())) {
    await page.getByRole('button', { name: /^myMSC$/i }).click({ timeout: 8000 }).catch(() => {})
    await page.getByRole('link', { name: /sign in|log in/i }).first().click({ timeout: 8000 }).catch(() => {})
    await page.getByRole('button', { name: /sign in|log in/i }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForURL(/b2clogin\.com/i, { timeout: 25000 })
  }

  const email = page
    .getByRole('textbox', { name: /sign in name|sign in email|email/i })
    .or(page.getByPlaceholder(/sign in name|sign in email|email/i))
    .first()
  await email.waitFor({ state: 'visible', timeout: 25000 })
  await email.click()
  await email.fill('')
  await email.fill(loginUser)

  const password = page.getByPlaceholder(/^Password$/i).or(page.locator('input[type="password"]')).first()
  await password.waitFor({ state: 'visible', timeout: 10000 })
  await password.fill(loginPassword)
  await page.getByRole('button', { name: /^Login$/i }).click({ timeout: 8000 })

  await page.waitForURL((url) => /msc\.com/i.test(url.href) && !/b2clogin/i.test(url.href), {
    timeout: 25000,
  })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText().catch(() => '')
  if (/block cookies|can't sign you in/i.test(body)) {
    return 'MSC yêu cầu cookie để đăng nhập. Chrome tracking cần cho phép cookie (không dùng chế độ chặn cookie).'
  }
  if (/invalid|incorrect|unsuccessful|not recognised|not recognized|sai mật khẩu/i.test(body)) {
    return 'Đăng nhập MSC thất bại. Kiểm tra tài khoản / mật khẩu trong menu Hãng tàu.'
  }
  return null
}

async function searchMscAsBooking(page: import('playwright').Page, bookingNo: string) {
  await page.locator('#onetrust-accept-btn-handler').click({ timeout: 5000 }).catch(() => {})
  await page.getByRole('button', { name: /^Accept All$/i }).click({ timeout: 3000 }).catch(() => {})

  const bookingLabel = page.locator('label[for="bookingradio"]').or(page.getByText('Booking Number', { exact: true }))
  await bookingLabel.first().click({ timeout: 8000 }).catch(() => {})
  await page.locator('#bookingradio').check({ force: true }).catch(() => {})
  await page.evaluate(() => {
    const booking = document.querySelector<HTMLInputElement>('#bookingradio')
    const container = document.querySelector<HTMLInputElement>('#containeradio')
    if (container) {
      container.checked = false
      container.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (booking) {
      booking.checked = true
      booking.dispatchEvent(new Event('input', { bubbles: true }))
      booking.dispatchEvent(new Event('change', { bubbles: true }))
      booking.click()
    }
  })

  const box = page.locator('#trackingNumber')
  await box.waitFor({ state: 'visible', timeout: 15000 })
  await box.click()
  await box.fill('')
  await box.fill(bookingNo)

  const stillBl = await page
    .getByPlaceholder(/container\/bill of lading/i)
    .isVisible()
    .catch(() => false)
  if (stillBl) {
    await bookingLabel.first().click({ force: true }).catch(() => {})
    await box.fill(bookingNo)
  }

  await box.press('Enter')
  const searchBtn = page.locator('button.msc-search-autocomplete__search').last()
  await searchBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  if (await searchBtn.isEnabled().catch(() => false)) {
    await searchBtn.click({ timeout: 8000 })
  }
  await page.getByText(/BOOKING NUMBER:/i).first().waitFor({ timeout: 25000 })
  await page.locator('.msc-flow-tracking__more-button').first().click({ force: true, timeout: 8000 })
  await page.getByText(/Estimated Time of Arrival|Estimated Time of Departure/i).first().waitFor({
    timeout: 15000,
  })
  await page.getByRole('button', { name: /^Show all/i }).first().click({ timeout: 5000 }).catch(() => {})
  await page.getByText(/Estimated Time of Departure/i).first().waitFor({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

async function searchMaerskAsBooking(page: import('playwright').Page, bookingNo: string) {
  await page.getByRole('button', { name: /^Allow all$/i }).first().click({ timeout: 6000 }).catch(() => {})
  await dismissConsent(page)
  const box = page
    .getByRole('textbox', { name: /container|bill of lading|booking|shipment/i })
    .or(page.getByPlaceholder(/container|bill of lading|booking/i))
    .first()
  await box.waitFor({ state: 'visible', timeout: 20000 })
  await box.click()
  await box.fill('')
  await box.fill(bookingNo)
  await page.getByRole('button', { name: /^Track$/i }).click({ timeout: 8000 })
  await page.getByText(/Vessel departure\s*\(/i).waitFor({ timeout: 25000 }).catch(() => {})
  await page.getByText(/Vessel arrival/i).last().waitFor({ timeout: 10000 }).catch(() => {})
}

async function acceptCmaCookies(page: import('playwright').Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.locator('#coi-banner__selectAll').click({ timeout: 2500 }).catch(() => {})
    await page.getByRole('button', { name: /^(Allow all|Accept all|Accept All)$/i }).first().click({ timeout: 2500 }).catch(() => {})
    await page.locator('#onetrust-accept-btn-handler').click({ timeout: 2000 }).catch(() => {})
    await dismissConsent(page)
    const boxVisible = await page
      .getByRole('textbox', { name: /container number|shipment ref/i })
      .first()
      .isVisible()
      .catch(() => false)
    if (boxVisible) return
    await page.waitForTimeout(1200)
  }
}

async function loginCma(
  page: import('playwright').Page,
  loginUser: string,
  loginPassword: string,
): Promise<string | null> {
  await page.getByRole('link', { name: /^Log In$/i }).first().click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const email = page
    .locator('input[type="email"]')
    .or(page.getByLabel(/email|user(name)?/i))
    .first()
  const visible = await email.isVisible().catch(() => false)
  if (!visible) return null
  await email.fill(loginUser)
  await page.locator('input[type="password"]').first().fill(loginPassword)
  await page.getByRole('button', { name: /^(log in|sign in|connexion)$/i }).first().click({ timeout: 8000 })
  await page.waitForTimeout(4000)
  const body = await page.locator('body').innerText().catch(() => '')
  if (/invalid|incorrect|unsuccessful|not recognised|not recognized/i.test(body)) {
    return 'Đăng nhập CMA thất bại. Kiểm tra tài khoản / mật khẩu trong menu Hãng tàu.'
  }
  return null
}

async function searchCmaAsBooking(page: import('playwright').Page, bookingNo: string) {
  await acceptCmaCookies(page)

  const box = page.getByRole('textbox', { name: /container number|shipment ref/i })
  await box.first().waitFor({ state: 'visible', timeout: 25000 })
  await box.first().click()
  await box.first().fill('')
  await box.first().fill(bookingNo)
  await page.getByRole('button', { name: /^Search$/i }).first().click({ timeout: 8000 })

  await Promise.race([
    page.getByText(/Tracking details/i).first().waitFor({ timeout: 25000 }),
    page.getByText(/PLANNED VESSEL DEPARTURE/i).first().waitFor({ timeout: 25000 }),
    page.getByText(/Booking reference/i).first().waitFor({ timeout: 25000 }),
    page.getByText(/Display Details/i).first().waitFor({ timeout: 25000 }),
    page.getByText(/Your shipment was not found/i).waitFor({ timeout: 25000 }),
  ]).catch(() => {})

  const alreadyOpen = await page
    .getByText(/PLANNED VESSEL DEPARTURE|Tracking details/i)
    .first()
    .isVisible()
    .catch(() => false)
  if (!alreadyOpen) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.evaluate((index) => {
        const exact = [...document.querySelectorAll('label, span, button, a, div')].find(
          (el) => (el.textContent || '').trim() === 'Display Details',
        )
        if (exact) {
          exact.click()
          return
        }
        const boxes = [...document.querySelectorAll('input[type="checkbox"]')]
        boxes[index]?.click()
      }, attempt)
      const opened = await page
        .getByText(/PLANNED VESSEL DEPARTURE/i)
        .first()
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false)
      if (opened) break
    }
  }
  await page.waitForTimeout(1500)
}

async function loginCosco(
  page: import('playwright').Page,
  loginUser: string,
  loginPassword: string,
): Promise<string | null> {
  await page.getByRole('link', { name: /login/i }).first().click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const userBox = page
    .locator('input[type="text"], input[type="email"], input[name*="user" i], input[name*="account" i]')
    .first()
  await userBox.waitFor({ state: 'visible', timeout: 15000 })
  await userBox.fill(loginUser)
  await page.locator('input[type="password"]').first().fill(loginPassword)
  await page.getByRole('button', { name: /^(log in|login|sign in|submit)$/i }).first().click({ timeout: 8000 })
  await page.waitForTimeout(4000)
  const body = await page.locator('body').innerText().catch(() => '')
  if (/invalid|incorrect|unsuccessful|wrong password|验证码|captcha/i.test(body)) {
    return 'Đăng nhập COSCO thất bại. Kiểm tra tài khoản / mật khẩu (và captcha nếu có) trong menu Hãng tàu.'
  }
  return null
}

async function searchCoscoAsBooking(page: import('playwright').Page, bookingNo: string) {
  await page.getByRole('button', { name: /^Allow All$/i }).first().click({ timeout: 8000 }).catch(() => {})
  await dismissConsent(page)
  await page.waitForTimeout(2500)

  await page.locator('iframe[src*="scct"]').first().waitFor({ state: 'attached', timeout: 20000 })
  const frame = page.frameLocator('iframe[src*="scct"]').first()
  await frame.getByText('Cargo Tracking').first().waitFor({ timeout: 20000 })

  await frame.locator('.ant-select-selector').first().click({ timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(400)
  await frame.locator('.ant-select-item-option-content', { hasText: /^booking$/i }).click({ timeout: 4000 }).catch(
    async () => {
      await frame.getByText(/^booking$/i).last().click({ timeout: 3000 }).catch(() => {})
    },
  )

  const box = frame.getByRole('textbox')
  await box.first().waitFor({ state: 'visible', timeout: 15000 })
  await box.first().click()
  await box.first().fill('')
  await box.first().fill(bookingNo)
  await frame.getByRole('button', { name: /^Search$/i }).click({ timeout: 8000 })

  await Promise.race([
    frame.getByText(/No results found/i).waitFor({ timeout: 25000 }),
    frame.getByText(/Schedule Detail/i).waitFor({ timeout: 25000 }),
    frame.getByText(/Booking Information/i).waitFor({ timeout: 25000 }),
  ]).catch(() => {})
  await page.waitForTimeout(1500)
}

async function searchOneAsBooking(page: import('playwright').Page, bookingNo: string) {
  await page.getByRole('button', { name: /^Accept All$/i }).click({ timeout: 8000 }).catch(() => {})
  await dismissConsent(page)
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /^Skip$/i }).click({ timeout: 6000 }).catch(() => {})
  await page.getByRole('button', { name: /^Skip$/i }).click({ timeout: 2000 }).catch(() => {})
  await page.waitForTimeout(800)

  const box = page.getByPlaceholder(/Search by BL No\. or Booking No/i)
  await box.waitFor({ state: 'visible', timeout: 20000 })
  await box.click()
  await box.fill('')
  await box.fill(bookingNo)
  await page
    .getByRole('textbox', { name: /Search by BL No\. or Booking No/i })
    .press('Enter')
    .catch(async () => {
      await page.getByRole('button', { name: /^Search$/i }).nth(1).click({ timeout: 5000 })
    })

  await page.getByRole('cell', { name: bookingNo }).first().waitFor({ timeout: 25000 })
  await page.waitForTimeout(1000)
  await page.locator('[data-testid="tnt-cargo-tracking-table"] [class*="TableColumn_arrow"]').first().click({
    force: true,
    timeout: 8000,
  })
  await page.getByText(/Sailing Information|Vessel Departure from Port of Loading/i).first().waitFor({
    timeout: 20000,
  })
  await page.waitForTimeout(1500)
}

async function searchZimAsBooking(page: import('playwright').Page, bookingNo: string) {
  await page.getByRole('button', { name: /^I Agree$/i }).click({ timeout: 8000 }).catch(() => {})
  await dismissConsent(page)
  await page.waitForTimeout(800)

  const box = page.locator('#shipment-main-search-2').or(page.getByRole('textbox', { name: /shipping tracking/i }))
  await box.first().waitFor({ state: 'visible', timeout: 20000 })
  await box.first().click()
  await box.first().fill('')
  await box.first().fill(bookingNo)
  await page.locator('.chips-search-button').click({ timeout: 8000 }).catch(async () => {
    await page.getByRole('button', { name: /^Search$/i }).first().click({ timeout: 5000 })
  })
  await page.getByText(/Port of Discharge \(POD\)|Vessel \/ Voyage/i).first().waitFor({ timeout: 25000 })
  await page.waitForTimeout(1500)
}

async function fillBookingAndSearch(page: import('playwright').Page, bookingNo: string) {
  await page.locator('#bookingradio').click({ timeout: 2000 }).catch(() => {})
  await page.getByRole('radio', { name: /booking/i }).first().click({ timeout: 3000 }).catch(() => {})
  await page
    .getByRole('combobox', { name: /search by|track by|type/i })
    .selectOption({ label: 'Booking' })
    .catch(() => {})

  const box = page
    .getByRole('textbox', {
      name: /booking|container|shipment|bill of lading|b\/l|reference|tracking/i,
    })
    .or(page.getByPlaceholder(/booking|container|bill|reference|tracking|ABCD/i))
    .or(page.locator('input[type="text"]:visible, input[type="search"]:visible'))
    .first()

  if (!(await box.isVisible().catch(() => false))) return false
  await box.click({ timeout: 8000 })
  await box.fill('')
  await box.fill(bookingNo)

  const mscSearch = page.locator('button.msc-search-autocomplete__search').last()
  if (await mscSearch.isVisible().catch(() => false)) {
    await box.press('Enter')
    if (await mscSearch.isEnabled().catch(() => false)) {
      await mscSearch.click()
    }
    return true
  }
  const search = page.getByRole('button', { name: /^(search|track|submit|go|find|tra cứu)$/i }).first()
  if (await search.isVisible().catch(() => false)) {
    await search.click()
    return true
  }
  await box.press('Enter').catch(() => {})
  return true
}

function carrierLandingUrl(input: TrackInput) {
  if (isCma(input)) return 'https://www.cma-cgm.com/ebusiness/tracking'
  if (isMsc(input)) return 'https://www.msc.com/en/track-a-shipment'
  if (isCosco(input)) return 'https://elines.coscoshipping.com/ebusiness/cargoTracking'
  if (isEvergreen(input)) return 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do'
  if (isMaersk(input)) return 'https://www.maersk.com/tracking'
  if (isOne(input)) return 'https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking'
  if (isZim(input)) return 'https://www.zim.com/tools/track-a-shipment'
  const raw = input.trackingUrl.trim()
  if (!raw) return raw
  try {
    const url = new URL(raw.replaceAll('{booking}', ''))
    for (const key of [...url.searchParams.keys()]) {
      const value = url.searchParams.get(key) ?? ''
      if (
        !value ||
        value.includes('{booking}') ||
        /^(booking|bookingno|blno|number|numbers|no|reference|searchby|search|tracking-number|trackingnumber|trackingtype|params|type)$/i.test(
          key,
        )
      ) {
        url.searchParams.delete(key)
      }
    }
    url.pathname = url.pathname.replace(/\/tracking\/[^/]+$/i, '/tracking')
    url.hash = ''
    const search = url.searchParams.toString()
    return `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}${search ? `?${search}` : ''}`
  } catch {
    return raw.replaceAll('{booking}', '').replace(/\?.*$/, '')
  }
}

function mergeExtracted(...parts: Partial<TrackResult>[]): Partial<TrackResult> {
  const merged: Partial<TrackResult> = {}
  for (const part of parts) {
    if (part.etd && !merged.etd) merged.etd = part.etd
    if (part.vessel && !merged.vessel) merged.vessel = part.vessel
    if (part.voyage && !merged.voyage) merged.voyage = part.voyage
    if (part.pod && !merged.pod) merged.pod = part.pod
  }
  return cleanExtracted(merged)
}

async function trackViaBrowser(input: TrackInput): Promise<TrackResult | null> {
  if (!input.trackingUrl || input.trackingUrl.includes('google.com')) return null

  return enqueueBrowser(async () => {
    try {
      await import('playwright')
    } catch {
      return null
    }

    let browser: Awaited<ReturnType<typeof launchTrackingBrowser>> | undefined
    let context: import('playwright').BrowserContext | undefined
    try {
      browser = await launchTrackingBrowser()
      context = await browser.newContext({
        viewport: { width: 1360, height: 900 },
        locale: 'en-US',
        userAgent: BROWSER_UA,
      })
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
      const page = await context.newPage()
      page.setDefaultTimeout(25000)

      let fromNetwork: Partial<TrackResult> = {}
      page.on('response', async (response) => {
        try {
          const type = response.headers()['content-type'] ?? ''
          const url = response.url()
          if (!type.includes('json')) return
          if (/cookie|onetrust|datadome|analytics|gtm|google-analytics|facebook|lang\/dict|zipkin|survey|userMenu|userInfo/i.test(url)) return
          if (isCosco(input) && !/cargoTracking|shipment/i.test(url)) return
          const extracted = cleanExtracted(extractFromData(await response.json()))
          if (hasResult(extracted)) fromNetwork = mergeExtracted(fromNetwork, extracted)
        } catch {
          /* ignore non-json or closed responses */
        }
      })

      const targetUrl = carrierLandingUrl(input)
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      await page.locator('#coi-banner__selectAll').click({ timeout: 5000 }).catch(() => {})
      await dismissConsent(page)
      await page.getByRole('button', { name: /^Allow all$/i }).first().click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(2500)

      if (isCma(input)) {
        await acceptCmaCookies(page)
        const user = input.loginUser?.trim() ?? ''
        const password = input.loginPassword ?? ''
        if (input.requiresLogin && (!user || !password)) {
          return emptyResult(
            'error',
            'CMA cần đăng nhập. Bật “Cần đăng nhập” và lưu tài khoản ở menu Hãng tàu.',
          )
        }
        const loginLink = page.getByRole('link', { name: /^Log In$/i }).first()
        const needsLogin = (await loginLink.isVisible().catch(() => false)) && Boolean(user && password)
        if (needsLogin || (input.requiresLogin && user && password)) {
          const loginError = await loginCma(page, user, password)
          if (loginError) return emptyResult('error', loginError)
          await page.goto('https://www.cma-cgm.com/ebusiness/tracking', {
            waitUntil: 'domcontentloaded',
          })
          await page.waitForTimeout(2000)
          await acceptCmaCookies(page)
        }
        await searchCmaAsBooking(page, input.bookingNo)
      } else if (isCosco(input)) {
        await page.getByRole('button', { name: /^Allow All$/i }).first().click({ timeout: 8000 }).catch(() => {})
        const user = input.loginUser?.trim() ?? ''
        const password = input.loginPassword ?? ''
        if (input.requiresLogin && (!user || !password)) {
          return emptyResult(
            'error',
            'COSCO cần đăng nhập. Bật “Cần đăng nhập” và lưu tài khoản ở menu Hãng tàu.',
          )
        }
        const loginLink = page.getByRole('link', { name: /login/i }).first()
        const needsLogin = (await loginLink.isVisible().catch(() => false)) && Boolean(user && password)
        if (needsLogin || (input.requiresLogin && user && password)) {
          const loginError = await loginCosco(page, user, password)
          if (loginError) return emptyResult('error', loginError)
          await page.goto('https://elines.coscoshipping.com/ebusiness/cargoTracking', {
            waitUntil: 'domcontentloaded',
          })
          await page.waitForTimeout(2000)
        }
        await searchCoscoAsBooking(page, input.bookingNo)
      } else if (isMaersk(input)) {
        await searchMaerskAsBooking(page, input.bookingNo)
      } else if (isMsc(input)) {
        const user = input.loginUser?.trim() ?? ''
        const password = input.loginPassword ?? ''
        if (input.requiresLogin && (!user || !password)) {
          return emptyResult(
            'error',
            'MSC cần đăng nhập. Bật “Cần đăng nhập” và lưu tài khoản ở menu Hãng tàu (cùng trình duyệt đang mở localhost).',
          )
        }
        if (user && password) {
          const loginError = await loginMsc(page, user, password)
          if (loginError) return emptyResult('error', loginError)
          await page.goto('https://www.msc.com/en/track-a-shipment', { waitUntil: 'domcontentloaded' })
          await page.waitForTimeout(2000)
        }
        await searchMscAsBooking(page, input.bookingNo)
        const afterSearch = await page.locator('body').innerText().catch(() => '')
        if (
          !user &&
          /please (sign|log) in|login required|sign in to (view|track)/i.test(afterSearch)
        ) {
          return emptyResult(
            'error',
            'MSC yêu cầu đăng nhập cho booking này. Vào Hãng tàu → MSC → bật “Cần đăng nhập”, lưu user/pass, rồi Check lại trên http://localhost:5187/booking-check/',
          )
        }
      } else if (isEvergreen(input)) {
        await page.getByRole('button', { name: /^Accept All$/i }).click({ timeout: 4000 }).catch(() => {})
        await page.getByRole('radio', { name: /booking no/i }).click({ timeout: 8000 })
        await page.evaluate((booking) => {
          const form = (document as Document & { frmCargo?: HTMLFormElement }).frmCargo
          if (!form) return
          const sel = form.elements.namedItem('SEL')
          const radios = sel && 'length' in sel ? (sel as RadioNodeList) : null
          if (radios) {
            for (let i = 0; i < radios.length; i += 1) {
              const radio = radios.item(i) as HTMLInputElement | null
              if (radio && /bk/i.test(radio.value)) radio.checked = true
            }
          }
          const noField = form.elements.namedItem('NO')
          if (noField && 'length' in noField) {
            const list = noField as RadioNodeList
            for (let i = 0; i < list.length; i += 1) {
              const inputEl = list.item(i) as HTMLInputElement | null
              if (inputEl) inputEl.value = i === list.length - 1 ? booking : ''
            }
          } else if (noField) {
            ;(noField as HTMLInputElement).value = booking
          }
          const fn = (window as unknown as { frmSubmit?: (key: number, flag: number) => void }).frmSubmit
          fn?.(13, 2)
        }, input.bookingNo)
        await page.waitForLoadState('domcontentloaded')
        await page.getByText('Vessel Voyage', { exact: true }).first().waitFor({ timeout: 25000 })
      } else if (isOne(input)) {
        const user = input.loginUser?.trim() ?? ''
        const password = input.loginPassword ?? ''
        if (input.requiresLogin && (!user || !password)) {
          return emptyResult(
            'error',
            'ONE cần đăng nhập. Bật “Cần đăng nhập” và lưu tài khoản ở menu Hãng tàu.',
          )
        }
        if (user && password) {
          await page.getByRole('button', { name: /^Login$/i }).click({ timeout: 5000 }).catch(() => {})
          await page.locator('input[type="text"], input[type="email"]').first().fill(user).catch(() => {})
          await page.locator('input[type="password"]').first().fill(password).catch(() => {})
          await page.getByRole('button', { name: /^(log in|login|sign in)$/i }).first().click({ timeout: 8000 }).catch(() => {})
          await page.waitForTimeout(3000)
          await page.goto('https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking', {
            waitUntil: 'domcontentloaded',
          })
          await page.waitForTimeout(2000)
        }
        await searchOneAsBooking(page, input.bookingNo)
      } else if (isZim(input)) {
        await searchZimAsBooking(page, input.bookingNo)
      } else {
        await fillBookingAndSearch(page, input.bookingNo)
        await Promise.race([
          page.getByText(/Tracking details|Booking reference|Vessel departure\s*\(/i).waitFor({
            timeout: 20000,
          }),
          page.getByText(/not found|no result|invalid|không tìm thấy/i).waitFor({ timeout: 20000 }),
          page.waitForTimeout(12000),
        ]).catch(() => {})
      }
      await page.waitForTimeout(1500)

      const html = await page.content()
      let text = await page.locator('body').innerText()
      if (isCosco(input)) {
        const scct = page.frames().find((frame) => /scct/.test(frame.url()))
        const frameText = scct ? await scct.locator('body').innerText().catch(() => '') : ''
        text = `${text}\n${frameText}`
      }
      const cleaned = mergeExtracted(
        isCma(input) ? parseCmaGuestPage(text) : {},
        isMsc(input) ? parseMscPage(text) : {},
        isOne(input) ? parseOnePage(text) : {},
        isZim(input) ? parseZimPage(text) : {},
        isMsc(input) || isZim(input) || isCma(input) ? {} : fromNetwork,
        isCosco(input) ? parseCoscoPage(text) : {},
        isMaersk(input) ? parseMaerskPage(text) : {},
        isEvergreen(input) ? parseEvergreenPage(text) : {},
        isMsc(input) || isCosco(input) || isOne(input) || isZim(input) || isCma(input) ? {} : parseGenericGuestPage(text),
        isMsc(input) || isCosco(input) || isOne(input) || isZim(input) || isCma(input) ? {} : parsePayload('text/html', `${html}\n${text}`),
      )

      if (/please (sign|log) in|login required|sign in to (view|track)/i.test(text)) {
        return emptyResult(
          'error',
          'Trang hãng vẫn yêu cầu đăng nhập. Lưu tài khoản ở Hãng tàu rồi check lại trên npm run dev.',
        )
      }
      if (/No results found for this Booking number/i.test(text)) {
        return emptyResult(
          'not_found',
          'MSC đã tra theo Booking Number nhưng không có lịch cho số này.',
        )
      }
      if (hasResult(cleaned)) {
        return {
          etd: cleaned.etd ?? '',
          vessel: cleaned.vessel ?? '',
          voyage: cleaned.voyage ?? '',
          pod: cleaned.pod ?? '',
          status: 'found',
          message: 'Đã mở web hãng, nhập booking, đọc lịch rồi đóng tab.',
        }
      }
      if (/not found|no result|invalid tracking/i.test(text) && !/Tracking details/i.test(text)) {
        return emptyResult('not_found', 'Trang hãng báo không tìm thấy booking.')
      }
      return emptyResult('not_found', 'Đã mở web hãng nhưng chưa đọc được ETD / tàu / chuyến / POD.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'không rõ lỗi'
      return emptyResult('error', `Không điều khiển được Chrome tracking: ${detail}`)
    } finally {
      await context?.close().catch(() => {})
      await browser?.close().catch(() => {})
    }
  })
}

export async function trackShipment(input: TrackInput): Promise<TrackResult> {
  const bookingNo = input.bookingNo.trim()
  if (!bookingNo) return emptyResult('error', 'Thiếu số booking.')

  try {
    const cma = await trackViaCmaOfficial(input)
    if (cma) return cma

    const fromBrowser = await trackViaBrowser(input)
    if (fromBrowser) return fromBrowser

    const searates = await trackViaSearates(input)
    if (searates) return searates

    return emptyResult(
      'not_found',
      'Đã mở web hãng theo quy trình tra tay nhưng chưa đọc được ETD / tàu / chuyến / POD.',
    )
  } catch {
    return emptyResult('error', 'Lỗi khi gọi trang tracking của hãng.')
  }
}
