export const TAU = Math.PI * 2;

export function normalizeAngle(a: number): number {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  if (a > Math.PI) a -= TAU;
  return a;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Does segment (x1,y1)->(x2,y2) pass within r of (cx,cy)? */
export function segmentHitsCircle(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, r: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = x1 + t * dx - cx;
  const py = y1 + t * dy - cy;
  return px * px + py * py <= r * r;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
