// Bewertungsregeln – überall gleich, damit jeder Handstand fair verglichen wird.

export const SUBS = [['zeit', 'Haltezeit'], ['linie', 'Körperlinie'], ['beine', 'Beine'], ['ruhe', 'Ruhe'], ['schritte', 'Handschritte']];

// Gewichtung je Modus (Profi: eigene Gewichtung aus den Einstellungen)
export const W = {
  // Battle: erst mal zählt nur, wie lange man hält. Die Form wird trotzdem gemessen und angezeigt.
  battle: { zeit: 100, linie: 0, beine: 0, ruhe: 0, schritte: 0 },
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

// Zählt diese Teilwertung im Modus mit?
export const counts = (k, mode, set) => weightsFor(mode, set)[k] > 0;

// Teilwertungen (0–100) → Gesamtpunkte (0–100). Strenge und Profi machen die Kurve steiler.
// Im Battle zählt nur die Zeit, da ändert die Strenge nichts.
export function scoreOf(sub, mode, set) {
  const w = weightsFor(mode, set);
  let s = 0, ws = 0;
  for (const [k] of SUBS) { s += w[k] * sub[k]; ws += w[k]; }
  const r = ws ? s / ws : 0;
  const ex = mode === 'battle' ? 1 : [0.8, 1, 1.3][set.strict - 1] * (mode === 'profi' ? 1.25 : 1);
  return Math.round(100 * Math.pow(r / 100, ex));
}

// Haltezeit: steigt am Anfang schnell, später langsamer – längeres Halten bringt aber immer mehr.
// 3 s ≈ 39 · 5 s ≈ 57 · 10 s ≈ 81 · 15 s ≈ 92 · 20 s ≈ 96 · 30 s ≈ 99
export const zeitScore = t => Math.round(clamp(100 * (1 - Math.exp(-t / 6))));
export const schritteScore = (steps, set) => set.stepRule === 'abzug' ? clamp(100 - steps * set.penalty) : 100;
