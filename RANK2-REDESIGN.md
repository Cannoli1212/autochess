# Rank 2 Redesign — "Berserker" (gated of-a-kind tiers)

**Status:** planned, not yet implemented. First pilot of a broader shift — the poker
**of-a-kind count becomes the power dial for a card's ability** (gate at a pair, scale up
with trips/quads), instead of the current flat +atk/HP stat buff. We do the **2s first**,
verify in the browser, then streamline the same pattern onto the other ranks.

Author: Riley, 2026-07-22.

---

## The design (what the 2s become)

Fresh start — the current rank-2 kit (Berserk + Adrenaline) is **replaced** by one new
tiered ability. **HP is the through-line reward at every rung.** A lone 2 is just a vanilla
card; a **pair unlocks** the ability, and it snowballs from there.

| Of-a-kind | HP buff | Ramp when hurt | Shield | Feel |
|-----------|---------|----------------|--------|------|
| **1 (lone)** | — | — | — | vanilla 2, no ability (gated off) |
| **2 (pair)** | +50% max HP | gains 15% of starting atk per hit | — | unlock + slightly tankier |
| **3 (trips)** | +120% max HP | gains 30% of starting atk per hit | — | tankier + a real "angry when hurt" ramp |
| **4 (quads)** | +250% max HP | gains 30% of starting atk per hit | shield = 150% of buffed max HP | **almost overpowered** — a shielded, snowballing brick |

All numbers are **first-pass, tune by playtest.** Count **caps at 4** for now (5+ uses the
quads row); add a `5:` row later if you want a quints rung.

**Scope:** per-card, like the other poker buffs — each 2 reads how many 2s are in the pool
(**your fielded 2s + the shared flop**, exactly what `packCount` already counts) and buffs
**itself**. So a flop 2 can complete your pair and unlock the ability, same as the existing
synergies. Everything is **baked once at round start**, so a copy dying mid-fight never
weakens the survivors.

---

## Code changes (3 files for the mechanic, 1 more for UI)

### 1. `js/config.js` — replace `RANK_ABILITIES[2]`

Delete the current `2: [ ...berserk + adrenaline... ]` entry and its comment block, and put:

```js
// Rank 2 — BERSERKER (redesigned 2026-07-22, Riley). The of-a-kind COUNT is the power
// dial. A LONE 2 has NO ability (base stats only) — a PAIR unlocks it. HP is the through-
// line reward at every rung; higher tiers add a bigger attack RAMP when hurt, and QUADS
// add a huge one-time SHIELD (meant to feel almost overpowered). Gated + baked ONCE at
// round start off packCount (fielded 2s + the shared flop — the same count the poker
// synergies use). `tiers` is keyed by of-a-kind count: 2=pair, 3=trips, 4=quads (caps at 4).
//   hpMult     — extra max HP as a fraction of the unit's ALREADY suit/synergy-buffed HP
//   ramp       — attack gained per hit taken, as a fraction of STARTING attack (Berserk ramp)
//   shieldFrac — one-time shield at fight start, as a fraction of buffed max HP (0 = none)
2: [{ kind: "berserker", name: "Berserker",
      tiers: {
        2: { hpMult: 0.5, ramp: 0.15, shieldFrac: 0   },   // pair  — unlock + slight HP
        3: { hpMult: 1.2, ramp: 0.30, shieldFrac: 0   },   // trips — more HP + bigger ramp
        4: { hpMult: 2.5, ramp: 0.30, shieldFrac: 1.5 },   // quads — big HP + HUGE shield
      } }],
```

### 2. `js/abilities.js` — add the `berserker` kit

Add to the `ABILITIES` object:

```js
// Rank 2 — Berserker (redesigned 2026-07-22). GATED of-a-kind ability: a lone 2 does
// nothing; a PAIR+ unlocks it. onRoundStart reads packCount (fielded 2s + flop), picks
// the tier, and bakes the HP buff / shield / per-hit ramp ONCE (like the other pack-scaled
// kits, so a dying copy can't weaken survivors). onDamaged applies the ramp each hit.
berserker: {
  onRoundStart: function (unit, ctx, ability) {
    const count = packCount(unit);          // this unit's 2s in the pool (units + flop)
    unit.berserkerRamp = 0;                 // default: dormant (lone 2 → no ability)
    if (count < 2) return;                  // GATE: need a pair to unlock
    const t = ability.tiers[Math.min(count, 4)];
    // HP buff (every rung). Runs AFTER applySynergies, so it grows the already-buffed HP.
    const bonus = Math.round(unit.maxHp * t.hpMult);
    unit.maxHp += bonus;
    unit.hp += bonus;
    // Quads payoff: a one-time shield off the (now buffed) max HP. Reuses u.shield — the
    // damage pool the engine already drains before HP (same as Ward / Ace of Diamonds).
    if (t.shieldFrac) unit.shield = (unit.shield || 0) + Math.round(unit.maxHp * t.shieldFrac);
    unit.berserkerRamp = t.ramp;            // bake the per-hit ramp for onDamaged
  },
  onDamaged: function (unit, ctx, ability) {
    if (!unit.berserkerRamp || !(ctx.damage > 0)) return;   // dormant, or a fully-soaked hit
    if (unit.baseAttack === undefined) unit.baseAttack = unit.attack;   // capture once → linear ramp
    unit.attack += Math.round(unit.baseAttack * unit.berserkerRamp);
  },
},
```

