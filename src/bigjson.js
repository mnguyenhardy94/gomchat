// conversation_id, message_id, user id của Shopee là số nguyên 64-bit, vượt quá độ chính xác của
// số JS (2^53). Biến mọi số nguyên từ 16 chữ số trở lên thành chuỗi trước khi parse.
export function parseBig(text) {
  const safe = text.replace(/("(?:[^"\\]|\\.)*")|(-?\d{16,})(?=\s*[,}\]])/g, (m, str, num) =>
    str ? str : `"${num}"`
  );
  return JSON.parse(safe);
}

// Khi gửi: các khóa chứa id 64-bit được gửi lại dạng số, không phải chuỗi.
export function stringifyBig(obj, numericKeys = ['to_id', 'conversation_id', 'last_read_message_id', 'message_id']) {
  let s = JSON.stringify(obj);
  for (const k of numericKeys) {
    s = s.replace(new RegExp(`("${k}":)"(\\d+)"`, 'g'), '$1$2');
  }
  return s;
}
