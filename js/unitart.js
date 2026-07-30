// unitart.js — WHAT EACH UNIT LOOKS LIKE.
//
// The one-line version, and it is deliberately the same shape as fxkits.js:
//
//   RANK_ABILITIES / UNIQUE_CARDS  (config.js)  say what a unit DOES.
//   UNIT_ART[key]                  (this file)  says what it LOOKS LIKE.
//
// Same keys, two files, neither has to learn the other's job. Retuning a tier never
// touches this file; swapping a sprite never touches config.js.
//
// ── Why a unit needs a picture at all ────────────────────────────────────────
// Until now a unit WAS its rank and suit: "7♠" in a 56px square. That reads fine once
// you have memorised RANK_ABILITIES, and not at all before then — and the colour can't
// help, because all four suits collapse into TWO colours (♥/♦ share #ff8a8a, ♣/♠ share
// #e8e8e8, config.js:19-24). A stranger sat in front of the board could not tell a healer
// from an assassin from a poison carrier.
//
// So: the sprite says what the unit DOES. Rank picks the archetype, because rank IS the
// ability — a 9 poisons, so a 9 looks like a plague bearer. Suit picks melee vs ranged,
// because that is the other thing you need to know at a glance.
//
// ── The rank/suit tag does NOT go away ───────────────────────────────────────
// "7♠" is load-bearing: it is how you read your poker hands off the board, which is the
// core loop. Art is added ALONGSIDE it, never instead of it. The sprite tells you what a
// unit does; the tag tells you what it counts as.
//
// ── This pack is a KIT, not a cast of characters ─────────────────────────────
// Worth knowing before reading the table, because it decides the shape of every entry:
// Kenney's pack does not ship 34 finished heroes. It ships PARTS, and each part occupies
// its own band of an otherwise empty 16×16 tile so the parts stack in place:
//
//   cols  0–1   bare bodies (4 skin tones) + 14 pre-assembled characters
//   cols  6–17  clothing — shirts, robes, plate, capes
//   cols 19–26  hair and beards          cols 28–31  helmets and hoods
//   cols 33–41  shields                  cols 42–53  staves, swords, axes, bows
//
// So a unit's picture is a STACK: body → clothing → hair → helmet → weapon → shield,
// back to front. Weapons must be last-ish; drawn behind the body they vanish completely.
// That's why an entry carries `layers`, not one coordinate — and why 34 genuinely distinct
// units are possible from one 63KB file with no second download and no generated assets.
//
// ── The fields ───────────────────────────────────────────────────────────────
//   layers — [[col,row], …] in BACK-TO-FRONT order, the order you'd dress someone in.
//            Empty or missing = "not assigned yet" → that unit falls back to its text
//            glyph, which is what lets the table be filled a few entries at a time with a
//            working game at every step.
//   name   — the archetype in English, for the hover tooltip. Legendaries DON'T set this:
//            they already have a real name in UNIQUE_CARDS and duplicating it here is
//            just two places to forget to update.

// ── Sheet geometry ───────────────────────────────────────────────────────────
// Kenney "Roguelike Characters" (CC0 — public domain, no attribution required).
// Download: https://kenney.nl/assets/roguelike-characters
//
// ⚠ THESE THREE ARE PROVISIONAL until the pack is actually on disk — they're Kenney's
// usual layout for this pack, but they get verified against the real file before any
// sprite coordinates are assigned. Everything else is derived, so if the sheet turns out
// to be laid out differently, this is the only block that changes.
const ART_SHEET = "assets/kenney-roguelike-characters/Spritesheet/roguelikeChar_transparent.png";
const ART_TILE  = 16;   // one sprite is 16×16 source pixels
const ART_GAP   = 1;    // 1px of spacing between tiles on the sheet
const ART_SCALE = 3;    // drawn at 3× → 48px on screen. Integer scale = crisp pixels.

// One tile's stride on the sheet, and its size on screen. Derived, never typed twice.
const ART_STEP    = ART_TILE + ART_GAP;
const ART_DRAW_PX = ART_TILE * ART_SCALE;

