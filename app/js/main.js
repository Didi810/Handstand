// Handstand Battle – App-Logik und alle Bildschirme
import { SUBS, TIPS, DEF_SET, MIN_HOLD, clamp, scoreOf, counts } from './scoring.js?v=8';
import { frameMetrics, AttemptTracker, KEEP } from './analysis.js?v=8';
import { loadPose, preferCpu, PoseRunner, DemoSource } from './pose.js?v=8';
import { ClipRecorder, fixDuration } from './recorder.js?v=8';
import { loadData, saveData, favAll, favPut, favDel, favClear } from './store.js?v=8';

const VERSION = 8; // bei jeder Änderung hochzählen, auch die ?v= in index.html und den imports
const DEMO = new URLSearchParams(location.search).has('demo');
// Eingebaute Browser von WhatsApp, Instagram & Co. dürfen oft nicht auf die Kamera zugreifen
const UA = navigator.userAgent || '';
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|Snapchat|Line\/|musical_ly|BytedanceWebview|TikTok|WhatsApp|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(UA);
const CAM_OK = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const IS_IOS = /iPhone|iPad|iPod/i.test(UA);
const APP_URL = location.origin + location.pathname;
function browserHint() {
  return IS_IOS ? 'Öffne den Link in Safari: oben oder unten auf ⋯ bzw. das Teilen-Symbol tippen → „In Safari öffnen“.'
    : 'Öffne den Link in Chrome: oben rechts auf ⋮ tippen → „Im Browser öffnen“ bzw. „In Chrome öffnen“.';
}

const PAL = {
  rot: { c: 'oklch(0.6 0.16 30)', fg: '#fff', l: 'Rot' }, blau: { c: 'oklch(0.56 0.14 258)', fg: '#fff', l: 'Blau' },
  gelb: { c: 'oklch(0.82 0.14 88)', fg: '#1a1a1a', l: 'Gelb' }, lila: { c: 'oklch(0.53 0.14 318)', fg: '#fff', l: 'Lila' },
  rosa: { c: 'oklch(0.76 0.11 355)', fg: '#1a1a1a', l: 'Rosa' }, braun: { c: 'oklch(0.5 0.07 55)', fg: '#fff', l: 'Braun' },
};
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const D = d => (d instanceof Date ? d : new Date(d));
const dShort = d => `${D(d).getDate()}.${D(d).getMonth() + 1}.`;
const dLong = d => `${WD[D(d).getDay()]}, ${D(d).getDate()}. ${MON[D(d).getMonth()]}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const $ = s => document.querySelector(s);
const plural = (n, one, many) => n === 1 ? `1 ${one}` : `${n} ${many}`;

// ---------- Zustand ----------
const saved = loadData() || {};
const S = {
  screen: 'home',
  theme: saved.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  roster: saved.roster || [{ id: 'p1', name: 'Ich', color: 'rot' }, { id: 'p2', name: 'Schwester', color: 'blau' }],
  history: saved.history || [],
  set: { ...DEF_SET, ...(saved.set || {}), weights: { ...DEF_SET.weights, ...((saved.set || {}).weights || {}) } },
  setup: saved.setup || { sel: ['p1', 'p2'], starter: 'p1', mode: 'battle' },
  editing: null, adding: false, newName: '', newColor: 'gelb',
  battle: null, prevBattle: null, cam: null, video: null,
  histTab: 'tage', showWarm: false, swapOpen: null, settingsBack: 'home', diag: null,
  favorites: [],
};
S.setup.sel = S.setup.sel.filter(id => S.roster.some(p => p.id === id));
if (!S.setup.sel.includes(S.setup.starter)) S.setup.starter = S.setup.sel[0] || null;

function persist() {
  saveData({ theme: S.theme, roster: S.roster, history: S.history, set: S.set, setup: S.setup });
}

favAll().then(list => {
  S.favorites = list.map(f => ({ ...f, video: f.video ? { ...f.video, url: URL.createObjectURL(f.video.blob) } : null }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  if (S.screen === 'history' || S.screen === 'end') render();
});

// ---------- Personen ----------
function person(id) {
  const p = S.roster.find(q => q.id === id);
  if (p) return p;
  for (let i = S.history.length - 1; i >= 0; i--) { const h = S.history[i]; if (h.names && h.names[id]) return { id, name: h.names[id], color: (h.colors || {})[id] || 'braun' }; }
  return { id, name: '?', color: 'braun' };
}
const nm = id => person(id).name;
const col = id => (PAL[person(id).color] || PAL.braun).c;
const fgc = id => (PAL[person(id).color] || PAL.braun).fg;
const ini = id => (nm(id)[0] || '?').toUpperCase();
function winsMap() { const w = {}; S.history.forEach(h => { if (h.winner) w[h.winner] = (w[h.winner] || 0) + 1; }); return w; }
const isFav = id => S.favorites.some(f => f.id === id);
const avatar = (id, size, fs) => `<span class="avatar" style="width:${size}px;height:${size}px;background:${col(id)};color:${fgc(id)};font-size:${fs}px">${esc(ini(id))}</span>`;
const dot = (c, s) => `<span class="dot" style="width:${s}px;height:${s}px;background:${c}"></span>`;

function stats(b) {
  const counted = b.attempts.filter(a => !a.warm);
  const per = {}, avg = {}, tot = {};
  b.players.forEach(id => {
    per[id] = counted.filter(a => a.player === id);
    tot[id] = per[id].reduce((x, a) => x + a.score, 0);
    avg[id] = per[id].length ? Math.round(tot[id] / per[id].length) : 0;
  });
  const isTr = b.mode === 'training';
  const scored = b.players.filter(id => per[id].length);
  let winner = null, tie = false;
  if (!isTr && scored.length) {
    const best = Math.max(...scored.map(id => avg[id])), top = scored.filter(id => avg[id] === best);
    if (top.length > 1) tie = true; else winner = top[0];
  }
  return { counted, per, avg, tot, scored, winner, tie, isTr };
}

// ---------- Rendern ----------
const app = $('#app');
function render() {
  persist();
  document.documentElement.dataset.theme = S.theme;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = S.screen === 'camera' ? '#111111' : (S.theme === 'dark' ? '#1d1e22' : '#f7f7f5');
  if (S.screen === 'camera') { renderCamera(); return; }
  if (S.screen === 'video') { renderVideo(); return; }
  const fn = { home: homeHtml, setup: setupHtml, end: endHtml, history: historyHtml, settings: settingsHtml }[S.screen] || homeHtml;
  app.innerHTML = `<div class="page">${fn()}</div>`;
}
function go(screen, extra) {
  Object.assign(S, extra || {}, { screen });
  render();
  window.scrollTo(0, 0);
}
let toastT;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = 'block';
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.display = 'none'; }, Math.min(9000, 2500 + msg.length * 45));
}

// ---------- 01 Start ----------
function homeHtml() {
  const W = winsMap(), R = S.roster;
  const maxW = Math.max(1, ...R.map(p => W[p.id] || 0));
  const ranking = [...R].sort((a, c) => (W[c.id] || 0) - (W[a.id] || 0));
  const lead = ranking.length > 1 ? (W[ranking[0].id] || 0) - (W[ranking[1].id] || 0) : 0;
  const leaderText = !S.history.length ? 'Noch keine Battles' : lead === 0 ? 'Gleichstand an der Spitze' : `${esc(ranking[0].name)} führt mit ${lead}`;
  const b = S.battle;
  let lastHtml;
  const st = b ? stats(b) : null;
  const lh = S.history[S.history.length - 1];
  let src = null;
  if (b && !b.saved && b.mode !== 'training' && st.counted.length) src = { label: 'Heute', unsaved: true, players: st.scored, avg: st.avg, count: st.counted.length, w: st.winner };
  else if (lh) src = { label: dLong(lh.date), unsaved: false, players: lh.players, avg: lh.avg, count: lh.count, w: lh.winner };
  if (src) {
    const w = src.w;
    lastHtml = `<button class="lastcard" data-a="openLast">
      <div class="row" style="justify-content:space-between;width:100%"><span class="label">Letztes Battle · ${esc(src.label)}</span>${src.unsaved ? '<span class="pill">nicht gespeichert</span>' : ''}</div>
      <div class="row" style="justify-content:space-between;width:100%">
        <div class="row gap10">${w ? avatar(w, 32, 15) : '<span class="avatar" style="width:32px;height:32px;background:var(--soft);color:var(--ink);font-size:15px">=</span>'}
        <span style="font-weight:700;font-size:20px">${w ? esc(nm(w)) + ' gewinnt' : 'Unentschieden'}</span></div>
        <span style="font-size:20px;color:var(--muted)">›</span></div>
      <div class="chips">${src.players.map(id => `<span class="chip">${dot(col(id), 8)}${esc(nm(id))} <b>Ø ${src.avg[id]}</b></span>`).join('')}<span>${src.count} Handstände</span></div>
    </button>`;
  } else {
    lastHtml = `<div class="lastcard"><span class="label">Letztes Battle</span><span style="font-weight:700;font-size:18px">Noch kein Battle gespeichert</span><span class="small">Tippe auf „Neues Battle“, stellt das Handy auf und los geht's.</span></div>`;
  }
  return `<div class="pad">
    <div class="row" style="justify-content:space-between">
      <span class="brand">Handstand Battle</span>
      <div class="row gap8"><button class="iconbtn" data-a="toggleTheme" title="Hell / Dunkel">◐</button><button class="iconbtn" data-a="goSettings" title="Einstellungen" style="font-size:20px">⚙︎</button></div>
    </div>
    ${DEMO ? '<div class="pill" style="align-self:flex-start">Demo-Modus · simulierte Kamera</div>' : ''}
    ${!DEMO && (IN_APP || !CAM_OK) ? `<div class="card col gap8" style="border-color:var(--err)">
      <span style="font-weight:700;font-size:16px">⚠ Bitte im richtigen Browser öffnen</span>
      <span style="font-size:14px;line-height:1.45">${IN_APP ? 'Du hast den Link wohl direkt in einer App wie WhatsApp oder Instagram geöffnet. Deren eingebauter Browser darf die Kamera meist nicht benutzen.' : 'Dieser Browser kann die Kamera nicht benutzen.'} ${browserHint()}</span>
      <div class="row gap8" style="flex-wrap:wrap"><button class="btn-small" data-a="copyLink">Link kopieren</button><span class="mono small" style="word-break:break-all">${esc(APP_URL)}</span></div>
    </div>` : ''}
    <div class="card col gap14">
      <div class="between"><span class="label">Siege gesamt</span><span style="font-size:13px;font-weight:600;color:var(--muted)">${leaderText}</span></div>
      ${ranking.map((p, i) => `<div class="rank">
        <span style="font-size:13px;font-weight:600;color:var(--muted)">${i + 1}</span>${avatar(p.id, 36, 16)}
        <div class="col" style="gap:5px;min-width:0"><span style="font-weight:600;font-size:16px">${esc(p.name)}</span><div class="bar"><div style="background:${col(p.id)};width:${(W[p.id] || 0) / maxW * 100}%"></div></div></div>
        <span class="rank-wins" style="font-size:${i === 0 ? 40 : 28}px">${W[p.id] || 0}</span></div>`).join('')}
    </div>
    ${lastHtml}
    <button class="btn-main" data-a="goSetup">Neues Battle</button>
    <div class="grid2"><button class="btn-sec" data-a="goTraining">Training</button><button class="btn-sec" data-a="goHistory">Verlauf</button></div>
  </div>`;
}

