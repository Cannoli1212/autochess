// config.js — tuning constants & data tables. No logic, no state.
// One place to rebalance the game.

// How big the board is. Change these two numbers to resize the board.
const COLS = 8;
const ROWS = 8;

// Phase B: the four card suits and their stats. Clubs and spades are ranged
// (attack from 3 away); hearts and diamonds are melee (range 1).
// Abilities: hearts tanky (10 HP), diamonds lifesteal (heal on hit), clubs
// fast attacker (attackSpeed > 1), spades 50% crit (2x damage).
// attackSpeed = attacks per base attack period (1 = normal, 1.5 = 50% faster);
// omit to default to 1. Two colors per suit: cardColor reads on the white card,
// unitColor on the dark/colored board cell.
// `abilities` = triggered EFFECTS the combat engine runs via hooks (see
// abilities.js). Only diamonds' lifesteal is one today; crit/attackSpeed/range
// are STATS (plain numbers), not abilities. Phase 1 will let individual cards
// add their own abilities on top of the suit's.
const SUITS = {
  hearts:   { symbol: "♥", cardColor: "#c0392b", unitColor: "#ff8a8a", range: 1, attack: 2, hp: 10, abilities: [], desc: "melee tank" },
  diamonds: { symbol: "♦", cardColor: "#c0392b", unitColor: "#ff8a8a", range: 1, attack: 2, hp: 6, abilities: [{ kind: "lifesteal" }], desc: "melee, lifesteal" },
  clubs:    { symbol: "♣", cardColor: "#222222", unitColor: "#e8e8e8", range: 3, attack: 2, hp: 3, attackSpeed: 1.5, abilities: [], desc: "ranged, fast attacker" },
  spades:   { symbol: "♠", cardColor: "#222222", unitColor: "#e8e8e8", range: 3, attack: 3, hp: 2, crit: 0.5, abilities: [], desc: "ranged, 50% crit" },
};
const SUIT_NAMES = ["hearts", "diamonds", "clubs", "spades"];

