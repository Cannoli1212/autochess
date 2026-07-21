# Autochess-Poker-Gambling Game — Design Roadmap

A living design doc. We update this as decisions get made. Nothing here is
built yet except the base autochess prototype + 5-round mode (in `game.html`).

## The vision (in Riley's words, organized)

A two-player game that mixes three genres:
1. **Autochess combat** — place units, they auto-fight. (DONE)
2. **Poker-card drafting** — draw cards each round, play half; suits & combos
   eventually give synergies and stats.
3. **Chip gambling** — each player starts with 100 chips; winning a round
   steals chips; at the end you win the net difference.

## Reference games (from research)
- **Balatro** — poker hands + suits + Joker synergies + a chips/mult scoring
  system. Closest match to the "suits and combinations" + "chips" vision.
  Key lesson: show synergies *visually* (each card pulses + shows its effect).
- **Super Auto Pets** — the draft → play → auto-battle → economy loop, kept
  simple and readable. Good complexity target.

## The core insight: a played card = a unit on the board
"Play half your cards" is the same as "place your units." So the round system
we already have IS the play step. The NEW layer is the **draft**: draw 2×round,
choose which half to play.

| Round | Draw (2×round) | Play (half) = units placed |
|-------|----------------|----------------------------|
| 1 | 2 | 1 |
| 2 | 4 | 2 |
| 5 | 10 | 5 |

## Proposed data model (where we're heading)
```
Card   = { id, type, suit, rank, attack, hp }   // one type for now
Player = { chips: 100, deck: [Card...], hand: [Card...], roundWins }
Unit   = { x, y, attack, hp, team, cardId, suit } // created FROM a played card
```
The `units` array (our current source of truth) stays; units just get *born*
from cards and remember which card/suit they came from for later synergies.

## Phased plan (order matters — chips come LAST, per Riley)

### Phase A — Card & draft framework (one card type, no chips yet)
Goal: units come from cards, with a draw/select/play flow. With one card type
the choice is trivial, but the machinery is what unlocks everything else.
1. Give each player a deck/pool (one card type for now).
2. Each round, draw 2×round cards into a hand; show the hand on screen.
3. Player selects half to play; those become the units they place.
4. Existing combat + round win/scoreboard unchanged.

### Phase B — Card variety + suits/ranks + synergies

**Suit design — LIVE VALUES (being tuned in playtest, 2026-07-09):**
| Suit | Range | Stats | Ability |
|------|-------|-------|---------|
| ♥ Hearts | 1 (melee) | 1/10 | tank (just high HP) |
| ♦ Diamonds | 1 (melee) | 1/6 | lifesteal — heal for damage dealt (cap maxHp) |
| ♣ Clubs | 3 (ranged) | 2/3 | fast attacker — `attackSpeed 1.5` (2026-07-10; was AoE splash) |
| ♠ Spades | 3 (ranged) | 2/2 | 50% crit (2× damage) |

Abilities are config flags on `SUITS` (`crit`, `attackSpeed`, `lifesteal`); units
carry `maxHp` for the lifesteal cap. Stun idea was dropped. **Clubs' AoE was
replaced by attack speed (2026-07-10)** — cleaner as a team aura. Attack pacing is
now a charge model: a unit gains `attackSpeed` charge/tick and strikes at
`ATTACK_PERIOD` (=2), so `attackSpeed 1` = one hit / 2 ticks (old speed), higher =
faster (can multi-hit per tick). Splash removed from combat entirely.

Ref: an open-source autobattler uses this exact crit/stun/column-AoE kit
(github.com/JustinMWoo/AutoBattler). Balatro lesson for the synergy layer:
flush builds + visible ordered feedback so players intuit combos.

**Engine upgrades required (the real work of Phase B):**
- Range: attack when `distance <= unit.range`, else move.
- Crit: `Math.random()` roll doubles damage.
- AoE: after hitting target, also damage its neighbors.
- Stun: units get a `stunned` counter; skip a turn while > 0.
- HP > 1 so fights last longer. DECIDED: **higher HP only** for now (units still
  attack every tick — no attack cooldown). Revisit a cooldown in B3 only if
  fights feel too frantic.

**Sub-phases:**
- **B1: DONE (2026-07-09).** `SUITS` config object (symbol, cardColor,
  unitColor, range, attack, hp); `makeCard()` rolls a random suit. Base atk 1 /
  hp 3, hearts hp 4; hearts+diamonds range 3, clubs+spades range 1. Combat
  change was just `distance <= unit.range`. Units/cards render as colored suit
  symbols with range tooltips. No active abilities yet (B2). Ranks still uniform
  until B4.