// ---------- 02 Vorbereiten ----------
function swatches(cur, taken, action, extra = '') {
  return `<div class="swatches">${Object.keys(PAL).map(k => {
    const dis = taken.includes(k) && taken.length < 6;
    return `<button class="swatch${cur === k ? ' on' : ''}" style="background:${PAL[k].c}" title="${PAL[k].l}" data-a="${action}" data-c="${k}" ${extra} ${dis ? 'disabled' : ''}></button>`;
  }).join('')}</div>`;
}
function order() {
  const sel = S.setup.sel, i = sel.indexOf(S.setup.starter);
  return i < 0 ? sel : [...sel.slice(i), ...sel.slice(0, i)];
}
function minPlayers() { return S.setup.mode === 'training' ? 1 : 2; }
function setupHtml() {
  const R = S.roster, sel = S.setup.sel, W = winsMap();
  const rows = R.map(p => {
    const on = sel.includes(p.id), ed = S.editing === p.id;
    return `<div class="roster-row">
      <div class="roster-main">
        <button class="roster-toggle" data-a="rtoggle" data-id="${p.id}">
          <span class="check${on ? ' on' : ''}">${on ? '✓' : ''}</span>${avatar(p.id, 38, 17)}
          <span class="col" style="min-width:0"><span style="font-weight:600;font-size:17px">${esc(p.name)}</span><span style="font-size:12.5px;color:var(--muted)">${W[p.id] || 0} Siege</span></span>
        </button>
        <button class="editbtn" data-a="redit" data-id="${p.id}" title="Bearbeiten">✎</button>
      </div>
      ${ed ? `<div class="edit-area">
        <input class="field" value="${esc(p.name)}" data-in="rname" data-id="${p.id}" maxlength="12" autocomplete="off">
        ${swatches(p.color, R.filter(q => q.id !== p.id).map(q => q.color), 'rcolor', `data-id="${p.id}"`)}
        <div class="row" style="justify-content:space-between">
          <button class="link" style="color:var(--muted)" data-a="rremove" data-id="${p.id}" ${R.length <= 2 ? 'disabled' : ''}>Person entfernen</button>
          <button class="btn-small" data-a="redit" data-id="${p.id}">Fertig</button>
        </div></div>` : ''}
    </div>`;
  }).join('');
  const freeColor = Object.keys(PAL).find(k => !R.some(p => p.color === k)) || 'braun';
  const newColor = R.some(p => p.color === S.newColor) && R.length < 6 ? freeColor : S.newColor;
  S.newColor = newColor;
  const add = S.adding ? `<div class="add-area">
      <input class="field" id="newName" value="${esc(S.newName)}" data-in="newName" placeholder="Name" maxlength="12" autocomplete="off">
      ${swatches(newColor, R.map(p => p.color), 'newColor')}
      <div class="row gap8" style="justify-content:flex-end">
        <button class="btn-small ghost" style="height:38px" data-a="cancelAdd">Abbrechen</button>
        <button class="btn-small" style="height:38px" data-a="confirmAdd" id="addBtn" ${S.newName.trim() ? '' : 'disabled'}>Hinzufügen</button>
      </div></div>`
    : `<button class="addbtn" data-a="startAdd"><span class="addbox">+</span>Person hinzufügen</button>`;
  const ord = order();
  const modes = [['battle', 'Battle', 'Nur die Haltezeit zählt – wer im Schnitt länger hält, gewinnt den Tag.'], ['training', 'Training', 'Nur die Form zählt, dazu Verbesserungstipps.'], ['profi', 'Profi', 'Eigene Gewichtung, strengere Bewertung.']];
  const enough = sel.length >= minPlayers();
  return `<div class="col" style="min-height:100vh;min-height:100dvh">
    <div class="head"><button class="iconbtn" data-a="goHome">←</button><span class="head-title">${S.setup.mode === 'training' ? 'Training vorbereiten' : 'Battle vorbereiten'}</span></div>
    <div class="body">
      <div class="col gap8">
        <div class="between"><span class="label">Wer macht mit?</span><span style="font-size:13px;font-weight:600;color:var(--muted)">${sel.length} ausgewählt</span></div>
        <div class="card-tight">${rows}${add}</div>
      </div>
      <div class="col gap8">
        <span class="label">Wer fängt an?</span>
        <div class="row gap8" style="flex-wrap:wrap">${sel.map(id => `<button class="starter${S.setup.starter === id ? ' on' : ''}" data-a="starter" data-id="${id}">${avatar(id, 30, 13)}${esc(nm(id))}</button>`).join('')}</div>
        <span class="small">Reihenfolge: ${ord.length ? ord.map(id => esc(nm(id))).join(' → ') + ' → …' : '–'}</span>
      </div>
      <div class="col gap8">
        <span class="label">Modus</span>
        <div class="col gap8">${modes.map(([v, l, d]) => `<button class="radio-card${S.setup.mode === v ? ' on' : ''}" data-a="mode" data-v="${v}"><span class="radio"><span></span></span><span class="col" style="gap:1px"><span style="font-weight:700;font-size:16px">${l}</span><span style="font-size:13px;color:var(--muted)">${d}</span></span></button>`).join('')}</div>
        ${S.setup.mode === 'profi' ? '<button class="link" style="align-self:flex-start;padding:4px 0" data-a="goSettings">Gewichtung anpassen →</button>' : ''}
      </div>
      <div class="col gap8">
        <span class="label">Kamera aufstellen</span>
        <div class="card col gap12" style="padding:14px;border-radius:18px">
          <div class="guide-sketch">
            <div style="left:12px;right:12px;bottom:24px;height:2px;background:var(--muted)"></div>
            <div style="left:30px;bottom:26px;width:40px;height:44px;border:2px solid var(--muted);border-bottom:none;box-sizing:border-box"></div>
            <div style="left:34px;bottom:70px;width:32px;height:16px;border-radius:3px;background:var(--ink)"></div>
            <div style="left:70px;right:96px;bottom:77px;border-top:2px dashed var(--muted)"></div>
            <div class="mono" style="left:0;right:20px;bottom:84px;text-align:center;font-size:11px;color:var(--muted)">3–4 m · seitlich</div>
            <div class="mono" style="left:8px;bottom:36px;font-size:10px;color:var(--muted);writing-mode:vertical-rl;transform:rotate(180deg)">≈ 1 m</div>
            <div style="right:58px;bottom:44px;width:8px;height:80px;border-radius:4px;background:oklch(0.72 0.15 150)"></div>
            <div style="right:53px;bottom:26px;width:18px;height:18px;border-radius:50%;border:3px solid oklch(0.72 0.15 150);box-sizing:border-box"></div>
          </div>
          ${['Handy quer auf einen Stuhl stellen – etwa 1 m hoch. Bildschirm zeigt zu euch.', '3–4 m Abstand, Kamera filmt von der Seite.', 'Ganzer Körper im Bild: Hände bis Füße. Danach nicht mehr anfassen.']
      .map((t, i) => `<div class="row gap10" style="align-items:flex-start;font-size:14.5px;line-height:1.4"><span class="step-n">${i + 1}</span><span>${t}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="sticky-foot"><button class="btn-main" style="height:58px;font-size:17px" data-a="startCamera" ${enough ? '' : 'disabled'}>${enough ? 'Kamera starten' : `Mindestens ${minPlayers()} Personen auswählen`}</button></div>
  </div>`;
}

// ---------- 03 Kamera ----------
const CAM = { session: 0 };
const BONES = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

function renderCamera() {
  if (!$('#cam')) {
    app.innerHTML = `<div class="cam" id="cam">
      <video id="camv" playsinline muted autoplay ${S.set.camera === 'user' && !DEMO ? 'class="mirror"' : ''}></video>
      <canvas class="sk${S.set.camera === 'user' && !DEMO ? ' mirror' : ''}" id="camsk"></canvas>
      <div class="shade-l"></div><div class="shade-r"></div>
      <div id="camui"></div>
      <div id="camfx"></div>
      <div class="rotate"><div class="ico">⟳</div><b style="font-size:22px">Handy quer drehen</b><span style="color:#a9abb5">Die Kamera-Ansicht funktioniert im Querformat am besten.</span><button class="cam-end" style="position:static;transform:none" data-a="exitCamera">Abbrechen</button></div>
    </div>`;
  }
  renderCamUI(true);
}

// Strichmännchen zeichnen. fit: 'cover' (Livebild) oder 'contain' (Video)
function drawSkeleton(canvas, pts, vw, vh, fit) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cw, ch);
  if (!pts || !vw || !vh) return;
  const sc = fit === 'cover' ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
  const dx = (cw - vw * sc) / 2, dy = (ch - vh * sc) / 2;
  const X = p => p.x * vw * sc + dx, Y = p => p.y * vh * sc + dy;
  const lw = Math.max(3, Math.min(cw, ch) / 70);
  c.lineCap = 'round'; c.strokeStyle = 'oklch(0.8 0.17 150)'; c.lineWidth = lw;
  for (const [a, b] of BONES) {
    const p = pts[a], q = pts[b];
    if (!p || !q || (p.visibility ?? 1) < 0.3 || (q.visibility ?? 1) < 0.3) continue;
    c.beginPath(); c.moveTo(X(p), Y(p)); c.lineTo(X(q), Y(q)); c.stroke();
  }
  const n = pts[0], s1 = pts[11], s2 = pts[12];
  if (n && s1 && (n.visibility ?? 1) > 0.3) {
    const r = Math.hypot((n.x - (s1.x + s2.x) / 2) * vw * sc, (n.y - (s1.y + s2.y) / 2) * vh * sc) * 0.45;
    c.lineWidth = lw * 0.8; c.beginPath(); c.arc(X(n), Y(n), Math.max(6, r), 0, Math.PI * 2); c.stroke();
  }
  c.fillStyle = '#fff'; c.strokeStyle = 'oklch(0.62 0.17 150)'; c.lineWidth = lw * 0.5;
  for (const i of [15, 16, 11, 12, 23, 24, 25, 26, 27, 28]) {
    const p = pts[i]; if (!p || (p.visibility ?? 1) < 0.3) continue;
    c.beginPath(); c.arc(X(p), Y(p), lw * 1.1, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}

function grabThumb(video, mirror) {
  try {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = Math.round(320 * vh / vw);
    const c = cv.getContext('2d');
    if (mirror) { c.translate(cv.width, 0); c.scale(-1, 1); }
    c.drawImage(video, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

async function startCamera() {
  const sel = S.setup.sel;
  if (sel.length < minPlayers()) return;
  if (S.battle && !S.battle.saved && S.battle.attempts.some(a => !a.warm)) {
    if (!confirm('Das letzte Battle ist noch nicht gespeichert. Trotzdem ein neues starten?')) return;
  }
  if (S.battle && !S.battle.saved) dropVideos(S.battle);
  const session = ++CAM.session;
  S.prevBattle = S.battle;
  S.battle = { mode: S.setup.mode, players: [...sel], order: order(), attempts: [], saved: false, videosDeleted: false, date: new Date().toISOString() };
  S.cam = { phase: 'loading', warm: true, turn: 0, last: null, flash: 0, msg: null, body: false, loadingText: 'Kamera wird gestartet …' };
  S.showWarm = false; S.swapOpen = null;
  go('camera');
  if (!DEMO && matchMedia('(pointer:coarse)').matches) {
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { }
    try { await screen.orientation?.lock?.('landscape'); } catch { }
  }
  const video = $('#camv');
  try {
    let stream;
    if (DEMO) { CAM.demo = new DemoSource(); stream = CAM.demo.stream(); }
    else stream = await getStream();
    if (session !== CAM.session) { stream.getTracks().forEach(t => t.stop()); return; }
    CAM.stream = stream;
    await attachStream(video, stream);
    if (!DEMO) {
      S.cam.loadingText = 'KI wird geladen … beim ersten Mal kann das etwas dauern.'; renderCamUI(true);
      const lm = await loadPose();
      if (session !== CAM.session) { try { lm.close(); } catch { } return; }
      CAM.runner = new PoseRunner(lm);
    }
    CAM.rec = new ClipRecorder(stream); CAM.rec.start();
    CAM.tracker = new AttemptTracker(S.set); CAM.frames = []; CAM.pending = null; CAM.lastDet = 0; CAM.lastUi = 0; CAM.fps = 0;
    requestWake();
    S.cam.phase = 'ready';
    renderCamUI(true);
    CAM.raf = requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    if (session !== CAM.session) return;
    await stopCamera();
    S.battle = S.prevBattle; S.cam = null;
    go('setup');
    toast(e.message === 'nocam'
      ? (!window.isSecureContext ? 'Kamera nicht verfügbar: Die App muss über https:// geöffnet werden.'
        : 'Dieser Browser darf die Kamera nicht benutzen. ' + (IN_APP ? browserHint() : 'Woran es liegt, zeigt ⚙︎ Einstellungen → „Kamera-Check starten“.'))
      : e.name === 'NotAllowedError' ? (IN_APP ? 'Kein Zugriff auf die Kamera. ' + browserHint()
        : 'Kein Zugriff auf die Kamera. Bitte die Kamera für diese Seite erlauben – Hilfe unter ⚙︎ Einstellungen → „Kamera-Check starten“.')
        : 'Die Kamera oder KI konnte nicht gestartet werden. Internetverbindung prüfen und nochmal versuchen.');
  }
}

async function getStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: S.set.camera, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
}
async function attachStream(video, stream) {
  const mirror = S.set.camera === 'user' && !DEMO;
  video.classList.toggle('mirror', mirror);
  $('#camsk')?.classList.toggle('mirror', mirror);
  video.srcObject = stream;
  await Promise.race([video.play().catch(() => { }), new Promise(r => setTimeout(r, 1500))]);
}

// KI neu starten (z. B. wenn sie nach dem Zurückkehren in die App nichts mehr erkennt)
async function restartPose(reason) {
  if (DEMO || CAM.restarting || !CAM.tracker) return;
  CAM.restarting = true;
  const session = CAM.session;
  if (reason === 'error') preferCpu();
  const old = CAM.runner; CAM.runner = null;
  if (old) old.close();
  try {
    const lm = await loadPose();
    if (session !== CAM.session) { try { lm.close(); } catch { } return; }
    CAM.runner = new PoseRunner(lm);
  } catch (e) { console.error(e); toast('Die KI konnte nicht neu gestartet werden. Bitte Kamera schließen und neu öffnen.'); }
  finally { CAM.restarting = false; }
}

// Kamera wechseln (vorne ↔ hinten) oder nach dem Hintergrund neu verbinden – das Battle läuft weiter
async function restartStream() {
  if (DEMO || !CAM.tracker || CAM.switching) return;
  CAM.switching = true;
  const session = CAM.session, video = $('#camv');
  try {
    if (CAM.pending) await closeClip(false);
    if (CAM.rec) CAM.rec.dispose();
    if (CAM.stream) CAM.stream.getTracks().forEach(t => t.stop());
    const stream = await getStream();
    if (session !== CAM.session) { stream.getTracks().forEach(t => t.stop()); return; }
    CAM.stream = stream;
    await attachStream(video, stream);
    CAM.rec = new ClipRecorder(stream); CAM.rec.start(); CAM.frames = [];
    CAM.tracker.reset();
    if (S.cam.phase === 'active') S.cam.phase = 'ready';
  } catch (e) { console.error(e); toast('Die Kamera konnte nicht gewechselt werden.'); }
  finally { CAM.switching = false; }
}

async function requestWake() {
  try { CAM.wake = await navigator.wakeLock?.request('screen'); } catch { }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || S.screen !== 'camera' || !CAM.tracker) return;
  requestWake();
  // Nach dem Hintergrund: Kamera und KI frisch verbinden
  const ended = !CAM.stream || CAM.stream.getVideoTracks().some(t => t.readyState === 'ended');
  if (ended) restartStream(); else $('#camv')?.play().catch(() => { });
  restartPose();
});

function loop(now) {
  if (S.screen !== 'camera' || !S.cam || !CAM.tracker) return;
  CAM.raf = requestAnimationFrame(loop);
  if (now - CAM.lastDet < 30) return; // höchstens ~30 Bilder pro Sekunde auswerten
  if (CAM.lastDet) CAM.fps = CAM.fps * 0.9 + (1000 / (now - CAM.lastDet)) * 0.1;
  CAM.lastDet = now;
  const video = $('#camv');
  if (!video) return;
  let pts = null;
  if (DEMO) pts = CAM.demo.pose(now);
  else if (CAM.runner && video.readyState >= 2) {
    pts = CAM.runner.detect(video, now);
    if (CAM.runner.broken) restartPose('error');
  }
  // Sicherheitsnetz: 6 s lang gar kein Körper → KI frisch starten (höchstens alle 20 s)
  if (pts || !CAM.lastPose) CAM.lastPose = now;
  if (!DEMO && now - CAM.lastPose > 6000 && now - (CAM.lastRestart || 0) > 20000) { CAM.lastRestart = now; CAM.lastPose = now; restartPose(); }
  const vw = DEMO ? 1280 : video.videoWidth, vh = DEMO ? 720 : video.videoHeight;
  const m = frameMetrics(pts, vw / (vh || 1));
  CAM.lastM = m;
  const c = S.cam;
  c.body = m.body;
  if (CAM.rec && CAM.rec.rec) CAM.frames.push({ t: +((now - CAM.rec.t0) / 1000).toFixed(3), p: pts ? KEEP.map(i => [+pts[i].x.toFixed(4), +pts[i].y.toFixed(4), +(pts[i].visibility ?? 1).toFixed(2)]) : null });
  drawSkeleton($('#camsk'), pts, vw, vh, 'cover');

  const ev = CAM.tracker.update(now / 1000, m);
  if (ev === 'start') {
    if (c.phase === 'result') c.turn++;
    c.phase = 'active'; c.attWarm = c.warm; c.msg = null; CAM.thumb = null;
  }
  if (c.phase === 'active') {
    if (!CAM.thumb && CAM.tracker.holdTime > 1.2) CAM.thumb = grabThumb(video, video.classList.contains('mirror'));
    if (ev === 'end') finishAttempt(now, video);
  }
  if (c.phase === 'result' && now - c.resAt > 4500) { c.phase = 'ready'; c.turn++; }
  if (c.phase === 'ready' && !CAM.pending && CAM.rec && CAM.rec.rec && now - CAM.rec.t0 > 12000 && CAM.tracker.invSince == null) {
    CAM.rec.rotate(); CAM.frames = [];
  }
  if (c.flash && now > c.flash) c.flash = 0;
  if (c.msg && now > c.msgUntil) c.msg = null;
  if (now - CAM.lastUi > 100) { CAM.lastUi = now; renderCamUI(); }
}

function finishAttempt(now, video) {
  const tr = CAM.tracker, r = tr.result(), c = S.cam, b = S.battle;
  const hsStartMs = tr.start * 1000;
  tr.reset();
  if (r.time < MIN_HOLD) { c.phase = 'ready'; c.msg = 'Zu kurz – nochmal!'; c.msgUntil = now + 2500; return; }
  const player = b.order[c.turn % b.order.length];
  const a = {
    id: uid(), player, warm: c.attWarm, mode: b.mode, date: b.date, ...r,
    score: scoreOf(r.sub, b.mode, S.set), thumb: CAM.thumb || grabThumb(video, video.classList.contains('mirror')), video: null, frames: [],
    processing: !!(CAM.rec && CAM.rec.rec),
  };
  b.attempts.push(a);
  c.phase = 'result'; c.resAt = now; c.last = a.id;
  if (a.processing) {
    // noch 1 s weiter aufnehmen (Runterkommen), dann Video abschließen
    CAM.pending = { a, hsStartMs, timer: setTimeout(() => closeClip(true), 1000) };
  }
}

async function closeClip(restart) {
  const p = CAM.pending; if (!p) return;
  clearTimeout(p.timer); CAM.pending = null;
  const rec = CAM.rec, frames = CAM.frames;
  CAM.frames = [];
  const prom = rec.stop();
  if (restart) rec.start();
  const out = await prom;
  const a = p.a;
  a.processing = false;
  if (out && out.blob.size) {
    const hsOff = (p.hsStartMs - out.t0) / 1000;
    const clipStart = Math.max(0, hsOff - 1.5), clipEnd = (out.t1 - out.t0) / 1000;
    a.video = { url: URL.createObjectURL(out.blob), blob: out.blob, hsOff, clipStart, clipEnd, mirror: S.set.camera === 'user' && !DEMO };
    a.frames = frames.filter(f => f.t >= clipStart - 0.2);
  }
  if (S.screen === 'end') render();
}

async function stopCamera() {
  CAM.session++;
  cancelAnimationFrame(CAM.raf);
  if (CAM.pending) await closeClip(false);
  if (CAM.rec) CAM.rec.dispose();
  if (CAM.stream) CAM.stream.getTracks().forEach(t => t.stop());
  if (CAM.runner) CAM.runner.close();
  try { await CAM.wake?.release(); } catch { }
  try { screen.orientation?.unlock?.(); } catch { }
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { }
  Object.assign(CAM, { stream: null, rec: null, tracker: null, runner: null, demo: null, wake: null, frames: [], lastPose: 0, lastRestart: 0, restarting: false, switching: false });
}

function renderCamUI(force) {
  const ui = $('#camui'); if (!ui || !S.cam) return;
  const c = S.cam, b = S.battle, st = stats(b), isTr = st.isTr;
  let html, timerTxt = null;
  if (c.phase === 'loading') {
    html = `<div class="loading"><div class="spinner"></div><b style="font-size:20px">${esc(c.loadingText)}</b>
      <span style="color:#a9abb5;max-width:420px">Alles läuft auf diesem Handy – das Video wird nicht ins Internet hochgeladen.</span>
      <button class="cam-end" style="position:static;transform:none" data-a="exitCamera">Abbrechen</button></div>`;
  } else {
    const ord = b.order, n = ord.length;
    const cur = ord[c.turn % n], nx = ord[(c.turn + 1) % n];
    const lastA = c.last ? b.attempts.find(a => a.id === c.last) : null;
    const timer = c.phase === 'active' ? CAM.tracker.holdTime : c.phase === 'result' && lastA ? lastA.time : 0;
    const warmN = b.attempts.filter(a => a.warm).length + (c.phase === 'active' && c.attWarm ? 1 : 0);
    const liveN = st.counted.length + (c.phase === 'active' && !c.attWarm ? 1 : 0);
    const curWarm = c.phase === 'active' ? c.attWarm : c.warm;
    const np = b.players.length, avgSize = np <= 2 ? 52 : np === 3 ? 40 : 32, nameSize = np <= 2 ? 22 : 18;
    const phaseLabel = c.phase === 'active' ? 'hält' : c.phase === 'result' ? 'gewertet' : 'in Position';
    const u = v => `calc(${v} * var(--u))`;
    html = `
      <div class="cam-left">
        <div class="cam-banner${c.warm ? '' : ' live'}"><span class="d"></span>${c.warm ? 'Aufwärmen · zählt nicht' : (isTr ? 'Training läuft' : 'Battle läuft')}</div>
        <span class="cam-k" style="margin-top:${u(10)}">Dran</span>
        <div class="cam-name"><span class="stripe" style="background:${col(cur)}"></span><span style="font-size:${u(nm(cur).length <= 6 ? 68 : nm(cur).length <= 9 ? 50 : 40)}">${esc(nm(cur))}</span></div>
        <div class="cam-timer"><b id="camTimer"></b><span>s</span></div>
        <span class="cam-count">${curWarm ? `Probe ${Math.max(1, warmN)}` : `Handstand ${Math.max(1, liveN)}`} · ${phaseLabel}</span>
        <span class="cam-state">${dot(c.body ? 'oklch(0.75 0.17 150)' : 'oklch(0.7 0.17 60)', 10)}${c.body ? 'Körper erkannt' : 'Ganzer Körper nicht im Bild'}</span>
      </div>
      <div class="cam-right">
        <div class="row gap8"><span class="cam-rec mono"><span class="d"></span>REC</span>
          ${DEMO ? '' : `<button class="cam-pill" data-a="switchCam" title="Kamera wechseln">⇄ ${S.set.camera === 'user' ? 'Hauptkamera' : 'Selfie-Kamera'}</button>`}
          <button class="cam-x" data-a="exitCamera">✕</button></div>
        <span class="cam-k" style="margin-top:4px;font-size:${u(14)}">Ø aktuell</span>
        ${b.players.map(id => `<div class="cam-avg">${dot(col(id), 10)}<span class="n" style="font-size:${u(nameSize)}">${esc(nm(id))}</span><b style="font-size:${u(avgSize)}">${st.per[id].length ? st.avg[id] : '–'}</b></div>`).join('')}
        <div class="cam-next">
          ${n > 1 && c.phase !== 'active' ? `<button class="cam-pill" style="margin-bottom:${u(10)}" data-a="skipTurn">⏭ ${esc(nm(cur))} überspringen</button>` : ''}
          <span class="cam-k" style="font-size:${u(14)}">Als Nächstes</span><b><i style="background:${col(nx)}"></i>${esc(nm(nx))}</b></div>
      </div>
      ${c.warm ? `<button class="cam-start" data-a="startBattleNow">${isTr ? 'Training startet jetzt' : 'Battle startet jetzt'}</button>`
        : `<button class="cam-end" data-a="endBattle">${isTr ? 'Training beenden' : 'Battle beenden'}</button>`}
      ${c.msg ? `<div class="cam-msg">${esc(c.msg)}</div>` : ''}
      ${S.set.debug ? '<div class="cam-debug mono" id="camDbg"></div>' : ''}`;
    timerTxt = f1(timer);
  }
  // Nur neu bauen, wenn sich wirklich etwas geändert hat – sonst flackert es
  if (force || ui._html !== html) { ui.innerHTML = html; ui._html = html; }
  const tEl = $('#camTimer'); if (tEl && timerTxt != null && tEl.textContent !== timerTxt) tEl.textContent = timerTxt;
  const dEl = $('#camDbg'); if (dEl && CAM.lastM) dEl.textContent = debugText();
  renderCamFx();
}

// Einblendungen über dem Kamerabild („Los geht's“, Ergebnis) – werden nur einmal gebaut,
// danach wird nur der Fortschrittsbalken bewegt.
function renderCamFx() {
  const fx = $('#camfx'); if (!fx || !S.cam) return;
  const c = S.cam, b = S.battle;
  const lastA = c.last ? b.attempts.find(a => a.id === c.last) : null;
  const showRes = c.phase === 'result' && lastA;
  const key = showRes ? 'res:' + lastA.id : c.flash ? 'flash' : '';
  if (fx._key !== key) {
    fx._key = key;
    fx.innerHTML = showRes ? resultHtml(lastA, b.mode === 'training') : c.flash ? `<div class="cam-flash"><span>Los geht's</span></div>` : '';
  }
  if (showRes) {
    const p = $('#resProg');
    if (p) p.style.width = Math.max(0, 100 - (performance.now() - c.resAt) / 4500 * 100) + '%';
  }
}

