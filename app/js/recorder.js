// Nimmt das Kamerabild ohne Ton auf.
// Solange niemand im Handstand ist, wird alle 12 s neu begonnen (damit Videos klein bleiben),
// so ist der Anlauf vor dem Handstand trotzdem fast immer mit drauf.

const TYPES = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

export class ClipRecorder {
  constructor(stream) {
    this.stream = stream; this.mime = pickMime(); this.rec = null;
  }
  get ok() { return this.mime !== null; }
  start() {
    if (!this.ok) return;
    const chunks = [];
    let rec;
    try { rec = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: 2_500_000 }); }
    catch (e) { console.warn('Aufnahme nicht möglich', e); this.mime = null; return; }
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(500);
    this.rec = rec; this.chunks = chunks; this.t0 = performance.now();
  }
  // Beendet die aktuelle Aufnahme und gibt {blob, t0, t1} zurück
  stop() {
    const rec = this.rec, chunks = this.chunks, t0 = this.t0;
    this.rec = null;
    if (!rec) return Promise.resolve(null);
    return new Promise(res => {
      const t1 = performance.now();
      rec.onstop = () => res({ blob: new Blob(chunks, { type: rec.mimeType || this.mime || 'video/webm' }), t0, t1 });
      try { rec.stop(); } catch { res(null); }
    });
  }
  // Leerlauf-Aufnahme verwerfen und neu beginnen
  rotate() { const r = this.rec; this.rec = null; if (r) { try { r.stop(); } catch { } } this.start(); }
  dispose() { const r = this.rec; this.rec = null; if (r) { try { r.stop(); } catch { } } }
}

// MediaRecorder-WebM hat oft keine Länge gespeichert – das hier repariert Vor-/Zurückspulen.
export function fixDuration(video) {
  return new Promise(res => {
    const done = () => { video.removeEventListener('timeupdate', onT); res(); };
    const onT = () => { video.currentTime = 0; setTimeout(done, 50); };
    const go = () => {
      if (video.duration === Infinity || isNaN(video.duration)) { video.addEventListener('timeupdate', onT, { once: true }); video.currentTime = 1e7; }
      else res();
    };
    if (video.readyState >= 1) go(); else video.addEventListener('loadedmetadata', go, { once: true });
    setTimeout(res, 3000);
  });
}
