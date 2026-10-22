import * as store from './store.js';
import * as chat from './shopee/chat.js';
import { refreshDueTokens } from './shopee/client.js';
import { cfg } from './config.js';

const emit = (type, data) => store.bus.emit('event', { type, ...data });

// Kéo danh sách hội thoại mới nhất của một shop; hội thoại nào có tin mới thì kéo luôn nội dung.
export async function syncShop(shopId) {
  try {
    const { items } = await chat.listConversations(shopId);
    let changed = 0;
    for (const c of items) {
      const k = store.ckey(shopId, c.id);
      const prev = store.getConv(k);
      store.upsertConv(shopId, c);
      if (!prev || prev.last_id !== c.last_id || store.getMessages(k).length === 0) {
        const msgs = await chat.getMessages(shopId, c.id, c.buyer_id);
        store.upsertMessages(k, msgs);
        changed++;
      }
    }
    store.upsertShop(shopId, { last_sync: Date.now(), last_error: '' });
    if (changed) emit('update', { shop_id: String(shopId) });
    return changed;
  } catch (e) {
    store.upsertShop(shopId, { last_error: String(e.message).slice(0, 300) });
    console.error(`[sync] shop ${shopId}:`, e.message);
    return 0;
  }
}

export async function syncAll() {
  await refreshDueTokens();
  for (const s of store.listShops()) {
    if (s.status === 'active') await syncShop(s.id);
  }
}

let running = false;
export function startPolling() {
  const tick = async () => {
    if (running) return;
    running = true;
    try { await syncAll(); } finally { running = false; }
  };
  tick();
  return setInterval(tick, cfg.pollSeconds * 1000);
}