function debugText() {
  const m = CAM.lastM, r = CAM.runner;
  const t = m.ok ? `Hüfte ${m.hipDev.toFixed(0)}°  Schulter ${m.shDev.toFixed(0)}°  Knie ${m.kneeDev.toFixed(0)}°  Beine ${m.sep.toFixed(2)}  Achse ${m.axis.toFixed(0)}°\nkopfüber ${m.inverted ? 'ja' : 'nein'}  Schritte ${CAM.tracker ? CAM.tracker.steps : 0}` : 'kein Körper';
  return `${t}  ${Math.round(CAM.fps)} fps${r && r.flip ? '  ⟲' : ''}`;
}

function resultHtml(a, isTr) {
  const u = [...new Set(a.errors.map(e => e.label))].slice(0, 2);
  return `<div class="res" data-a="skipResult">
    <div class="res-l">
      <span class="res-name"><i style="background:${col(a.player)}"></i>${esc(nm(a.player))}</span>
      <span class="res-score">${a.score}</span>
      <span class="res-lab">${isTr ? 'Form-Punkte' : 'Punkte'}</span>
      ${a.warm ? '<span class="res-warm">Aufwärmen · zählt nicht</span>' : ''}
    </div>
    <div class="res-r">
      <div class="res-top"><span>${f1(a.time)} s</span><span style="color:#c9cbd3">${a.steps === 0 ? 'keine Handschritte' : plural(a.steps, 'Handschritt', 'Handschritte')}</span></div>
      ${SUBS.map(([k, l]) => { const off = !counts(k, a.mode, S.set); return `<div class="res-bar"><span>${l}</span><div><div style="background:${col(a.player)};width:${a.sub[k]}%;opacity:${off ? 0.25 : 1}"></div></div><b style="opacity:${off ? 0.4 : 1}">${a.sub[k]}</b></div>`; }).join('')}
      ${a.mode === 'battle' ? '<span class="res-tip" style="color:#a9abb5">Im Battle zählt nur die Haltezeit – die Form siehst du nur zur Info.</span>' : ''}
      ${isTr && u.length ? `<div class="col" style="gap:4px;margin-top:4px">${u.map(l => `<span class="res-tip"><b>${l}:</b> <span>${TIPS[l]}</span></span>`).join('')}</div>` : ''}
    </div>
    <div class="res-prog" id="resProg" style="background:${col(a.player)};width:100%"></div>
  </div>`;
}

