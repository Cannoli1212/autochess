// ── ABILITY TEXT ─────────────────────────────────────────────────────────────
// The words for every ability, for the champion hover tooltip (js/tooltip.js).
//
// WHY THIS FILE EXISTS. RANK_ABILITIES entries carry a `kind` and a display `name`
// and nothing else — the explanation of what an ability actually DOES has only ever
// lived in the `//` comments above each rank in config.js, which is developer prose
// no player can read. This is that prose, rewritten for a player and made available
// at runtime. It is a SEPARATE file rather than more fields on RANK_ABILITIES so the
// balance data stays a table of numbers: you can retune a tier without reading a
// paragraph, and you can rewrite a sentence without touching a knob.
//
// THE ONE RULE: hardcode the VERB PHRASE, never the NUMBER. Every figure in here is
// read live out of the tier object it is describing, so a balance change moves the
// tooltip with it and the two can't drift apart. This is the same discipline as
// bulwarkRungText and friends in synergies.js:160 — copied deliberately, because
// that sidebar has already proved it works.
//
// SHAPE. Keyed by ability `kind`. Each entry may have:
//   desc  — one sentence: what the ability does, no numbers. Always present.
//   name  — a display name, ONLY for abilities that don't carry one of their own. The
//           suit abilities in SUITS are bare `{ kind }` entries with nothing to show as
//           a heading; every RANK_ABILITIES entry already has its own `name` and wins.
//   rung  — rung(tierObj, ability, count) → the one-line summary of ONE of-a-kind
//           rung, for abilities with a `tiers` table. Called once per rung so the
//           tooltip can show the whole ladder with your current rung lit.
//   flat  — flat(ability) → one line, for UNGATED abilities whose numbers sit on the
//           entry itself instead of in tiers (Slippery's chance, Executioner's
//           threshold). Rendered as a single line with no ladder.
// A kind missing from this table degrades to its name alone. That is deliberate:
// a new ability with no words yet is a thin tooltip, never a crash.

// Fractions are stored as multipliers (0.35) and read as percentages ("35%").
function abilPct(x) { return Math.round(x * 100) + "%"; }

// A ring of `radius` around a unit covers the square minus the unit's own cell —
// radius 1 = 8 cells, radius 2 = 24. Spelled out because "radius 2" means nothing
// to a player and "24 cells" means quite a lot.
function abilRingCells(radius) { return (2 * radius + 1) * (2 * radius + 1) - 1; }

