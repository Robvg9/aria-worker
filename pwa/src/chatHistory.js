export function mergeRestoredChatMessages(restored, current) {
  const merged = Array.isArray(restored) ? [...restored] : [];
  const restoredCounts = new Map();
  const currentCounts = new Map();
  const keyFor = (message) => JSON.stringify([message.role, message.text]);

  for (const message of merged) {
    const key = keyFor(message);
    restoredCounts.set(key, (restoredCounts.get(key) ?? 0) + 1);
  }

  for (const message of Array.isArray(current) ? current : []) {
    const key = keyFor(message);
    const count = (currentCounts.get(key) ?? 0) + 1;
    currentCounts.set(key, count);
    if (count > (restoredCounts.get(key) ?? 0)) merged.push(message);
  }

  return merged;
}
