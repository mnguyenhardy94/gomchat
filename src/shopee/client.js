import { cfg } from '../config.js';
import { publicSign, shopSign } from './sign.js';
import { parseBig, stringifyBig } from '../bigjson.js';
import * as store from '../store.js';

export class ShopeeError extends Error {
  constructor(code, message, requestId) {
    super(`${code}: ${message}`);
    this.code = code;
    this.requestId = requestId;
  }
}

const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json;
  try { json = parseBig(text); } catch { throw new ShopeeError('bad_response', `HTTP ${res.status}: ${text.slice(0, 200)}`); }
  if (json.error) throw new ShopeeError(json.error, json.message || '', json.request_id);
  return json;
}

// ---- API công khai (không cần access_token) ----
export async function callPublic(method, path, { query = {}, body } = {}) {
  const ts = now();
  const q = new URLSearchParams({
    partner_id: String(cfg.partnerId), timestamp: String(ts),
    sign: publicSign(cfg.partnerId, cfg.partnerKey, path, ts), ...query,
  });
  return http(method, `${cfg.baseUrl}${path}?${q}`, body ? stringifyBig(body) : undefined);
}

export function buildAuthUrl(redirect) {
  const path = '/api/v2/shop/auth_partner';
  const ts = now();
  const q = new URLSearchParams({
    partner_id: String(cfg.partnerId), timestamp: String(ts),
    sign: publicSign(cfg.partnerId, cfg.partnerKey, path, ts), redirect,
  });
  return `${cfg.authBaseUrl}${path}?${q}`;
}

function saveTokens(shopId, r) {
  return store.upsertShop(shopId, {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    // Chừa 60 giây hao hụt đồng hồ
    expires_at: now() + Number(r.expire_in || 14400) - 60,
    status: 'active',
    last_error: '',
  });
}

export async function exchangeCode(code, shopId) {
  const r = await callPublic('POST', '/api/v2/auth/token/get', {
    body: { code, shop_id: Number(shopId), partner_id: cfg.partnerId },
  });
  saveTokens(shopId, r);
  return r;
}

// Refresh token của Shopee dùng được một lần: mỗi lần làm mới trả về refresh_token mới và token cũ hết hiệu lực.
// Vì vậy mỗi shop chỉ cho một lệnh refresh chạy tại một thời điểm.
const refreshing = new Map();
export function refreshTokens(shopId) {
  const id = String(shopId);
  if (refreshing.has(id)) return refreshing.get(id);
  const p = (async () => {
    const shop = store.getShop(id);
    if (!shop?.refresh_token) throw new ShopeeError('no_refresh_token', 'Shop chưa được kết nối');
    try {
      const r = await callPublic('POST', '/api/v2/auth/access_token/get', {
        body: { refresh_token: shop.refresh_token, shop_id: Number(id), partner_id: cfg.partnerId },
      });
      saveTokens(id, r);
    } catch (e) {
      store.upsertShop(id, { status: 'need_reauth', last_error: String(e.message) });
      throw e;
    }
  })().finally(() => refreshing.delete(id));
  refreshing.set(id, p);
  return p;
}

// ---- API theo shop ----
export async function callShop(shopId, method, path, { query = {}, body } = {}, attempt = 0) {
  let shop = store.getShop(shopId);
  if (!shop || shop.status === 'need_reauth') throw new ShopeeError('shop_not_connected', `Shop ${shopId} cần kết nối lại`);
  if (shop.expires_at - now() < 300) { await refreshTokens(shopId); shop = store.getShop(shopId); }

  const ts = now();
  const q = new URLSearchParams({
    partner_id: String(cfg.partnerId), timestamp: String(ts), access_token: shop.access_token,
    shop_id: String(shopId),
    sign: shopSign(cfg.partnerId, cfg.partnerKey, path, ts, shop.access_token, shopId),
    ...query,
  });
  try {
    return await http(method, `${cfg.baseUrl}${path}?${q}`, body ? stringifyBig(body) : undefined);
  } catch (e) {
    if (!(e instanceof ShopeeError) && attempt < 2) { await sleep(500 * (attempt + 1)); return callShop(shopId, method, path, { query, body }, attempt + 1); }
    if (['error_auth', 'invalid_access_token', 'error_access_token_expired'].includes(e.code) && attempt < 1) {
      await refreshTokens(shopId);
      return callShop(shopId, method, path, { query, body }, attempt + 1);
    }
    if (['error_server', 'system_busy', 'error_busy'].includes(e.code) && attempt < 2) {
      await sleep(800 * (attempt + 1));
      return callShop(shopId, method, path, { query, body }, attempt + 1);
    }
    throw e;
  }
}

// Làm mới trước hạn để job chạy nền không bị chặn giữa chừng
export async function refreshDueTokens() {
  for (const s of store.listShops()) {
    if (s.status !== 'active') continue;
    if (s.token_expires_at - now() < 900) {
      try { await refreshTokens(s.id); } catch (e) { console.error(`[refresh] shop ${s.id}:`, e.message); }
    }
  }
}