// ── Is the sheet actually there? ─────────────────────────────────────────────
// The game has to keep working with no assets folder at all — that is what makes it safe
// to build this system before the pack is downloaded, and what stops a bad path from
// turning the whole board invisible. Until the image loads, unitArtFor() returns null and
// every unit draws its text glyph exactly as it always did.
//
// The sheet MEASURES ITSELF on load rather than having its dimensions written down here.
// background-size has to be the whole scaled sheet (that's how you scale a spritesheet
// without a transform — see the note in paintUnitNode), and a hardcoded width that
// disagreed with the file would slice every sprite slightly wrong, in a way that looks
// like an art bug rather than a number being stale.
let ART_READY   = false;
let ART_SHEET_W = 0;
let ART_SHEET_H = 0;

(function probeArtSheet() {
  const img = new Image();
  img.onload = function () {
    ART_SHEET_W = img.naturalWidth;
    ART_SHEET_H = img.naturalHeight;
    ART_READY = true;
    // Hand the drawn size to CSS so ART_SCALE above is the ONE place a sprite's size is
    // decided. .fig-glyph.art sizes itself from this and works out its own overhang.
    document.documentElement.style.setProperty("--art-px", ART_DRAW_PX + "px");
    // Units already on the board were drawn as text. Repaint them now that there's art.
    if (typeof render === "function" && !SIM_MODE) render();
  };
  img.onerror = function () {
    // Not an error worth shouting about: no pack yet = text glyphs, same as before.
    console.info("[unitart] no spritesheet at " + ART_SHEET + " — units will use text glyphs.");
  };
  img.src = ART_SHEET;
})();

