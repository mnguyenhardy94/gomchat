import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shopee-inbox-'));
Object.assign(process.env, {
  SHOPEE_PARTNER_ID: '1000001',
  SHOPEE_PARTNER_KEY: 'mock_partner_key',
  SHOPEE_BASE_URL: 'http://localhost:4100',
  PUBLIC_URL: 'http://localhost:3100',
  MOCK_WEBHOOK_URL: 'http://localhost:3100/webhook/shopee',
  MOCK_EXPIRE: '100', // access token hết hạn rất sớm để buộc refresh liên tục
  ADMIN_PASS: 'pw',
  TOKEN_ENC_KEY: 'test-key',
  DATA_FILE: path.join(tmp, 'db.json'),
});

const auth = { Authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') };
const S = 'http://localhost:3100';
let servers = [];

before(async () => {
  const { createMock } = await import('../src/mock.js');
  const { app } = await import('../src/server.js');
  servers.push(createMock().listen(4100), app.listen(3100));
});
after(() => { servers.forEach((s) => s.close()); fs.rmSync(tmp, { recursive: true, force: true }); });

const get = (p) => fetch(S + p, { headers: auth }).then((r) => r.json());
const send = (method, p, body) => fetch(S + p, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function connect() {
  const r1 = await fetch(S + '/auth/connect', { headers: auth, redirect: 'manual' });
  assert.equal(r1.status, 302);
  const r2 = await fetch(r1.headers.get('location'), { redirect: 'manual' });
  assert.equal(r2.status, 302, 'Shopee giả phải nhận chữ ký auth_partner');
  const r3 = await fetch(r2.headers.get('location'), { headers: auth, redirect: 'manual' });
  assert.equal(r3.status, 302);
  return r3.headers.get('location');
}

test('bigjson giữ nguyên id 64-bit', async () => {
  const { parseBig, stringifyBig } = await import('../src/bigjson.js');
  const o = parseBig('{"conversation_id":7312345678901234567,"n":5,"s":"12345678901234567890"}');
  assert.equal(o.conversation_id, '7312345678901234567');
  assert.equal(o.n, 5);
  assert.equal(stringifyBig({ to_id: '7312345678901234567' }), '{"to_id":7312345678901234567}');
});

test('API cần đăng nhập', async () => {
  assert.equal((await fetch(S + '/api/state')).status, 401);
});

test('kết nối 2 shop qua OAuth và đồng bộ hội thoại', async () => {
  assert.match(await connect(), /connected=1001/);
  assert.match(await connect(), /connected=1002/);
  await send('POST', '/api/sync');
  const st = await get('/api/state');
  assert.equal(st.shops.length, 2);
  assert.equal(st.shops[0].name, 'Mock Shop 1001');
  assert.equal(st.conversations.length, 4);
  for (const c of st.conversations) assert.match(c.key, /^\d+-\d{19}$/, 'id hội thoại phải giữ đủ 19 chữ số');
  const first = st.conversations.find((c) => c.name === 'nguyenthu_91' && c.shop_id === '1001');
  const { messages } = await get(`/api/conversations/${first.key}/messages`);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].from, 'buyer');
});

test('token được refresh nhiều lần mà không bị từ chối (refresh token dùng một lần)', async () => {
  for (let i = 0; i < 3; i++) await send('POST', '/api/sync');
  const log = await fetch('http://localhost:4100/mock/log').then((r) => r.json());
  assert.ok(log.tokens['1001'].n >= 4, `đã refresh ${log.tokens['1001'].n} lần`);
  const st = await get('/api/state');
  assert.ok(st.shops.every((s) => s.status === 'active' && !s.last_error), JSON.stringify(st.shops));
});

test('trả lời khách gửi đúng shop', async () => {
  const st = await get('/api/state');
  const c = st.conversations.find((x) => x.name === 'tranminh.khoa' && x.shop_id === '1002');
  const r = await send('POST', `/api/conversations/${c.key}/reply`, { text: 'Dạ shop đã kiểm tra, hàng đang ở bưu cục ạ.' });
  assert.equal(r.status, 200);
  const { messages } = await get(`/api/conversations/${c.key}/messages`);
  const last = messages[messages.length - 1];
  assert.equal(last.from, 'shop');
  assert.match(last.text, /bưu cục/);
  const bad = await send('POST', `/api/conversations/${c.key}/reply`, { text: '   ' });
  assert.equal(bad.status, 400);
});

test('push có chữ ký đúng cập nhật tin mới, sai chữ ký bị từ chối', async () => {
  const before = await get('/api/state');
  const c0 = before.conversations.find((x) => x.name === 'nguyenthu_91' && x.shop_id === '1001');
  const r = await fetch('http://localhost:4100/mock/inject', { method: 'POST', body: JSON.stringify({ shop_id: 1001, index: 0, text: 'Shop ơi còn không?' }) }).then((x) => x.json());
  assert.equal(r.push_status, 200);
  await new Promise((r) => setTimeout(r, 400)); // push xử lý bất đồng bộ
  const { messages } = await get(`/api/conversations/${c0.key}/messages`);
  assert.equal(messages[messages.length - 1].text, 'Shop ơi còn không?');

  const forged = await fetch(S + '/webhook/shopee', { method: 'POST', body: '{"code":10,"shop_id":1001}', headers: { Authorization: 'deadbeef' } });
  assert.equal(forged.status, 401);
});

test('tag và người phụ trách chỉ nhận giá trị hợp lệ', async () => {
  const st = await get('/api/state');
  const c = st.conversations[0];
  await send('PATCH', `/api/conversations/${c.key}/meta`, { tags: ['Đổi trả', 'tag-la'], assignee: 'Linh' });
  const after = (await get('/api/state')).conversations.find((x) => x.key === c.key);
  assert.deepEqual(after.tags, ['Đổi trả']);
  assert.equal(after.assignee, 'Linh');
});

test('token lưu trên đĩa đã mã hóa', () => {
  const raw = fs.readFileSync(process.env.DATA_FILE, 'utf8');
  assert.doesNotMatch(raw, /at_100\d_\d/);
  assert.doesNotMatch(raw, /rt_100\d_\d/);
});
