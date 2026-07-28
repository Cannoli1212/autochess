// motion.js — THE WALK. Render only.
//
// The engine moves units one whole square per tick and always has. This file does not
// change that by a single line: unit.x and unit.y stay whole numbers, and pathing, traps,
// ranges, blocking and the balance sims all read exactly what they read before.
//
// What it adds is a SECOND position — where the unit is DRAWN — which slides from the old
// square to the new one across the tick instead of jumping. The board is still the truth;
// this is just the picture taking its time to catch up.
//
//     LOGIC    unit.x = 3, unit.y = 5        whole numbers. The engine's truth.
//     RENDER   drawn at 3.42, 4.87           slides toward the logic square.
//
// This is also, for what it's worth, how the big autobattlers do it. Their units sit on one
// tile at a time and block each other exactly like ours; what makes them look fluid is that
// the tile a unit OCCUPIES and the pixel it is DRAWN at are two different numbers. Walking
// is a drawing job, not a simulation one.
//
// Depends on: config (COMBAT_TICK_MS / REPLAY_TICK_MS), state (SIM_MODE / inCombat /
// replaying), board (gridToPx, the unit shapes). Loaded after board.js.

// One record per unit, keyed by uid (see state.js), holding everything the animation needs
// between frames: which shape to move, which square we last DREW it on, the route it's
// walking, when that walk started, and where it currently is in pixels.
//
// `cell` is deliberately "where the picture is", not "where the engine says it is" — the
// gap between those two is exactly what a walk is.
const MOTION = {};

// The handle for the running animation loop, or null when nothing is moving. Nothing is a
// bigger waste than an animation loop spinning sixty times a second over a board where
// every unit is standing still, so the loop stops itself the moment the last unit arrives.
let motionRaf = null;

// Should a change of square be WALKED, or just applied? Walked during a fight or a replay;
// applied instantly the rest of the time — dragging a unit during placement should snap to
// where you dropped it, not glide there, and a headless sim has no screen at all.
function motionActive() {
  return !SIM_MODE && (inCombat || replaying);
}

// How long does one tick last right now? A live fight runs at COMBAT_TICK_MS and a replay
// tab at the brisker REPLAY_TICK_MS, and a walk should fill whichever is playing — that's
// what keeps a replayed fight looking like the fight, only faster. Read fresh at the start
// of every walk, so switching between the two needs no other plumbing.
function motionTickMs() {
  return replaying ? REPLAY_TICK_MS : COMBAT_TICK_MS;
}

// ── STARTING A WALK ──────────────────────────────────────────────────────────
//
// Called once per unit per tick, from renderUnits(). Compares where we last DREW this unit
// against where the engine now says it is, and if they differ, sets off a walk.
function motionCommit(u, node) {
  let m = MOTION[u.uid];
  if (!m) m = MOTION[u.uid] = { cell: null, px: 0, py: 0 };
  m.node = node;
  m.body = node._body;

  const target = gridToPx(u.x, u.y);
  if (!target) return;                    // board not measurable yet

  // Not walking: either nothing is moving on screen, or this is the first time we've ever
  // drawn this unit and it has nowhere to walk FROM. Put it on its square, now.
  if (!motionActive() || m.cell === null) {
    m.cell = { x: u.x, y: u.y };
    m.pts = null;
    m.vout = { x: 0, y: 0 };            // it isn't travelling, so it carries no momentum
    m.px = target.left; m.py = target.top;
    motionWrite(m);
    return;
  }

  // Standing still. Leave it exactly where it is — and clear any finished route so the
  // loop stops counting it as moving. Momentum goes too: a unit that stopped for a tick to
  // swing has genuinely stopped, and should set off fresh rather than leaning into a corner
  // it was rounding several seconds ago.
  if (m.cell.x === u.x && m.cell.y === u.y) {
    m.pts = null;
    m.vout = { x: 0, y: 0 };
    return;
  }

  // It moved. Work out the ROUTE it took, then walk it over the length of one tick.
  //
  // Usually that's just "from the old square to the new one". But a unit with the rank-4
  // Kill Dash crosses two or three squares in a single tick, walking AROUND bodies as it
  // goes, and a straight line from start to finish would cut clean through them. combat.js
  // writes down the squares it actually crossed (see noteStep); use them when they're there.
  //
  // Checked rather than trusted: the recorded route has to start where we last drew this
  // unit and end where the engine says it is now. Anything else — a route left over from a
  // fight two rounds ago, a unit whose picture we lost track of — falls back to the straight
  // line. That check is also what let the plain walk ship a slice before this existed.
  let cells = [m.cell, { x: u.x, y: u.y }];
  const rec = u.stepPath;
  if (rec && rec.length > 1 &&
      rec[0].x === m.cell.x && rec[0].y === m.cell.y &&
      rec[rec.length - 1].x === u.x && rec[rec.length - 1].y === u.y) {
    cells = rec;
  }
  m.pts = cells.map(function (c) {
    const p = gridToPx(c.x, c.y);
    return { x: p.left, y: p.top };
  });
  m.n = m.pts.length - 1;
  m.dur = motionTickMs();

  // THE CORNER. Carry over the speed and direction the unit FINISHED its last walk with, so
  // this walk starts off heading the way it was already going instead of snapping onto a new
  // heading. That is what turns a diagonal staircase into one flowing curve rather than a
  // zigzag of hard right-angles. See motionSample for the shape it produces.
  //
  // Stored as pixels-per-millisecond rather than pixels-per-leg, because the two walks being
  // joined may not be the same length in time at all: a one-square tick joining onto a
  // three-square dash, or a live 800ms tick joining onto a 420ms replay tick. Speed is the
  // thing that has to match across that join; distance-per-leg isn't.
  const legMs = m.dur / m.n;
  m.tin = { x: (m.vout ? m.vout.x : 0) * legMs, y: (m.vout ? m.vout.y : 0) * legMs };
  const last = m.pts[m.n], prev = m.pts[m.n - 1];
  m.vout = { x: (last.x - prev.x) / legMs, y: (last.y - prev.y) / legMs };

  m.t0 = performance.now();
  m.cell = { x: u.x, y: u.y };

  if (motionRaf === null) motionRaf = requestAnimationFrame(motionFrame);
}

