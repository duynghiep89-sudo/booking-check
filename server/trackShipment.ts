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
    if (/(pol).*(etd|departure)|etd.*(pol)|estimateddeparture|departuredate|atd/.test(k)) return 3
    if (/(^|_)etd(_|$)|departure/.test(k)) return 2
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
    /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/.test(
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

function isCma(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'cma-cgm' || input.carrierCode === 'CMDU'
}

function isMsc(input: TrackInput) {
  const id = (input.carrierId ?? '').toLowerCase()
  return id === 'msc' || input.carrierCode === 'MSCU'
}

function mscBookingUrl(bookingNo: string) {
  const raw = `trackingNumber=${bookingNo.trim()}&trackingMode=1`
  return `https://www.msc.com/en/track-a-shipment?params=${Buffer.from(raw).toString('base64')}`
}

function parseMscPage(text: string): Partial<TrackResult> {
  const labeled = (labels: string[]) => {
    for (const label of labels) {
      const match = text.match(new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]{3,60})`, 'i'))
      const value = match?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
      if (value && !/^(n\/?a|-|—)$/i.test(value) && !isLabelValue(value)) return value
    }
    return ''
  }
  return {
    etd: formatDate(labeled(['Estimated Time of Departure', 'Estimated Departure', 'ETD'])),
    vessel: labeled(['Vessel Name', 'Vessel']),
    voyage: labeled(['Voyage Number', 'Voyage']),
    pod: labeled(['Port of Discharge', 'Discharge Port', 'POD']),
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

function parseCmaGuestPage(text: string): Partial<TrackResult> {
  const normalized = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
  if (!/Tracking details/i.test(normalized) && !/Booking reference/i.test(normalized)) {
    return {}
  }

  const pod =
    normalized.match(/\bPOD\s*\n\s*([A-Za-z0-9 ,.'()/-]{3,48})/i)?.[1]?.trim() ||
    normalized.match(/\bPOD\s+([A-Z][A-Za-z0-9 ,.'()/-]{2,48})/i)?.[1]?.trim() ||
    ''

  const idx = normalized.search(/PLANNED VESSEL DEPARTURE/i)
  const before = idx >= 0 ? normalized.slice(Math.max(0, idx - 90), idx) : ''
  const dates = [...before.matchAll(/(\w{3,9},?\s+\d{1,2}-[A-Z]{3}-\d{4})/g)]
  const etdRaw = dates.at(-1)?.[1]?.trim() ?? ''

  const vesselMatch = normalized.match(
    /((?:CMA CGM|CNC|ANL|APL)[A-Z0-9 .'-]{2,40})\s*\(\s*([A-Z0-9]{4,14})\s*\)/i,
  )

  return {
    etd: etdRaw ? formatDate(etdRaw) : '',
    vessel: vesselMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
    voyage: vesselMatch?.[2]?.trim() ?? '',
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

async function fillBookingAndSearch(page: import('playwright').Page, bookingNo: string) {
  await page.locator('#bookingradio').click({ timeout: 2000 }).catch(() => {})
  await page.getByRole('radio', { name: /booking/i }).first().click({ timeout: 3000 }).catch(() => {})
  await page
    .getByRole('combobox', { name: /search by|track by|type/i })
    .selectOption({ label: /^booking/i })
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

  const mscSearch = page.locator('.msc-search-autocomplete__search')
  if (await mscSearch.isVisible().catch(() => false)) {
    await mscSearch.click()
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
      page.setDefaultTimeout(45000)

      let fromNetwork: Partial<TrackResult> = {}
      page.on('response', async (response) => {
        try {
          const type = response.headers()['content-type'] ?? ''
          const url = response.url()
          if (!type.includes('json')) return
          if (/cookie|onetrust|datadome|analytics|gtm|google-analytics|facebook/i.test(url)) return
          const extracted = cleanExtracted(extractFromData(await response.json()))
          if (hasResult(extracted)) fromNetwork = mergeExtracted(fromNetwork, extracted)
        } catch {
          /* ignore non-json or closed responses */
        }
      })

      const targetUrl = isCma(input)
        ? 'https://www.cma-cgm.com/ebusiness/tracking'
        : isEvergreen(input)
          ? 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do'
          : isMsc(input)
            ? mscBookingUrl(input.bookingNo)
            : input.trackingUrl
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      await page.locator('#coi-banner__selectAll').click({ timeout: 5000 }).catch(() => {})
      await dismissConsent(page)
      await page.getByRole('button', { name: /^Allow all$/i }).first().click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(2500)

      if (isMaersk(input)) {
        await page.getByRole('button', { name: /^Track$/i }).click({ timeout: 5000 }).catch(() => {})
        await page.getByText(/Vessel departure\s*\(/i).waitFor({ timeout: 25000 }).catch(() => {})
        await page.getByText(/Vessel arrival/i).last().waitFor({ timeout: 10000 }).catch(() => {})
      } else if (isMsc(input)) {
        await page.locator('#onetrust-accept-btn-handler').click({ timeout: 6000 }).catch(() => {})
        await page.getByRole('button', { name: /^Accept All$/i }).click({ timeout: 4000 }).catch(() => {})
        await page.locator('#bookingradio').click({ timeout: 8000 }).catch(() => {})
        await page.locator('label[for="bookingradio"]').click({ timeout: 4000 }).catch(() => {})
        const box = page.locator('#trackingNumber')
        await box.waitFor({ state: 'visible', timeout: 15000 })
        await box.fill(input.bookingNo)
        await page.locator('.msc-search-autocomplete__search').click({ timeout: 8000 }).catch(() => {})
        await Promise.race([
          page.getByText(/Port of Discharge|Bill of Lading/i).first().waitFor({ timeout: 20000 }),
          page.getByText(/No results found for this Booking number/i).waitFor({ timeout: 20000 }),
        ]).catch(() => {})
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
      } else {
        const landing = await page.locator('body').innerText().catch(() => '')
        const alreadyListed =
          landing.toUpperCase().includes(input.bookingNo.trim().toUpperCase()) &&
          /Vessel departure|Tracking details|Booking reference/i.test(landing)
        if (!alreadyListed) {
          await fillBookingAndSearch(page, input.bookingNo)
        }
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
      const text = await page.locator('body').innerText()
      const cleaned = mergeExtracted(
        fromNetwork,
        isMsc(input) ? parseMscPage(text) : {},
        isCma(input) ? parseCmaGuestPage(text) : {},
        isMaersk(input) ? parseMaerskPage(text) : {},
        isEvergreen(input) ? parseEvergreenPage(text) : {},
        isMsc(input) ? {} : parseGenericGuestPage(text),
        parsePayload('text/html', `${html}\n${text}`),
      )

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
