// fx.js — THE EFFECT LAYER. Everything you SEE happen (as opposed to everything
// that IS true) is drawn from here.
//
// The idea, in one sentence: combat never draws anything, it just says what
// happened; this file decides what that looks like.
//
// Why it's built this way. The board's render() rebuilds every cell's innerHTML on
// every tick, so anything drawn inside a cell dies 500ms later — that's why the old
// effects could only ever be a one-tick box-shadow glow. And a flag on a unit
// ("this unit got hit") can't describe a RELATIONSHIP ("the 5♣ threw a fireball at
// the 3♥ four squares away"), which is what an ability actually is. So:
//
//   combat.js  →  emitFx("hit", { x, y, amount })     ← plain data, no DOM
//   fx.js      →  playFx() drains the queue once a tick and animates it
//
// Same inversion as the ability hooks: the engine reports, the view interprets.
// Adding a new effect later means adding an emit + a case here — combat.js never
// has to learn about pixels.
//
// Depends on: state (fxEvents, SIM_MODE), board (cellCenter).

// ── Emitting ─────────────────────────────────────────────────────────────────

// Record that something visible happened. `type` is the kind of effect ("hit",
// "heal", ...) and `data` carries whatever that effect needs — at minimum the
// board square it happened on. Called from combat.js at the exact moment HP
// changes. Dead cheap: it pushes an object and returns.
//
// SIM_MODE is the headless batch simulator (thousands of fights with no screen).
// There's nobody watching, so we bail immediately and the queue stays empty —
// that's what keeps a 10,000-game balance scan just as fast as it was before.
function emitFx(type, data) {
  if (SIM_MODE) return;
  data.type = type;
  fxEvents.push(data);
}

// ── Timings + palette ────────────────────────────────────────────────────────
// Both MS values MUST match their animation durations in styles.css — they're the
// fallback cleanup timers (see the note on hidden tabs in spawnFxNumber).
const FX_NUM_MS = 900;      // a floating damage number's lifetime  (fxFloat)
const FX_BEAM_MS = 320;     // a shot tracer's lifetime             (fxTracer)
const FX_REDIRECT_MS = 520; // a royal-redirect beam's lifetime     (fxRedirectBeam)
const FX_DEATH_MS = 700;    // a dying unit's ghost glyph           (fxDeath)

// How far apart the floating numbers of ONE tick are started, and how many of them
// get pushed back before they start sharing a start time. 70 × 6 = 420ms of spread,
// comfortably inside a 800ms tick, so a tick's numbers are all done before the next
// tick's begin. See the note in playFx for why time beats space here.
const FX_NUM_STAGGER_MS = 70;
const FX_NUM_STAGGER_CAP = 6;

// Effects between two units are colored by TEAM, not by suit. Suit colour would be
// the obvious choice, but the two RANGED suits (♣ and ♠) share the exact same
// unitColor #e8e8e8 — so suit-colored tracers would be indistinguishable from each
// other, while team color answers the question you actually have mid-fight: whose
// shot was that? Chosen to match the blue/red the board already uses for the teams.
const FX_TEAM_COLOR = { player1: "#6ca0ff", player2: "#ff7b7b" };

// ── The look-up table: what each event TYPE looks like ───────────────────────
// Data, not code — exactly like RANK_ABILITIES. Adding a new flavour of number is
// a new line here, not a new branch in a function.
//   cls    = the CSS class that colors it (see styles.css)
//   prefix = text glued on the front of the amount
//   text   = a FIXED word instead of a number (the "nothing happened" cases below);
//            when present the event needs no `amount` at all
const FX_NUMBER_KINDS = {
  hit:    { cls: "fx-hit",    prefix: "" },     // a normal auto-attack — white
  spell:  { cls: "fx-spell",  prefix: "" },     // spell damage (fireball etc.) — orange
  heal:   { cls: "fx-heal",   prefix: "+" },    // healing — green
  poison: { cls: "fx-poison", prefix: "" },     // per-tick poison — purple
  trap:   { cls: "fx-trap",   prefix: "" },     // a trap springing — amber
  absorb: { cls: "fx-absorb", prefix: "🛡" },   // damage eaten by a shield — steel
  // Why a hit you watched land did NOTHING. Until now these were completely silent:
  // the swing animated, the HP bar didn't move, and there was no way to tell whether
  // the unit dodged, was immune, or the game had a bug.
  miss:    { cls: "fx-miss",    text: "MISS" },   // Slippery dodged it entirely
  block:   { cls: "fx-block",   text: "IMMUNE" }, // an invulnerability window blanked it
  execute: { cls: "fx-execute", text: "☠" },      // Executioner — lethal by rule, not by damage
};

