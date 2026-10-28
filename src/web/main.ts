import './styles.css';
import type { CoreMeta } from '../api';
import type { TournamentResult } from '../engine/tournament';
import type { FrameEvent, Replay } from '../engine/types';
import { parseMeta } from '../runtime/sandbox';
import coreTemplate from '../../scripts/core-template.js?raw';
import { PROTOCOL_HTML } from './docs';
import type { CoreSource, WorkerRequest, WorkerResponse } from './protocol';
import { ArenaRenderer } from './renderer';

// ---------- helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function setStatus(text: string, err = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('err', err);
}
function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

// ---------- core store ----------
interface StoredCore extends CoreSource {
  meta: CoreMeta;
  builtin: boolean;
}
const STORE_KEY = 'daemon-arena.cores.v1';
const builtinSources = import.meta.glob('../../cores/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const BUILTIN_ORDER = ['hunter', 'phantom', 'sentinel', 'drifter', 'spinner'];
const builtins: StoredCore[] = Object.entries(builtinSources)
  .map(([file, source]) => {
    const id = file.split('/').pop()!.replace('.js', '');
    return { id, source, meta: parseMeta(source), builtin: true };
  })
  .sort((a, b) => BUILTIN_ORDER.indexOf(a.id) - BUILTIN_ORDER.indexOf(b.id));

function loadCustom(): StoredCore[] {
  try {
    return (JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as StoredCore[]).map((c) => ({ ...c, builtin: false }));
  } catch {
    return [];
  }
}
let custom = loadCustom();
const allCores = () => [...builtins, ...custom];
const coreById = (id: string) => allCores().find((c) => c.id === id);
function saveCustom() {
  localStorage.setItem(STORE_KEY, JSON.stringify(custom.map(({ id, source, meta }) => ({ id, source, meta }))));
}

// ---------- worker client with hang watchdog ----------
class SimClient {
  private worker!: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void }>();
  private lastBeat = 0;
  constructor(private hangMs = 30000) {
    this.spawn();
    setInterval(() => {
      if (this.pending.size && performance.now() - this.lastBeat > this.hangMs) {
        this.worker.terminate();
        const err = new Error('simulation hung — a core is probably stuck in an infinite loop');
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.spawn();
      }
    }, 500);
  }
  private spawn() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      this.lastBeat = performance.now();
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') return p.onProgress?.(msg.done, msg.total);
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
  }
  request<T extends WorkerResponse['type']>(req: WithoutId<WorkerRequest>, onProgress?: (d: number, t: number) => void) {
    const id = ++this.seq;
    this.lastBeat = performance.now();
    return new Promise<Extract<WorkerResponse, { type: T }>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: WorkerResponse) => void, reject, onProgress });
      this.worker.postMessage({ ...req, id });
    });
  }
}
const sim = new SimClient();