// Phase 1 — RANK abilities (2..14). These apply to ALL suits, layered ON TOP of
// the suit's own ability, so e.g. a 3♦ gets both lifesteal (suit) and thorns
// (rank). The params (damage/gain/bonus/chance) are the balance knobs. Kits live
// in abilities.js. Being built low ranks first; unlisted ranks have no ability.
// "Unit identity" Batch A (2026-07-14): most low ranks now PHALANX pack-scale —
// at fight start they count their OWN rank in the poker pool (fielded units + the
// shared flop, same count the poker synergies use) and grow per EXTRA copy. See
// packCount in abilities.js. All the *PerExtra / *Max numbers here are the knobs.
const RANK_ABILITIES = {
  // Rank 2 — BERSERK: gains `gain` of its starting attack EVERY time it's hurt
  // (an infinite ramp — the 2♦ carries it: lifesteal keeps it alive to keep
  // ramping). Pack-scaling: each extra 2 adds `hpPerExtra` max HP (more bulk =
  // more hits survived = more ramp) AND `gainPerExtra` to the per-hit gain.
  // Rank 2 — BERSERK + ADRENALINE (casting, Riley 2026-07-15). The scrappy underdog keeps
  // its "stronger when hurt" ramp AND gains a SELF-cast survival tool. ATTACK-mana
  // (manaPerAttack) so swinging fuels it; when the bar fills it heals itself for `healFrac`
  // of max HP AND boosts its ATTACK by `atkGain` of its STARTING attack (Riley 2026-07-15:
  // scale DAMAGE, not speed — speed also fed the mana-charge snowball, damage is cleaner).
  // Like Berserk, the ramp is additive off a captured base (shared `baseAttack`) so it grows
  // linearly, not compounding — the two attack ramps stack cleanly. Berserk grows attack as
  // it's HIT, Adrenaline grows it as it CASTS and keeps the body alive to keep both going.
  // `castTargeting:"self"` = fires on a full bar, no target needed (handler acts on the caster).
  2:  [{ kind: "berserk",     name: "Berserk",      gain: 0.2, gainPerExtra: 0.05, hpPerExtra: 0.25 },
      { kind: "adrenaline",  name: "Adrenaline",   cast: true, castTargeting: "self",
        manaMax: 50, manaPerAttack: 12, healFrac: 0.15, atkGain: 0.4 }],
  // Rank 3 — TARGET DUMMY: a pure reflect-wall. The `targetDummy` marker makes the
  // card INERT (makeCardOf zeroes its attack + boosts HP by DUMMY_HP_MULT; combatStep
  // skips its turn so it never moves or attacks). Its ONLY output is Thorns, a
  // PERCENTAGE of the damage it takes (`reflect` 0.3 = 30% bounced back) so a bigger
  // hit stings more. HP scaling (Batch A, replaced the count-of-3s version): the
  // reflect climbs by `reflectPer100Hp` per 100 max HP, capped at `reflectMax` —
  // so hearts/diamonds HP synergies fatten the wall AND sharpen its spikes.
  // Baked once at fight start by the thorns onRoundStart hook (see abilities.js).
  3:  [{ kind: "thorns",      name: "Thorns",       reflect: 0.3, reflectPer100Hp: 0.03, reflectMax: 1.0 },
      { kind: "targetDummy",  name: "Target Dummy" }],
  // Rank 4 — GIANT SLAYER + HASTE, with a MELEE move-burst rider (casting, Riley 2026-07-15):
  // keeps the "punch up" bonus vs bigger targets AND the SELF-cast attack-speed buff. Hybrid
  // caster (still auto-attacks, NOT noAutoAttack — Giant Slayer needs swings to matter). ATTACK-
  // mana: each swing banks mana, so the faster it gets the sooner it casts again — a snowball,
  // capped at `speedMax` so the loop can't run away. Reuses the attackSpeed stat only.
  // ROLE split — the ONLY difference is the melee half gets ONE extra thing (everything else is
  // identical for both roles): the melee ♥/♦ 4s ALSO carry `chargeCast` (role "melee"), a small
  // MOVE-SPEED burst so a frontline 4 closes the gap faster, not just swings faster. Charge has
  // no mana profile of its own — it rides the Haste bar (see the chargeCast kit). Ranged ♣/♠ 4s
  // are UNCHANGED (Giant Slayer + Haste, pure fire-rate — a backliner doesn't need to close).
  4:  [{ kind: "giantSlayer", name: "Giant Slayer", bonus: 1.0, bonusPerExtra: 0.5, bonusMax: 3.0 },
      { kind: "hasteCast",   name: "Haste",        cast: true, castTargeting: "self",
        manaMax: 40, manaPerAttack: 10, speedMult: 0.25, speedMax: 4.0 },
      { kind: "chargeCast",  name: "Charge",       role: "melee",
        stepGain: 1, stepMax: 2 }],
  // Rank 5 — SLIPPERY + WARD (casting, Riley 2026-07-15): the 5s are now DEFENSIVE
  // attackers, not pure mages (Fireball moved to the devil-themed 6s). They auto-attack
  // normally and keep the Slippery dodge, but on a REGEN-mana clock they self-cast Ward: a
  // SHIELD worth `shieldFrac` of their max HP, banked on the existing u.shield damage pool
  // (soaks hits before HP, exactly like the Ace of Diamonds' Aegis). Scaling with maxHp
  // differentiates the four 5s for FREE — ♥5 (most HP) throws the fattest shield, ♠5 the
  // thinnest. `castTargeting:"self"` fires on a full bar with no target. Reuses the shield pool.
  5:  [{ kind: "slippery",    name: "Slippery",     chance: 0.35 },
       { kind: "wardCast",    name: "Ward",         cast: true, castTargeting: "self",
         manaMax: 50, manaRegen: 8, shieldFrac: 0.5 }],
  // Rank 6 — EXECUTIONER + HELLFIRE, now SPLIT BY ROLE (casting, Riley 2026-07-15): the DEVIL
  // rank. All four 6s keep the Executioner passive (autos on targets at/below `threshold` of max
  // HP are EXACTLY lethal, through Bulwark and shields) — it has NO `role`, so it lands on every
  // suit. The CAST differs by whether the suit is melee or ranged (see isRangedSuit / the role
  // filter in unitAbilities), because a devil in the back line lobs fire while a devil in the
  // scrum radiates it:
  //   • RANGED ♣/♠ → "Hellfire" projectile (the fireball kit, unchanged): `spellPower` × attack
  //     to a target within castRange, then `splashMult` of that to enemies within `radius`.
  //   • MELEE ♥/♦ → "Hellfire Aura" (burnAura kit): a SELF-centered burst that scorches every
  //     enemy within `radius` of the caster for `spellPower` × attack. No target needed
  //     (castTargeting "self"), so it fires the instant the bar fills — the melee 6 is already
  //     surrounded, so being in the fray IS the aim. spellPower is lower than Hellfire's on
  //     purpose: it hits a whole ring, not one target.
  // Both are HYBRID casters (still auto-attack, so Executioner keeps procing — NOT noAutoAttack)
  // and both charge on ATTACK-mana (the devil banks fire by swinging).
  6:  [{ kind: "executioner", name: "Executioner",  threshold: 0.3 },
      { kind: "fireball",    name: "Hellfire",     role: "ranged", cast: true, castTargeting: "enemy",
        manaMax: 60, manaPerAttack: 15, castRange: 4, spellPower: 2.0, radius: 1, splashMult: 0.5 },
      { kind: "burnAura",    name: "Hellfire Aura", role: "melee",  cast: true, castTargeting: "self",
        manaMax: 60, manaPerAttack: 15, radius: 1, spellPower: 0.6 }],
  // Rank 7 — GAMBLER + SLOT MACHINE (casting, Riley 2026-07-15): keeps the on-hit Gambler (every
  // hit rolls a random damage factor `min`..`max`; the floor ramps `rampPerHit`/hit; fully ramped
  // it pickpockets `stealAmount` chips, 7♦ +`diamondBonus`) AND gains a hybrid ATTACK-mana cast.
  // Each full bar SPINS one random reel (uniform) from `slots` — the whole rank leans into the
  // gambling theme. Every reel reuses an existing primitive so the kit is pure dispatch (see
  // slotMachine): hellfire (single-target nuke), chain (bouncing bolt, decays `falloff`/jump up to
  // `jumps` bounces within `jumpRange`), stun (freeze `ticks`), plague (poison `stacks`), heal
  // (mend most-wounded ally for healPower×attack). Magnitudes are FIRST-PASS — tune by playtest.
  // NOTE the 6-7 fusion authors its OWN ability list, so slotMachine does NOT leak into it.
  7:  [{ kind: "gambler",     name: "Gambler",      min: 0.5, max: 2.0, rampPerHit: 0.15,
         stealChance: 0.25, stealAmount: 5, diamondBonus: 3 },
      { kind: "slotMachine", name: "Slot Machine", cast: true, castTargeting: "enemy",
        manaMax: 60, manaPerAttack: 15, castRange: 5,
        slots: [
          { effect: "hellfire", spellPower: 2.5 },
          { effect: "chain",    spellPower: 1.5, jumps: 3, jumpRange: 3, falloff: 0.7 },
          { effect: "stun",     ticks: 8 },
          { effect: "plague",   stacks: 20 },
          { effect: "heal",     healPower: 4.0 },
        ] }],
  // Rank 8 — BULWARK: flat `reduce` off every incoming hit (engine floors hits at
  // 1, never immune). Pack-scaling: +`reducePerExtra` per extra 8.
  // Rank 8 — BULWARK + TRAPLINE (casting Slice 1, Riley 2026-07-15): the 8s keep their
  // flat damage-reduction tank identity AND gain a CAST. They still auto-attack (NOT
  // noAutoAttack — a hybrid caster); on a deliberately SLOW mana clock they lay a line of
  // single-use traps one cell TOWARD the enemy. An enemy that steps on a trap takes
  // `damage` (minimal — the trap is about zoning, not killing) and is SLOWED for
  // `slowTicks`. PACK-SCALING off how many 8s are pooled (packCount - 1 extras): the line
  // WIDENS by `widthPerExtra` (capped at `widthMax`) and the slow lasts `slowPerExtra`
  // longer — a stack of 8s lays a whole "wall of tar." `castTargeting:"self"` = fires
  // whenever the bar fills, no enemy target needed. Slow cast on purpose so uncapped traps
  // can't carpet the board (Riley's call). Baked at round start by trapline.onRoundStart.
  // ROLE split (casting, Riley 2026-07-15): all four 8s keep the Bulwark tank passive (no
  // `role`). The trap CAST differs by where the tank stands — Trapline lays a forward line
  // (useful at the FRONT), so it's mechanically wasted on a backliner whose "one row forward"
  // lands in its own empty territory. So:
  //   • MELEE ♥/♦ → "Trapline" (unchanged): a forward minefield the frontline tank plants as it
  //     advances, right in the contested lane where enemies walk.
  //   • RANGED ♣/♠ → "Caltrops" (caltrops kit): a trap RING around itself — a defensive
  //     perimeter that bites anything DIVING the backline tank, placed where a backliner needs
  //     it. Same trap system (dropTrap + the combatStep trap pass), just ring geometry.
  // Both are self-cast on the SAME slow regen clock (traps can't carpet the board), and both
  // pack-scale their damage/slow off how many 8s are pooled (baked in onRoundStart).
  8:  [{ kind: "bulwark",     name: "Bulwark",      reduce: 15, reducePerExtra: 10 },
      { kind: "trapline",    name: "Trapline",     role: "melee", cast: true, castTargeting: "self",
        manaMax: 80, manaRegen: 8, manaStart: 0,
        lineWidth: 1, widthPerExtra: 1, widthMax: 5,
        damage: 15, damagePerExtra: 5,
        slowTicks: 12, slowPerExtra: 6 },
      { kind: "caltrops",    name: "Caltrops",     role: "ranged", cast: true, castTargeting: "self",
        manaMax: 80, manaRegen: 8, manaStart: 0,
        radius: 1, damage: 15, damagePerExtra: 5,
        slowTicks: 12, slowPerExtra: 6 }],
  // Rank 9 — POISON: each hit applies `stackDamage` damage-per-tick to the victim.
  // Pack-scaling: each stack is `stackPerExtra` fatter per extra 9. PLAGUE rank-up
  // (Batch B): with `transferAt`+ nines in the pool, a poisoned unit that DIES
  // passes `transferPct` of its stacks to its nearest living teammate — and the
  // plague keeps jumping down the line as they fall.
  // Rank 9 — POISON, now SPLIT BY ROLE (casting, Riley 2026-07-15). All four 9s keep the
  // single-target poison-on-hit passive (no `role`, so it lands on every suit — with the
  // pack-scaled stack fattening + the PLAGUE-jump, `transferAt`+ nines pass poison to a dying
  // victim's nearest teammate). The CAST differs by delivery, the same melee/ranged split as
  // the rank-6 devils — a backline poisoner rakes a line, a frontline poisoner exhales a cloud:
  //   • RANGED ♣/♠ → "Poison Volley" (poisonVolley kit, unchanged): a piercing arrow down a
  //     straight 8-direction line THROUGH the aimed target, poisoning it plus every enemy
  //     behind it (pack-scaled `pierce` depth), each for `poisonStack × stackMult` stacks.
  //   • MELEE ♥/♦ → "Miasma" (poisonNova kit): a SELF-centered cloud that poisons every enemy
  //     within `radius` of the caster for `poisonStack × stackMult` stacks. No target needed
  //     (castTargeting "self"), fires the instant the bar fills. Lower stackMult than the
  //     Volley on purpose — it rots a whole ring, not a single file.
  // Both are hybrid ATTACK-mana casters (normal shots/swings charge the bar; still auto-attack),
  // both reuse `poisonStack` (baked by poison.onRoundStart) and applyPoison (so both inherit the
  // plague-jump). `castRange` gives the ranged Volley reach; the melee cloud needs none.
  9:  [{ kind: "poison",      name: "Poison",       stackDamage: 5, stackPerExtra: 3,
         transferPct: 0.5, transferAt: 3 },
      { kind: "poisonVolley", name: "Poison Volley", role: "ranged", cast: true, castTargeting: "enemy",
        manaMax: 60, manaPerAttack: 20, castRange: 5,
        pierce: 2, piercePerExtra: 1, pierceMax: 6, stackMult: 2.0 },
      { kind: "poisonNova",  name: "Miasma",        role: "melee",  cast: true, castTargeting: "self",
        manaMax: 60, manaPerAttack: 20, radius: 1, stackMult: 1.5 }],
  // Rank 10 — RALLY (Batch C rework, was a team-wide +30% attack): an ADJACENCY
  // aura — at fight start it buffs allies within `radius` cells, and each SUIT'S
  // 10 rallies a different stat (the connector card, now with four faces):
  //   10♥ neighbors +`hpMult` HP · 10♠ +`critBonus` crit · 10♣ +`speedMult`
  //   attack speed · 10♦ GRANTS neighbors lifesteal for the fight.
  // Pack-scaling: magnitudes × (1 + `perExtra` per extra 10 in the pool) — the ♦
  // grant is on/off, so more 10♦s pay in coverage instead. Baked ONCE at round
  // start from PLACEMENT positions — where you drop your 10 matters now.
  10: [{ kind: "rally",       name: "Rally",        radius: 1, perExtra: 0.5,
         suits: { hearts:   { hpMult: 0.4 },
                  spades:   { critBonus: 0.25 },
                  clubs:    { speedMult: 0.3 },
                  diamonds: { grantLifesteal: true } } }],
};

