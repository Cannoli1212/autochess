// abilities.js — the ability-hook system (Phase 0 of "unique cards").
// A unit carries an `abilities` list; the combat engine calls named hooks at key
// moments, and every ability that implements that hook runs. This lets FUTURE
// cards add unique effects as DATA + a small kit here, WITHOUT editing the combat
// loop each time. Depends on: nothing (handlers read only the unit + the ctx).
//
// Design split (decided in Phase 0): STATS (attack, hp, range, attackSpeed,
// critChance) are plain numbers the loop reads. ABILITIES are triggered EFFECTS
// that fire on an event via the hooks below. Today only lifesteal is an ability;
// crit/fast/range stay stats.

// PHALANX pack-scaling (Batch A of "unit identity"): how many cards of `unit`'s
// rank sit in its team's poker POOL (its fielded units + the shared flop — the
// same count the poker synergies use). Always ≥ 1, because the unit's own pool
// entry counts — so (packCount(unit) - 1) = the EXTRA copies beyond itself.
// Berserk / Giant Slayer / Bulwark / Poison all read this ONCE at round start and
// bake a scaled number onto the unit (like applySynergies), so a copy dying
// mid-fight never weakens the survivors.
function packCount(unit) {
  return rankCounts(pokerPool(unit.team))[unit.rank] || 1;
}

// ROLE split (Riley 2026-07-15): is `suit` a RANGED suit? Decided by the SUIT's BASE range
// (♣/♠ = 3 = ranged; ♥/♦ = 1 = melee), NOT a unit's final range — so a Q♥ buffed to range 2,
// or an Ace of Clubs at range 16, still counts by its suit's role. Drives rank abilities that
// come in melee vs ranged flavors (rank 6's Hellfire: a projectile for ♣/♠, a self-aura for ♥/♦).
function isRangedSuit(suit) {
  return SUITS[suit].range > 1;
}

// A card's rank abilities AFTER the role filter: an entry with no `role` applies to every suit
// (shared passives like rank 6's Executioner); an entry tagged role:"melee"/"ranged" only lands
// on the matching half. Shared by unitAbilities (what the unit actually runs) and rankAbilityText
// (so a ♥6's tooltip advertises its aura, not the ♣/♠ projectile it can't cast).
function rankAbilitiesFor(card) {
  return (RANK_ABILITIES[card.rank] || []).filter(function (a) {
    if (!a.role) return true;
    return a.role === (isRangedSuit(card.suit) ? "ranged" : "melee");
  });
}

// Put `stacks` of poison on `victim` from `shooter`: bump the victim's poison total
// (drained per tick in combatStep) and stamp the shooter's plague-transfer fraction,
// keeping the biggest if two poisoners tagged it. Shared by the normal poison-on-hit
// AND rank 9's Poison Volley so a pierced unit rots exactly like a directly-hit one.
function applyPoison(shooter, victim, stacks) {
  if (!victim || victim.hp <= 0 || stacks <= 0) return;
  victim.poison = (victim.poison || 0) + stacks;
  const t = shooter.poisonTransfer || 0;
  if (t > (victim.poisonTransfer || 0)) victim.poisonTransfer = t;
}

// One breath of MIASMA (rank 9's melee cast): poison every enemy within the caster's baked
// cloud radius for `poisonStack × stackMult` stacks. Pulled out of poisonNova.onCast so the
// QUADS `deathCloud` rung can fire the exact same cloud from onDeath — one last breath on the
// plague bearer's own corpse — without either copy of the code drifting from the other.
function exhaleMiasma(unit, ability) {
  const base = (unit.poisonStack !== undefined) ? unit.poisonStack : 5;   // baked by poison.onRoundStart
  const mult = (unit.miasmaMult !== undefined) ? unit.miasmaMult : ability.tiers[2].stackMult;
  const stacks = Math.round(base * (mult || 1));
  const radius = (unit.miasmaRadius !== undefined) ? unit.miasmaRadius : ability.tiers[2].radius;
  emitAbilityShape(unit, "poisonNova", "ring", { radius: radius });   // the cloud's actual reach
  const foes = enemiesNear(unit, radius);
  for (let i = 0; i < foes.length; i++) {
    applyPoison(unit, foes[i], stacks);
    foes[i].spellHitUntil = tickCount + FLASH_TICKS;   // flash each cell the cloud touches
    emitFx("poison", { x: foes[i].x, y: foes[i].y, amount: stacks });
  }
}

// STUN primitive (casting, Riley 2026-07-15): freeze `victim` for `ticks` — unlike SLOW
// (which only lengthens the move cooldown), a stunned unit takes NO turn at all: it can't
// move, can't auto-attack, and can't cast (combatStep checks u.stunUntil in both the acting
// loop and the mana/cast pass). A tick-stamp on the victim, like slowUntil/invulnUntil;
// KEEP THE LONGER of an existing stun and the new one so a second, shorter stun can't cut a
// long one short. No caster fires it YET — this is the plumbing the 7s Slot Machine (and any
// future stun cast) will call, exactly like the mana/cast pass was built before any spell.
function applyStun(victim, ticks) {
  if (!victim || victim.hp <= 0 || ticks <= 0) return;
  victim.stunUntil = Math.max(victim.stunUntil || 0, tickCount + ticks);
}

