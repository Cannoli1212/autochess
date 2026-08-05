// board.js — the grid itself + render() units onto squares.
// Owns grid LOGIC only; input handlers live in placement.js (initInput).
// Depends on: config, state, cards.

// Find the cell element at a given x,y coordinate.
function cellAt(x, y) {
  return document.querySelector('.cell[data-x="' + x + '"][data-y="' + y + '"]');
}

// Where is the CENTER of cell x,y, in pixels, measured from the board's top-left?
// The fx overlay (#fxLayer) is stretched across the board, so these are exactly the
// coordinates to place an effect at. Measured live with getBoundingClientRect instead
// of computed from the 56px cell / 2px gap constants — the coordinate labels and any
// future size change would break hand-done math, and the browser already knows the
// answer. Returns null for an off-board coordinate.
function cellCenter(x, y) {
  const cell = cellAt(x, y);
  if (!cell) return null;
  const c = cell.getBoundingClientRect();
  const b = board.getBoundingClientRect();
  return { left: c.left - b.left + c.width / 2, top: c.top - b.top + c.height / 2 };
}

// ── BOARD GEOMETRY, MEASURED ONCE (week 4, the motion pass) ──────────────────
//
// cellCenter() above asks the browser where a square is, every single time it's called.
// That is exactly right for something that happens once a tick — the browser always knows
// the true answer, so nothing can drift out of date. It is exactly WRONG for something that
// happens sixty times a second: each call is a querySelector plus two getBoundingClientRect
// calls, and getBoundingClientRect forces the browser to stop and re-measure the whole page.
// Sixteen units at 60fps would be roughly two thousand of those a second, and the game would
// stutter — from measuring, not from moving.
//
// So: measure TWICE, at startup, and do arithmetic after that. The grid is perfectly regular
// (every square the same size, every gap the same width), so where square 0,0 sits and how
// far apart 0,0 and 1,1 are is enough to work out all 64 of them. Still measured rather than
// hand-computed from CELL_PX and the 2px gap, for the same reason cellCenter is — the answer
// stays correct if the CSS changes.
let BOARD_METRICS = null;
function boardMetrics() {
  if (BOARD_METRICS) return BOARD_METRICS;
  const a = cellCenter(0, 0);
  const b = cellCenter(1, 1);
  if (!a || !b) return null;                  // board not built yet
  BOARD_METRICS = { ox: a.left, oy: a.top, px: b.left - a.left, py: b.top - a.top };
  return BOARD_METRICS;
}

// Where should something at grid position x,y be drawn, in pixels from the board's top-left?
// Same answer as cellCenter for whole numbers — but this one accepts FRACTIONS, which is the
// whole point: 3.5 is halfway between squares 3 and 4, i.e. a unit mid-stride.
function gridToPx(x, y) {
  const m = boardMetrics();
  if (!m) return null;
  return { left: m.ox + x * m.px, top: m.oy + y * m.py };
}

// Throw the measurement away so the next call re-measures. Needed whenever the board is
// rebuilt or the page is resized — otherwise every unit would be drawn against the old layout.
function clearBoardMetrics() { BOARD_METRICS = null; }

// Find the unit standing at x,y (or null if that square is empty).
function findUnitAt(x, y) {
  for (let i = 0; i < units.length; i++) {
    if (units[i].x === x && units[i].y === y) return units[i];
  }
  return null;
}

