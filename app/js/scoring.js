// Bewertungsregeln – überall gleich, damit jeder Handstand fair verglichen wird.

export const SUBS = [['zeit', 'Haltezeit'], ['linie', 'Körperlinie'], ['beine', 'Beine'], ['ruhe', 'Ruhe'], ['schritte', 'Handschritte']];

// Gewichtung je Modus (Profi: eigene Gewichtung aus den Einstellungen)
export const W = {
  battle: { zeit: 30, linie: 20, beine: 20, ruhe: 15, schritte: 15 },
  training: { zeit: 0, linie: 35, beine: 30, ruhe: 20, schritte: 15 },
};

export const TIPS = {
  'Hüfte knickt ab': 'Po und Bauch fest anspannen, Hüfte genau über die Schultern.',
  'Hohlkreuz': 'Rippen einziehen, Becken leicht einrollen.',
  'Beine auseinander': 'Beine fest zusammendrücken – wie ein Blatt Papier dazwischen.',
  'Knie gebeugt': 'Knie durchdrücken, Zehen aktiv zur Decke strecken.',
  'Starkes Wackeln': 'Finger in den Boden krallen, um das Gleichgewicht abzufangen.',
  'Handschritt': 'Schultern ganz nach oben schieben, Blick zwischen die Hände.',
};

export const DEF_SET = {
  stepRule: 'abzug', penalty: 10, strict: 2,
  weights: { zeit: 25, linie: 25, beine: 20, ruhe: 20, schritte: 10 },
  camera: 'user', debug: false,
};

// Ab wie vielen Sekunden ein Handstand als Versuch zählt (kürzer = Fehlstart, nochmal)
export const MIN_HOLD = 1.0;

export const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

export function weightsFor(mode, set) {
  return mode === 'profi' ? set.weights : (W[mode] || W.battle);
}

// Teilwertungen (0–100) → Gesamtpunkte (0–100). Strenge und Profi machen die Kurve steiler.
export function scoreOf(sub, mode, set) {
  const w = weightsFor(mode, set);
  let s = 0, ws = 0;
  for (const [k] of SUBS) { s += w[k] * sub[k]; ws += w[k]; }
  const r = ws ? s / ws : 0;
  const ex = [0.8, 1, 1.3][set.strict - 1] * (mode === 'profi' ? 1.25 : 1);
  return Math.round(100 * Math.pow(r / 100, ex));
}

// Haltezeit: 10 Sekunden = 100 Punkte
export const zeitScore = t => Math.round(clamp(t * 10));
export const schritteScore = (steps, set) => set.stepRule === 'abzug' ? clamp(100 - steps * set.penalty) : 100;