// ── The table ────────────────────────────────────────────────────────────────
// Three kinds of key, checked most-specific first by unitArtFor():
//
//   "spades-14"  a LEGENDARY, one of the 16 J/Q/K/A. Same key format as UNIQUE_CARDS
//                (config.js:338) on purpose, so uniqueOf() and this table can't drift.
//   "melee-9"    a rank + role. 9 ranks × 2 roles = the 18 commons.
//   "melee"      the never-blank safety net.
const UNIT_ART = {
  // ── The 18 commons: rank = the archetype, role = melee or ranged ────────────
  // Names describe what the PICTURE shows. The real ability names still come from
  // RANK_ABILITIES via figureTitle — this is the visual identity, not a second rulebook.
  //
  // Two rules of thumb learned from actually looking at these at 32px:
  //   * COLOUR is what survives. Weapons and hats are texture at this size; the palette
  //     is what you read across a board. So each rank leans on one colour family.
  //   * Narrow weapons only (staves, swords, daggers, bows all sit in x0–4). Axes and
  //     hammers span x0–7 and crowd the face, so they're saved for the units where
  //     looking heavy IS the point.

  // 2 — Berserker: ramps as it fights, shields itself on a full bar. A brute with an axe.
  "melee-2":  { layers: [[1,3],[6,0],[50,1]],                name: "Berserker" },
  "ranged-2": { layers: [[1,2],[8,0],[23,1],[52,2]],         name: "Berserker" },
  // 3 — Target Dummy + Thorns: zero attack, huge HP, reflects. Deliberately the DRABBEST
  // things on the board — no weapon, no colour. A unit that doesn't fight shouldn't look
  // like it does.
  "melee-3":  { layers: [[1,2],[10,9]],                      name: "Training Dummy" },
  "ranged-3": { layers: [[1,1],[13,9],[28,8]],               name: "Scarecrow" },
  // 4 — Haste + Giant Slayer; melee also gets Kill Dash. Light, fast, teal.
  "melee-4":  { layers: [[1,0],[10,0],[19,0],[44,9]],        name: "Charger" },
  "ranged-4": { layers: [[1,0],[11,0],[19,4],[52,0]],        name: "Skirmisher" },
  // 5 — Ward (self shield) + Slippery (dodge). Steel and white: the survivor.
  "melee-5":  { layers: [[1,0],[10,4],[28,0],[34,1]],        name: "Warden" },
  "ranged-5": { layers: [[1,0],[14,0],[19,8],[53,1]],        name: "Evasive Adept" },
  // 6 — Executioner + Hellfire (ranged projectile) / Hellfire Aura (melee ring). All fire.
  "melee-6":  { layers: [[1,2],[8,8],[23,0],[42,0]],         name: "Flamebearer" },
  "ranged-6": { layers: [[1,0],[6,0],[28,8],[43,0]],         name: "Pyromancer" },
  // 7 — Gambler + Slot Machine: damage rolls on a range. Purple, shifty, hooded.
  "melee-7":  { layers: [[1,0],[15,5],[19,1],[42,9]],        name: "Gambler" },
  "ranged-7": { layers: [[1,0],[14,0],[30,8],[45,9]],        name: "Cardsharp" },
  // 8 — Bulwark + Trapline (melee line) / Caltrops (ranged ring). HORNS — the one
  // silhouette that still reads as "heavy" when the sprite is 32px across.
  "melee-8":  { layers: [[1,0],[11,4],[28,6],[34,1]],        name: "Bulwark" },
  "ranged-8": { layers: [[1,0],[6,4],[30,6],[53,0]],         name: "Caltrop Guard" },
  // 9 — Poison + Poison Volley (ranged pierce) / Miasma (melee cloud). Green, all of it.
  "melee-9":  { layers: [[1,3],[6,5],[31,8],[42,3]],         name: "Plague Bearer" },
  "ranged-9": { layers: [[1,0],[7,5],[31,5],[52,3]],         name: "Venom Archer" },
  // 10 — Rally: buffs whatever stands next to it. Cloak + gold staff = the one that
  // makes others better rather than doing it itself.
  "melee-10":  { layers: [[1,0],[12,9],[29,7],[45,0]],       name: "Standard Bearer" },
  "ranged-10": { layers: [[1,0],[13,9],[31,7],[46,0]],       name: "Herald" },

  // ── The 16 legendaries ──────────────────────────────────────────────────────
  // No `name` — uniqueOf() already has the real one ("Ace of Spades", "Midas King").
  // Here the SUIT picks the colour, which is the one job colour couldn't do anywhere else
  // in this game: ♥/♦ share a unitColor and ♣/♠ share another (config.js:19-24), so on the
  // old board all four suits collapsed into two. Sixteen cards is a small enough set to
  // hand-dress, so the legendaries are where the suits finally get to look like themselves:
  //
  //   ♥ red/orange      ♦ gold/tan      ♣ white/steel      ♠ black
  //
  // and rank escalates the trimmings — Jacks plain, Queens robed, Kings caped or crowned,
  // Aces carrying a CYAN enchanted weapon that nothing else on the board has.
  //
  // No `name` on any of these: uniqueOf() already has the real one.

  // ♥ HEARTS — red
  "hearts-11":   { layers: [[1,0],[6,0],[20,0],[42,6]] },          // One-Eyed Jack (Bower)
  "hearts-12":   { layers: [[0,5],[33,3]] },                       // Royal Guard — she carries the shield she IS
  "hearts-13":   { layers: [[1,2],[8,0],[29,7],[45,6]] },          // Royal Vow — caped king
  "hearts-14":   { layers: [[1,2],[6,8],[19,8],[46,1]] },          // Necromancer — white hair, enchanted staff
  // ♦ DIAMONDS — gold
  "diamonds-11": { layers: [[1,0],[10,5],[28,8],[43,9]] },         // Highwayman — brim hat, knife
  "diamonds-12": { layers: [[1,0],[12,6],[20,4],[45,9]] },         // Heartbreaker — gold dagger
  "diamonds-13": { layers: [[1,0],[12,9],[19,4],[51,6],[33,3]] },  // Midas King — gold hammer AND gold shield
  "diamonds-14": { layers: [[0,11],[33,3]] },                      // Aegis — the armoured knight + a gold boss
  // ♣ CLUBS — white/steel
  "clubs-11":    { layers: [[1,2],[11,4],[29,1],[50,1]] },         // Cleave — the axe is the ability
  "clubs-12":    { layers: [[1,0],[11,9],[20,8],[45,0]] },         // Cleric — white robe, gold staff, holy
  "clubs-13":    { layers: [[1,0],[12,4],[29,0],[51,6]] },         // Airstrike — crested commander
  "clubs-14":    { layers: [[1,0],[13,4],[30,1],[53,4]] },         // Sharpshooter — CYAN bow, board-wide reach
  // ♠ SPADES — black
  "spades-11":   { layers: [[1,0],[15,5],[20,1],[44,6]] },         // One-Eyed Jack (Bower) — J♥'s black twin
  "spades-12":   { layers: [[1,0],[17,5],[30,8],[52,3]] },         // The Black Lady — witch's hat, black bow
  "spades-13":   { layers: [[1,2],[16,5],[28,0],[50,6]] },         // Warlord's Levy — helm + gold axe
  "spades-14":   { layers: [[1,0],[15,5],[19,1],[46,9]] },         // Infiltrator — CYAN dagger in the dark

  // ── The safety net ──────────────────────────────────────────────────────────
  // Hit only if a rank somehow has no entry above (rank 11–14 before slice 3 assigns
  // them, say). A unit must never render blank.
  "melee":  { layers: [[1,0],[10,5],[19,0],[42,6]], name: "Fighter" },
  "ranged": { layers: [[1,0],[11,5],[19,4],[52,0]], name: "Archer"  },
};