// Phase 1 — UNIQUE cards: abilities tied to ONE specific suit+rank combo (not all
// suits of a rank like RANK_ABILITIES, not all ranks of a suit like SUITS). This
// is the third and MOST specific ability layer, layered ON TOP of the suit's and
// the rank's abilities. Keyed by "suit-rank" (e.g. "spades-14"). The J/Q/K/A
// legendaries will all live here — each new one is just another entry.
//
// Ability KINDS now come in two families:
//   • combat hooks (onAttack, onDamaged, ...) — run DURING the battle (abilities.js).
//   • PLACEMENT rules — read at drop time, NOT during combat. A `placement:"anywhere"`
//     entry lets a card ignore the own-zone restriction (see canPlaceAt in placement.js).
const UNIQUE_CARDS = {
  // Ace of Spades — "Infiltrator": a range-3 crit carry (spade) at max rank that
  // can be dropped ANYWHERE, even deep in the enemy's zone, to snipe their squishy
  // backline before it acts. Glass cannon (spade = 2 base HP) so a greedy dive just
  // feeds it to the enemy — the risk is the balance. Still costs one of your unit
  // slots this round (countUnits is by team, not zone), so it's never a free body.
  "spades-14": {
    name: "Ace of Spades",
    abilities: [{ kind: "infiltrator", placement: "anywhere" }],
    blurb: "Infiltrator — place anywhere, even the enemy's side",
  },

  // Ace of Clubs — "Sharpshooter": a club (fast attacker) with UNLIMITED range.
  // `range` is a STAT override read at unit-build time (see buildUnit): the whole
  // board is 8×8, so the farthest two cells are 7 apart — a range of COLS+ROWS (16)
  // reaches every square, letting it open fire on turn one from its own back corner.
  // Ace of Clubs — "Sharpshooter": unlimited range (a STAT override, see buildUnit)
  // but a SLOW rate of fire. `attackSpeed` is a unique override read at unit-build
  // time and in applySynergies — it REPLACES the club suit's fast 1.5 with a sniper's
  // 0.5 (fires every 4 ticks vs a normal unit's 2), so its board-wide reach is paid
  // for by low DPS. The club team speed synergy still ADDS on top (its flush reward).
  "clubs-14": {
    name: "Ace of Clubs",
    abilities: [],
    range: COLS + ROWS,
    attackSpeed: 0.5,
    blurb: "Sharpshooter — hits anywhere on the board, but fires slowly",
  },

  // Ace of Diamonds — "Aegis": a diamond (lifesteal melee) that also banks a SHIELD
  // on every kill, worth half the slain unit's max HP. The shield is a damage pool
  // (see combat.js) that soaks hits before HP — so as it cuts through the enemy line
  // it snowballs into a tankier and tankier body. fraction = the balance knob.
  "diamonds-14": {
    name: "Ace of Diamonds",
    abilities: [{ kind: "shieldOnKill", fraction: 0.5 }],
    blurb: "Aegis — on a kill, gain a shield worth half the victim's HP",
  },

  // Ace of Hearts — "Necromancer": a heart (melee tank) that SUMMONS on kill. Each
  // time it slays a unit it pulls one RANDOM card off its owner's bench and drops it
  // as a fresh unit on the nearest empty cell — a free body that does NOT count
  // against the round's unit cap. Does nothing if the bench is empty or no cell is
  // free nearby. Turns a tanky bruiser into an army-in-a-can if it can keep killing.
  "hearts-14": {
    name: "Ace of Hearts",
    abilities: [{ kind: "summonOnKill" }],
    blurb: "Necromancer — on a kill, summon a random bench card nearby",
  },

  // King & Queen of Hearts — "The Royal Couple": an ASYMMETRIC bond that only
  // matters when BOTH are fielded (each looks the other up by rank via
  // livingPartner). The Queen gains +1 range (rangeBonus) and, while her King
  // lives, redirects EVERY hit she'd take onto him (resolved in attackTarget by
  // royalSink — his own shield/HP soak it). When the King dies, his Royal Vow
  // grants her invulnerability for invulnTicks ticks. Combat runs one tick per
  // 500ms, and the stamp is checked as `tickCount < invulnUntil`, so a 4-tick
  // stamp shields her for ~3 attack windows ≈ 1.5s. A lone Queen still gets the
  // +1 range; the redirect/invuln simply never trigger without her King.
  "hearts-12": {
    name: "Queen of Hearts",
    rangeBonus: 1,
    abilities: [{ kind: "royalGuard", partnerRank: 13 }],
    blurb: "Royal Guard — her King takes her hits; when he falls, she's briefly invulnerable",
  },
  "hearts-13": {
    name: "King of Hearts",
    abilities: [{ kind: "royalVow", partnerRank: 12, invulnTicks: 4 }],
    blurb: "Royal Vow — bodyguards the Queen of Hearts; his death makes her untouchable for ~1.5s",
  },

  // King of Spades — "Warlord's Levy": a spade (crit carry) whose attack scales,
  // uncapped, with every low card (rank 2-5) you've played all game. See the
  // warlordLevy kit; perCard is the per-card attack bonus (0.10 = +10% each).
  "spades-13": {
    name: "King of Spades",
    abilities: [{ kind: "warlordLevy", perCard: 0.10 }],
    blurb: "Warlord's Levy — +10% attack for every 2-5 card you've played this game",
  },

  // King of Clubs — "Airstrike": a PLACEMENT ability (not a combat hook). While
  // fielded it lets its owner mark up to `squares` cells on the enemy's zone during
  // planning — blind, before the enemy army is revealed. At Round Start any enemy
  // unit caught on a marked square is destroyed before the fight. See strikeAllowance
  // (reads this off fielded units) and resolveStrikes (applies it).
  "clubs-13": {
    name: "King of Clubs",
    abilities: [{ kind: "airstrike", squares: 3 }],
    blurb: "Airstrike — mark 3 enemy squares; units caught there die before the fight",
  },

  // King of Diamonds — "Midas King": a diamond (the wealth suit) whose attack scales
  // with his owner's CHIP stack — a snowball carry that rewards winning early (win
  // rounds → steal chips → he hits harder). `baseline` is the neutral chip count
  // (both players start there, so he's normal at game start); `perChip` is the bonus
  // per chip above/below it; `floor` keeps him at least this fraction when broke.
  // See the midasKing kit. Balance is deliberately conservative — tune later.
  "diamonds-13": {
    name: "King of Diamonds",
    abilities: [{ kind: "midasKing", perChip: 0.005, baseline: 100, floor: 0.25 }],
    blurb: "Midas King — attack scales with your chip stack (richer = deadlier)",
  },

  // The ONE-EYED JACKS (J♥ and J♠, drawn in profile) — "Bowers". Each empowers its
  // SAME-COLOR sibling suit, and the buff hits BOTH boards (no team filter in the
  // bower kit), so the card rewards out-building the enemy in that color. Each jack
  // declares which stat it pumps; mults are the balance knobs (tune later).
  //   J♥ (red)  → Diamonds gain HP (props up the squishy lifesteal suit).
  //   J♠ (black)→ Clubs gain attack speed (leans into the fast suit).
  // The two-eyed jacks (J♦, J♣) stay open for their own designs.
  "hearts-11": {
    name: "Jack of Hearts",
    abilities: [{ kind: "bower", buffSuit: "diamonds", hpMult: 1.0 }],
    blurb: "One-Eyed Jack — rallies ALL diamonds (both sides): +100% HP",
  },
  "spades-11": {
    name: "Jack of Spades",
    abilities: [{ kind: "bower", buffSuit: "clubs", speedMult: 0.5 }],
    blurb: "One-Eyed Jack — rallies ALL clubs (both sides): +50% attack speed",
  },

  // The TWO-EYED JACKS (J♦ and J♣). Diamonds keep the ECON identity (like the Midas
  // King); clubs go MARTIAL.
  //   J♦ loot: while FIELDED (played this round), your team steals stealMult more
  //      chips on a round win — read in finishRound via teamLootMult.
  //   J♣ cleave: each of its hits also deals cleaveMult of the damage to enemies
  //      within `radius` cells of the target (onDealDamage kit).
  "diamonds-11": {
    name: "Jack of Diamonds",
    abilities: [{ kind: "loot", stealMult: 0.5 }],
    blurb: "Highwayman — field him and your team steals +50% chips on a round win",
  },
  "clubs-11": {
    name: "Jack of Clubs",
    abilities: [{ kind: "cleave", cleaveMult: 0.5, radius: 1 }],
    blurb: "Cleave — attacks also hit enemies next to the target for 50% damage",
  },

  // Queen of Spades — "The Black Lady" (Hearts' 13-point penalty card): a perfectly
  // good spade to PLAY, but a curse to HOLD — and you CAN'T just throw her away. She
  // is `undiscardable` (see cardCannotDiscard): left unheld she is force-kept into
  // your next hand instead of going to the discard pile, so the ONLY way to be rid of
  // her is to FIELD her. Meanwhile houseTax bleeds you `penalty` chips to the house at
  // every round end she's still in hand (see handTax / finishRound). Play her or pay her.
  "spades-12": {
    name: "Queen of Spades",
    abilities: [{ kind: "houseTax", penalty: 10, undiscardable: true }],
    blurb: "The Black Lady — you can't discard her; play her or bleed 10 chips a round to the house",
  },

  // Queens of Diamonds & Clubs — "Extinguishers": tech COUNTERS that snuff out an
  // enemy suit's flush synergy (each kills her same-color sibling suit's team buff).
  // Enemy-side only, read by isSuitExtinguished in teamSynergyEffects. She only needs
  // to be FIELDED at round start (synergies bake before combat), so she needn't
  // survive. A hard counter: brutal vs that archetype, dead if they don't run it.
  "diamonds-12": {
    name: "Queen of Diamonds",
    abilities: [{ kind: "extinguish", suit: "hearts" }],
    blurb: "Heartbreaker — shuts off the enemy's ♥ heart synergy (their team HP buff)",
  },
  // Queen of Clubs — "Usurper & Cleric": keeps her tech-counter (snuff the enemy's ♠ crit
  // flush) AND gains a heal (casting Slice 2, Riley 2026-07-15). As a club she auto-attacks
  // fast and banks mana per swing (attack-mana model, manaPerAttack) — when the bar fills she
  // mends her most-wounded ally in range for healPower × her attack. She's the first hybrid
  // ATTACK-mana caster and the first support/heal cast. castAbilityOf returns the cleric
  // entry (extinguish has no `cast`), so buildUnit stamps her mana profile from it.
  "clubs-12": {
    name: "Queen of Clubs",
    abilities: [
      { kind: "extinguish", suit: "spades" },
      { kind: "cleric", name: "Cleric", cast: true, castTargeting: "ally",
        manaMax: 60, manaPerAttack: 20, castRange: COLS + ROWS, healPower: 5.0, attackMult: 0.4 },
    ],
    blurb: "Usurper & Cleric — a board-wide HEALER (mends her most-wounded ally each cast) who hits soft; also snuffs the enemy's ♠ crit",
  },
};

