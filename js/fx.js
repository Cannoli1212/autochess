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

// ── The look-up table: what each event TYPE looks like ───────────────────────
// Data, not code — exactly like RANK_ABILITIES. Adding a new flavour of number is
// a new line here, not a new branch in a function.
//   cls    = the CSS class that colors it (see styles.css)
//   prefix = text glued on the front of the amount
// How long a floating number lives, in milliseconds. MUST match the fxFloat animation
// duration in styles.css — it's the fallback cleanup timer below.
const FX_NUM_MS = 900;

const FX_NUMBER_KINDS = {
  hit:    { cls: "fx-hit",    prefix: "" },     // a normal auto-attack — white
  spell:  { cls: "fx-spell",  prefix: "" },     // spell damage (fireball etc.) — orange
  heal:   { cls: "fx-heal",   prefix: "+" },    // healing — green
  poison: { cls: "fx-poison", prefix: "" },     // per-tick poison — purple
  trap:   { cls: "fx-trap",   prefix: "" },     // a trap springing — amber
  absorb: { cls: "fx-absorb", prefix: "🛡" },   // damage eaten by a shield — steel
};

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

  for (let i = 0; i < fxEvents.length; i++) {
    const ev = fxEvents[i];
    const kind = FX_NUMBER_KINDS[ev.type];
    if (!kind) continue;                        // unknown type → ignore (never throw mid-fight)
    const pos = cellCenter(ev.x, ev.y);
    if (!pos) continue;                         // off-board square

    const key = ev.x + "," + ev.y;
    const stack = stackedOnCell[key] || 0;
    stackedOnCell[key] = stack + 1;

    const el = document.createElement("div");
    el.className = "fx-num " + kind.cls + (ev.crit ? " fx-crit" : "");
    el.textContent = kind.prefix + Math.round(ev.amount) + (ev.crit ? "!" : "");
    // Position by the CENTER of the square. The CSS shifts it back by half its own
    // width (translateX(-50%)) so the number is centered no matter how wide it is.
    el.style.left = pos.left + "px";
    el.style.top = (pos.top - stack * 11) + "px";     // each extra number starts a bit higher
    // Sideways drift, alternating left/right, so a stack of numbers fans out into a
    // little spray instead of a single column. Read by the CSS animation.
    el.style.setProperty("--fx-drift", ((stack % 2 ? 1 : -1) * (4 + stack * 4)) + "px");
    layer.appendChild(el);

    // Clean up after yourself: the moment the float-and-fade finishes, the element
    // deletes itself. Without this the layer would accumulate thousands of invisible
    // divs over a long fight.
    el.addEventListener("animationend", function () { el.remove(); });
    // Belt and braces. Browsers PAUSE animations on a tab you're not looking at, and a
    // paused animation never fires animationend — so alt-tabbing mid-fight would leave
    // the numbers stuck on the layer forever. A timer doesn't care about visibility.
    // (Removing an already-removed element is harmless, so the two can't conflict.)
    setTimeout(function () { el.remove(); }, FX_NUM_MS + 200);
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
