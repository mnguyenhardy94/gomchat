const port = Number(process.env.PORT) || 3000;
const prod = process.env.NODE_ENV === 'production';

export const cfg = {
  prod,
  port,
  partnerId: Number(process.env.SHOPEE_PARTNER_ID) || 0,
  partnerKey: process.env.SHOPEE_PARTNER_KEY || '',
  baseUrl: (process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com').replace(/\/$/, ''),
  authBaseUrl: (process.env.SHOPEE_AUTH_URL || process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com').replace(/\/$/, ''),
  demo: process.env.DEMO === '1',
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || '',
  encKey: process.env.TOKEN_ENC_KEY || '',
  dataFile: process.env.DATA_FILE || './data/db.json',
  pollSeconds: Number(process.env.POLL_SECONDS) || 60,
  pushVerify: (process.env.PUSH_VERIFY || 'on') !== 'off',
  pushUrl: process.env.PUSH_URL || '',
};

export function checkConfig() {
  const errs = [];
  if (!cfg.partnerId) errs.push('Thiếu SHOPEE_PARTNER_ID');
  if (!cfg.partnerKey) errs.push('Thiếu SHOPEE_PARTNER_KEY');
  if (cfg.prod) {
    if (!cfg.adminPass) errs.push('Thiếu ADMIN_PASS (bắt buộc khi production)');
    if (!cfg.encKey) errs.push('Thiếu TOKEN_ENC_KEY (bắt buộc khi production)');
    if (!cfg.publicUrl.startsWith('https://')) errs.push('PUBLIC_URL phải là HTTPS khi production');
  }
  return errs;
}
