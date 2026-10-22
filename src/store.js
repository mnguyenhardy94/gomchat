import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cfg } from './config.js';

// Lưu bằng một file JSON (ghi nguyên tử). Đủ cho vài shop và vài nhân viên.
// Khi cần nhiều người dùng đồng thời hoặc nhiều server, thay file này bằng Postgres, giữ nguyên các hàm export.

export const bus = new EventEmitter();

const devKey = 'dev-only-key-khong-dung-cho-production';
if (!cfg.encKey) console.warn('[cảnh báo] TOKEN_ENC_KEY trống: token đang mã hóa bằng khóa dev.');
const key = crypto.createHash('sha256').update(cfg.encKey || devKey).digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

let db = { shops: {}, convs: {}, msgs: {}, meta: {} };
let timer = null;

export function load() {
  try {
    db = JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  for (const k of ['shops', 'convs', 'msgs', 'meta']) db[k] ||= {};
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}
export function flush() {
  clearTimeout(timer);
  fs.mkdirSync(path.dirname(cfg.dataFile), { recursive: true });
  const tmp = cfg.dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, cfg.dataFile);
}

export const ckey = (shopId, convId) => `${shopId}-${convId}`;

// ---- shop ----
export function upsertShop(shopId, patch) {
  const id = String(shopId);
  const cur = db.shops[id] || { shop_id: id, name: `Shop ${id}`, status: 'active' };
  const next = { ...cur, ...patch };
  if (patch.access_token) next.access_token_enc = encrypt(patch.access_token);
  if (patch.refresh_token) next.refresh_token_enc = encrypt(patch.refresh_token);
  delete next.access_token;
  delete next.refresh_token;
  db.shops[id] = next;
  save();
  return next;
}
export function getShop(shopId) {
  const s = db.shops[String(shopId)];
  if (!s) return null;
  return {
    ...s,
    access_token: s.access_token_enc ? decrypt(s.access_token_enc) : '',
    refresh_token: s.refresh_token_enc ? decrypt(s.refresh_token_enc) : '',
  };
}
export function listShops() {
  return Object.values(db.shops).map((s) => ({
    id: s.shop_id, name: s.name, status: s.status,
    token_expires_at: s.expires_at || 0, last_sync: s.last_sync || 0, last_error: s.last_error || '',
  }));
}

// ---- hội thoại ----
export function upsertConv(shopId, c) {
  const k = ckey(shopId, c.id);
  const prev = db.convs[k] || {};
  db.convs[k] = { ...prev, ...c, key: k, shop_id: String(shopId) };
  save();
  return db.convs[k];
}
export function getConv(key) { return db.convs[key] || null; }
export function listConvs() {
  return Object.values(db.convs).map((c) => ({ ...c, ...(db.meta[c.key] || { tags: [], assignee: '' }) }));
}

// ---- tin nhắn ----
export function upsertMessages(key, list) {
  const arr = db.msgs[key] || [];
  const seen = new Set(arr.map((m) => m.id));
  let added = 0;
  for (const m of list) {
    if (seen.has(m.id)) continue;
    arr.push(m); seen.add(m.id); added++;
  }
  arr.sort((a, b) => a.ts - b.ts);
  db.msgs[key] = arr.slice(-500);
  if (added) save();
  return added;
}
export function getMessages(key) { return db.msgs[key] || []; }

export function setMeta(key, patch) {
  const cur = db.meta[key] || { tags: [], assignee: '' };
  db.meta[key] = { ...cur, ...patch };
  save();
  return db.meta[key];
}
