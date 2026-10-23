// Körpererkennung mit MediaPipe Pose (läuft komplett auf dem Handy, nichts wird hochgeladen).
// Findet die KI mehrere Bilder lang keinen Körper, probiert sie es mit dem um 180° gedrehten Bild
// (dann sieht ein Mensch im Handstand für sie „normal stehend“ aus).

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

let libPromise = null;
let useCpu = false; // wird gesetzt, wenn die Grafikeinheit (GPU) Probleme macht

function lib() {
  if (!libPromise) {
    libPromise = (async () => {
      const mod = await import(`${MP}/vision_bundle.mjs`);
      const files = await mod.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      return { PoseLandmarker: mod.PoseLandmarker, files };
    })();
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

// Erstellt jedes Mal eine frische KI. Eine alte kann kaputt sein, wenn die App im Hintergrund war
// (das Handy gibt dann die Grafikeinheit frei) – deshalb nie eine alte wiederverwenden.
export async function loadPose() {
  const { PoseLandmarker, files } = await lib();
  const opts = d => ({
    baseOptions: { modelAssetPath: MODEL, delegate: d },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  if (!useCpu) {
    try { return await PoseLandmarker.createFromOptions(files, opts('GPU')); }
    catch (e) { console.warn('GPU nicht verfügbar, nutze CPU', e); useCpu = true; }
  }
  return await PoseLandmarker.createFromOptions(files, opts('CPU'));
}
// Nach wiederholten Fehlern mit der GPU auf CPU umschalten
export function preferCpu() { useCpu = true; }

export class PoseRunner {
  constructor(landmarker) {
    this.lm = landmarker;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    this.flip = false; this.miss = 0; this.lastTs = 0;
    this.errors = 0; this.broken = false;
  }
  close() { try { this.lm.close(); } catch { } }
  detect(video, now) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const w = 640, h = Math.round(640 * vh / vw);
    if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = h; }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flip) { c.translate(w, h); c.rotate(Math.PI); }
    c.drawImage(video, 0, 0, w, h);
    const ts = Math.max(now, this.lastTs + 1); this.lastTs = ts;
    let res;
    try { res = this.lm.detectForVideo(this.canvas, ts); this.errors = 0; }
    catch (e) { console.warn(e); if (++this.errors >= 10) this.broken = true; return null; }
    const raw = res && res.landmarks && res.landmarks[0];
    if (!raw) {
      if (++this.miss >= 4) { this.flip = !this.flip; this.miss = 0; }
      return null;
    }
    this.miss = 0;
    return raw.map(p => this.flip ? { x: 1 - p.x, y: 1 - p.y, visibility: p.visibility } : { x: p.x, y: p.y, visibility: p.visibility });
  }
}

// ---------- Demo-Modus (?demo in der Adresse): simuliert Handstände ohne Kamera ----------
// Zum Testen am Computer. Zeichnet ein Strichmännchen in ein Bild, das wie ein Kamerabild aufgenommen wird.
export class DemoSource {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280; this.canvas.height = 720;
    this.ctx = this.canvas.getContext('2d');
    this.t0 = performance.now();
    this.cycle = 0; this.plan(0);
    this.pose(this.t0);
  }
  plan(at) {
    this.cStart = at; this.cycle++;
    const r = Math.random;
    this.stand = 2 + r() * 1.5; this.hold = 2.5 + r() * 6; this.arch = r() < 0.5 ? r() * 25 : 0;
    this.split = r() < 0.4 ? r() * 0.35 : 0; this.wob = 1 + r() * 6; this.kneeB = r() < 0.3 ? 25 : 0;
    this.stepAt = r() < 0.4 ? 1 + r() * (this.hold - 1.5) : -1;
  }
  stream() { return this.canvas.captureStream(30); }
  pose(now) {
    let t = (now - this.t0) / 1000 - this.cStart;
    const total = this.stand + 0.4 + this.hold + 0.5;
    if (t > total) { this.plan((now - this.t0) / 1000); t = 0; }
    const H = 720, W = 1280, cx = 640, floor = 640, L = 520; // Körperlänge in Pixeln
    const pt = (x, y, v = 0.95) => ({ x: x / W, y: y / H, visibility: v });
    const J = {};
    const inv = t > this.stand + 0.2 && t < this.stand + 0.4 + this.hold;
    const ht = t - this.stand - 0.4;
    if (!inv) {
      const sw = Math.sin(t * 2) * 6;
      J.an = [cx + sw, floor]; J.kn = [cx + sw, floor - L * 0.25]; J.hip = [cx + sw, floor - L * 0.5];
      J.sh = [cx + sw, floor - L * 0.8]; J.wr = [cx + sw + 10, floor - L * 0.5]; J.head = [cx + sw, floor - L * 0.92];
      J.fx = 1;
    } else {
      const wob = Math.sin(ht * 2.3) * this.wob + Math.sin(ht * 5.1) * this.wob * 0.3;
      const hs = this.stepAt > 0 && ht > this.stepAt ? 70 : 0;
      const rad = a => a * Math.PI / 180;
      const ax = rad(wob);
      const wr = [cx + hs, floor];
      const sh = [wr[0] + Math.sin(ax) * L * 0.3, floor - Math.cos(ax) * L * 0.3];
      const hip = [sh[0] + Math.sin(ax) * L * 0.3, sh[1] - Math.cos(ax) * L * 0.3];
      const la = ax - rad(this.arch);
      const kn = [hip[0] + Math.sin(la) * L * 0.22, hip[1] - Math.cos(la) * L * 0.22];
      const ka = la + rad(this.kneeB);
      const an = [kn[0] + Math.sin(ka) * L * 0.22, kn[1] - Math.cos(ka) * L * 0.22];
      J.wr = wr; J.sh = sh; J.hip = hip; J.kn = kn; J.an = an; J.head = [sh[0] + 30, sh[1] + 50]; J.fx = 1;
      J.split = this.split * L * 0.3;
    }
    const sp = J.split || 0;
    const p = new Array(33).fill(null).map(() => pt(0, 0, 0.1));
    p[0] = pt(J.head[0] + 18 * J.fx, J.head[1]); p[7] = pt(J.head[0] - 4, J.head[1]); p[8] = pt(J.head[0] - 4, J.head[1], 0.5);
    p[11] = pt(...J.sh); p[12] = pt(J.sh[0] + 4, J.sh[1], 0.7);
    p[13] = pt((J.sh[0] + J.wr[0]) / 2, (J.sh[1] + J.wr[1]) / 2); p[14] = p[13];
    p[15] = pt(...J.wr); p[16] = pt(J.wr[0] + 6, J.wr[1], 0.7);
    p[23] = pt(...J.hip); p[24] = pt(J.hip[0] + 4, J.hip[1], 0.7);
    p[25] = pt(J.kn[0] - sp / 2, J.kn[1]); p[26] = pt(J.kn[0] + sp / 2, J.kn[1], 0.7);
    p[27] = pt(J.an[0] - sp, J.an[1]); p[28] = pt(J.an[0] + sp, J.an[1], 0.7);
    this.draw(p);
    return p;
  }
  draw(p) {
    const c = this.ctx, W = 1280, H = 720;
    c.fillStyle = '#2a2b31'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#34363e'; c.fillRect(0, 640, W, 80);
    c.strokeStyle = '#d9c7a8'; c.lineWidth = 26; c.lineCap = 'round';
    const L = (a, b) => { c.beginPath(); c.moveTo(p[a].x * W, p[a].y * H); c.lineTo(p[b].x * W, p[b].y * H); c.stroke(); };
    [[15, 11], [11, 23], [23, 25], [25, 27], [24, 26], [26, 28]].forEach(([a, b]) => L(a, b));
    c.fillStyle = '#d9c7a8'; c.beginPath(); c.arc(p[7].x * W, p[7].y * H, 34, 0, 7); c.fill();
    c.fillStyle = '#8a8c96'; c.font = '22px monospace'; c.fillText('DEMO · simulierte Kamera', 30, 50);
  }
}
