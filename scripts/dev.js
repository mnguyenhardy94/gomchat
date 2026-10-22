// Chạy thử toàn bộ (Shopee giả + app) bằng một lệnh, dùng được trên Windows, Mac và Linux.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  SHOPEE_BASE_URL: 'http://localhost:4000',
  SHOPEE_PARTNER_ID: '1000001',
  SHOPEE_PARTNER_KEY: 'mock_partner_key',
  PUBLIC_URL: 'http://localhost:3000',
  MOCK_WEBHOOK_URL: 'http://localhost:3000/webhook/shopee',
  DATA_FILE: './data/dev-db.json',
};
delete env.NODE_ENV;

const run = (file) => spawn(process.execPath, [path.join(root, file)], { cwd: root, env, stdio: 'inherit' });
const kids = [run('src/mock.js'), run('src/server.js')];
const stop = () => kids.forEach((k) => k.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
kids.forEach((k) => k.on('exit', stop));
console.log('\nMở http://localhost:3000 rồi bấm "Kết nối shop" (bấm 2 lần để thêm 2 shop giả).\n');