// ---------- 05 Battle-Ende ----------
function dropVideos(b, keepFav = true) {
  b.attempts.forEach(a => {
    if (a.video && !(keepFav && isFav(a.id))) { URL.revokeObjectURL(a.video.url); a.video = null; a.frames = []; }
  });
}
function vidBtn(a, b) {
  const fav = isFav(a.id);
  const del = (b.videosDeleted || !a.video) && !fav;
  const icon = a.processing ? '…' : del ? '—' : fav ? '★' : '▶';
  return `<button class="vidbtn" data-a="openVideo" data-id="${a.id}" title="Video" ${del || a.processing ? 'disabled' : ''}>${icon}</button>`;
}
function endHtml() {
  const b = S.battle;
  if (!b) return homeHtml();
  const st = stats(b), { per, avg, tot, scored, winner, tie, isTr, counted } = st;
  const bestTr = scored.length ? scored.reduce((x, id) => avg[id] > avg[x] ? id : x, scored[0]) : null;
  const heroAv = (c, fg, t) => `<span class="avatar" style="width:72px;height:72px;background:${c};color:${fg};font-size:32px;font-weight:800">${esc(t)}</span>`;
  const hero = isTr
    ? { av: bestTr ? heroAv(col(bestTr), fgc(bestTr), ini(bestTr)) : heroAv('var(--soft)', 'var(--ink)', '–'), kicker: 'Training beendet', title: 'Gut geübt', sub: bestTr ? `Beste Form: ${esc(nm(bestTr))} mit Ø ${avg[bestTr]}` : 'Keine Handstände erkannt.' }
    : tie ? { av: heroAv('var(--soft)', 'var(--ink)', '='), kicker: 'Gleichstand', title: 'Unentschieden', sub: 'Gleicher Durchschnitt an der Spitze' }
      : !winner ? { av: heroAv('var(--soft)', 'var(--ink)', '–'), kicker: 'Noch keine Wertung', title: 'Kein Ergebnis', sub: 'Keine gewerteten Handstände erkannt.' }
        : { av: heroAv(col(winner), fgc(winner), ini(winner)), kicker: 'Tagessieg', title: esc(nm(winner)), sub: `Ø ${avg[winner]} · ${tot[winner]} Punkte gesamt` };
  const ordIds = counted.map(a => a.id);
  const statIds = [...b.players].sort((x, y) => avg[y] - avg[x]);
  const lists = statIds.map(id => `<div class="col gap8">
    <div class="row gap8">${dot(col(id), 10)}<span style="font-weight:700;font-size:16px">${esc(nm(id))}</span><span class="small">${per[id].length} gewertet</span></div>
    ${per[id].map(a => {
    const open = S.swapOpen === a.id;
    return `<div class="att"><div class="att-main">
        <span class="mono" style="font-size:12px;color:var(--muted);width:24px">#${ordIds.indexOf(a.id) + 1}</span>
        <span class="att-score">${a.score}</span>
        <div class="att-info"><span style="color:var(--ink);font-weight:500">${f1(a.time)} s · ${a.steps === 0 ? 'keine Schritte' : plural(a.steps, 'Schritt', 'Schritte')}</span>
          <span class="ell">${a.errors.length ? esc([...new Set(a.errors.map(e => e.label))].join(', ')) : 'Sauber'}</span></div>
        ${b.players.length > 1 ? `<button class="sqbtn${open ? ' on' : ''}" data-a="swapToggle" data-id="${a.id}" title="Andere Person zuordnen">⇄</button>` : ''}
        ${vidBtn(a, b)}
      </div>
      ${open ? `<div class="swap-area"><span class="small" style="margin-right:2px">Zuordnen zu:</span>${b.players.filter(x => x !== id).map(x => `<button class="target" data-a="assign" data-id="${a.id}" data-to="${x}">${dot(col(x), 10)}${esc(nm(x))}</button>`).join('')}</div>` : ''}
    </div>`;
  }).join('')}
  </div>`).join('');
  const warm = b.attempts.filter(a => a.warm), nFav = b.attempts.filter(a => isFav(a.id)).length;
  const note = b.videosDeleted ? `Videos wurden gelöscht.${nFav ? ` ${nFav} Favorit${nFav > 1 ? 'en' : ''} in der Galerie.` : ''}`
    : `${b.players.length > 1 ? 'Mit ⇄ lässt sich ein Versuch einer anderen Person zuordnen, falls das Abwechseln falsch erkannt wurde. ' : ''}Beim Speichern werden alle Videos gelöscht – außer Favoriten ★${nFav ? ` (${nFav})` : ''}.`;
  return `<div class="col" style="min-height:100vh;min-height:100dvh">
    <div class="head"><button class="iconbtn" data-a="goHome">←</button>
      <div class="col"><span class="head-title">${isTr ? 'Training-Ende' : 'Battle-Ende'}</span><span class="head-sub">${dLong(b.date)} · ${({ battle: 'Battle', training: 'Training', profi: 'Profi' })[b.mode]}</span></div></div>
    <div class="body" style="gap:16px">
      <div class="card hero">${hero.av}<div class="col" style="gap:2px;min-width:0">
        <span style="font-size:13px;font-weight:600;color:var(--muted)">${hero.kicker}</span>
        <span style="font-weight:800;font-size:38px;line-height:1;letter-spacing:-0.02em;overflow:hidden;text-overflow:ellipsis">${hero.title}</span>
        <span style="font-size:14.5px;color:var(--muted);font-weight:500">${hero.sub}</span></div></div>
      <div class="grid2">${statIds.map(id => `<div class="card col" style="padding:14px;border-radius:18px;gap:4px">
        <span class="row" style="gap:7px;font-weight:600;font-size:15px">${dot(col(id), 10)}${esc(nm(id))}</span>
        <span class="stat-big">Ø ${avg[id]}</span>
        <span class="small">Gesamt ${tot[id]} · ${per[id].length} gewertet</span></div>`).join('')}</div>
      ${lists}
      <div class="col gap8">
        <button class="warm-toggle" data-a="toggleWarm"><span style="font-weight:600;font-size:14.5px">Aufwärmen · ${plural(warm.length, 'Video', 'Videos')} · zählen nicht</span><span style="font-size:12px;color:var(--muted)">${S.showWarm ? '▲' : '▼'}</span></button>
        ${S.showWarm ? warm.map(a => `<div class="att"><div class="att-main">${dot(col(a.player), 10)}
          <span style="font-weight:600;font-size:15px;flex:1">${esc(nm(a.player))} · ${f1(a.time)} s <span style="color:var(--muted);font-weight:500">· Probe ${a.score}</span></span>${vidBtn(a, b)}</div></div>`).join('') : ''}
      </div>
      <div class="note">${note}</div>
    </div>
    <div class="sticky-foot"><button class="btn-main" style="height:58px;font-size:17px" data-a="saveBattle">${b.saved ? 'Zurück zum Start' : 'Speichern & fertig'}</button></div>
  </div>`;
}

