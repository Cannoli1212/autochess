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
// WEEK 3: the bail is now "headless AND nobody will replay this". The two table matchups
// you watch on the replay tabs run headless but ARE recorded, so they need their events
// kept. Balance scans leave RECORD_FX off and still cost nothing. See state.js.
function emitFx(type, data) {
  if (SIM_MODE && !RECORD_FX) return;
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
const FX_ORB_MS = 280;      // a spell projectile's flight time     (fxOrbFly)
const FX_RING_MS = 460;     // an expanding nova ring               (fxRingOut)

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

  // WEEK 3. Fourteen abilities changed the fight and said nothing at all: Thorns
  // reflected, Bulwark shrugged, Lifesteal drank, Cleave splashed, the Bowers and Midas
  // rewrote attack at round start — all of it invisible, because the ONLY thing this
  // file knew how to say was "damage happened". Each line below is a new WORD, not new
  // drawing code: every one inherits the per-cell stacking, the sideways drift and the
  // time stagger for free. That's the whole payoff of the table being data.
  //
  // Deliberately GLYPHS, not words. The board's visual language is symbols — you learn
  // "▲ means it got stronger" once, and it reads at a glance in a 56px cell where
  // "ATTACK UP" never would. The full English lives in the hover tooltip instead.
  buff:   { cls: "fx-buff",   prefix: "▲" },    // attack gained — warpath/bower/levy/midas
  weaken: { cls: "fx-weaken", prefix: "▼" },    // ...and the same mechanic going the wrong way
  guard:  { cls: "fx-guard",  prefix: "-" },    // Bulwark shrugged off this much (slate)
  reflect:{ cls: "fx-reflect",prefix: "" },     // Thorns/Dirty Diaper bounced it back (rose)
  speed:  { cls: "fx-speed",  text: "⚡" },     // Haste — attack speed up
  dash:   { cls: "fx-dash",   text: "»»" },     // Kill Dash banked a step
  gold:   { cls: "fx-gold",   prefix: "💰+" },  // 777 payout / Gambler's steal
  summon: { cls: "fx-summon", text: "✚" },      // Necromancer raised a body here
  shield: { cls: "fx-shield", prefix: "🛡+" },  // a shield was BANKED (absorb is it being SPENT)
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
// opts: { color, cls, ms, delay }. Returns the element, or null if it can't be drawn.
// `delay` (week 3) holds the beam back before it animates. That one option is what turns
// this primitive into a CHAIN — see fxChain, which is just this function in a loop with a
// growing delay, so the bolt visibly hops from victim to victim instead of striking them
// all at once.
function fxBeam(from, to, opts) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return null;
  // unitPos, not cellCenter: a beam should touch the sprite you can SEE. If either end is a
  // unit mid-walk, its square's centre is empty board by now. (motion.js — falls back to the
  // square's centre for anything that isn't a unit, so nothing else changes.)
  const a = unitPos(from);
  const b = unitPos(to);
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
  const delay = opts.delay || 0;
  if (delay) inner.style.animationDelay = delay + "ms";
  beam.appendChild(inner);
  layer.appendChild(beam);

  // Same two-belt cleanup as the numbers — animationend never fires on a hidden tab.
  // The delay has to be added to the fallback timer too, or a delayed beam would be
  // yanked off the layer before it ever got its turn to animate.
  inner.addEventListener("animationend", function () { beam.remove(); });
  setTimeout(function () { beam.remove(); }, (opts.ms || FX_BEAM_MS) + delay + 200);
  return beam;
}

// ── The ORB primitive: a projectile that TRAVELS from one square to another ───
// Not a beam. A beam says "a line connected these two squares"; an orb says "something
// left here and arrived there", which is the difference between Hellfire reading as a
// thrown fireball and reading as a laser. The distinction matters because the game
// already uses beams for instant things (shot tracers, the royal redirect).
//
// How it works: a small dot is parked at the caster's cell centre, and the DISTANCE it
// has to cover is handed to the CSS as two custom properties. The animation then just
// translates by those, so one keyframe covers every direction and length on the board.
//
// opts: { color, cls, ms }. Returns the element, or null if it can't be drawn.
function fxOrb(from, to, opts) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return null;
  const a = unitPos(from);                      // where they're DRAWN, not their squares
  const b = unitPos(to);
  if (!a || !b) return null;                    // off-board square

  const el = document.createElement("div");
  el.className = "fx-orb" + (opts.cls ? " " + opts.cls : "");
  el.style.left = a.left + "px";
  el.style.top = a.top + "px";
  el.style.setProperty("--fx-dx", (b.left - a.left) + "px");
  el.style.setProperty("--fx-dy", (b.top - a.top) + "px");
  if (opts.color) {
    el.style.background = opts.color;
    el.style.boxShadow = "0 0 8px 2px " + opts.color;
  }
  const ms = opts.ms || FX_ORB_MS;
  el.style.animationDuration = ms + "ms";
  layer.appendChild(el);
  el.addEventListener("animationend", function () { el.remove(); });
  setTimeout(function () { el.remove(); }, ms + 200);
  return el;
}

