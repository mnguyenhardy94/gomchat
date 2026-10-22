// Server giả lập Shopee Open Platform để chạy thử toàn bộ luồng khi chưa có quyền chat.
// Giả lập đúng cách ký request, đổi code lấy token, refresh token dùng một lần, id 64-bit và push.
// Nó chỉ phản ánh cách mình hiểu API, không thay thế việc thử với Shopee thật.
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { publicSign, shopSign, pushSign } from './shopee/sign.js';
import { stringifyBig, parseBig } from './bigjson.js';

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID) || 1000001;
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || 'mock_partner_key';
const WEBHOOK = process.env.MOCK_WEBHOOK_URL || 'http://localhost:3000/webhook/shopee';
const EXPIRE = Number(process.env.MOCK_EXPIRE) || 14400;
const PREFIX = process.env.MOCK_PREFIX || '';
const IDKEYS = ['conversation_id', 'message_id', 'to_id', 'from_id', 'latest_message_id', 'latest_message_from_id', 'last_message_timestamp'];

export function createMock() {
  const app = express();
  const tokens = {}; // shopId -> {access, refresh, n}
  let authCount = 0;
  const log = [];
  const ok = (res, response) => res.type('json').send(stringifyBig({ error: '', message: '', request_id: 'mock', response }, IDKEYS));
  const fail = (res, error, message = '') => res.type('json').send(JSON.stringify({ error, message, request_id: 'mock' }));

  const BASE = 7312345678901234000n;
  let seq = 0n;
  const nextId = () => String(BASE + ++seq);
  const t0 = Math.floor(Date.now() / 1000);

  const shops = {};
  function shopData(id) {
    if (shops[id]) return shops[id];
    const mk = (buyer, name, texts) => ({
      conversation_id: nextId(), to_id: String(400000000 + Number(buyer)), to_name: name, unread: 0,
      msgs: texts.map(([from, text], i) => ({ message_id: nextId(), from, text, ts: t0 - 3600 + i * 60 })),
    });
    shops[id] = [
      mk(1, 'nguyenthu_91', [['b', 'Shop ơi dây chuyền bạc còn size 45cm không ạ?'], ['b', 'Mình muốn lấy 2 sợi nếu còn']]),
      mk(2, 'tranminh.khoa', [['b', 'Đơn của mình giao 5 ngày rồi chưa thấy tới'], ['s', 'Dạ shop kiểm tra mã vận đơn giúp bạn ngay ạ.']]),
    ];
    shops[id][0].unread = 2;
    return shops[id];
  }

  app.use(express.text({ type: '*/*' }));
  const bodyOf = (req) => (req.body ? parseBig(req.body) : {});

  app.get('/api/v2/shop/auth_partner', (req, res) => {
    const q = req.query;
    if (Number(q.partner_id) !== PARTNER_ID || q.sign !== publicSign(PARTNER_ID, PARTNER_KEY, req.path, q.timestamp)) {
      return res.status(403).send('sai chữ ký auth_partner');
    }
    const shopId = 1001 + (authCount++ % 2);
    res.redirect(`${q.redirect}${String(q.redirect).includes('?') ? '&' : '?'}code=MOCKCODE&shop_id=${shopId}`);
  });

  function issue(shopId) {
    const t = tokens[shopId] || { n: 0 };
    t.n++;
    t.access = `at_${shopId}_${t.n}`;
    t.refresh = `rt_${shopId}_${t.n}`;
    tokens[shopId] = t;
    return { access_token: t.access, refresh_token: t.refresh, expire_in: EXPIRE };
  }

  function checkPublic(req, res) {
    const q = req.query;
    if (Number(q.partner_id) !== PARTNER_ID || q.sign !== publicSign(PARTNER_ID, PARTNER_KEY, req.path, q.timestamp)) {
      fail(res, 'error_sign', 'Wrong sign'); return false;
    }
    return true;
  }

  app.post('/api/v2/auth/token/get', (req, res) => {
    if (!checkPublic(req, res)) return;
    const b = bodyOf(req);
    if (b.code !== 'MOCKCODE') return fail(res, 'error_param', 'invalid code');
    res.type('json').send(JSON.stringify({ error: '', message: '', request_id: 'mock', ...issue(b.shop_id) }));
  });

  app.post('/api/v2/auth/access_token/get', (req, res) => {
    if (!checkPublic(req, res)) return;
    const b = bodyOf(req);
    const t = tokens[b.shop_id];
    if (!t || t.refresh !== b.refresh_token) return fail(res, 'error_param', 'refresh_token invalid or already used');
    res.type('json').send(JSON.stringify({ error: '', message: '', request_id: 'mock', ...issue(b.shop_id) }));
  });

  // API theo shop: kiểm tra chữ ký và access_token
  app.use('/api/v2', (req, res, next) => {
    const q = req.query;
    const t = tokens[q.shop_id];
    if (Number(q.partner_id) !== PARTNER_ID) return fail(res, 'error_param', 'partner_id');
    if (q.sign !== shopSign(PARTNER_ID, PARTNER_KEY, (req.baseUrl + req.path).slice(PREFIX.length), q.timestamp, q.access_token, q.shop_id)) {
      return fail(res, 'error_sign', 'Wrong sign');
    }
    if (!t || t.access !== q.access_token) return fail(res, 'error_auth', 'Invalid access_token');
    log.push(req.method + ' ' + (req.baseUrl + req.path).slice(PREFIX.length));
    req.shopId = q.shop_id;
    next();
  });

  app.get('/api/v2/shop/get_shop_info', (req, res) => ok(res, { shop_name: `Mock Shop ${req.shopId}` }));

  app.get('/api/v2/sellerchat/get_conversation_list', (req, res) => {
    const list = shopData(req.shopId).map((c) => {
      const last = c.msgs[c.msgs.length - 1];
      return {
        conversation_id: c.conversation_id, to_id: c.to_id, to_name: c.to_name, to_avatar: '',
        unread_count: c.unread, latest_message_id: last.message_id,
        latest_message_from_id: last.from === 'b' ? c.to_id : '999',
        latest_message_type: 'text', latest_message_content: { text: last.text },
        last_message_timestamp: String(BigInt(last.ts) * 1000000000n),
      };
    });
    ok(res, { conversations: list, page_result: { page_size: 25, more: false } });
  });

  app.get('/api/v2/sellerchat/get_message', (req, res) => {
    const c = shopData(req.shopId).find((x) => x.conversation_id === req.query.conversation_id);
    if (!c) return fail(res, 'error_param', 'conversation not found');
    ok(res, {
      messages: c.msgs.map((m) => ({
        message_id: m.message_id, message_type: 'text', from_id: m.from === 'b' ? c.to_id : '999',
        to_id: m.from === 'b' ? '999' : c.to_id, content: { text: m.text }, created_timestamp: m.ts,
      })),
    });
  });

  app.post('/api/v2/sellerchat/send_message', (req, res) => {
    const b = bodyOf(req);
    const c = shopData(req.shopId).find((x) => x.to_id === String(b.to_id));
    if (!c) return fail(res, 'user_is_forbidden', 'unknown buyer');
    if (b.message_type !== 'text' || !b.content?.text) return fail(res, 'error_param', 'bad message');
    c.msgs.push({ message_id: nextId(), from: 's', text: b.content.text, ts: Math.floor(Date.now() / 1000) });
    ok(res, { message_id: c.msgs[c.msgs.length - 1].message_id });
  });

  app.post('/api/v2/sellerchat/read_conversation', (req, res) => {
    const b = bodyOf(req);
    const c = shopData(req.shopId).find((x) => x.conversation_id === String(b.conversation_id));
    if (c) c.unread = 0;
    ok(res, {});
  });

  // Mô phỏng khách nhắn tới: thêm tin và bắn push có chữ ký về webhook
  app.post('/mock/inject', async (req, res) => {
    const b = JSON.parse(req.body || '{}');
    const shopId = String(b.shop_id || 1001);
    const c = shopData(shopId)[b.index || 0];
    c.msgs.push({ message_id: nextId(), from: 'b', text: b.text || 'Shop ơi còn hàng không?', ts: Math.floor(Date.now() / 1000) });
    c.unread++;
    const raw = JSON.stringify({ code: 10, shop_id: Number(shopId), timestamp: Math.floor(Date.now() / 1000), data: { type: 'message' } });
    const r = await fetch(WEBHOOK, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', Authorization: pushSign(PARTNER_KEY, WEBHOOK, raw) } });
    res.json({ push_status: r.status });
  });

  app.get('/mock/log', (req, res) => res.json({ calls: log, tokens }));
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.MOCK_PORT) || 4000;
  createMock().listen(port, () => console.log(`Shopee giả lập chạy tại http://localhost:${port}`));
}