function saveBattle() {
  const b = S.battle;
  if (b.saved) { go('home'); return; }
  const st = stats(b);
  const del = b.attempts.filter(a => a.video && !isFav(a.id)).length;
  if (!st.isTr && st.counted.length) {
    const names = {}, colors = {};
    st.scored.forEach(id => { names[id] = nm(id); colors[id] = person(id).color; });
    S.history.push({ date: b.date, players: st.scored, avg: { ...st.avg }, winner: st.winner || null, count: st.counted.length, mode: b.mode, names, colors });
  }
  dropVideos(b);
  b.saved = true; b.videosDeleted = true;
  go('home', { swapOpen: null });
  toast(st.isTr ? `Training beendet · ${del} Videos gelöscht.`
    : st.winner ? `Sieg für ${nm(st.winner)}. ${del} Videos gelöscht.`
      : `Gespeichert · ${del} Videos gelöscht.`);
}

// ---------- 06 Video-Analyse ----------
function findAttempt(id) {
  return (S.battle && S.battle.attempts.find(a => a.id === id)) || S.favorites.find(a => a.id === id);
}
function playable(a) {
  const f = S.favorites.find(x => x.id === a.id);
  return (a.video && a.video.url ? a : null) || (f && f.video ? f : null);
}
function renderVideo() {
  const a0 = findAttempt(S.video.id);
  if (!a0) { go(S.video.back || 'home'); return; }
  const a = playable(a0) || a0, v = a.video;
  const fav = isFav(a.id);
  const dur = v ? Math.max(0.5, v.clipEnd - v.clipStart) : 0;
  const pre = v ? v.hsOff - v.clipStart : 0;
  app.innerHTML = `<div class="page"><div class="pad" style="padding:10px 20px 28px;gap:14px">
    <div class="row gap12">
      <button class="iconbtn" data-a="backFromVideo">←</button>
      <div class="col" style="flex:1;min-width:0"><span class="head-title">Video-Analyse</span><span class="head-sub">${dShort(a.date)} · ${f1(a.time)} s gehalten${a.warm ? ' · Aufwärmen' : ''}</span></div>
      <button class="favbtn${fav ? ' on' : ''}" id="favBtn" data-a="toggleFav">${fav ? '★' : '☆'} Favorit</button>
    </div>
    <div class="vbox">
      ${v ? `<video id="vv" playsinline muted preload="auto" src="${v.url}" ${v.mirror ? 'class="mirror"' : ''}></video><canvas id="vsk" ${v.mirror ? 'class="mirror"' : ''}></canvas>`
      : '<div class="mono" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8a8c96;font-size:12px">kein Video vorhanden</div>'}
      <div class="row gap8" style="position:absolute;top:10px;left:10px"><span class="vtag">${dot(col(a.player), 10)}${esc(nm(a.player))}</span>
        ${a.warm ? '<span style="padding:4px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.6);color:#fff;font-weight:600;font-size:12.5px">Aufwärmen</span>' : ''}</div>
      <div class="verr" id="verr" style="display:none"></div>
      <div class="vtime mono" id="vtime">0,0 / ${f1(dur)} s</div>
    </div>
    ${v ? `<div class="row gap12">
      <button class="play" id="vplay" data-a="togglePlay">▶</button>
      <div class="track" id="vtrack"><div class="track-bg"></div><div class="track-fill" id="vfill" style="width:0"></div>
        ${a.errors.map(e => `<div class="track-mk" style="left:${clamp((pre + e.t) / dur * 100)}%"></div>`).join('')}
        <div class="track-knob" id="vknob" style="left:0"></div></div>
    </div>` : ''}
    ${fav && v ? '<button class="link" style="align-self:flex-start" data-a="shareVideo">Video aufs Handy speichern ⤓</button>' : ''}
    <div class="col" style="gap:6px">
      <span class="label">Fehlermarkierungen</span>
      ${a.errors.length ? a.errors.map((e, i) => `<button class="errbtn" data-a="seekErr" data-i="${i}" id="err${i}">
        <span class="dot" style="width:8px;height:8px;background:var(--err)"></span>
        <span class="mono" style="font-size:12.5px;color:var(--muted);width:62px">Sek. ${f1(pre + e.t)}</span>
        <span style="font-weight:600;font-size:15px;flex:1">${esc(e.label)}</span></button>`).join('')
      : '<div style="font-size:14.5px;color:var(--muted);padding:6px 0">Keine Fehler erkannt – sauberer Handstand.</div>'}
    </div>
    <div class="card row" style="padding:16px;border-radius:18px;gap:16px">
      <div class="col" style="align-items:center;width:80px;flex:none"><span style="font-weight:800;font-size:54px;line-height:1">${a.score}</span><span style="font-size:12.5px;font-weight:600;color:var(--muted)">${a.warm ? 'Probe' : 'Punkte'}</span></div>
      <div class="col" style="flex:1;gap:7px">${SUBS.map(([k, l]) => `<div class="col" style="gap:3px;opacity:${counts(k, a.mode, S.set) ? 1 : 0.45}">
        <div class="row" style="justify-content:space-between;font-size:12.5px;font-weight:500"><span>${l}</span><span class="tnum" style="font-weight:600">${a.sub[k]}</span></div>
        <div style="height:5px;border-radius:3px;background:var(--soft)"><div style="height:5px;border-radius:3px;background:${col(a.player)};width:${a.sub[k]}%"></div></div></div>`).join('')}
        ${a.mode === 'battle' ? '<span style="font-size:12px;color:var(--muted)">Im Battle zählt nur die Haltezeit.</span>' : ''}</div>
    </div>
  </div></div>`;
  if (v) setupPlayer(a, dur, pre);
}

