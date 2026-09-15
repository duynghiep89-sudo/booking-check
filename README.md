# Booking Check

Webapp tra cứu booking: nhập số booking + hãng tàu, đối chiếu Excel, lấy ETD / tàu / chuyến / POD.

## Link webapp (bản mới nhất)

**https://duynghiep89-sudo.github.io/booking-check/**

Vercel (có thể chậm cập nhật): https://booking-check-rho.vercel.app

## Cách dùng trên internet (Chrome extension)

1. Tải ZIP: https://github.com/duynghiep89-sudo/booking-check/releases/latest  
   (file `booking-check-extension.zip`)
2. Giải nén → Chrome `chrome://extensions` → bật Developer mode → **Load unpacked** → chọn thư mục có `manifest.json`
3. Mở webapp ở link GitHub Pages phía trên → đợi dòng **Extension đã kết nối** → Check

Chi tiết: file `extension/CAI-DAT.txt` trong ZIP.

## Chạy local (Playwright, không cần extension)

```bash
npm install
npx playwright install chrome
npm run dev
```
