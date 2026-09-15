# Booking Check

Webapp tra cứu booking: nhập số booking + hãng tàu, đối chiếu Excel, lấy ETD / tàu / chuyến / POD.

## Link webapp

**https://booking-check-rho.vercel.app**

GitHub Pages (dự phòng): https://duynghiep89-sudo.github.io/booking-check/

## Cách dùng trên internet (Chrome extension)

1. Tải ZIP: https://github.com/duynghiep89-sudo/booking-check/releases/latest  
   (file `booking-check-extension.zip`)
2. Giải nén → Chrome `chrome://extensions` → bật Developer mode → **Load unpacked** → chọn thư mục có `manifest.json`
3. Mở webapp → Check như bình thường (extension mở tab hãng và đọc kết quả)

Chi tiết: file `extension/CAI-DAT.txt` trong ZIP.

## Chạy local (Playwright, không cần extension)

```bash
npm install
npx playwright install chrome
npm run dev
```