// ── The BEAM primitive: draw a line between two board squares ────────────────
// The second drawing tool after the floating number, and the one that unlocks most
// of what's still to come — a shot tracer, a spell beam, a projectile path and an
// aura tether are all "a line from A to B" with a different animation on top.
//
// How it works: a div is pinned at A's cell center, made exactly as WIDE as the
// distance to B, and rotated to point at it. transform-origin "0 50%" (in the CSS)
// means it pivots about its own left edge — the shooter — so the far end lands on
// the target. The animation lives on an INNER div because the outer one's transform
// is already spent on the rotation, and an animation would overwrite it.
//
// opts: { color, cls, ms }. Returns the element, or null if it can't be drawn.
function fxBeam(from, to, opts) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return null;
  const a = cellCenter(from.x, from.y);
  const b = cellCenter(to.x, to.y);
  if (!a || !b) return null;                    // off-board square
  const dx = b.left - a.left;
  const dy = b.top - a.top;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;                     // same square — nothing to draw
  // atan2 gives the angle in radians measured from "pointing right", which is exactly
  // how an un-rotated div is already lying. × 180/π converts it to the degrees CSS wants.
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  const beam = document.createElement("div");
  beam.className = "fx-beam";
  beam.style.left = a.left + "px";
  beam.style.top = a.top + "px";
  beam.style.width = len + "px";
  beam.style.transform = "rotate(" + angle + "deg)";

  const inner = document.createElement("div");
  inner.className = "fx-beam-inner" + (opts.cls ? " " + opts.cls : "");
  if (opts.color) {
    inner.style.background = opts.color;
    inner.style.boxShadow = "0 0 6px " + opts.color;   // a little glow so it reads on the dark board
  }
  beam.appendChild(inner);
  layer.appendChild(beam);

  // Same two-belt cleanup as the numbers — animationend never fires on a hidden tab.
  inner.addEventListener("animationend", function () { beam.remove(); });
  setTimeout(function () { beam.remove(); }, (opts.ms || FX_BEAM_MS) + 200);
  return beam;
}

// A committed swing. RANGED suits get a tracer streaking to the target; melee gets
// nothing here on purpose — a "tracer" across one adjacent square would just be a
// smudge hidden under the glyphs. Melee motion is the next slice (a lunge on the
// unit itself), which is why combat emits the event for every swing regardless.
function spawnFxShot(ev) {
  if (!isRangedSuit(ev.suit)) return;
  fxBeam(ev.from, { x: ev.x, y: ev.y }, {
    color: FX_TEAM_COLOR[ev.team] || "#ffffff",
    cls: "fx-tracer",
  });
}

// The royal redirect: a hit aimed at the Queen landed on her King instead. Drawn as
// a GOLD beam from her square to his — gold because that's already the royal colour
// on the board (the .buffed rally glow), and slower + thicker than a shot tracer so
// it reads as "this hit was moved", not "someone fired". Second user of fxBeam, which
// is the point of having built it as a primitive.
function spawnFxRedirect(ev) {
  fxBeam(ev.from, { x: ev.x, y: ev.y }, {
    color: "#ffd54f",
    cls: "fx-redirect",
    ms: FX_REDIRECT_MS,
  });
}

// A unit dying. The board can't show this itself: by the time render() next runs the
// unit is already out of the units array, so the square just empties. Instead we leave
// a GHOST of its glyph on the fx layer — the same rank+suit mark it had on the board,
// including a fused unit's double glyph — and let it topple over and sink.
//
// Note this reads the SAME two helpers render() uses to draw a living unit, so a dead
// unit's ghost always matches what was standing there a moment ago. The event carries
// the plain facts (suit, rank, fused, card); building the glyph is the view's job.
function spawnFxDeath(ev) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return;
  const pos = cellCenter(ev.x, ev.y);
  if (!pos) return;
  const su = SUITS[ev.suit];
  const el = document.createElement("div");
  el.className = "fx-ghost";
  el.style.left = pos.left + "px";
  el.style.top = pos.top + "px";
  el.style.color = su.unitColor;
  el.innerHTML = ev.fused ? fusedGlyphHTML(ev.card, "unitColor") : (rankLabel(ev.rank) + su.symbol);
  layer.appendChild(el);
  el.addEventListener("animationend", function () { el.remove(); });
  setTimeout(function () { el.remove(); }, FX_DEATH_MS + 200);
}

