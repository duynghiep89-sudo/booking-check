;(() => {
  const SOURCE_PAGE = 'booking-check'
  const SOURCE_EXT = 'booking-check-extension'

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.source !== SOURCE_PAGE) return

    if (data.type === 'PING') {
      window.postMessage(
        { source: SOURCE_EXT, type: 'PONG', requestId: data.requestId },
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
                    message: err.message || 'Extension không phản hồi.',
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
