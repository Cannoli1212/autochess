# Architecture

How the autochess game is organized. This describes the **target** modular
structure we are migrating `game.html` toward — one system per file, with a
strict one-directional dependency flow and a single source of truth for state.

> Scope note: this refactor is **behavior-preserving**. Splitting files must not
> change how the game plays. Two small *structural* (not gameplay) changes are
> called out below under "Dependency inversions" — they exist solely to keep the
> dependency graph acyclic.

## Module system & conventions

- **Plain, ordered `<script>` files** (classic scripts), not ES modules.
  Rationale: the code reassigns shared state constantly (`units = units.filter(...)`,
  `flop = []`, `chips[x] = ...`). Classic scripts share one global scope, so these
  reassignments keep working with **zero logic changes** — the split is a pure
  cut-and-paste. (ES modules forbid reassigning imports, which would force a
  larger, riskier rewrite.)
- **`state.js` is the single source of truth.** It is the *only* module that
  declares persistent game state (the `let`/`const` game variables) and the DOM
  element references. Every other module **reads and writes those variables**
  but must **never declare its own persistent game state**. If a new piece of
  state is needed, it goes in `state.js`.
- **Dependencies flow one direction only (no cycles).** A module may call
  "downward" (toward `config`/`state`) but never "upward." See the layer diagram.
- **`config.js` is data only** — constants and tuning tables, no logic, no state.

## How to run

Because the game is now multiple files, the app's built-in preview panel can no
longer load it (it only loads a single HTML file). Run it through a local server:
open the folder in Cursor and use **Live Server** ("Open with Live Server"), or
double-click `game.html` into a browser. Classic scripts load fine over both.

## File layout

```
autochess/
├── game.html          # page skeleton: markup + <link> + ordered <script> tags
├── css/
│   └── styles.css     # all styles (moved out of <style>)
└── js/
    ├── config.js      # constants & data tables (no logic, no state)
    ├── state.js       # SINGLE SOURCE OF TRUTH: mutable state + DOM refs + tiny reads
    ├── cards.js       # card factory + finite shoe (draw/discard/shuffle)
    ├── flop.js        # community flop (own deck, hide/reveal, display)
    ├── flopreveal.js  # the Round Start cinematic: deal/flip/call-out the community
    ├── synergies.js   # suit-count synergy detection + buff application
    ├── board.js       # grid construction + render() units onto squares
    ├── hands.js       # hand + draw/discard pile rendering
    ├── placement.js   # drag-and-drop input (play/move/return); wires cell events
    ├── combat.js      # auto-battle simulation (returns a round result)
    ├── hud.js         # status text, scoreboard, chip badges (read-only display)
    ├── gameflow.js    # rounds, chip economy, start/next/reset; owns the combat loop
    └── main.js        # bootstrap: build board, wire input + buttons, initial calls
```

## Module responsibilities & allowed dependencies

Each module may only depend on the modules listed. This list *is* the rule —
if a change needs a dependency not listed, the design needs rethinking, not the
rule bending.

| Module | Responsibility | May depend on |
|--------|----------------|---------------|
| **config** | Tuning numbers & data tables (`COLS/ROWS`, `SUITS`, `SUIT_NAMES`, `SYNERGIES`, cooldowns, `STAT_SCALE`, `CHIPS_PER_SURVIVOR`, `DECKS`, `FLOP_SIZE`) | — (leaf) |
| **state** | All persistent game state (`units`, `hands/draw/discard/played`, `flop/communityDeck/flopRevealed`, `roundNumber/roundWins`, `chips`, combat flags, `dragData/placementOpen`) + DOM refs + trivial reads (`label`, `countUnits`) | — (leaf) |
| **cards** | What a card is + the shoe (`rankLabel`, `makeCardOf`, `makeCard`, `buildShoe`, `shuffle`, `initShoes`, `reshuffle`, `drawCard`) | config, state |
| **flop** | Community flop deck + reveal + display (`initCommunityDeck`, `hideFlop`, `dealFlop`, `flopCount`, `renderFlop`) | config, state, cards |
| **flopreveal** | The Round Start cinematic — deal, flip, call out the hand, land the cards (`flopReveal`, `flopRevealAbort`). Render-only: it never touches game state, and it no-ops entirely under `SIM_MODE`. Takes a **callback continuation** because nothing in this codebase is async | config, state, cards, flop, synergies, board |
| **synergies** | Suit counts → tier buffs (`suitCount`, `effectiveSuitCount`, `synergyTier`, `renderSynergies`, `renderTraitBar`, `teamSynergyEffects`, `applySynergies`) + read-only hand naming (`bestHandsFor`, the counterpart to `pokerBuffs`) | config, state, flop |
| **board** | Grid build + `render()` (`buildBoard`, `cellAt`, `findUnitAt`, `render`) | config, state, cards |
| **hands** | Hand & pile display (`drawHands`, `renderHands`, `updateShoeDisplay`, `renderOneHand`) | config, state, cards |
| **jokers** | Claiming & holding jokers — the player-level upgrade layer (`jokerSlotsFree`, `claimJoker`, `swapJoker`, `tryClaimFromHand`, `trySwapInto`, `renderJokers`) | config, state, cards |
| **placement** | Drag-and-drop input (`initInput`, `zoneOfRow`, `handleDropOnCell`, `playCard`, `moveUnit`, `handleDropOnHand`, `returnUnitToHand`, `updatePlacementMessage`) | config, state, board, hands, hud |
| **combat** | Auto-battle sim (`nearestEnemy`, `attackTarget`, `combatStep` → returns result) | config, state, board |
| **hud** | Read-only display (`updateStatus`, `updateRoundInfo`, `updateChipInfo`) | state, synergies |
| **gameflow** | Round/match loop + chip economy (`startRound` → `beginFight`, `finishRound`, `endGame`, `nextRound`, `resetGame`); owns the combat interval. `startRound` is split in two: the flop reveal runs between the halves, and `beginFight` is its continuation | config, state, flop, flopreveal, synergies, board, hands, hud, combat |
| **main** | Bootstrap: `buildBoard`, `initInput`, wire buttons/hand-drop, initial calls | (all) |

