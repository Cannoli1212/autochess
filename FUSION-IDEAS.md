# Fusion Ideas — research → card identities

Research pass (Dota Auto Chess / Underlords, Balatro, TFT, Slay the Spire, Monster
Train, Inscryption) mapped onto the mechanics **we already have**, plus a famous-poker-hand
name for every fusion so the identity reads instantly. Written 2026-07-15.

**Design rule we're keeping** (from the Dirty Diaper): a fusion is one parent's *trigger*
driving the other parent's *effect* — a NEW thing, not both abilities stapled on. Each entry
below says what it **keeps** from the parents and what's **new**.

**What we already have to build on:**
- **Rank kits:** 2 Berserk (ramp attack when hurt), 3 Thorns + Target Dummy (reflect wall),
  4 Giant Slayer (punch up vs bigger HP), 5 Slippery (dodge), 6 Executioner (execute low HP),
  7 Gambler (random ×, ramps, steals chips), 8 Bulwark (flat damage reduction), 9 Poison
  (stacks + plague-jump on death), 10 Rally (per-suit adjacency aura).
- **Hooks (all wired):** onRoundStart, onAttack, onIncomingHit, onDamaged, onDealDamage,
  onKill, onDeath.
- **Economy:** chips, gambler steal, house pot, Highwayman loot mult, Midas scaling.
- **Fusions done:** 7-2 Hammer (staple), 3-2 Dirty Diaper, 6-7 Double or Nothing, 10-2 Brunson.

**Build-cost legend:** 🟢 reuses existing hooks · 🟡 needs one small new kit · 🔴 needs a new
engine primitive (bigger lift, but each unlocks several fusions).

---

## Part 1 — What each game teaches us (and where it maps)

| Game | Mechanic worth stealing | Maps onto us as |
|---|---|---|
| **Balatro** | *Retrigger* — score a card twice; *scaling jokers* — grow per event; *xMult vs +Mult* ordering; *economy jokers* — chips beget chips | A **double-tap** hit (new); we already scale (Berserk/Gambler/Thorns); Gambler is our ×Mult; an **interest** engine (new) |
| **Auto Chess / Underlords** | *Knights* take less damage, more when **adjacent** to each other; *Assassins* crit + leap the backline; *Mages* **shred enemy resist** | Bulwark + Rally = a **Phalanx** (adjacency armor); spades-crit + a **backline-jump** placement; **armor-shred** anti-tank (new) |
| **TFT** | Frontline / backline / **carry** roles; positioning wins fights; augments = run-shaping picks | Frames every fusion as tank / carry / utility; our board already rewards placement (Rally, Airstrike) |
| **Slay the Spire** | *Poison ignores Block*; *Catalyst* **doubles** existing poison; *Strength + multi-strike*; *Block persists* | Poison already ignores HP-scaling; a **Catalyst** doubler (new-ish); Berserk + double-tap; Bulwark that **banks** into a shield |
| **Monster Train / Inscryption** | Buff-engine feeding one unit; **sacrifice / blood** cost; **on-death** triggers | Rally/Warpath are our buff-engine; a **sacrifice** cost (new); we already have onDeath (Royal Vow) + summon (Necromancer) |

---

## Part 2 — Borrowed primitives (build these, each unlocks multiple fusions)

1. **🔴 Double Tap / Retrigger** (Balatro retrigger, StS multi-strike). A hit resolves **twice**.
   Engine: an onAttack sets `ctx.repeat = true`; attackTarget, after resolving, re-runs the
   damage step once (guard against infinite re-trigger). *Unlocks:* 7-7 Hockey Sticks, any
   Berserk/Gambler carry that wants its ramp counted twice.
2. **🔴 Armor Shred** (Underlords Mages, StS). Lower the **target's** Bulwark / reflect for the
   fight. Engine: a debuff on the victim (`u.shred`) read where Bulwark's `ctx.reduce` is applied.
   *Unlocks:* every "anti-tank" fusion; a hard counter to a wall meta.
