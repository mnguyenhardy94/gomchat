import { callShop } from './client.js';

// Toàn bộ hình dạng dữ liệu của sellerchat nằm trong file này.
// Tên tham số và tên trường dưới đây viết theo hiểu biết về API v2.sellerchat, CHƯA đối chiếu được với
// tài liệu chính thức (module chat chỉ mở sau khi Shopee cấp quyền cho app). Khi có quyền, đối chiếu từng
// hàm với open.shopee.com/documents, sai chỗ nào chỉ cần sửa trong file này.

const P = '/api/v2/sellerchat/';

function textOf(content, type) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (content.text) return content.text;
  if (type === 'image') return '[Hình ảnh]';
  if (type === 'sticker') return '[Sticker]';
  if (type === 'item' || type === 'item_list') return '[Sản phẩm]';
  if (type === 'order') return '[Đơn hàng]';
  if (type === 'video') return '[Video]';
  return `[${type || 'tin nhắn'}]`;
}

export function normalizeConversation(c) {
  const lastTs = Number(c.last_message_timestamp || 0); // nanosecond theo tài liệu, đổi sang ms
  const ms = lastTs > 1e17 ? Math.floor(lastTs / 1e6) : lastTs > 1e12 ? lastTs : lastTs * 1000;
  return {
    id: String(c.conversation_id),
    buyer_id: String(c.to_id),
    name: c.to_name || `Khách ${c.to_id}`,
    avatar: c.to_avatar || '',
    unread: Number(c.unread_count || 0),
    last_text: textOf(c.latest_message_content, c.latest_message_type),
    last_from_buyer: String(c.latest_message_from_id) === String(c.to_id),
    last_id: String(c.latest_message_id || ''),
    last_ts: ms || Date.now(),
  };
}

export function normalizeMessage(m, buyerId) {
  const raw = Number(m.created_timestamp || 0);
  return {
    id: String(m.message_id),
    from: String(m.from_id) === String(buyerId) ? 'buyer' : 'shop',
    type: m.message_type || 'text',
    text: textOf(m.content, m.message_type),
    ts: raw > 1e12 ? raw : raw * 1000,
  };
}

export async function listConversations(shopId, { pageSize = 25, cursor } = {}) {
  const r = await callShop(shopId, 'GET', P + 'get_conversation_list', {
    query: { direction: 'latest', type: 'all', page_size: String(pageSize), ...(cursor ? { next_timestamp_nano: String(cursor) } : {}) },
  });
  const resp = r.response || {};
  return {
    items: (resp.conversations || []).map(normalizeConversation),
    more: Boolean(resp.page_result?.more),
  };
}

export async function getMessages(shopId, conversationId, buyerId, { pageSize = 40 } = {}) {
  const r = await callShop(shopId, 'GET', P + 'get_message', {
    query: { conversation_id: String(conversationId), page_size: String(pageSize) },
  });
  return (r.response?.messages || []).map((m) => normalizeMessage(m, buyerId));
}

export async function sendText(shopId, buyerId, text) {
  const r = await callShop(shopId, 'POST', P + 'send_message', {
    body: { to_id: String(buyerId), message_type: 'text', content: { text } },
  });
  return r.response || {};
}

export async function markRead(shopId, conversationId, lastMessageId) {
  await callShop(shopId, 'POST', P + 'read_conversation', {
    body: { conversation_id: String(conversationId), last_read_message_id: String(lastMessageId) },
  });
}

export async function getShopName(shopId) {
  const r = await callShop(shopId, 'GET', '/api/v2/shop/get_shop_info');
  return r.response?.shop_name || r.shop_name || '';
}