## Dependency flow (acyclic — read top-to-bottom = "depends on")

```
                         main
                          │
                ┌─────────┴─────────┐
            gameflow             placement
          ┌───┬───┬───┬───┐    ┌───┬───┬───┐
       combat │ hands │ hud  board hands hud
          │  synergies│  │     │     │    │
        board   flop  │  synergies   cards synergies
          │      │  synergies  │            │
        cards  cards   flop  cards          flop
          │      │      │      │             │
        (config, state) ───────┴─────────────┘
        config = leaf,  state = leaf (single source of truth)
```

Everything bottoms out at **config** (constants) and **state** (data). No arrow
ever points back up. `state` never calls into any system — systems read/write it.

## Dependency inversions (why two things move)

To keep the graph acyclic, two responsibilities move. Both are behavior-identical:

1. **Combat no longer calls game flow.** Today `combatStep()` calls
   `finishRound()` (combat → gameflow) while `startRound()` starts the combat
   interval (gameflow → combat) — a cycle. Fix: `combatStep()` runs one tick and
   **returns** a result (`"player1" | "player2" | "draw" | null`). **gameflow**
   owns the `setInterval`, checks the return, and calls `finishRound()` itself.
   Combat now depends on nobody above `board`.
2. **The board no longer knows about input.** Today the grid-building loop
   attaches drag handlers that call `handleDropOnCell` (board → placement) while
   placement calls `render` (placement → board) — a cycle. Fix: **board.buildBoard**
   only creates the grid; **placement.initInput** attaches the drag handlers to
   those cells (and the hand areas). Board depends on nobody above `cards`.

## Script load order (required for classic scripts)

`config → state → cards → jokers → flop → synergies → board → hands → placement →
combat → hud → gameflow → main`

> **The `<script>` list in `game.html` is the authority, not this line.** Several
> modules added since this document was written (`abilities`, `unitart`, `motion`,
> `fx`, `fxkits`, `flopreveal`, `ai`, `pathing`, `tableview`, `sim`, `table`) sit in that list and
> not here. Because these are classic scripts and every cross-module call resolves at
> call time, load order only actually matters for top-level code — so the omissions
> are a documentation gap, not a bug. Read `game.html` when adding a module.

Only top-level code (state's DOM refs, and `main`'s startup) runs at load; all
scripts sit at the end of `<body>` so the DOM exists. Cross-module calls resolve
at call time, so within that order nothing is used before it is defined.

## Migration status — COMPLETE (2026-07-09)

The split is done and the final structure matches this document exactly: 12 JS
modules (`config, state, cards, flop, synergies, board, hands, placement,
combat, hud, gameflow, main`) + `css/styles.css`, loaded in the order above.
Both dependency inversions are in place and verified. No structural deviations
from the plan. A pre-refactor snapshot is preserved at
`backups/game.monolith.2026-07-09.html`, and the game is run via a local server
(`python -m http.server`, see `.claude/launch.json`) or Live Server.

## Migration plan (how it was done — one system at a time, verify after each)

1. Extract CSS → `css/styles.css`, link it. Verify.
2. Move the whole inline script → `js/main.js` unchanged; load via `<script src>`.
   Verify multi-file loading works before fragmenting further.
3. Peel one system at a time out of `main.js` into its own file, in load order,
   applying the two inversions when `combat`/`board`/`placement`/`gameflow` move.
   `main.js` shrinks to just the bootstrap.

**Verify after every step:** load via Live Server → zero console errors → smoke
test (place units for both players, Round Start, watch a fight resolve, Next
Round, Reset). Each step is a pure move, so "loads clean + plays the same" means
behavior is preserved. Confirm no function was dropped or duplicated.

## Future hardening (optional, later)

If we ever want the boundaries *enforced* (not just documented), migrate to ES
modules with a single exported `state` object whose **properties** are mutated
(`state.units = ...`) — this satisfies "read/write through state" literally and
sidesteps the import-reassignment limitation. A get/set/subscribe store or a
finite-state-machine for game phases could follow. Not needed now.
