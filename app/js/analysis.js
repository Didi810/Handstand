// Wertet die erkannten Körperpunkte aus: erkennt Anfang/Ende eines Handstands,
// misst Körperlinie, Beine, Ruhe und Handschritte und merkt sich Fehler mit Zeitpunkt.
import { clamp, zeitScore, schritteScore } from './scoring.js';

// MediaPipe-Punktnummern
export const LM = { nose: 0, earL: 7, earR: 8, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24, knL: 25, knR: 26, anL: 27, anR: 28 };
// Diese Punkte werden fürs Strichmännchen im Video gespeichert
export const KEEP = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const VIS = 0.45;

const P = (lm, i, aspect) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 1 });
function mid(a, b) {
  const va = Math.max(a.v, 0.01), vb = Math.max(b.v, 0.01);
  return { x: (a.x * va + b.x * vb) / (va + vb), y: (a.y * va + b.y * vb) / (va + vb), v: Math.max(a.v, b.v) };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Winkel am Punkt b (180° = gerade)
function angle(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!d) return 180;
  return Math.acos(clamp((ux * vx + uy * vy) / d, -1, 1)) * 180 / Math.PI;
}
const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const std = arr => { if (arr.length < 2) return 0; const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length); };

// Messwerte für ein einzelnes Bild
export function frameMetrics(lm, aspect) {
  if (!lm) return { ok: false, body: false };
  const g = i => P(lm, i, aspect);
  const shL = g(LM.shL), shR = g(LM.shR), hipL = g(LM.hipL), hipR = g(LM.hipR);
  const anL = g(LM.anL), anR = g(LM.anR), knL = g(LM.knL), knR = g(LM.knR), wrL = g(LM.wrL), wrR = g(LM.wrR);
  const sh = mid(shL, shR), hip = mid(hipL, hipR), an = mid(anL, anR), wr = mid(wrL, wrR);
  const body = sh.v > VIS && hip.v > VIS && an.v > VIS && wr.v > 0.3;
  if (!body) return { ok: false, body: false };
  const torso = Math.max(dist(sh, hip), 0.02);
  // Kopfüber: Füße deutlich über den Schultern, Hüfte über den Schultern, Hände unter den Schultern
  const inverted = an.y < sh.y - 0.6 * torso && hip.y < sh.y - 0.3 * torso && wr.y > sh.y - 0.1 * torso;

  const hipAngle = angle(sh, hip, an);
  const shAngle = angle(wr, sh, hip);
  // Knie: beide Seiten, falls gut sichtbar – sonst die besser sichtbare
  const kA = angle(hipL, knL, anL), kB = angle(hipR, knR, anR);
  const vA = Math.min(hipL.v, knL.v, anL.v), vB = Math.min(hipR.v, knR.v, anR.v);
  const knee = vA > 0.6 && vB > 0.6 ? Math.min(kA, kB) : (vA >= vB ? kA : kB);
  const sep = dist(anL, anR) / torso;

  // Richtung des Knicks: Beine nach vorne (Bauchseite) = Hüfte knickt ab, nach hinten = Hohlkreuz.
  // Vorne erkennen wir an der Nase gegenüber den Ohren.
  const ux = (hip.x - sh.x) / torso, uy = (hip.y - sh.y) / torso; // Rumpf-Richtung
  const lx = an.x - hip.x, ly = an.y - hip.y;
  const perpLeg = lx * -uy + ly * ux; // seitliche Abweichung der Beine
  const ear = mid(g(LM.earL), g(LM.earR)), nose = g(LM.nose);
  const fx = nose.x - ear.x, fy = nose.y - ear.y;
  const perpFace = fx * -uy + fy * ux;
  const bendFront = Math.abs(perpFace) > 0.004 ? Math.sign(perpLeg) === Math.sign(perpFace) : null;

  // Körperachse (Hände → Füße) gegen die Senkrechte, in Grad
  const axis = Math.atan2(an.x - wr.x, wr.y - an.y) * 180 / Math.PI;

  return {
    ok: true, body: true, inverted, torso,
    hipDev: Math.max(0, 180 - hipAngle), shDev: Math.max(0, 172 - shAngle),
    kneeDev: Math.max(0, 180 - knee), sep, bendFront, axis,
    wrL: wrL.v > 0.5 ? wrL.x : null, wrR: wrR.v > 0.5 ? wrR.x : null,
  };
}

// Fehler-Schwellen; Strenge 1/2/3 macht sie lockerer/strenger
const ERR = { hip: 18, knee: 22, sep: 0.32, wobble: 9 };

