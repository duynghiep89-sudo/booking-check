function emptyResult(status, message) {
  return { etd: '', vessel: '', voyage: '', pod: '', status, message }
}

function stripBookingFromTrackingUrl(template, bookingNo = '') {
  const raw = String(template || '').trim()
  if (!raw) return raw
  const booking = String(bookingNo || '').trim()
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
    url.pathname = url.pathname.replace(/\/tracking\/[^/]+$/i, '/tracking')
    if (booking) {
      url.pathname = url.pathname.replace(
        new RegExp(`/${booking.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`, 'i'),
        '/',
      )
    }
    url.hash = ''
    const search = url.searchParams.toString()
    return `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}${search ? `?${search}` : ''}`
  } catch {
    return raw.replaceAll('{booking}', '').replace(/\?.*$/, '').replace(/\/+$/, '')
  }
}

function landingUrl(payload) {
  const id = String(payload.carrierId || '').toLowerCase()
  if (id === 'cma-cgm' || id === 'cmdu') return 'https://www.cma-cgm.com/ebusiness/tracking'
  if (id === 'msc' || id === 'mscu') return 'https://www.msc.com/en/track-a-shipment'
  if (id === 'cosco' || id === 'cosu') return 'https://elines.coscoshipping.com/ebusiness/cargoTracking'
  if (id === 'one' || id === 'oney') return 'https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking'
  if (id === 'zim' || id === 'zimu') return 'https://www.zim.com/tools/track-a-shipment'
  if (id === 'maersk' || id === 'maeu') return 'https://www.maersk.com/tracking'
  if (id === 'evergreen' || id === 'eglv') return 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do'
  return stripBookingFromTrackingUrl(payload.trackingUrl, payload.bookingNo)
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

async function openCarrierWindow(url) {
  const win = await chrome.windows.create({
    url,
    focused: true,
    type: 'normal',
  })
  const tabId = win.tabs?.[0]?.id
  if (!tabId) throw new Error('Không mở được cửa sổ Chrome mới.')
  return tabId
}

async function trackWithTab(payload) {
  const bookingNo = String(payload.bookingNo || '').trim()
  if (!bookingNo) return emptyResult('error', 'Thiếu số booking.')

  const url = landingUrl(payload)
  if (!url || /google\.com/i.test(url)) {
    return emptyResult('error', 'Thiếu URL tracking của hãng tàu.')
  }

  let tabId
  try {
    tabId = await openCarrierWindow(url)
    await waitTabComplete(tabId)
    await new Promise((r) => setTimeout(r, 1500))

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
        return {
          ...parsed,
          ok: globalThis.BookingCheckParsers.hasResult(parsed),
        }
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
        'Đã mở cửa sổ hãng nhưng chưa đọc được ETD/tàu. Cho phép cookie/login trên trang hãng rồi Check lại.',
      )
    }
    return {
      etd: parsed.etd || '',
      vessel: parsed.vessel || '',
      voyage: parsed.voyage || '',
      pod: parsed.pod || '',
      status: 'found',
      message: 'Đã lấy qua Chrome extension (cửa sổ hãng).',
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

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Booking Check Helper] installed/updated', chrome.runtime.getManifest().version)
})
