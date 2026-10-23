// Speichern auf dem Handy:
//  - Einstellungen, Personen und Siegerliste → localStorage (klein)
//  - Favoriten-Videos → IndexedDB (groß)
// Alle anderen Videos liegen nur im Arbeitsspeicher und verschwinden nach dem Battle.

const KEY = 'handstand-battle.v1';

export function loadData() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
export function saveData(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { console.warn('Speichern fehlgeschlagen', e); }
}

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('handstand-battle', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('favorites', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('favorites', mode), st = t.objectStore('favorites');
    const out = fn(st);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
}
export const favAll = () => tx('readonly', st => st.getAll()).catch(() => []);
export const favPut = rec => tx('readwrite', st => st.put(rec));
export const favDel = id => tx('readwrite', st => st.delete(id));
export const favClear = () => tx('readwrite', st => st.clear());