// ── THE ANIMATION LOOP ───────────────────────────────────────────────────────
//
// Runs once per screen refresh while anything is walking. Per moving unit this does one
// piece of arithmetic and writes one style property — and, crucially, never MEASURES
// anything. Asking the browser where something is forces it to stop and re-do the page
// layout; doing that sixty times a second is the one thing that would make this slow, and
// it's why boardMetrics (board.js) measures the grid once and does sums from then on.
function motionFrame(now) {
  motionRaf = null;
  let stillMoving = false;

  for (const uid in MOTION) {
    const m = MOTION[uid];
    if (!m.node || !m.pts) continue;

    // How far through the walk are we? 0 = just left, 1 = arrived. Clamped at BOTH ends:
    // past 1 is the ordinary "the tick ran long" case, and below 0 can happen whenever the
    // clock the frame is given is older than the moment the walk started — which is exactly
    // what a tab waking up from being hidden looks like. Neither should be able to index
    // off the end of the route.
    let s = (now - m.t0) / m.dur;
    if (s < 0) s = 0;
    const arrived = s >= 1;
    if (arrived) s = 1;

    // Work out the position BEFORE retiring the route — motionSample needs it to still be
    // there. (Clearing it first reads as harmless and is not: it throws on the very last
    // frame of every single walk.)
    const p = motionSample(m, s);
    // Keep a running total of how far this unit has walked, ever. The step bob is phased off
    // it so the gait carries across tick boundaries instead of restarting each square.
    m.dist = (m.dist || 0) + Math.hypot(p.x - m.px, p.y - m.py);
    m.px = p.x; m.py = p.y;
    m.dx = p.dx;
    motionWrite(m);

    if (arrived) m.pts = null;    // that was the last frame we need to draw for it
    else stillMoving = true;
  }

  // Only keep the loop alive while something is actually going somewhere.
  if (stillMoving) motionRaf = requestAnimationFrame(motionFrame);
}

// How rounded are the corners? 1 = fully rounded, 0 = the old hard right-angles.
// Not a fudge factor: at 1 a straight walk comes out EXACTLY straight and exactly even
// (see below), so there is no cost to turning it all the way up.
const CURVE_K = 1;

// The direction a walk should SET OFF in.
//
// We know the leg just finished and the leg about to start, but never the one after — the
// engine hasn't decided it yet. So we don't try to look ahead. Instead we fix the direction
// each leg ARRIVES in (to the leg's own direction) and inherit the direction it LEAVES in
// from the previous leg. Do that on every leg and every join matches by construction, with
// nothing to predict.
//
// The one thing we change about the inherited direction is throwing away any BACKWARDS
// part: when a unit turns around, carrying its old speed unaltered would make it visibly
// walk backwards for a moment before setting off. The SIDEWAYS part is kept in full — that
// part is the rounding.
function startTangent(tin, d) {
  const len = Math.hypot(d.x, d.y) || 1;
  const ux = d.x / len, uy = d.y / len;
  const along = tin.x * ux + tin.y * uy;        // how much of the old speed is "forwards"
  const fwd = Math.max(0, along);               // ...and never less than none
  return { x: (fwd * ux + (tin.x - along * ux)) * CURVE_K,
           y: (fwd * uy + (tin.y - along * uy)) * CURVE_K };
}

