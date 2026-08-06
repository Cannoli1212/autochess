// ── SEEDED RNG ───────────────────────────────────────────────────────────────
// A balance instrument, not a game system. Nothing in the game calls into this
// file: it exists so a sim run can be REPEATED and give the identical answer.
//
// WHY. Every random draw in this codebase is a raw Math.random() — the shuffle
// (cards.js), the deal, crit rolls (combat.js), the Gambler's dice and the
// Slot Machine's reels (abilities.js), joker picks (jokers.js), seat pairing
// (table.js). That's fine for playing, but it means two identical balance scans
// come back a couple of points apart, and you cannot tell a real 3-point shift
// from noise. When the whole point of a change is "did the win rates move?",
// an unrepeatable measurement is not a measurement.
//
// WHY WE SWAP THE GLOBAL instead of threading a generator through call sites:
// there are 20+ raw Math.random() calls across eight files, and a rewrite that
// misses ONE of them produces a run that looks deterministic and isn't — the
// worst possible failure, because it fails silently and you trust the number.
// Replacing the single global cannot miss a site. The cost is that it's a
// monkey-patch, which is why the ONLY supported entry point is `seeded()`: its
// `finally` restores the real Math.random even if the scan throws.
//
// LIVE PLAY IS NEVER SEEDED. Nothing here runs unless you type it in the
// console. A game that dealt the same shoe every session would be broken, so
// there is deliberately no auto-install and no "seeded mode" flag to forget.
//
// USAGE (browser console):
//   seeded(1, function () { return simStrategyScan(300); });  strategyMatrix();
//   seeded(1, function () { return simAIScan(4000, [5]); });  simAISummary();
// Same seed → same numbers, before and after a balance edit.

// An arbitrary but fixed default, so `seeded()` can be called with no seed and
// still be repeatable. It's the golden-ratio constant every mulberry32 example
// uses; there is nothing special about it beyond "not zero".
const RNG_DEFAULT_SEED = 0x9E3779B9;

// mulberry32 — a 32-bit PRNG. Chosen over anything fancier because it is small
// enough to read in one sitting, needs a single 32-bit word of state, and passes
// the only test that matters here: the sequence depends on the seed and repeats
// exactly. Returns a function shaped like Math.random (a float in [0, 1)).
function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The real Math.random, parked here while a seed is installed. Null = not
// installed. Guarding on null (rather than saving unconditionally) means a
// nested rngSeed can't overwrite the saved original with an already-seeded one.
let rngSaved = null;

// Install a seed. Prefer `seeded()` — this is exposed for the console case where
// you want to seed, poke at the game by hand, and restore when you're done.
function rngSeed(seed) {
  if (rngSaved === null) rngSaved = Math.random;
  Math.random = mulberry32(seed === undefined ? RNG_DEFAULT_SEED : seed);
}

// Put the real Math.random back. Safe to call when nothing is installed.
function rngRestore() {
  if (rngSaved !== null) { Math.random = rngSaved; rngSaved = null; }
}

// THE ENTRY POINT. Runs `fn` with the seed installed and guarantees the restore,
// including when `fn` throws — a scan that blows up halfway must not leave the
// live game dealing a fixed shoe for the rest of the session.
function seeded(seed, fn) {
  rngSeed(seed);
  try { return fn(); } finally { rngRestore(); }
}

// True while a seed is installed. Only useful for the "did I leave it on?" check
// after poking around with rngSeed by hand.
function rngIsSeeded() { return rngSaved !== null; }
