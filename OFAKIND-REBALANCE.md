# Of-a-kind rebalance — moving the payout from stats into abilities

**Started 2026-08-06.**

## Why

Collecting duplicate ranks paid you **twice**:

1. **Flat stats** — `POKER_HANDS.ofAKind` (config.js) gave every unit of that rank
   +50% / +150% / +400% attack *and* HP at pair / trips / quads.
2. **Abilities** — `packCount` (abilities.js) gates and tiers every rank ability off
   the *same* count, so a pair unlocks Ward / Haste / Hellfire / traps and quads makes
   them enormous.

The 2026-08-06 strategy tournament measured the consequence: the Set Miner (pairs)
archetype was the strongest of seven. The note written at the time: *"abilities gate on
of-a-kind count so pairs double-dip while straights and flushes pay stats only."*

This initiative is about **feel** more than power. A pair should be interesting because
it *switches something on*, not because your card silently gets fatter. **Rank 2 is the
model** — it was exempted from the stat table on 2026-07-22 and pays purely through
Berserker. This extends that idea to every rank, keeping a small residual instead of
going to zero.

### Decisions (Riley, 2026-08-06)

| Decision | Choice |
|---|---|
| Cut depth | pair **+15%**, trips **+40%**, quads **+100%** (from 50 / 150 / 400) |
| Face cards (J/Q/K/A) | Same reduced table as everyone **for now** — Riley scales them in a later pass. `OF_A_KIND_OVERRIDE` in config.js is the hook. |
| Balance target | None. Convert, measure, tune in a follow-up pass. |
| Test harness | Build a seeded RNG **first**, so before/after is reproducible. |

---

## The measurement protocol

`js/rng.js` (new) swaps the global `Math.random` for a seeded mulberry32 for the
duration of one call. **Nothing installs it automatically** — live play is never seeded.

```js
seeded(1, function () { return simStrategyScan(300); });  strategyMatrix();
seeded(1, function () { return simAIScan(4000, [5]); });  simAISummary();
```

**Determinism verified 2026-08-06:** two `seeded(1, …)` scans return byte-identical
`cell` matrices; `seeded(2, …)` differs. Note that the scan's returned object also
carries `elapsedMs` (wall-clock), so compare `result.cell` / `result.perCard`, **never
the whole object** — the timer will always differ and looks like a determinism failure.

---

## BEFORE — baseline at `?v=leg146`, seed 1

Table values at the time: pair `0.5 / 0.5`, trips `1.5 / 1.5`, quads `4.0 / 4.0`.

### Strategy tournament — `simStrategyScan(300)`, 44,100 battles

| Strategy | Overall win% |
|---|---|
| **paired** (Set Miner) | **57.3** |
| highest (Big Slick) | 55.6 |
| control (shipped bot) | 52.3 |
| middle (Middle Management) | 49.4 |
| connected (Connector) | 47.3 |
| suited (Flush Draw) | 44.6 |
| lowest (Bottom Feeder) | 39.6 |

Spread: **17.7 points**. Head-to-head, `paired` beats every archetype including the
shipped bot (55.9%) and loses only narrowly to `highest` (52.2% for paired).

Per-round, `paired` is flat across all seven rounds (59.1 → 55.9), so its edge is not a
late-game community effect — it is there from round 1 with a 2-unit army.

### Card scan — `simAIScan(4000, [5])`, 4,000 battles, 63 draws

By rank (win%, all four suits pooled):

| rank | 10 | 14 | 12 | 13 | 7 | 5 | 11 | 8 | 9 | 6 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| win% | 55.0 | 53.7 | 53.6 | 50.6 | 49.9 | 49.3 | 48.6 | 48.3 | 48.0 | 46.7 | 46.6 | 42.2 | 41.8 |

Rank spread: **13.2 points**.

By suit: clubs 52.2, spades 52.1, hearts 48.5, diamonds 45.9.

---

## AFTER — `?v=leg148`, seed 1

Table: pair `0.15`, trips `0.40`, quads `1.00`. Compensation `COMP = {pair 1.4, trips 2.0,
quads 2.8}` applied to Category-A tier values on ranks 3, 5, 6, 7 (see the rule written
into config.js above the table). Determinism re-verified: two `seeded(1, …)` scans byte
identical.

### Strategy tournament — `simStrategyScan(300)`

| Strategy | before | cut only | after (cut + compensation) | Δ |
|---|---|---|---|---|
| highest | 55.6 | 56.7 | **55.0** | −0.6 |
| paired | **57.3** | 54.5 | **54.6** | **−2.7** |
| control | 52.3 | 52.0 | 51.8 | −0.5 |
| connected | 47.3 | 48.8 | 48.6 | +1.3 |
| middle | 49.4 | 48.6 | 48.5 | −0.9 |
| suited | 44.6 | 44.6 | 45.7 | +1.1 |
| lowest | 39.6 | 40.6 | 41.2 | +1.6 |

