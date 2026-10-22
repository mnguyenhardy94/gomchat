import crypto from 'node:crypto';

export function hmac(key, base) {
  return crypto.createHmac('sha256', key).update(base).digest('hex');
}

// API công khai (auth_partner, auth/token/get, auth/access_token/get): partner_id + path + timestamp
export function publicSign(partnerId, key, path, ts) {
  return hmac(key, `${partnerId}${path}${ts}`);
}

// API theo shop: partner_id + path + timestamp + access_token + shop_id
export function shopSign(partnerId, key, path, ts, accessToken, shopId) {
  return hmac(key, `${partnerId}${path}${ts}${accessToken}${shopId}`);
}

// Push từ Shopee: HMAC-SHA256(partner_key, "<push_url>|<raw_body>"), gửi trong header Authorization.
// Cần đối chiếu lại với mục "Push Mechanism" trên open.shopee.com trước khi chạy thật.
export function pushSign(key, pushUrl, rawBody) {
  return hmac(key, `${pushUrl}|${rawBody}`);
}

export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