3. **🟡 Catalyst / Plague** (StS Catalyst). On hit, **double** the poison already on the target
   instead of adding a flat stack. Reuses the existing `ctx.target.poison` field. *Unlocks:*
   9-9 plague bomb, sharpens 6-9 Dinner for Two.
4. **🔴 Taunt / Ace Magnet** (Underlords Knights, TFT frontline). Force nearby enemies to
   **target this unit**. Engine: a targeting override (the inverse of Royal Guard's redirect).
   *Unlocks:* K-K Cowboys, any "protect the carry" frontliner.
5. **🟡 Sacrifice / Blood** (Inscryption). Consume a bench card or adjacent ally at round start
   to power up. Reuses hand/`played` arrays + onRoundStart. *Unlocks:* greedy Ace fusions.
6. **🟡 Interest** (Balatro Golden Joker). While fielded, generate chips at round end scaling
   with your stack. Reuses the round-end economy path (like Highwayman/House). *Unlocks:*
   economy fusions; pairs with Midas.

---

## Part 3 — The fusion catalog

### Pocket pairs (same-rank fusions — the "double down" archetype)

> Poker pairs are the cleanest identities: two of the same ability = one idea taken to its
> extreme. Nicknames are the real ones.

- **2-2 "Ducks / Deuces"** 🟢 — dbl Berserk. *Comeback carry:* starts weak, the ramp is doubled
  AND self-heals a sliver per hit taken (a duck takes to water), so the longer it lives the
  scarier. Keeps Berserk's infinite ramp. *Lineage:* StS Strength scaling.
- **3-3 "Crabs / Treys"** 🟢 — dbl Thorns (pincers). *Reflect fortress:* huge flat reflect that
  ALSO splashes a fraction of the reflect to the enemies adjacent to the attacker — the crab
  pinches everyone crowding it. Keeps the HP-scaled reflect; new = splash-reflect (reuse Cleave's
  radius loop). *Lineage:* Underlords Knights (punish clustering).
- **4-4 "Darth Vader / False AA"** 🟢 — dbl Giant Slayer. *Delusions of grandeur:* punches up vs
  ALL targets (thinks everything's a giant), extra vs true giants. Keeps the conditional bonus.
  (Already in the backlog as False AA — Vader = "the dark side of the fours".)
- **5-5 "Presto / Speed Limit"** 🟢 — dbl Slippery. *Untouchable:* stacked dodge, and each dodge
  grants a burst of attack speed for its next strike (dodge → counter). Keeps dodge; new = the
  speed kick. *Lineage:* Underlords Assassins (elusive).
- **6-6 "Route 66 / Cherries"** 🟢 — dbl Executioner. *Get your kicks:* execute threshold raised,
  and each execute **refunds attack charge** so it can immediately swing again (kill-chain).
  Keeps the true-execute; new = the chain reset. *Lineage:* TFT reset-on-kill carries.
- **7-7 "Hockey Sticks / Sunset Strip"** 🔴 — dbl Gambler + **Double Tap**. *House always wins:*
  every hit rolls twice and fires twice, and full-ramp jackpots double the chip steal. Keeps the
  ramp + steal. *Lineage:* Balatro retrigger.
- **8-8 "Snowmen / Piano Keys"** 🟡 — dbl Bulwark. *Immovable:* massive reduction that **banks
  overkill mitigation into a shield** (block persists), so quiet turns store defense for the big
  hit. Keeps flat reduction; new = the shield bank. *Lineage:* StS "Block persists".
- **9-9 "Phil Hellmuth / Red Balloons"** 🟡 — dbl Poison + **Catalyst**. *Plague bomb:* hits
  DOUBLE the target's existing poison; a poisoned unit that dies detonates, splashing its stacks
  to everyone nearby (plague-jump → plague-blast). Keeps poison + jump. *Lineage:* StS Catalyst,
  Inscryption death-triggers.
- **10-10 "Dimes / TNT"** 🟢 — dbl Rally. *Warlord:* the adjacency aura fires at **radius 2** and
  stacks both suit effects it's touching. Pure enabler/support carry-piece. Keeps the per-suit
  aura. *Lineage:* TFT support units, Monster Train buff-engine.

### Named two-card combos (our rank pairs)

- **6-9 "Dinner for Two / Big Lick"** 🟢 — Poison × Executioner. *Mercy kill:* poison stacks
  **raise the execute bar** (the sicker they are, the higher you can finish from). Keeps both.
  (Backlog; the real nickname is Dinner for Two — perfect.) *Lineage:* StS poison-ignores-block.
- **9-5 "Dolly Parton / 9-to-5"** 🟢 — Poison × Slippery. *Workin' 9 to 5:* applies poison then
  **dodges the retaliation** — a slippery plague-dealer that never trades. On a dodge, refresh the
  poison it's already dealt. Keeps dodge + poison. *Lineage:* Underlords Assassins + StS poison.
- **4-5 "Colt 45 / Jesse James"** 🟢 — Giant Slayer × Slippery. *Outlaw (the "Matador"):* dodge a
  bigger enemy → your next punch-up hit is empowered. Evasive giant-killer. Keeps both. *Lineage:*
  Underlords Assassins leaping the frontline.
- **5-7 "Heinz 57"** 🟢 — Slippery × Gambler. *57 varieties:* a dodgy high-roller; on a dodge the
  Gambler's floor jumps (near-misses make it hotter). Keeps dodge + ramp/steal. *Lineage:* Balatro
  variance stacking.
- **6-8 "Jagr"** 🟢 — Executioner × Bulwark. *Two-way threat:* a tank that also finishes — flat
  reduction keeps it alive while it executes the wounded up front. Keeps both; pure frontline
  carry. *Lineage:* TFT bruiser.
- **8-5 "The '85 Bears"** 🟢 — Bulwark × Slippery. *46 Defense:* every dodge hardens its Bulwark
  for the rest of the fight — a defense that learns. Keeps both. (Backlog; already spec'd.)
- **J-4 "The Robbi / Flat Tire"** 🟢 — Giant Slayer × Jack legendary. *Hero call:* killing a
  bigger-HP target (winning against the odds) **steals chips / banks a permanent buff.** Ties
  punch-up to the economy. (Backlog — named for the real Robbi Jade Lew J4 call.)
- **A-8 "Dead Man's Hand"** 🟡 — Ace × Bulwark. *Aces & Eights:* hard to kill, and on death
  **spawns a spectral token** that fights on (undeath). The user's "make another card" idea.
  *Lineage:* Inscryption/Monster Train on-death.
- **K-9 "Canine / Sawmill"** 🟡 — King legendary × Poison. *Rabid dog:* bites apply heavy poison
  AND slow (attack-speed debuff) — a backline harasser that rots and hobbles. Keeps poison; new =
  the slow. *Lineage:* Underlords Mages (debuff).
- **Q-3 "The Waiter"** 🟢 — Queen legendary × Thorns. *Queen with a tray:* a reflect wall that
  ALSO carries the Queen's utility (e.g. taxes/extinguish) — serves punishment while she works.
  Keeps thorns + the Queen's kit. *Lineage:* TFT utility-tank.
- **A-K "Big Slick"** 🔴 — Ace × King (two legendaries). *Drawing hand:* underwhelming until it
  "connects" (first kill), then **unlocks both legendaries at full power** — a slow-burn late-game
  bomb. Needs per-Ace/King pairing tuning. (Backlog.) *Lineage:* Balatro scaling payoff.
- **A-J "Blackjack / Ajax"** 🔴 — Ace × Jack. *Twenty-one:* a burst assassin — the more chips you
  hold (closer to a "21" threshold), the bigger its opening strike (bust if you overshoot). Ties
  the economy to a combat spike. *Lineage:* Balatro economy → power.
- **K-K "Cowboys / Ace Magnets"** 🔴 — dbl King + **Taunt**. *Ace magnet:* forces enemy fire onto
  itself to shield the backline — the ultimate frontline, and while it's alive your carries are
  safe. *Lineage:* Underlords Knights, TFT frontline.
- **J-J "Jiggities / Fishhooks"** 🟢 — dbl Jack. *Coinflip:* each fight flips 50/50 — double down
  (big buff) or overcard (weaker), the "pocket jacks are agony" meme. (User's list literally names
  J/J "Jiggities" — confirmed real nickname.) *Lineage:* Balatro high-variance jokers.
- **A-A "Bullets / Pocket Rockets"** 🔴 — dbl Ace. *American Airlines:* the apex carry — every hit
  **pierces** (ignores Bulwark AND shields, like a permanent execute-tier penetration) and it
  fields as a bonus over the unit cap. Rare, taxed, backbreaking. *Lineage:* Underlords Assassins
  (crits don't miss) + StS pierce.

---

## Part 4 — Recommended build order

1. **🟢 quick wins, no engine work** (pure hook-reuse, like the last three fusions):
   4-5 Colt 45, 6-8 Jagr, 8-5 '85 Bears, 5-7 Heinz, 2-2 Ducks, 5-5 Presto. Ship a batch.
2. **🟡 one-kit primitives** (each also improves the whole game, not just one card):
   **Catalyst** (→ 9-9, sharper 6-9), **on-death token** (→ A-8), **slow debuff** (→ K-9),
   **shield-bank** (→ 8-8).
3. **🔴 the big primitives** (each unlocks a whole archetype): **Double Tap** (→ 7-7 + future
   carries), **Taunt** (→ K-K + a real frontline role), **Armor Shred** (→ anti-tank tech, keeps a
   wall meta honest).
4. **Legendary-tier** (A-K, A-J, A-A, K-K): save for last — they need per-legendary pairing tuning
   and lean on the 🔴 primitives above.

**Note for later (out of scope now):** TFT **augments** and Balatro **planet cards** both suggest
a future *player-level* upgrade you pick between rounds (not a fusion) — a way to make the chip
economy spend on run-shaping power. Parking it here as a north-star idea.

---

### Sources
- Balatro Wiki — [Jokers](https://balatrogame.fandom.com/wiki/Jokers), [Activation Sequence](https://balatrogame.fandom.com/wiki/Guide:_Activation_Sequence), [Poker Hands](https://balatrogame.fandom.com/wiki/Poker_Hands)
- [Dota Auto Chess synergy list — Esports Tales](https://www.esportstales.com/dota-2/auto-chess-class-and-species-hero-synergy-list) · [Underlords alliances — PCGamesN](https://www.pcgamesn.com/dota-underlords/alliances-tier-list-best-synergies)
- [TFT Augments — LoL Wiki](https://leagueoflegends.fandom.com/wiki/Augment_(Teamfight_Tactics)) · [Fundamentals of TFT — BunnyMuffins](https://bunnymuffins.lol/fundamentals-of-tft/)
- [Slay the Spire 2 Synergies — SpireGenius](https://spiregenius.com/synergies/) · [Relics — Fandom](https://slay-the-spire.fandom.com/wiki/Relics)
- [Monster Train / Inscryption mechanics — Miraheze](https://monstertrain2.miraheze.org/wiki/Inscryption)
- Poker nicknames — [Wikipedia list](https://en.wikipedia.org/wiki/List_of_poker_playing_card_nicknames) · [PokerCoaching 50+](https://pokercoaching.com/blog/top-poker-hand-nicknames/) · [Pokercode](https://www.pokercode.com/blog/poker-hand-nicknames)