// The kit library. Each kit is keyed by `kind` and implements one or more hooks.
// Hooks available so far:
//   onDealDamage(unit, ctx, ability) — right after `unit` lands damage on a
//       target. ctx = { target, damage }.
//   onKill(unit, ctx, ability) — right after `unit`'s hit drops a target to 0 HP.
//       ctx = { target } (the unit that just died). Fires once per kill.
//   onDeath(unit, ctx, ability) — when `unit` ITSELF drops to 0 HP, fired in
//       combatStep just before the dead are cleared. ctx = {}. Fires once, for
//       ANY cause of death (a hit, a redirected hit, or poison).
// (onAttack, onRoundStart, onDamaged also exist; onCast fires from the mana/cast pass
//  in combatStep when a caster's mana bar fills — see combat.js. New hooks get added
//  here and wired into the engine as future cards need them.)
const ABILITIES = {
  // Diamonds' lifesteal: heal the attacker for the damage it just dealt, capped
  // at its max HP. Migrated UNCHANGED from the old hard-coded check in combat.js.
  lifesteal: {
    onDealDamage: function (unit, ctx) {
      // Emit the HP it ACTUALLY gained, not ctx.damage. A diamond at full health drinks
      // nothing, and a green "+40" over a unit whose bar never moved would be a lie — the
      // cap is exactly the thing worth seeing. (This is also why lifesteal can't just call
      // heal(): that would fire the Cleric's green cell-pulse on every single swing.)
      const before = unit.hp;
      unit.hp = Math.min(unit.maxHp, unit.hp + ctx.damage);
      const drank = unit.hp - before;
      if (drank > 0) emitFx("heal", { x: unit.x, y: unit.y, amount: drank });
    },
  },

  // Rank 3 — Thorns: when hit, reflect a PERCENTAGE of the damage taken back at the
  // attacker, so a big hit stings more — the Target Dummy's whole point. RAW hp
  // subtraction (not an attack), so it does NOT re-fire onDamaged and two thorns units
  // can't ping-pong forever. Skips fully-soaked/zero hits (nothing to reflect).
  thorns: {
    // OF-A-KIND scaling (redesigned 2026-07-22, replaced the maxHp formula): at fight
    // start read packCount (this unit's 3s in the pool — fielded 3s + the shared flop),
    // pick the tier, and bake its `reflect` % ONCE onto unit.thornsReflect. More 3s = a
    // meaner wall; quads bounce back MORE than they take. Counts cap at 4 (5+ uses quads).
    // Baked once so a copy dying mid-fight can't drop everyone's tier.
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);          // this unit's 3s in the pool (units + flop)
      unit.thornsReflect = ability.tiers[Math.min(count, 4)].reflect;
    },
    onDamaged: function (unit, ctx, ability) {
      if (ctx.attacker && ctx.damage > 0) {
        // Use the tier value baked at round start; else fall back to the lone-3 tier
        // (e.g. the 1v1 sim skips round-start prep, so nothing was baked).
        const pct = (unit.thornsReflect !== undefined) ? unit.thornsReflect : ability.tiers[1].reflect;
        const reflected = Math.round(ctx.damage * pct);
        ctx.attacker.hp = ctx.attacker.hp - reflected;
        // Reflected damage: the thorns holder (unit) is the dealer, the attacker the victim.
        recordDamage(unit, ctx.attacker, reflected);
        // Raw hp subtraction bypasses the whole damage pipeline, so it also bypassed the
        // fx that pipeline emits — a Target Dummy could kill its attacker with the board
        // showing NOTHING. Rose number on the ATTACKER's square: it's their own damage
        // coming home, which is why it isn't white.
        if (reflected > 0) emitFx("reflect", { x: ctx.attacker.x, y: ctx.attacker.y, amount: reflected });
      }
    },
  },

  // 2-3 FUSION "Dirty Diaper" (Berserk × Thorns): a reflect wall whose spikes get
  // SHARPER every hit it eats — Berserk's "stronger when hurt" spent on the Thorns
  // reflect % instead of on attack. onRoundStart bakes the STARTING reflect exactly
  // like Thorns (base + per-100-max-HP, capped). onDamaged reflects at the current
  // sharpness, THEN ramps it up by `rampPerHit` toward `rampCap`. It authored-away
  // the rank-3 Target Dummy marker, so it is NOT inert — it keeps a (taxed) body.
  dirtyDiaper: {
    onRoundStart: function (unit, ctx, ability) {
      let pct = ability.reflect + (unit.maxHp / 100) * (ability.reflectPer100Hp || 0);
      if (ability.reflectMax !== undefined) pct = Math.min(pct, ability.reflectMax);
      unit.thornsReflect = pct;
    },
    onDamaged: function (unit, ctx, ability) {
      if (!ctx.attacker || !(ctx.damage > 0)) return;
      // Reflect at the CURRENT sharpness (fall back to base if round-start prep was
      // skipped, e.g. the 1v1 sim). Raw HP subtraction, like Thorns — no re-trigger.
      const pct = (unit.thornsReflect !== undefined) ? unit.thornsReflect : ability.reflect;
      const reflected = Math.round(ctx.damage * pct);
      ctx.attacker.hp = ctx.attacker.hp - reflected;
      recordDamage(unit, ctx.attacker, reflected);
      if (reflected > 0) emitFx("reflect", { x: ctx.attacker.x, y: ctx.attacker.y, amount: reflected });
      // ...then get spikier for next time (the Berserk ramp), capped at rampCap.
      const cap = (ability.rampCap !== undefined) ? ability.rampCap : Infinity;
      unit.thornsReflect = Math.min(cap, pct + (ability.rampPerHit || 0));
    },
  },

  // Rank 3 — Target Dummy: a MARKER (no combat hook). Its presence flags the card as
  // INERT: makeCardOf zeroes its attack + boosts its HP (DUMMY_HP_MULT), and combatStep
  // skips its whole turn (no move, no attack). All a dummy does is soak hits and reflect
  // Thorns — read via cardIsInert (below), like the other non-hook markers.
  targetDummy: {},

  // Rank 2 — Berserk: each time it's hurt, gain a share of its STARTING attack
  // (captured once, so the growth is linear rather than compounding). The ramp is
  // INFINITE by design — every hit survived is more attack, so the 2♦ is the
  // natural carry (lifesteal keeps it alive to keep ramping).
  // PHALANX pack-scaling: at fight start, each EXTRA 2 in the pool (a) adds
  // `hpPerExtra` of this unit's max HP — a tougher berserker survives more hits,
  // and every hit is more attack — and (b) raises the per-hit gain by
  // `gainPerExtra`, baked onto unit.berserkGain. Runs AFTER applySynergies, so
  // the HP bonus multiplies the already-buffed number.
  berserk: {
    onRoundStart: function (unit, ctx, ability) {
      const extras = packCount(unit) - 1;
      if (ability.hpPerExtra && extras > 0) {
        const bonus = Math.round(unit.maxHp * ability.hpPerExtra * extras);
        unit.hp = unit.hp + bonus;
        unit.maxHp = unit.maxHp + bonus;
      }
      unit.berserkGain = ability.gain + (ability.gainPerExtra || 0) * extras;
    },
    onDamaged: function (unit, ctx, ability) {
      if (unit.baseAttack === undefined) unit.baseAttack = unit.attack;
      // The pack-scaled gain if round-start baked it; else the base gain (e.g.
      // the 1v1 sim path that skips round-start prep).
      const gain = (unit.berserkGain !== undefined) ? unit.berserkGain : ability.gain;
      unit.attack = unit.attack + Math.round(unit.baseAttack * gain);
    },
  },

  // Rank 2 — Berserker (redesigned 2026-07-22). GATED of-a-kind ability: a lone 2 is just a
  // (base-HP-buffed) body; a PAIR+ unlocks the ability. onRoundStart reads packCount (fielded
  // 2s + flop), picks the tier, and bakes the HP buff + per-hit ramp + per-cast shield fraction
  // ONCE (like the other pack-scaled kits, so a dying copy can't weaken survivors). onDamaged
  // applies the ramp each hit; onCast banks the shield each time the mana bar fills.
  berserker: {
    onRoundStart: function (unit, ctx, ability) {
      unit.berserkerRamp = 0;                 // default: dormant (lone 2 → no ramp yet)
      unit.berserkerShieldFrac = 0;           // default: no shield cast (lone 2)
      // Base HP buff — UNGATED, so EVERY 2 (even a lone one) is a tankier body. Runs AFTER
      // applySynergies, so it grows the already suit/synergy-buffed HP.
      if (ability.baseHpMult) {
        const base = Math.round(unit.maxHp * ability.baseHpMult);
        unit.maxHp += base;
        unit.hp += base;
      }
      const count = packCount(unit);          // this unit's 2s in the pool (units + flop)
      if (count < 2) {                        // GATE: a lone 2 doesn't cast — kill its mana bar
        unit.caster = false;                  // so the cast pass skips it and no dead bar renders
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      // HP buff (every rung). Runs AFTER applySynergies, so it grows the already-buffed HP.
      const bonus = Math.round(unit.maxHp * t.hpMult);
      unit.maxHp += bonus;
      unit.hp += bonus;
      unit.berserkerRamp = t.ramp;            // bake the per-hit ramp for onDamaged
      unit.berserkerShieldFrac = t.shieldFrac;// bake the per-cast shield size for onCast
    },
    onDamaged: function (unit, ctx, ability) {
      if (!unit.berserkerRamp || !(ctx.damage > 0)) return;   // dormant, or a fully-soaked hit
      if (unit.baseAttack === undefined) unit.baseAttack = unit.attack;   // capture once → linear ramp
      unit.attack += Math.round(unit.baseAttack * unit.berserkerRamp);
    },
    // Fires when the mana bar fills (castTargeting "self", so no target needed). Banks a shield
    // worth the baked per-cast fraction of max HP onto u.shield — the SAME damage pool Ward and
    // the Ace of Diamonds' Aegis use, drained before HP. Repeatable: it REFRESHES every full bar,
    // so a paired 2 keeps re-shielding through a long fight. Gated: a lone 2's frac is 0 → no-op.
    onCast: function (unit, ctx, ability) {
      if (!unit.berserkerShieldFrac) return;
      unit.shield = (unit.shield || 0) + Math.round(unit.maxHp * unit.berserkerShieldFrac);
    },
  },

  // Rank 4 — Giant Slayer: bonus damage vs targets with MORE max HP than itself
  // (it "punches up"). Plays differently per suit for free — brutal on a glassy
  // 4♠/4♣, tame on a tanky 4♥ whose own maxHP is already high.
  // OF-A-KIND GATED (redesigned 2026-07-22, Riley — same dial as ranks 2 & 3): the passive
  // UNLOCKS at TRIPS (a lone 4 or a pair get NO Giant Slayer — the pair only unlocks Haste).
  // ROLE-split magnitude: RANGED ♣/♠ read `tiersRanged` (the full bonus); MELEE ♥/♦ read
  // `tiersMelee` (a SMALLER bonus — they're compensated by Kill Dash). QUADS buff both tables.
  // Baked ONCE at round start off packCount (fielded 4s + the shared flop). tiers are keyed by
  // of-a-kind count: 3=trips, 4=quads (caps at 4); counts 1-2 have no entry → slayerBonus 0.
  giantSlayer: {
    onRoundStart: function (unit, ctx, ability) {
      const table = isRangedSuit(unit.suit) ? ability.tiersRanged : ability.tiersMelee;
      const t = table[Math.min(packCount(unit), 4)];   // undefined below trips
      unit.slayerBonus = t ? t.bonus : 0;              // 0 = ungated body (lone/pair)
    },
    onAttack: function (unit, ctx, ability) {
      if (!unit.slayerBonus) return;                   // not yet unlocked (below trips)
      if (ctx.target.maxHp > unit.maxHp) {
        ctx.damage = Math.round(ctx.damage * (1 + unit.slayerBonus));
      }
    },
  },

  // Rank 5 — Slippery: chance to dodge an incoming hit entirely (sets ctx.dodged,
  // which attackTarget checks to cancel the whole attack).
  slippery: {
    onIncomingHit: function (unit, ctx, ability) {
      if (Math.random() < ability.chance) ctx.dodged = true;
    },
  },

  // Rank 6 — Executioner: EXECUTES targets already LOW on HP (the mirror of Giant
  // Slayer, which punches up — this one finishes the wounded). If the target is at
  // or below `threshold` of its max HP before the hit, the hit is flagged as an
  // execute; attackTarget then makes the damage EXACTLY lethal, punching through
  // Bulwark's reduction and the Aegis shield. An execute can still be dodged or
  // blanked by invulnerability — those cancel the whole attack before this runs.
  executioner: {
    onAttack: function (unit, ctx, ability) {
      if (ctx.target.hp <= ctx.target.maxHp * ability.threshold) ctx.execute = true;
    },
  },

  // Rank 7 — Gambler: every hit rolls a random multiplier between a FLOOR and
  // `max` (leans into the game's poker/gambling theme). Batch B ramp: each landed
  // hit raises the floor by `rampPerHit`, from `min` up to `max` — a gambler on a
  // heater whose worst roll keeps improving until every hit is a guaranteed
  // haymaker. The floor lives on the unit (unit.gamblerMin), so it resets when
  // units rebuild next round. onAttack only fires for hits that will land (dodge
  // and invulnerability cancel the attack before it), so whiffs don't ramp.
  // FULLY ramped, each damaging hit has `stealChance` to pickpocket chips from
  // the enemy player — the first ability to touch the ECONOMY mid-combat. The 7♦
  // steals `diamondBonus` more (the wealth suit).
  gambler: {
    onAttack: function (unit, ctx, ability) {
      if (unit.gamblerMin === undefined) unit.gamblerMin = ability.min;
      const factor = unit.gamblerMin + Math.random() * (ability.max - unit.gamblerMin);
      ctx.damage = Math.round(ctx.damage * factor);
      ctx.rollFactor = factor;   // expose the roll so a later kit can read it (6-7 Jackpot)
      unit.gamblerMin = Math.min(ability.max, unit.gamblerMin + (ability.rampPerHit || 0));
    },
    onDealDamage: function (unit, ctx, ability) {
      // The steal: only once fully ramped, only on a hit that actually cost HP
      // (a shield-soaked 0 pays nothing), and only what the victim can afford.
      if (unit.gamblerMin === undefined || unit.gamblerMin < ability.max) return;
      if (!(ctx.damage > 0)) return;
      if (Math.random() >= ability.stealChance) return;
      const enemy = (unit.team === "player1") ? "player2" : "player1";
      let amount = ability.stealAmount + (unit.suit === "diamonds" ? (ability.diamondBonus || 0) : 0);
      amount = Math.min(amount, chips[enemy] || 0);
      if (amount <= 0) return;
      chips[enemy] = chips[enemy] - amount;
      chips[unit.team] = (chips[unit.team] || 0) + amount;
      if (!SIM_MODE) updateChipInfo();   // chip badges live-update mid-fight
      // A chip badge ticking up in the corner is the only thing that used to happen here,
      // and nobody watching a fight is looking at the corner. This is the one number in
      // combat that changes the SCORE rather than the board, so it's emitted on the
      // thief's own square, where the eye already is.
      emitFx("gold", { x: unit.x, y: unit.y, amount: amount });
    },
  },

  // 6-7 FUSION "Double or Nothing" (Gambler × Executioner): rides the Gambler kit
  // (listed BEFORE this one, so it has already stashed its rolled multiplier on
  // ctx.rollFactor) and turns a JACKPOT roll — rollFactor at or above `jackpotAt` —
  // into a guaranteed execute, lethal through Bulwark and shields like rank 6's
  // Executioner. The normal low-HP Executioner (also listed) still fires on its own.
  // As the Gambler's floor ramps, jackpots (and thus executes) grow more frequent.
  jackpotExecute: {
    onAttack: function (unit, ctx, ability) {
      if (ctx.rollFactor !== undefined && ctx.rollFactor >= ability.jackpotAt) {
        ctx.execute = true;
      }
    },
  },

  // Rank 8 — Bulwark: flat damage reduction on incoming hits. Sets ctx.reduce,
  // which attackTarget subtracts AFTER crit/bonuses (floored at 1 so a shield is
  // never full immunity). Great vs many small hits, weak vs one big one.
  // OF-A-KIND tiered (redesigned 2026-07-23, Riley — same pair/trips/quads dial as ranks 2-7,
  // but NOT gated): the reduction CLIMBS with the count of pooled 8s — lone 15 → pair 30 →
  // trips 40 → quads 50 (tiers keyed by count, caps at 4). packCount is always ≥ 1, so even a
  // lone 8 gets tiers[1], the ungated base. Baked ONCE at round start so a copy dying mid-fight
  // can't drop everyone's tier.
  bulwark: {
    onRoundStart: function (unit, ctx, ability) {
      const t = ability.tiers[Math.min(packCount(unit), 4)];   // 1=lone,2=pair,3=trips,4=quads
      unit.bulwarkReduce = t ? t.reduce : ability.tiers[1].reduce;
    },
    onIncomingHit: function (unit, ctx, ability) {
      // The tiered reduction if baked; else the lone base (the 1v1 sim path skips round-start prep).
      const reduce = (unit.bulwarkReduce !== undefined) ? unit.bulwarkReduce : ability.tiers[1].reduce;
      ctx.reduce = (ctx.reduce || 0) + reduce;
    },
  },

  // Rank 9 — Poison: hits apply poison STACKS to the target (stored on the victim
  // as u.poison, total damage-per-tick). The draining happens in combat.js's
  // combatStep each tick — the status lives on the victim, not on its own ability
  // list, so it can't be a victim-side hook. Ignores HP scaling → great vs tanks.
  // OF-A-KIND TIERED, UNGATED (redesigned 2026-08-05 — the same dial as ranks 2-8, built like
  // rank 8's Bulwark). Every 9 poisons: tiers[1] is the lone base, and the stack fattens each
  // rung (5 → 8 → 11 → 14) off packCount (fielded 9s + the shared flop), baked ONCE at round
  // start so a copy dying mid-fight can't weaken the survivors.
  // PLAGUE: the same table carries `transferPct`, so the jump unlocks at TRIPS (half the stacks)
  // and goes FULL at quads. The fraction is baked here, stamped onto each victim on hit, and
  // combatStep's transfer block does the jumping (the status lives on the victim, so the engine
  // owns the death moment).
  poison: {
    onRoundStart: function (unit, ctx, ability) {
      const t = ability.tiers[Math.min(packCount(unit), 4)] || ability.tiers[1];   // 1=lone…4=quads
      unit.poisonStack = t.stackDamage;
      unit.poisonTransfer = t.transferPct || 0;
    },
    onDealDamage: function (unit, ctx, ability) {
      // The tiered stack if baked; else the lone base (a harness path that skips round-start prep).
      const stack = (unit.poisonStack !== undefined) ? unit.poisonStack : ability.tiers[1].stackDamage;
      applyPoison(unit, ctx.target, stack);
    },
  },

  // POISON VOLLEY (rank 9's cast — the first PIERCING spell). Fires from the mana/cast
  // pass when the bar (attack-charged) fills and an enemy sits within castRange. The arrow
  // flies from the shooter THROUGH the aimed target and onward, poisoning it plus every
  // enemy behind it on the straight 8-direction ray (up to a tiered `pierce` depth — baked in
  // onRoundStart). Each struck unit takes `poisonStack × stackMult` stacks via the shared
  // applyPoison (so it also inherits the plague-jump). No direct damage — the DoT is the
  // payload. Reuses `poisonStack`, which poison.onRoundStart already baked on this unit.
  // OF-A-KIND GATED (redesigned 2026-08-05 — same pair/trips/quads dial as ranks 2-8). A LONE 9
  // is a poisoner BODY with NO cast (mana bar killed, like a lone 6/7/8). A PAIR unlocks the
  // volley, TRIPS doubles how deep it pierces, and QUADS bakes `volleyFullLine` → the arrow
  // never stops, raking the ray clean to the board edge (the twin of Trapline's `fullRow`).
  // stackMult stays FLAT across the rungs on purpose: `poisonStack` is already climbing 5→14,
  // and poison never decays, so the cast's stacks still rise 16→22→28 without compounding.
  poisonVolley: {
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);          // this unit's 9s in the pool (units + flop)
      if (count < 2) {                        // GATE: a lone 9 rots on hit but looses no volley
        unit.caster = false;                  // cast pass skips it; the poison passive still lands
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.volleyFullLine = !!t.fullLine;     // quads: pierce the WHOLE ray (ignores depth)
      unit.volleyPierce = t.pierce || 0;
      unit.volleyMult = t.stackMult;
    },
    onCast: function (unit, ctx, ability) {
      const target = ctx.target;
      if (!target) return;
      // QUADS — an unstoppable arrow: COLS + ROWS can't be reached on any ray, so it's "no cap".
      const maxPierce = unit.volleyFullLine ? (COLS + ROWS)
        : ((unit.volleyPierce !== undefined) ? unit.volleyPierce : ability.tiers[2].pierce);
      const base = (unit.poisonStack !== undefined) ? unit.poisonStack : 5;   // baked by poison.onRoundStart
      const mult = (unit.volleyMult !== undefined) ? unit.volleyMult : ability.tiers[2].stackMult;
      const stacks = Math.round(base * (mult || 1));
      const line = unitsAlongLine(unit, target, maxPierce);
      // Draw the arrow to the LAST unit it actually reached — not to the one it was aimed
      // at. That difference is the whole point of a piercing shot: you can see how deep
      // this 9's pierce tier really goes, rather than guessing from where numbers landed.
      if (line.length > 0) {
        const last = line[line.length - 1];
        emitAbilityShape(unit, "poisonVolley", "line", { x: last.x, y: last.y });
      }
      for (let i = 0; i < line.length; i++) {
        applyPoison(unit, line[i], stacks);
        line[i].spellHitUntil = tickCount + FLASH_TICKS;   // flash each cell the arrow strikes
        // The volley's damage is a DoT, so nothing lands this tick and the one-tick cell
        // flash was the entire feedback — you couldn't tell how many stacks went on, or
        // even that the shot had fired. Purple, matching the poison ticks it becomes.
        emitFx("poison", { x: line[i].x, y: line[i].y, amount: stacks });
      }
    },
  },

  // MIASMA (rank 9's MELEE cast — a self-centered POISON nova, casting, Riley 2026-07-15).
  // The melee ♥/♦ 9s can't loose the ranged Poison Volley line, so they exhale it instead: on a
  // full (attack-mana) bar, poison EVERY enemy within `radius` of the caster for `poisonStack ×
  // stackMult` stacks. The exact twin of the rank-6 burnAura but with applyPoison instead of
  // dealSpellDamage — so it reuses enemiesNear, the `poisonStack` baked by poison.onRoundStart
  // (same as Poison Volley), AND the plague-jump (applyPoison stamps the shooter's transfer onto
  // each victim). Pure dispatch, zero engine change. castTargeting "self" fires it with no aim —
  // the melee 9 is already in the cloud. stackMult is lower than the Volley's: it rots a ring.
  // OF-A-KIND GATED (redesigned 2026-08-05 — same pair/trips/quads dial as ranks 2-8). A LONE 9
  // is a poisoner BODY with NO cast (mana bar killed). A PAIR unlocks the cloud, TRIPS widens it
  // to radius 2, and QUADS bakes `miasmaDeathCloud` → when the plague bearer DIES it exhales one
  // final free Miasma on its own corpse. That last breath rides the same applyPoison, so at quads
  // (transferPct 1.0) it seeds a FULL-strength plague on everything standing over the body —
  // killing the poisoner becomes the worst way to deal with it. Fires from the engine's onDeath
  // pass, which runs AFTER the poison tick and the transfer block and reads final HP, so it
  // triggers on any cause of death — including the 9 rotting to death itself.
  poisonNova: {
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);          // this unit's 9s in the pool (units + flop)
      if (count < 2) {                        // GATE: a lone 9 rots on hit but exhales nothing
        unit.caster = false;                  // cast pass skips it; the poison passive still lands
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.miasmaRadius = t.radius;
      unit.miasmaMult = t.stackMult;
      unit.miasmaDeathCloud = !!t.deathCloud;
    },
    onCast: function (unit, ctx, ability) {
      exhaleMiasma(unit, ability);
    },
    onDeath: function (unit, ctx, ability) {
      if (unit.miasmaDeathCloud) exhaleMiasma(unit, ability);   // quads — one last breath
    },
  },

  // Ace of Diamonds — Aegis: on a kill, bank a shield worth a fraction of the
  // slain unit's MAX HP. The shield is a damage pool on the unit (u.shield) that
  // combat.js drains before HP. Uses the victim's maxHp (its full "health" stat),
  // not its leftover HP, so the reward doesn't shrink just because you softened it
  // up first. Stacks across kills → a diamond Ace that keeps killing gets tanky.
  shieldOnKill: {
    onKill: function (unit, ctx, ability) {
      const banked = Math.round(ctx.target.maxHp * ability.fraction);
      unit.shield = (unit.shield || 0) + banked;
      // The shield BAR already showed the total, but a bar that silently gets wider on a
      // kill doesn't connect the reward to the kill that earned it. "🛡+N" on the Ace's
      // own square, the same tick its victim dies, does.
      if (banked > 0) emitFx("shield", { x: unit.x, y: unit.y, amount: banked });
    },
  },

  // Ace of Hearts — Necromancer: on a kill, pull one RANDOM card off the owner's
  // bench (hands[team]) and spawn it as a unit on the nearest empty cell. It moves
  // to `played` so it's tracked/discarded like any board card. Silently does nothing
  // if the bench is empty or the board is full. The summon is a BONUS body — it is
  // added straight to `units` and never checks the round's unit cap.
  summonOnKill: {
    onKill: function (unit, ctx, ability) {
      const bench = hands[unit.team];
      if (!bench || bench.length === 0) return;         // nothing left to raise
      const cell = nearestEmptyCell(unit.x, unit.y);
      if (cell === null) return;                        // nowhere to put it
      const idx = Math.floor(Math.random() * bench.length);
      const card = bench.splice(idx, 1)[0];             // pull a random bench card
      played[unit.team].push(card);                     // now a board card (discarded at round end)
      units.push(buildUnit(card, cell.x, cell.y, unit.team));
      // Mark the square the body rose on. Without this a unit simply EXISTS next render,
      // with nothing tying it to the kill that raised it — the most startling silent
      // moment in the game, because a whole new fighter appears out of nowhere.
      emitFx("summon", { x: cell.x, y: cell.y });
    },
  },

  // King of Clubs — Airstrike: a PLACEMENT marker (no combat hook). Its presence on
  // the board grants marks (read by strikeAllowance); the strike itself resolves in
  // gameflow's resolveStrikes at Round Start. Listed so it's a real kit / tooltip.
  airstrike: {},

  // Queen of Spades — The Black Lady: a HAND marker (no combat hook). Read by
  // handTax at round end to bleed chips from a player still holding her. Harmless if
  // she's placed as a unit (no hooks fire); the penalty only applies from the hand.
  houseTax: {},

  // Jack of Diamonds — Highwayman: a PLAYED-card marker (no combat hook). Read by
  // teamLootMult at round end to fatten the winner's chip steal. He only has to be
  // fielded (played) that round — he needn't survive the fight to have done the job.
  loot: {},

  // Queens of Diamonds & Clubs — Extinguish: a FIELDED marker (no combat hook). Read
  // by isSuitExtinguished in synergies.js to switch off an enemy suit's flush buff.
  extinguish: {},

  // Jack of Clubs — Cleave: on every hit, splash a fraction of the damage to enemies
  // within `radius` cells of the TARGET. Raw HP subtraction (like Thorns/Poison) so
  // it can't re-trigger on-hit effects or recurse; splash kills are cleared by
  // combatStep's normal filter. The primary target already took the full hit.
  cleave: {
    onDealDamage: function (unit, ctx, ability) {
      const splash = Math.round(ctx.damage * ability.cleaveMult);
      if (splash <= 0) return;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.team === unit.team || u === ctx.target) continue;   // enemies only, not the primary
        const dist = Math.max(Math.abs(u.x - ctx.target.x), Math.abs(u.y - ctx.target.y));
        if (dist <= ability.radius) {
          u.hp = u.hp - splash;
          recordDamage(unit, u, splash);   // cleave splash counts too
          // Same blind spot as Thorns: raw hp subtraction never touched the fx layer, so
          // a cleave through a packed crowd drained eight health bars in total silence.
          // White, like an auto-attack — because that's what it is, spread sideways.
          emitFx("hit", { x: u.x, y: u.y, amount: splash });
        }
      }
    },
  },

  // FIREBALL (casting Phase 2 — the first spell). Fires from the mana/cast pass in
  // combat.js when a mage's bar is full and a target sits within castRange. It nukes the
  // target for `spellPower` × the caster's CURRENT attack (so a fireball rides the same
  // rank/suit/synergy scaling as everything else), then splashes the same amount to every
  // enemy within `radius` cells of the target (Chebyshev, like Cleave). radius 0 = single
  // target. `splashMult` (default 1) tunes the splash down if wanted. All damage goes
  // through dealSpellDamage — shields/invuln/redirect + the victim's Thorns/Berserk, but
  // no crit and no lifesteal. Balance knobs: spellPower, radius, splashMult, + the mana
  // profile (manaMax/manaRegen/manaStart) on the card that sets cast cadence.
  fireball: {
    // OF-A-KIND GATED (rank 6 ranged, Riley 2026-07-23 — same pair/trips/quads dial as ranks 2-5).
    // The Hellfire projectile is the of-a-kind payoff: a LONE 6 is a plain Executioner body with NO
    // cast (mana bar killed, like a lone 2/4/5). A PAIR unlocks the base fireball, TRIPS bumps the
    // damage, and QUADS bakes `fireHitAll` → the projectile becomes a BOARD-WIDE nuke (full fireball
    // damage to EVERY living enemy, ignoring the single-target + splash shape). Baked ONCE at round
    // start off packCount (fielded 6s + the shared flop), so a copy dying mid-fight can't weaken it.
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);          // this unit's 6s in the pool (units + flop)
      if (count < 2) {                        // GATE: a lone 6 doesn't cast — kill its mana bar
        unit.caster = false;                  // cast pass skips it; Executioner passive still lands
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.fireSpellPower = t.spellPower;
      unit.fireRadius = t.radius;
      unit.fireSplashMult = t.splashMult;
      unit.fireHitAll = !!t.hitAll;
    },
    onCast: function (unit, ctx, ability) {
      const power = (unit.fireSpellPower !== undefined) ? unit.fireSpellPower : ability.tiers[2].spellPower;
      const dmg = Math.round(unit.attack * (power || 1));
      // QUADS — board-wide nuke: full fireball damage to EVERY living enemy, no target needed.
      if (unit.fireHitAll) {
        // The quads nuke has NO target and no radius — it just hits everyone. Without a
        // shape, a board-wide scorch is indistinguishable from several unrelated units
        // taking damage in the same tick. One orb per victim would be eight projectiles;
        // instead the caster throws a single huge ring, which says "this was ONE cast"
        // and shows where it came from.
        emitAbilityShape(unit, "fireball", "ring", { radius: Math.max(COLS, ROWS) });
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          if (u.team === unit.team || u.hp <= 0) continue;
          dealSpellDamage(unit, u, dmg);
          u.spellHitUntil = tickCount + FLASH_TICKS;   // flash each scorched enemy
        }
        return;
      }
      // PAIR/TRIPS — single target + splash (the classic Hellfire shape).
      const target = ctx.target;
      if (!target) return;
      emitAbilityShape(unit, "fireball", "orb", { x: target.x, y: target.y, hasTarget: true });
      dealSpellDamage(unit, target, dmg);
      const radius = (unit.fireRadius !== undefined) ? unit.fireRadius : 0;
      if (radius <= 0) return;
      const splashMult = (unit.fireSplashMult !== undefined) ? unit.fireSplashMult : 1;
      const splash = Math.round(dmg * splashMult);
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.team === unit.team || u === target || u.hp <= 0) continue;   // enemies only, not the primary
        const dist = Math.max(Math.abs(u.x - target.x), Math.abs(u.y - target.y));
        if (dist <= radius) dealSpellDamage(unit, u, splash);
      }
    },
  },

  // HELLFIRE AURA (rank 6's MELEE cast — the first self-centered NOVA, casting, Riley 2026-07-15).
  // The melee ♥/♦ 6s can't lob the ranged Hellfire projectile, so they radiate it instead: on a
  // full (attack-mana) bar, scorch EVERY enemy within `radius` of the caster for `spellPower` ×
  // its current attack. Reuses enemiesNear (the self-centered mirror of unitsAlongLine) + the
  // shared dealSpellDamage (shields/invuln/redirect + Thorns/Berserk, no crit/lifesteal — exactly
  // like Hellfire), so this kit is pure dispatch with zero engine change. castTargeting "self"
  // fires it the instant the bar fills — the melee devil is already surrounded, so no aim needed.
  // spellPower is deliberately lower than the projectile's: it pays for hitting a whole ring.
  burnAura: {
    // OF-A-KIND GATED (rank 6 melee, Riley 2026-07-23 — same pair/trips/quads dial as ranks 2-5).
    // The self-nova is the of-a-kind payoff: a LONE 6 is a plain Executioner body with NO cast (mana
    // bar killed). A PAIR unlocks the burn, TRIPS widens the ring AND hits harder, and QUADS keeps the
    // trips ring/damage but bakes `fullStart` → opens the fight with a FULL mana bar so it scorches on
    // the very first tick. Baked ONCE at round start off packCount. The full-mana bake runs AFTER
    // applySynergies' mana reset (synergies.js resets casters to manaStart), because ability
    // onRoundStart hooks fire after applySynergies — so the full start sticks and isn't clobbered.
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);          // this unit's 6s in the pool (units + flop)
      if (count < 2) {                        // GATE: a lone 6 doesn't cast — kill its mana bar
        unit.caster = false;                  // cast pass skips it; Executioner passive still lands
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.auraRadius = t.radius;
      unit.auraSpellPower = t.spellPower;
      if (t.fullStart) unit.mana = unit.manaMax;   // quads open the fight already charged
    },
    onCast: function (unit, ctx, ability) {
      const power = (unit.auraSpellPower !== undefined) ? unit.auraSpellPower : ability.tiers[2].spellPower;
      const radius = (unit.auraRadius !== undefined) ? unit.auraRadius : 1;
      const dmg = Math.round(unit.attack * (power || 0.6));
      // Draw the ring the handler is about to burn. This can't come from the central
      // FX_KITS dispatch, because `radius` was baked per-tier onto this unit at round
      // start — the table would have to guess it. Without the ring a pair and a quads
      // look identical: numbers just appear on whoever happened to be standing close.
      emitAbilityShape(unit, "burnAura", "ring", { radius: radius });
      const foes = enemiesNear(unit, radius);
      for (let i = 0; i < foes.length; i++) {
        dealSpellDamage(unit, foes[i], dmg);
        foes[i].spellHitUntil = tickCount + FLASH_TICKS;   // flash each scorched cell
      }
    },
  },

  // TRAPLINE (rank 8's MELEE cast — redesigned 2026-07-23 to the of-a-kind GATE, Riley). The ♥/♦ 8s
  // stay Bulwark tanks but ALSO lay a forward line of single-use traps one row TOWARD the enemy each
  // time their (slow) mana bar fills. GATED at a PAIR: a lone 8 lays no traps — onRoundStart kills its
  // caster flag (like a lone 2/4/5/6/7) so no dead mana bar renders; Bulwark still tanks. Pair/trips/
  // quads bake the tier ONCE off packCount: pair = 1 cell ahead, trips = 3-wide (±1), quads = a line
  // ACROSS the whole row (`fullRow`). onCast just drops the cells; the trap's bite (damage + slow, then
  // consume) lives in combatStep's trap pass, because the hazard sits on the BOARD, not on a unit.
  trapline: {
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);
      if (count < 2) {                    // GATE: a lone 8 tanks but lays no traps
        unit.caster = false;              // kill the mana bar so the cast pass skips it / none renders
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.trapFullRow = !!t.fullRow;     // quads: a line across the WHOLE row (ignores width)
      unit.trapWidth = t.lineWidth || 1;
      unit.trapDamage = t.damage;
      unit.trapSlow = t.slowTicks;
    },
    onCast: function (unit, ctx, ability) {
      // "In front" = one row toward the enemy: player1 sits low and pushes UP (-y),
      // player2 sits high and pushes DOWN (+y).
      const forward = unit.team === "player1" ? -1 : 1;
      const ty = unit.y + forward;
      if (ty < 0 || ty >= ROWS) return;                     // caster on the far edge → no room
      const damage = (unit.trapDamage !== undefined) ? unit.trapDamage : ability.tiers[2].damage;
      const slow   = (unit.trapSlow   !== undefined) ? unit.trapSlow   : ability.tiers[2].slowTicks;
      // QUADS — a line ACROSS the whole row: drop on every column (dropTrap dedups off-board/same-team).
      if (unit.trapFullRow) {
        for (let x = 0; x < COLS; x++) dropTrap(unit.team, x, ty, damage, slow);
        return;
      }
      // PAIR/TRIPS — a line centered on the caster's column: width 1 → just ahead; 3 → ±1.
      const width = (unit.trapWidth !== undefined) ? unit.trapWidth : ability.tiers[2].lineWidth;
      const half = Math.floor((width - 1) / 2);
      for (let dx = -half; dx <= width - 1 - half; dx++) {
        dropTrap(unit.team, unit.x + dx, ty, damage, slow);
      }
    },
  },

  // CALTROPS (rank 8's RANGED cast — redesigned 2026-07-23 to the of-a-kind GATE, Riley). The ♣/♠ 8s
  // sit at the BACK, so Trapline's "one row forward" would waste traps in their own empty territory;
  // Caltrops instead lays a RING of traps around the caster (the cells within `radius`, Chebyshev) — a
  // defensive perimeter that bites anything diving the backline tank. GATED at a PAIR exactly like
  // Trapline (a lone 8 lays no ring — caster flag killed, Bulwark still tanks). The tier bakes the ring
  // RADIUS + damage/slow ONCE off packCount: pair = radius 1 (the 8 hugging cells), trips = radius 2 (24
  // cells), quads = radius 2 with the hardest bite. Reuses the WHOLE trap system — dropTrap (bounds +
  // same-team dedup) and combatStep's trap pass (damage + slow, then consume) — zero engine change.
  caltrops: {
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);
      if (count < 2) {                    // GATE: a lone 8 tanks but lays no ring
        unit.caster = false;              // kill the mana bar so the cast pass skips it / none renders
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.trapRadius = t.radius;
      unit.trapDamage = t.damage;
      unit.trapSlow = t.slowTicks;
    },
    onCast: function (unit, ctx, ability) {
      const r      = (unit.trapRadius !== undefined) ? unit.trapRadius : ability.tiers[2].radius;
      const damage = (unit.trapDamage !== undefined) ? unit.trapDamage : ability.tiers[2].damage;
      const slow   = (unit.trapSlow   !== undefined) ? unit.trapSlow   : ability.tiers[2].slowTicks;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;               // not the caster's own cell
          dropTrap(unit.team, unit.x + dx, unit.y + dy, damage, slow);
        }
      }
    },
  },

  // CLERIC (Queen of Clubs, casting Slice 2 — the first "ally"-targeting cast and the first
  // NON-damage spell). Its mana fills from SWINGING (manaPerAttack), so a club's fast attack
  // speed — and any attack-speed buff — makes her heal MORE often. The cast pass picks the
  // most-wounded ally in castRange (ctx.target) and holds the bar if nobody's hurt; this
  // handler just restores HP = healPower × the Cleric's current attack (so the mend rides
  // her rank/suit/synergy scaling like everything else), capped at the ally's maxHp.
  cleric: {
    // HEALER-FIRST (Riley 2026-07-15): she hits SOFT so she's a support, not a carry.
    // Reduce her attack ONCE at round start (like Midas/Warlord scale theirs), AFTER
    // applySynergies so it trims her already-buffed number. Her heal is decoupled — a
    // bumped healPower keeps mends strong even though attack is low (heal reads this
    // reduced attack during combat: healPower 5.0 × ~96 ≈ her old ~480).
    onRoundStart: function (unit, ctx, ability) {
      if (ability.attackMult !== undefined) {
        unit.attack = Math.round(unit.attack * ability.attackMult);
      }
    },
    onCast: function (unit, ctx, ability) {
      const target = ctx.target;
      if (!target) return;
      const amount = Math.round(unit.attack * (ability.healPower || 1));
      heal(unit, target, amount);
    },
  },

  // WARD (rank 5's cast — a "self"-targeting SHIELD, casting; OF-A-KIND GATED 2026-07-22). Grants a
  // shield worth `shieldFrac` of its OWN max HP on u.shield — the SAME damage pool the Ace of
  // Diamonds' Aegis uses, which attackTarget/dealSpellDamage already drain before HP (so this reuses
  // the shield mechanic wholesale, zero engine change). GATE (like rank 2/4): a LONE 5 (count < 2)
  // doesn't cast — onRoundStart kills its caster flag so no dead mana bar renders; Slippery stays.
  // A PAIR+ unlocks Ward; onRoundStart bakes the per-tier shield fraction + stacking mode off
  // packCount. PAIR/TRIPS are ONE-SHIELD-AT-A-TIME: onRoundStart sets holdCastWhileShielded, so the
  // cast pass holds the full bar until the current shield is spent (onCast just SETS a fresh shield —
  // it only fires at 0, so set == a clean single shield). QUADS (stack:true) leave the hold off and
  // ADD a new shield each full bar, layering up over the fight (on the normal mana cadence, not every tick).
  wardCast: {
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);
      if (count < 2) {                        // lone 5 → no Ward cast, no mana bar (Slippery stays)
        unit.caster = false;
        unit.wardShieldFrac = 0;
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.wardShieldFrac = t.shieldFrac;     // bake the per-cast shield size for onCast
      unit.wardStack = !!t.stack;             // quads: ADD (layer up) instead of one-at-a-time
      unit.holdCastWhileShielded = !t.stack;  // pair/trips: hold the bar until the shield is spent (combat.js)
    },
    onCast: function (unit, ctx, ability) {
      if (!unit.wardShieldFrac) return;       // lone 5 (gated) — no shield
      const amount = Math.round(unit.maxHp * unit.wardShieldFrac);
      if (unit.wardStack) {
        unit.shield = (unit.shield || 0) + amount;   // quads — layer a new shield on top
      } else {
        unit.shield = amount;                        // pair/trips — a fresh single shield (only fires at 0)
      }
    },
  },

  // HASTE (rank 4's cast — a "self"-targeting ATTACK-SPEED buff, casting, Riley 2026-07-15;
  // OF-A-KIND GATED 2026-07-22). On a full (attack-mana) bar it multiplies its own attackSpeed by
  // (1 + baked speedMult), a STACKING ramp like Berserk's attack growth — but capped at the baked
  // speedMax because attack-mana makes it a snowball (faster swings → more mana → more casts).
  // Reads/writes only the plain attackSpeed stat the combat loop already uses, so no engine change.
  // GATE: a LONE 4 (count < 2) doesn't cast — onRoundStart kills its caster flag (like a lone 2),
  // so no dead mana bar renders. A PAIR+ unlocks it; onRoundStart bakes the per-tier speed off
  // packCount (moderate at pair/trips, HUGE at quads). The mana profile is shared by every tier.
  hasteCast: {
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);
      if (count < 2) {                        // lone 4 → no cast, no mana bar
        unit.caster = false;
        unit.hasteSpeedMult = 0;
        return;
      }
      const t = ability.tiers[Math.min(count, 4)];
      unit.hasteSpeedMult = t.speedMult;      // bake the per-cast ramp for onCast
      unit.hasteSpeedMax = t.speedMax;        // and its ceiling
    },
    onCast: function (unit, ctx, ability) {
      if (!unit.hasteSpeedMult) return;       // lone 4 (gated) — no ramp
      // Capture the ORIGINAL speed the first time it ramps, so the board can tell "hasted"
      // from "just naturally fast". Same captured-base pattern Berserk and Warpath already
      // use for baseAttack — a stat you're about to change needs a before-picture.
      if (unit.baseSpeed === undefined) unit.baseSpeed = unit.attackSpeed;
      const cap = (unit.hasteSpeedMax !== undefined) ? unit.hasteSpeedMax : Infinity;
      const before = unit.attackSpeed;
      unit.attackSpeed = Math.min(cap, unit.attackSpeed * (1 + unit.hasteSpeedMult));
      // Only announce a ramp that actually happened — at the cap the cast does nothing.
      if (unit.attackSpeed > before) emitFx("speed", { x: unit.x, y: unit.y });
    },
  },

  // KILL DASH (rank 4's MELEE rider — a permanent move-speed stack ON KILL, redesigned 2026-07-22,
  // Riley; replaces the old Haste-riding "Charge"). Only the melee ♥/♦ 4s carry it (role "melee"),
  // as compensation for their SMALLER Giant Slayer bonus: every enemy this unit kills banks one more
  // step onto `moveSteps` (how many steps it takes per move-tick — default 1, read in combatStep's
  // movement branch), capped at the baked stepMax. It SNOWBALLS — a melee 4 that keeps killing gets
  // faster and STAYS faster the rest of the fight (no decay). OF-A-KIND GATED: unlocks at TRIPS (no
  // entry below → killDashGain 0, a no-op), and QUADS raise the ceiling. Baked at round start off
  // packCount. Fires on the onKill hook (combat.js runs it when a hit drops a target to 0 HP).
  killDash: {
    onRoundStart: function (unit, ctx, ability) {
      const t = ability.tiers[Math.min(packCount(unit), 4)];   // undefined below trips
      unit.killDashGain = t ? t.stepGain : 0;                  // 0 = not unlocked (lone/pair)
      unit.killDashMax = t ? t.stepMax : 0;
    },
    onKill: function (unit, ctx, ability) {
      if (!unit.killDashGain) return;                          // below trips — no dash
      const before = unit.moveSteps || 1;
      unit.moveSteps = Math.min(unit.killDashMax, before + unit.killDashGain);
      // Only announce a step actually GAINED — at the cap the kill banks nothing, and
      // "»»" every kill would promise speed the unit isn't getting. Extra steps otherwise
      // just read as the unit teleporting.
      if (unit.moveSteps > before) emitFx("dash", { x: unit.x, y: unit.y });
    },
  },

  // ADRENALINE (rank 2's cast — a "self" survival burst, casting, Riley 2026-07-15). On a full
  // (attack-mana) bar it HEALS itself for `healFrac` of max HP (via the shared heal(), so it
  // gets the green pulse) AND ramps its ATTACK by `atkGain` of its STARTING attack. Scales
  // DAMAGE, not speed (Riley 2026-07-15) — uses the SAME captured-base pattern as Berserk
  // (`unit.baseAttack` grabbed once, added to linearly so it's not compounding), and the two
  // share that base so their ramps stack cleanly. Pairs with Berserk: getting hit grows attack,
  // Adrenaline grows it again on cast AND keeps the body alive to keep both ramps paying off.
  adrenaline: {
    onCast: function (unit, ctx, ability) {
      if (ability.healFrac) heal(unit, unit, Math.round(unit.maxHp * ability.healFrac));
      if (ability.atkGain) {
        if (unit.baseAttack === undefined) unit.baseAttack = unit.attack;   // capture starting attack once (shared with Berserk)
        unit.attack = unit.attack + Math.round(unit.baseAttack * ability.atkGain);
      }
    },
  },

  // SLOT MACHINE (rank 7's cast — the "spin", casting Riley 2026-07-15; OF-A-KIND GATED + tiered
  // reels + 777 jackpot Riley 2026-07-23). The Gambler rank's hybrid ATTACK-mana cast: each time its
  // (deliberately LOW) bar fills it SPINS one random reel from THIS TIER's pool — and every reel
  // MIRRORS a real ability elsewhere in the game, reusing a primitive that ALREADY EXISTS
  // (dealSpellDamage / chainTargets / applyStun / applyPoison / heal / enemiesNear / unitsAlongLine /
  // u.shield / u.attackSpeed), so this kit stays PURE DISPATCH — zero combat-loop change. Enemy reels
  // (hellfire/chain/poisonLine/stun) use ctx.target (nearest enemy in castRange, castTargeting
  // "enemy"); self/ally reels (nova/shield/haste/heal) ignore it — the heal finds its OWN most-wounded
  // ally. You don't pick which reel you spin, so a self-buff on a lone backliner is a wasted pull: that
  // randomness IS the downside. `unit.lastSpin` records the result (incl. "777") for a future label.
  // OF-A-KIND GATED (same pair/trips/quads dial as ranks 2-6): onRoundStart bakes unit.slotTier off
  // packCount and KILLS a lone 7's mana bar (Gambler passive still lands). The tier picks which reel
  // pool the spin draws from AND whether the 777 jackpot is on the wheel (trips+). Baked ONCE so a
  // copy dying mid-fight can't shift the tier.
  slotMachine: {
    onRoundStart: function (unit, ctx, ability) {
      const count = packCount(unit);          // this unit's 7s in the pool (units + flop)
      if (count < 2) {                        // GATE: a lone 7 doesn't spin — kill its mana bar
        unit.caster = false;                  // cast pass skips it; Gambler passive still runs
        unit.slotTier = 0;
        return;
      }
      unit.slotTier = Math.min(count, 4);     // 2=pair, 3=trips, 4=quads → which reel pool + jackpot
    },
    onCast: function (unit, ctx, ability) {
      const tier = (unit.slotTier !== undefined && unit.slotTier > 0) ? unit.slotTier : 2;   // default pair (1v1 sim skips round-start prep)
      const target = ctx.target;              // nearest enemy in castRange (may be null)
      // 777 JACKPOT (trips+ only): a small chance, rolled BEFORE the normal spin. A heavy AoE nuke
      // (spellPower×attack to the target + radius splash) that ALSO MINTS gold to the owner —
      // generated, not stolen like the Gambler passive. Needs an enemy target for the nuke; the gold
      // still pays out either way.
      const jackpot = ability.jackpot && ability.jackpot[tier];
      if (jackpot && Math.random() < jackpot.chance) {
        unit.lastSpin = "777";
        // THE JACKPOT ANNOUNCEMENT. This is the loudest thing that can happen in a fight —
        // a heavy nuke that also MINTS chips — and it used to look exactly like any other
        // spin. Three concentric gold rings expanding off the machine, so it reads as an
        // event rather than a bigger number.
        //
        // Emitted as an event at cast time rather than drawn from `unit.lastSpin`: that
        // field is never cleared, so anything reading it during render() would show a
        // jackpot on that unit for the rest of the fight.
        emitAbilityShape(unit, "slotMachine", "jackpot", {});
        if (target) {
          const dmg = Math.round(unit.attack * (jackpot.spellPower || 6));
          dealSpellDamage(unit, target, dmg);
          const radius = jackpot.radius || 0;
          if (radius > 0) {
            for (let i = 0; i < units.length; i++) {
              const u = units[i];
              if (u.team === unit.team || u === target || u.hp <= 0) continue;   // enemies only, not the primary
              const dist = Math.max(Math.abs(u.x - target.x), Math.abs(u.y - target.y));
              if (dist <= radius) dealSpellDamage(unit, u, dmg);
            }
          }
        }
        if (jackpot.gold) {                   // mint the payout (generated tokens)
          chips[unit.team] = (chips[unit.team] || 0) + jackpot.gold;
          if (!SIM_MODE) updateChipInfo();    // chip badges live-update mid-fight
          emitFx("gold", { x: unit.x, y: unit.y, amount: jackpot.gold });   // say what it paid
        }
        return;
      }
      // NORMAL SPIN: pick one reel uniformly from this tier's pool and fire its effect.
      const pool = (ability.tiers && ability.tiers[tier]) || [];
      if (pool.length === 0) return;
      const slot = pool[Math.floor(Math.random() * pool.length)];
      unit.lastSpin = slot.effect;
      switch (slot.effect) {
        case "hellfire":   // 🎯 single-target nuke (rank 6 ♣♠); dealSpellDamage flashes the impact
          if (!target) return;
          emitAbilityShape(unit, "slotMachine", "orb", { x: target.x, y: target.y, hasTarget: true });
          dealSpellDamage(unit, target, Math.round(unit.attack * (slot.spellPower || 2)));
          break;
        case "chain": {     // 🎯 bouncing bolt, damage decays each hop (slot original)
          if (!target) return;
          const line = chainTargets(unit, target, slot.jumps || 3, slot.jumpRange || 3);
          // Hand the fx layer the hop order it can't work out for itself — chainTargets
          // picks its route at cast time. fxChain staggers the segments so you can watch
          // the bolt travel and literally count the jumps; before this the whole chain
          // was just damage numbers appearing at once across the board.
          emitAbilityShape(unit, "slotMachine", "chain", {
            hits: line.map(function (u) { return { x: u.x, y: u.y }; }),
          });
          const base = Math.round(unit.attack * (slot.spellPower || 1.5));
          const falloff = (slot.falloff !== undefined) ? slot.falloff : 0.7;
          for (let i = 0; i < line.length; i++) {
            dealSpellDamage(unit, line[i], Math.round(base * Math.pow(falloff, i)));
          }
          break;
        }
        case "poisonLine": {   // 🎯 piercing poison down a straight row (rank 9 ♣♠ Poison Volley)
          if (!target) return;
          const line = unitsAlongLine(unit, target, slot.pierce || 2);
          if (line.length > 0) {
            const last = line[line.length - 1];
            emitAbilityShape(unit, "slotMachine", "line", { x: last.x, y: last.y });
          }
          for (let i = 0; i < line.length; i++) {
            applyPoison(unit, line[i], slot.stacks || 10);   // inherits the drain + plague-jump
            line[i].spellHitUntil = tickCount + FLASH_TICKS;
            emitFx("poison", { x: line[i].x, y: line[i].y, amount: slot.stacks || 10 });
          }
          break;
        }
        case "stun":        // 🎯 freeze the target (Phase 1's stun primitive; the .stunned purple glow shows)
          if (!target) return;
          applyStun(target, slot.ticks || 8);
          target.spellHitUntil = tickCount + FLASH_TICKS;
          break;
        case "nova": {      // 🛡 self-centered burn ring (rank 6 ♥♦ Hellfire Aura); no target needed
          emitAbilityShape(unit, "slotMachine", "ring", { radius: slot.radius || 1 });
          const foes = enemiesNear(unit, slot.radius || 1);
          const dmg = Math.round(unit.attack * (slot.spellPower || 0.6));
          for (let i = 0; i < foes.length; i++) {
            dealSpellDamage(unit, foes[i], dmg);
            foes[i].spellHitUntil = tickCount + FLASH_TICKS;
          }
          break;
        }
        case "shield": {    // 🛡 shield yourself (rank 2/5); same u.shield pool drained before HP
          const banked = Math.round(unit.maxHp * (slot.frac || 0.4));
          unit.shield = (unit.shield || 0) + banked;
          emitFx("shield", { x: unit.x, y: unit.y, amount: banked });
          break;
        }
        case "haste": {     // 🛡 ramp your own attack speed, capped (rank 4 Haste)
          // Same captured base as hasteCast, so the ⚡ badge lights up for this reel too.
          if (unit.baseSpeed === undefined) unit.baseSpeed = unit.attackSpeed;
          const wasSpeed = unit.attackSpeed;
          unit.attackSpeed = Math.min((slot.cap !== undefined) ? slot.cap : Infinity,
                                      unit.attackSpeed * (1 + (slot.mult || 0.2)));
          if (unit.attackSpeed > wasSpeed) emitFx("speed", { x: unit.x, y: unit.y });
          break;
        }
        case "heal": {      // 🛡 mend the most-wounded ally in range (self ok); a no-op if nobody's hurt (Q♣ Cleric)
          const ally = lowestHpAllyInRange(unit, unit.castRange);
          if (ally) heal(unit, ally, Math.round(unit.attack * (slot.healPower || 4)));
          break;
        }
      }
    },
  },

  // Ace of Spades — "Vanish" (drop-aggro cast, Riley 2026-07-22). The Infiltrator dives the
  // enemy backline, then SHEDS focus: on a full (attack-mana) bar it goes untargetable for
  // `ticks` ticks — nearestEnemy skips it, so enemies re-path to the next foe and stop swinging
  // at it. It STILL deals damage while hidden; only INCOMING aggro drops (AoE/poison, which don't
  // route through nearestEnemy, can still catch it). castTargeting "self" fires the instant the
  // bar fills, no aim needed. The blue cast-flash is its blink-out visual — no extra flash.
  dropAggro: {
    onCast: function (unit, ctx, ability) {
      unit.untargetableUntil = tickCount + (ability.ticks || 4);
    },
  },

  // Ace of Clubs — "Sniper Round" (backline cast, Riley 2026-07-22). The Sharpshooter charges a
  // special round while auto-firing, then looses it at the enemy BACKLINE — farthestEnemy picks
  // the deepest (farthest) foe. The shot can be BLOCKED: firstEnemyOnLine walks the straight ray
  // and hands the bullet to the FIRST enemy body in the way, so a frontliner can bodyguard the
  // carry it was aimed at. Damage = spellPower × the caster's current attack via dealSpellDamage
  // (shields/invuln/redirect + the victim's Thorns/Berserk, but no crit and no lifesteal — it's a
  // spell, not a swing). castTargeting "self" so the kit does its OWN farthest-not-nearest aim.
  sniperShot: {
    onCast: function (unit, ctx, ability) {
      const back = farthestEnemy(unit);
      if (!back) return;                                   // no enemies → hold the shot
      const hit = firstEnemyOnLine(unit, back);            // first body on the ray (block) or the target
      // Draw the line to whoever actually EATS the round, not to the backliner it was
      // aimed at. That one choice is what makes a body-block readable: you see the shot
      // stop dead at the frontliner, instead of watching the carry you were aiming for
      // take no damage for no visible reason. This is the most confusing moment in the
      // game today, and it's confusing purely because nothing was ever drawn.
      //
      // It has to be emitted here rather than by the central FX_KITS dispatch, because
      // this ability targets "self" — ctx.target is null and the real aim is worked out
      // inside this handler.
      emitAbilityShape(unit, "sniperShot", "line", { x: hit.x, y: hit.y });
      dealSpellDamage(unit, hit, Math.round(unit.attack * (ability.spellPower || 2.5)));
    },
  },

  // King of Spades — Warlord's Levy: at the start of each fight, scale its attack
  // by a flat % per LOW card (rank 2-5) its team has PLAYED all game
  // (weakCardsPlayed). Cumulative and UNCAPPED — a "field cheap bodies to feed the
  // King" build. Runs at round start AFTER synergies, so it multiplies the
  // already-buffed attack. `perCard` is the balance knob.
  warlordLevy: {
    onRoundStart: function (unit, ctx, ability) {
      const count = weakCardsPlayed[unit.team] || 0;
      const before = unit.attack;
      unit.attack = Math.round(unit.attack * (1 + ability.perCard * count));
      // Round-start buffs are the sneakiest silent abilities in the game: they finish
      // before you've even looked at the board, so the King just IS stronger and nothing
      // says the cheap bodies you fed him all game are the reason. One ▲ burst at the
      // opening tick is the only moment this is ever visible.
      if (unit.attack > before) emitFx("buff", { x: unit.x, y: unit.y, amount: unit.attack - before });
    },
  },

  // King of Diamonds — Midas King: at the start of each fight, scale its attack by
  // its owner's CHIP stack relative to `baseline` (the neutral start). Above the
  // baseline he ramps (snowball for the chip leader), below it he weakens — but a
  // `floor` keeps him from ever falling under that fraction of his attack. Runs at
  // round start AFTER synergies, so it multiplies the already-buffed attack.
  midasKing: {
    onRoundStart: function (unit, ctx, ability) {
      const gold = chips[unit.team] || 0;
      const mult = Math.max(ability.floor, 1 + (gold - ability.baseline) * ability.perChip);
      const before = unit.attack;
      unit.attack = Math.round(unit.attack * mult);
      // Midas swings BOTH ways — below the baseline he gets weaker. Show the loss too:
      // "my chip lead is making this King" and "my chip deficit is unmaking him" are the
      // same mechanic, and only seeing one of them would teach the wrong lesson.
      const delta = unit.attack - before;
      if (delta > 0) emitFx("buff",   { x: unit.x, y: unit.y, amount: delta });
      if (delta < 0) emitFx("weaken", { x: unit.x, y: unit.y, amount: -delta });
    },
  },

  // One-Eyed Jacks — Bower: at fight start, buff every unit of `buffSuit` on BOTH
  // teams (no team filter — that's the "affects both boards" part). Whichever knobs
  // the card carries get applied: atkMult (attack), hpMult (hp AND maxHp, so the
  // health bar and tankiness both grow), speedMult (attack speed). Runs after
  // synergies, so it stacks on top of any flush/poker buffs. Multiple copies stack.
  bower: {
    onRoundStart: function (unit, ctx, ability) {
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.suit !== ability.buffSuit) continue;
        if (ability.atkMult) u.attack = Math.round(u.attack * (1 + ability.atkMult));
        if (ability.hpMult) {
          u.hp = Math.round(u.hp * (1 + ability.hpMult));
          u.maxHp = Math.round(u.maxHp * (1 + ability.hpMult));
        }
        if (ability.speedMult) u.attackSpeed = u.attackSpeed * (1 + ability.speedMult);
        // One ▲ per unit touched — no amount, because it may have moved attack AND health
        // AND speed and there's no single honest number for that (see playFx). The burst
        // is the only thing that shows the blast radius, including the part players always
        // forget: it just buffed the ENEMY's hearts too.
        emitFx("buff", { x: u.x, y: u.y });
      }
    },
  },

  // Queen of Hearts — Royal Guard: a PASSIVE marker (no combat hook). While her
  // King of Hearts lives, the damage pipeline (royalSink, read in attackTarget)
  // reroutes every hit she'd take onto him. Listed here so the ability is a real
  // kit and shows in tooltips; the redirect itself lives in the engine.
  royalGuard: {},

  // King of Hearts — Royal Vow: on HIS death, grant his Queen of Hearts partner a
  // window of invulnerability (an invulnUntil tick-stamp the engine respects). The
  // window covers ~1.5s — see the hearts-13 config note for the tick math.
  royalVow: {
    onDeath: function (unit, ctx, ability) {
      const partner = livingPartner(unit, ability.partnerRank);
      if (partner) partner.invulnUntil = tickCount + ability.invulnTicks;
    },
  },

  // King of Hearts — "Rally" (partner attack-buff cast, Riley 2026-07-22). On a full (attack-mana)
  // bar he rallies his Queen of Hearts (livingPartner rank 12): a TEMPORARY, refreshable outgoing-
  // damage window on her — atkBuffMult applied for `buffTicks` ticks, honored in attackTarget and
  // auto-expiring (no cleanup pass, no permanent stat mutation). Recasting just pushes the window
  // out again. Fizzles harmlessly if she isn't fielded/alive. castTargeting "self" so he fires on a
  // full bar and finds her via the royal bond (not a nearest-enemy aim). Pairs with her shield cast:
  // she keeps his body alive, he keeps her swings hitting hard.
  attackBuffPartner: {
    onCast: function (unit, ctx, ability) {
      const partner = livingPartner(unit, ability.partnerRank);
      if (!partner) return;
      // The royal bond drawn as a line between the two of them. The cast used to show a
      // flash on HIM and a buff appearing on HER with nothing connecting the two, so the
      // most interesting card interaction in the game read as two unrelated events.
      // The partner is found by the bond, not by ctx.target, so only this handler knows
      // where the other end of the line is.
      emitAbilityShape(unit, "attackBuffPartner", "tether", { x: partner.x, y: partner.y, hasTarget: true });
      partner.atkBuffMult = ability.mult || 1.5;
      partner.atkBuffUntil = tickCount + (ability.buffTicks || 6);
    },
  },

  // Queen of Hearts — "Aegis Vow" (partner shield cast, Riley 2026-07-22). On a full (attack-mana)
  // bar she banks a SMALL shield onto her King of Hearts (livingPartner rank 13) — the SAME u.shield
  // pool the Ace of Diamonds' Aegis fills, which attackTarget/dealSpellDamage already drain before
  // HP, so this reuses the shield mechanic wholesale (zero engine change). The amount is a fraction
  // of HER own max HP. Pairs with her Royal Guard: his body already soaks the hits SHE'd take, and
  // now she keeps that body shielded. Fizzles if her King isn't alive/fielded. castTargeting "self".
  shieldPartner: {
    onCast: function (unit, ctx, ability) {
      const partner = livingPartner(unit, ability.partnerRank);
      if (!partner) return;
      const banked = Math.round(unit.maxHp * (ability.shieldFrac || 0.15));
      emitAbilityShape(unit, "shieldPartner", "tether", { x: partner.x, y: partner.y, hasTarget: true });
      partner.shield = (partner.shield || 0) + banked;
      emitFx("shield", { x: partner.x, y: partner.y, amount: banked });
    },
  },

  // Rank 10 — Rally (Batch C rework, was team-wide attack): an ADJACENCY aura.
  // At fight start, buff every ally within `radius` cells (Chebyshev, same as
  // range/movement) — NOT itself, NOT enemies. Which stat depends on this 10's
  // SUIT (the `suits` map on the ability entry): ♥ HP, ♠ crit, ♣ attack speed,
  // ♦ grants the lifesteal ability outright. Runs after synergies bake, so the
  // buffs multiply already-buffed numbers; baked ONCE from placement positions
  // (units wander mid-fight but the rally is the pre-battle speech). PHALANX
  // pack-scaling: magnitudes × (1 + `perExtra` per extra 10 in the pool); the ♦
  // grant is binary, so extra 10♦s pay in board coverage, not strength. Two
  // rally auras overlapping the same ally stack (both fire their own hook).
  rally: {
    onRoundStart: function (unit, ctx, ability) {
      const eff = (ability.suits || {})[unit.suit];
      if (!eff) return;
      const scale = 1 + (ability.perExtra || 0) * (packCount(unit) - 1);
      for (let i = 0; i < units.length; i++) {
        const ally = units[i];
        if (ally.team !== unit.team || ally === unit) continue;
        const dist = Math.max(Math.abs(ally.x - unit.x), Math.abs(ally.y - unit.y));
        if (dist > ability.radius) continue;
        if (eff.hpMult) {
          const mult = 1 + eff.hpMult * scale;
          ally.hp = Math.round(ally.hp * mult);
          ally.maxHp = Math.round(ally.maxHp * mult);
        }
        if (eff.critBonus) {
          // critChance is a baked STAT (attackTarget falls back to the suit's
          // base crit when it's unset) — resolve that base, then add.
          const base = (ally.critChance !== undefined) ? ally.critChance : (SUITS[ally.suit].crit || 0);
          ally.critChance = base + eff.critBonus * scale;
        }
        if (eff.speedMult) ally.attackSpeed = ally.attackSpeed * (1 + eff.speedMult * scale);
        if (eff.grantLifesteal) {
          // Grant at most one copy — a diamond ally already has lifesteal, and
          // two entries would heal twice per hit.
          let has = false;
          for (let j = 0; j < ally.abilities.length; j++) {
            if (ally.abilities[j].kind === "lifesteal") { has = true; break; }
          }
          if (!has) ally.abilities.push({ kind: "lifesteal" });
        }
        // Remember that this ally is standing inside a rally aura, purely so the board can
        // show a ⚑ badge on it. The aura is baked from PLACEMENT positions and never
        // re-checked, so without a mark there is no way at all to tell who caught the
        // speech — which is exactly the decision the player made during placement.
        // A counter, not a flag: two overlapping rallies both really do stack.
        ally.ralliedBy = (ally.ralliedBy || 0) + 1;
        emitFx("buff", { x: ally.x, y: ally.y });
      }
    },
  },

  // 10-2 FUSION "The Brunson" (Rally × Berserk) — the Berserk ramp RADIATES. On each
  // hit it takes, the banner gains `gain` of its OWN starting attack (Berserk, base
  // captured once so the ramp is linear not compounding) AND every ally within
  // `radius` gains `allyGain` of THEIR starting attack — the squad fights harder as
  // the banner bleeds. Uses CURRENT positions (a live battlefield reaction), unlike
  // the fusion's other half, the rank-10 Rally, which bakes from PLACEMENT spots at
  // round start. Uncapped like Berserk (balance watch under heavy focus-fire).
  warpath: {
    onDamaged: function (unit, ctx, ability) {
      if (!(ctx.damage > 0)) return;   // only real hits sound the war cry
      // Self ramp (Berserk).
      if (unit.baseAttack === undefined) unit.baseAttack = unit.attack;
      unit.attack = unit.attack + Math.round(unit.baseAttack * ability.gain);
      // Radiate a smaller share to nearby allies (each ramps off ITS own base).
      for (let i = 0; i < units.length; i++) {
        const ally = units[i];
        if (ally.team !== unit.team || ally === unit) continue;
        const dist = Math.max(Math.abs(ally.x - unit.x), Math.abs(ally.y - unit.y));
        if (dist > ability.radius) continue;
        if (ally.baseAttack === undefined) ally.baseAttack = ally.attack;
        const gained = Math.round(ally.baseAttack * ability.allyGain);
        ally.attack = ally.attack + gained;
        // The ALLIES are the invisible half. The warpath unit's own ramp at least shows in
        // its stat line, but a war cry that quietly strengthens everyone standing nearby
        // looked exactly like nothing happening. Deliberately not emitted for the self
        // ramp above: that would put a second number on every hit this unit already takes.
        if (gained > 0) emitFx("buff", { x: ally.x, y: ally.y, amount: gained });
      }
    },
  },
};