// B5 suit synergies. Count a player's units of each suit; 2 / 3 / 5 give tiered
// buffs (5 = a poker FLUSH). ALL FOUR suits now buff the WHOLE team (Part 1,
// 2026-07-10). Effects are baked into units at Round Start by applySynergies().
// BREAKPOINTS 2/3/5 (Riley, 2026-07-15, was 2/4/5): the middle tier now unlocks at
// THREE of a suit instead of four. The tier is the FLUSH synergy — poker flush lives
// ONLY here (no separate per-card flush), so a straight flush = this suit buff PLUS
// the rank-axis straight buff, both fire (see POKER_HANDS.shaped). Magnitudes are the
// old 4-unit numbers reused at the 3 breakpoint (so the middle tier is easier to hit
// now) — expect to retune down after a playtest.
const SYNERGIES = {
  hearts:   { label: "♥", color: "#ff8a8a", scope: "team",
    tiers: { 2: { hpMult: 1.0, text: "+100% team HP" },
             3: { hpMult: 2.5, text: "+250% team HP" },
             5: { hpMult: 6.0, text: "FLUSH: +600% team HP" } } },
  spades:   { label: "♠", color: "#e8e8e8", scope: "team",
    tiers: { 2: { critBonus: 0.30, text: "team crit +30%" },
             3: { critBonus: 0.60, text: "team crit +60%" },
             5: { critBonus: 1.00, text: "FLUSH: team always crits" } } },
  diamonds: { label: "♦", color: "#ff8a8a", scope: "team",
    tiers: { 2: { atkMult: 0.5, text: "team +50% attack" },
             3: { atkMult: 1.5, text: "team +150% attack" },
             5: { atkMult: 4.0, text: "FLUSH: team +400% attack" } } },
  clubs:    { label: "♣", color: "#e8e8e8", scope: "team",
    // Halved 2026-07-14 (was 0.5/1.0/2.0): +200% speed on top of clubs' base 1.5 was
    // the strongest synergy in the game and kept ♣ the #1 suit even after the melee
    // buffs. Bump back up if clubs fall too far.
    tiers: { 2: { speedBonus: 0.25, text: "team +25% attack speed" },
             3: { speedBonus: 0.5, text: "team +50% attack speed" },
             5: { speedBonus: 1.0, text: "FLUSH: team +100% attack speed" } } },
};