const VP = {};
function setupPlayer(a, dur, pre) {
  const video = $('#vv'), v = a.video;
  Object.assign(VP, { a, dur, pre, video, ready: false, playing: false });
  const frameAt = t => {
    const fr = a.frames; if (!fr || !fr.length) return null;
    let lo = 0, hi = fr.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; }
    const f = fr[lo];
    if (!f || !f.p || Math.abs(f.t - t) > 0.4) return null;
    const pts = []; KEEP.forEach((k, i) => { pts[k] = { x: f.p[i][0], y: f.p[i][1], visibility: f.p[i][2] }; });
    return pts;
  };
  VP.update = () => {
    if (!$('#vv')) return;
    const t = clamp(video.currentTime - v.clipStart, 0, dur);
    const pct = t / dur * 100;
    $('#vfill').style.width = pct + '%'; $('#vknob').style.left = pct + '%';
    $('#vtime').textContent = `${f1(t)} / ${f1(dur)} s`;
    const ht = t - pre;
    const near = a.errors.findIndex(e => Math.abs(e.t - ht) < 0.6);
    const ve = $('#verr');
    if (near >= 0) { ve.style.display = 'block'; ve.textContent = '⚠ ' + a.errors[near].label; } else ve.style.display = 'none';
    a.errors.forEach((e, i) => { const el = $('#err' + i); if (el) el.classList.toggle('on', i === near); });
    drawSkeleton($('#vsk'), frameAt(video.currentTime), video.videoWidth, video.videoHeight, 'contain');
    $('#vplay').textContent = VP.playing ? '❚❚' : '▶';
  };
  const tick = () => {
    if (!VP.playing || !$('#vv')) return;
    if (video.currentTime - v.clipStart >= dur - 0.02) { video.pause(); VP.playing = false; }
    VP.update();
    if (VP.playing) requestAnimationFrame(tick);
  };
  VP.play = (from) => {
    if (from != null) video.currentTime = v.clipStart + from;
    else if (video.currentTime - v.clipStart >= dur - 0.05) video.currentTime = v.clipStart;
    video.play().then(() => { VP.playing = true; requestAnimationFrame(tick); }).catch(() => { });
  };
  VP.pause = () => { video.pause(); VP.playing = false; VP.update(); };
  VP.seek = t => { video.currentTime = v.clipStart + clamp(t, 0, dur); setTimeout(VP.update, 60); };
  video.addEventListener('seeked', () => VP.update());
  fixDuration(video).then(() => {
    video.currentTime = v.clipStart;
    VP.ready = true;
    setTimeout(() => { VP.update(); if (S.video && S.video.autoplay) VP.play(0); }, 80);
  });
  const track = $('#vtrack');
  const seekEv = e => { const r = track.getBoundingClientRect(); VP.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * dur); };
  track.addEventListener('pointerdown', e => { track.setPointerCapture(e.pointerId); if (VP.playing) VP.pause(); seekEv(e); track.onpointermove = seekEv; });
  track.addEventListener('pointerup', () => { track.onpointermove = null; });
}

async function toggleFav() {
  const a0 = findAttempt(S.video.id); if (!a0) return;
  const a = playable(a0) || a0;
  if (isFav(a.id)) {
    S.favorites = S.favorites.filter(f => f.id !== a.id);
    favDel(a.id).catch(() => { });
    toast('Aus den Favoriten entfernt');
  } else {
    const rec = {
      id: a.id, player: a.player, warm: a.warm, time: a.time, steps: a.steps, sub: a.sub, errors: a.errors, mode: a.mode, date: a.date, score: a.score,
      thumb: a.thumb, frames: a.frames, savedAt: Date.now(), name: nm(a.player), color: person(a.player).color,
      video: a.video ? { blob: a.video.blob, hsOff: a.video.hsOff, clipStart: a.video.clipStart, clipEnd: a.video.clipEnd, mirror: a.video.mirror } : null,
    };
    S.favorites.unshift({ ...rec, video: rec.video ? { ...rec.video, url: a.video.url } : null });
    try { await favPut(rec); toast('Als Favorit gespeichert ★ – mit „aufs Handy speichern“ landet es in deiner Galerie.'); }
    catch { toast('Favorit konnte nicht dauerhaft gespeichert werden (Speicher voll?).'); }
  }
  const pos = VP.video ? VP.video.currentTime : 0;
  S.video.autoplay = false;
  renderVideo();
  if (VP.video) VP.video.currentTime = pos;
}

