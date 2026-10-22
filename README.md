# Hộp thư đa shop (Shopee Open Platform)

Gom tin nhắn của nhiều shop Shopee về một giao diện, trả lời bằng đúng tài khoản của từng shop.

## Điều kiện bắt buộc trước khi chạy thật

Module chat (`v2.sellerchat`) của Shopee là quyền riêng, không có sẵn khi tạo app. Theo một nguồn thứ ba mình đọc được (chưa xác nhận được từ tài liệu chính thức):

- App loại "ERP System" không dùng được Chat API.
- Từ cuối 2024, Shopee không mở chat cho app mới của cá nhân hoặc ISV. Với shop tự bán, đường đi thường là làm việc với Account Manager của Shopee.

Bạn cần kiểm tra điều kiện này cho thị trường Việt Nam trên open.shopee.com hoặc hỏi Account Manager **trước khi** đầu tư thêm. Nếu Shopee không cấp quyền chat cho app của bạn, code này không gọi được chat thật, và phương án còn lại là dùng Salework, Sapo hoặc HaraSocial.

## Chạy thử không cần Shopee (server giả lập)

Cần cài Node.js bản 20 trở lên (nodejs.org). Mở terminal trong thư mục này:

```bash
npm install
npm run demo
```

Mở http://localhost:3000 và bấm "Kết nối shop" hai lần để thêm 2 shop giả. Lệnh này chạy được trên Windows, Mac và Linux. Mô phỏng khách nhắn tới (Mac/Linux):

```bash
curl -X POST localhost:4000/mock/inject -d '{"shop_id":1001,"text":"Shop ơi còn hàng không?"}'
```

`npm test` chạy bộ kiểm tra toàn bộ luồng với server giả: OAuth 2 shop, refresh token dùng một lần, id 64-bit, gửi tin, push đúng và sai chữ ký, mã hóa token.

## Chạy với Shopee thật

1. Tạo app tại open.shopee.com, lấy Partner ID và Partner Key. Xin quyền module chat.
2. Cần một địa chỉ HTTPS công khai (VPS, Fly.io, Railway, hoặc `cloudflared tunnel` khi thử).
3. Đăng ký trong console của app:
   - Redirect URL: `PUBLIC_URL/auth/callback`
   - Push URL: `PUBLIC_URL/webhook/shopee`, bật push chat (webchat_push) và push ủy quyền shop
4. Sao chép `.env.example` thành `.env`, điền giá trị, chạy:

```bash
npm start
```

(`.env` đã có `NODE_ENV=production`, nên server sẽ đòi đủ mật khẩu, khóa mã hóa và HTTPS.)

5. Vào web, bấm "Kết nối shop", đăng nhập Seller Centre của từng shop và bấm cho phép. Lặp lại cho mỗi shop.

## Đưa lên web (Fly.io)

Cần tài khoản Fly.io và cài `flyctl`. Server dùng một file trên ổ đĩa để lưu dữ liệu, nên chỉ chạy **1 máy** và phải gắn volume (đã cấu hình trong `fly.toml`). Không dùng gói hosting tự ngủ hoặc không có ổ đĩa bền (như Render free), vì push từ Shopee sẽ rơi mất và dữ liệu bị xóa mỗi lần khởi động lại.

```bash
fly launch --no-deploy --copy-config      # đặt tên app khi được hỏi
fly volumes create inbox_data --size 1 --region sin
fly secrets set ADMIN_PASS="mật-khẩu-mạnh" TOKEN_ENC_KEY="$(openssl rand -hex 32)" \
  PUBLIC_URL="https://TEN-APP.fly.dev" \
  SHOPEE_PARTNER_ID="..." SHOPEE_PARTNER_KEY="..."
fly deploy
```

Dùng `PUBLIC_URL` đúng địa chỉ app, rồi đăng ký `PUBLIC_URL/auth/callback` và `PUBLIC_URL/webhook/shopee` trong console Shopee. `TOKEN_ENC_KEY` mất là toàn bộ shop phải kết nối lại, nên lưu ở nơi an toàn.

### Xem thử trên web khi chưa có quyền Shopee

Đặt thêm `DEMO=1` (và vẫn cần `ADMIN_PASS`, `TOKEN_ENC_KEY`, `PUBLIC_URL`, không cần khóa Shopee). Server chạy Shopee giả ngay bên trong, bấm "Kết nối shop" sẽ thêm shop giả với dữ liệu mẫu. Giả lập khách nhắn tới:

```bash
curl -X POST https://TEN-APP.fly.dev/mock-shopee/mock/inject -d '{"shop_id":1001,"text":"Shop ơi còn hàng không?"}'
```

Khi có quyền Shopee thật: bỏ `DEMO`, xóa file dữ liệu demo (`fly ssh console` rồi `rm /data/db.json`), điền khóa Shopee thật.

## Cách hoạt động

- Mỗi shop có token riêng, mã hóa AES-256-GCM trước khi ghi `data/db.json`.
- Access token tự làm mới trước hạn. Refresh token của Shopee chỉ dùng một lần nên mỗi shop chỉ có một lệnh refresh chạy cùng lúc. Nếu refresh thất bại, shop chuyển sang "Kết nối lại".
- Tin mới đến qua push, kèm quét dự phòng mỗi `POLL_SECONDS` giây phòng khi push bị mất.
- id hội thoại, id tin nhắn là số 64-bit, được giữ dạng chuỗi để không bị làm tròn.
- Đăng nhập nhân viên bằng HTTP Basic (một tài khoản chung). Cần nhiều tài khoản riêng thì thêm bước đăng nhập, `STAFF` hiện chỉ là danh sách tên để gán phụ trách.

## Phần chưa đối chiếu được với tài liệu chính thức

Mình không đọc được trang tài liệu chat của Shopee (chỉ mở cho app có quyền), nên các điểm sau viết theo hiểu biết, cần soát lại khi bạn có quyền:

| Điểm | File |
|---|---|
| Tên tham số và trường của `get_conversation_list`, `get_message`, `send_message`, `read_conversation` | `src/shopee/chat.js` |
| Cách ký push: `HMAC-SHA256(partner_key, push_url + "\|" + body)` trong header `Authorization` | `src/shopee/sign.js` |
| Mã push chat là `10`, và hình dạng dữ liệu push | `src/server.js` (`handlePush`) |
| Mã lỗi khi hết hạn token (`error_auth`...) | `src/shopee/client.js` |

Cách ký request thường (`partner_id + path + timestamp [+ access_token + shop_id]`), đường dẫn đăng nhập và đổi token đã khớp với nhiều nguồn tài liệu. Nếu push báo sai chữ ký, đặt `PUSH_VERIFY=off` tạm thời để xem dữ liệu thật, rồi sửa `pushSign`.

## Cấu trúc

```
src/server.js        web, OAuth callback, webhook, API cho giao diện
src/shopee/sign.js   ký request và push
src/shopee/client.js gọi API, refresh token, thử lại
src/shopee/chat.js   các lệnh chat (nơi duy nhất cần sửa khi lệch tài liệu)
src/sync.js          đồng bộ hội thoại và quét dự phòng
src/store.js         lưu trữ + mã hóa token
src/mock.js          Shopee giả lập
public/index.html    giao diện
```