// B6 poker-hand synergies — a SECOND synergy axis, read from RANKS (suits stay
// their own system). The "pool" for a player = their placed units + the shared
// flop (Texas Hold'em: units are your hole cards, the flop is community).
// SCOPE is PER-CARD: an of-a-kind buffs only the units of that rank, not the
// team (suits = team auras, poker = targeted spikes). Effects applied in a later
// chunk; chunk 1 only detects + displays. Rewards are first-pass, tune later.
const POKER_HANDS = {
  // Of-a-kind: N cards sharing a rank. Keyed by count → pair(2)/trips(3)/quads(4).
  ofAKind: {
    2: { label: "Pair",  atkMult: 0.5, hpMult: 0.5, text: "+50% atk/HP" },
    3: { label: "Trips", atkMult: 1.5, hpMult: 1.5, text: "+150% atk/HP" },
    4: { label: "Quads", atkMult: 4.0, hpMult: 4.0, text: "+400% atk/HP" },
  },
  // Named hands: detected by which ranks are present in the pool (any count ≥1).
  // Doyle Brunson = a 10 AND a 2 (combat buff, chunk 2); 7-2 = a 7 AND a 2
  // (BONUS CHIPS on a win — economy, wired later, not a combat buff).
  named: {
    // Doyle = a per-card bruiser buff on your 10 & 2 units (Riley, 2026-07-10).
    doyle:    { ranks: [10, 2], label: "Doyle Brunson", atkMult: 1.0, hpMult: 1.0,
                text: "+100% atk/HP on your 10s & 2s" },
    sevenTwo: { ranks: [7, 2],  label: "7-2",           text: "bonus chips on win" },
  },
  // Shaped hands (Riley, 2026-07-15) — detected by hand SHAPE, not just "which ranks
  // are present" like the named hands above. PER-CARD like of-a-kind: the buff lands
  // ONLY on the units that actually FORM the hand — the run's ranks (straight) or the
  // 3+2 ranks (full house) — never the whole team. Both read the poker POOL (non-fused
  // units + the shared flop), so a community flop card can complete your straight or
  // full house, exactly like Doyle. NOTE there is NO poker "flush" here — a flush is
  // ONLY the suit synergy (SYNERGIES, 5 of a suit), so nothing double-dips. A STRAIGHT
  // FLUSH still earns BOTH: its 5 consecutive same-suit cards trigger this straight AND
  // the suit flush — two separate achievements. Numbers are FIRST-PASS; tune by playtest.
  shaped: {
    // Straight has two BREAKPOINTS (Riley, 2026-07-15): a "small straight" of 3 in a
    // row for a taste, a full straight of 5 for the payoff. Highest run wins its tier
    // (a 5-run is a full straight, not also a small one) — see bestStraight/pokerBuffs.
    straight: {
      label: "Straight",
      small: { atkMult: 0.4, hpMult: 0.4, text: "+40% atk/HP to the run" },   // 3–4 in a row
      full:  { atkMult: 0.9, hpMult: 0.9, text: "+90% atk/HP to the run" },   // 5 in a row
    },
    fullHouse: { label: "Full House", atkMult: 1.5, hpMult: 1.5, text: "+150% atk/HP to the 3+2" },
  },
};

