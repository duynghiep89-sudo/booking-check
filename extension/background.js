function emptyResult(status, message) {
  return { etd: '', vessel: '', voyage: '', pod: '', status, message }
}

function stripTrackingUrl(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text.replaceAll('{booking}', ''))
    for (const key of [...url.searchParams.keys()]) {
      const value = url.searchParams.get(key) ?? ''
      if (
        !value ||
        value.includes('{booking}') ||
        /^(booking|bookingno|blno|number|numbers|no|reference|searchby|search|searchnumber|searchtype|tracking-number|trackingnumber|trackingtype|params|type)$/i.test(
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
    return text.replaceAll('{booking}', '').replace(/\?.*$/, '')
  }
}

function landingUrl(payload) {
  const id = String(payload.carrierId || '').toLowerCase()
  const code = String(payload.carrierCode || '').toUpperCase()
  if (id === 'cma-cgm' || code === 'CMDU') return 'https://www.cma-cgm.com/ebusiness/tracking'
  if (id === 'msc' || code === 'MSCU') return 'https://www.msc.com/en/track-a-shipment'
  if (id === 'cosco' || code === 'COSU') return 'https://elines.coscoshipping.com/ebusiness/cargoTracking'
  if (id === 'evergreen' || code === 'EGLV') return 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do'
  if (id === 'maersk' || code === 'MAEU') return 'https://www.maersk.com/tracking'
  if (id === 'one' || code === 'ONEY') return 'https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking'
  if (id === 'zim' || code === 'ZIMU') return 'https://www.zim.com/tools/track-a-shipment'
  if (id === 'hapag-lloyd' || code === 'HLCU') {
    return 'https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html'
  }
  if (id === 'hmm' || code === 'HDMU') return 'https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do'
  if (id === 'yang-ming' || code === 'YMLU') {
    return 'https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx'
  }
  if (id === 'sitc' || code === 'SITU') return 'https://www.sitcline.com/track-trace'
  return stripTrackingUrl(payload.trackingUrl)
}

function waitTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      reject(new Error('Tab load timeout'))
    }, timeoutMs)
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer)
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (tab.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
        return
      }
      chrome.tabs.onUpdated.addListener(onUpdated)
    })
  })
}

async function trackWithTab(payload) {
  const bookingNo = String(payload.bookingNo || '').trim()
  if (!bookingNo) return emptyResult('error', 'Thiếu số booking.')
  const url = landingUrl(payload)
  if (!url || /google\.com/i.test(url)) return emptyResult('error', 'Thiếu URL tracking của hãng tàu.')

  try {
    const win = await chrome.windows.create({ url, focused: true, type: 'normal' })
    const tabId = win.tabs?.[0]?.id
    if (!tabId) return emptyResult('error', 'Không mở được cửa sổ Chrome mới.')

    await waitTabComplete(tabId)
    // Cho SPA hãng render form search trước khi điền booking.
    await new Promise((r) => setTimeout(r, 2500))

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['parsers.js', 'runners.js'],
    })

    const runResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (carrierId, booking) => {
        await globalThis.BookingCheckRunners.runCarrier(carrierId, booking)
        return document.body?.innerText || ''
      },
      args: [payload.carrierId || payload.carrierCode || '', bookingNo],
    })

    let text = runResults?.[0]?.result || ''
    if (/cosco/i.test(String(payload.carrierId || ''))) {
      const frameResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => document.body?.innerText || '',
      })
      text = (frameResults || []).map((row) => row.result || '').join('\n')
    }

    const parsedResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: (carrierId, pageText) => {
        const parsed = globalThis.BookingCheckParsers.parseByCarrier(carrierId, pageText)
        return { ...parsed, ok: globalThis.BookingCheckParsers.hasResult(parsed) }
      },
      args: [payload.carrierId || payload.carrierCode || '', text],
    })

    const parsed = parsedResults?.[0]?.result || {}
    if (/not found|no result|your shipment was not found/i.test(text) && !parsed.ok) {
      return emptyResult('not_found', 'Hãng không tìm thấy booking này.')
    }
    if (!parsed.ok) {
      return emptyResult(
        'error',
        'Đã mở cửa sổ hãng nhưng chưa đọc được ETD/tàu. Cho phép cookie/login rồi thử lại.',
      )
    }
    return {
      etd: parsed.etd || '',
      vessel: parsed.vessel || '',
      voyage: parsed.voyage || '',
      pod: parsed.pod || '',
      status: 'found',
      message: 'Đã lấy qua Chrome extension (bản ổn định).',
    }
  } catch (error) {
    return emptyResult('error', error instanceof Error ? error.message : 'Lỗi extension khi tra cứu.')
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'TRACK') return false
  trackWithTab(message.payload || {})
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse(emptyResult('error', error instanceof Error ? error.message : 'Lỗi extension.')),
    )
  return true
})
