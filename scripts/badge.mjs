// Writes a flat shields-style SVG badge: node scripts/badge.mjs <label> <message> <color> <out.svg>
import { writeFileSync } from 'node:fs';

const [label, message, color, out] = process.argv.slice(2);
const w = (t) => Math.round(t.length * 6.6 + 12);
const [lw, mw] = [w(label), w(message)];
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
writeFileSync(
  out,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + mw}" height="20" role="img" aria-label="${esc(label)}: ${esc(message)}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${lw + mw}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${lw + mw}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>
`,
);