async function shareVideo() {
  const a = S.favorites.find(f => f.id === S.video.id);
  if (!a || !a.video) return;
  const blob = a.video.blob, ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = `handstand-${(a.name || nm(a.player)).replace(/[^a-z0-9äöüß]/gi, '')}-${dShort(a.date).replace(/\./g, '-')}${a.score}.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Handstand' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- 07 Verlauf ----------
function historyHtml() {
  const tabs = `<div class="seg" style="grid-template-columns:1fr 1fr">
    <button class="${S.histTab === 'tage' ? 'on' : ''}" data-a="histTab" data-v="tage" style="height:38px">Tage</button>
    <button class="${S.histTab === 'galerie' ? 'on' : ''}" data-a="histTab" data-v="galerie" style="height:38px">Galerie (${S.favorites.length})</button></div>`;
  let body;
  if (S.histTab === 'tage') {
    const H = S.history.slice(-30), n = H.length;
    if (!n) body = '<div style="padding:30px 0;text-align:center;color:var(--muted)">Noch keine Battles gespeichert.</div>';
    else {
      const X = i => n === 1 ? 171 : 26 + i * (290 / (n - 1)), Y = v => 150 - (clamp(v, 40, 100) - 40) / 60 * 140;
      const ids = [...new Set(H.flatMap(h => h.players))];
      const grid = [50, 70, 90].map(v => ({ y: Y(v), pct: Y(v) / 178 * 100, v }));
      const svg = `<svg viewBox="0 0 320 178" style="width:100%;height:auto;display:block">
        ${grid.map(g => `<line x1="26" x2="316" y1="${g.y}" y2="${g.y}" style="stroke:var(--line)" stroke-width="1"></line>`).join('')}
        ${ids.map(id => `<polyline points="${H.map((h, i) => h.avg[id] != null ? `${X(i)},${Y(h.avg[id])}` : null).filter(Boolean).join(' ')}" fill="none" style="stroke:${col(id)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>`).join('')}
        ${ids.map(id => H.map((h, i) => h.avg[id] != null ? `<circle cx="${X(i)}" cy="${Y(h.avg[id])}" r="3" style="fill:${col(id)};stroke:var(--surface)" stroke-width="1.5"></circle>` : '').join('')).join('')}
      </svg>`;
      body = `<div class="card col gap10" style="padding:14px 12px 10px;border-radius:18px">
          <div class="col" style="gap:6px;padding:0 4px"><span style="font-weight:600;font-size:15px">Fortschritt · Ø Punkte</span>
            <div class="row" style="flex-wrap:wrap;gap:4px 12px;font-size:13px;font-weight:500">${ids.map(id => `<span class="row" style="gap:5px"><span style="width:14px;height:3px;border-radius:2px;background:${col(id)}"></span>${esc(nm(id))}</span>`).join('')}</div></div>
          <div style="position:relative">${svg}
            ${grid.map(g => `<span style="position:absolute;left:0;top:${g.pct}%;transform:translateY(-50%);font-size:11px;color:var(--muted)">${g.v}</span>`).join('')}
            <span style="position:absolute;left:8.1%;bottom:0;font-size:11px;color:var(--muted)">${dShort(H[0].date)}</span>
            ${n > 1 ? `<span style="position:absolute;right:1.2%;bottom:0;font-size:11px;color:var(--muted)">${dShort(H[n - 1].date)}</span>` : ''}
          </div></div>
        <div class="col gap8">${[...S.history].reverse().map(h => `<div class="hrow">
          <div class="col" style="line-height:1.15"><span style="font-size:12px;color:var(--muted)">${WD[D(h.date).getDay()]}</span><span style="font-weight:700;font-size:17px">${dShort(h.date)}</span></div>
          <div class="col" style="gap:4px;min-width:0">
            <div class="row" style="justify-content:space-between;gap:8px">
              <span class="row" style="gap:6px;font-weight:600;font-size:15px">${h.winner ? avatar(h.winner, 20, 10.5) : '<span class="avatar" style="width:20px;height:20px;background:var(--soft);color:var(--ink);font-size:10.5px">=</span>'}${h.winner ? esc(nm(h.winner)) : 'Unentschieden'}</span>
              <span style="font-size:12.5px;color:var(--muted)">${h.count} Handstände</span></div>
            <div class="row" style="flex-wrap:wrap;gap:4px 12px;font-size:13px;color:var(--muted)">${[...h.players].sort((x, y) => h.avg[y] - h.avg[x]).map(id => `<span class="row" style="gap:4px">${dot(col(id), 7)}${esc(nm(id))} <b class="tnum" style="color:var(--ink)">${h.avg[id]}</b></span>`).join('')}</div>
          </div></div>`).join('')}</div>`;
    }
  } else {
    body = `<div class="note" style="font-size:13.5px">Favoriten bleiben gespeichert. Alle anderen Videos werden nach dem Battle gelöscht.</div>
      ${S.favorites.length ? `<div class="grid2">${S.favorites.map(g => `<button class="gal" data-a="openFav" data-id="${g.id}">
        <div class="gal-thumb">${g.thumb ? `<img src="${g.thumb}" alt="">` : '<span class="mono" style="font-size:10px;color:var(--muted)">video-vorschau</span>'}
          <span style="position:absolute;top:6px;right:8px;font-size:16px;color:#fff;text-shadow:0 1px 3px #000">★</span>
          ${g.warm ? '<span style="position:absolute;top:8px;left:8px;padding:2px 6px;border-radius:6px;background:var(--surface);font-size:10.5px;font-weight:600">Aufwärmen</span>' : ''}</div>
        <div class="row" style="padding:8px 10px 10px;justify-content:space-between;align-items:end">
          <div class="col"><span class="row" style="gap:5px;font-weight:600;font-size:14px">${dot(col(g.player), 8)}${esc(nm(g.player))}</span><span style="font-size:12px;color:var(--muted)">${dShort(g.date)} · ${f1(g.time)} s</span></div>
          <span style="font-weight:800;font-size:24px;line-height:1">${g.score}</span></div></button>`).join('')}</div>`
        : '<div style="padding:30px 0;text-align:center;color:var(--muted)">Noch keine Favoriten.</div>'}`;
  }
  return `<div class="pad" style="padding:10px 20px 28px;gap:14px">
    <div class="row gap12"><button class="iconbtn" data-a="goHome">←</button><span class="head-title">Verlauf</span></div>
    ${tabs}${body}</div>`;
}

// ---------- 08 Einstellungen ----------
function settingsHtml() {
  const set = S.set, wsum = SUBS.reduce((x, [k]) => x + set.weights[k], 0) || 1;
  const seg = (cur, opts, action, cols) => `<div class="seg" style="grid-template-columns:repeat(${cols},1fr)">${opts.map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-a="${action}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const steps = [['erlaubt', 'Erlaubt', 'Handschritte haben keinen Einfluss.'], ['abzug', 'Punktabzug pro Schritt', 'Jeder Schritt kostet Punkte (nur Training und Profi).'], ['ende', 'Versuch endet', 'Beim ersten Schritt stoppt die Haltezeit.']];
  const strictDesc = ['Kleine Fehler werden verziehen – gut für den Anfang.', 'Ausgewogen für den täglichen Vergleich.', 'Jede Abweichung kostet deutlich Punkte.'][set.strict - 1] + ' Der Profi-Modus bewertet zusätzlich strenger.';
  return `<div class="pad" style="padding:10px 20px 32px;gap:20px">
    <div class="row gap12"><button class="iconbtn" data-a="backFromSettings">←</button><span class="head-title">Einstellungen</span></div>
    <div class="col gap8"><span class="label">Darstellung</span>${seg(S.theme, [['light', 'Hell'], ['dark', 'Dunkel']], 'theme', 2)}</div>
    <div class="col gap8"><div class="between"><span class="label">Handschritte</span><span style="font-size:12.5px;color:var(--muted)">im Battle wirkt nur „Versuch endet“</span></div>
      <div class="card-tight">${steps.map(([v, l, d]) => `<button class="opt${set.stepRule === v ? ' on' : ''}" data-a="stepRule" data-v="${v}"><span class="radio"><span></span></span><span class="col" style="gap:2px"><span style="font-weight:600;font-size:15.5px">${l}</span><span style="font-size:13px;color:var(--muted)">${d}</span></span></button>`).join('')}
        ${set.stepRule === 'abzug' ? `<div class="col" style="padding:12px 14px 14px;gap:6px">
          <div class="row" style="justify-content:space-between;font-size:14px;font-weight:500"><span>Abzug pro Schritt</span><span style="font-weight:700;font-size:18px" id="penVal">−${set.penalty}</span></div>
          <input type="range" min="5" max="30" step="5" value="${set.penalty}" data-in="penalty"></div>` : ''}
      </div></div>
    <div class="col gap8"><span class="label">Strenge der Bewertung</span>${seg(set.strict, [[1, 'Locker'], [2, 'Normal'], [3, 'Streng']], 'strict', 3)}<span class="note">${strictDesc}</span></div>
    <div class="col gap8">
      <div class="between"><span class="label">Profi-Gewichtung</span><span style="font-size:12.5px;color:var(--muted)">nur im Profi-Modus</span></div>
      <div class="card col gap12" style="padding:14px;border-radius:18px">${SUBS.map(([k, l]) => `<div class="col" style="gap:4px">
        <div class="between"><span style="font-weight:600;font-size:15px">${l}</span><span style="font-weight:700;font-size:16px" class="tnum" id="w_${k}">${Math.round(set.weights[k] / wsum * 100)} %</span></div>
        <input type="range" min="0" max="50" step="5" value="${set.weights[k]}" data-in="weight" data-k="${k}"></div>`).join('')}</div></div>
    <div class="col gap8"><span class="label">Kamera</span>${seg(set.camera, [['user', 'Vorne (Selfie)'], ['environment', 'Hinten']], 'camera', 2)}
      <span class="note">Vorne: Ihr seht den Bildschirm beim Handstand. Hinten: bessere Bildqualität, aber der Bildschirm zeigt weg.</span></div>
    <div class="col gap8"><span class="label">Für Tüftler</span>
      <div class="card row" style="padding:14px;border-radius:18px;gap:12px"><span class="col" style="flex:1;gap:2px"><span style="font-weight:600;font-size:15.5px">Messwerte anzeigen</span><span style="font-size:13px;color:var(--muted)">Zeigt im Kamerabild die gemessenen Winkel – hilft beim Einstellen.</span></span>
        <button class="toggle${set.debug ? ' on' : ''}" data-a="debug" aria-label="Messwerte anzeigen"></button></div></div>
    <div class="col gap8"><span class="label">Kamera geht nicht?</span>
      <div class="card col gap10" style="padding:14px;border-radius:18px">
        <span style="font-size:13.5px;line-height:1.45;color:var(--muted)">Der Check prüft Schritt für Schritt, woran es liegt. Mach bei Problemen einen Screenshot davon.</span>
        <button class="btn-small" style="align-self:flex-start;height:40px" data-a="runDiag" ${S.diag === 'running' ? 'disabled' : ''}>${S.diag === 'running' ? 'Prüfe …' : 'Kamera-Check starten'}</button>
        ${Array.isArray(S.diag) ? `<div class="col" style="gap:6px;font-size:13.5px">${S.diag.map(([l, v, ok]) => `<div class="row gap8" style="align-items:flex-start"><span style="flex:none;width:18px">${ok === true ? '✅' : ok === false ? '❌' : 'ℹ️'}</span><span style="flex:1"><b style="font-weight:600">${esc(l)}:</b> ${esc(v)}</span></div>`).join('')}</div>` : ''}
      </div></div>
    <div style="background:var(--soft);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:6px;font-size:13.5px;line-height:1.45">
      <span style="font-weight:600;font-size:15px">Speicher & Datenschutz</span>
      <span>Videos werden ohne Ton aufgenommen und nur bis zum Ende des Battles zwischengespeichert. Favoriten ★ bleiben in der Galerie.</span>
      <span style="color:var(--muted)">Dauerhaft gespeichert: nur Siegerliste und Verlauf. Alles bleibt auf diesem Handy.</span>
    </div>
    <button class="link" style="align-self:flex-start;color:var(--muted)" data-a="resetAll">Verlauf und Favoriten löschen</button>
    <span class="mono small" style="font-size:11px">Version ${VERSION}</span>
  </div>`;
}

// ---------- Kamera-Check ----------
async function runDiag() {
  S.diag = 'running'; render();
  const out = [];
  const iosV = (UA.match(/OS (\d+)_(\d+)/) || []).slice(1).join('.');
  const browser = IN_APP ? 'eingebauter Browser einer App (WhatsApp, Instagram …)'
    : /CriOS/.test(UA) ? 'Chrome auf iPhone' : /FxiOS/.test(UA) ? 'Firefox auf iPhone' : /EdgiOS/.test(UA) ? 'Edge auf iPhone'
      : IS_IOS ? 'Safari' : /Chrome\//.test(UA) ? 'Chrome' : /Firefox\//.test(UA) ? 'Firefox' : 'unbekannt';
  out.push(['App-Version', String(VERSION), null]);
  out.push(['Gerät', IS_IOS ? `iPhone/iPad mit iOS ${iosV || '?'}` : (/Android ([\d.]+)/.exec(UA) || [, ''])[1] ? `Android ${(/Android ([\d.]+)/.exec(UA))[1]}` : 'Computer/anderes', null]);
  out.push(['Browser', browser, IN_APP ? false : null]);
  out.push(['Als Home-Bildschirm-App geöffnet', (navigator.standalone || matchMedia('(display-mode: standalone)').matches) ? 'ja' : 'nein', null]);
  out.push(['Sichere Verbindung (https)', window.isSecureContext ? `ja (${location.protocol}//${location.host})` : `nein – Adresse ist ${location.protocol}//${location.host}`, window.isSecureContext]);
  out.push(['Kamera-Schnittstelle vorhanden', CAM_OK ? 'ja' : 'nein – dieser Browser bietet der Seite keine Kamera an', CAM_OK]);
  if (CAM_OK) {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const tr = st.getVideoTracks()[0], s = tr && tr.getSettings ? tr.getSettings() : {};
      out.push(['Kamera-Test', `funktioniert (${s.width || '?'}×${s.height || '?'})`, true]);
      st.getTracks().forEach(t => t.stop());
    } catch (e) {
      const why = {
        NotAllowedError: 'Zugriff verweigert. iPhone: Einstellungen → Apps → Safari → Kamera → „Fragen“ oder „Erlauben“. Außerdem: Einstellungen → Bildschirmzeit → Beschränkungen → Kamera muss erlaubt sein.',
        NotFoundError: 'Keine Kamera gefunden.',
        NotReadableError: 'Die Kamera wird gerade von einer anderen App benutzt. Andere Apps schließen und nochmal versuchen.',
        OverconstrainedError: 'Die Kamera unterstützt die Einstellungen nicht.',
        SecurityError: 'Vom Browser aus Sicherheitsgründen blockiert.',
      }[e.name] || (e.message || 'unbekannter Fehler');
      out.push(['Kamera-Test', `${e.name || 'Fehler'}: ${why}`, false]);
    }
  } else if (IS_IOS) {
    const major = parseInt(iosV, 10);
    out.push(['Tipp', major && major < 15 ? `iOS ${iosV} ist zu alt – bitte das iPhone aktualisieren (Einstellungen → Allgemein → Softwareupdate).`
      : IN_APP ? browserHint() : 'Link in Safari öffnen (nicht in einer anderen App). Prüfen: Einstellungen → Bildschirmzeit → Beschränkungen → Kamera erlaubt? Und: ist der Blockierungsmodus (Lockdown Mode) aus?', null]);
  }
  S.diag = out;
  if (S.screen === 'settings') render();
}

