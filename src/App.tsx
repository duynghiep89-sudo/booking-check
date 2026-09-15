import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { DEFAULT_CARRIERS, type Carrier } from './data/carriers'
import { buildBookingRow, rematchBookings } from './lib/bookings'
import { loadCarriers, newCarrierId, parseAliases, saveCarriers } from './lib/carrierStore'
import { downloadExcelTemplate, parseBookingWorkbook } from './lib/parseExcel'
import { requestTracking } from './lib/trackClient'
import type { BookingRow } from './types'
import './App.css'

const BOOKING_STORAGE_KEY = 'booking-check.bookings.v1'

type Page = 'check' | 'carriers'

type CarrierDraft = {
  id: string | null
  name: string
  code: string
  aliasesText: string
  trackingUrlTemplate: string
  apiKey: string
  requiresLogin: boolean
  loginUser: string
  loginPassword: string
}

const emptyCarrierDraft = (): CarrierDraft => ({
  id: null,
  name: '',
  code: '',
  aliasesText: '',
  trackingUrlTemplate: '',
  apiKey: '',
  requiresLogin: false,
  loginUser: '',
  loginPassword: '',
})

function loadSavedBookings(): BookingRow[] {
  try {
    const raw = localStorage.getItem(BOOKING_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as BookingRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function dash(value: string) {
  return value.trim() ? value : '—'
}

function trackingTabUrl(row: BookingRow) {
  const id = (row.carrier?.id ?? '').toLowerCase()
  if (id === 'msc' || row.carrier?.code === 'MSCU') {
    const raw = `trackingNumber=${row.bookingNo.trim()}&trackingMode=1`
    return `https://www.msc.com/en/track-a-shipment?params=${btoa(raw)}`
  }
  return row.trackingUrl
}

function openTrackingWindow(row: BookingRow) {
  const url = trackingTabUrl(row)
  if (!url || url.includes('google.com')) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function statusLabel(row: BookingRow) {
  if (row.matchStatus === 'unknown') return 'Hãng lạ'
  switch (row.checkStatus) {
    case 'checking':
      return 'Đang tra cứu'
    case 'found':
      return 'Đã có kết quả'
    case 'not_found':
      return 'Chưa có lịch'
    case 'error':
      return 'Lỗi tra cứu'
    default:
      return 'Chờ check'
  }
}

function App() {
  const fileRef = useRef<HTMLInputElement>(null)
  const skipCarrierRematch = useRef(true)
  const [page, setPage] = useState<Page>('check')
  const [carriers, setCarriers] = useState<Carrier[]>(() => loadCarriers())
  const [carrierDraft, setCarrierDraft] = useState<CarrierDraft>(emptyCarrierDraft)
  const [rows, setRows] = useState<BookingRow[]>(() =>
    rematchBookings(loadSavedBookings(), loadCarriers()),
  )
  const [bookingNo, setBookingNo] = useState('')
  const [carrierRaw, setCarrierRaw] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const checking = rows.some((row) => row.checkStatus === 'checking')

  useEffect(() => {
    saveCarriers(carriers)
    if (skipCarrierRematch.current) {
      skipCarrierRematch.current = false
      return
    }
    setRows((current) => rematchBookings(current, carriers))
  }, [carriers])

  useEffect(() => {
    localStorage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(rows))
  }, [rows])

  const stats = useMemo(() => {
    return {
      total: rows.length,
      checking: rows.filter((row) => row.checkStatus === 'checking').length,
      found: rows.filter((row) => row.checkStatus === 'found').length,
      unknown: rows.filter((row) => row.matchStatus === 'unknown').length,
    }
  }, [rows])

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [row.bookingNo, row.carrierRaw, row.carrier?.name, row.vessel, row.voyage, row.pod]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    )
  }, [query, rows])

  async function runChecks(targets: BookingRow[]) {
    const queue = targets.filter((row) => row.bookingNo)
    const hosted = !import.meta.env.DEV
    if (queue.length === 1 && queue[0]) {
      openTrackingWindow(queue[0])
    }
    const limit = 1
    let index = 0

    async function worker() {
      while (index < queue.length) {
        const current = queue[index]
        index += 1
        if (!current) continue
        setRows((list) =>
          list.map((row) =>
            row.id === current.id
              ? { ...row, checkStatus: 'checking', checkMessage: 'Đang mở web hãng, nhập booking và đọc lịch...' }
              : row,
          ),
        )
        if (current.matchStatus === 'unknown') {
          setRows((list) =>
            list.map((row) =>
              row.id === current.id
                ? {
                    ...row,
                    checkStatus: 'error',
                    checkMessage: 'Hãng chưa có trong danh sách. Thêm hãng ở menu Hãng tàu.',
                  }
                : row,
            ),
          )
          continue
        }
        if (hosted) {
          setRows((list) =>
            list.map((row) =>
              row.id === current.id
                ? {
                    ...row,
                    checkStatus: 'idle',
                    checkMessage:
                      'Bản web đã mở (hoặc dùng) trang hãng. Tự điền ETD/tàu/chuyến/POD chỉ khi chạy npm run dev trên máy bạn.',
                  }
                : row,
            ),
          )
          continue
        }
        const result = await requestTracking({
          bookingNo: current.bookingNo,
          carrierId: current.carrier?.id,
          carrierCode: current.carrier?.code,
          trackingUrl: current.trackingUrl,
          apiKey: current.carrier?.apiKey,
          requiresLogin: current.carrier?.requiresLogin,
          loginUser: current.carrier?.loginUser,
          loginPassword: current.carrier?.loginPassword,
        })
        setRows((list) =>
          list.map((row) =>
            row.id === current.id
              ? {
                  ...row,
                  etd: result.etd,
                  vessel: result.vessel,
                  voyage: result.voyage,
                  pod: result.pod,
                  checkStatus: result.status,
                  checkMessage: result.message,
                }
              : row,
          ),
        )
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, () => worker()))
  }

  async function submitCheck(event: FormEvent) {
    event.preventDefault()
    if (!bookingNo.trim()) {
      setError('Nhập số booking.')
      return
    }
    if (!carrierRaw.trim()) {
      setError('Chọn hãng tàu trong danh sách.')
      return
    }
    setError('')
    const row = buildBookingRow({ bookingNo, carrierRaw }, carriers)
    setRows((current) => [row, ...current])
    setBookingNo('')
    setCarrierRaw('')
    await runChecks([row])
  }

  async function handleFile(file: File) {
    setError('')
    try {
      const parsed = parseBookingWorkbook(await file.arrayBuffer(), carriers)
      setRows((current) => [...parsed, ...current])
      await runChecks(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đọc được file Excel.')
    }
  }

  function saveCarrier(event: FormEvent) {
    event.preventDefault()
    const name = carrierDraft.name.trim()
    if (!name) {
      setError('Nhập tên hãng tàu.')
      return
    }
    if (carrierDraft.requiresLogin && (!carrierDraft.loginUser.trim() || !carrierDraft.loginPassword)) {
      setError('Hãng này cần đăng nhập: nhập tài khoản và mật khẩu.')
      return
    }
    const next: Carrier = {
      id: carrierDraft.id ?? newCarrierId(name),
      name,
      code: carrierDraft.code.trim(),
      aliases: parseAliases(carrierDraft.aliasesText),
      trackingUrlTemplate: carrierDraft.trackingUrlTemplate.trim(),
      apiKey: carrierDraft.apiKey.trim(),
      requiresLogin: carrierDraft.requiresLogin,
      loginUser: carrierDraft.requiresLogin ? carrierDraft.loginUser.trim() : '',
      loginPassword: carrierDraft.requiresLogin ? carrierDraft.loginPassword : '',
    }
    setError('')
    setCarriers((current) => {
      if (!carrierDraft.id) return [...current, next]
      return current.map((item) => (item.id === next.id ? next : item))
    })
    setCarrierDraft(emptyCarrierDraft)
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 17.5 12 6l9 11.5H3Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M7.5 17.5h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <strong>Booking Check</strong>
            <small>Lịch trình tàu</small>
          </div>
        </div>
        <nav>
          <button type="button" className={page === 'check' ? 'active' : ''} onClick={() => setPage('check')}>
            Tra cứu
          </button>
          <button type="button" className={page === 'carriers' ? 'active' : ''} onClick={() => setPage('carriers')}>
            Hãng tàu
          </button>
        </nav>
        <p className="sidebar-note">Công cụ nội bộ phòng xuất nhập khẩu</p>
      </aside>

      <main className="main">
        {page === 'check' ? (
          <>
            <header className="page-head">
              <div>
                <p className="eyebrow">Vận tải biển</p>
                <h1>Check booking</h1>
                <p>
                  Mỗi lần kiểm tra sẽ mở một cửa sổ mới trang hãng. Trên máy bạn (npm run dev), Chrome còn tự nhập
                  booking và đọc ETD / tàu / chuyến / POD.
                </p>
              </div>
              <div className="kpi">
                <div>
                  <em>{stats.total}</em>
                  <span>Booking</span>
                </div>
                <div>
                  <em>{stats.checking}</em>
                  <span>Đang check</span>
                </div>
                <div>
                  <em>{stats.found}</em>
                  <span>Có kết quả</span>
                </div>
              </div>
            </header>

            <section className="check-bar">
              <form className="check-form" onSubmit={submitCheck}>
                <label>
                  Số booking
                  <input
                    value={bookingNo}
                    onChange={(event) => setBookingNo(event.target.value)}
                    placeholder="VD: 259123456"
                    autoFocus
                  />
                </label>
                <label>
                  Hãng tàu
                  <select
                    value={carrierRaw}
                    onChange={(event) => setCarrierRaw(event.target.value)}
                    required
                  >
                    <option value="">Chọn hãng tàu</option>
                    {carriers.map((carrier) => (
                      <option key={carrier.id} value={carrier.name}>
                        {carrier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn primary">
                  Kiểm tra
                </button>
              </form>
              <div className="check-extra">
                <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                  Tải Excel
                </button>
                <button type="button" className="btn" onClick={downloadExcelTemplate}>
                  Mẫu Excel
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={checking || rows.length === 0}
                  onClick={() => void runChecks(rows)}
                >
                  Check lại tất cả
                </button>
                <input
                  ref={fileRef}
                  className="hidden"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handleFile(file)
                    event.target.value = ''
                  }}
                />
              </div>
            </section>

            {error && page === 'check' ? <p className="error">{error}</p> : null}

            <section className="results">
              <div className="results-head">
                <h2>Kết quả tra cứu</h2>
                <label className="filter">
                  Tìm
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Booking, hãng, tàu, cảng..."
                  />
                </label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Số booking</th>
                      <th>Hãng tàu</th>
                      <th>Trạng thái</th>
                      <th>ETD khởi hành</th>
                      <th>Tên tàu</th>
                      <th>Số chuyến</th>
                      <th>Cảng đến (POD)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          <strong>Chưa có booking</strong>
                          Nhập số booking, chọn hãng tàu rồi bấm Kiểm tra.
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => {
                        const carrierHref = trackingTabUrl(row)
                        return (
                        <tr key={row.id}>
                          <td className="mono">{row.bookingNo}</td>
                          <td>
                            <div className="stack">
                              <strong>{row.carrier?.name ?? row.carrierRaw}</strong>
                              <small>{row.carrier?.code || row.carrierRaw}</small>
                            </div>
                          </td>
                          <td>
                            <span className={`pill ${row.matchStatus === 'unknown' ? 'warn' : row.checkStatus}`}>
                              {statusLabel(row)}
                            </span>
                            {row.checkMessage ? <small className="msg">{row.checkMessage}</small> : null}
                          </td>
                          <td>{dash(row.etd)}</td>
                          <td>{dash(row.vessel)}</td>
                          <td>{dash(row.voyage)}</td>
                          <td>{dash(row.pod)}</td>
                          <td className="actions">
                            {carrierHref && !carrierHref.includes('google.com') ? (
                              <a href={carrierHref} target="_blank" rel="noreferrer">
                                Trang hãng
                              </a>
                            ) : null}
                            <button type="button" onClick={() => void runChecks([row])}>
                              Check
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                            >
                              Xóa
                            </button>
                          </td>
                        </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <>
            <header className="page-head">
              <div>
                <p className="eyebrow">Danh mục</p>
                <h1>Hãng tàu</h1>
                <p>
                  Bật “Cần đăng nhập” nếu web hãng yêu cầu tài khoản. API key chỉ dùng khi có key chính thức.
                </p>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setCarriers(DEFAULT_CARRIERS.map((item) => ({ ...item, aliases: [...item.aliases] })))
                }
              >
                Khôi phục mặc định
              </button>
            </header>

            {error && page === 'carriers' ? <p className="error">{error}</p> : null}

            <form className="carrier-form card" onSubmit={saveCarrier}>
              <label>
                Tên hãng
                <input
                  value={carrierDraft.name}
                  onChange={(event) => setCarrierDraft((d) => ({ ...d, name: event.target.value }))}
                  placeholder="MSC"
                />
              </label>
              <label>
                Mã SCAC
                <input
                  value={carrierDraft.code}
                  onChange={(event) => setCarrierDraft((d) => ({ ...d, code: event.target.value }))}
                  placeholder="MSCU"
                />
              </label>
              <label>
                Tên thường gọi
                <input
                  value={carrierDraft.aliasesText}
                  onChange={(event) => setCarrierDraft((d) => ({ ...d, aliasesText: event.target.value }))}
                  placeholder="Cách nhau bằng dấu phẩy"
                />
              </label>
              <label className="wide">
                Link tracking
                <input
                  value={carrierDraft.trackingUrlTemplate}
                  onChange={(event) =>
                    setCarrierDraft((d) => ({ ...d, trackingUrlTemplate: event.target.value }))
                  }
                  placeholder="Dùng {booking} trong đường dẫn"
                />
              </label>
              <label>
                API key
                <input
                  value={carrierDraft.apiKey}
                  onChange={(event) => setCarrierDraft((d) => ({ ...d, apiKey: event.target.value }))}
                  placeholder="Không bắt buộc"
                />
              </label>
              <label className="login-toggle">
                <input
                  type="checkbox"
                  checked={carrierDraft.requiresLogin}
                  onChange={(event) =>
                    setCarrierDraft((d) => ({ ...d, requiresLogin: event.target.checked }))
                  }
                />
                Cần đăng nhập
              </label>
              {carrierDraft.requiresLogin ? (
                <div className="carrier-login">
                  <label>
                    Tài khoản
                    <input
                      value={carrierDraft.loginUser}
                      onChange={(event) => setCarrierDraft((d) => ({ ...d, loginUser: event.target.value }))}
                      placeholder="Email hoặc mã khách hàng"
                      autoComplete="username"
                    />
                  </label>
                  <label>
                    Mật khẩu
                    <input
                      type="password"
                      value={carrierDraft.loginPassword}
                      onChange={(event) =>
                        setCarrierDraft((d) => ({ ...d, loginPassword: event.target.value }))
                      }
                      placeholder="Mật khẩu web hãng"
                      autoComplete="current-password"
                    />
                  </label>
                </div>
              ) : null}
              <div className="form-actions">
                <button type="submit" className="btn primary">
                  {carrierDraft.id ? 'Lưu hãng' : 'Thêm hãng'}
                </button>
              </div>
            </form>

            <div className="table-wrap card">
              <table>
                <thead>
                  <tr>
                    <th>Hãng</th>
                    <th>Mã</th>
                    <th>Tên thường gọi</th>
                    <th>Đăng nhập</th>
                    <th>Link</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {carriers.map((carrier) => (
                    <tr key={carrier.id}>
                      <td>
                        <strong>{carrier.name}</strong>
                      </td>
                      <td className="mono">{carrier.code}</td>
                      <td>{carrier.aliases.join(', ') || '—'}</td>
                      <td>
                        {carrier.requiresLogin
                          ? carrier.loginUser
                            ? `Có · ${carrier.loginUser}`
                            : 'Có'
                          : 'Không'}
                      </td>
                      <td className="muted">{carrier.trackingUrlTemplate}</td>
                      <td className="actions">
                        <button
                          type="button"
                          onClick={() =>
                            setCarrierDraft({
                              id: carrier.id,
                              name: carrier.name,
                              code: carrier.code,
                              aliasesText: carrier.aliases.join(', '),
                              trackingUrlTemplate: carrier.trackingUrlTemplate,
                              apiKey: carrier.apiKey ?? '',
                              requiresLogin: Boolean(carrier.requiresLogin),
                              loginUser: carrier.loginUser ?? '',
                              loginPassword: carrier.loginPassword ?? '',
                            })
                          }
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => setCarriers((current) => current.filter((item) => item.id !== carrier.id))}
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