// ── STATUS BADGES (week 3) ───────────────────────────────────────────────────
//
// A GLOW IS A MOMENT. A BADGE IS A STATE.
//
// Until now every status was a box-shadow on the cell. That works for a one-tick flash
// ("this mage just cast"), but it fails for anything that LINGERS, for two reasons:
//
//  1. Every glow is a box-shadow on the same element at the same specificity, so only
//     the last matching rule in styles.css wins. A stunned legendary showed the purple
//     LEGENDARY glow and no hint of the stun — one status silently ate another.
//  2. Some states never had any representation at all. Poison stacks were the worst:
//     you saw purple damage ticking every tick with nothing saying the unit was poisoned,
//     let alone how badly.
//
// Badges are separate flex children, so N statuses show N icons — nothing can eat
// anything. The glows stay exactly as they were: when a glow wins its priority fight it
// adds a nice bit of colour, and when it loses, the badge is still there. Additive, not
// a replacement.
//
// This is a PURE function — unit in, HTML out, no DOM reads, no measurement. And because
// render() blanks every cell's innerHTML each tick, a badge physically cannot go stale.
// That's the whole reason it lives in the innerHTML template instead of being a class:
// no second remove-list to fall out of sync (see the drift bug fixed above).
//
// The list is in PRIORITY order — only the first four fit in a 56px cell.
// Each entry is [glyph, css class, plain-English name for the tooltip].
function statusList(u) {
  const b = [];
  if (tickCount < (u.stunUntil || 0))         b.push(["✸", "bg-stun", "Stunned"]);
  if (tickCount < (u.invulnUntil || 0))       b.push(["✦", "bg-invuln", "Invulnerable"]);
  if (tickCount < (u.untargetableUntil || 0)) b.push(["◌", "bg-hide", "Untargetable"]);
  // The count is the point: "poisoned" tells you far less than "poisoned for 30 a tick".
  if (u.poison > 0)                           b.push(["☠" + u.poison, "bg-poison", "Poisoned (" + u.poison + "/tick)"]);
  if (tickCount < (u.slowUntil || 0))         b.push(["🐌", "bg-slow", "Slowed"]);
  if (tickCount < (u.atkBuffUntil || 0))      b.push(["▲", "bg-buff", "Attack buffed"]);
  // Haste compares against the speed captured when the buff first applied. The epsilon is
  // there because attackSpeed is a float multiplied repeatedly — an exact === would flicker.
  if (u.baseSpeed && u.attackSpeed > u.baseSpeed + 0.001) b.push(["⚡", "bg-haste", "Hasted"]);
  if ((u.moveSteps || 1) > 1)                 b.push(["»", "bg-dash", "Dashing"]);
  if (u.ralliedBy > 0)                        b.push(["⚑", "bg-rally", "Rallied"]);
  if (u.inert)                                b.push(["▣", "bg-inert", "Inert — cannot act"]);
  return b;
}

// The badge row itself. Four fit; a fifth becomes a "+" so you know to check the tooltip
// rather than being quietly lied to about how many statuses are running.
function statusBadges(u) {
  const b = statusList(u);
  if (b.length === 0) return "";
  const shown = b.slice(0, 4).map(function (x) {
    return '<span class="badge ' + x[1] + '">' + x[0] + '</span>';
  }).join("");
  return '<div class="badges">' + shown + (b.length > 4 ? '<span class="badge">+</span>' : '') + '</div>';
}

// The same statuses in words, appended to the cell's hover tooltip. The board deliberately
// speaks in glyphs — they read at a glance in a 56px square where words never could — so
// this is the ONLY place the English lives. Not optional: a glyph you can't look up is
// just decoration.
function statusText(u) {
  const b = statusList(u);
  if (b.length === 0) return "";
  return " · " + b.map(function (x) { return x[2]; }).join(" · ");
}

// Redraw the whole board from the units array. The array is the TRUTH;
// the board is just a picture of it.
//
// Two halves since the motion pass, because the two things now live in different places:
// the SQUARES (zone tint, traps, airstrike marks, and the drag targets) are redrawn from
// scratch every tick as they always were, while the UNITS are reconciled — matched up with
// the lasting shapes they already own on #unitLayer, rather than erased and recreated.
function render() {
  if (SIM_MODE) return;   // headless batch sim: skip all DOM work (see sim.js)
  renderCells();
  // The damage panel goes BEFORE the units, and the order genuinely matters. The panel
  // shares a flex row with the board, and it grows as a fight goes on — which stretches the
  // board and moves every square (see motionSyncGeometry in motion.js). Drawn afterwards, it
  // would move the squares out from under units that had just been positioned, leaving them
  // sitting slightly high until the next redraw. Drawn first, the board has finished
  // changing shape by the time anything measures it.
  renderDmgPanel();       // keep the live damage tracker in lockstep with the board
  renderUnits();
}