- **B2: DONE (2026-07-09).** Abilities are data on `SUITS` (`crit: 0.5`,
  `aoe: true`, spades `attack: 2`). All damage routes through `attackTarget()`:
  diamonds roll `Math.random() < crit` for 2x; clubs splash to enemies within 1
  of the target. **CHANGE from plan (Riley):** spades dropped stun → flat 2
  attack instead. Stun deferred/removed. No crit visual feedback yet (future
  polish — flash cell on crit, per Balatro).
- **B3** — Balance pass: tune stat scale and cooldowns for good fight length.
- **B4 — DONE (2026-07-09).** Each card rolls a random rank 2–14
  (2–10, J=11, Q=12, K=13, Ace=14). Final stats = suitBase × rank × STAT_SCALE,
  STAT_SCALE = 10. Suit base stays the small role numbers (hearts 1/10, diamonds
  1/6, clubs 2/3, spades 2/2). E.g. rank-10 heart = 100 AD / 1000 HP; Ace-heart
  = 140/1400. Ratios (fight length) unchanged across ranks; high cards crush low
  → draft finally matters (keep high, dump low). makeCard() rolls suit AND rank;
  cards/units show rank + suit + computed stats. One knob (STAT_SCALE) for
  magnitude. Key: HP:AD ratio, not raw size, sets fight length.
- **B5 — PLAN (finalized 2026-07-09): suit-count synergies, tiered 2/4/5.**
  Count each suit among a player's placed units; effects:

  | Suit | Scope | 2 | 4 | 5 (FLUSH) |
  |------|-------|---|---|-----------|
  | ♥ Hearts | WHOLE team | +100% HP | +250% HP | +600% HP |
  | ♠ Spades | WHOLE team | crit 30% | crit 60% | crit 100% (always) |
  | ♦ Diamonds | diamonds only | +50% attack | +150% | +400% |
  | ♣ Clubs | clubs only | splash radius +1 | +2 | +4 |

  Hearts & spades are team auras (reward splashing); diamonds & clubs intensify
  their own suit (reward committing) — Riley's call. The 5-tier = a poker FLUSH
  (all 5 units one suit), only reachable in round 5; deliberately massive.
  Magnitudes tunable.

  **Impl:** `computeSynergies(team)` from suit counts → at Round Start apply:
  multiply hp/maxHp (hearts, team), multiply attack (diamonds, own units), set
  `unit.critChance = min(1, suitCrit + teamCritBonus)` (spades team), set
  `unit.splashRadius` (clubs own units + base). `attackTarget` reads
  critChance/splashRadius instead of hardcoded values.
  **Sub-steps:** B5.1 = count + live synergy panel during placement (no effect)
  — DONE (2026-07-09): `SYNERGIES` config (tiers hold both effect numbers AND
  display text), `suitCount`/`synergyTier`/`renderSynergies` (called from
  updateStatus), chips shown under the hands. B5.2 = apply effects in combat —
  DONE (2026-07-09): `teamSynergyEffects()` + `applySynergies()` bake buffs into
  units at Round Start (multiply HP/attack, set `unit.critChance` and
  `unit.splashRadius`); `attackTarget` reads those. **PHASE B COMPLETE.**
### B6 — Poker-hand synergies (PLAN, decisions locked 2026-07-10)

A SECOND synergy axis alongside the existing suit-count one. Suit synergies read
SUITS; poker synergies read RANKS. Both coexist (parallel layers, same
detect→display→bake pipeline in synergies.js); the suit system is untouched.

**Decisions (Riley, 2026-07-10):**
- **Card pool = your units + the flop** (real Texas Hold'em: units are your hole
  cards, the 3 flop cards are community). Best hand from the combined pool. Both
  players share the flop but have different units → different hands. All cards
  already carry `rank`+`suit`, so the data is there. NOTE: round 1 pool = 1 unit
  + 3 flop = 4 cards, so 5-card hands (straights) need round 2+; pairs & named
  combos work from round 1.
- **Flush stays in the SUIT system** (suit tier-5 already IS a flush) — the poker
  layer does NOT re-detect flush, to avoid double-counting.
- **7-2 reward = BONUS CHIPS on a win** (not a combat buff). Winning a round with
  a 7-2 in the pool steals extra chips — ties into the Phase C economy, matches
  the real-poker "7-2 game" tradition. Hooks `finishRound` (if the winner's pool
  contained both a 7 and a 2 → extra steal).