// Begleitet einen Versuch von „in Position“ bis „gewertet“
export class AttemptTracker {
  constructor(set) { this.set = set; this.reset(); }
  reset() {
    this.state = 'idle'; // idle → active → done
    this.invSince = null; this.lastInv = null; this.start = null;
    this.frames = []; this.errors = []; this.lastErr = {}; this.flag = {};
    this.steps = 0; this.anchor = {}; this.ema = {}; this.stepCool = 0; this.torsos = [];
    this.endReason = null;
  }
  get holdTime() {
    if (this.state === 'idle') return 0;
    return Math.max(0, (this.state === 'done' ? this.endT : this.lastInv) - this.start);
  }
  // t in Sekunden. Gibt 'start', 'end' oder null zurück.
  update(t, m) {
    const inv = !!(m && m.ok && m.inverted);
    if (this.state === 'idle') {
      if (inv) {
        if (this.invSince == null) this.invSince = t;
        if (t - this.invSince >= 0.25) { this.state = 'active'; this.start = this.invSince; this.lastInv = t; this.addFrame(t, m); return 'start'; }
      } else this.invSince = null;
      return null;
    }
    if (this.state !== 'active') return null;
    if (inv) { this.lastInv = t; this.addFrame(t, m); }
    if (this.endReason === 'step') { this.finish(this.stepT); return 'end'; }
    if (t - this.lastInv > 0.5) { this.finish(this.lastInv); return 'end'; }
    return null;
  }
  finish(endT) { this.state = 'done'; this.endT = Math.max(this.start, endT); }

  addFrame(t, m) {
    const rel = t - this.start;
    this.frames.push({ t: rel, ...m });
    this.torsos.push(m.torso);
    const k = [1.25, 1, 0.8][this.set.strict - 1];
    // Fehler, die mindestens 0,3 s anhalten
    let lineErr = null;
    if (m.hipDev > ERR.hip * k) lineErr = m.bendFront === false ? 'Hohlkreuz' : 'Hüfte knickt ab';
    this.sustain(rel, 'line', lineErr);
    this.sustain(rel, 'knee', m.kneeDev > ERR.knee * k ? 'Knie gebeugt' : null);
    this.sustain(rel, 'sep', m.sep > ERR.sep * k ? 'Beine auseinander' : null);
    // Wackeln: Abweichung der Körperachse vom Mittel der letzten Sekunde
    const recent = this.frames.filter(f => f.t > rel - 1).map(f => f.axis);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    this.sustain(rel, 'wob', recent.length > 5 && Math.abs(m.axis - mean) > ERR.wobble * k ? 'Starkes Wackeln' : null, 0.15);
    // Handschritte: eine Hand bewegt sich deutlich und bleibt an neuer Stelle
    const torso = median(this.torsos.slice(-30));
    for (const side of ['wrL', 'wrR']) {
      const x = m[side];
      if (x == null) continue;
      this.ema[side] = this.ema[side] == null ? x : this.ema[side] * 0.5 + x * 0.5;
      if (this.anchor[side] == null) { this.anchor[side] = this.ema[side]; continue; }
      if (rel > this.stepCool && Math.abs(this.ema[side] - this.anchor[side]) > 0.4 * torso) {
        this.anchor[side] = this.ema[side];
        this.stepCool = rel + 0.4;
        this.steps++;
        this.addErr(rel, 'Handschritt', true);
        if (this.set.stepRule === 'ende' && this.endReason == null) { this.endReason = 'step'; this.stepT = this.start + rel; }
      }
    }
  }
  sustain(rel, key, label, need = 0.3) {
    if (!label) { this.flag[key] = null; return; }
    const f = this.flag[key];
    if (!f || f.label !== label) { this.flag[key] = { label, since: rel, done: false }; return; }
    if (!f.done && rel - f.since >= need) { f.done = true; this.addErr(f.since, label); }
  }
  addErr(t, label, always) {
    if (!always && this.lastErr[label] != null && t - this.lastErr[label] < 1.5) return;
    this.lastErr[label] = t;
    this.errors.push({ t: Math.round(t * 10) / 10, label });
  }

  // Ergebnis: Haltezeit, Handschritte, Teilwertungen, Fehler
  result() {
    const time = Math.round(this.holdTime * 10) / 10;
    const fr = this.frames.filter(f => f.t <= time + 0.05);
    const use = fr.length ? fr : this.frames;
    const hipDev = median(use.map(f => f.hipDev)), shDev = median(use.map(f => f.shDev));
    const kneeDev = median(use.map(f => f.kneeDev)), sep = median(use.map(f => f.sep));
    const axes = use.map(f => f.axis);
    let vel = 0;
    for (let i = 1; i < use.length; i++) { const dt = use[i].t - use[i - 1].t; if (dt > 0) vel += Math.abs(use[i].axis - use[i - 1].axis) / dt; }
    vel = use.length > 1 ? vel / (use.length - 1) : 0;
    const sub = {
      zeit: zeitScore(time),
      // ein paar Grad Messungenauigkeit werden nicht bestraft
      linie: Math.round(clamp(100 - 2 * Math.max(0, hipDev - 4) - 0.8 * shDev)),
      beine: Math.round(clamp(100 - 1.6 * Math.max(0, kneeDev - 4) - 150 * Math.max(0, sep - 0.08))),
      ruhe: Math.round(clamp(100 - 4.5 * std(axes) - 0.4 * vel)),
      schritte: schritteScore(this.steps, this.set),
    };
    const errors = this.errors.filter(e => e.t <= time + 0.05).sort((a, b) => a.t - b.t);
    return {
      time, steps: this.steps, sub, errors,
      raw: { hipDev: +hipDev.toFixed(1), shDev: +shDev.toFixed(1), kneeDev: +kneeDev.toFixed(1), sep: +sep.toFixed(2), axisStd: +std(axes).toFixed(1), vel: +vel.toFixed(1) },
    };
  }
}