// ── THE SQUARES ──────────────────────────────────────────────────────────────
// Everything drawn that belongs to a SQUARE rather than to a unit.
function renderCells() {
  const allCells = document.querySelectorAll(".cell");
  for (let i = 0; i < allCells.length; i++) {
    allCells[i].innerHTML = "";
    // Strip EVERY class except the permanent zone tint, rather than naming the ones to
    // remove. The old list was a hand-maintained second copy of the add-list below, and it
    // had already fallen three classes behind it — `stunned`, `buffed` and `vanished` were
    // added but never removed, so the first unit to be stunned anywhere left that cell
    // glowing purple for the rest of the fight, even after it moved away or died.
    // A rule can't drift out of date the way a list can. player1-zone / player2-zone are
    // the only classes buildBoard puts on a cell permanently (see below).
    const zone = allCells[i].classList.contains("player1-zone") ? " player1-zone"
               : allCells[i].classList.contains("player2-zone") ? " player2-zone" : "";
    allCells[i].className = "cell" + zone;
    allCells[i].draggable = false;            // empty cells can't be dragged
  }
  // A square holding a unit is still what you pick up when you drag, and still what
  // shows the hover tooltip — the unit's own shape sits on a sheet above that ignores
  // the mouse entirely, so the square underneath stays the thing you interact with.
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const cell = cellAt(u.x, u.y);
    if (!cell) continue;
    cell.title = figureTitle(u) + statusText(u);   // glyphs on the board, words on hover
    cell.draggable = true;                         // a cell with a unit can be dragged
  }

  // Tap-to-place: ring the square whose unit is currently picked up, so a tap-driven
  // move shows the same "I am holding this" state a drag does. renderCells strips all
  // classes above, so this is re-applied every redraw like everything else here.
  if (tapSel && tapSel.kind === "unit") {
    const selCell = cellAt(tapSel.x, tapSel.y);
    if (selCell) selCell.classList.add("tap-sel");
  }

  // Airstrike marks (King of Clubs): overlay a red ✕ on each marked square so the
  // player sees their blind targets. State owns the marks; the board just draws them.
  const marks = strikeMarks.player1.concat(strikeMarks.player2);
  for (let i = 0; i < marks.length; i++) {
    const cell = cellAt(marks[i].x, marks[i].y);
    if (!cell) continue;
    cell.classList.add("strike-mark");
    if (cell.innerHTML === "") {
      cell.innerHTML = '<div class="fig" style="color:#ff5252">✕</div>';
    }
  }

  // Traplines (rank 8): overlay each live trap on its cell, colored by owner team, so
  // the player can see the hazard field. State owns the traps; the board just draws them.
  // The "only if empty" check now only stops a trap from overwriting an airstrike ✕ —
  // squares no longer hold units at all, so a trap under a unit is simply drawn beneath
  // the unit's tile, and reappears the moment the unit walks off it.
  for (let i = 0; i < traps.length; i++) {
    const trap = traps[i];
    const cell = cellAt(trap.x, trap.y);
    if (!cell) continue;
    cell.classList.add("trap-" + trap.team);
    if (cell.innerHTML === "") {
      cell.innerHTML = '<div class="trap-glyph">✵</div>';
    }
  }
}

// ── THE UNITS ────────────────────────────────────────────────────────────────
//
// Every unit's lasting shape on #unitLayer, looked up by its uid (see state.js).
// A shape outlives the tick that made it — that is the entire point, and the reason
// units can now travel between squares instead of blinking from one to the next.
const unitNodes = {};

function unitNodeFor(u) { return u && unitNodes[u.uid] ? unitNodes[u.uid] : null; }