// FUSION ("made hands") — during placement you may drag one hand card onto a
// partner to FUSE the pair into ONE special unit. Keyed like POKER_HANDS.named;
// `ranks` is the unordered pair that fuses. A fused unit inherits BOTH ranks'
// abilities (e.g. 7-2 = Gambler + Berserk on one body) AND both suit families,
// so its stats are TAXED below the two cards' straight sum — the ability load is
// the payoff, not raw power. Each hand is balanced on ITS OWN knobs (Riley,
// 2026-07-14): no single global tax. Fusion is PERMANENT (the fused card carries
// its two originals inside it and travels the shoe as one card — see fuseCards)
// and SELF-CONTAINED (it never feeds other units' poker pairs, nor takes of-a-kind
// buffs — see pokerPool / applySynergies). Knobs, all first-pass, tune by playtest:
//   atkMult / hpMult — multiply the SUM of the two parts' stats (<1 = the tax).
//   bonusChips       — extra chips stolen on a win when this fused hand was PLAYED
//                      (its economy identity; bigger than the loose 7-2's 20).
// A fusion may carry an `abilities` list. When it does, that authored kit REPLACES
// the default "staple both parents' rank abilities together" behavior (see
// unitAbilities) — so a fusion can be a genuinely NEW unit (escalating thorns)
// rather than the sum of its parts. Omit it (like 7-2 below) to keep the staple.
// `offsuitOnly: true` makes the pair refuse to fuse unless the two cards are
// DIFFERENT suits (enforced in fusableKeyFor).
const FUSABLE_HANDS = {
  // The 7-2 — the "worst hand" played with swagger. Gambler (high-variance hits) +
  // Berserk (ramps attack as it's hurt) make a scary carry IF it lives; the stat
  // tax + one-body fragility (focus-fire / execute) is the price. Attack is taxed
  // harder than HP — a glass cannon that gambles, not a bruiser.
  sevenTwo: { ranks: [7, 2], label: "7-2", atkMult: 0.75, hpMult: 0.85, bonusChips: 40 },

  // 2-3 "Dirty Diaper" (Berserk × Thorns) — a reflect WALL whose spikes get sharper
  // every hit it eats: Berserk's "stronger when hurt" spent on the Thorns reflect %
  // instead of on attack. Offsuit-only (a "dirty" mismatched pair). Tanky body
  // (light HP tax) but a weak hitter (heavy attack tax) — it wins by being hit.
  // Drops the rank-3 Target Dummy marker, so unlike a raw wall it is NOT inert.
  twoThree: {
    ranks: [2, 3], label: "2-3", atkMult: 0.6, hpMult: 0.9, bonusChips: 30,
    offsuitOnly: true,
    abilities: [
      { kind: "dirtyDiaper", name: "Dirty Diaper",
        reflect: 0.3, reflectPer100Hp: 0.03, reflectMax: 1.0,   // starting spikiness (Thorns' formula)
        rampPerHit: 0.08, rampCap: 1.5 },                        // +8% reflect per hit taken, up to 150%
    ],
  },

  // 6-7 "Double or Nothing" (Gambler × Executioner) — a high-variance assassin.
  // The Gambler roll decides the damage AND the finish: a JACKPOT roll (>= jackpotAt)
  // becomes a guaranteed execute, lethal through Bulwark/shields. The Gambler's
  // floor still ramps, so late-fight jackpots (and executes) grow more common — the
  // core balance knob is jackpotAt (1.85) vs the Gambler's max (2.0). Glass-cannon
  // stat tax. Order matters: the Gambler entry sits BEFORE jackpotExecute so the
  // rolled multiplier (ctx.rollFactor) exists when the jackpot check reads it.
  sixSeven: {
    ranks: [6, 7], label: "6-7", atkMult: 0.7, hpMult: 0.75, bonusChips: 40,
    abilities: [
      { kind: "gambler", name: "Gambler", min: 0.5, max: 2.0, rampPerHit: 0.1,
        stealChance: 0.25, stealAmount: 5, diamondBonus: 3 },
      { kind: "executioner", name: "Executioner", threshold: 0.3 },
      { kind: "jackpotExecute", name: "Jackpot", jackpotAt: 1.85 },
    ],
  },

  // 10-2 "The Brunson" (Rally × Berserk) — Doyle Brunson won two WSOP Main Events
  // on 10-2, so the trash hand is a WIN-THE-WHOLE-THING banner. Keeps rank 10's
  // pre-battle Rally aura (its ONTO-suit picks the buffed stat, exactly like a real
  // 10) AND radiates rank 2's "stronger when hurt": every hit it eats pumps attack
  // into itself and nearby allies (see the `warpath` kit). Bruiser tax — it needs to
  // survive up front to keep bleeding for the squad. Order-independent: rally bakes
  // at round start, warpath fires on damage, so the two never race.
  tenTwo: {
    ranks: [10, 2], label: "10-2", atkMult: 0.85, hpMult: 0.9, bonusChips: 30,
    abilities: [
      // Rank-10 Rally aura — pack-scaling OFF (perExtra 0) so a fusion's ambiguous
      // rank (whichever card was dragged onto) can't skew the aura's magnitude.
      { kind: "rally", name: "Rally", radius: 1, perExtra: 0,
        suits: { hearts:   { hpMult: 0.4 },
                 spades:   { critBonus: 0.25 },
                 clubs:    { speedMult: 0.3 },
                 diamonds: { grantLifesteal: true } } },
      { kind: "warpath", name: "Warpath", radius: 1, gain: 0.2, allyGain: 0.1 },
    ],
  },
};