// ── Playing ──────────────────────────────────────────────────────────────────

// Drain the queue and animate everything in it. Called once per tick by combatStep,
// straight after render(), so the numbers appear over the board state they describe.
function playFx() {
  if (SIM_MODE) { fxEvents = []; return; }      // headless: nothing to draw
  const layer = document.getElementById("fxLayer");
  if (!layer) { fxEvents = []; return; }        // no layer (old page / mid-rebuild): drop them

  // Two units can hit the same target in one tick, and a poisoned unit can also be
  // healed the same tick. Without this, those numbers would sit exactly on top of
  // each other and read as one. Count how many we've already put on each square
  // this tick and fan them out.
  const stackedOnCell = {};

  // ...but fanning them out in SPACE only goes so far. A cell is 56px wide, and a
  // busy tick puts a crit, a plain hit, a poison tick and a death ghost inside two
  // neighbouring squares — they collide into soup no matter how they're nudged.
  // So the numbers are also spread through TIME: each one in this tick starts a
  // little after the last, in the order combat produced them, so you read them as a
  // short sequence instead of a pile. Counted across the WHOLE tick, not per cell —
  // the crowding is between adjacent cells, not just within one.
  let numberIndex = 0;

  for (let i = 0; i < fxEvents.length; i++) {
    const ev = fxEvents[i];

    // Effects that draw BETWEEN squares are handled first; everything else is a
    // floating number anchored to one square.
    if (ev.type === "shot") { spawnFxShot(ev); continue; }
    if (ev.type === "redirect") { spawnFxRedirect(ev); continue; }
    if (ev.type === "death") { spawnFxDeath(ev); continue; }

    const kind = FX_NUMBER_KINDS[ev.type];
    if (!kind) continue;                        // unknown type → ignore (never throw mid-fight)
    const pos = cellCenter(ev.x, ev.y);
    if (!pos) continue;                         // off-board square

    const key = ev.x + "," + ev.y;
    const stack = stackedOnCell[key] || 0;
    stackedOnCell[key] = stack + 1;

    const el = document.createElement("div");
    el.className = "fx-num " + kind.cls + (ev.crit ? " fx-crit" : "");
    el.textContent = (kind.text !== undefined)
      ? kind.text
      : kind.prefix + Math.round(ev.amount) + (ev.crit ? "!" : "");
    // Position by the CENTER of the square. The CSS shifts it back by half its own
    // width (translateX(-50%)) so the number is centered no matter how wide it is.
    el.style.left = pos.left + "px";
    el.style.top = (pos.top - stack * 11) + "px";     // each extra number starts a bit higher
    // Sideways drift, alternating left/right, so a stack of numbers fans out into a
    // little spray instead of a single column. Read by the CSS animation.
    el.style.setProperty("--fx-drift", ((stack % 2 ? 1 : -1) * (4 + stack * 4)) + "px");
    // The time stagger. Capped so a very busy tick can't push the last number past the
    // end of the tick itself — beyond the cap they share a start, which is fine because
    // by then they're spread across the board anyway. Needs animation-fill-mode: both
    // in the CSS (not forwards) or the number would sit there fully opaque during its
    // delay and the stagger would be invisible.
    const delay = Math.min(numberIndex, FX_NUM_STAGGER_CAP) * FX_NUM_STAGGER_MS;
    numberIndex = numberIndex + 1;
    if (delay > 0) el.style.animationDelay = delay + "ms";
    layer.appendChild(el);

    // Clean up after yourself: the moment the float-and-fade finishes, the element
    // deletes itself. Without this the layer would accumulate thousands of invisible
    // divs over a long fight.
    el.addEventListener("animationend", function () { el.remove(); });
    // Belt and braces. Browsers PAUSE animations on a tab you're not looking at, and a
    // paused animation never fires animationend — so alt-tabbing mid-fight would leave
    // the numbers stuck on the layer forever. A timer doesn't care about visibility.
    // (Removing an already-removed element is harmless, so the two can't conflict.)
    setTimeout(function () { el.remove(); }, FX_NUM_MS + delay + 200);
  }

  fxEvents = [];      // queue is spent
}

// Wipe the layer and the queue. Called when a fight starts or the board is rebuilt,
// so numbers from the LAST fight can't float over the new one.
function clearFx() {
  fxEvents = [];
  const layer = document.getElementById("fxLayer");
  if (layer) layer.innerHTML = "";
}