// Where along the route are we at progress s (0..1), and which way are we facing?
//
// Each leg is a cubic Hermite curve: it starts at P0 heading in direction m0, and finishes
// at P1 heading in direction m1. Feed it a start direction that matches how the last leg
// ended and the whole route becomes one smooth line instead of a chain of hard turns.
//
// Worth knowing what this does in the ordinary case: on a straight leg following another
// straight leg, m0 and m1 are both exactly the leg itself, the curve collapses to
// P0 + s(P1-P0), and the unit walks dead straight at a dead constant speed. The curve only
// costs anything where there is actually a corner to round.
function motionSample(m, s) {
  const n = m.n;
  // Which leg of the route, kept inside the route's actual ends. The caller already clamps
  // s, and this is the belt to that pair of braces: a route is the one thing here that gets
  // read every single frame, so it is worth being certain it can never be indexed off.
  const i = Math.max(0, Math.min(n - 1, Math.floor(s * n)));
  const t = s * n - i;                            // how far along that leg
  const P0 = m.pts[i], P1 = m.pts[i + 1];
  const d = { x: P1.x - P0.x, y: P1.y - P0.y };

  // Which direction were we travelling as this leg began? For the first leg of a walk that
  // is whatever we carried over from the previous tick; after that it's simply the leg before.
  const tin = (i === 0)
    ? (m.tin || { x: 0, y: 0 })
    : { x: P0.x - m.pts[i - 1].x, y: P0.y - m.pts[i - 1].y };

  const m0 = startTangent(tin, d);
  const m1 = d;                                   // arrive heading along the leg itself

  const t2 = t * t, t3 = t2 * t;
  const h00 = 2*t3 - 3*t2 + 1;
  const h10 = t3 - 2*t2 + t;
  const h01 = -2*t3 + 3*t2;
  const h11 = t3 - t2;

  return {
    x: h00 * P0.x + h10 * m0.x + h01 * P1.x + h11 * m1.x,
    y: h00 * P0.y + h10 * m0.y + h01 * P1.y + h11 * m1.y,
    dx: d.x,                                      // which way it's heading, for the lean
  };
}

// FACING — a lean, not a mirror. The obvious way to show which way something is going is to
// flip it horizontally, and it is the wrong way here: these figures are card glyphs, and a
// mirrored 7♠ is simply wrong. So the unit leans the way it's running, like a person does.
// Says the same thing, and the rank stays readable.
function motionLean(m) {
  if (!m.pts) return 0;
  const t = Math.max(-1, Math.min(1, m.dx / 40));
  return t * 8;                                   // up to 8 degrees
}

// STEP BOB — a small up-and-down, which is most of what separates "walking" from "sliding".
//
// Phased off DISTANCE TRAVELLED rather than off the tick, so it doesn't restart at every
// square: a three-square dash is one continuous jog, not the same little hop three times.
// m.dist just keeps counting up and is never reset, which is exactly what makes the gait
// carry across one tick into the next.
function motionBob(m) {
  if (!m.pts) return 0;
  const stride = boardMetrics() ? boardMetrics().px / 2 : 29;   // two steps per square
  return -Math.abs(Math.sin(Math.PI * (m.dist / stride))) * 2.5;
}

// Put the shape where the numbers say. transform is the one thing a browser can change
// without re-doing page layout, which is what makes this cheap enough to do every frame.
function motionWrite(m) {
  m.node.style.transform = "translate3d(" + m.px + "px, " + m.py + "px, 0)";
  // The walk cycle rides on its own inner element: .unit is already spending its transform
  // on WHERE the unit is, and one element can only run one transform at a time.
  if (m.body) {
    m.body.style.transform = "translateY(" + motionBob(m).toFixed(2) + "px) rotate("
                           + motionLean(m).toFixed(2) + "deg)";
  }
}

// ── HOUSEKEEPING ─────────────────────────────────────────────────────────────

// Forget everything. Called when a fight is torn down or a replay is about to start, so a
// unit can't glide in from wherever the last thing you watched happened to leave it.
function motionReset() {
  if (motionRaf !== null) { cancelAnimationFrame(motionRaf); motionRaf = null; }
  for (const uid in MOTION) delete MOTION[uid];
}

// Where is this unit DRAWN right now, in board pixels? Mid-walk that is NOT the middle of
// the square the engine says it occupies. Falls back to the square's centre when the unit
// has no record yet.
function motionPos(u) {
  const m = u && MOTION[u.uid];
  if (m && m.pts !== undefined) return { left: m.px, top: m.py };
  return gridToPx(u.x, u.y);
}
