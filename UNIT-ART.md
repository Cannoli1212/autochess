# Unit art — how the sprites work, and what's left to do

Units used to be text: `7♠` in a 56px square. This pass gave them pictures, so a stranger can
tell a healer from an assassin without having memorised `RANK_ABILITIES`.

Everything here is **render-layer only**. Combat, pathing, placement, AI and the balance sim are
untouched, and the balance scan comes out identical with the art on or off.

## Where things live

| File | Job |
|---|---|
| `js/unitart.js` | `UNIT_ART` — the table of who looks like what. **Edit this to change art.** |
| `js/board.js` | `makeUnitNode` / `paintUnitNode` — puts the sprite on the board |
| `js/hands.js` | `renderOneHand` — puts the sprite on the hand card |
| `js/fx.js` | `spawnFxDeath` — the toppling ghost wears the same sprite |
| `css/styles.css` | `.fig-glyph.art`, `.rank-tag`, `.card .cart`, `.fx-ghost.ghost-art` |
| `assets/kenney-roguelike-characters/` | the spritesheet (CC0, see its `License.txt`) |

Bump the `?v=legNN` cache tag in `game.html` after any edit, and load `/game.html?fresh=N` —
the preview root serves a stale copy otherwise.

## The pack is a KIT, not a cast of characters

Kenney's pack ships no finished heroes. It ships **parts**, and each part is drawn into its own
band of an otherwise-empty 16×16 tile, so parts stack in place:

| cols | what |
|---|---|
| 0–1 | bare bodies (4 skin tones), plus 14 pre-assembled characters in rows 5–11 |
| 6–17 | clothing — shirts, robes, plate |
| 19–26 | hair and beards |
| 28–31 | helmets, capes (row 7), wide-brim wizard hats (row 8) |
| 33–41 | shields |
| 42–46 | staves (rows 0–3), swords (6–8), daggers (9) |
| 47–51 | axes, hammers, maces |
| 52–53 | bows |

Sheet: `Spritesheet/roguelikeChar_transparent.png`, 918×203, 16px tiles, 1px gap,
54 cols × 12 rows, 448 non-empty.

So an entry is a **stack**, written back-to-front — the order you'd dress someone in:

```js
"melee-9": { layers: [[1,3],[6,5],[31,8],[42,3]], name: "Plague Bearer" },
//            body      clothes  hat     staff
```

### Three things learned the hard way

- **Weapons must be drawn in front.** Behind the body they are 100% invisible.
- **Placement is fixed.** Weapons sit at x0–4 (axes and hammers are wider, x0–7), shields at
  x6–15, hair and helmets x4–11, and the face is around x5–11. So narrow weapons are safe;
  axes and hammers crowd the face and are best kept for units where looking heavy is the point.
- **Colour is what survives at 32px.** Weapons and hats read as texture. Each rank leans on one
  colour family. Nothing is ever truly ambiguous anyway, because the rank/suit tag is always there.

## How a unit picks its art

`unitArtFor()` checks three keys, most specific first:

1. `"spades-14"` — a legendary. Same key format as `UNIQUE_CARDS`, so the two can't drift.
2. `"melee-9"` / `"ranged-9"` — rank + role. Role comes from `isRangedSuit()`: ♣/♠ ranged, ♥/♦ melee.
3. `"melee"` / `"ranged"` — a safety net so a unit can never render blank.

An entry with `layers: []` falls back to the **text glyph**. That's not a broken state — it's how
the table was filled a few entries at a time, and it means the game still works with no assets
folder at all.

## The design scheme

**Commons (ranks 2–10)** — rank picks the archetype, because rank *is* the ability. Rank 5 is a
warden, rank 8 a horned tank, rank 9 a plague bearer. Suit picks melee vs ranged.

**Legendaries (J/Q/K/A)** — **suit picks the colour**, which is the one place colour can do that
job: ♥/♦ share a `unitColor` and ♣/♠ share another (`config.js:19-24`), so the board could never
show four suits until now. Rank escalates the trim — Jacks plain, Queens robed, Kings caped or
crowned, Aces carrying a **cyan enchanted weapon** nothing else on the board has.

- ♥ red/orange · ♦ gold/tan · ♣ white/steel · ♠ black

## Two implementation notes worth not rediscovering

**Scale with `background-size`, never `transform: scale()`.** `.fig-glyph`'s transform already
belongs to `playFlinch`, and the death ghost's belongs to the `fxDeath` animation — a static
scale on either gets wiped the moment the unit is hit or starts falling. So the element stays its
true drawn size and the whole sheet is scaled underneath it. `--art-px` is pushed onto `:root`
from `ART_SCALE` so the size is decided in exactly one place.

**`applyUnitArt` reverses the layer list.** CSS paints the *first* background on *top*, which is
the opposite of dressing order. `layers` is authored back-to-front because that's readable, so it
gets flipped once, there.

## Still to do

- **Tune the weaker sprites.** Each is one line in `UNIT_ART`. Weakest reads today:
  `melee-10` Standard Bearer and `ranged-10` Herald (bland cream), `melee-7` Gambler (drab),
  `diamonds-12` Queen of Diamonds (reads lavender rather than gold). `melee-3` Training Dummy is
  deliberately plain — check it reads as "this thing doesn't fight" and not as unfinished.
- **Mirror units to face their travel direction.** `motionLean` (`js/motion.js:265-273`) carries a
  note rejecting a horizontal flip because "a mirrored 7♠ is simply wrong". That constraint died
  with this pass — a mirrored sprite is exactly right, and facing is a real readability win on a
  board where everything walks.
- **Fused "made hands"** borrow the art of their onto-suit rank. Their own identity is the `72♥`
  tag plus the green glow. Fine for now; bespoke art for the four fusions is an option later.
- **Suit-coloured commons.** The legendaries prove suit-as-colour works. The same idea could be
  pushed down to the 18 commons, but it would fight the rank colour families, so it needs a think.