// Build one unit's shape ONCE. The skeleton never changes after this; each tick only
// rewrites the leaves (the numbers, the bar widths, the badge row).
//
// The nesting looks fussier than it is, and each layer earns its place — an element can
// only run ONE transform at a time, and a unit in a busy tick is doing four things at once:
//
//   .unit       where it is on the board          (position — written by the motion pass)
//   .body       leaning and bobbing as it walks   (the walk cycle)
//   .fig        lunging at whatever it's hitting
//   .fig-glyph  flinching from a hit it just took
//
// Collapse any two of those together and the later one silently cancels the earlier.
function makeUnitNode(u) {
  const node = document.createElement("div");
  node.className = "unit";
  node.dataset.uid = u.uid;
  node.innerHTML =
    '<div class="badges"></div>' +
    '<div class="rank-tag"></div>' +
    '<div class="body"><div class="fig"><span class="fig-glyph"></span></div></div>' +
    '<div class="hpbar"><div class="hpbar-fill"></div></div>' +
    '<div class="shieldbar"><div class="shieldbar-fill"></div><span class="shield-amt"></span></div>' +
    '<div class="manabar"><div class="manabar-fill"></div></div>' +
    '<div class="stat"></div>';
  // Remember the pieces now so the per-tick repaint never has to go looking for them.
  node._badges    = node.querySelector(".badges");
  // The rank/suit tag, shown ONLY when the figure is a sprite. It's a sibling of .body
  // rather than a child, which is deliberate: it's a LABEL, so it should travel with the
  // unit but not bob and lean with its walk — exactly the same call the hp bar makes.
  node._tag       = node.querySelector(".rank-tag");
  node._body      = node.querySelector(".body");
  node._fig       = node.querySelector(".fig");
  node._glyph     = node.querySelector(".fig-glyph");
  node._hpFill    = node.querySelector(".hpbar-fill");
  node._shield    = node.querySelector(".shieldbar");
  node._shieldFill= node.querySelector(".shieldbar-fill");
  node._shieldAmt = node.querySelector(".shield-amt");
  node._mana      = node.querySelector(".manabar");
  node._manaFill  = node.querySelector(".manabar-fill");
  node._stat      = node.querySelector(".stat");
  return node;
}

// THE LUNGE. The attacker leans into its swing and settles back. 260ms of an 800ms tick —
// clearly one swing, well finished before the next. Ranged units never lunge; they get a
// tracer instead.
//
// This used to be a CSS class, and it worked only because render() destroyed and rebuilt
// the .fig element every tick: a brand-new element wearing an animation class always plays.
// Units keep the same element now, and re-adding a class the element already has is "no
// change" to the browser — the lunge would have fired once and never again. animate() has
// exactly the property the old rebuild gave us for free: calling it starts a NEW run, no
// matter what the element was doing. It also cleans up after itself, so a lunge can't get
// stuck mid-lean the way a leftover class could.
function playLunge(node, dx, dy) {
  // Turn "3 squares right, 4 up" into a short nudge in that direction: divide by the
  // larger leg so a diagonal lunge travels the same distance as a straight one.
  const reach = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const lx = Math.round((dx / reach) * 13);
  const ly = Math.round((dy / reach) * 13);
  if (node._lungeAnim) node._lungeAnim.cancel();
  node._lungeAnim = node._fig.animate([
    { transform: "translate(0px, 0px)" },
    { transform: "translate(" + lx + "px, " + ly + "px)", offset: 0.3 },
    { transform: "translate(0px, 0px)" },
  ], { duration: 260, easing: "ease-out" });
}