// ── The RING primitive: an expanding circle centred on one square ─────────────
// For every self-centred ability — Hellfire Aura, Miasma, Caltrops, a Rally. These all
// used to look identical to each other AND identical at every tier: damage numbers just
// appeared on whoever happened to be nearby, and a pair's small ring was indistinguishable
// from a quads' big one. The ring IS the ability.
//
// The size is measured off a REAL cell rather than assuming 56px, so if the board's cell
// size ever changes the ring still lands exactly on the squares it actually hits. Getting
// this wrong is worse than drawing nothing — a ring that covers the wrong squares actively
// lies about what the ability reaches.
//
// opts: { color, cls, ms }.
// `ref` is normally the fx event's `from` ({x, y} plus a uid when a unit is involved), so a
// nova is centred on the caster you can SEE rather than on the square it is walking off.
function fxRing(ref, radiusCells, opts) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return null;
  const pos = unitPos(ref);
  const m = boardMetrics();
  if (!pos || !m) return null;
  // The distance from one cell's centre to the next — which is exactly what boardMetrics
  // measured (see board.js). It used to be worked out here as "cell width + the 2px gap",
  // which was the right number but assumed it knew the gap; this asks the grid itself.
  // A radius of N reaches N cells out in every direction, so the circle spans 2N+1 cells.
  const diameter = (2 * radiusCells + 1) * m.px;

  const el = document.createElement("div");
  el.className = "fx-ring" + (opts.cls ? " " + opts.cls : "");
  el.style.left = pos.left + "px";
  el.style.top = pos.top + "px";
  el.style.width = diameter + "px";
  el.style.height = diameter + "px";
  if (opts.color) {
    el.style.borderColor = opts.color;
    el.style.boxShadow = "0 0 12px " + opts.color + ", inset 0 0 12px " + opts.color;
  }
  const ms = opts.ms || FX_RING_MS;
  el.style.animationDuration = ms + "ms";
  layer.appendChild(el);
  el.addEventListener("animationend", function () { el.remove(); });
  setTimeout(function () { el.remove(); }, ms + 200);
  return el;
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
  // Where the unit was last DRAWN, which for a unit that died mid-stride is not the square
  // the engine had already walked it to. motion.js keeps that spot after the unit's shape is
  // removed, precisely so the ghost appears where you last saw it instead of jumping ahead.
  const pos = unitPos(ev);
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

// Set once a tick has already drawn a BOARD-SIZED effect (the 777 rings). A tick has room
// for one of those and no more — the rings cover the whole grid, so a second set doesn't
// add information, it just hides the board underneath. Reset at the top of every playFx.
let bigEffectThisTick = false;

// ── The CHAIN primitive: a bolt that HOPS from victim to victim ──────────────
// Nothing new is drawn here at all — it is fxBeam in a loop, each hop starting a little
// after the last. That staggering is the whole trick: without it every segment appears in
// the same frame and a chain lightning looks like a static spider-web instead of something
// travelling. This is the clearest payoff of fxBeam having been built as a primitive.
//
// opts: { color, ms, hop } — `hop` is the gap between segments.
function fxChain(from, hits, opts) {
  let a = from;
  for (let i = 0; i < hits.length; i++) {
    fxBeam(a, hits[i], {
      color: opts.color,
      cls: "fx-chain",
      ms: opts.ms || 300,
      delay: i * (opts.hop || 90),
    });
    a = hits[i];      // the next hop starts where this one landed
  }
}

// ── The TETHER primitive: a held link between two allied units ───────────────
// For the royal bond — the King rallying his Queen, the Queen shielding her King. Those
// casts currently show a flash on the caster and a bar changing on someone else entirely,
// with nothing at all connecting the two, so the single most interesting interaction
// between two cards in the game is invisible.
//
// KNOWN LIMIT, worth knowing before you use it: this is drawn once at fixed pixel
// coordinates on the fx layer, so it does NOT follow a unit that walks away mid-animation.
// That's fine for a ~900ms flash on the moment of casting. A link that genuinely tracked
// two moving units would have to be redrawn from render() every tick — a different, and
// much more expensive, thing.
function fxTether(a, b, opts) {
  // Note the colour is deliberately NOT handed to fxBeam. fxBeam would set it as the
  // `background` shorthand, and that resets background-image — which is where the
  // tether's dashes live. Setting `color` instead lets the CSS gradient pick it up
  // through currentColor, and leaves the dashes intact.
  const beam = fxBeam(a, b, { cls: "fx-tether", ms: opts.ms || 900 });
  if (beam && opts.color) {
    const inner = beam.firstChild;
    inner.style.color = opts.color;
    inner.style.boxShadow = "0 0 6px " + opts.color;
  }
  return beam;
}