// ---------- Aktionen ----------
const setSet = patch => { S.set = { ...S.set, ...patch }; render(); };
const A = {
  toggleTheme: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; render(); },
  theme: d => { S.theme = d.v; render(); },
  goHome: () => go('home', { swapOpen: null }),
  goSettings: () => go('settings', { settingsBack: S.screen }),
  backFromSettings: () => go(S.settingsBack === 'settings' ? 'home' : S.settingsBack),
  goSetup: () => { if (S.setup.mode === 'training') S.setup.mode = 'battle'; go('setup', { editing: null, adding: false }); },
  goTraining: () => { S.setup.mode = 'training'; go('setup', { editing: null, adding: false }); },
  goHistory: () => go('history', { histTab: 'tage' }),
  openLast: () => go(S.battle && !S.battle.saved && S.battle.attempts.length ? 'end' : 'history'),
  // Personen
  rtoggle: d => {
    const cur = S.setup.sel, id = d.id;
    const ns = cur.includes(id) ? cur.filter(x => x !== id) : S.roster.map(q => q.id).filter(x => cur.includes(x) || x === id);
    S.setup = { ...S.setup, sel: ns, starter: ns.includes(S.setup.starter) ? S.setup.starter : (ns[0] || null) };
    render();
  },
  redit: d => { S.editing = S.editing === d.id ? null : d.id; S.adding = false; render(); },
  rcolor: d => { S.roster = S.roster.map(q => q.id === d.id ? { ...q, color: d.c } : q); render(); },
  rremove: d => {
    if (S.roster.length <= 2) return;
    S.roster = S.roster.filter(q => q.id !== d.id);
    const ns = S.setup.sel.filter(x => x !== d.id);
    S.setup = { ...S.setup, sel: ns, starter: ns.includes(S.setup.starter) ? S.setup.starter : (ns[0] || null) };
    S.editing = null; render();
  },
  startAdd: () => { S.adding = true; S.editing = null; S.newName = ''; render(); setTimeout(() => $('#newName')?.focus(), 30); },
  cancelAdd: () => { S.adding = false; render(); },
  newColor: d => { S.newColor = d.c; render(); setTimeout(() => $('#newName')?.focus(), 30); },
  confirmAdd: () => {
    const name = S.newName.trim(); if (!name) return;
    const id = 'p' + uid();
    S.roster = [...S.roster, { id, name, color: S.newColor }];
    S.adding = false; S.newName = '';
    S.setup = { ...S.setup, sel: [...S.setup.sel, id], starter: S.setup.starter || id };
    render();
  },
  starter: d => { S.setup = { ...S.setup, starter: d.id }; render(); },
  mode: d => { S.setup = { ...S.setup, mode: d.v }; render(); },
  startCamera: () => startCamera(),
  // Kamera
  startBattleNow: () => { S.cam.warm = false; S.cam.flash = performance.now() + 1400; renderCamUI(true); },
  runDiag: () => runDiag(),
  copyLink: async () => {
    try { await navigator.clipboard.writeText(APP_URL); toast('Link kopiert – jetzt in Safari bzw. Chrome einfügen.'); }
    catch { prompt('Link kopieren:', APP_URL); }
  },
  skipTurn: () => {
    const c = S.cam; if (!c || c.phase === 'active' || c.phase === 'loading') return;
    if (CAM.tracker) CAM.tracker.reset();
    c.phase = 'ready'; c.turn++; renderCamUI(true);
  },
  switchCam: async () => {
    S.set = { ...S.set, camera: S.set.camera === 'user' ? 'environment' : 'user' };
    persist(); renderCamUI(true);
    await restartStream();
    renderCamUI(true);
  },
  skipResult: () => { if (S.cam.phase === 'result') { S.cam.phase = 'ready'; S.cam.turn++; renderCamUI(true); } },
  endBattle: async () => {
    // Läuft gerade noch ein Handstand, wird er noch gewertet
    if (S.cam.phase === 'active' && CAM.tracker && CAM.tracker.state === 'active') {
      CAM.tracker.finish(CAM.tracker.lastInv);
      finishAttempt(performance.now(), $('#camv'));
    }
    await stopCamera(); S.cam = null; go('end');
  },
  exitCamera: async () => {
    await stopCamera();
    const had = S.battle && S.battle.attempts.length;
    S.cam = null;
    if (had) go('end');
    else { S.battle = S.prevBattle; go('home'); }
  },
  // Ende
  swapToggle: d => { S.swapOpen = S.swapOpen === d.id ? null : d.id; render(); },
  assign: d => { const a = S.battle.attempts.find(x => x.id === d.id); if (a) a.player = d.to; S.swapOpen = null; render(); },
  toggleWarm: () => { S.showWarm = !S.showWarm; render(); },
  openVideo: d => go('video', { video: { id: d.id, back: 'end', autoplay: true } }),
  saveBattle,
  // Video
  backFromVideo: () => { if (VP.video) VP.video.pause(); go(S.video.back || 'end', { video: null }); },
  togglePlay: () => { if (!VP.ready) return; if (VP.playing) VP.pause(); else VP.play(); },
  seekErr: d => { const e = VP.a && VP.a.errors[+d.i]; if (!e || !VP.ready) return; VP.play(Math.max(0, VP.pre + e.t - 0.4)); },
  toggleFav, shareVideo,
  openFav: d => go('video', { video: { id: d.id, back: 'history', autoplay: true } }),
  histTab: d => { S.histTab = d.v; render(); },
  // Einstellungen
  stepRule: d => setSet({ stepRule: d.v }),
  strict: d => setSet({ strict: +d.v }),
  camera: d => setSet({ camera: d.v }),
  debug: () => setSet({ debug: !S.set.debug }),
  resetAll: async () => {
    if (!confirm('Wirklich den ganzen Verlauf und alle Favoriten löschen? Das kann man nicht rückgängig machen.')) return;
    S.history = []; S.favorites.forEach(f => f.video && URL.revokeObjectURL(f.video.url)); S.favorites = [];
    await favClear().catch(() => { });
    render(); toast('Verlauf und Favoriten gelöscht.');
  },
};
const I = {
  rname: (val, d) => { S.roster = S.roster.map(q => q.id === d.id ? { ...q, name: val } : q); persist(); },
  newName: val => { S.newName = val; const b = $('#addBtn'); if (b) b.disabled = !val.trim(); },
  penalty: val => { S.set = { ...S.set, penalty: +val }; const el = $('#penVal'); if (el) el.textContent = '−' + val; persist(); },
  weight: (val, d) => {
    S.set = { ...S.set, weights: { ...S.set.weights, [d.k]: +val } };
    const ws = SUBS.reduce((x, [k]) => x + S.set.weights[k], 0) || 1;
    SUBS.forEach(([k]) => { const el = $('#w_' + k); if (el) el.textContent = Math.round(S.set.weights[k] / ws * 100) + ' %'; });
    persist();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el.dataset, e, el); }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-in]');
  if (el && I[el.dataset.in]) I[el.dataset.in](el.value, el.dataset, el);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'newName') A.confirmAdd();
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.in === 'rname') A.redit({ id: e.target.dataset.id });
});
window.addEventListener('resize', () => { if (S.screen === 'video' && VP.update) VP.update(); });

if (DEMO) window.HB = { S, CAM }; // zum Testen
render();
