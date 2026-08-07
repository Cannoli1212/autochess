// fxkits.js — WHAT EACH ABILITY LOOKS LIKE.
//
// The one-line version:
//
//   ABILITIES[kind]  (abilities.js)  says what an ability DOES.
//   FX_KITS[kind]    (this file)     says what it LOOKS LIKE.
//
// Same key, two files, and neither one has to learn the other's job. Retuning a tier
// never touches this file; recolouring a spell never touches abilities.js.
//
// Why its own file rather than a few more lines somewhere existing:
//   * not in fx.js — that file is the drawing TOOLS (fxBeam, fxOrb, the number machine).
//     A forty-entry lookup table dropped in the middle would bury them.
//   * not on RANK_ABILITIES in config.js — the same `kind` shows up under ranks AND
//     uniques AND fusions, so every entry would have to be written out several times,
//     in among the balance numbers where nobody would think to look for a colour.
//
// ── The fields ───────────────────────────────────────────────────────────────
//   color — this ability's signature hue. Used by every shape it draws.
//   icon  — the glyph that pops over the caster when it fires.
//
//     A GLYPH, NEVER A WORD. The board speaks in symbols on purpose: a 56px square has
//     no room for "Hellfire", and by the third fight you read 🔥 faster than you could
//     read the word anyway. The English name still exists — it lives in the hover
//     tooltip, which is where you go when you don't recognise something yet.
//
//   onCast / onKill / onRoundStart — the SHAPE to draw when that hook fires:
//
//     "orb"   a projectile that travels from the caster to its target
//     "beam"  an instant line from the caster to its target
//     "pulse" the icon popping over the caster, no target needed
//     "kit"   the ability's own handler draws it — see below
//
// ── Why "kit" exists ─────────────────────────────────────────────────────────
// runAbilityHook knows the caster and (usually) its target, which is enough to draw an
// ability's ENVELOPE. It is not enough to draw its SHAPE, because the shape is decided
// inside the handler and often at random:
//
//   poisonVolley  pierce depth comes from unit.volleyPierce, baked per unit
//   burnAura      ring size comes from unit.auraRadius, different at every tier
//   fireball      at quads it's board-wide and there IS no single target
//   sniperShot    targets "self", re-aims at the FARTHEST enemy, and can be body-blocked
//   slotMachine   rolls its shape — chain? nova? stun? — inside the handler
//
// A table that tried to re-derive those would have to call unitsAlongLine / enemiesNear /
// firstEnemyOnLine a SECOND time, and the moment someone tuned a tier the picture would
// quietly stop matching the mechanics. So those handlers emit their own shape, passing
// the list of squares they already worked out. They still read their colour from here —
// abilities.js never learns about pixels.
//
// No entry in this table = nothing is drawn automatically, exactly as before.

const FX_KITS = {
  // ── Rank abilities ──────────────────────────────────────────────────────────
  // Ranged 6. "kit", not "orb", because its shape CHANGES with the tier: a pair or trips
  // throws a projectile at one target, but quads is a board-wide nuke with no target at
  // all. Only the handler knows which of those just happened.
  fireball:     { color: "#ff8a50", icon: "🔥", onCast: "kit"   },
  burnAura:     { color: "#ff8a50", icon: "🔥", onCast: "kit"   },  // melee 6 — ring, radius from unit.auraRadius
  poisonVolley: { color: "#ce93d8", icon: "☠",  onCast: "kit"   },  // ranged 9 — pierce line
  poisonNova:   { color: "#ce93d8", icon: "☠",  onCast: "kit"   },  // melee 9 — cloud
  slotMachine:  { color: "#ffd54f", icon: "🎰", onCast: "kit"   },  // rank 7 — the reel picks the shape
  wardCast:     { color: "#cfd8dc", icon: "🛡", onCast: "pulse" },  // rank 5 — self shield
  hasteCast:    { color: "#4fc3f7", icon: "⚡", onCast: "pulse" },  // rank 4 — self speed
  chargeCast:   { color: "#80cbc4", icon: "»»", onCast: "pulse" },  // rank 4 melee — dash burst
  berserker:    { color: "#ff8a80", icon: "🛡", onCast: "pulse" },  // rank 2 — self shield on a full bar
  adrenaline:   { color: "#7bd67f", icon: "⇧",  onCast: "pulse" },
  trapline:     { color: "#ffca28", icon: "✵",  onCast: "pulse" },  // rank 8 melee — lays a forward line
  caltrops:     { color: "#ffca28", icon: "✵",  onCast: "pulse" },  // rank 8 ranged — lays a self ring

  // ── Legendaries ─────────────────────────────────────────────────────────────
  cleric:            { color: "#7bd67f", icon: "✚",  onCast: "beam"  },  // Q♣ — mend beam to the patient
  sniperShot:        { color: "#e8e8e8", icon: "🎯", onCast: "kit"   },  // A♣ — re-aims; can be blocked
  dropAggro:         { color: "#b9c2cf", icon: "◌",  onCast: "pulse" },  // A♠ — vanish
  attackBuffPartner: { color: "#ffd54f", icon: "▲",  onCast: "kit"   },  // K♥ — tether to his Queen
  shieldPartner:     { color: "#cfd8dc", icon: "🛡", onCast: "kit"   },  // Q♥ — tether to her King
  summonOnKill:      { color: "#b39ddb", icon: "✚",  onKill: "pulse" },  // A♥ — a body rose
  // J♣ — the splash already paints a white number on every body it catches (see the cleave
  // kit); this is the icon that says WHICH ability spread them, and at quads it is the only
  // hint that the radius just widened from 8 cells to 24.
  cleave:            { color: "#e8e8e8", icon: "⚔",  onDealDamage: "pulse" },
  // J♥/J♠ — the Bower's rally is a round-start buff, the sneakiest kind: it finishes before
  // you have looked at the board, so a whole suit just IS bigger. The kit's own ▲ bursts mark
  // who was touched; this marks the Jack that did it.
  bower:             { color: "#ffd54f", icon: "⚑",  onRoundStart: "pulse" },
  // Q♥ — her Royal Guard is the least legible thing on the board: hits she "takes" land on
  // her King with nothing linking the two. One ⛨ on her as the fight opens at least says
  // whose ability the redirect belongs to.
  royalGuard:        { color: "#ff8a8a", icon: "⛨",  onRoundStart: "pulse" },
};