// THE FLINCH: the unit that actually took the hit recoils and flares for a moment.
// Deliberately a SHAKE rather than a directional knock-back — the damage number already
// says how hard, this only needs to say "this one, right here, got hit".
function playFlinch(node) {
  if (node._flinchAnim) node._flinchAnim.cancel();
  node._flinchAnim = node._glyph.animate([
    { transform: "translateX(0px)",   filter: "none" },
    { transform: "translateX(-3px)",  filter: "brightness(1.9)", offset: 0.2 },
    { transform: "translateX(3px)",   filter: "brightness(1.9)", offset: 0.5 },
    { transform: "translateX(-2px)",  filter: "brightness(1.4)", offset: 0.75 },
    { transform: "translateX(0px)",   filter: "none" },
  ], { duration: 220, easing: "ease-in-out" });
}

// Repaint one unit's shape: the numbers, the bars, the badges, the glows.
function paintUnitNode(node, u) {
  const su = SUITS[u.suit];
  // Health bar: how full is this unit's HP? maxHp is set when the unit is made (and again
  // by applySynergies), so hp/maxHp is a 0..1 fraction of health left. Clamp to 0..1 so a
  // poison overkill or a buff quirk can't overflow the bar.
  const frac = Math.max(0, Math.min(1, u.hp / u.maxHp));
  // Green when healthy, yellow when hurt, red when nearly dead — read at a glance.
  node._hpFill.style.width = Math.round(frac * 100) + "%";
  node._hpFill.style.background = frac > 0.5 ? "#4caf50" : (frac > 0.25 ? "#ffb300" : "#e53935");

  // THE UNIT'S FACE. Two ways to wear one, and which you get depends only on whether
  // unitart.js has a sprite for this unit:
  //
  //   SPRITE — the picture says what the unit DOES (a 9 looks like a plague bearer), and
  //            the rank/suit tag in the corner keeps "9♠" readable, because reading your
  //            poker hands off the board is the core loop and art must never cost you that.
  //   TEXT   — the original "9♠" glyph. Not a degraded mode: it's what every unit shows
  //            until a sprite is assigned, so the board is always fully playable whether
  //            the art pack is installed or not.
  //
  // Both live behind ONE memo. The face changes almost never, and rewriting HTML that
  // already says the right thing is pure waste sixty times a second — the same reasoning
  // the old _lastGlyph guard was built on, just widened to cover the sprite too.
  const figInner = u.fused ? fusedGlyphHTML(u.card, "unitColor") : (rankLabel(u.rank) + su.symbol);
  const art = unitArtFor(u);
  const faceKey = art ? ("art:" + art.key + "|" + figInner) : ("txt:" + figInner);
  if (node._lastFace !== faceKey) {
    node._lastFace = faceKey;
    if (art) {
      node._glyph.className = "fig-glyph art";
      node._glyph.innerHTML = "";
      applyUnitArt(node._glyph, art);
      node._tag.innerHTML = figInner;
      node._tag.style.color = su.unitColor;   // the tag carries the suit colour the glyph used to
      node._tag.style.display = "";
    } else {
      node._glyph.className = "fig-glyph";
      node._glyph.innerHTML = figInner;
      node._glyph.style.backgroundImage = "";
      node._tag.style.display = "none";     // no sprite = the glyph IS the label already
    }
  }
  node._fig.style.color = su.unitColor;

  // DEPTH ORDER. A 32px sprite in a 20px slot overhangs ~6px upward, and the squares are
  // only 2px apart, so a unit wearing the full stack (shield bar AND mana bar) reaches
  // about 4px over the stat line of whoever is standing directly above it.
  //
  // Shrinking the sprite to dodge that would mean a fractional scale — 16px art at 1.5×
  // draws some source pixels 1px wide and others 2px, which looks visibly wrong on pixel
  // art. So the overlap stays and is made to read correctly instead: whoever is FURTHER
  // DOWN the board is nearer the viewer, so it occludes what's behind it. That is how a
  // board with depth is supposed to stack, and it turns a 4px collision into the thing
  // your eye already expects. Nothing here escapes #unitLayer's own z-index 10, so effects
  // (z-index 20) still draw over every unit.
  node.style.zIndex = u.y;

  node._badges.innerHTML = statusBadges(u);   // same pure function as before — can't go stale

  // Shield bar: shown ONLY when the unit carries a shield pool (rank-5 Ward / Ace of
  // Diamonds' Aegis). A TALLER steel-white bar with the exact shield NUMBER centered ON it
  // (not in the HP stat line), so armor reads as its own separate thing — you can SEE it
  // soak hits before HP drops. Width = shield/maxHp clamped at 100% (shields stack past a
  // full bar — a full white bar just means "≥ one health bar of shield").
  if (u.shield > 0) {
    node._shield.style.display = "";
    node._shieldFill.style.width = Math.round(Math.min(1, u.shield / u.maxHp) * 100) + "%";
    node._shieldAmt.textContent = u.shield;
  } else {
    node._shield.style.display = "none";
  }
  // Mana bar: casters only. mana/manaMax as a blue fill under the HP bar.
  if (u.caster) {
    node._mana.style.display = "";
    node._manaFill.style.width = Math.round(Math.min(1, u.mana / u.manaMax) * 100) + "%";
  } else {
    node._mana.style.display = "none";
  }

  node._stat.textContent = u.attack + " / " + u.hp;
  node.title = figureTitle(u) + statusText(u);

  // ONE class write, built fresh from scratch. Same discipline as the cell loop above and
  // for the same reason: a rule can't drift out of date the way a hand-kept remove-list can.
  let cls = "unit unit-" + u.team;
  if (uniqueOf(u)) cls += " unique";                                  // legendary → purple glow
  if (u.fused) cls += " fused";                                       // made hand → green glow
  if (tickCount < (u.castFlashUntil || 0)) cls += " casting";         // mage discharging
  if (tickCount < (u.spellHitUntil || 0)) cls += " spell-hit";        // fireball impact
  if (tickCount < (u.healFlashUntil || 0)) cls += " healed";          // Cleric mend (green)
  if (tickCount < (u.trapSprungUntil || 0)) cls += " trap-sprung";    // stepped on a trap
  if (tickCount < (u.stunUntil || 0)) cls += " stunned";              // frozen (purple)
  if (tickCount < (u.atkBuffUntil || 0)) cls += " buffed";            // K♥ rally on Q♥ (gold)
  if (tickCount < (u.untargetableUntil || 0)) cls += " vanished";     // A♠ hidden (faded)
  node.className = cls;

  // The two motion animations. Both gated on a fight actually running: once it ends
  // tickCount stops advancing, so a stale stamp would still read as "in the future" and the
  // units would twitch forever on the results screen. The per-tick guard is because render()
  // can be called several times outside the combat loop, and without it one swing would
  // restart its lunge on every one of those.
  if (inCombat || replaying) {
    if (tickCount < (u.lungeUntil || 0) && !isRangedSuit(u.suit) && node._lungeTick !== tickCount) {
      node._lungeTick = tickCount;
      playLunge(node, u.lungeX, u.lungeY);
    }
    if (tickCount < (u.flinchUntil || 0) && node._flinchTick !== tickCount) {
      node._flinchTick = tickCount;
      playFlinch(node);
    }
  }
}