// Attack pacing: a unit builds "attack charge" by its attackSpeed each tick and
// strikes when charge reaches ATTACK_PERIOD. At attackSpeed 1 that's one hit
// every 2 ticks (today's speed); attackSpeed 2 fills it every tick, etc.
const ATTACK_PERIOD = 2;

// Same idea for movement: 1 = step every other tick (half move speed), 0 = step
// every tick (full speed). Set to 0 (2026-07-14) so melee closes twice as fast —
// it spends half as long walking into free ranged fire. Balance knob for the
// ranged-vs-melee gap; bump back toward 1 if melee over-corrects.
const MOVE_COOLDOWN_TICKS = 0;

// SLOW status (rank 8 Trapline): while a unit is slowed (tickCount < unit.slowUntil),
// it uses THIS move cooldown instead of MOVE_COOLDOWN_TICKS — so a slowed unit waits
// this many ticks between steps. 2 = roughly a third of normal walk speed. The slow's
// DURATION (how long slowUntil lasts) is set per-trap in the rank-8 ability, not here;
// this is only "how hard does a slow bite while it's active."
const SLOW_MOVE_COOLDOWN = 2;

// How many ticks a one-shot visual FLASH lingers (cast glow, spell/trap hit burst,
// heal pulse). At 500ms/tick, 1 tick was blink-and-miss; 3 ≈ 1.5s so effects are
// actually watchable during a live fight. Pure cosmetics — no gameplay effect.
const FLASH_TICKS = 3;

