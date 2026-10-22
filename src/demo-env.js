// Khi DEMO=1: tự điền cấu hình để Shopee giả chạy cùng server (dùng để xem thử trên web).
if (process.env.DEMO === '1') {
  const port = process.env.PORT || '3000';
  const pub = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const local = `http://localhost:${port}`;
  const d = {
    SHOPEE_PARTNER_ID: '1000001',
    SHOPEE_PARTNER_KEY: 'demo_partner_key',
    MOCK_PREFIX: '/mock-shopee',
    SHOPEE_BASE_URL: `${local}/mock-shopee`,   // server gọi nội bộ
    SHOPEE_AUTH_URL: `${pub}/mock-shopee`,     // trình duyệt của người dùng được chuyển hướng tới đây
    MOCK_WEBHOOK_URL: `${local}/webhook/shopee`,
    PUSH_URL: `${local}/webhook/shopee`,
  };
  for (const [k, v] of Object.entries(d)) if (!process.env[k]) process.env[k] = v;
}
