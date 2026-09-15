;(() => {
  const SOURCE_PAGE = 'booking-check'
  const SOURCE_EXT = 'booking-check-extension'

  // B├ío trang web biß║┐t bridge ─æ├ú sß║╡n s├áng (sau khi F5).
  window.postMessage({ source: SOURCE_EXT, type: 'READY', version: chrome.runtime.getManifest().version }, '*')

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.source !== SOURCE_PAGE) return

    if (data.type === 'PING') {
      window.postMessage(
        {
          source: SOURCE_EXT,
          type: 'PONG',
          requestId: data.requestId,
          version: chrome.runtime.getManifest().version,
        },
        '*',
      )
      return
    }

    if (data.type === 'TRACK_REQUEST') {
      chrome.runtime.sendMessage(
        {
          type: 'TRACK',
          requestId: data.requestId,
          payload: data.payload,
        },
        (response) => {
          const err = chrome.runtime.lastError
          window.postMessage(
            {
              source: SOURCE_EXT,
              type: 'TRACK_RESULT',
              requestId: data.requestId,
              result: err
                ? {
                    etd: '',
                    vessel: '',
                    voyage: '',
                    pod: '',
                    status: 'error',
                    message: err.message || 'Extension kh├┤ng phß║ún hß╗ôi. V├áo chrome://extensions bß║Ñm Reload.',
                  }
                : response,
            },
            '*',
          )
        },
      )
    }
  })
})()
