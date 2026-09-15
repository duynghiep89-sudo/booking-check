;(() => {
  function formatDate(value) {
    if (value == null || value === '') return ''
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

  function parseCmaVesselFromMove(block) {
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

  function parseCmaGuestPage(text) {
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

  function parseMscPage(text) {
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

  function parseOnePage(text) {
    const normalized = text.replace(/\u00a0/g, ' ')
    if (!/Recent Track|Booking Ref|Sailing Information|Search by BL No/i.test(normalized)) return {}
    const sailing = normalized.split(/Sailing Information/i)[1] ?? ''
    const firstLeg = sailing.match(/([A-Z][A-Z0-9 .'-]{2,40}?)\s+(\d{2,4}[A-Z])\s+\([A-Z]{2,6}\)/)
    const etdRaw =
      normalized.match(/Vessel Departure from Port of Loading\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ||
      sailing.match(/Port of Loading[\s\S]{0,120}?(\d{4}-\d{2}-\d{2})/)?.[1] ||
      ''
    const pod =
      normalized.match(/Place of Delivery\s+([A-Za-z0-9 ,.'-]{3,60})/i)?.[1]?.replace(/, UNITED STATES/i, '').trim() ||
      ''
    return {
      etd: etdRaw ? formatDate(etdRaw) : '',
      vessel: firstLeg?.[1]?.replace(/\s+/g, ' ').trim() || '',
      voyage: firstLeg?.[2]?.trim() || '',
      pod,
    }
  }

  function parseZimPage(text) {
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

  function parseCoscoPage(text) {
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

  function parseMaerskPage(text) {
    const departure = text.match(
      /Vessel departure\s*\(\s*([^/)]+?)\s*\/\s*([^)]+?)\s*\)\s*(\d{1,2} [A-Za-z]{3} \d{4})/i,
    )
    const chunks = text.split(/Vessel arrival/i)
    let pod = ''
    if (chunks.length >= 2) {
      const windowText = chunks[chunks.length - 2].replace(/\s+/g, ' ').trim().slice(-180)
      const duplicated = windowText.match(/\b([A-Za-z][A-Za-z]+(?:\s+[A-Za-z][A-Za-z]+)?)\s+\1\b/i)
      pod = duplicated?.[1]?.replace(/\s+/g, ' ').trim() || ''
    }
    return {
      etd: departure?.[3] ? formatDate(departure[3]) : '',
      vessel: departure?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
      voyage: departure?.[2]?.trim() ?? '',
      pod,
    }
  }

  function parseEvergreenPage(text) {
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

  function parseGeneric(text) {
    const normalized = text.replace(/\u00a0/g, ' ')
    const labeled = (labels) => {
      for (const label of labels) {
        const match = normalized.match(new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]{3,60})`, 'i'))
        const value = match?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
        if (value && !/^(n\/?a|-|—)$/i.test(value)) return value
      }
      return ''
    }
    const vesselVoyage = normalized.match(/([A-Z][A-Z0-9 .'-]{3,40})\s*\(\s*([A-Z0-9]{3,14})\s*\)/)
    return {
      etd: labeled(['ETD', 'ATD', 'Estimated Departure', 'Departure Date']) || '',
      vessel: labeled(['Vessel Name', 'Vessel', 'Tên tàu']) || vesselVoyage?.[1]?.trim() || '',
      voyage: labeled(['Voyage', 'Voy']) || vesselVoyage?.[2]?.trim() || '',
      pod: labeled(['Port of Discharge', 'POD', 'Destination']) || '',
    }
  }

  function hasResult(result) {
    return Boolean(result?.etd || (result?.vessel && (result?.voyage || result?.pod)))
  }

  function parseByCarrier(carrierId, text) {
    const id = String(carrierId || '').toLowerCase()
    if (id === 'cma-cgm' || id === 'cmdu') return parseCmaGuestPage(text)
    if (id === 'msc' || id === 'mscu') return parseMscPage(text)
    if (id === 'one' || id === 'oney') return parseOnePage(text)
    if (id === 'zim' || id === 'zimu') return parseZimPage(text)
    if (id === 'cosco' || id === 'cosu') return parseCoscoPage(text)
    if (id === 'maersk' || id === 'maeu') return parseMaerskPage(text)
    if (id === 'evergreen' || id === 'eglv') return parseEvergreenPage(text)
    return parseGeneric(text)
  }

  globalThis.BookingCheckParsers = {
    formatDate,
    parseByCarrier,
    hasResult,
  }
})()