// Global stat multiplier (B4). Final stat = suitBase × rank × STAT_SCALE.
// Bump to 100 for even bigger numbers, or 1 to shrink — one knob.
const STAT_SCALE = 10;

// Rank 3 "Target Dummy" HP multiplier: a wall trades ALL offense + mobility for
// bulk, so its HP is scaled up on top of the normal suit×rank. One knob for how
// tanky walls are. The suit gradient survives (♥ 3 = best wall, ♠ 3 = flimsiest).
const DUMMY_HP_MULT = 2.5;

// Phase C: chips a round-winner steals per surviving unit (margin of victory).
const CHIPS_PER_SURVIVOR = 10;

// B6.1: extra chips stolen when the round winner's pool held both a 7 and a 2.
const SEVEN_TWO_BONUS = 20;

// Phase D: how many 52-card decks make up each player's shoe.
const DECKS = 2;

// Phase E: how many community flop cards are revealed each round.
const FLOP_SIZE = 3;

// Phase A (Poker Streets): the game runs MAX_ROUNDS rounds, and the shared
// community board GROWS across the game like Texas Hold'em — the flop (3 cards)
// lands on round 1, the turn (a 4th) on round 4, the river (a 5th) on round 6 —
// and every card, once dealt, STAYS for the rest of the game.
// COMMUNITY_SCHEDULE is indexed by round number and gives how many community
// cards are in play by that round; index 0 is unused. The numbers must never
// DECREASE round to round — the board only ever grows. Change them to reshape
// the streets (e.g. bump MAX_ROUNDS and extend the array to add more).
const MAX_ROUNDS = 7;
const COMMUNITY_SCHEDULE = [0, 3, 3, 3, 4, 4, 5, 5];
//    round:               0  1  2  3  4  5  6  7
//                            └─ flop ─┘  └turn┘ └river┘

// Phase A (caps): the BOARD holds at most PLAY_CAP units, and the HAND (your
// "bench") holds at most HAND_CAP cards. Units to place this round = the smaller
// of the round number and PLAY_CAP (see armySize) — so rounds 1..5 grow 1→5 as
// before, then plateau at 5 for rounds 6-7. HAND_CAP stops the hand ballooning:
// drawHands fills up to min(2×round, HAND_CAP), so rounds 1-5 are unchanged (2→10)
// and 6-7 hold at 10 instead of 12/14. Holding a leftover card still just replaces
// a fresh draw — the cap makes bench space finite so you can't hoard forever.
const PLAY_CAP = 5;
const HAND_CAP = 10;

// ── Phase C (6-seat table) ───────────────────────────────────────────────────
// A "seat" is a player AT THE TABLE (its own chip stack + alive/dead), as opposed
// to a "side" (player1/player2) which is all combat.js ever understands. Each
// round the alive seats are PAIRED and every pairing is fought as an ordinary
// 2-side combat, loaded onto the player1/player2 globals (see table.js).
//
// These live here as named knobs so the table's shape/rules are one edit away.
const NUM_SEATS = 6;                 // players at a full table
const SEAT_START_CHIPS = 100;        // every seat's opening stack (matches the 2p game)
// Game end (headless-first choice): a seat at 0 chips is ELIMINATED and the game
// ends when one seat remains — BUT never run longer than this many rounds, so a
// batch scan can't spin forever if chips somehow stalemate. Swap either rule here.
const TABLE_ROUND_CAP = MAX_ROUNDS;  // hard safety cap on rounds per table game
