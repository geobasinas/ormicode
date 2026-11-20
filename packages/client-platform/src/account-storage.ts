export function clearAccountStorage(): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) if (key?.startsWith('ormi.') || key?.startsWith('ormicode.')) storage.removeItem(key);
  } catch { /* Storage can be unavailable in private browsing. */ }
}