// A card's (or unit's) unique legendary entry, or null. Works on anything with a
// `suit` and `rank` — cards AND units both carry those. Keyed by "suit-rank".
function uniqueOf(card) {
  return UNIQUE_CARDS[card.suit + "-" + card.rank] || null;
}

// A card's FULL ability list = its suit's + its rank's + its unique's abilities.
// Used when a card becomes a unit (placement.js).
function unitAbilities(card) {
  const suitAbilities = SUITS[card.suit].abilities || [];
  // A FUSED card (a "made hand") inherits its ONE suit family PLUS BOTH parts'
  // rank abilities — that doubled ability load is why its stats are taxed (see
  // FUSABLE_HANDS). It has no unique legendary layer.
  if (card.fused) {
    const entry = FUSABLE_HANDS[card.fusedKey];
    // A fusion with an authored `abilities` kit (Dirty Diaper, Double or Nothing)
    // is BESPOKE — its listed abilities REPLACE the staple below, so the fusion can
    // be a NEW thing (escalating thorns) instead of both parents concatenated. It
    // still rides its ONE suit family.
    if (entry && entry.abilities) {
      return suitAbilities.concat(entry.abilities);
    }
    // Legacy staple (7-2): inherit BOTH parts' rank abilities, stacked together. Each part's
    // list is role-filtered by the FUSED card's own suit (rankAbilitiesFor reads card.rank, so
    // pass a {rank, suit} shim) — a fused body has one suit, so it takes that suit's role flavor.
    let rankAbilities = [];
    card.parts.forEach(function (p) {
      rankAbilities = rankAbilities.concat(rankAbilitiesFor({ rank: p.rank, suit: card.suit }));
    });
    return suitAbilities.concat(rankAbilities);
  }
  const rankAbilities = rankAbilitiesFor(card);
  const uniq = uniqueOf(card);
  const uniqueAbilities = uniq ? (uniq.abilities || []) : [];
  return suitAbilities.concat(rankAbilities).concat(uniqueAbilities);
}