// Match the units array up with the shapes on screen: give any new unit a shape, repaint
// every shape, and remove the shapes of units that are no longer on the board.
function renderUnits() {
  const layer = document.getElementById("unitLayer");
  if (!layer) return;
  // Re-measure the board before drawing anything on it. The board changes size on its own
  // as the damage panel next to it grows, which shifts every square — see the long note on
  // motionSyncGeometry in motion.js. Two measurements once a tick is a rounding error; the
  // point of caching them was to keep measuring out of the 60fps animation loop, not out of
  // here.
  motionSyncGeometry();
  const seen = {};
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    seen[u.uid] = true;
    let node = unitNodes[u.uid];
    if (!node) {
      node = makeUnitNode(u);
      unitNodes[u.uid] = node;
      layer.appendChild(node);
    }
    paintUnitNode(node, u);
    // Where to draw it. During a fight this sets the unit WALKING toward its new square
    // over the course of the tick (motion.js); the rest of the time it just puts it there.
    motionCommit(u, node);
  }
  // Anything left over belongs to a unit that died or was picked back up. Its shape goes —
  // but motion.js keeps a note of where it was last drawn, so a death effect can appear
  // where you last SAW the unit rather than where the engine had already moved it to.
  for (const uid in unitNodes) {
    if (seen[uid]) continue;
    unitNodes[uid].remove();
    delete unitNodes[uid];
    motionDrop(uid);
  }
}

