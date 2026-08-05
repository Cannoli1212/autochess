# Jokers — the catalog

The design doc for the joker layer. **Read this before adding a joker entry to
`js/config.js`.** Written 2026-08-05 (Riley's design pass).

A joker is **not a unit**. It has no suit, no rank, no attack and no HP, it can never be placed on the
board, and it is the game's only *player-level* upgrade. You may hold `JOKER_SLOTS` (3) at a time — the
cap is the point, because with unlimited slots claiming a joker is never a decision.

**Jokers are not sold** (Riley, 2026-08-05). The only way to one is to **draw it out of the shoe** —
`JOKERS_PER_DECK × DECKS` = 4 in a 108-card shoe, ~3.7% a draw. That's what makes a redraw a *hunt*
rather than a mulligan, and it's why a joker reads as luck rather than as a purchase.

The machinery is `js/jokers.js`. The catalog is `JOKERS` in `js/config.js`.

## The shop

Comps buy two things, both aimed at "the hand I was dealt isn't the hand I want":

- **Redraw** (`COMPS_REROLL_COSTS = [2,4,6]`) — throw the whole hand away, take another. Cheap,
  repeatable, random. The price escalates *within* a round so digging is self-limiting.
- **Card pack** (`COMPS_CARD_PACK_COST = 5`) — `CARD_PACK_SIZE` cards revealed, you keep one, and it
  goes straight into your hand so it's playable this round. The value is **targeting**: the exact suit
  for a flush, the exact rank for a pair. A redraw is a new random hand; a pack is a choice.

Pack cards are dealt with **no repeated rank and no repeated suit**, so the offer is always a choice
between different *shapes* rather than three near-identical cards. They're **minted** (`makeCardOf`),
not dealt off the draw pile, so the two you turn down never existed and a pack can't thin the shoe
you're about to draw from. The one you keep joins the shoe permanently once played, so each pack grows
your deck by exactly one card — a rounding error against 108, and worth it for "the card I bought
stays mine".

**AI seats are the one asymmetry.** A seat buys jokers *outright* (`COMPS_SEAT_JOKER_COST = 8`) because
it has no shoe to find them in — `simDraftHand` invents cards rather than dealing from a deck. It buys
nothing else: `tableMatch` doesn't emulate rerolling, and a bought card would evaporate when the next
match drafts a fresh hand.

---

## The three rules

**1. A joker is data, not code.** Every effect is a **numeric field** summed across the jokers you
hold (`jokerSum`), read at exactly one integration point. To add a joker, name a field something
already reads. If you need new code, you are adding an *integration point* — that's a separate, bigger
job, and it should unlock several jokers, not one.

**2. Downsides are free.** `jokerSum` adds, so a **negative** number is a fully working drawback with
no new code. `handBonus: -1` is a real cost. This is what lets a joker be *powerful* rather than merely
*nice*, and what makes turning one down a decision. See The Loan Shark.

**3. One knob per joker, two at most.** A joker whose blurb needs three clauses is one nobody reads.

Plus two conventions every entry carries, both enforced by `pickJokerKey`:

- **`weight`** — rarity. 4 common, 2 uncommon, 1 rare. Without it, a 26-joker pool would offer the
  game-warping ones as often as the small ones.
- **`aiUseless`** — true when a headless AI seat can't benefit. `tableMatch` doesn't emulate rerolling
  and a seat can't work an activation UI, so a seat buying one of those spends comps on nothing.

### Two invariants a joker must never break

- **Chips are zero-sum.** Chips are *score*, not money — you only ever steal them. **Never mint chips.**
  A payout joker either mints **comps** (the shop currency, minted by design) or moves chips *out of the
  opponent's stack*. The steal is clamped by the loser's stack in both `finishRound` and `tableMatch`.
- **The sim must stay clean.** `simInstall` blanks `jokers` and `comps` so balance scans never see a
  collection. **Any new joker state must join the `simInstall`/`simRestore` snapshot** (`js/sim.js`) or
  it leaks into every balance number. Regression test: run `simAIScan` with the whole catalog loaded and
  with none — the results must be bit-identical.

---

## Why ~26 jokers

Per 7-round game you **see** ~8–10 jokers (1–2 drawn from a 108-card shoe holding 4, plus 3 per pack ×
the 2–3 packs a 21–35 comp budget affords) and **keep 3**.

| Catalog | Seen per game | |
|---|---|---|
| 12 | ~75% | You'd know the whole pool by game two |
| **~26** | **~35%** | Two games in a row feel different; a pack of 3 is a real choice |
| 40+ | ~22% | A joker seen once in five games can't be balanced by feel |

Balatro carries 150 because a run has dozens of pack openings. Seven rounds and two packs cannot.

---

## The six families

The catalog is grouped by **integration point**, not by flavour, because one change unlocks a whole
family. That's the build order.

| Family | The one change that unlocks it | Status |
|---|---|---|
| **Economy / shop** | `finishRound`'s payout, `teamLootMult`, `rerollPrice`, `packPrice` | **built** |
| **B — Hand (activated)** | The activation flow in `jokers.js` + `makeCardOf` to re-derive stats | **built** |
| **A — Flop** | `applyJokerFlopShaping` inside `growCommunity` | **built** |
| **D — Triggers** | The `roundDeaths` tally, paid at `finishRound` | **built** |
| **E — Stats** | The `low` term in `applySynergies` | **built** (one entry) |
| **C — Persistence** | Things surviving `nextRound` — cards (built), then stats (new state) | **cards built** / wave 3 |

### Activated jokers

Most jokers are a number. A few need you to **choose**, and a choice is a multi-click input mode, not a
field. `activated: true` marks one; the flow lives in `jokers.js` (`beginJokerAction` →
`chooseJokerTarget` → `finishJokerAction`) and deliberately copies the shape of the two-step joker
**swap**: arm a pending action, let the next click resolve it. One pattern for "click, then click
again", not two.

Always **once per round** (`jokerUsedThisRound`) — an activation you could repeat would recut your whole
hand and the choice would be fake. A click on a held joker resolves in a fixed order: **finish a swap
first** (that mode is entered from the hand and must win, or you get trapped in it), then cancel an
action armed on that joker, then start one.

The Tailor is the only one today. **The Dealer (wave 2) is the same flow** aimed at the community board
instead of the hand — which is why this is a mechanism and not a special case.

---

## Wave 1 — shipped

| | Joker | Rarity | Field | Effect |
|---|---|---|---|---|
| ☕ | The Regular | common | `compsPerRound: 2` | +2 comps every round |
| 🍸 | The Cocktail Waitress | common | `compsOnLoss: 3` | +3 comps on a round you **lose** |
| 🕴️ | The Pit Boss | uncommon | `stealMult: 0.5` | +50% chips stolen on a win |
| 🅿️ | The Valet | common | `rerollDiscount: 1` | bought redraws cost 1 less |
| 🦈 | The Loan Shark | common | `packDiscount: 2`, `handBonus: -1` | cheap card packs, one card fewer |
| 🧮 | The Counter | uncommon | `handBonus: 1` | +1 card in hand |
| 🎩 | The Mechanic | common | `redrawBonus: 1` | +1 free redraw |
| 💎 | The High Roller | rare | `atkPerChip: 0.002` | army scales with your chip stack |
| 👓 | The Superstitious | rare | `packGate: 1` | abilities need one fewer copy to switch on |
| 💼 | The Bagman | rare | `retainSurvivors` | played cards that **survived** return to hand |
| 🔪 | The Card Sharp | rare | `cardAging` | cards left unplayed in hand gain stats |
| 🧵 | The Tailor | uncommon | *activated* | once a round, change a card in hand to any suit |

**Notes on the three interesting ones:**

- **The Superstitious** lifts a **lone** card to a pair — enough to switch a rank ability on — and stops
  there. Gating *and* tiering both read `packCount`, so lifting the count outright would silently
  promote every rung on every unit (a pair firing as trips). It opens the gate; it never promotes.
- **The Bagman** is self-balancing and needs no cap: win the fight and you keep your army, lose and your
  units died so you keep almost nothing. Works because `buildUnit` stores `card: card` on every unit.
- **The Card Sharp** rewards *not* rerolling, so it plays directly against the Redraw button and against
  The Valet. A card lost to a reroll takes its growth with it. Its growth is re-applied after a Tailor
  recut, because `makeCardOf` returns a fresh card — without that, the two jokers would undo each other.

**Half the catalog is `aiUseless`** — Valet, Mechanic, Tailor, Bagman, Card Sharp, Loan Shark — so a
seat picks from only 6 of 12. Four share the *same* cause: `tableMatch` drafts a fresh hand and resets
`played` every match, so a headless seat has no reroll and no hand continuity. **Teaching the table to
carry seat hands between rounds would fix four jokers at once** — the most valuable single piece of table
work left, and it's getting more valuable as the catalog grows.

The Loan Shark's tag is **load-bearing, not a nicety**: `packDiscount` only applies to card packs, which
seats can't buy, while `handBonus: -1` *is* honored by `tableMatch`. Untagged, a seat would pay 8 comps
to get strictly worse. **Any joker whose upside is human-only but whose downside is engine-wide must be
tagged** — that's the general rule the Loan Shark is an instance of.

---

## Wave 2 — shipped

| | Joker | Rarity | Field | Effect |
|---|---|---|---|---|
| 🎴 | The Dealer | uncommon | *activated* | call a suit; one community card turns it at Round Start |
| 🪜 | The Optimist | uncommon | `flopShift: 1` | community cards shift 1 rank **toward** the middle |
| 🧊 | The Cooler | uncommon | `flopShift: -1` | community cards shift 1 rank **away** from the middle |
| 🔫 | The Enforcer | uncommon | `compsPerKill: 1` | +1 comp per enemy unit killed |
| ☠️ | Dead Man's Hand | uncommon | `compsPerDeath: 1` | +1 comp per unit of yours that dies |
| 🐣 | The Sucker | rare | `lowRankMult: 1.0` | ranks 2–5 fight at +100% attack and HP |

### Why the flop jokers work at all

The community is dealt at Round Start, **after** placement locks, and is re-randomized every round —
deliberately unplannable luck. These three don't let you see it coming; they make its **shape** reliable
every round, which is what makes committing to a build safe. They convert variance into a plan.

The Dealer goes further: *you* choose the suit, so the shared card is one you picked and built toward
while your opponent gets a suit they never asked for. It's a **standing order** — recorded in
`jokerSuitPick`, resolved by `applyJokerFlopShaping` — and the row shows the call so a player who clicks
a suit and sees nothing change doesn't conclude it's broken. It only converts a card *not already* that
suit, so it can never visibly whiff.

`flopShift` is **summed across both players**, so an Optimist facing a Cooler nets zero. That's what
makes the Cooler a real counter rather than a mirror.

### Measure the flop jokers, don't reason about them

Both were wrong on the first pass, in ways no amount of thinking would have caught. Over 8000 boards:

| | pair | trips | 3-straight | 4-straight |
|---|---|---|---|---|
| no joker | 58% | 5% | 22% | 3.9% |
| The Optimist | 84% | **33%** | 17% | 2.8% |
| The Cooler | **42%** | 6% | 18% | **0.9%** |

1. **The Optimist makes FEWER straights.** A run needs *distinct* consecutive ranks; cards converging
   onto one rank make pairs instead of extending a run. Its real headline is **trips, 5% → 33%** — and
   since `packCount` reads the community, that tiers rank abilities to their trips rung. It's an
   of-a-kind engine, not a straight engine.
2. **The Cooler originally *raised* pairs**, 58% → 69% — the exact thing it exists to deny — because
   pushing everything outward slammed several cards into the 2 and 14 clamps where they piled up.
   Skipping blocked moves fixed pairs but left straights untouched (a blocked card never moved).
   Spreading now **slides past** a collision to the next free rank, which does both.

The blurbs state measured effects, not intended ones. Keep it that way.

### The triggers share one tally

`roundDeaths` counts bodies in `combatStep` just before the dead are filtered out — **deaths, not
kills**, because death is unambiguous (a unit dies once) whereas "who killed it" is murky when poison, a
redirect and thorns all contributed. Counting at the filter puts every cause in one place. Your *kills*
are simply the enemy's death count: one tally, read from both ends. `jokerTriggerComps` is shared by the
live and seat payouts precisely because those two ends are easy to swap by accident.

**Balance note:** holding both triggers paid 60 comps over a 7-round game against the 21–35 baseline —
roughly double income, or 12 card packs. Individually each is ~+3 a round, in line with `COMPS_INCOME`.
Both are single numbers if that wants turning down.

### The Sucker adds, it doesn't multiply

`lowRankMult` goes into the *same bracket* as the suit and poker buffs — `base × (1 + suit + poker +
low)` — so a low card gets one combined multiplier instead of compounding while also holding a flush and
a pair. It therefore **doubles a card with no other bonuses** and is worth proportionally less on an
already-buffed one, which is why the blurb says "+100%" and not "double". The first draft said double; a
3 with the hearts flush up went ×1.5, so the blurb was simply false.

> A generic stat trio (melee HP / ranged attack / team crit) was designed and **cut** — flat percentages
> with no identity. Family E gets build-arounds or nothing.

---

## Wave 3 — needs real primitives

Wave 3 takes the catalog from **18 to ~24** and is the first wave where nothing is a one-liner.

| | Joker | Primitive needed |
|---|---|---|
| 📈 | **The Grinder** | Playing a rank permanently buffs all your cards of that rank. Persistent per-rank state surviving `nextRound` — **must** join the sim snapshot |
| 🧿 | **The Believer** | Same, keyed by **suit** — promotes mono-suit decks. Shares the Grinder's state; build them together |
| 🃏 | **The Understudy** | Your joker plays as a real **wild card** in the poker pool. `pokerPool` returns `number[]` and a wild isn't a rank, so the pool's representation changes — and it's the shared input to `pokerBuffs`, `packCount` *and* `renderPokerTraits`. The thematically perfect joker and the most invasive change in the catalog: build it last, alone |
| 🩹 | **The Lucky Stiff** | A unit sometimes survives lethal. Needs a lethal-damage intercept — `combat.js` writes `sink.hp` with no pre-death veto |
| 🔁 | **The Shill** | One unit strikes twice on its first hit. **Double Tap / retrigger** — `FUSION-IDEAS.md` primitive #1, so the cost is shared with the fusion roadmap |

**Deferred, unscheduled:** 🗼 the super card — fuse your whole hand into one unit. `FUSABLE_HANDS` is
rank-pair keyed, so this needs a new whole-hand fusion path.

**Bench** (pull from here if a wave loses one): 👁️ Eye in the Sky (peek next round's community cards) ·
🍺 The Drunk (a card in hand *loses* a rank, as someone else's cost) · The Tourist (fat comps, can't
redraw) · Lady Luck (double the jokers seeded in the shoe).