// The made-hand chip bonus a team earns for FUSED cards it PLAYED this round —
// the fused hand's economy identity (bigger than the loose 7-2's SEVEN_TWO_BONUS).
// Summed + data-driven off FUSABLE_HANDS, so copies stack. Read by finishRound.
function fusedHandBonus(team) {
  let total = 0;
  const cards = played[team] || [];
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].fused) total += FUSABLE_HANDS[cards[i].fusedKey].bonusChips;
  }
  return total;
}

// PLACEMENT rule: does this card carry an ability that lets it ignore the own-zone
// restriction? Read straight from the card (before it becomes a unit) so
// placement.js can check it the moment it's dropped. See canPlaceAt.
function cardCanPlaceAnywhere(card) {
  const list = unitAbilities(card);
  for (let i = 0; i < list.length; i++) {
    if (list[i].placement === "anywhere") return true;
  }
  return false;
}

// BEHAVIOR rule: is this card/unit an INERT "target dummy" (rank 3)? It never
// attacks or moves — makeCardOf zeroes its attack + boosts HP, buildUnit stamps
// `inert` on the unit, and combatStep skips its turn. Works on a card OR a unit
// (both have suit+rank), like cardCanPlaceAnywhere / cardCannotDiscard.
function cardIsInert(card) {
  const list = unitAbilities(card);
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind === "targetDummy") return true;
  }
  return false;
}