// Wipe every unit shape off the board. Used when a fight is torn down or a replay starts,
// so nothing carries over from whatever was on screen before.
function clearUnitNodes() {
  for (const uid in unitNodes) {
    unitNodes[uid].remove();
    delete unitNodes[uid];
  }
  motionReset();   // the walk records point at shapes that no longer exist
}

// Build the grid: column/row coordinate labels + the ROWS×COLS cells.
// (Drag handlers are attached separately by placement.initInput.)
function buildBoard() {
  // The grid is about to change shape, so any cached measurement of it is now a lie.
  clearBoardMetrics();

  // Hand CELL_PX to CSS so .cell and .unit size themselves from the same number
  // this function lays the grid out with — one constant, no chance of drift.
  document.documentElement.style.setProperty("--cell", CELL_PX + "px");

  // Tell the CSS grid its columns: a narrow first column for row numbers,
  // then COLS board columns one square wide.
  board.style.gridTemplateColumns =
    COORD_GUTTER_PX + "px repeat(" + COLS + ", " + CELL_PX + "px)";

  // Top row of coordinate labels: an empty corner, then a number per column.
  const corner = document.createElement("div");
  corner.className = "coord-label";
  board.appendChild(corner);
  for (let cx = 0; cx < COLS; cx++) {
    const colLabel = document.createElement("div");
    colLabel.className = "coord-label";
    colLabel.textContent = String.fromCharCode(65 + cx);  // 0→A, 1→B, ...
    board.appendChild(colLabel);
  }

  // For every row: add a row-number label, then walk across every column
  // creating one cell each. 8 rows x 8 cols = 64 cells.
  for (let y = 0; y < ROWS; y++) {
    const rowLabel = document.createElement("div");
    rowLabel.className = "coord-label";
    rowLabel.textContent = ROWS - y;      // top row = 8 ... bottom row = 1 (chess style)
    board.appendChild(rowLabel);

    for (let x = 0; x < COLS; x++) {
      // Make a new empty square.
      const cell = document.createElement("div");
      cell.className = "cell";

      // Remember this cell's coordinates.
      cell.dataset.x = x;
      cell.dataset.y = y;

      // Tint the home rows: top 3 rows = Player 2, bottom 3 rows = Player 1.
      if (y < 3) {
        cell.classList.add("player2-zone");
      } else if (y >= ROWS - 3) {
        cell.classList.add("player1-zone");
      }

      // Add the finished cell to the board on the page.
      board.appendChild(cell);
    }
  }

  // THE UNIT LAYER (week 4, the motion pass). A transparent sheet over the grid where
  // every unit's shape lives. Added before the fx layer so effects still draw on top of
  // units, and cleared of any leftovers in case the board is being rebuilt.
  clearUnitNodes();
  const unitLayer = document.createElement("div");
  unitLayer.id = "unitLayer";
  board.appendChild(unitLayer);

  // THE FX LAYER (Week 1 of the effects pass). One transparent sheet stretched over
  // the whole grid, added LAST so it sits on top. Everything render() draws lives
  // inside a .cell and is wiped every single tick (see the innerHTML clear above) —
  // which means no animation there can ever last longer than one tick. Effects go
  // here instead: render() never touches this element, so a damage number can float
  // and fade across several ticks. pointer-events:none (in the CSS) keeps it from
  // eating the drag-and-drop clicks meant for the cells underneath.
  const fxLayer = document.createElement("div");
  fxLayer.id = "fxLayer";
  board.appendChild(fxLayer);
}
