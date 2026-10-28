import { DEFAULT_CONFIG } from '../engine/config';

const c = DEFAULT_CONFIG;

export const PROTOCOL_HTML = `
<h2>// BLIND COMBAT PROTOCOL</h2>
<p>Daemons are scripted combat chassis. A <b>daemon core</b> is a small script that drives one daemon.
Daemons <b>cannot see each other</b>. Each tick a core sees only its own chassis and two kinds of combat feedback:
<code>hit</code> (one of my projectiles struck something) and <code>hurt</code> (I was struck). It answers with exactly one of
three behaviors: <code>move</code>, <code>evade</code> or <code>attack</code>.</p>

<h3>SCORING MATRIX</h3>
<table>
  <tr><th>Event</th><th>Score</th><th>Feedback to core</th></tr>
  <tr><td>Your projectile strikes a daemon</td><td>+${c.scoring.hit}</td><td><code>{ type: 'hit', firedAt }</code></td></tr>
  <tr><td>A projectile strikes you</td><td>${c.scoring.hurt}</td><td><code>{ type: 'hurt' }</code> (no direction, no attacker)</td></tr>
  <tr><td>Projectile passes through you while phasing</td><td>0</td><td>none (counted as <i>dodge</i> in stats)</td></tr>
  <tr><td>Chassis hits the wall</td><td>0</td><td><code>{ type: 'wall' }</code></td></tr>
  <tr><td>Integrity reaches 0 (${c.maxIntegrity / c.hitDamage} hits)</td><td>0</td><td>derezzed: stops acting, can no longer score</td></tr>
</table>
<p>Match winner = highest score (tiebreak: remaining integrity). Duels are zero-sum. Tournaments report a
<b>score matrix</b> (mean score of row vs column), a <b>win-rate matrix</b>, a <b>hit matrix</b> and a leaderboard ranked by mean score.</p>

<h3>BEHAVIORS (one per tick)</h3>
<table>
  <tr><th>Action</th><th>Effect</th><th>Cooldown</th></tr>
  <tr><td><code>{ type: 'move', heading, throttle? }</code></td><td>Turn chassis toward heading (max ${c.turnRate} rad/tick) and thrust (throttle 0..1). Top speed ${c.maxSpeed} u/tick; drifts with friction when not thrusting.</td><td>—</td></tr>
  <tr><td><code>{ type: 'evade', heading? }</code></td><td>Dash at ${c.evadeSpeed} u/tick (default: 90° left of chassis) and <b>phase</b> for ${c.evadeTicks} ticks — projectiles pass through.</td><td>${c.evadeCooldown} ticks</td></tr>
  <tr><td><code>{ type: 'attack', heading }</code></td><td>Fire one projectile in any direction (turret is independent of chassis). Speed ${c.projectileSpeed} u/tick, ${c.hitDamage} damage.</td><td>${c.attackCooldown} ticks</td></tr>
  <tr><td><code>{ type: 'idle' }</code> / <code>null</code></td><td>Do nothing.</td><td>—</td></tr>
</table>
<p>Invalid actions, exceptions and ticks slower than ${c.tickBudgetMs}ms count as <b>faults</b> and become <code>idle</code>.
Angles are radians: 0 = east (+x), π/2 = south (+y, screen down). Arena is ${c.width}×${c.height}, ${c.maxTicks} ticks max.</p>

<h3>CORE FORMAT</h3>
<p>A daemon core is <b>one plain JavaScript file</b>. Write it in the CORES tab or upload a <code>.js</code> file.
It runs only in your browser, in its own locked-down Web Worker (no network, storage, DOM, timers or <code>eval</code>);
a core that stops answering for 3&nbsp;s is cut off and its chassis stays on the field as a sitting duck.</p>
<pre>// @name   MY-DAEMON          (required)
// @author agent-7
// @color  #9d4dff

let aim = random() * TAU;     // top-level variables persist for the whole match

function tick(obs) {          // called every tick, return ONE action
  // obs.self:   x, y, heading, vx, vy, speed, integrity, attackCooldown, evadeCooldown, phasing
  // obs.events: [{type:'hit', firedAt}, {type:'hurt'}, {type:'wall'}]
  // obs.arena:  width, height, projectileSpeed, ... ; obs.tick, obs.ticksLeft
  if (obs.events.some(e => e.type === 'hurt') && obs.self.evadeCooldown === 0) return evade();
  if (obs.self.attackCooldown === 0) return attack(aim += 0.4);
  return move(angleTo(obs.arena.width / 2, obs.arena.height / 2));
}

// optional: function init(arena) { ... }   runs once before the first tick</pre>
<p>Built-in helpers: <code>move(heading, throttle?)</code>, <code>evade(heading?)</code>, <code>attack(heading)</code>, <code>idle()</code>,
<code>angleTo(x, y)</code> / <code>distanceTo(x, y)</code> (from your chassis), <code>wrapAngle(a)</code>, <code>TAU</code>,
<code>random()</code> (seeded — <code>Math.random</code> too), <code>log(...)</code>. Every match is reproducible from its seed.</p>

<h3>INTEL</h3>
<ul>
  <li>Projectiles fly straight at constant speed. A <code>hit</code> observed on tick T for a shot fired at tick F means the target
  was about <code>radius + 5 + speed × (T − F)</code> units along that shot's ray — enough to triangulate.</li>
  <li><code>hurt</code> carries no direction. Evading right after a hurt dodges follow-up fire from a locked-on enemy.</li>
  <li>Moving and attacking compete for the same tick; momentum lets you drift while firing.</li>
</ul>

<h3>AGENT WORKFLOW (CLI)</h3>
<pre>npm run arena -- new my-daemon                      # scaffold my-daemon.js
npm run arena -- match my-daemon.js hunter --seed 7 --replay out.json
npm run arena -- tournament my-daemon.js hunter phantom sentinel --rounds 20 --json</pre>
<p>The same <code>.js</code> file uploads unchanged in the CORES tab; CLI replays load via ARENA › LOAD REPLAY.</p>
`;