// Stamp each entry with the key it was found under. paintUnitNode memoises on this rather
// than on the layer list, so the per-tick repaint compares one short string instead of
// walking an array of pairs sixty times a second.
for (const k in UNIT_ART) UNIT_ART[k].key = k;

// An entry only counts as art once it has a layer stack. Unassigned entries start empty so
// the table can be filled in a few at a time — an unassigned unit quietly keeps its text
// glyph instead of drawing tile (0,0) at every one of them.
function artAssigned(e) {
  return !!e && !!e.layers && e.layers.length > 0;
}

// The art for one unit, most specific first: legendary → rank+role → role.
// Returns null when there is no sheet or no assigned tile, which is the signal to
// paintUnitNode to fall back to the text glyph.
//
// Takes a unit OR a card — both carry suit and rank, which is all this needs. That's the
// same trick figureTitle (abilities.js:1321) uses, and it's what lets the hand draw the
// same picture as the board without a second lookup path.
function unitArtFor(u) {
  if (!ART_READY || !u) return null;
  const role = isRangedSuit(u.suit) ? "ranged" : "melee";
  // (`key` is stamped onto each entry at load, below — it's what paintUnitNode memoises on.)
  // A fused "made hand" isn't a rank any more — it functions as its onto-suit card, so it
  // borrows that unit's picture. Its own identity (the "72♥" tag + the green glow) is
  // already unmistakable, and inventing four more sprites for four rare cards isn't worth it.
  const key = uniqueOf(u) ? (u.suit + "-" + u.rank) : (role + "-" + u.rank);
  const e = UNIT_ART[key] || UNIT_ART[role];
  return artAssigned(e) ? e : null;
}

// The English name for a unit's picture, or "" if it has none. Legendaries answer with
// their real UNIQUE_CARDS name so there is exactly one place a legendary is named.
function unitArtName(u) {
  const uq = uniqueOf(u);
  if (uq) return uq.name;
  const e = unitArtFor(u);
  return e && e.name ? e.name : "";
}

// Dress one DOM element in a unit's whole layer stack.
//
// Two non-obvious things are going on here.
//
// FIRST, THE SCALING. The natural way to blow up a 16px sprite is transform:scale(), and
// it CANNOT be used: .fig-glyph's transform already belongs to playFlinch (board.js:287),
// so a static scale sitting there would be wiped the instant the unit took a hit and the
// sprite would snap to a quarter size mid-fight. Instead the element stays its true drawn
// size and the SHEET is scaled underneath it — background-size blows up the whole image,
// background-position slides the wanted tile into the window. No transform involved.
//
// SECOND, THE LAYERS. One element can hold a whole stack of backgrounds, all pointing at
// the same sheet at the same scale, each sliding a different tile into the same window.
// That is the entire compositing engine: no canvas, no generated atlas, no extra request.
//
// The .reverse() is the catch worth remembering: CSS paints the FIRST background listed on
// TOP, which is the opposite of how you'd describe dressing someone. `layers` is written
// back-to-front (body first, sword last) because that's the readable order, so it gets
// flipped exactly once, here, rather than every author having to think backwards.
function applyUnitArt(el, e) {
  const imgs = [], poss = [];
  const stack = e.layers.slice().reverse();
  for (let i = 0; i < stack.length; i++) {
    imgs.push("url(" + ART_SHEET + ")");
    poss.push("-" + (stack[i][0] * ART_STEP * ART_SCALE) + "px -" + (stack[i][1] * ART_STEP * ART_SCALE) + "px");
  }
  el.style.backgroundImage    = imgs.join(",");
  el.style.backgroundPosition = poss.join(",");
  el.style.backgroundSize     = (ART_SHEET_W * ART_SCALE) + "px " + (ART_SHEET_H * ART_SCALE) + "px";
}