// ── The ABILITY bridge (week 3) ───────────────────────────────────────────────
//
// runAbilityHook calls this for every ability that fires. It is the ONE place that
// connects "an ability happened" to "something got drawn", which is why abilities.js
// still contains no colours, no glyphs and no DOM.
//
// It only ever emits — no drawing here. The event goes through the same queue as
// everything else so it inherits the ordering, the SIM_MODE bail, and (from slice 5) the
// replay recording, for free.
function emitAbilityFx(unit, hookName, ability, ctx) {
  const kit = FX_KITS[ability.kind];
  if (!kit) return;                        // no entry — nothing drawn, exactly as before
  const shape = kit[hookName];
  if (!shape || shape === "kit") return;   // "kit" — the handler draws its own shape
  const t = ctx && ctx.target;
  emitFx("ability", {
    kind: ability.kind,
    shape: shape,
    // uid on both ends so the shape is drawn from where these units actually are on screen
    // rather than the middle of their squares (see unitPos in motion.js).
    from: { x: unit.x, y: unit.y, uid: unit.uid },
    // With no target the effect happens ON the caster — that's what "pulse" is.
    x: t ? t.x : unit.x,
    y: t ? t.y : unit.y,
    uid: t ? t.uid : unit.uid,
    hasTarget: !!t,
  });
}

// The "kit" escape hatch. An ability handler calls THIS when only it can know the shape —
// the ring radius it baked, the squares its pierce actually reached, the reel it just
// rolled. It passes the FACTS it already worked out; the colour still comes from FX_KITS,
// so abilities.js never picks a pixel.
//
//   emitAbilityShape(unit, "burnAura", "ring", { radius: 2 })
//   emitAbilityShape(unit, "poisonVolley", "line", { to: lastVictim })
//
// `showIcon` defaults on, so a kit-drawn ability still announces itself like every other.
function emitAbilityShape(unit, kind, shape, data) {
  if (SIM_MODE) return;
  const ev = data || {};
  ev.kind = kind;
  ev.shape = shape;
  ev.from = { x: unit.x, y: unit.y, uid: unit.uid };
  if (ev.x === undefined) ev.x = unit.x;
  if (ev.y === undefined) ev.y = unit.y;
  if (ev.uid === undefined) ev.uid = unit.uid;
  emitFx("ability", ev);
}

// Draw one "ability" event. Every look is read straight out of FX_KITS, so giving an
// ability a visual it doesn't have is one line in fxkits.js — no drawing code at all.
function drawAbilityFx(ev) {
  const kit = FX_KITS[ev.kind];
  if (!kit) return;
  // Carry the uid along with the coordinates — without it the far end of every beam and orb
  // falls back to the square's centre, which is the wrong place for a target mid-walk.
  const to = { x: ev.x, y: ev.y, uid: ev.uid };
  // Pass `ev.from` whole rather than picking x/y off it, so a uid on it rides along and the
  // icon pops over the caster you can see instead of over the square it left (motion.js).
  const icon = function () { fxIcon(ev.from, kit.icon, kit.color); };

  switch (ev.shape) {
    // A projectile, and a line, both need somewhere to travel TO. If the ability turned
    // out to have no target, fall through to the icon so the cast is still announced
    // rather than silently swallowed.
    case "orb":
      if (!ev.hasTarget) break;
      fxOrb(ev.from, to, { color: kit.color });
      return;
    case "beam":
      if (!ev.hasTarget) break;
      fxBeam(ev.from, to, { color: kit.color, cls: "fx-spellbeam", ms: 380 });
      return;
    // Self-centred nova. The radius comes from the handler because only it knows which
    // tier baked which size.
    case "ring":
      fxRing(ev.from, ev.radius || 1, { color: kit.color });
      icon();
      return;
    // A piercing shot. It's drawn to the LAST square actually struck, not to the square
    // that was aimed at — which is exactly what makes a body-blocked Sniper Round
    // readable: the line visibly stops short at whoever stepped in the way.
    case "line":
      fxBeam(ev.from, to, { color: kit.color, cls: "fx-pierce", ms: 420 });
      return;
    // A bolt hopping between victims. The handler passes the squares it hit, in order.
    case "chain":
      if (!ev.hits || ev.hits.length === 0) break;
      fxChain(ev.from, ev.hits, { color: kit.color });
      return;
    // A held link between two allies (the royal bond).
    case "tether":
      if (!ev.hasTarget) break;
      fxTether(ev.from, to, { color: kit.color });
      icon();
      return;
    // 777. Three rings staggered outward from the machine — the only effect in the game
    // that draws more than one shape, because this is the only moment that deserves it.
    // Capped at one per tick: two 7s jackpotting together would otherwise stack six
    // full-board rings and white out the screen at the exact moment you most want to see
    // what happened.
    case "jackpot":
      if (bigEffectThisTick) { icon(); return; }
      bigEffectThisTick = true;
      for (let i = 0; i < 3; i++) {
        const ring = fxRing(ev.from, 1 + i * 2, { color: "#ffd54f", ms: 700 });
        if (ring) ring.style.animationDelay = (i * 110) + "ms";
      }
      icon();
      return;
  }
  icon();   // "pulse", and the fallback for anything that lost its target
}

