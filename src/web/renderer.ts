import type { Frame, FrameEvent, FrameProjectile, Replay } from '../engine/types';

interface Particle {
  kind: 'spark' | 'ring' | 'text' | 'ghost' | 'flash';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  text?: string;
  h?: number;
}

const TRAIL = 24;
const FLAG_ALIVE = 1;
const FLAG_PHASE = 2;
const FLAG_MOVING = 4;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function alpha(hex: string, a: number): string {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Top-down orthographic cyberpunk renderer for replays. Draws in world units. */
export class ArenaRenderer {
  private ctx: CanvasRenderingContext2D;
  private replay: Replay | null = null;
  private particles: Particle[] = [];
  private shake = 0;
  private time = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  cam = { x: 400, y: 400, zoom: 1 };
  private userCam = false;
  follow: number | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.installControls();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setReplay(replay: Replay | null) {
    this.replay = replay;
    this.particles = [];
    this.follow = null;
    if (!this.userCam) this.fit();
  }

  clearEffects() {
    this.particles = [];
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    if (!this.userCam) this.fit();
  }

  fit() {
    const aw = this.replay?.config.width ?? 1000;
    const ah = this.replay?.config.height ?? 1000;
    this.cam.x = aw / 2;
    this.cam.y = ah / 2;
    this.cam.zoom = Math.min(this.w / (aw + 80), (this.h - 50) / (ah + 80));
    this.userCam = false;
  }

  cycleFollow() {
    if (!this.replay) return;
    const n = this.replay.daemons.length;
    this.follow = this.follow === null ? 0 : this.follow + 1 >= n ? null : this.follow + 1;
    if (this.follow === null) this.fit();
    else this.userCam = true;
  }

  private installControls() {
    const c = this.canvas;
    let drag: { x: number; y: number; cx: number; cy: number } | null = null;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - this.w / 2) / this.cam.zoom + this.cam.x;
      const wy = (my - this.h / 2) / this.cam.zoom + this.cam.y;
      const z = Math.min(6, Math.max(0.2, this.cam.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.cam.zoom = z;
      this.cam.x = wx - (mx - this.w / 2) / z;
      this.cam.y = wy - (my - this.h / 2) / z;
      this.userCam = true;
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.cam.x = drag.cx - (e.clientX - drag.x) / this.cam.zoom;
      this.cam.y = drag.cy - (e.clientY - drag.y) / this.cam.zoom;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) {
        this.userCam = true;
        this.follow = null;
      }
    });
    const end = () => {
      drag = null;
      c.classList.remove('dragging');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => {
      this.follow = null;
      this.fit();
    });
  }

  /** Spawn visual effects for events that happened on a frame reached during forward playback. */
  effects(events: FrameEvent[]) {
    if (!this.replay) return;
    const color = (id: number) => this.replay!.daemons[id]?.color ?? '#ffffff';
    for (const e of events) {
      switch (e.k) {
        case 'fire':
          this.particles.push({ kind: 'flash', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.12, max: 0.12, color: color(e.d), size: 14, h: e.h });
          break;
        case 'hit': {
          const c = color(e.by);
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 60 + Math.random() * 260;
            this.particles.push({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, color: i % 3 ? c : '#ffffff', size: 2 + Math.random() * 2 });
          }
          this.particles.push({ kind: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.45, max: 0.45, color: c, size: 46 });
          this.particles.push({ kind: 'text', x: e.x, y: e.y - 20, vx: 0, vy: -40, life: 0.9, max: 0.9, color: '#ff3864', size: 15, text: `-${this.replay.config.hitDamage}` });
          this.shake = Math.min(this.shake + 5, 12);
          break;
        }
        case 'dodge':
          this.particles.push({ kind: 'text', x: e.x, y: e.y - 16, vx: 0, vy: -30, life: 0.8, max: 0.8, color: '#00f0ff', size: 12, text: 'PHASED' });
          break;
        case 'evade': {
          const f = this.currentDaemon(e.d);
          if (f) {
            for (let i = 0; i < 5; i++) {
              this.particles.push({ kind: 'ghost', x: f[0] + Math.cos(e.h) * i * 12, y: f[1] + Math.sin(e.h) * i * 12, vx: 0, vy: 0, life: 0.25 + i * 0.07, max: 0.25 + i * 0.07, color: color(e.d), size: this.replay.config.daemonRadius, h: f[2] });
            }
          }
          break;
        }
        case 'wall':
          this.particles.push({ kind: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#ffffff', size: 22 });
          break;
        case 'derez': {
          const c = color(e.d);
          for (let i = 0; i < 70; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 40 + Math.random() * 420;
            this.particles.push({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.2, max: 1.2, color: i % 4 ? c : '#ffffff', size: 2 + Math.random() * 3 });
          }
          this.particles.push({ kind: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.9, max: 0.9, color: c, size: 160 });
          this.particles.push({ kind: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.6, max: 0.6, color: '#ffffff', size: 90 });
          this.particles.push({ kind: 'text', x: e.x, y: e.y - 34, vx: 0, vy: -18, life: 2, max: 2, color: c, size: 20, text: 'DEREZZED' });
          this.shake = 22;
          break;
        }
        default:
          break;
      }
    }
  }

  private lastFrames: { a: Frame; b: Frame; t: number } | null = null;
  private currentDaemon(id: number) {
    return this.lastFrames?.a.d[id];
  }

  render(tick: number, dt: number) {
    const { ctx } = this;
    this.time += dt;
    const replay = this.replay;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#020008';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let a: Frame | null = null;
    let b: Frame | null = null;
    let t = 0;
    if (replay && replay.frames.length) {
      const max = replay.frames.length - 1;
      const i = Math.max(0, Math.min(max, Math.floor(tick)));
      a = replay.frames[i];
      b = replay.frames[Math.min(max, i + 1)];
      t = Math.max(0, Math.min(1, tick - i));
      this.lastFrames = { a, b, t };
      if (this.follow !== null) {
        const d = a.d[this.follow];
        if (d) {
          this.cam.x = lerp(this.cam.x, d[0], 0.12);
          this.cam.y = lerp(this.cam.y, d[1], 0.12);
          this.cam.zoom = lerp(this.cam.zoom, Math.max(this.cam.zoom, 1.6), 0.05);
        }
      }
    }

    this.shake *= Math.pow(0.02, dt);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const z = this.cam.zoom;
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.w / 2 - this.cam.x * z + sx), this.dpr * (this.h / 2 - this.cam.y * z + sy));

    const aw = replay?.config.width ?? 1000;
    const ah = replay?.config.height ?? 1000;
    this.drawFloor(aw, ah);

    if (replay && a && b) {
      ctx.globalCompositeOperation = 'lighter';
      this.drawTrails(replay, tick);
      this.drawProjectiles(replay, a.p, b.p, t);
      ctx.globalCompositeOperation = 'source-over';
      replay.daemons.forEach((info, id) => {
        const da = a!.d[id];
        const db = b!.d[id];
        if (!da) return;
        const x = lerp(da[0], db[0], t);
        const y = lerp(da[1], db[1], t);
        const h = lerpAngle(da[2], db[2], t);
        this.drawDaemon(info.name, info.color, x, y, h, da[3], da[4], da[5], replay.config.daemonRadius, replay.config.maxIntegrity);
      });
    }
    this.drawParticles(dt);
  }

  private glowLine(width: number, color: string, passes = 3) {
    const { ctx } = this;
    for (let i = passes; i >= 1; i--) {
      ctx.lineWidth = width * (i === 1 ? 1 : i * 2.2);
      ctx.strokeStyle = i === 1 ? color : alpha(color, 0.12);
      ctx.stroke();
    }
  }

  private drawFloor(aw: number, ah: number) {
    const { ctx } = this;
    const z = this.cam.zoom;
    ctx.fillStyle = '#06021a';
    ctx.fillRect(0, 0, aw, ah);
    const grad = ctx.createRadialGradient(aw / 2, ah / 2, 0, aw / 2, ah / 2, Math.max(aw, ah) * 0.75);
    grad.addColorStop(0, 'rgba(120, 20, 160, 0.20)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, aw, ah);

    ctx.beginPath();
    for (let x = 0; x <= aw; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, ah); }
    for (let y = 0; y <= ah; y += 50) { ctx.moveTo(0, y); ctx.lineTo(aw, y); }
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.07)';
    ctx.stroke();
    ctx.beginPath();
    for (let x = 0; x <= aw; x += 250) { ctx.moveTo(x, 0); ctx.lineTo(x, ah); }
    for (let y = 0; y <= ah; y += 250) { ctx.moveTo(0, y); ctx.lineTo(aw, y); }
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.16)';
    ctx.stroke();

    // Pulse sweep line.
    const sweep = ((this.time * 120) % (ah + 200)) - 100;
    const sg = ctx.createLinearGradient(0, sweep - 60, 0, sweep);
    sg.addColorStop(0, 'rgba(0, 240, 255, 0)');
    sg.addColorStop(1, 'rgba(0, 240, 255, 0.06)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, Math.max(0, sweep - 60), aw, Math.min(60, Math.max(0, ah - sweep + 60)));

    ctx.beginPath();
    ctx.arc(aw / 2, ah / 2, Math.min(aw, ah) * 0.18, 0, Math.PI * 2);
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
    ctx.setLineDash([8, 10]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.rect(0, 0, aw, ah);
    this.glowLine(2.2 / Math.max(z, 0.5), '#00f0ff');
    const k = 60;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[0, 0, 1, 1], [aw, 0, -1, 1], [0, ah, 1, -1], [aw, ah, -1, -1]]) {
      ctx.moveTo(cx - dx * 10 + dx * k, cy - dy * 10);
      ctx.lineTo(cx - dx * 10, cy - dy * 10);
      ctx.lineTo(cx - dx * 10, cy - dy * 10 + dy * k);
    }
    this.glowLine(3 / Math.max(z, 0.5), '#ff2bd6');
    ctx.globalCompositeOperation = 'source-over';

    ctx.font = `14px 'Share Tech Mono', monospace`;
    ctx.fillStyle = 'rgba(255, 43, 214, 0.55)';
    ctx.fillText('SECTOR 07 // NEON GRID', 4, -18);
    ctx.textAlign = 'right';
    ctx.fillText(`${aw}×${ah}u`, aw - 4, -18);
    ctx.textAlign = 'left';
  }

  private drawTrails(replay: Replay, tick: number) {
    const { ctx } = this;
    const i = Math.floor(tick);
    replay.daemons.forEach((info, id) => {
      const start = Math.max(0, i - TRAIL);
      for (let k = start + 1; k <= i && k < replay.frames.length; k++) {
        const p0 = replay.frames[k - 1].d[id];
        const p1 = replay.frames[k].d[id];
        if (!(p1[5] & FLAG_ALIVE)) continue;
        const f = (k - start) / (i - start + 1);
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineWidth = 6 * f;
        ctx.strokeStyle = alpha(info.color, 0.22 * f);
        ctx.stroke();
      }
    });
  }

  private drawProjectiles(replay: Replay, pa: FrameProjectile[], pb: FrameProjectile[], t: number) {
    const { ctx } = this;
    const speed = replay.config.projectileSpeed;
    const used = new Set<number>();
    for (const p of pa) {
      let bestIdx = -1;
      let best = speed * 1.6;
      pb.forEach((q, qi) => {
        if (used.has(qi) || q[2] !== p[2]) return;
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < best) { best = d; bestIdx = qi; }
      });
      if (bestIdx >= 0) used.add(bestIdx);
      const m = bestIdx >= 0 ? pb[bestIdx] : null;
      const x = m ? lerp(p[0], m[0], t) : p[0];
      const y = m ? lerp(p[1], m[1], t) : p[1];
      const dx = m ? m[0] - p[0] : 0;
      const dy = m ? m[1] - p[1] : 0;
      const color = replay.daemons[p[2]]?.color ?? '#fff';
      ctx.beginPath();
      ctx.moveTo(x - dx * 2.2, y - dy * 2.2);
      ctx.lineTo(x, y);
      ctx.lineCap = 'round';
      this.glowLine(3, color, 3);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineCap = 'butt';
    }
  }

  private drawDaemon(name: string, color: string, x: number, y: number, h: number, integrity: number, score: number, flags: number, r: number, maxIntegrity: number) {
    const { ctx } = this;
    const alive = (flags & FLAG_ALIVE) !== 0;
    const phasing = (flags & FLAG_PHASE) !== 0;
    const moving = (flags & FLAG_MOVING) !== 0;
    ctx.save();
    ctx.translate(x, y);

    if (!alive) {
      ctx.globalAlpha = 0.35;
      ctx.rotate(h);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2;
        const a1 = a0 + Math.PI / 6;
        ctx.moveTo(Math.cos(a0) * r * 1.1, Math.sin(a0) * r * 1.1);
        ctx.lineTo(Math.cos(a1) * r * 0.9, Math.sin(a1) * r * 0.9);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Integrity ring.
    const frac = integrity / maxIntegrity;
    ctx.beginPath();
    ctx.arc(0, 0, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = frac > 0.5 ? alpha(color, 0.85) : frac > 0.25 ? '#f9f871' : '#ff3864';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();

    ctx.rotate(h);
    if (moving) {
      const flick = 0.7 + Math.random() * 0.5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.35);
      ctx.lineTo(-r * (1.5 + flick * 0.6), 0);
      ctx.lineTo(-r * 0.7, r * 0.35);
      ctx.closePath();
      ctx.fillStyle = alpha(color, 0.35);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    const body = (ox: number, stroke: string, fill: string | null, lw: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const rr = i === 0 || i === 5 ? r * 1.15 : r;
        const px = Math.cos(a) * rr + ox;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };

    if (phasing) {
      ctx.globalCompositeOperation = 'lighter';
      const j = 3 + Math.random() * 3;
      body(-j, 'rgba(255,43,214,0.7)', null, 1.5);
      body(j, 'rgba(0,240,255,0.7)', null, 1.5);
      ctx.setLineDash([4, 4]);
      body(0, alpha(color, 0.9), null, 1.5);
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.globalCompositeOperation = 'lighter';
      body(0, alpha(color, 0.15), null, 9);
      ctx.globalCompositeOperation = 'source-over';
      body(0, color, 'rgba(6, 2, 20, 0.92)', 2);
      // Internal circuitry.
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.5);
      ctx.lineTo(-r * 0.15, -r * 0.5);
      ctx.lineTo(r * 0.1, -r * 0.2);
      ctx.moveTo(-r * 0.55, r * 0.5);
      ctx.lineTo(-r * 0.15, r * 0.5);
      ctx.lineTo(r * 0.1, r * 0.2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = alpha(color, 0.5);
      ctx.stroke();
    }

    // Core.
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 6 + x * 0.01);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.8);
    g.addColorStop(0, alpha('#ffffff', 0.9 * pulse));
    g.addColorStop(0.35, alpha(color, 0.8 * pulse));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    // Visor.
    ctx.beginPath();
    ctx.moveTo(r * 0.55, -r * 0.45);
    ctx.lineTo(r * 1.05, 0);
    ctx.lineTo(r * 0.55, r * 0.45);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Label in screen-stable size.
    const z = this.cam.zoom;
    const fs = 12 / Math.max(z, 0.6);
    ctx.font = `${fs}px 'Share Tech Mono', monospace`;
    ctx.textAlign = 'center';
    const label = `${name}  ${score >= 0 ? '+' : ''}${score}`;
    const tw = ctx.measureText(label).width;
    const ly = y - r - 18;
    ctx.fillStyle = 'rgba(5, 1, 13, 0.75)';
    ctx.fillRect(x - tw / 2 - 4 / z, ly - fs, tw + 8 / z, fs + 4 / z);
    ctx.fillStyle = color;
    ctx.fillText(label, x, ly);
    ctx.textAlign = 'left';
  }

  private drawParticles(dt: number) {
    const { ctx } = this;
    const live: Particle[] = [];
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      live.push(p);
      const k = p.life / p.max;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.05, dt);
      p.vy *= p.kind === 'text' ? 1 : Math.pow(0.05, dt);
      switch (p.kind) {
        case 'spark':
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.lineWidth = p.size;
          ctx.strokeStyle = alpha(p.color, k);
          ctx.stroke();
          break;
        case 'ring':
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * k), 0, Math.PI * 2);
          ctx.lineWidth = 3 * k + 0.5;
          ctx.strokeStyle = alpha(p.color, k);
          ctx.stroke();
          break;
        case 'flash':
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2);
          ctx.fillStyle = alpha(p.color, 0.6 * k);
          ctx.fill();
          break;
        case 'ghost':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.h ?? 0);
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            ctx.lineTo(Math.cos(a) * p.size, Math.sin(a) * p.size);
          }
          ctx.closePath();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = alpha(p.color, 0.5 * k);
          ctx.stroke();
          ctx.restore();
          break;
        case 'text':
          ctx.font = `bold ${p.size / Math.max(this.cam.zoom, 0.6)}px 'Orbitron', monospace`;
          ctx.textAlign = 'center';
          ctx.fillStyle = alpha(p.color, Math.min(1, k * 1.5));
          ctx.fillText(p.text ?? '', p.x + (Math.random() < 0.1 ? (Math.random() - 0.5) * 6 : 0), p.y);
          ctx.textAlign = 'left';
          break;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    this.particles = live;
  }
}
