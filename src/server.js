import './demo-env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { cfg, checkConfig } from './config.js';
import * as store from './store.js';
import * as chat from './shopee/chat.js';
import { buildAuthUrl, exchangeCode } from './shopee/client.js';
import { pushSign, safeEqualHex } from './shopee/sign.js';
import { syncShop, startPolling } from './sync.js';
import { parseBig } from './bigjson.js';

const errs = checkConfig();
if (errs.length) {
  console.error('Cấu hình chưa đủ:\n - ' + errs.join('\n - '));
  process.exit(1);
}
store.load();

const TAGS = ['Hỏi hàng', 'Đổi trả', 'Khiếu nại', 'Đã chốt'];
const STAFF = (process.env.STAFF || 'Linh,Hùng,Trang').split(',').map((s) => s.trim()).filter(Boolean);
const pushUrl = cfg.pushUrl || `${cfg.publicUrl}/webhook/shopee`;

export const app = express();
app.disable('x-powered-by');

// ---------- Webhook push từ Shopee (không dùng đăng nhập, dùng chữ ký) ----------
app.post('/webhook/shopee', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (cfg.pushVerify) {
    const sig = req.get('authorization') || '';
    const expected = pushSign(cfg.partnerKey, pushUrl, raw);
    if (!safeEqualHex(sig, expected)) {
      console.warn('[push] sai chữ ký, bỏ qua. Kiểm tra PUSH_URL và Push Key trong console Shopee.');
      return res.status(401).json({ error: 'bad_signature' });
    }
  }
  res.status(200).json({}); // trả lời ngay, xử lý sau
  let ev;
  try { ev = parseBig(raw); } catch { return; }
  handlePush(ev).catch((e) => console.error('[push]', e.message));
});

async function handlePush(ev) {
  const shopId = String(ev.shop_id || '');
  if (!shopId) return;
  switch (Number(ev.code)) {
    case 1: store.upsertShop(shopId, { status: 'active' }); break;           // shop cấp quyền
    case 2: store.upsertShop(shopId, { status: 'need_reauth', last_error: 'Shop đã hủy ủy quyền' }); break;
    case 12: console.warn(`[push] token shop ${shopId} sắp hết hạn`); break;
    case 10: await syncShop(shopId); break;                                   // webchat_push: có tin nhắn mới
    default: break;
  }
}

// Chế độ demo: Shopee giả chạy ngay trong server này, không cần quyền từ Shopee
if (cfg.demo) {
  const { createMock } = await import('./mock.js');
  app.use('/mock-shopee', createMock());
}

// ---------- Đăng nhập nhân viên ----------
app.use((req, res, next) => {
  if (!cfg.adminPass) return next(); // chỉ xảy ra khi chạy dev
  const h = req.get('authorization') || '';
  const [u, ...rest] = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString().split(':');
  const p = rest.join(':');
  const ok = u === cfg.adminUser && p.length === cfg.adminPass.length &&
    crypto.timingSafeEqual(Buffer.from(p), Buffer.from(cfg.adminPass));
  if (ok) return next();
  res.set('WWW-Authenticate', 'Basic realm="Hop thu Shopee"').status(401).send('Cần đăng nhập');
});

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

// ---------- Kết nối shop (OAuth) ----------
app.get('/auth/connect', (req, res) => {
  res.redirect(buildAuthUrl(`${cfg.publicUrl}/auth/callback`));
});

app.get('/auth/callback', async (req, res) => {
  const { code, shop_id: shopId } = req.query;
  if (!code || !shopId) return res.status(400).send('Thiếu code hoặc shop_id từ Shopee. Thử kết nối lại.');
  try {
    await exchangeCode(String(code), String(shopId));
    try {
      const name = await chat.getShopName(shopId);
      if (name) store.upsertShop(shopId, { name });
    } catch (e) { console.warn('[auth] không lấy được tên shop:', e.message); }
    syncShop(shopId).catch(() => {});
    res.redirect('/?connected=' + encodeURIComponent(shopId));
  } catch (e) {
    console.error('[auth]', e.message);
    res.status(502).send('Kết nối shop thất bại: ' + String(e.message).replace(/[<>&]/g, ''));
  }
});