// ---------- tabs ----------
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab.dataset.view}`));
  }),
);

// ---------- core pickers ----------
const deployPick = new Set<string>(['hunter', 'phantom']);
const tourPick = new Set<string>(BUILTIN_ORDER);
function renderPicker(el: HTMLElement, picked: Set<string>) {
  for (const id of [...picked]) if (!coreById(id)) picked.delete(id);
  el.innerHTML = allCores()
    .map((c) => `<label class="core-item"><input type="checkbox" value="${esc(c.id)}" ${picked.has(c.id) ? 'checked' : ''}/>
      <span class="swatch" style="background:${esc(c.meta.color ?? '#888')};color:${esc(c.meta.color ?? '#888')}"></span>
      ${esc(c.meta.name)}<span class="tag">${c.builtin ? 'BUILTIN' : 'CUSTOM'}</span></label>`)
    .join('');
  el.querySelectorAll<HTMLInputElement>('input').forEach((input) =>
    input.addEventListener('change', () => (input.checked ? picked.add(input.value) : picked.delete(input.value))),
  );
}
function renderPickers() {
  renderPicker($('#deploy-list'), deployPick);
  renderPicker($('#tour-list'), tourPick);
}

// ---------- arena playback ----------
const renderer = new ArenaRenderer($<HTMLCanvasElement>('#arena'));
const play = { replay: null as Replay | null, tick: 0, playing: false, speed: 1, lastInt: 0, cum: [] as { hits: number[]; hurts: number[] }[] };
const leds: { hit: number; hurt: number }[] = [];
const feed: string[] = [];
let ended = false;

function loadReplay(replay: Replay) {
  play.replay = replay;
  play.tick = 0;
  play.lastInt = 0;
  play.playing = true;
  ended = false;
  feed.length = 0;
  renderer.setReplay(replay);
  play.cum = replay.daemons.map((_, id) => {
    const hits: number[] = [];
    const hurts: number[] = [];
    let h = 0;
    let u = 0;
    for (const f of replay.frames) {
      for (const e of f.e) if (e.k === 'hit') { if (e.by === id) h++; if (e.d === id) u++; }
      hits.push(h);
      hurts.push(u);
    }
    return { hits, hurts };
  });
  leds.length = 0;
  replay.daemons.forEach(() => leds.push({ hit: 0, hurt: 0 }));
  const scrub = $<HTMLInputElement>('#scrub');
  scrub.max = String(replay.frames.length - 1);
  $('#scoreboard').innerHTML = replay.daemons
    .map((d) => `<div class="dcard" id="dcard-${d.id}" style="--c:${esc(d.color)}">
      <div class="row"><span class="name">${esc(d.name)}</span><span class="score">0</span></div>
      <div class="bar"><div style="width:100%"></div></div>
      <div class="leds"><span class="led hit">HIT</span><span class="led hurt">HURT</span><span class="led phase">PHASE</span><span class="stats"></span></div>
    </div>`)
    .join('');
  $('#feed').innerHTML = '';
  showBanner(`SEED ${replay.seed}`, replay.daemons.map((d) => d.name).join('  VS  '), '#00f0ff', 1800);
}

let bannerTimer = 0;
function showBanner(title: string, sub: string, color: string, ms = 0) {
  const el = $('#banner');
  el.innerHTML = `${esc(title)}<small>${esc(sub)}</small>`;
  el.style.color = color;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

function pushFeed(t: number, html: string) {
  feed.unshift(`<div><span class="t">${String(t).padStart(4, '0')}</span>${html}</div>`);
  if (feed.length > 60) feed.length = 60;
}

function onFrameEvents(t: number, events: FrameEvent[]) {
  const r = play.replay!;
  const tag = (id: number) => `<b style="color:${esc(r.daemons[id].color)}">${esc(r.daemons[id].name)}</b>`;
  renderer.effects(events);
  for (const e of events) {
    if (e.k === 'hit') {
      leds[e.by].hit = 0.3;
      leds[e.d].hurt = 0.3;
      pushFeed(t, `${tag(e.by)} <span style="color:#f9f871">HIT</span> · ${tag(e.d)} <span style="color:#ff3864">HURT</span>`);
    } else if (e.k === 'evade') pushFeed(t, `${tag(e.d)} evade`);
    else if (e.k === 'dodge') pushFeed(t, `${tag(e.d)} <span style="color:#00f0ff">phased through fire</span>`);
    else if (e.k === 'derez') pushFeed(t, `${tag(e.d)} <span style="color:#ff3864">DEREZZED</span>`);
    else if (e.k === 'fault') pushFeed(t, `${tag(e.d)} <span style="color:#ff3864">FAULT</span> ${esc(e.msg)}`);
  }
}

function updateHud(dt: number) {
  const r = play.replay;
  if (!r) return;
  const i = Math.min(r.frames.length - 1, Math.floor(play.tick));
  const f = r.frames[i];
  r.daemons.forEach((_d, id) => {
    const card = document.getElementById(`dcard-${id}`);
    if (!card) return;
    const fd = f.d[id];
    const score = card.querySelector('.score')!;
    score.textContent = `${fd[4] > 0 ? '+' : ''}${fd[4]}`;
    score.classList.toggle('neg', fd[4] < 0);
    (card.querySelector('.bar > div') as HTMLElement).style.width = `${(fd[3] / r.config.maxIntegrity) * 100}%`;
    card.classList.toggle('dead', !(fd[5] & 1));
    leds[id].hit = Math.max(0, leds[id].hit - dt);
    leds[id].hurt = Math.max(0, leds[id].hurt - dt);
    card.querySelector('.led.hit')!.classList.toggle('on', leds[id].hit > 0);
    card.querySelector('.led.hurt')!.classList.toggle('on', leds[id].hurt > 0);
    card.querySelector('.led.phase')!.classList.toggle('on', (fd[5] & 2) !== 0);
    card.querySelector('.stats')!.textContent = `${play.cum[id].hits[i]}↗ ${play.cum[id].hurts[i]}↘`;
  });
  $('#feed').innerHTML = feed.join('');
  $<HTMLInputElement>('#scrub').value = String(i);
  $('#tick-label').textContent = `T ${String(f.t).padStart(4, '0')} / ${String(r.frames.length - 1).padStart(4, '0')}`;
  $('#play').textContent = play.playing ? '❚❚' : '▶';
}

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const r = play.replay;
  if (r && play.playing) {
    play.tick = Math.min(r.frames.length - 1, play.tick + dt * 60 * play.speed);
    const target = Math.floor(play.tick);
    for (let t = play.lastInt + 1; t <= target; t++) onFrameEvents(t, r.frames[t].e);
    play.lastInt = target;
    if (play.tick >= r.frames.length - 1) {
      play.playing = false;
      if (!ended) {
        ended = true;
        const w = r.result.winner;
        const s = r.result.standings;
        if (w === null) showBanner('DRAW', s.map((x) => `${x.name} ${x.score}`).join('  ·  '), '#f9f871');
        else showBanner(`${r.daemons[w].name} WINS`, s.map((x) => `${x.name} ${x.score >= 0 ? '+' : ''}${x.score}`).join('  ·  '), r.daemons[w].color);
      }
    }
  }
  renderer.render(play.tick, dt);
  updateHud(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function seek(tick: number) {
  if (!play.replay) return;
  play.tick = Math.max(0, Math.min(play.replay.frames.length - 1, tick));
  play.lastInt = Math.floor(play.tick);
  renderer.clearEffects();
  ended = play.tick >= play.replay.frames.length - 1;
  if (!ended) $('#banner').classList.remove('show');
}

$('#play').addEventListener('click', () => togglePlay());
function togglePlay() {
  if (!play.replay) return;
  if (!play.playing && play.tick >= play.replay.frames.length - 1) seek(0);
  play.playing = !play.playing;
}
$('#restart').addEventListener('click', () => {
  seek(0);
  play.playing = true;
});
$('#scrub').addEventListener('input', (e) => seek(Number((e.target as HTMLInputElement).value)));
$('#speed').addEventListener('change', (e) => (play.speed = Number((e.target as HTMLSelectElement).value)));
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'f' || e.key === 'F') renderer.cycleFollow();
  if (e.key === 'ArrowRight') seek(play.tick + 30);
  if (e.key === 'ArrowLeft') seek(play.tick - 30);
});

$('#seed-random').addEventListener('click', () => ($<HTMLInputElement>('#seed').value = String(Math.floor(Math.random() * 1e6))));

async function runMatch() {
  const ids = [...deployPick].filter((id) => coreById(id));
  if (ids.length < 2 || ids.length > 8) return setStatus('SELECT 2–8 CORES', true);
  const btn = $<HTMLButtonElement>('#run-match');
  btn.disabled = true;
  setStatus('SIMULATING…');
  try {
    const seed = Number($<HTMLInputElement>('#seed').value) || 1;
    const maxTicks = Math.max(100, Number($<HTMLInputElement>('#ticks').value) || 3000);
    const res = await sim.request<'match'>({ type: 'match', cores: ids.map((id) => ({ id, source: coreById(id)!.source })), seed, config: { maxTicks } });
    loadReplay(res.replay);
    for (const l of res.logs.slice(-20)) pushFeed(0, `<span class="t">log</span>${esc(res.replay.daemons[l.daemon].name)}: ${esc(l.line)}`);
    setStatus(`MATCH READY · ${res.replay.result.ticks} TICKS`);
  } catch (err) {
    setStatus(`ERROR: ${(err as Error).message}`, true);
  } finally {
    btn.disabled = false;
  }
}
$('#run-match').addEventListener('click', runMatch);
$('#replay-save').addEventListener('click', () => play.replay && download(`daemon-arena-seed${play.replay.seed}.replay.json`, JSON.stringify(play.replay)));
$<HTMLInputElement>('#replay-load').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const replay = JSON.parse(await file.text()) as Replay;
    if (replay.format !== 'daemon-arena-replay') throw new Error('not a daemon-arena replay');
    loadReplay(replay);
    setStatus(`REPLAY LOADED · ${file.name}`);
  } catch (err) {
    setStatus(`ERROR: ${(err as Error).message}`, true);
  }
  (e.target as HTMLInputElement).value = '';
});

// ---------- tournament ----------
let lastTour: TournamentResult | null = null;
function heat(v: number | null, kind: 'score' | 'rate' | 'hits', scale: number): string {
  if (v === null) return '';
  if (kind === 'rate') {
    const d = (v - 0.5) * 2;
    return d >= 0 ? `background:rgba(0,240,255,${0.08 + d * 0.5})` : `background:rgba(255,56,100,${0.08 - d * 0.5})`;
  }
  if (kind === 'hits') return `background:rgba(255,43,214,${0.06 + (v / (scale || 1)) * 0.55})`;
  const d = v / (scale || 1);
  return d >= 0 ? `background:rgba(0,240,255,${0.08 + d * 0.55})` : `background:rgba(255,56,100,${0.08 - d * 0.55})`;
}
function matrixTable(title: string, names: string[], m: (number | null)[][], kind: 'score' | 'rate' | 'hits') {
  if (!m.length) return '';
  const scale = Math.max(...m.flat().map((v) => Math.abs(v ?? 0)), 1e-9);
  const fmt = (v: number) => (kind === 'rate' ? `${Math.round(v * 100)}%` : String(Math.round(v * 10) / 10));
  return `<div><h3>${title}</h3><table class="matrix"><tr><th class="name">row vs col</th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr>
    ${m.map((row, i) => `<tr><td class="name">${esc(names[i])}</td>${row.map((v) => (v === null ? '<td class="diag">—</td>' : `<td style="${heat(v, kind, scale)}">${fmt(v)}</td>`)).join('')}</tr>`).join('')}
  </table></div>`;
}
function renderTournament(t: TournamentResult) {
  const names = t.cores.map((c) => c.name);
  const cols = ['rank', 'name', 'meanScore', 'winRate', 'wins', 'losses', 'draws', 'hits', 'hurts', 'accuracy', 'evades', 'dodges', 'derezzed', 'faults'] as const;
  $('#tour-results').innerHTML = `
    <h2>// LEADERBOARD · ${t.mode.toUpperCase()} · ${t.rounds} ROUNDS · SEED ${t.baseSeed}</h2>
    <table><tr>${cols.map((c) => `<th class="${c === 'name' ? 'name' : ''}">${c}</th>`).join('')}</tr>
    ${t.leaderboard.map((r) => `<tr class="${r.rank === 1 ? 'first' : ''}">${cols.map((c) => `<td class="${c === 'name' ? 'name' : ''}">${c === 'winRate' || c === 'accuracy' ? `${Math.round(r[c] * 1000) / 10}%` : esc(String(r[c]))}</td>`).join('')}</tr>`).join('')}
    </table>
    <div class="matrices">
      ${matrixTable('SCORE MATRIX · mean score', names, t.matrix.score, 'score')}
      ${matrixTable('WIN-RATE MATRIX', names, t.matrix.winRate, 'rate')}
      ${matrixTable('HIT MATRIX · mean hits landed', names, t.matrix.hits, 'hits')}
    </div>`;
}
$('#run-tour').addEventListener('click', async () => {
  const ids = [...tourPick].filter((id) => coreById(id));
  const mode = $<HTMLSelectElement>('#tour-mode').value as 'duel' | 'ffa';
  if (ids.length < 2 || (mode === 'ffa' && ids.length > 8)) return setStatus(mode === 'ffa' ? 'FFA NEEDS 2–8 CORES' : 'SELECT AT LEAST 2 CORES', true);
  const btn = $<HTMLButtonElement>('#run-tour');
  btn.disabled = true;
  setStatus('TOURNAMENT RUNNING…');
  const bar = $('#tour-progress');
  bar.style.width = '0';
  try {
    const res = await sim.request<'tournament'>(
      {
        type: 'tournament',
        cores: ids.map((id) => ({ id, source: coreById(id)!.source })),
        rounds: Math.max(1, Math.min(200, Number($<HTMLInputElement>('#tour-rounds').value) || 10)),
        seed: Number($<HTMLInputElement>('#tour-seed').value) || 1,
        mode,
        config: {},
      },
      (done, total) => (bar.style.width = `${(done / total) * 100}%`),
    );
    lastTour = res.result;
    renderTournament(res.result);
    setStatus('TOURNAMENT COMPLETE');
  } catch (err) {
    setStatus(`ERROR: ${(err as Error).message}`, true);
  } finally {
    btn.disabled = false;
  }
});
$('#tour-export').addEventListener('click', () => lastTour && download('daemon-arena-tournament.json', JSON.stringify(lastTour, null, 2)));

// ---------- core vault ----------
const TEMPLATE = coreTemplate.replace('__NAME__', 'NEWCORE');
let editing: string | null = null;
const editor = $<HTMLTextAreaElement>('#core-editor');
function coreMsg(text: string, err = false) {
  const el = $('#core-msg');
  el.textContent = text;
  el.classList.toggle('err', err);
}
function renderVault() {
  $('#vault-list').innerHTML = allCores()
    .map((c) => `<div class="vault-item ${c.id === editing ? 'active' : ''}" data-id="${esc(c.id)}">
      <span style="color:${esc(c.meta.color ?? '#ccc')}">${esc(c.meta.name)}</span><small>${c.builtin ? 'builtin' : esc(c.meta.author ?? 'custom')}</small></div>`)
    .join('');
  $('#vault-list').querySelectorAll<HTMLElement>('.vault-item').forEach((el) => el.addEventListener('click', () => openCore(el.dataset.id!)));
}
function openCore(id: string | null) {
  editing = id;
  const c = id ? coreById(id) : null;
  editor.value = c ? c.source : TEMPLATE;
  $('#editor-title').textContent = c ? `// ${c.meta.name}${c.builtin ? ' (builtin · save creates a copy)' : ''}` : '// NEW CORE';
  $<HTMLButtonElement>('#core-delete').disabled = !c || c.builtin;
  coreMsg(c?.meta.description ?? '');
  renderVault();
}
async function validate(source: string): Promise<CoreMeta> {
  const res = await sim.request<'validate'>({ type: 'validate', source });
  return res.meta;
}
function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'core';
}
async function storeCore(source: string, existing: string | null): Promise<StoredCore> {
  const meta = await validate(source);
  const current = existing ? custom.find((c) => c.id === existing) : undefined;
  let id = current?.id ?? `custom-${slug(meta.name)}`;
  if (!current) {
    let n = 2;
    const base = id;
    while (coreById(id)) id = `${base}-${n++}`;
  }
  const core: StoredCore = { id, source, meta, builtin: false };
  custom = current ? custom.map((c) => (c.id === id ? core : c)) : [...custom, core];
  saveCustom();
  renderPickers();
  return core;
}
$('#core-new').addEventListener('click', () => openCore(null));
$('#core-validate').addEventListener('click', async () => {
  try {
    const meta = await validate(editor.value);
    coreMsg(`VALID · ${meta.name}${meta.author ? ` by ${meta.author}` : ''}`);
  } catch (err) {
    coreMsg((err as Error).message, true);
  }
});
$('#core-save').addEventListener('click', async () => {
  try {
    const existing = editing && !coreById(editing)?.builtin ? editing : null;
    const core = await storeCore(editor.value, existing);
    openCore(core.id);
    coreMsg(`SAVED · ${core.meta.name} is ready to deploy`);
  } catch (err) {
    coreMsg((err as Error).message, true);
  }
});
$('#core-download').addEventListener('click', () => {
  const c = editing ? coreById(editing) : null;
  download(`${c ? c.id.replace(/^custom-/, '') : 'core'}.js`, editor.value, 'text/javascript');
});
$('#core-delete').addEventListener('click', () => {
  if (!editing || coreById(editing)?.builtin) return;
  custom = custom.filter((c) => c.id !== editing);
  saveCustom();
  renderPickers();
  openCore(null);
});
$<HTMLInputElement>('#core-upload').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  let lastId: string | null = null;
  for (const file of files) {
    try {
      lastId = (await storeCore(await file.text(), null)).id;
    } catch (err) {
      coreMsg(`${file.name}: ${(err as Error).message}`, true);
    }
  }
  if (lastId) {
    openCore(lastId);
    coreMsg(`UPLOADED ${files.length} core(s)`);
  }
  (e.target as HTMLInputElement).value = '';
});

// ---------- boot ----------
$('#protocol').innerHTML = PROTOCOL_HTML;
renderPickers();
openCore('hunter');
runMatch();
