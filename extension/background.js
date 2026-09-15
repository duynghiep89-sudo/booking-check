function emptyResult(status, message) {
  return { etd: '', vessel: '', voyage: '', pod: '', status, message }
}

function landingUrl(payload) {
  const raw = String(payload.trackingUrl || '').trim()
  if (raw && !/google\.com/i.test(raw)) return raw.replace(/\{booking\}/gi, '')
  const id = String(payload.carrierId || '').toLowerCase()
  if (id === 'cma-cgm') return 'https://www.cma-cgm.com/ebusiness/tracking'
  if (id === 'msc') return 'https://www.msc.com/en/track-a-shipment'
  if (id === 'cosco') return 'https://elines.coscoshipping.com/ebusiness/cargoTracking'
  if (id === 'one') return 'https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking'
  if (id === 'zim') return 'https://www.zim.com/tools/track-a-shipment'
  if (id === 'maersk') return 'https://www.maersk.com/tracking'
  if (id === 'evergreen') return 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do'
  return raw || ''
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
  if (!url) return emptyResult('error', 'Thiếu URL tracking của hãng tàu.')

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