// CASTING rule (pure mana-regen, Phase 1): a card's CAST ability — the ability marked
// `cast:true` that fires on the onCast hook and carries the mana profile (manaMax /
// manaRegen / manaStart / castRange). null if the card has none. Read like cardIsInert,
// off the full ability list, so buildUnit can stamp the unit's mana fields from it. A
// unit is a "caster" iff this returns non-null.
function castAbilityOf(card) {
  const list = unitAbilities(card);
  for (let i = 0; i < list.length; i++) {
    if (list[i].cast) return list[i];
  }
  return null;
}

// DISPOSAL rule: does this card carry an ability that forbids discarding it? A
// "hot potato" (Queen of Spades) — left unheld she is NOT discarded but force-kept
// into the next hand, so the only way out of your hand is to PLAY her. Read straight
// from the card (like cardCanPlaceAnywhere) so nextRound can check it while she's in hand.
function cardCannotDiscard(card) {
  const list = unitAbilities(card);
  for (let i = 0; i < list.length; i++) {
    if (list[i].undiscardable) return true;
  }
  return false;
}

// The display name(s) of a card's rank abilities, for card/unit tooltips ("" if none). Takes
// the whole card/unit (needs suit+rank) and role-filters via rankAbilitiesFor, so a ♥6 lists
// "Hellfire Aura" while a ♣6 lists "Hellfire" — each card describes only the kit it can run.
function rankAbilityText(card) {
  return rankAbilitiesFor(card).map(function (a) { return a.name; }).join(", ");
}