// ---------- API cho giao diện ----------
const KEY = /^\d+-\d+$/;

function view() {
  const convs = store.listConvs().sort((a, b) => b.last_ts - a.last_ts).map((c) => ({
    key: c.key, shop_id: c.shop_id, name: c.name, unread: c.unread || 0,
    last_text: c.last_text, last_ts: c.last_ts, pending: Boolean(c.last_from_buyer),
    tags: c.tags || [], assignee: c.assignee || '',
  }));
  return { shops: store.listShops(), conversations: convs, tags: TAGS, staff: STAFF, connect_url: '/auth/connect', demo: cfg.demo };
}

app.get('/api/state', (req, res) => res.json(view()));

app.get('/api/conversations/:key/messages', (req, res) => {
  if (!KEY.test(req.params.key) || !store.getConv(req.params.key)) return res.status(404).json({ error: 'not_found' });
  res.json({ messages: store.getMessages(req.params.key) });
});

app.post('/api/conversations/:key/open', async (req, res) => {
  const c = KEY.test(req.params.key) && store.getConv(req.params.key);
  if (!c) return res.status(404).json({ error: 'not_found' });
  store.upsertConv(c.shop_id, { id: c.id, unread: 0 });
  res.json({ ok: true });
  if (c.last_id) chat.markRead(c.shop_id, c.id, c.last_id).catch((e) => console.warn('[read]', e.message));
});

app.post('/api/conversations/:key/reply', async (req, res) => {
  const c = KEY.test(req.params.key) && store.getConv(req.params.key);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Nội dung trống hoặc dài quá 2000 ký tự' });
  try {
    await chat.sendText(c.shop_id, c.buyer_id, text);
    store.upsertConv(c.shop_id, { id: c.id, last_from_buyer: false, last_text: text, last_ts: Date.now(), unread: 0 });
    await syncShop(c.shop_id); // kéo tin vừa gửi về để có id và giờ chuẩn của Shopee
    res.json({ ok: true });
  } catch (e) {
    console.error('[reply]', e.message);
    res.status(502).json({ error: replyError(e) });
  }
});

function replyError(e) {
  const m = {
    reach_5_message_limit: 'Khách chưa trả lời, shop chỉ được gửi tối đa 5 tin liên tiếp.',
    user_is_forbidden: 'Khách này đã chặn hoặc không nhận tin từ shop.',
    message_is_censored: 'Shopee từ chối nội dung tin nhắn này.',
    shop_not_connected: 'Shop cần kết nối lại với Shopee.',
  };
  return m[e.code] || `Shopee báo lỗi: ${e.message}`;
}

app.patch('/api/conversations/:key/meta', (req, res) => {
  const c = KEY.test(req.params.key) && store.getConv(req.params.key);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const patch = {};
  if (Array.isArray(req.body?.tags)) patch.tags = req.body.tags.filter((t) => TAGS.includes(t));
  if (typeof req.body?.assignee === 'string') patch.assignee = STAFF.includes(req.body.assignee) ? req.body.assignee : '';
  res.json(store.setMeta(c.key, patch));
  store.bus.emit('event', { type: 'update' });
});

app.post('/api/sync', async (req, res) => {
  for (const s of store.listShops()) if (s.status === 'active') await syncShop(s.id);
  res.json(view());
});

// Cập nhật thời gian thực cho giao diện
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  store.bus.on('event', send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { store.bus.off('event', send); clearInterval(ping); });
});

// ---------- Chạy ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = app.listen(cfg.port, () => {
    console.log(`Hộp thư Shopee chạy tại ${cfg.publicUrl} (cổng ${cfg.port})`);
    console.log(`URL push cần đăng ký trên Shopee: ${pushUrl}`);
    console.log(`URL redirect cần đăng ký: ${cfg.publicUrl}/auth/callback`);
    if (!cfg.adminPass) console.warn('[cảnh báo] ADMIN_PASS trống: giao diện đang mở, chỉ dùng khi chạy thử trên máy bạn.');
  });
  startPolling();
  const stop = () => { store.flush(); server.close(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