**Hands & detection (over the combined pool's ranks):**
- Of-a-kind: count each rank; the max count → pair(2)/trips(3)/quads(4). Two pair
  = two ranks each appearing ≥2. Full house = trips + a pair.
- Straight = 5 consecutive ranks (ace-high for now; ace-low "wheel" maybe later).
- Named hands (check the pool's RANK SET): **Doyle Brunson = has a 10 AND a 2**
  → team bruiser buff; **7-2 = has a 7 AND a 2** → the chip bonus above.

**Buff SCOPE — DECIDED 2026-07-10 (Riley): poker buffs are PER-CARD, not team.**
The clean design axis is now: **SUITS = team-wide auras, POKER RANKS = targeted
spikes on the matched cards.** For each rank appearing 2+ times in (your units +
the flop), every UNIT of that rank gets the of-a-kind buff. Cases: 2 of your
units same rank → both buffed; 1 unit + a flop card same rank → that unit buffed
(flop "completes" the pair); a pair entirely in the flop with no matching unit →
buffs nobody (shows but inert). Straights/full house (B6.2) follow the same rule:
buff the participating UNITS. (This SUPERSEDES an earlier draft that had poker
buffs as team-wide.)

**Rewards (first-pass, TUNE later):** per matched unit — pair +50% atk/HP, trips
+150%, quads +400% (punchier than a team aura because it hits only 1–4 units).
Doyle (10-2): scope TBD — per-card (buff your 10 & 2 units) or a team "legend"
buff? 7-2 is a chip bonus (economy), unaffected. These stack with suit auras →
expect swingy, tune after playtest.

**Companion change (Part 1) — DONE 2026-07-10.** All four suit synergies are now
team-wide. Hearts/spades already were; DIAMONDS (attack) moved to whole-team (the
`u.suit === "diamonds"` gate dropped in `applySynergies`). CLUBS changed identity
from splash/AoE to **attack speed** (Riley — cleaner as a team aura than "everyone
splashes"): base `SUITS.clubs.attackSpeed = 1.5`, synergy `speedBonus` team-wide
(tiers +50/+100/+200% attack speed). Combat reworked to a charge model
(`ATTACK_PERIOD = 2`, unit gains `attackSpeed` charge/tick, strikes when full,
can multi-hit); splash code + `splashRadius` + `aoe` flag removed. Verified
in-browser: non-diamond attack +50% under 2♦, non-club attack-speed +50% under
2♣, and a fast club beats an equal-stat normal-speed unit. NOTE: ♦/♣ now hit the
whole team → retune magnitudes down later.

**Architecture:** new `POKER_HANDS` config table (mirrors `SYNERGIES`); detection
+ panel display + baking all in synergies.js (reads units + flop). IMPL GOTCHA:
`teamSynergyEffects()` currently OVERWRITES each effect key (`eff.atkMult =
t.atkMult`); poker attack buffs are a SECOND source of atkMult, so combine
ADDITIVELY (accumulate, don't overwrite) or the two layers clobber each other.

**Build order (Riley's choice — incremental):**
- **B6.1 (first):** rank-reading engine + of-a-kind (pair / two pair / trips /
  quads) team buffs + Doyle (10-2) + 7-2 chip bonus; show active poker hands in
  the synergy panel.
- **B6.2 (later):** straights + full house (harder detection).
- Flush already covered by the suit system.

**Brainstorm bank (later / optional card kits):** lifesteal, taunt/tank, armor,
poison DoT, heal aura, knockback, pierce/chain, assassin (jumps to backline).

**Open questions:**
- Base stat numbers (proposed start: attack 1, HP 3; hearts HP 4). Tune in B3.
- Exact ability params: crit 2× @ 50%? stun 25% for 1 attack? AoE full or half
  to neighbors?
- Suit-count synergy vs full poker hands vs both (B5).

### Phase C — Chip gambling economy — DONE (2026-07-09)
1. Each player starts at 100 chips (`chips = {player1, player2}`).
2. Winning a round steals `survivors × CHIPS_PER_SURVIVOR` (=10) — MARGIN OF
   VICTORY (Riley's choice); floored so the loser can't go below 0. Draws move 0.
3. End of game (`endGame`) decides the winner by CHIPS (net difference is the
   payout); round wins still tracked but now just flavor.
4. Gold chip line under the scoreboard; steal announced in the round result.
   One knob: CHIPS_PER_SURVIVOR.

### Phase D — Card shoe (finite deck) — DONE (2026-07-09, first pass)
Built PER-PLAYER shoes (Riley's choice, not shared) at **DECKS = 2** (104 cards
each). State: `draw`/`discard`/`played` = {player1,player2}. `buildShoe()` +
Fisher-Yates `shuffle()`; `drawCard()` pops (reshuffles discard if empty);
`initShoes()` on load + resetGame. Cards flow drawn→hand→played(units, carry
`unit.card`)→discard(at Next Round), or unplayed→discard(at Round Start).
Two visible pile "spots" per player (Draw/Discard counts) under the hand.
NOTE: a 5-round game draws only ~30 of 104 → shoe doesn't deplete in one game;
needs a persistent SESSION across games for scarcity/counting to matter (next).
DECKS is one knob (bump to 6 later). Original plan notes below.

### Phase D — Card shoe (finite deck, blackjack-style) — PLAN (Riley's idea)
Replace the infinite pool with a real **6-deck shoe**: 6 × 52 = **312 cards**,
shuffled once, drawn from until a reshuffle point. Makes card availability
finite → "what's left" becomes trackable info (card counting), which suits the
gambling theme.

**How it changes today's code (contained):**
- Build a `shoe` array of 312 card objects (all suit+rank combos ×6), shuffle it.
- `makeCard()` (mint on demand) → `drawFromShoe()` (pop one card). drawHands()
  calls that instead. Everything downstream (stats, drag, combat) unchanged.
- Drawn/played/discarded cards go to a **discard pile**, not back to the shoe.
- **Reshuffle** when a "cut card" is reached (e.g., ~1 deck / 52 left): fold the
  discard pile back in and reshuffle before the next round.
- Show a **shoe counter** ("cards left: 250/312") — the seed of card counting.

**Key realization about scale:** a single 5-round game only draws
2×(1+2+3+4+5) = 30 cards per player (~60 total). A 312-card shoe won't deplete
in one game — so the shoe should **persist across many games in a "session"**
(pairs naturally with the Phase C chips economy: a session of betting hands from
one shoe). Scarcity/counting matters over the session, not one game.

**Decisions to make when we build it:**
- Shared shoe (both draw from the same 312 — blackjack-style, enables counting;
  RECOMMENDED) vs one shoe per player.
- Reshuffle threshold (how deep to "penetrate" before reshuffling).
- Do played units' cards return to discard at end of round (yes) or stay out?

**Future mechanic Riley flagged:** "drawing cards before round start" — a
proactive draw phase (e.g., pay chips to draw extra cards, or a hit/stand-style
choice) layered on top of the shoe once it exists.

**Timing:** build AFTER Phase C — the shoe is only meaningful with a
session/economy for scarcity to matter.

### Phase E — Card holds + community flop — PLAN (Riley's idea, 2026-07-09)

**Feature 1: Holding cards across rounds. DONE (2026-07-10).**
Built exactly as planned. holdLimit = the round just played (roundNumber):
1 after R1 … 4 after R4; R5 → endGame, no hold.
- New state: `holdMode` flag in state.js (true only on the results screen); the
  "held" mark is a `held` boolean on the card object itself (travels with it).
- `startRound()` NO LONGER discards unplayed cards — they stay in hand through
  the fight and into the results screen.
- `finishRound()` (when roundNumber < 5) sets `holdMode = true`, re-renders
  hands, and prompts "Click up to N leftover card(s) to hold."
- hands.js: `toggleHold(team,index)` toggles `card.held`, capped at roundNumber
  (`heldCount()` helper); `renderOneHand()` adds a click listener + gold `.held`
  highlight + 📌 badge only in holdMode, and makes cards non-draggable then.
- `nextRound()`: keeps `held` cards (clears the flag), discards the rest, THEN
  `drawHands()` tops the hand up. `resetGame()` clears `hands` first + resets
  `holdMode`; `endGame()` clears `holdMode` too.
- CSS: `.card.held` (gold border + glow) and `.card .chold` (badge text).

**FIXED HAND SIZE (2026-07-10, Riley's change):** hands are a FIXED size each
round = 2 × round (R1=2, R2=4, R3=6, R4=8, R5=10). Held cards COUNT toward that
total — `drawHands()` fills the hand UP TO the target (`while length < 2×round:
draw`) instead of adding a flat 2×round. So holding a card is never a bonus card;
it REPLACES a fresh draw. The decision is now "keep this known leftover, or draw
a fresh random card in its place?" (holdLimit = roundNumber = the number of
leftovers, so the cap never actually binds — you may hold any/all of them; the
real cost is fewer new draws). Verified: holder's draw pile drops by one fewer
than the non-holder's; both hands still reach the round's fixed size.
- Verified in-browser by driving the real game functions: leftovers survive
  Round Start, hold mode + gold highlight render, held card carries into next
  round with flag cleared, hand fills to fixed size, played card discarded,
  reset is clean, no console errors.

**Feature 2: Community "flop" — shared synergies. DONE (2026-07-09).**
Built: separate `communityDeck` (own shoe), `dealFlop()` pops FLOP_SIZE=3 each
round (load/nextRound/resetGame), `flopCount()`, `effectiveSuitCount = own +
flop` swapped into BOTH renderOneSynergy AND teamSynergyEffects, gold-edged
flop cards shown in center (#flop-area). Symmetric (helps both players); flop
alone can trigger a tier. Riley to playtest + reevaluate before Feature 1
(holds). Original plan below.
- **New flop of 3 community cards each round, revealed all at once** (DECIDED).
  Drawn from a SEPARATE shared community deck (doesn't touch player shoes).
- Their suits count toward BOTH players' synergy tiers. Effective suit count for
  a player = own units of suit + flop cards of that suit. e.g. play 1♥+1♠ with a
  flop of 1♥+1♠ → counts as 2♥+2♠ → both tier-2 buffs. Flop can trigger a tier
  by itself (2 of a suit in flop).
- Flop cards affect SYNERGIES ONLY — never become units; only suits matter
  (show ranks for flavor). Displayed in the center (near the board).
- Impl: `flopCount(suit)` added into `suitCount`-based tier checks in BOTH
  `renderSynergies`/`renderOneSynergy` AND `teamSynergyEffects`; a `flop` array
  refreshed in nextRound/resetHand; a flop display row.

**Build order:** flop first (self-contained: 3 cards + fold into synergy counts),
then holds (needs unplayed-persist + results-screen click selection).

## Open design questions (to decide before building each phase)

### Near-term (Phase A) — DECIDED
- **Selection UI: DRAG AND DROP.** Cards show in a hand row; drag a card onto
  a board cell in your zone to play it. (Most polished, most code — build in
  small sub-steps, see below.)
- **Deck source: INFINITE POOL of the one card.** Always draw copies of the
  single card type. Revisit finite decks when card variety exists.
- **Hidden info in hotseat:** OPEN — is a player's hand secret? Likely keep
  hands open for now (one screen).

### Phase A build sub-steps (drag-and-drop is the ambitious part — de-risk it)
- **A1: DONE (2026-07-09).** `hands = {player1:[], player2:[]}`; `makeCard()`
  mints a 1/1 from the infinite pool; `drawHands()` deals `roundNumber*2` cards
  on load / nextRound / resetGame; shown as a static row under the board.
  Hands are display-only so far (placement is still click-to-place).
- **A2: DONE (2026-07-09).** HTML5 drag-and-drop. `dragData` tracks what's held
  (card or unit); `playCard`/`moveUnit`/`returnUnitToHand` route drops. No more
  turns (`currentPlayer`/`switchTurn` removed) — both players edit their own
  zone freely. `placementOpen` flag locks editing during combat/results.
  Bidirectional: hand→board plays, board→hand un-plays, board→board moves.
- **A3: DONE (2026-07-09).** Round Start discards each player's unplayed cards
  (`hands.playerX = []; renderHands()`). Play limit (exactly N) was already
  enforced by playCard + the startRound guard. **PHASE A COMPLETE** — full loop:
  draw 2N → drag to play N → discard rest → fight.

### Later (Phases B–C)
- **Synergy model:** simple suit-count bonuses, or full poker hands
  (flush/straight/pairs) like Balatro?
- **Chips per round win:** fixed amount, scaling by round, or by margin of
  victory (surviving units)?
- **Elimination:** can a player hit 0 chips and lose early, or do chips just
  track the net difference to the end?
- **Decks:** shared pool or each player their own? Same draws or independent?

## Recommended next build
**Phase A, step 1–2 first:** introduce a `deck` and `hand` with the single
existing card, and draw 2×round cards each round — even before the selection
UI. Smallest change that establishes the card→unit pipeline everything else
depends on.
