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
    m.px = target.left; m.py = target.top;
    motionWrite(m);
    return;
  }

  // Standing still. Leave it exactly where it is — and clear any finished route so the
  // loop stops counting it as moving.
  if (m.cell.x === u.x && m.cell.y === u.y) {
    m.pts = null;
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
    m.px = p.x; m.py = p.y;
    motionWrite(m);

    if (arrived) m.pts = null;    // that was the last frame we need to draw for it
    else stillMoving = true;
  }

  // Only keep the loop alive while something is actually going somewhere.
  if (stillMoving) motionRaf = requestAnimationFrame(motionFrame);
}

// Where along the route are we at progress s (0..1)? Straight line for now; the curve
// comes later. Written to take a multi-point route from the start so that the dash work
// and the corner-rounding both drop straight in.
function motionSample(m, s) {
  const n = m.n;
  // Which leg of the route, kept inside the route's actual ends. The caller already clamps
  // s, and this is the belt to that pair of braces: a route is the one thing here that gets
  // read every single frame, so it is worth being certain it can never be indexed off.
  const i = Math.max(0, Math.min(n - 1, Math.floor(s * n)));
  const t = s * n - i;                            // how far along that leg
  const P0 = m.pts[i], P1 = m.pts[i + 1];
  return { x: P0.x + (P1.x - P0.x) * t,
           y: P0.y + (P1.y - P0.y) * t };
}

// Put the shape where the numbers say. transform is the one thing a browser can change
// without re-doing page layout, which is what makes this cheap enough to do every frame.
function motionWrite(m) {
  m.node.style.transform = "translate3d(" + m.px + "px, " + m.py + "px, 0)";
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