// The icon pop. Built on the same .fx-num element as the floating damage numbers, so it
// inherits their float-and-fade animation and their cleanup for free. It does NOT go
// through the number loop's time stagger — it's lifted 14px instead, which keeps it clear
// of the damage numbers on the caster's own square without needing to be sequenced.
// `ref` is normally the fx event itself ({x, y} plus a uid when a unit is involved), so the
// icon pops over the unit you can see rather than over its square.
function fxIcon(ref, glyph, color) {
  const layer = document.getElementById("fxLayer");
  if (!layer) return;
  const pos = unitPos(ref);
  if (!pos || !glyph) return;
  const el = document.createElement("div");
  el.className = "fx-num fx-icon";
  el.textContent = glyph;
  if (color) el.style.color = color;
  el.style.left = pos.left + "px";
  el.style.top = (pos.top - 14) + "px";     // sit above the unit, clear of its damage numbers
  layer.appendChild(el);
  el.addEventListener("animationend", function () { el.remove(); });
  setTimeout(function () { el.remove(); }, FX_NUM_MS + 200);
}

// ── Playing ──────────────────────────────────────────────────────────────────

// Drain the queue and animate everything in it. Called once per tick by combatStep,
// straight after render(), so the numbers appear over the board state they describe.
function playFx() {
  // Hand this tick's events to the recorder before letting go of them. Both early exits
  // below stash too — the headless one especially, since that's the ONLY path a recorded
  // table matchup takes. Miss it there and the replay tabs stay silent.
  lastTickFx = fxEvents;
  if (SIM_MODE) { fxEvents = []; return; }      // headless: nothing to draw (but it IS recorded)
  const layer = document.getElementById("fxLayer");
  if (!layer) { fxEvents = []; return; }        // no layer (old page / mid-rebuild): drop them

  bigEffectThisTick = false;    // one board-sized effect per tick (see the jackpot case)

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
    if (ev.type === "ability") { drawAbilityFx(ev); continue; }   // week 3 — driven by FX_KITS

    const kind = FX_NUMBER_KINDS[ev.type];
    if (!kind) continue;                        // unknown type → ignore (never throw mid-fight)
    const pos = unitPos(ev);                    // over the unit you can see, not its square
    if (!pos) continue;                         // off-board square

    const key = ev.x + "," + ev.y;
    const stack = stackedOnCell[key] || 0;
    stackedOnCell[key] = stack + 1;

    const el = document.createElement("div");
    el.className = "fx-num " + kind.cls + (ev.crit ? " fx-crit" : "");
    // Three shapes a number can take:
    //   `text` in the table  → a fixed word, no amount needed at all (MISS / IMMUNE / ☠)
    //   an event with no `amount` → the prefix ALONE, as a bare glyph. The Bower buffs
    //     attack AND health AND speed at once, so there is no single honest number to
    //     print — but "▲ this unit was buffed" is still worth saying. Rendering it as
    //     "▲0" would actively lie about a buff that did plenty.
    //   otherwise → prefix + the rounded amount.
    el.textContent = (kind.text !== undefined)
      ? kind.text
      : (ev.amount === undefined)
        ? kind.prefix
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
  lastTickFx = [];      // or the first frame of the next fight would inherit the last one's
  const layer = document.getElementById("fxLayer");
  if (layer) layer.innerHTML = "";
}