The old `berserk` and `adrenaline` kits become **unused** once `RANK_ABILITIES[2]` is
repointed. Leave them in place for now (harmless dead code); delete during the streamline
pass to keep this change small and low-risk.

### 3. `js/synergies.js` — exempt rank 2 from the flat `pokerBuffs`

The generic of-a-kind stat buff (`+50/150/400% atk/HP`) still fires for every rank. The 2s
now get **all** their of-a-kind reward from the new ability, so let the ability own it and
skip the flat buff for rank 2 — otherwise you'd double up on HP and it gets confusing.

In `pokerBuffs`, the of-a-kind loop, add a guard at the top of the `forEach` body:

```js
Object.keys(counts).forEach(function (rank) {
  if (Number(rank) === 2) return;   // 2s' of-a-kind reward is the Berserker ability now
  let n = counts[rank];
  if (n < 2) return;
  ...
```

### 4. UI text (do AFTER the mechanic is verified) — `js/synergies.js`

The poker panel (`renderOnePoker`) and left trait sidebar (`renderPokerTraits`) print the
of-a-kind text from `POKER_HANDS.ofAKind[n].text`. For a pair/trips/quads of **2s** that
text ("+50% atk/HP") is now wrong. Special-case rank 2 so its chip/tooltip reads the new
ladder, e.g. "Pair: unlock + HP · Trips: +HP + ramp · Quads: +HP + big shield." Purely
cosmetic — safe to ship the mechanic first and fix the wording second.

---

## How the gate works (the one concept to hold onto)

- `packCount(unit)` (already in `abilities.js`) = how many of this unit's rank sit in the
  team's pool = **fielded units of that rank + the shared flop**. Always ≥ 1.
- `onRoundStart` runs **after** `applySynergies`, once per unit, so it reads the already
  suit/synergy-buffed HP and bakes the tier on top. A count `< 2` bakes nothing → the 2
  is a plain body. Count `2/3/4+` picks the `tiers[2/3/4]` row.
- Nothing is recomputed mid-fight, so units dying during combat don't shift anyone's tier.

---

## Known interactions / gotchas

- **7-2 fusion.** The `sevenTwo` fusion has no authored ability list, so it staples both
  parts' rank abilities — it will now staple `berserker` instead of the old `berserk`. A
  fused unit isn't counted in `pokerPool` (fused cards are excluded), so its `packCount` for
  rank 2 reads `< 2` → **dormant**. Net effect: the 7-2 loses its old always-on Berserk
  ramp. That's acceptable for this pilot (fusions are their own thing) — just **don't be
  surprised**; revisit fusion+gating during the streamline pass. The `2-3` and `10-2`
  fusions author their own kits, so they're unaffected.
- **Rank 2 stops being a caster.** Adrenaline was its only `cast` ability; removing it means
  no mana bar on 2s. Intended — simpler pilot.
- **Headless sim / 1v1 path** may skip `onRoundStart`. The kit degrades safely: no bake →
  `unit.berserkerRamp` is falsy → `onDamaged` no-ops (dormant). The live browser game is the
  target for this pilot; sim can be re-checked later.
- **Cache bump.** After editing, bump the `?v=legNN` query in `game.html` (per memory it's
  at `leg53` → go to `leg54`), and verify with `/game.html?fresh=N` since the preview root
  serves a stale cached `game.html`.

---

## Verification (browser, playtest mode)

1. Bump the cache tag, open `/game.html?fresh=N`.
2. Use **playtest mode** (P2 toggle → playtest + card picker) to field, in turn: **one** 2,
   then **two**, **three**, **four** (mix suits so it's an of-a-kind, not a flush).
3. Confirm on Round Start:
   - lone 2 → no HP bump, no shield;
   - pair → ~+50% HP, and its attack climbs as it takes hits;
   - trips → bigger HP + faster attack climb;
   - quads → big HP **and** a shield bar that soaks before HP.
4. A flop 2 completing your pair should unlock the ability the same way a fielded pair does.

---

## Build order inside the new session

1. `config.js` entry + `abilities.js` kit + `synergies.js` pokerBuffs guard → **verify combat**.
2. UI text special-case for the 2s.
3. Commit + push (bump cache tag first). Then we streamline the pattern onto the next rank.
