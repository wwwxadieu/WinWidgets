# WinWidgets

Bộ widget màn hình cho Windows 11, viết bằng Tauri v2 (Rust) + React + TypeScript.
Mỗi mục là một cửa sổ trong suốt riêng biệt, kéo thả tự do, nằm trên desktop và được điều khiển qua biểu tượng khay hệ thống.

| Widget | Nội dung |
| --- | --- |
| Đồng hồ | Giờ (12/24h, có giây), thứ, ngày dương và ngày âm kèm can chi năm; 4 kiểu hiển thị (Số, Kim, Tối giản, Chuyển sắc), nhấp đúp để đổi nhanh |
| Tốc độ mạng | Tải xuống / tải lên theo giây, biểu đồ 60 giây, tổng lưu lượng, tên card mạng |
| Thời tiết | Nhiệt độ, cảm giác như, độ ẩm, gió, mưa, chỉ số AQI và dự báo 4 ngày (Open-Meteo, không cần khoá API) |
| Lịch | Lịch tháng, ngày âm dưới mỗi ô, ngày lễ dương và âm lịch Việt Nam, can chi ngày tháng năm, tiết khí, giờ hoàng đạo |
| Claude | Mức sử dụng Claude Code: khối 5 giờ hiện tại, token và chi phí tương đương hôm nay, tỷ lệ theo model, biểu đồ 7 ngày; phần trăm giới hạn gói khi có token OAuth cục bộ |
| Ổ đĩa | Dung lượng đã dùng / còn trống của từng ổ, cảnh báo màu khi gần đầy, tự co giãn theo số ổ |
| Nguồn | Ba nút Tắt máy, Khởi động lại, Ngủ; nhấn hai lần trong 5 giây để xác nhận |
| Mở nhanh | Lưới ứng dụng tự thêm (chọn tệp trong Cài đặt hoặc kéo thả .exe/.lnk vào widget), icon trích từ Shell của Windows |

## Yêu cầu

- Windows 11 (đã có WebView2)
- Node.js 20 trở lên, Rust ổn định (có sẵn `cargo`)

## Chạy thử và đóng gói

```bash
npm install
npm run tauri dev
```

```bash
npm run tauri build
```

Tệp cài đặt NSIS nằm ở `src-tauri/target/release/bundle/nsis/`, tệp chạy trực tiếp ở `src-tauri/target/release/WinWidgets.exe`.

Xem trước giao diện trong trình duyệt (dữ liệu giả lập): `npm run dev` rồi mở `http://localhost:1420/?w=gallery`.
Kiểm thử thuật toán âm lịch: `npm run test:lunar`.

## Giao diện frost glass

Widget dùng nền acrylic của Windows (`window-vibrancy`) và bo góc 8px qua DWM, nên kính mờ là thật và không còn lớp bóng CSS phía sau trên nền sáng.
Màu phủ theo chủ đề sáng/tối, độ đục lấy từ thanh trượt trong Cài đặt. Khi acrylic không khả dụng, widget tự dùng nền bán trong suốt bằng CSS.

## Sử dụng

- Kéo widget bằng chuột trái. Chuột phải mở menu: Kích thước (Nhỏ, Vừa, Lớn, Rất lớn), Làm mới mỗi (chu kỳ riêng cho mạng, thời tiết, Claude, ổ đĩa), Làm mới ngay, Ẩn widget, Cài đặt, Thoát.
- Mở nhanh: kéo thả tệp `.exe`, lối tắt hoặc thư mục từ Explorer vào widget (drop target do app tự đăng ký lên WebView2, xem `src-tauri/src/dropzone.rs`), hoặc bấm `+`. Lưới 3 cột, tự cao thêm tới 3 hàng, nhiều hơn 9 mục thì cuộn.
- Biểu tượng khay: bật tắt từng widget, hiện tất cả, sắp xếp lại vị trí, khởi động cùng Windows.
- Cửa sổ cài đặt: chủ đề sáng tối, độ đục nền, chế độ ghim (trên desktop, luôn nổi, bình thường), địa điểm thời tiết, card mạng, đơn vị.
- Vị trí widget và cài đặt lưu tại `%APPDATA%\com.wwwxadieu.winwidgets\settings.json`.

## Nguồn dữ liệu Claude

Widget đọc các file nhật ký `~/.claude/projects/**/*.jsonl` mà Claude Code ghi trên máy, chỉ lấy các trường token của tin nhắn trợ lý, khử trùng lặp theo mã tin nhắn và quét tăng dần (bộ đệm tại `%APPDATA%\com.wwwxadieu.winwidgets\claude-usage-cache.json`).
Chi phí hiển thị là ước tính theo bảng giá API công khai, không phải hoá đơn thực.

Phần trăm giới hạn gói (5 giờ, 7 ngày) lấy từ endpoint usage của Claude bằng token OAuth trong `~/.claude/.credentials.json`.
Token này chỉ tồn tại khi đăng nhập qua Claude Code CLI; nếu dùng Claude Code trong ứng dụng Claude Desktop thì không có token cục bộ và widget sẽ hiện số liệu quét từ nhật ký thay thế.

## Lịch âm

Thuật toán thiên văn của Hồ Ngọc Đức (tính sóc và trung khí theo múi giờ +7), có kiểm thử với các mốc Tết 2023 đến 2026 và tháng nhuận 2023, 2025.