// Build the hover tooltip for a card OR a unit (both have suit/rank/range). One
// shared place so the board and the hand always describe a card the same way, and
// legendaries automatically get a ★ line without touching two files.
function figureTitle(obj) {
  // A fused "made hand" (7-2): name the two parts it inherits and its abilities.
  // obj may be a card (carries `parts`/`fusedKey`) or a unit (carries them on `card`).
  if (obj.fused) {
    const src = obj.parts ? obj : obj.card;
    const entry = FUSABLE_HANDS[src.fusedKey];
    const partStr = src.parts.map(function (p) { return rankLabel(p.rank) + SUITS[p.suit].symbol; }).join(" + ");
    const abilNames = unitAbilities(src).map(function (a) { return a.name; })
      .filter(function (n) { return n; }).join(", ");
    let t = "✨ " + (entry ? entry.label : "Fused") + " (fused " + partStr + ") — one body, both abilities";
    if (abilNames) t += " · " + abilNames;
    if (entry && entry.bonusChips) t += " · +" + entry.bonusChips + " chips on a win";
    return t;
  }
  const s = SUITS[obj.suit];
  let t = rankLabel(obj.rank) + s.symbol + " — " + s.desc + " (range " + obj.range + ")";
  const uniq = uniqueOf(obj);
  // The archetype the SPRITE is showing, in words — "Plague Bearer", "Bulwark". The board
  // speaks in pictures on purpose (a 56px square has no room for a name), so this is where
  // you go when you don't recognise one yet. Legendaries skip it: their ★ line below
  // already names them, and saying it twice reads like a bug. Empty string when the unit
  // has no sprite, so a text-glyph board's tooltip is byte-for-byte what it always was.
  if (!uniq && typeof unitArtName === "function") {
    const artName = unitArtName(obj);
    if (artName) t += " — " + artName;
  }
  if (rankAbilityText(obj)) t += " · " + rankAbilityText(obj);
  if (uniq) t += " · ★ " + uniq.name + ": " + uniq.blurb;
  return t;
}