**Spread 17.7 → 13.8 points.** `paired` is no longer the top archetype — `highest` is, by
0.4, which is inside noise. Head-to-head, `paired` vs `highest` went 52.2 → **50.2**: a
coin flip.

**The finding worth keeping.** The middle column is the stat cut with *no* ability
compensation at all. It cost pairs **2.7 points** — and the full compensation pass bought
back only **0.1**. Removing 60% of a quads unit's stats barely moved the win rate, which
means the of-a-kind payout was **already almost entirely in the abilities**; the flat
table was paying a lot of stats for very little win rate. That is the strongest possible
argument for the change and it also means Category C (the untouched ratios) is a bigger
lever than Category A was — start there if pairs need more.

### Card scan — `simAIScan(4000, [5])`

| rank | before | after | Δ | compensated? |
|---|---|---|---|---|
| 12 (Q) | 53.6 | 54.3 | +0.7 | no ladder (face) |
| 10 | 55.0 | 53.9 | −1.1 | C only |
| 14 (A) | 53.7 | 52.3 | −1.4 | no ladder (face) |
| 5 | 49.3 | **51.0** | **+1.7** | **A — Ward** |
| 7 | 49.9 | 49.8 | −0.1 | A — reels/jackpot |
| 13 (K) | 50.6 | 49.6 | −1.0 | no ladder (face) |
| 11 (J) | 48.6 | 49.0 | +0.4 | no ladder (face) |
| 2 | 46.6 | 48.0 | +1.4 | exempt (control) |
| 9 | 48.0 | 47.7 | −0.3 | B only |
| 6 | 46.7 | 46.7 | 0.0 | A — Hellfire |
| 8 | 48.3 | **44.8** | **−3.5** | **B only** |
| 3 | 42.2 | 43.4 | +1.2 | A — Thorns |
| 4 | 41.6 | 41.6 | 0.0 | C only |

Rank spread 13.2 → 12.7. By suit: clubs 51.3, spades 50.4, hearts 48.8, diamonds 46.3
(gap narrowed from 6.3 to 5.0).

**Rank 8 is the one that went wrong, and it falsified a prediction.** The plan assumed
Category B (flat numbers like Bulwark's `−50 damage`) would get a *free relative buff*
when every unit's HP shrank, so it was left alone. It did not: rank 8 lost its stats and
got nothing back, and dropped 3.5 points — the largest move of any rank. Flat damage
reduction turns out not to scale into the gap. **Fix in the next pass: rank 8 needs its
own compensation**, either COMP on `bulwark.reduce` or a move of its trap `damage` into
Category A. Rank 2 (the untouched control) drifting +1.4 is the noise floor for a single
seeded run, so treat anything under ~1.5 points as unresolved.

### Also verified in the browser

- `applySynergies` math: a lone pair of 5s → `950 × 1.15 = 1093` HP, `190 × 1.15 = 218`
  attack. Exactly the new pair rung, nothing else double-applying.
- The pair **switches Ward on** — the caster's bar filled on tick 7 and banked a
  `0.84 × 1093 = 918` shield, which then soaked 280 damage over the next four ticks.
- Champion tooltip and trait-sidebar chip print the **identical** Ward sentence, because
  after the 2026-08-06 rewrite they are generated from the same `ABILITY_TEXT` writer.
- `simInstall`/`simRestore` still leaves live play clean after a scan (round 1, 3-card
  hand, 100 chips, no leaked units or traps, no seed left installed).

---

## Next pass — the open list

1. **Rank 8 undercompensated (−3.5).** The Category B assumption was wrong. See above.
2. **Face cards J/Q/K/A** ride the shared reduced table with no ability ladder to catch
   them. They held up better than expected here (Q +0.7, J +0.4, K −1.0, A −1.4), but
   that is because their bespoke legendaries never depended on of-a-kind at all — a face
   pair is now nearly meaningless as a *decision*. `OF_A_KIND_OVERRIDE` in config.js is
   the hook.
3. **Category C is the untuned dial.** Giant Slayer, Rally, Haste, the poison ratios —
   all untouched. Rank 4 (C only) sat perfectly still at 41.6 and is the worst rank in the
   game; it is the obvious first candidate.
4. **Suit synergies now dominate the additive bracket** — hearts pays +100/250/600% HP
   against of-a-kind's +15/40/100%. Suited only gained 1.1 points, so this has not broken
   yet, but the ratio is now lopsided enough to be its own initiative.
5. **A Full House (+150%) now pays more flat stats than Quads (+100%).** Intentional —
   quads compensates through its ability tier — but the flop-reveal banner still ranks
   QUADS above it via the new `score` field, so the two must be read together.
