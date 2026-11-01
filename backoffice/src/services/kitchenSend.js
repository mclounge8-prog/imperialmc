// Какие строки чека ещё не ушли на кухню.
// requestedIds === null — старые терминалы, отправить всё новое.
// requestedIds — массив: только отмеченные позиции, даже если массив пустой.
export function pickKitchenItems(items, requestedIds) {
  const fresh = (items || []).filter((item) => Number(item.qty) - Number(item.sentQty) > 0);
  if (requestedIds == null) return fresh;
  const wanted = new Set(
    (Array.isArray(requestedIds) ? requestedIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  return fresh.filter((item) => wanted.has(Number(item.id)));
}

export function kitchenItemIdsFromBody(body) {
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'itemIds')) {
    return null;
  }
  return body.itemIds;
}
