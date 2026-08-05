// config.js — tuning constants & data tables. No logic, no state.
// One place to rebalance the game.

// How big the board is. Change these two numbers to resize the board.
const COLS = 8;
const ROWS = 8;

// How big one square is, in pixels. THE one place this number lives: buildBoard
// writes it onto the page as the --cell custom property, and every CSS rule that
// needs a square's size reads that variable rather than repeating the number.
// (Same trick unitart.js uses for --art-px.) The drag ghost and the motion
// fallback stride read this constant directly.
const CELL_PX = 80;
const COORD_GUTTER_PX = 32;   // width of the row-number column down the board's left edge

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
  // Rank 2 — BERSERKER (redesigned 2026-07-22, Riley). The of-a-kind COUNT is the power
  // dial. Every 2 is a tanky BODY — `baseHpMult` is an UNGATED base HP buff that lands on
  // EVEN A LONE 2 (Riley 2026-07-22: the 2s needed to be stronger at every rung, so give
  // them bulk up front). A PAIR then unlocks the ABILITY; the `tiers` HP stacks ON TOP of
  // the base buff, and higher tiers add a bigger attack RAMP when hurt. The SHIELD is no
  // longer a one-time bank at fight start — it's a repeatable SELF-CAST (Riley 2026-07-22):
  // the paired 2 charges a mana bar (regen clock, like rank 5's Ward) and REFRESHES its
  // shield every time the bar fills, so it keeps re-shielding through a long fight. Per-cast
  // `shieldFrac` starts small at a PAIR and GROWS with the count (trips bigger, quads
  // biggest) — smaller than the old one-time values BECAUSE it now repeats. The cast is
  // gated with the ability: a LONE 2 is not a caster (no mana bar). Baked ONCE at round start
  // off packCount (fielded 2s + the shared flop — the same count the poker synergies use).
  // `tiers` is keyed by of-a-kind count: 2=pair, 3=trips, 4=quads (caps at 4).
  //   baseHpMult — extra max HP for EVERY 2 (ungated), as a fraction of its suit/synergy HP
  //   hpMult     — ADDITIONAL max HP once paired, as a fraction of the base-buffed HP
  //   ramp       — attack gained per hit taken, as a fraction of STARTING attack (Berserk ramp)
  //   shieldFrac — shield banked PER CAST (on a full mana bar), as a fraction of buffed max HP
  // The mana profile (cast/castTargeting/manaMax/manaRegen) is shared by every tier — only the
  // per-cast shieldFrac scales. castTargeting "self" fires the instant the bar fills, no target.
  2: [{ kind: "berserker", name: "Berserker", baseHpMult: 0.4,
      cast: true, castTargeting: "self", manaMax: 50, manaRegen: 8,
      tiers: {
        2: { hpMult: 0.5, ramp: 0.15, shieldFrac: 0.3 },   // pair  — unlock + HP + SMALL shield/cast
        3: { hpMult: 1.2, ramp: 0.30, shieldFrac: 0.5 },   // trips — more HP/ramp + BIGGER shield/cast
        4: { hpMult: 2.5, ramp: 0.30, shieldFrac: 0.8 },   // quads — big HP + HUGE shield/cast
      } }],
  // Rank 3 — TARGET DUMMY: a pure reflect-wall. The `targetDummy` marker makes the
  // card INERT (makeCardOf zeroes its attack + boosts HP by DUMMY_HP_MULT; combatStep
  // skips its turn so it never moves or attacks). Its ONLY output is Thorns, a
  // PERCENTAGE of the damage it takes, bounced back at the attacker.
  // OF-A-KIND scaling (redesigned 2026-07-22, Riley — same tier pattern as rank 2's
  // Berserker): the reflect % is the of-a-kind COUNT dial instead of the old maxHp
  // formula. A LONE 3 still reflects SOME damage (unlike rank 2, the 3 is never fully
  // dormant — it's a wall by nature); a PAIR reflects a good chunk; and QUADS reflect
  // MORE than they take in, so four 3s just STANDING there out-damage their attacker.
  // Gated + baked ONCE at round start off packCount (fielded 3s + the shared flop — the
  // same count the poker synergies use), so a copy dying mid-fight can't weaken it.
  // `tiers` is keyed by of-a-kind count: 1=lone, 2=pair, 3=trips, 4=quads (caps at 4).
  //   reflect — fraction of damage taken that is bounced back (1.0 = 100%, >1.0 = net gain)
  3:  [{ kind: "thorns",      name: "Thorns",
        tiers: {
          1: { reflect: 0.20 },   // lone  — reflects SOME of the damage
          2: { reflect: 0.50 },   // pair  — a good amount
          3: { reflect: 0.85 },   // trips — most of the hit
          4: { reflect: 1.35 },   // quads — reflects MORE than it takes (net damage while inert)
        } },
      { kind: "targetDummy",  name: "Target Dummy" }],
  // Rank 4 — HASTE + GIANT SLAYER, OF-A-KIND GATED (redesigned 2026-07-22, Riley — same
  // pair/trips/quads dial as ranks 2 & 3). The of-a-kind COUNT unlocks the kit in stages, and
  // the two roles differ in HOW MUCH Giant Slayer they get plus a melee-only kill-dash:
  //   • A LONE 4 is a plain body — no cast, no Giant Slayer (the cast is gated, like a lone 2).
  //   • PAIR (2)  → HASTE unlocks for BOTH roles: a self-cast attack-speed ramp on an attack-mana
  //     bar (each swing banks mana, so a faster 4 casts sooner — a snowball capped at `speedMax`).
  //   • TRIPS (3) → keep Haste AND add a MODERATE Giant Slayer passive (bonus damage vs targets
  //     with MORE max HP — it "punches up"). RANGED ♣/♠ get the full bonus; MELEE ♥/♦ get a
  //     SLIGHTLY SMALLER one but ALSO gain "Kill Dash" — a permanent, capped move-speed stack on
  //     every kill (compensation for the smaller slayer bonus and for being in the scrum).
  //   • QUADS (4) → the tiers BUFF: a HUGE Haste ramp, a LARGE Giant Slayer bonus (ranged still >
  //     melee), and a higher Kill Dash ceiling for melee.
  // Hybrid caster (still auto-attacks, NOT noAutoAttack — Giant Slayer needs swings to matter).
  // Haste carries the shared mana profile; its per-tier speed is baked at round start off packCount
  // (fielded 4s + the shared flop — the same count the poker synergies use). Giant Slayer reads two
  // tables (tiersRanged / tiersMelee) and picks by the unit's suit role; Kill Dash is role "melee".
  //   speedMult/speedMax — per-cast attack-speed ramp and its ceiling (Haste)
  //   bonus              — Giant Slayer damage vs bigger targets, as a fraction (0.75 = +75%)
  //   stepGain/stepMax   — extra move-steps banked per kill and the cap (Kill Dash)
  4:  [{ kind: "hasteCast",   name: "Haste",        cast: true, castTargeting: "self",
        manaMax: 40, manaPerAttack: 10,
        tiers: {
          2: { speedMult: 0.20, speedMax: 3.0 },   // pair  — moderate attack-speed ramp
          3: { speedMult: 0.20, speedMax: 3.0 },   // trips — same Haste (trips adds Giant Slayer)
          4: { speedMult: 0.40, speedMax: 6.0 },   // quads — HUGE attack-speed ramp
        } },
      { kind: "giantSlayer", name: "Giant Slayer",
        tiersRanged: {
          3: { bonus: 0.75 },   // trips — moderate: +75% vs bigger targets
          4: { bonus: 1.75 },   // quads — large
        },
        tiersMelee: {
          3: { bonus: 0.50 },   // trips — moderate but SMALLER than ranged (compensated by Kill Dash)
          4: { bonus: 1.25 },   // quads — large but < ranged
        } },
      { kind: "killDash",    name: "Kill Dash",    role: "melee",
        tiers: {
          3: { stepGain: 1, stepMax: 2 },   // trips — dash on kill, capped at +1 step
          4: { stepGain: 1, stepMax: 3 },   // quads — higher ceiling (+2 steps)
        } }],
  // Rank 5 — SLIPPERY + WARD, OF-A-KIND GATED (redesigned 2026-07-22, Riley — same pair/trips/
  // quads dial as ranks 2, 3 & 4). Every 5 keeps the ungated Slippery dodge (a chance to blank an
  // incoming hit). The WARD cast is the of-a-kind payoff — a self-cast SHIELD banked on the
  // existing u.shield damage pool (soaks hits before HP, exactly like the Ace of Diamonds' Aegis),
  // sized as `shieldFrac` of the caster's max HP (so ♥5, most HP, wards fattest for free):
  //   • A LONE 5 is a plain dodgy body — no Ward cast (gated like a lone 2/4; no mana bar renders).
  //   • PAIR (2)  → Ward unlocks: a full bar grants ONE shield worth `shieldFrac`×maxHp. The unit
  //     then HOLDS its full bar and will NOT cast again until that shield is FULLY DEPLETED — one
  //     shield at a time, never refreshing a live one (so it can't grow on its own).
  //   • TRIPS (3) → same one-at-a-time rule, but a BIGGER single shield.
  //   • QUADS (4) → `stack:true` removes the hold: it casts on EVERY full bar and LAYERS a fresh
  //     shield on top of whatever's left, so the shield builds up over a long fight — but on the
  //     normal mana cadence (one stack per full bar), NOT every tick.
  // Baked ONCE at round start off packCount (fielded 5s + the shared flop — the same count the poker
  // synergies use). `castTargeting:"self"` fires on a full bar with no target. The pair/trips "hold
  // until depleted" is enforced by unit.holdCastWhileShielded (set here, honored in combat.js's cast
  // pass). `tiers` is keyed by of-a-kind count: 2=pair, 3=trips, 4=quads (caps at 4); counts <2 → no Ward.
  //   shieldFrac — shield granted per cast, as a fraction of the caster's max HP
  //   stack      — false: ONE shield at a time, reapplied only once depleted (pair/trips) ·
  //                true: LAYER a new shield each full bar (quads)
  5:  [{ kind: "slippery",    name: "Slippery",     chance: 0.35 },
       { kind: "wardCast",    name: "Ward",         cast: true, castTargeting: "self",
         manaMax: 50, manaRegen: 8,
         tiers: {
           2: { shieldFrac: 0.6, stack: false },   // pair  — one strong shield, reapplied once depleted
           3: { shieldFrac: 1.0, stack: false },   // trips — a BIGGER single shield, same one-at-a-time rule
           4: { shieldFrac: 0.5, stack: true },    // quads — layer a new shield on each full bar (builds up)
         } }],
  // Rank 6 — EXECUTIONER + HELLFIRE, SPLIT BY ROLE and now OF-A-KIND GATED (casting Riley
  // 2026-07-15; of-a-kind dial added Riley 2026-07-23): the DEVIL rank. All four 6s keep the
  // Executioner passive UNGATED (autos on targets at/below `threshold` of max HP are EXACTLY
  // lethal, through Bulwark and shields) — it has NO `role`, so it lands on every 6, even a lone
  // one. The CAST is now the of-a-kind payoff, gated exactly like ranks 2-5 (see the `tiers`
  // tables keyed by packCount): a LONE 6 is a plain Executioner body with NO cast (mana bar
  // killed in onRoundStart), a PAIR unlocks the base cast, TRIPS bumps it, QUADS goes big. The
  // cast also differs by role (isRangedSuit / the role filter in unitAbilities), because a devil
  // in the back line lobs fire while a devil in the scrum radiates it:
  //   • RANGED ♣/♠ → "Hellfire" projectile: `spellPower` × attack to a target within castRange,
  //     then `splashMult` of that to enemies within `radius`. Tiers: PAIR = base fireball,
  //     TRIPS = more damage, QUADS = `hitAll` BOARD-WIDE nuke (full damage to EVERY enemy, no
  //     splash shape — the projectile becomes a rain of fire).
  //   • MELEE ♥/♦ → "Hellfire Aura" (burnAura): a SELF-centered burst scorching every enemy
  //     within `radius` for `spellPower` × attack (no target — fires the instant the bar fills,
  //     the melee 6 is already surrounded). Tiers: PAIR = base ring, TRIPS = bigger ring + more
  //     damage, QUADS = trips ring/damage but `fullStart` opens the fight with a FULL mana bar
  //     so it scorches on the very first tick.
  // Both are HYBRID casters (still auto-attack, so Executioner keeps procing — NOT noAutoAttack)
  // and both charge on ATTACK-mana (the devil banks fire by swinging). The mana profile
  // (manaMax/manaPerAttack/castRange) is SHARED across tiers on the card; only the payload scales.
  // `tiers` is keyed by of-a-kind count: 2=pair, 3=trips, 4=quads (caps at 4); count <2 → no cast.
  6:  [{ kind: "executioner", name: "Executioner",  threshold: 0.3 },
      { kind: "fireball",    name: "Hellfire",     role: "ranged", cast: true, castTargeting: "enemy",
        manaMax: 60, manaPerAttack: 15, castRange: 4,
        tiers: {
          2: { spellPower: 2.0, radius: 1, splashMult: 0.5 },               // pair  — base fireball (today's values)
          3: { spellPower: 3.0, radius: 1, splashMult: 0.5 },               // trips — damage up moderately
          4: { spellPower: 3.0, radius: 1, splashMult: 0.5, hitAll: true }, // quads — full damage to EVERY enemy (board nuke)
        } },
      { kind: "burnAura",    name: "Hellfire Aura", role: "melee",  cast: true, castTargeting: "self",
        manaMax: 60, manaPerAttack: 15,
        tiers: {
          2: { radius: 1, spellPower: 0.6 },                  // pair  — base ring (today's nova)
          3: { radius: 2, spellPower: 0.9 },                  // trips — bigger ring + more damage
          4: { radius: 2, spellPower: 0.9, fullStart: true }, // quads — trips ring/damage + opens the fight FULLY charged
        } }],
  // Rank 7 — GAMBLER + SLOT MACHINE, now OF-A-KIND GATED (redesigned Riley 2026-07-23 — same pair/
  // trips/quads dial as ranks 2-6). Every 7 keeps the UNGATED Gambler passive (on-hit random damage
  // roll `min`..`max`, floor ramps `rampPerHit`/hit, fully ramped it STEALS `stealAmount` chips, 7♦
  // +`diamondBonus`). The SLOT MACHINE is the of-a-kind payoff — a hybrid ATTACK-mana cast on a
  // DELIBERATELY LOW bar (manaMax 45 / manaPerAttack 15 = a spin every 3 swings, the fastest-cycling
  // caster in the game: the "keep pulling the lever" feel). Each spin draws ONE random reel from THIS
  // TIER's pool; every reel MIRRORS a real ability elsewhere in the game and dispatches through a
  // primitive that ALREADY EXISTS (see slotMachine — pure dispatch, zero engine change). The reels
  // MIX enemy-facing casts (hellfire/chain/poisonLine/stun) with self/ally ones (nova/shield/haste/
  // heal) — you don't pick which you spin, so a self-buff is wasted on a lone backliner: that
  // randomness IS the downside you signed up for.
  //   • LONE 7  → no spin (mana bar killed in onRoundStart, like a lone 2/4/5/6); Gambler still runs.
  //   • PAIR(2) → spin unlocked, draws the pair-tier pool. No jackpot.
  //   • TRIPS(3)→ bigger reels AND the 777 jackpot joins the wheel at a small chance.
  //   • QUADS(4)→ biggest reels, better jackpot odds + a bigger payout.
  // 777 JACKPOT (trips+): rolled BEFORE the normal spin at `jackpot[tier].chance`. A heavy AoE nuke
  // (`spellPower`×attack to the target + `radius` splash) that also MINTS `gold` chips to the owner —
  // GENERATED, not stolen (the deliberate contrast with the Gambler's pickpocket). Tier baked once at
  // round start off packCount (fielded 7s + the shared flop). Reel damage/heal numbers are ×the 7's
  // current attack; shield `frac` is ×its max HP. Magnitudes are FIRST-PASS — tune by playtest.
  // NOTE the 6-7 fusion authors its OWN ability list, so slotMachine does NOT leak into it.
  7:  [{ kind: "gambler",     name: "Gambler",      min: 0.5, max: 2.0, rampPerHit: 0.15,
         stealChance: 0.25, stealAmount: 5, diamondBonus: 3 },
      { kind: "slotMachine", name: "Slot Machine", cast: true, castTargeting: "enemy",
        manaMax: 45, manaPerAttack: 15, castRange: 5,
        jackpot: {
          3: { chance: 0.08, spellPower: 6.0, radius: 2, gold: 10 },   // trips — small chance, heavy nuke + minted gold
          4: { chance: 0.15, spellPower: 9.0, radius: 2, gold: 20 },   // quads — better odds, bigger payout
        },
        tiers: {
          2: [ // PAIR — modest reels
            { effect: "hellfire",   spellPower: 2.0 },
            { effect: "chain",      spellPower: 1.5, jumps: 3, jumpRange: 3, falloff: 0.7 },
            { effect: "poisonLine", stacks: 10, pierce: 2 },
            { effect: "stun",       ticks: 8 },
            { effect: "nova",       spellPower: 0.6, radius: 1 },
            { effect: "shield",     frac: 0.4 },
            { effect: "haste",      mult: 0.2, cap: 3.0 },
            { effect: "heal",       healPower: 4.0 },
          ],
          3: [ // TRIPS — stronger reels
            { effect: "hellfire",   spellPower: 3.0 },
            { effect: "chain",      spellPower: 2.0, jumps: 4, jumpRange: 3, falloff: 0.7 },
            { effect: "poisonLine", stacks: 16, pierce: 3 },
            { effect: "stun",       ticks: 12 },
            { effect: "nova",       spellPower: 0.9, radius: 2 },
            { effect: "shield",     frac: 0.7 },
            { effect: "haste",      mult: 0.3, cap: 4.0 },
            { effect: "heal",       healPower: 5.5 },
          ],
          4: [ // QUADS — biggest reels
            { effect: "hellfire",   spellPower: 4.0 },
            { effect: "chain",      spellPower: 2.5, jumps: 5, jumpRange: 3, falloff: 0.7 },
            { effect: "poisonLine", stacks: 22, pierce: 4 },
            { effect: "stun",       ticks: 16 },
            { effect: "nova",       spellPower: 1.2, radius: 2 },
            { effect: "shield",     frac: 1.0 },
            { effect: "haste",      mult: 0.4, cap: 6.0 },
            { effect: "heal",       healPower: 7.0 },
          ],
        } }],
  // Rank 8 — BULWARK + TRAP CAST (redesigned 2026-07-23, Riley — the of-a-kind GATE dial, same
  // pair/trips/quads pattern as ranks 2-7). The COUNT of pooled 8s (fielded 8s + the shared flop,
  // via packCount) drives everything, baked ONCE at round start so a dying copy can't weaken the
  // survivors. Unlike the other gated ranks, the BULWARK tank passive is NOT gated — a LONE 8 still
  // soaks hits; only the trap CAST is gated behind a pair.
  //   • BULWARK — flat `reduce` off every incoming hit (engine floors hits at 1, never immune). The
  //     reduction CLIMBS every rung: lone 15 → pair 30 → trips 40 → quads 50 (tiers keyed by count,
  //     caps at 4; count is always ≥ 1, so tiers[1] is the ungated base every 8 gets).
  //   • TRAP CAST — GATED at a PAIR (a lone 8 lays no traps: its mana bar is killed like a lone 2/4/
  //     5/6/7). Pair unlocks the base trap, trips places MORE, quads lays a full line across. Still a
  //     hybrid caster (auto-attacks AND casts) on a deliberately SLOW mana clock so the traps can't
  //     carpet the board (Riley's call). `castTargeting:"self"` = fires whenever the bar fills, no aim.
  // ROLE split kept (casting, Riley 2026-07-15): all four 8s share the Bulwark passive (no `role`).
  // The trap CAST differs by where the tank stands:
  //   • MELEE ♥/♦ → "Trapline": a forward line one row TOWARD the enemy (right in the contested lane).
  //     pair = 1 cell ahead → trips = 3-wide (±1) → quads = a line across the WHOLE row (`fullRow`).
  //   • RANGED ♣/♠ → "Caltrops": a trap RING around itself (anti-dive perimeter for a backliner).
  //     pair = radius-1 ring (8 cells) → trips = radius-2 ring (24 cells) → quads = max ring, hardest bite.
  // Both self-cast on the SAME slow regen clock and share their tier tables' damage/slow ladder.
  8:  [{ kind: "bulwark",  name: "Bulwark",
        // DR by of-a-kind count; 1=lone is the UNGATED base (every 8 tanks). Caps at 4 (quads).
        tiers: { 1: { reduce: 15 }, 2: { reduce: 30 }, 3: { reduce: 40 }, 4: { reduce: 50 } } },
      { kind: "trapline", name: "Trapline", role: "melee", cast: true, castTargeting: "self",
        manaMax: 80, manaRegen: 8, manaStart: 0,
        // Gated at a pair (no `1` row → a lone 8 kills its own cast). `fullRow` = a line across the whole row.
        tiers: {
          2: { lineWidth: 1,  damage: 15, slowTicks: 12 },   // pair  — unlock, one cell ahead
          3: { lineWidth: 3,  damage: 20, slowTicks: 16 },   // trips — wider line (±1)
          4: { fullRow: true, damage: 25, slowTicks: 20 },   // quads — a line ACROSS the whole row
        } },
      { kind: "caltrops", name: "Caltrops", role: "ranged", cast: true, castTargeting: "self",
        manaMax: 80, manaRegen: 8, manaStart: 0,
        tiers: {
          2: { radius: 1, damage: 15, slowTicks: 12 },   // pair  — unlock, 8-cell ring
          3: { radius: 2, damage: 20, slowTicks: 16 },   // trips — radius-2 ring (24 cells)
          4: { radius: 2, damage: 25, slowTicks: 20 },   // quads — max ring, hardest bite
        } }],
  // Rank 9 — POISON + POISON CAST (redesigned 2026-08-05, Riley — the of-a-kind GATE dial, the
  // LAST combat rank off the old linear per-extra idiom). The COUNT of pooled 9s (fielded 9s +
  // the shared flop, via packCount) drives everything, baked ONCE at round start so a dying copy
  // can't weaken the survivors. Like rank 8's Bulwark, the POISON passive is NOT gated — a LONE 9
  // still rots what it hits; only the CAST is gated behind a pair.
  //   • POISON — each hit applies `stackDamage` damage-per-tick to the victim (drained in
  //     combatStep; the status lives on the VICTIM). The stack CLIMBS every rung: lone 5 → pair 8
  //     → trips 11 → quads 14 (tiers keyed by count, caps at 4; count is always ≥ 1, so tiers[1]
  //     is the ungated base every 9 gets).
  //   • PLAGUE — folded into the same table as `transferPct`: from TRIPS, a poisoned unit that
  //     DIES passes that fraction of its stacks to its nearest living teammate, and the plague
  //     keeps jumping down the line as they fall. Trips passes HALF; QUADS passes ALL of it, so
  //     the plague never weakens no matter how many bodies it walks through.
  //   • CAST — GATED at a PAIR (a lone 9 kills its own mana bar, like a lone 2/4/5/6/7/8). Pair
  //     unlocks it, trips widens the reach, quads changes its SHAPE. `stackMult` is deliberately
  //     FLAT across the rungs: it multiplies `poisonStack`, which is already climbing 5→14, and
  //     poison NEVER decays — climbing both would compound a permanent DoT into a blowout.
  //     So the rungs pay off in REACH, not in bigger numbers (cast stacks still rise 16→22→28).
  // ROLE split kept (casting, Riley 2026-07-15): all four 9s share the poison passive (no `role`).
  // The CAST differs by delivery — a backline poisoner rakes a line, a frontline one exhales:
  //   • RANGED ♣/♠ → "Poison Volley": a piercing arrow down a straight 8-direction line THROUGH
  //     the aimed target, poisoning it plus every enemy behind it, each for `poisonStack ×
  //     stackMult` stacks. pair = 2 bodies behind → trips = 4 → quads = `fullLine`, the arrow
  //     never stops and rakes the ray clean to the board edge (the twin of Trapline's `fullRow`).
  //   • MELEE ♥/♦ → "Miasma": a SELF-centered cloud poisoning every enemy within `radius`. No
  //     target needed (castTargeting "self"), fires the instant the bar fills. pair = radius-1
  //     (8 cells) → trips = radius-2 (24 cells) → quads = `deathCloud`, the plague bearer exhales
  //     one FINAL free cloud on its own corpse (onDeath), seeding a 100%-transfer plague as it
  //     falls. Lower stackMult than the Volley on purpose — it rots a whole ring, not a file.
  // Both are hybrid ATTACK-mana casters (normal shots/swings charge the bar; still auto-attack),
  // both reuse `poisonStack` (baked by poison.onRoundStart) and applyPoison (so both inherit the
  // plague-jump). `castRange` gives the ranged Volley reach; the melee cloud needs none.
  9:  [{ kind: "poison",      name: "Poison",
        // Stack + plague by of-a-kind count; 1=lone is the UNGATED base (every 9 poisons).
        tiers: {
          1: { stackDamage: 5 },                          // lone  — rots on hit, no plague
          2: { stackDamage: 8 },                          // pair  — fatter stacks, cast unlocks
          3: { stackDamage: 11, transferPct: 0.5 },       // trips — plague starts jumping (half)
          4: { stackDamage: 14, transferPct: 1.0 },       // quads — plague jumps at FULL strength
        } },
      { kind: "poisonVolley", name: "Poison Volley", role: "ranged", cast: true, castTargeting: "enemy",
        manaMax: 60, manaPerAttack: 20, castRange: 5,
        // Gated at a pair (no `1` row → a lone 9 kills its own cast). `fullLine` = never stops.
        tiers: {
          2: { pierce: 2,        stackMult: 2.0 },   // pair  — unlock, 2 bodies behind the target
          3: { pierce: 4,        stackMult: 2.0 },   // trips — 4 bodies behind
          4: { fullLine: true,   stackMult: 2.0 },   // quads — rakes the ray to the board edge
        } },
      { kind: "poisonNova",  name: "Miasma",        role: "melee",  cast: true, castTargeting: "self",
        manaMax: 60, manaPerAttack: 20,
        tiers: {
          2: { radius: 1, stackMult: 1.5 },                        // pair  — unlock, 8-cell cloud
          3: { radius: 2, stackMult: 1.5 },                        // trips — radius-2 cloud (24 cells)
          4: { radius: 2, stackMult: 1.5, deathCloud: true },      // quads — one last breath on death
        } }],
  // Rank 10 — RALLY, OF-A-KIND GATED (redesigned 2026-08-05, Riley — the LAST combat rank off the
  // old linear per-extra idiom). Rank 10 is the CONNECTOR card: an ADJACENCY aura that buffs the
  // allies standing within `radius` of it, never itself and never enemies. Baked ONCE at round start
  // from PLACEMENT positions (units wander mid-fight, but the rally is the pre-battle speech), off
  // packCount — fielded 10s + the shared flop, the same count the poker synergies use — so a copy
  // dying mid-fight can't weaken the speech it already gave.
  // What makes rank 10 different from every other gated rank:
  //   • NO CAST. Rank 10 is a pure passive, the only redesigned rank besides 3 with no mana bar
  //     (Riley 2026-08-05). Nothing to aim, nothing to charge — the whole card is the placement.
  //   • NOT GATED OFF. A LONE 10 still rallies, just weakly (`tiers[1]` is the ungated base, like
  //     rank 8's Bulwark and rank 9's Poison). The 10 never stops being a connector.
  //   • The rungs pay in MAGNITUDE ONLY (Riley 2026-08-05) — quads is a HUGE buff to neighbors, not
  //     a new shape. `radius` stays 1 (the 8 adjacent cells) at EVERY rung on purpose, so "where you
  //     drop your 10" is still the decision the card is about. Contrast rank 8/9, whose top rungs buy
  //     reach (`fullRow`/`fullLine`).
  //   • FOUR FACES, FOUR LADDERS. Rank 10 has no melee/ranged `role:` split — instead each SUIT
  //     rallies a different stat, and each now carries its OWN `tiers` table, so trips-on-hearts and
  //     trips-on-clubs are genuinely different cards:
  //       10♥ "Hold the Line" — neighbors gain `hpMult` of their max HP (the line holds)
  //       10♠ "Killing Word"  — neighbors gain `critBonus` flat crit chance (clamped to 100%)
  //       10♣ "Quick March"   — neighbors gain `speedMult` attack speed (the ranks quicken)
  //       10♦ "Blood Banner"  — neighbors DRAIN `lifestealPct` of the damage they deal (a granted
  //         `rallyLifesteal` ability, a separate kind from the ♦ suit's own lifesteal so it stacks
  //         with it instead of being skipped — see the kit in abilities.js)
  // Each ladder roughly DOUBLES per rung. The lone rung is weaker than the old flat value and quads
  // is about twice the old top — that trade is exactly what the gate buys. Two rallies overlapping
  // the same ally stack (both hooks fire); two ♦ banners do NOT (highest pct wins).
  // `tiers` keyed by of-a-kind count: 1=lone, 2=pair, 3=trips, 4=quads (caps at 4).
  10: [{ kind: "rally", name: "Rally", radius: 1,
         suits: {
           hearts:   { name: "Hold the Line",
                       tiers: { 1: { hpMult: 0.25 },       2: { hpMult: 0.55 },
                                3: { hpMult: 1.00 },       4: { hpMult: 1.90 } } },
           spades:   { name: "Killing Word",
                       tiers: { 1: { critBonus: 0.12 },    2: { critBonus: 0.28 },
                                3: { critBonus: 0.50 },    4: { critBonus: 0.85 } } },
           clubs:    { name: "Quick March",
                       tiers: { 1: { speedMult: 0.18 },    2: { speedMult: 0.40 },
                                3: { speedMult: 0.75 },    4: { speedMult: 1.40 } } },
           diamonds: { name: "Blood Banner",
                       tiers: { 1: { lifestealPct: 0.30 }, 2: { lifestealPct: 0.60 },
                                3: { lifestealPct: 0.90 }, 4: { lifestealPct: 1.40 } } },
         } }],
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
  // Ace of Spades — also gains "Vanish" (Riley 2026-07-22): as an attack-mana caster, each time
  // its bar fills from swinging it drops aggro — untargetable for `ticks` ticks so enemies re-path
  // off it (see the dropAggro kit + nearestEnemy's skip). Fits the glass-cannon dive: strike, then
  // slip the focus fire. castTargeting "self" fires it on a full bar with no aim.
  "spades-14": {
    name: "Ace of Spades",
    abilities: [
      { kind: "infiltrator", placement: "anywhere" },
      { kind: "dropAggro", name: "Vanish", cast: true, castTargeting: "self",
        manaMax: 100, manaPerAttack: 25, manaStart: 50, ticks: 4 },
    ],
    blurb: "Infiltrator — place anywhere, even the enemy's side; Vanishes on cast to shed aggro (~2s untargetable)",
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
  // Ace of Clubs — also gains "Sniper Round" (Riley 2026-07-22): as an attack-mana caster, its
  // slow auto-fire charges a special round that strikes the enemy BACKLINE (farthest foe) for
  // spellPower × attack — but it can be BLOCKED by any body on the straight line to that target
  // (see the sniperShot kit + firstEnemyOnLine). It stays a hybrid (auto-attacks nearest AND
  // snipes the back). castTargeting "self" so the kit aims farthest, not nearest.
  "clubs-14": {
    name: "Ace of Clubs",
    abilities: [
      { kind: "sniperShot", name: "Sniper Round", cast: true, castTargeting: "self",
        manaMax: 100, manaPerAttack: 34, manaStart: 34, spellPower: 3 },
    ],
    range: COLS + ROWS,
    attackSpeed: 0.5,
    blurb: "Sharpshooter — hits anywhere, fires slowly; charges a blockable sniper round at the enemy backline",
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
  // The royal pair also SUPPORT each other on cast (Riley 2026-07-22), both attack-mana casters:
  //   Q♥ "Aegis Vow" — banks a small shield onto her King each cast (shieldPartner kit).
  //   K♥ "Rally" — gives his Queen a temporary, refreshable attack buff each cast (attackBuffPartner).
  // A tight loop: her Royal Guard soaks her hits onto him, she keeps him shielded, he keeps her
  // hitting hard. Each cast fizzles harmlessly if the partner isn't fielded/alive.
  "hearts-12": {
    name: "Queen of Hearts",
    rangeBonus: 1,
    abilities: [
      { kind: "royalGuard", partnerRank: 13 },
      { kind: "shieldPartner", name: "Aegis Vow", cast: true, castTargeting: "self", partnerRank: 13,
        manaMax: 80, manaPerAttack: 20, manaStart: 20, shieldFrac: 0.15 },
    ],
    blurb: "Royal Guard — her King takes her hits (invuln when he falls); each cast shields him",
  },
  "hearts-13": {
    name: "King of Hearts",
    abilities: [
      { kind: "royalVow", partnerRank: 12, invulnTicks: 4 },
      { kind: "attackBuffPartner", name: "Rally", cast: true, castTargeting: "self", partnerRank: 12,
        manaMax: 80, manaPerAttack: 20, manaStart: 20, mult: 1.5, buffTicks: 6 },
    ],
    blurb: "Royal Vow — his death makes the Queen untouchable ~1.5s; each cast buffs her attack (+50%, ~3s)",
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
  // Queen of Clubs — "Cleric": a board-wide healer (casting Slice 2, Riley 2026-07-15).
  // As a club she auto-attacks fast and banks mana per swing (attack-mana model, manaPerAttack) —
  // when the bar fills she mends her most-wounded ally in range for healPower × her attack. She's
  // the first hybrid ATTACK-mana caster and the first support/heal cast. castAbilityOf returns the
  // cleric entry, so buildUnit stamps her mana profile from it.
  // NOTE (Riley 2026-07-22): her old spades `extinguish` was REMOVED — she no longer shuts off the
  // enemy's ♠ crit flush. Only Queen of Diamonds still extinguishes (♥). This makes Q♣ a pure
  // support legendary and keeps the spades synergy always-live for its owner.
  "clubs-12": {
    name: "Queen of Clubs",
    abilities: [
      { kind: "cleric", name: "Cleric", cast: true, castTargeting: "ally",
        manaMax: 60, manaPerAttack: 20, castRange: COLS + ROWS, healPower: 5.0, attackMult: 0.4 },
    ],
    blurb: "Cleric — a board-wide HEALER who mends her most-wounded ally each cast (she hits soft to pay for it)",
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
      // Rank-10 Rally aura — of-a-kind scaling OFF, because a FUSED card is excluded from
      // pokerPool (synergies.js) so its packCount can never climb past 1 anyway. Rather than
      // let the fusion silently inherit the real 10's weak LONE rung, each face here carries a
      // single `1:` row at the values Rally had before the 2026-08-05 gate redesign — the
      // Brunson's aura is pinned to exactly what it has always been, and retuning the real
      // rank-10 ladder can't move it by accident.
      { kind: "rally", name: "Rally", radius: 1,
        suits: { hearts:   { name: "Hold the Line", tiers: { 1: { hpMult: 0.4 } } },
                 spades:   { name: "Killing Word",  tiers: { 1: { critBonus: 0.25 } } },
                 clubs:    { name: "Quick March",   tiers: { 1: { speedMult: 0.3 } } },
                 diamonds: { name: "Blood Banner",  tiers: { 1: { lifestealPct: 1.0 } } } } },
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

// BASE MANA REGEN (Riley 2026-07-29): EVERY caster now trickles mana on EVERY tick, from
// the opening tick of the fight — before it has walked a single step or thrown a punch.
// Casters used to charge only from `manaRegen` (rank 2/5/8) or, for most of them, only
// from SWINGING (`manaPerAttack` — rank 4/6/7/9, the aces, the royals, Q♣), so a caster
// spent the whole approach at zero mana and the fight was usually over before it cast.
//
// The knob is "how many TICKS a bar takes to fill from the trickle ALONE", not a flat
// mana-per-tick number, so it scales with each card's manaMax: a 40-mana Haste bar and a
// 100-mana Sniper bar both gain 1/20th of themselves per tick, and no card is favoured
// just for having a small bar. A typical walk-up is ~4-8 ticks, so a caster arrives with
// roughly a quarter to a third of its bar already filled — swings and `manaRegen` still
// do most of the work. This ADDS to those two sources, it does not replace them.
// LOWER = casters fire sooner (8 ≈ very aggressive, 30 ≈ a gentle nudge). Started at 20;
// dropped to 12 on 2026-07-29 because casts still landed too late to matter — at 12 a
// caster that never swings still fires roughly twice in an average-length fight.
const BASE_MANA_FILL_TICKS = 12;

// REAL-TIME SPEED of a live fight: how long the gameflow timer waits between combat
// ticks. Purely a playback speed — a "tick" is one round of the engine no matter how
// long the wall clock takes, so NOTHING about combat, balance or the headless sims
// changes when you turn this knob (the sims don't wait at all). Slowed 500 → 800 on
// 2026-07-28 so abilities and damage numbers are actually followable; drop it back
// toward 500 once the effects pass makes the fight readable at speed. Every effect
// duration in fx.js / styles.css is sized against this — keep them in proportion if
// you change it (a tracer is ~a third of a tick, a flash is one whole tick).
const COMBAT_TICK_MS = 800;

// How many ticks a one-shot visual FLASH lingers (cast glow, spell/trap hit burst,
// heal pulse). Think of it in SECONDS, not ticks: this × COMBAT_TICK_MS is how long
// the glow sits on screen. It was 3 back when a tick was 500ms (≈1.5s); now one tick
// is already a full second, so 3 would smear a single flash across the next two
// ticks' events and make things LESS clear. Pure cosmetics — no gameplay effect.
const FLASH_TICKS = 1;

// How fast a RECORDED fight plays back on the "watch" tabs (week 3). Pure playback
// speed — the fight was already fought, this only decides how quickly you flick through
// the frames of it.
//
// It used to be a hard-coded 130ms, chosen when a replay was just glyphs sliding around
// and skimming fast was the whole point. Now that replays carry effects, 130ms is too
// quick to read: a damage number lives 900ms and a beam 320ms, so six ticks' worth would
// pile up on screen at once. Slower than that, but still well under a live 800ms tick —
// you're rewatching, not fighting. Turn it down if replays feel sluggish.
const REPLAY_TICK_MS = 420;

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

// ── The SECOND currency: Comps ───────────────────────────────────────────────
// Chips are ZERO-SUM — you never make them, you only steal them, and whoever holds
// the most at MAX_ROUNDS wins. That makes chips a health/score bar, not money: any
// price tag on them is dominated by "just don't buy it". So the shop runs on its own
// axis. COMPS are MINTED (created from nothing, never stolen) and never scored, so
// spending them costs you power LATER instead of score NOW — which is the only way a
// price can mean something.
//
// Their job is to fund the fishing: rerolls to hunt for jokers in the shoe, and packs.
// That's why income is FLAT and reliable rather than a jackpot — a player who can't
// afford a reroll can't fish, and a dead round would compound into a dead game.
// Budget over a 7-round game: 21 comps guaranteed, up to 35 if you win out.
const COMPS_INCOME = 3;        // paid to BOTH players every round, win or lose
const COMPS_WIN_BONUS = 2;     // extra, to the round winner only (0 on a draw)
const COMPS_ICON = "🎟️";       // casino comp points — the house comps you for playing
const COMPS_LABEL = "Comps";

// ── Jokers ───────────────────────────────────────────────────────────────────
// Jokers live IN THE SHOE as drawable cards, which is what makes rerolling a hunt
// rather than just a mulligan. A real 52-card deck ships with 2 jokers, so this
// number times DECKS is how many ride in each player's shoe — at 2 decks that's 4
// jokers in 108 cards, ~3.7% a draw. The rarity tunes itself; this is the one knob.
//
// A joker card is NOT a unit: no suit, no rank, no attack/hp. It can never be
// placed on the board. It occupies a hand slot until you CLAIM it (Slice 3), and
// until then a reroll throws it away like any other card — that tension is the
// point. The shoe conserves it either way: a discarded joker comes back on reshuffle.
const JOKERS_PER_DECK = 2;

// The joker catalog. Slice 2 ships these as INERT collectibles — name and art only,
// so the draw/claim/shop machinery can be proven before any of them changes the
// rules. The effect fields land in Slice 5; the `blurb` is the intent each one is
// reserved for, and it doubles as the tooltip today.
const JOKERS = {
  theRegular:   { name: "The Regular",     icon: "☕", blurb: "The house knows your name. Earns extra comps every round." },
  theCounter:   { name: "The Counter",     icon: "🧮", blurb: "Counts what's left in the shoe. Draws you a wider hand." },
  theMechanic:  { name: "The Mechanic",    icon: "🎩", blurb: "Sleight of hand. Deals you an extra redraw each round." },
  highRoller:   { name: "The High Roller", icon: "💎", blurb: "Bets big. Your army hits harder the fatter your chip stack." },
  deadMansHand: { name: "Dead Man's Hand", icon: "💀", blurb: "Aces and eights. Pays out when your units die." },
  luckyStiff:   { name: "The Lucky Stiff", icon: "🍀", blurb: "Shouldn't have survived that. Sometimes just doesn't die." },
};
const JOKER_KEYS = Object.keys(JOKERS);

// How many jokers you may keep at once. The LIMIT is the whole point: with unlimited
// slots, claiming a joker is never a decision — you'd always take it and the choice
// would be fake. At 3, a fourth joker means giving one up, which is what makes the
// hunt matter and what stops a long game snowballing into an unreadable pile of rules.
const JOKER_SLOTS = 3;

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

// How many units you PLACE each round, looked up by round number (index 0 unused).
// Rounds 1..7 → 2, 2, 3, 3, 4, 4, 5. This is the whole schedule — to reshape the
// ramp, just edit these seven numbers (keep them ≤ PLAY_CAP, the board cap).
// armySize() in state.js reads this.
const ARMY_SCHEDULE = [0, 2, 2, 3, 3, 4, 4, 5];
//    round:            0  1  2  3  4  5  6  7

// How many cards you HOLD in hand each round, looked up by round number (index 0
// unused). Rounds 1..7 → 3, 3, 4, 4, 5, 5, 6 — always one more than ARMY_SCHEDULE,
// so you place all but one card. Unplayed leftovers carry into the next round and
// the hand is only topped up to this size (drawHands in hands.js), so you no longer
// get a fresh firehose of cards each round. Each round you also get REDRAWS_PER_ROUND
// whole-hand rerolls to reshape a bad hand. Edit these seven numbers to retune.
const HAND_SCHEDULE = [0, 3, 3, 4, 4, 5, 5, 6];
//    round:           0  1  2  3  4  5  6  7
const REDRAWS_PER_ROUND = 2;

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