// Run one hook for a unit: call every ability of that unit that implements it.
// The ability's data entry (incl. any future params) is passed to the handler.
function runAbilityHook(unit, hookName, ctx) {
  const list = unit.abilities || [];
  for (let i = 0; i < list.length; i++) {
    const ability = list[i];
    const kit = ABILITIES[ability.kind];
    if (kit && kit[hookName]) {
      // WEEK 3: draw the ability, then run it. Everything about the LOOK is decided by
      // FX_KITS in fxkits.js — this file stays free of colours and glyphs, exactly like
      // combat.js stays free of them by emitting events instead of touching the DOM.
      //
      // Emitted BEFORE the handler so the picture is drawn from where things stood when
      // the ability fired: a spell that kills its target still gets to show a projectile
      // pointing at the square the target was standing on.
      //
      // The SIM_MODE check is here at the call site, not inside emitAbilityFx, and that
      // placement is the whole point. This is the single hottest line in the game —
      // every ability, on every hook, on every unit, on every tick, across thousands of
      // headless games. Checking here means a balance scan pays one boolean and never
      // builds an object. (combat.js's death loop guards itself the same way.)
      if (!SIM_MODE) emitAbilityFx(unit, hookName, ability, ctx);
      kit[hookName](unit, ctx, ability);
    }
  }
}

