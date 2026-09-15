import { DEFAULT_CARRIERS, stripBookingFromTrackingUrl, type Carrier } from '../data/carriers'

const STORAGE_KEY = 'booking-check.carriers.v1'

function isCarrier(value: unknown): value is Carrier {
  if (!value || typeof value !== 'object') return false
  const row = value as Carrier
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.code === 'string' &&
    typeof row.trackingUrlTemplate === 'string' &&
    Array.isArray(row.aliases)
  )
}

function normalizeCarrier(item: Carrier): Carrier {
  const fallback = DEFAULT_CARRIERS.find((carrier) => carrier.id === item.id)
  return {
    ...item,
    aliases: item.aliases.map((alias) => String(alias)),
    apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
    requiresLogin: Boolean(item.requiresLogin),
    loginUser: typeof item.loginUser === 'string' ? item.loginUser : '',
    loginPassword: typeof item.loginPassword === 'string' ? item.loginPassword : '',
    // Hãng mặc định: luôn dùng landing sạch (không kèm booking).
    trackingUrlTemplate: fallback
      ? fallback.trackingUrlTemplate
      : stripBookingFromTrackingUrl(item.trackingUrlTemplate),
  }
}

export function loadCarriers(): Carrier[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CARRIERS.map((item) => ({ ...item, aliases: [...item.aliases] }))
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isCarrier)) {
      return DEFAULT_CARRIERS.map((item) => ({ ...item, aliases: [...item.aliases] }))
    }

    const loaded = parsed.map((item) => normalizeCarrier(item))
    const seen = new Set(loaded.map((item) => item.id))
    for (const fallback of DEFAULT_CARRIERS) {
      if (!seen.has(fallback.id)) {
        loaded.push({ ...fallback, aliases: [...fallback.aliases] })
      }
    }
    return loaded
  } catch {
    return DEFAULT_CARRIERS.map((item) => ({ ...item, aliases: [...item.aliases] }))
  }
}

export function saveCarriers(carriers: Carrier[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      carriers.map((item) => ({
        ...item,
        trackingUrlTemplate: stripBookingFromTrackingUrl(item.trackingUrlTemplate),
      })),
    ),
  )
}

export function newCarrierId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'carrier'}-${Date.now()}`
}

export function parseAliases(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))]
}
