import {
  buildTrackingUrl,
  inferGenericSearchUrl,
  type Carrier,
} from '../data/carriers'
import { normalizeKey } from './text'

export type CarrierMatch = {
  carrier: Carrier | null
  status: 'matched' | 'unknown'
  trackingUrl: string
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = current
    }
  }
  return row[b.length]
}

function matchNames(carrier: Carrier): string[] {
  return [carrier.name, carrier.code, ...carrier.aliases]
    .map(normalizeKey)
    .filter(Boolean)
}

export function matchCarrier(
  rawName: string,
  bookingNo: string,
  carriers: Carrier[],
): CarrierMatch {
  const booking = bookingNo.trim()
  const key = normalizeKey(rawName)

  if (!key) {
    return {
      carrier: null,
      status: 'unknown',
      trackingUrl: inferGenericSearchUrl(rawName, booking),
    }
  }

  for (const carrier of carriers) {
    const names = matchNames(carrier)
    if (names.includes(key)) {
      return {
        carrier,
        status: 'matched',
        trackingUrl:
          buildTrackingUrl(carrier.trackingUrlTemplate, booking) ||
          inferGenericSearchUrl(carrier.name, booking),
      }
    }
  }

  const tokens = key.split(' ').filter(Boolean)
  for (const carrier of carriers) {
    const names = matchNames(carrier)
    const hit = names.some((name) => {
      if (name.length >= 5 && (key.includes(name) || name.includes(key))) return true
      const nameTokens = name.split(' ').filter(Boolean)
      return nameTokens.some((token) => token.length >= 3 && tokens.includes(token))
    })
    if (hit) {
      return {
        carrier,
        status: 'matched',
        trackingUrl: buildTrackingUrl(carrier.trackingUrlTemplate, booking),
      }
    }
  }

  let best: { carrier: Carrier; distance: number } | null = null
  for (const carrier of carriers) {
    const names = matchNames(carrier)
    for (const name of names) {
      if (name.length < 3) continue
      const distance = levenshtein(key, name)
      const threshold = name.length <= 4 ? 1 : 2
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { carrier, distance }
      }
    }
  }

  if (best) {
    return {
      carrier: best.carrier,
      status: 'matched',
      trackingUrl: buildTrackingUrl(best.carrier.trackingUrlTemplate, booking),
    }
  }

  return {
    carrier: null,
    status: 'unknown',
    trackingUrl: inferGenericSearchUrl(rawName, booking),
  }
}
