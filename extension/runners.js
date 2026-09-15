;(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  async function waitFor(predicate, timeoutMs = 25000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        if (await predicate()) return true
      } catch {
        /* ignore */
      }
      await sleep(400)
    }
    return false
  }

  function clickByText(re) {
    const nodes = [...document.querySelectorAll('button, a, label, span, div, input')]
    const hit = nodes.find((el) => re.test((el.textContent || el.value || '').trim()))
    if (hit instanceof HTMLElement) {
      hit.click()
      return true
    }
    return false
  }

  function fillInput(el, value) {
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false
    el.focus()
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  async function acceptCookies() {
    const selectors = [
      '#onetrust-accept-btn-handler',
      '#coiBanner__selectAll',
      '#coi-banner__selectAll',
    ]
    for (const sel of selectors) {
      document.querySelector(sel)?.click()
    }
    clickByText(/^(Allow all|Accept all|Accept All|I Agree|Allow All)$/i)
    await sleep(400)
  }

  async function runCma(bookingNo) {
    await acceptCookies()
    for (let i = 0; i < 8; i += 1) {
      const box =
        document.querySelector('input[aria-label*="Container Number" i], input[aria-label*="Shipment Ref" i]') ||
        [...document.querySelectorAll('input[type="text"], input:not([type])')].find((el) =>
          /container|shipment|booking|reference/i.test(
            `${el.getAttribute('aria-label') || ''} ${el.placeholder || ''} ${el.name || ''}`,
          ),
        )
      if (box) {
        fillInput(box, bookingNo)
        break
      }
      await acceptCookies()
      await sleep(800)
    }
    clickByText(/^Search$/i)
    await waitFor(
      () =>
        /Tracking details|PLANNED VESSEL DEPARTURE|Booking reference|Display Details|Your shipment was not found/i.test(
          document.body.innerText,
        ),
      25000,
    )
    if (!/PLANNED VESSEL DEPARTURE|Tracking details/i.test(document.body.innerText)) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const exact = [...document.querySelectorAll('label, span, button, a, div')].find(
          (el) => (el.textContent || '').trim() === 'Display Details',
        )
        if (exact instanceof HTMLElement) exact.click()
        else {
          const boxes = [...document.querySelectorAll('input[type="checkbox"]')]
          const box = boxes[attempt]
          if (box instanceof HTMLElement) box.click()
        }
        const opened = await waitFor(() => /PLANNED VESSEL DEPARTURE/i.test(document.body.innerText), 5000)
        if (opened) break
      }
    }
    await sleep(1200)
  }

  async function runMsc(bookingNo) {
    await acceptCookies()
    document.querySelector('#onetrust-accept-btn-handler')?.click()
    clickByText(/^Accept All$/i)
    const booking = document.querySelector('#bookingradio')
    const container = document.querySelector('#containeradio')
    if (container) {
      container.checked = false
      container.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (booking) {
      booking.checked = true
      booking.dispatchEvent(new Event('input', { bubbles: true }))
      booking.dispatchEvent(new Event('change', { bubbles: true }))
      booking.click()
    }
    document.querySelector('label[for="bookingradio"]')?.click()
    await sleep(300)
    const box = document.querySelector('#trackingNumber')
    if (box) fillInput(box, bookingNo)
    document.querySelector('button.msc-search-autocomplete__search')?.click()
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => /BOOKING NUMBER:/i.test(document.body.innerText), 25000)
    document.querySelector('.msc-flow-tracking__more-button')?.click()
    await waitFor(
      () => /Estimated Time of Arrival|Estimated Time of Departure/i.test(document.body.innerText),
      15000,
    )
    clickByText(/^Show all/i)
    await sleep(1200)
  }

  async function runOne(bookingNo) {
    await acceptCookies()
    clickByText(/^Skip$/i)
    await sleep(400)
    clickByText(/^Skip$/i)
    const box =
      document.querySelector('input[placeholder*="Search by BL No" i]') ||
      document.querySelector('input[aria-label*="Search by BL No" i]')
    if (box) {
      fillInput(box, bookingNo)
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
    await waitFor(() => document.body.innerText.includes(bookingNo), 25000)
    const arrow = document.querySelector(
      '[data-testid="tnt-cargo-tracking-table"] [class*="TableColumn_arrow"]',
    )
    if (arrow instanceof HTMLElement) arrow.click()
    await waitFor(
      () => /Sailing Information|Vessel Departure from Port of Loading/i.test(document.body.innerText),
      20000,
    )
    await sleep(1200)
  }

  async function runZim(bookingNo) {
    await acceptCookies()
    clickByText(/^I Agree$/i)
    const box =
      document.querySelector('#shipment-main-search-2') ||
      document.querySelector('input[aria-label*="shipping tracking" i]')
    if (box) fillInput(box, bookingNo)
    document.querySelector('.chips-search-button')?.click() || clickByText(/^Search$/i)
    await waitFor(() => /Port of Discharge \(POD\)|Vessel \/ Voyage/i.test(document.body.innerText), 25000)
    await sleep(1200)
  }

  async function runMaersk(bookingNo) {
    await acceptCookies()
    clickByText(/^Allow all$/i)
    const box = [...document.querySelectorAll('input')].find((el) =>
      /container|bill of lading|booking|shipment/i.test(
        `${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`,
      ),
    )
    if (box) fillInput(box, bookingNo)
    clickByText(/^Track$/i)
    await waitFor(() => /Vessel departure\s*\(/i.test(document.body.innerText), 25000)
    await sleep(1200)
  }

  async function runEvergreen(bookingNo) {
    await acceptCookies()
    const typeSelect = document.querySelector('select[name="TYPE"], select#TYPE')
    if (typeSelect) {
      typeSelect.value = 'BN'
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const box = document.querySelector('input[name="NO"], input#NO, input[name="booking"]')
    if (box) fillInput(box, bookingNo)
    clickByText(/^(Search|Track|Submit)$/i)
    const form = box?.closest('form')
    form?.requestSubmit?.()
    await sleep(2500)
    await waitFor(
      () => /Vessel Voyage|Port of Discharge|Port of Loading/i.test(document.body.innerText),
      20000,
    )
  }

  async function runCosco(bookingNo) {
    await acceptCookies()
    clickByText(/^Allow All$/i)
    await sleep(2000)
    // Best-effort in top page; iframe may still need manual expand.
    const box = [...document.querySelectorAll('input')].find((el) =>
      /booking|bl|number|cargo/i.test(`${el.placeholder || ''} ${el.name || ''} ${el.id || ''}`),
    )
    if (box) {
      fillInput(box, bookingNo)
      clickByText(/^Search$/i)
    }
    await sleep(3000)
  }

  async function runGeneric(bookingNo) {
    await acceptCookies()
    const box = [...document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]')].find(
      (el) => el.offsetParent !== null,
    )
    if (box) {
      fillInput(box, bookingNo)
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
    clickByText(/^(Search|Track|Submit|Go)$/i)
    await sleep(3000)
  }

  async function runCarrier(carrierId, bookingNo) {
    const id = String(carrierId || '').toLowerCase()
    if (id === 'cma-cgm' || id === 'cmdu') return runCma(bookingNo)
    if (id === 'msc' || id === 'mscu') return runMsc(bookingNo)
    if (id === 'one' || id === 'oney') return runOne(bookingNo)
    if (id === 'zim' || id === 'zimu') return runZim(bookingNo)
    if (id === 'maersk' || id === 'maeu') return runMaersk(bookingNo)
    if (id === 'evergreen' || id === 'eglv') return runEvergreen(bookingNo)
    if (id === 'cosco' || id === 'cosu') return runCosco(bookingNo)
    return runGeneric(bookingNo)
  }

  globalThis.BookingCheckRunners = {
    runCarrier,
    sleep,
  }
})()