const ABILITY_TEXT = {
  // ── Suit ability ──────────────────────────────────────────────────────────
  lifesteal: {
    name: "Lifesteal",
    desc: "Heals itself for a share of the damage it deals.",
  },

  // ── Rank 2 — Berserker ────────────────────────────────────────────────────
  berserker: {
    desc: "A heavy body that hits harder the more it has been hurt. From a pair it also " +
          "charges a mana bar and refreshes its own shield every time the bar fills.",
    rung: function (t) {
      return "+" + abilPct(t.hpMult) + " more HP · +" + abilPct(t.ramp) +
             " attack per hit taken · shield " + abilPct(t.shieldFrac) + " of max HP per cast";
    },
  },

  // ── Rank 3 — Target Dummy ─────────────────────────────────────────────────
  thorns: {
    desc: "Bounces a share of every hit it takes straight back at the attacker.",
    rung: function (t) {
      return "reflects " + abilPct(t.reflect) + " of damage taken" +
             (t.reflect > 1 ? " — more than it receives" : "");
    },
  },
  targetDummy: {
    desc: "Never moves and never attacks, and carries far more HP for it. A wall that " +
          "only ever fights back through Thorns.",
  },

  // ── Rank 4 — the duellist ─────────────────────────────────────────────────
  hasteCast: {
    desc: "Every swing banks mana; a full bar makes it permanently faster, so the more " +
          "it attacks the sooner it attacks again.",
    rung: function (t) {
      return "+" + abilPct(t.speedMult) + " attack speed per cast, stacking to +" +
             abilPct(t.speedMax);
    },
  },
  giantSlayer: {
    desc: "Punches up: bonus damage against any target with a bigger health pool than its own.",
    rung: function (t) { return "+" + abilPct(t.bonus) + " damage vs bigger targets"; },
  },
  killDash: {
    desc: "Every kill makes it permanently quicker across the board.",
    rung: function (t) {
      return "+" + t.stepGain + " move step per kill, up to +" + (t.stepMax - 1);
    },
  },

  // ── Rank 5 — the evasive ──────────────────────────────────────────────────
  slippery: {
    desc: "A chance to slip any incoming hit entirely — no damage, no on-hit effects.",
    flat: function (a) { return abilPct(a.chance) + " chance to dodge a hit"; },
  },
  wardCast: {
    desc: "Banks a shield on a full mana bar. The shield soaks damage before HP does.",
    rung: function (t) {
      return "shield " + abilPct(t.shieldFrac) + " of max HP · " +
             (t.stack ? "layers a fresh one every cast" : "one at a time, recast once depleted");
    },
  },

  // ── Rank 6 — the devil ────────────────────────────────────────────────────
  executioner: {
    desc: "Its normal attacks finish off anything already badly wounded, straight through " +
          "shields and damage reduction.",
    flat: function (a) {
      return "autos are exactly lethal on enemies at or below " + abilPct(a.threshold) + " HP";
    },
  },
  fireball: {
    desc: "Swings bank mana; a full bar lobs a ball of fire at an enemy in range that " +
          "splashes onto everything beside it.",
    rung: function (t) {
      if (t.hitAll) return "×" + t.spellPower + " attack to EVERY enemy on the board";
      return "×" + t.spellPower + " attack to the target · " + abilPct(t.splashMult) +
             " of that to enemies within " + t.radius;
    },
  },
  burnAura: {
    desc: "Swings bank mana; a full bar scorches everything standing around it. No aim — " +
          "it is already surrounded.",
    rung: function (t) {
      return "×" + t.spellPower + " attack to all enemies within " + t.radius +
             " (" + abilRingCells(t.radius) + " cells)" +
             (t.fullStart ? " · starts the fight fully charged" : "");
    },
  },

  // ── Rank 7 — the gambler ──────────────────────────────────────────────────
  gambler: {
    desc: "Every hit rolls its damage at random, and the floor of that roll climbs as the " +
          "fight goes on. Fully ramped, it starts picking the enemy's pocket.",
    flat: function (a) {
      return "hits roll ×" + a.min + "–×" + a.max + " damage, floor +" +
             abilPct(a.rampPerHit) + " per hit · fully ramped it steals " + a.stealAmount + " chips";
    },
  },
  slotMachine: {
    desc: "The fastest-cycling caster in the game — a spin every few swings. Each spin " +
          "pulls ONE random effect off the reel, and you do not get to pick which.",
    rung: function (t, a, count) {
      // `t` is an ARRAY of reels here, not a table of knobs — rank 7 is the only ability
      // shaped this way. Name one reel as the yardstick (hellfire is on every tier) and
      // let the count carry the rest, rather than listing eight effects per rung.
      const hf = t.filter(function (r) { return r.effect === "hellfire"; })[0];
      const jack = a.jackpot && a.jackpot[count];
      return t.length + " reels · hellfire up to ×" + (hf ? hf.spellPower : "?") + " attack · " +
             (jack ? abilPct(jack.chance) + " for the 777 jackpot (×" + jack.spellPower +
                     " blast + " + jack.gold + " chips minted)"
                   : "no jackpot yet");
    },
  },

  // ── Rank 8 — the tank ─────────────────────────────────────────────────────
  bulwark: {
    desc: "Shaves a flat amount off every hit it takes. Hits never fall below 1, so it is " +
          "tough, never untouchable.",
    rung: function (t) { return "−" + t.reduce + " damage from every incoming hit"; },
  },
  trapline: {
    desc: "Lays traps in the lane ahead of it. Anything that walks in takes damage and is " +
          "slowed to a crawl.",
    rung: function (t) {
      const where = t.fullRow ? "a trap line across the whole row ahead"
                              : (t.lineWidth === 1 ? "1 trap in the cell ahead"
                                                   : t.lineWidth + " traps in the row ahead");
      return where + " · " + t.damage + " damage · slows for " + t.slowTicks + " ticks";
    },
  },
  caltrops: {
    desc: "Rings itself with traps — a perimeter against anything that tries to dive the " +
          "back line.",
    rung: function (t) {
      return "ring of " + abilRingCells(t.radius) + " traps around it · " + t.damage +
             " damage · slows for " + t.slowTicks + " ticks";
    },
  },

  // ── Rank 9 — the plague ───────────────────────────────────────────────────
  poison: {
    desc: "Every hit leaves poison that keeps ticking and never wears off. From trips, a " +
          "poisoned body that dies hands its poison to the nearest teammate.",
    rung: function (t) {
      return t.stackDamage + " poison per hit" +
             (t.transferPct ? " · plague passes " + abilPct(t.transferPct) + " on death"
                            : " · no plague yet");
    },
  },
  poisonVolley: {
    desc: "Fires a piercing shot down a straight line, poisoning the target and everything " +
          "standing behind it.",
    rung: function (t) {
      return (t.fullLine ? "rakes the whole line to the board edge"
                         : "pierces " + t.pierce + " more bodies behind the target") +
             " · ×" + t.stackMult + " poison stacks";
    },
  },
  poisonNova: {
    desc: "Exhales a cloud that poisons everything around it. No aim needed — it fires the " +
          "moment the bar fills.",
    rung: function (t) {
      return "cloud covering " + abilRingCells(t.radius) + " cells · ×" + t.stackMult +
             " poison stacks" + (t.deathCloud ? " · one last cloud on its own corpse" : "");
    },
  },

  // ── Rank 10 — the connector ───────────────────────────────────────────────
  rally: {
    desc: "A pure placement card: it buffs the allies standing next to it, never itself and " +
          "never enemies. Locked in where you drop it, before the fight starts.",
    // Four suits, four different stats, one function. Which knob the tier carries IS which
    // face this 10 is wearing, so detecting the field beats passing the suit down.
    rung: function (t) {
      if (t.hpMult != null)       return "neighbours +" + abilPct(t.hpMult) + " max HP";
      if (t.critBonus != null)    return "neighbours +" + abilPct(t.critBonus) + " crit chance";
      if (t.speedMult != null)    return "neighbours +" + abilPct(t.speedMult) + " attack speed";
      if (t.lifestealPct != null) return "neighbours drain " + abilPct(t.lifestealPct) +
                                         " of the damage they deal";
      return "";
    },
  },

  // ── Fusion-only kits (made hands) ─────────────────────────────────────────
  // These never appear on a plain card — only on a fused body, whose ability list is
  // authored by FUSABLE_HANDS rather than assembled from suit+rank.
  dirtyDiaper: {
    desc: "The 2-3 made hand: a wall that stinks. Everything that touches it comes away worse.",
  },
  jackpotExecute: {
    desc: "The 6-7 made hand: a fully ramped Gambler roll becomes an instant kill.",
  },
  warpath: {
    desc: "Grows stronger with every ally fighting beside it, and feeds some of that back " +
          "to them.",
  },
};
