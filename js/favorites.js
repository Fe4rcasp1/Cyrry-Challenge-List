const KEY = 'ccl-favorites-v1';
export function getFavorites() {
    try { const items = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(items) ? items : []; }
    catch { return []; }
}
export function isFavorite(id, platformer = false) { return getFavorites().some(x => x.id === String(id) && x.platformer === platformer); }
export function toggleFavorite(level, platformer = false) {
    if (!level) return getFavorites();
    const id = String(level.id);
    const items = getFavorites();
    const i = items.findIndex(x => x.id === id && x.platformer === platformer);
    if (i >= 0) items.splice(i, 1);
    else items.push({ id, platformer, name: level.name });
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    window.dispatchEvent(new Event('ccl-favorites-changed'));
    return items;
}