// The LIVING same-team, same-suit unit of a given rank — a card's "royal partner"
// (the K♥/Q♥ bond: each finds the other by rank). null if it isn't on the board.
function livingPartner(unit, rank) {
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u !== unit && u.team === unit.team && u.suit === unit.suit &&
        u.rank === rank && u.hp > 0) return u;
  }
  return null;
}

// If `target` is a guarded Queen whose royal partner (her King) is alive, return
// that guardian — the unit that should SOAK the hit instead. Otherwise null, so
// the caller falls back to the target itself. Drives the K♥/Q♥ damage redirect.
function royalSink(target) {
  const list = target.abilities || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind === "royalGuard") {
      const guardian = livingPartner(target, list[i].partnerRank);
      if (guardian) return guardian;
    }
  }
  return null;
}

// Total chips `team` owes the house right now for "detrimental to hold" cards still
// in its HAND (Queen of Spades' houseTax). Reads each card's unique, so it's fully
// data-driven and stacks (2 decks = up to two Black Ladies = double the bite).
function handTax(team) {
  let total = 0;
  const hand = hands[team] || [];
  for (let i = 0; i < hand.length; i++) {
    const uniq = uniqueOf(hand[i]);
    if (!uniq) continue;
    const list = uniq.abilities || [];
    for (let j = 0; j < list.length; j++) {
      if (list[j].kind === "houseTax") total += list[j].penalty;
    }
  }
  return total;
}

// Does `team`'s ENEMY have a fielded queen that extinguishes `suit`? If so, that
// suit's flush synergy is switched off for `team` (see teamSynergyEffects). Reads
// live units, so the extinguisher only needs to be on the board at round start.
function isSuitExtinguished(team, suit) {
  const enemy = (team === "player1") ? "player2" : "player1";
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.team !== enemy) continue;
    const list = u.abilities || [];
    for (let j = 0; j < list.length; j++) {
      if (list[j].kind === "extinguish" && list[j].suit === suit) return true;
    }
  }
  return false;
}

// The winner's bonus steal multiplier from loot cards it PLAYED this round (Jack of
// Diamonds). Summed and data-driven, so copies stack. Read by finishRound's steal math.
function teamLootMult(team) {
  let total = 0;
  const cards = played[team] || [];
  for (let i = 0; i < cards.length; i++) {
    const uniq = uniqueOf(cards[i]);
    if (!uniq) continue;
    const list = uniq.abilities || [];
    for (let j = 0; j < list.length; j++) {
      if (list[j].kind === "loot") total += list[j].stealMult;
    }
  }
  return total;
}

// How many enemy squares `team` may mark this round — the sum of `squares` from
// every Airstrike ability on its FIELDED units (King of Clubs). 0 if it has none,
// which also voids any marks it made and then removed the King before Round Start.
function strikeAllowance(team) {
  let total = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.team !== team) continue;
    const list = u.abilities || [];
    for (let j = 0; j < list.length; j++) {
      if (list[j].kind === "airstrike") total += list[j].squares;
    }
  }
  return total;
}
