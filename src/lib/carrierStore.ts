import { DEFAULT_CARRIERS, type Carrier } from '../data/carriers'

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

export function loadCarriers(): Carrier[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CARRIERS.map((item) => ({ ...item, aliases: [...item.aliases] }))
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isCarrier)) {
      return DEFAULT_CARRIERS.map((item) => ({ ...item, aliases: [...item.aliases] }))
    }
    return parsed.map((item) => {
      const next = {
        ...item,
        aliases: item.aliases.map((alias) => String(alias)),
        apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
        requiresLogin: Boolean(item.requiresLogin),
        loginUser: typeof item.loginUser === 'string' ? item.loginUser : '',
        loginPassword: typeof item.loginPassword === 'string' ? item.loginPassword : '',
      }
      const fallback = DEFAULT_CARRIERS.find((carrier) => carrier.id === next.id)
      if (
        fallback &&
        /\{booking\}|[?&](number|numbers|no|blno|bookingNo|booking|tracking-number|Reference|params|trackingType)=|\/tracking\/[^/?]+$|ecomm\.one-line/i.test(
          next.trackingUrlTemplate,
        )
      ) {
        next.trackingUrlTemplate = fallback.trackingUrlTemplate
      }
      return next
    })
  } catch {
    return DEFAULT_CARRIERS.map((item) => ({ ...item, aliases: [...item.aliases] }))
  }
}

export function saveCarriers(carriers: Carrier[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(carriers))
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
