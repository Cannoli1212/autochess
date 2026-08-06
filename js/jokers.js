// jokers.js — claiming and holding jokers (the player-level upgrade layer).
// Depends on: config, state, cards.
//
// A joker is NOT a unit and never touches the board. It's a player-level modifier you
// CLAIM out of your hand and keep for the rest of the game, capped at JOKER_SLOTS.
// Two ways in: draw one out of the shoe (luck — this file), or buy a pack with comps
// (agency — Slice 4). Effects arrive in Slice 5; today claiming is the whole feature.
//
// This module owns the claim/swap RULES and the row's DOM, deliberately kept out of
// hands.js: a hand is cards you play this round, a joker row is what you keep, and
// merging them would blur exactly the distinction the feature rests on.

// ── Effects ───────────────────────────────────────────────────────────────────

// Sum a numeric field across the jokers `team` holds. THE bus: every joker effect is
// a number that some integration point adds in, so a new joker is a data entry rather
// than new code. Same shape as the existing player-level modifiers teamLootMult and
// handTax (abilities.js), deliberately — one pattern for "sum a field over a
// collection", not two.
//
// Safe before state exists (jokers[team] may be undefined during early boot) and safe
// for a team holding nothing, so callers never need to guard.
function jokerSum(team, field) {
  return jokerSumOf((typeof jokers !== "undefined" && jokers[team]) || [], field);
}

// The same sum over an explicit LIST, so a SEAT's collection can be scored without
// first loading it onto a side. The headless table settle needs exactly this.
function jokerSumOf(list, field) {
  let total = 0;
  for (let i = 0; i < (list || []).length; i++) {
    const entry = JOKERS[list[i].jokerKey];
    if (entry && typeof entry[field] === "number") total += entry[field];
  }
  return total;
}

// ── Picking one ───────────────────────────────────────────────────────────────

// THE joker picker — the shoe, the AI's shop and the pack all come through here, so
// rarity is defined once. Two knobs:
//
//   pool     — keys to choose from (defaults to the whole catalog). The pack passes a
//              shrinking pool to draw without replacement.
//   forSeat  — true when picking for a headless AI seat, which SKIPS aiUseless jokers
//              (a seat can't reroll or work an activation UI, so those are dead comps).
//
// Weighted by `weight`: a rare (1) turns up a quarter as often as a common (4). Missing
// weights default to common so a half-written entry still appears rather than vanishing.
function pickJokerKey(pool, forSeat) {
  const keys = (pool || JOKER_KEYS).filter(function (k) {
    return !(forSeat && JOKERS[k].aiUseless);
  });
  if (keys.length === 0) return null;
  let total = 0;
  for (let i = 0; i < keys.length; i++) total += JOKERS[keys[i]].weight || JOKER_WEIGHT_COMMON;
  let roll = Math.random() * total;
  for (let i = 0; i < keys.length; i++) {
    roll -= JOKERS[keys[i]].weight || JOKER_WEIGHT_COMMON;
    if (roll < 0) return keys[i];
  }
  return keys[keys.length - 1];      // float dust
}

// ── AI seats ──────────────────────────────────────────────────────────────────

// A seat's automatic shop turn. Deliberately dumb: buy a JOKER whenever it can afford one
// and has a slot free, otherwise bank.
//
// A seat buys jokers OUTRIGHT, which is the one place the AI's economy differs from yours.
// You find jokers by drawing (they ride in the shoe); a seat has no shoe to find them in —
// simDraftHand invents cards rather than dealing from a deck — so without a purchase path
// a seat could never hold a joker at all. It buys nothing else: tableMatch doesn't emulate
// rerolling, and a bought CARD would evaporate when the next match drafts a fresh hand.
//
// It mints straight into the row rather than offering a choice; there's no one to choose.
// Duplicates are allowed, matching what a player can end up holding. pickJokerKey's
// forSeat flag skips jokers a headless seat can't benefit from.
function aiSeatShop(seat) {
  if (!seat || seat.isHuman) return false;
  if (seat.comps < COMPS_SEAT_JOKER_COST) return false;
  if ((seat.jokers || []).length >= JOKER_SLOTS) return false;
  const key = pickJokerKey(null, true);      // forSeat: skip what a seat can't use
  if (!key) return false;
  seat.comps -= COMPS_SEAT_JOKER_COST;
  seat.jokers.push(makeJokerCard(key));
  return true;
}

// What the KILL/DEATH trigger jokers pay a collection this round: The Enforcer per enemy
// killed, Dead Man's Hand per unit of its own lost. Shared by the live payout and the seat
// payout so the two can never drift — the tally's two ends are easy to swap by accident.
function jokerTriggerComps(list, kills, deaths) {
  return jokerSumOf(list, "compsPerKill") * (kills || 0) +
         jokerSumOf(list, "compsPerDeath") * (deaths || 0);
}

// Pay one seat its round comps. Mirrors the live payout in finishRound exactly — income
// for everyone, a bonus for the winner, the loser's consolation, and the trigger jokers.
//
// `won` and `lost` are BOTH passed rather than inferring one from the other, because a
// DRAW is neither: it pays plain income, exactly as the live round does. Deriving lost
// as !won would quietly pay the consolation to both seats of every draw. Grouped into an
// options object once the trigger counts joined, rather than growing to five positionals
// where `kills` and `deaths` could silently swap.
function paySeatComps(seat, opts) {
  const o = opts || {};
  seat.comps = (seat.comps || 0) + COMPS_INCOME + (o.won ? COMPS_WIN_BONUS : 0) +
    jokerSumOf(seat.jokers, "compsPerRound") +
    (o.lost ? jokerSumOf(seat.jokers, "compsOnLoss") : 0) +
    jokerTriggerComps(seat.jokers, o.kills, o.deaths);
}

// The COMBAT integration point, called once per team from startRound's onRoundStart
// pass — after synergies have baked, so this multiplies the finished number the way
// the round-start ability hooks do.
//
// Two jokers land here, and the return value is only about the first:
//
//   The High Roller — attack scales with how far your chip stack has grown past the opening
//     one, capped at JOKER_ATK_CAP. Reads `chips`, which in table mode has already been
//     loaded from the seats, so it sees the real stack. Returned so startRound can report it.
//   The Lucky Stiff — stamps each unit with its ONE chance to cheat death, baked here (like
//     every other per-fight number) so it can't be re-rolled mid-fight.
function applyJokerRoundStart(team) {
  // Lucky Stiff first: it has to be stamped whether or not the High Roller is held, so it
  // can't sit behind that joker's early return.
  const saveChance = jokerSum(team, "luckySaveChance");
  const taps = jokerSum(team, "firstHitDoubles");
  for (let i = 0; i < units.length; i++) {
    if (units[i].team !== team) continue;
    // Roll ONCE per unit, now, rather than at the moment of death. Baking the outcome means a
    // unit's fate is fixed for the fight — the same reason Berserk and Bulwark bake their
    // numbers at round start — and it keeps the save from re-rolling every lethal hit.
    units[i].luckySave = (saveChance > 0 && Math.random() < Math.min(1, saveChance)) ? 1 : 0;
    // The Shill's retrigger budget, spent by attackTarget. Baked per fight, so it refills
    // every round rather than being a one-off for the whole game.
    units[i].doubleTaps = taps;
  }

  const perChip = jokerSum(team, "atkPerChip");
  if (perChip <= 0) return 0;
  const over = Math.max(0, (chips[team] || 0) - ATK_BASELINE_CHIPS);
  const mult = 1 + Math.min(over * perChip, JOKER_ATK_CAP);
  if (mult <= 1) return 0;
  for (let i = 0; i < units.length; i++) {
    if (units[i].team === team) units[i].attack = Math.round(units[i].attack * mult);
  }
  return mult;
}

// ── Cards that persist ────────────────────────────────────────────────────────

// THE BAGMAN. Which of `team`'s played cards come back to hand at round end, instead of
// going to the discard pile — the cards whose UNITS were still standing when the fight
// ended. Returns [] for a team without the joker, so nextRound's normal path is untouched.
//
// Reads `units` and it must be called BEFORE nextRound clears the board. Every unit keeps
// a reference to the card it was built from (buildUnit's `card: card`), and the dead are
// already filtered out of `units` when a fight ends — so "survived" needs no bookkeeping
// of its own, it's just who's left.
//
// Self-balancing, which is why it needs no cap: win the fight and you keep your army, lose
// it and your units died, so you keep almost nothing. The reward scales with how well you
// were already doing.
function jokerRetainedCards(team) {
  if (jokerSum(team, "retainSurvivors") <= 0) return [];
  const kept = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    // Only cards this team actually PLAYED this round: a unit summoned mid-fight (the
    // Necromancer's token) has no card in `played` and must not mint one into the hand.
    if (u.team !== team || !u.card) continue;
    if (played[team].indexOf(u.card) === -1) continue;
    kept.push(u.card);
  }
  return kept;
}

// THE CARD SHARP. Grow every card still sitting in `team`'s hand by cardAging. Called once
// per round change, BEFORE drawHands tops the hand up, so a card drawn this round starts
// clean and only earns growth by surviving a round unplayed.
//
// Mutates the card objects in place (they already persist across rounds via auto-carry) and
// stamps `aged` so the growth is inspectable and so a suit recut can restore it. renderOneHand
// already prints attack/hp per card, so the climb is visible with no display work.
//
// The tension is the point: this rewards NOT rerolling, so it plays against the Redraw button
// and against The Valet. A card lost to a reroll takes its growth with it.
function applyJokerCardAging(team) {
  const rate = jokerSum(team, "cardAging");
  if (rate <= 0) return 0;
  let grown = 0;
  hands[team].forEach(function (c) {
    if (cardIsJoker(c)) return;              // no stats to grow
    c.aged = (c.aged || 0) + rate;
    c.attack = Math.round(c.attack * (1 + rate));
    c.hp = Math.round(c.hp * (1 + rate));
    grown++;
  });
  return grown;
}

// ── Permanent growth (The Grinder / The Believer) ─────────────────────────────

// Bank this round's growth for `team`. Called once per round from finishRound, reading
// `played` — which by then is exactly the board that fought, because picking a unit back up
// splices its card out again (placement.js). So each card banks exactly once.
//
// Accumulates only while the joker is HELD, but applyGrowthTo below applies the bank whether
// it still is or not: growth you earned stays yours. Fused cards are skipped — a made hand is
// self-contained (it takes no poker buff either), and its `rank` is only nominally one of its
// two parts, so banking on it would credit a rank it isn't really.
function bankJokerGrowth(team) {
  const perRank = jokerSum(team, "rankGrowthPerPlay");
  const perSuit = jokerSum(team, "suitGrowthPerPlay");
  if (perRank <= 0 && perSuit <= 0) return;
  const cards = played[team] || [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (cardIsJoker(c) || c.fused) continue;
    if (perRank > 0) rankGrowth[team][c.rank] = (rankGrowth[team][c.rank] || 0) + perRank;
    if (perSuit > 0) suitGrowth[team][c.suit] = (suitGrowth[team][c.suit] || 0) + perSuit;
  }
}

// The banked multiplier for one unit — its rank's bank plus its suit's bank. Read by
// applySynergies, which folds it into the same additive bracket as the suit and poker buffs.
function jokerGrowthFor(team, rank, suit) {
  const r = (rankGrowth[team] && rankGrowth[team][rank]) || 0;
  const s = (suitGrowth[team] && suitGrowth[team][suit]) || 0;
  return r + s;
}

// ── Activated jokers ──────────────────────────────────────────────────────────
// Almost every joker is a passive numeric field that some integration point adds in.
// A few need you to CHOOSE — which card, which suit — and a choice is a multi-click
// input mode, not a number. This is that mechanism, and it deliberately copies the
// shape of the two-step joker SWAP directly above: arm a pending action, let the next
// click resolve it. One pattern for "click, then click again", not two.
//
// The Tailor is the only one today. The Dealer (wave 2) is the same flow aimed at the
// community board instead of the hand, which is why this is a mechanism and not a
// special case wired into one joker.
//
// Once per round, always: an activation you could repeat would just recut your whole
// hand, and the choice would be fake.

// Has `team` already fired this joker this round?
function jokerActionUsed(team, key) {
  return jokerUsedThisRound[team].indexOf(key) !== -1;
}

// Can `team` fire this joker right now? Same planning-phase window the shop and the free
// Redraw use (canShop), minus the no-units-placed rule — recutting a card in hand doesn't
// touch the board, so there's no reason to forbid it after you've committed a unit. An
// open pack or a half-finished swap blocks it, so two input modes can't fight.
function jokerActionReady(team, key) {
  if (!JOKERS[key] || !JOKERS[key].activated) return false;
  if (!placementOpen || inCombat) return false;
  if (packOffer || jokerSwapPending) return false;
  return !jokerActionUsed(team, key);
}

// Step 1: the player clicked an activated joker in their row. Arm it.
//
// `stage` is where the activation is up to: "target" means it still needs a hand card
// picked, "suit" means the suit chooser is live. A joker with needsTarget skips straight to
// "suit" — The Dealer acts on the community board, so there's nothing in hand to point at.
function beginJokerAction(team, key) {
  if (!jokerActionReady(team, key)) return false;
  const meta = JOKERS[key];
  jokerActionPending = {
    key: key, team: team, card: null,
    stage: meta.needsTarget ? "target" : "suit",
  };
  message.textContent = meta.icon + " " + meta.name + " — " +
    (meta.needsTarget ? "click a card in your hand to recut" : "call a suit below") +
    ", or click the joker again to cancel.";
  renderJokers();
  renderHands();
  return true;
}

// Step 2 (needsTarget jokers only): the player clicked a hand card while an action was armed.
// Jokers and FUSED cards are refused — a fusion is permanent and makeCardOf can't rebuild
// one, so recutting it would quietly destroy a made hand.
function chooseJokerTarget(team, card) {
  if (!jokerActionPending || jokerActionPending.team !== team) return false;
  if (jokerActionPending.stage !== "target") return false;
  if (cardIsJoker(card)) return false;
  if (card.fused) {
    message.textContent = "🧵 A made hand can't be recut — its suit is part of the fusion.";
    return false;
  }
  jokerActionPending.card = card;
  jokerActionPending.stage = "suit";
  message.textContent = "🧵 Recut " + rankLabel(card.rank) + SUITS[card.suit].symbol +
    " to which suit?";
  renderJokers();
  renderHands();
  return true;
}

// Step 3: the player picked a suit. What that DOES is dispatched on the entry's `action`, so
// a new activated joker is a data entry plus one case here rather than a new flow.
function finishJokerAction(team, suit) {
  if (!jokerActionPending || jokerActionPending.team !== team) return false;
  if (jokerActionPending.stage !== "suit") return false;
  const key = jokerActionPending.key;
  const action = JOKERS[key].action;
  let note;

  if (action === "recutHandCard") {
    // THE TAILOR: rebuild the card in that suit at the same rank, in place so it keeps its
    // position in the hand. makeCardOf re-derives attack/hp from suit × rank × STAT_SCALE,
    // which is the whole reason to go through it rather than editing `suit` — a ♠ and a ♥ of
    // the same rank are different bodies. The fresh card starts UNAGED, so any Card Sharp
    // growth is re-applied; without that, holding both jokers would have one undo the other.
    const card = jokerActionPending.card;
    if (!card) return false;
    const idx = hands[team].indexOf(card);
    if (idx === -1) { cancelJokerAction(); return false; }
    if (card.suit === suit) {
      message.textContent = "🧵 That's already " + SUITS[suit].symbol + " — pick another suit.";
      return false;                            // not a whiff: keep the chooser open
    }
    const recut = makeCardOf(suit, card.rank);
    if (card.aged) {
      recut.aged = card.aged;
      recut.attack = Math.round(recut.attack * (1 + card.aged));
      recut.hp = Math.round(recut.hp * (1 + card.aged));
    }
    hands[team][idx] = recut;
    note = "🧵 Recut " + rankLabel(card.rank) + SUITS[card.suit].symbol + " into " +
      rankLabel(recut.rank) + SUITS[suit].symbol + " (" + recut.attack + "/" + recut.hp + ").";

  } else if (action === "callCommunitySuit") {
    // THE DEALER: record the call. It can't resolve now — the community board isn't dealt
    // until Round Start (growCommunity, after placement locks), so this is a standing order
    // that applyJokerFlopShaping reads then. Say so plainly, or a player clicks a suit,
    // sees nothing change, and reasonably concludes it's broken.
    jokerSuitPick[team] = suit;
    note = "🎴 Called " + SUITS[suit].symbol + " — one community card will turn " +
      SUITS[suit].symbol + " at Round Start.";

  } else {
    return false;                              // unknown action: refuse rather than half-fire
  }

  jokerUsedThisRound[team].push(key);
  jokerActionPending = null;
  message.textContent = note;
  renderJokers();
  renderHands();
  return true;
}

// Back out of an armed action without spending it.
function cancelJokerAction() {
  jokerActionPending = null;
  renderJokers();
  renderHands();
}

// ── Rules ─────────────────────────────────────────────────────────────────────

// How many free slots a player has left.
function jokerSlotsFree(team) {
  return JOKER_SLOTS - jokers[team].length;
}

// Does this player already hold a joker of this kind? Duplicates are allowed and they
// STACK — every effect is a summed numeric field (see jokerSum) — so the UI just says
// so rather than warning you off. A pack can't hand you one (it draws without
// replacement); two copies only happen if the shoe deals you the same joker twice.
function holdsJoker(team, key) {
  return jokers[team].some(function (j) { return j.jokerKey === key; });
}

// Claim a joker card out of `team`'s hand. Returns true if it moved.
//
// A claimed joker leaves the SHOE permanently — it does not go to discard — because
// "pick it up and have it for the rest of the game" is the whole point. A joker
// swapped OUT does go to discard, so it can come round again on a reshuffle.
function claimJoker(team, card) {
  const idx = hands[team].indexOf(card);
  if (idx === -1 || !cardIsJoker(card)) return false;
  if (jokerSlotsFree(team) <= 0) return false;      // caller handles the full case
  hands[team].splice(idx, 1);
  jokers[team].push(card);
  return true;
}

// Swap a held joker for one in hand: the held one is discarded (back into the shoe),
// the hand one takes its slot. Used when the row is full.
function swapJoker(team, handCard, heldCard) {
  const hIdx = hands[team].indexOf(handCard);
  const jIdx = jokers[team].indexOf(heldCard);
  if (hIdx === -1 || jIdx === -1) return false;
  hands[team].splice(hIdx, 1);
  jokers[team][jIdx] = handCard;
  discard[team].push(heldCard);                     // the dropped joker returns to the shoe
  return true;
}

// The human clicked a joker in their hand. Either it fits (claim it) or the row is
// full and we enter the two-step swap, which the row's own click handler completes.
function tryClaimFromHand(team, card) {
  if (!placementOpen || inCombat) return;
  if (jokerSlotsFree(team) > 0) {
    const dupe = holdsJoker(team, card.jokerKey);
    claimJoker(team, card);
    jokerSwapPending = null;
    message.textContent = "🃏 Claimed " + JOKERS[card.jokerKey].name + "." +
      (dupe ? "  (A second copy — its effect stacks.)" : "");
  } else {
    jokerSwapPending = card;
    message.textContent = "🃏 Joker row is full (" + JOKER_SLOTS + ") — click one above to replace it, " +
      "or click " + JOKERS[card.jokerKey].name + " again to cancel.";
  }
  renderJokers();
  renderHands();
}

// The human clicked one of their HELD jokers. Only meaningful mid-swap.
function trySwapInto(team, heldCard) {
  if (!placementOpen || inCombat || !jokerSwapPending) return;
  const incoming = jokerSwapPending;
  if (swapJoker(team, incoming, heldCard)) {
    message.textContent = "🃏 Swapped " + JOKERS[heldCard.jokerKey].name + " out for " +
      JOKERS[incoming.jokerKey].name + ".";
  }
  jokerSwapPending = null;
  renderJokers();
  renderHands();
}

// ── The shop ──────────────────────────────────────────────────────────────────
// Comps buy two things, the two ends of one loop: rerolls FISH the shoe for a joker,
// a pack BUYS one outright. Both are gated on the same predicate the free Redraw
// button already uses (see canShop) rather than a new between-rounds phase — there's
// no extra state machine here, just buttons that turn on during placement.

// What the next bought reroll costs this round. Escalates, then holds at the last price.
// The Valet shaves a comp off, but never to free — a zero-cost reroll would make the
// escalating price (and the shoe's rarity) stop meaning anything.
function rerollPrice(team) {
  const n = rerollsBought[team];
  const base = COMPS_REROLL_COSTS[Math.min(n, COMPS_REROLL_COSTS.length - 1)];
  return Math.max(1, base - jokerSum(team, "rerollDiscount"));
}

// What a CARD pack costs. Same floor-at-1 rule as rerollPrice, for the same reason — The
// Loan Shark makes packs cheap, not free.
function packPrice(team) {
  return Math.max(1, COMPS_CARD_PACK_COST - jokerSum(team, "packDiscount"));
}

// The shop is open exactly when the Redraw button is usable: during your own planning,
// not mid-fight, not in the playtest sandbox, and before you've committed a unit to the
// board. Buying a reroll after placing would be a different (and much stronger) game.
function canShop() {
  return placementOpen && !inCombat && !isPlaytest() && countUnits("player1") === 0;
}

// Buy one extra whole-hand reroll. It just tops up redrawsLeft, so rerollHand and the
// existing Redraw button do the actual work untouched.
function buyReroll(team) {
  if (!canShop() || packOffer) return false;
  const price = rerollPrice(team);
  if (comps[team] < price) return false;
  comps[team] -= price;
  rerollsBought[team] += 1;
  redrawsLeft[team] += 1;
  message.textContent = "🔄 Bought a redraw for " + COMPS_ICON + price +
    ".  Next one costs " + rerollPrice(team) + ".";
  afterShopChange();
  return true;
}

// Deal a card pack's contents: CARD_PACK_SIZE cards with NO repeated rank and NO repeated
// suit, so the offer is always a choice between different shapes rather than three
// near-identical cards. Pulled out of buyCardPack so it can be tested on its own.
//
// Cards are MINTED (makeCardOf) rather than dealt off the draw pile, so the two you turn
// down never existed and a pack can't thin the shoe you're about to draw from.
function dealCardPack() {
  const ranksLeft = [];
  for (let r = 2; r <= 14; r++) ranksLeft.push(r);
  const suitsLeft = SUIT_NAMES.slice();
  const picks = [];
  // Cap the loop at whichever pool runs out first — with 4 suits, a pack bigger than 4
  // couldn't keep suits unique, so the guarantee sets the ceiling rather than a magic number.
  const n = Math.min(CARD_PACK_SIZE, ranksLeft.length, suitsLeft.length);
  for (let i = 0; i < n; i++) {
    const rank = ranksLeft.splice(Math.floor(Math.random() * ranksLeft.length), 1)[0];
    const suit = suitsLeft.splice(Math.floor(Math.random() * suitsLeft.length), 1)[0];
    picks.push(makeCardOf(suit, rank));
  }
  return picks;
}

// Buy a CARD pack: CARD_PACK_SIZE cards revealed, you keep one, and it goes straight into
// your hand so it's playable this round. Jokers are NOT sold — they ride in the shoe and
// you find them by drawing (Riley, 2026-08-05), which is what keeps a redraw a hunt.
function buyCardPack(team) {
  if (!canShop() || packOffer) return false;
  const price = packPrice(team);
  if (comps[team] < price) return false;
  // Refuse rather than sell a card with nowhere to go — the bench has a ceiling, and
  // taking the comps for a card that gets discarded on arrival would be a swindle.
  if (hands[team].length >= HAND_CAP) {
    message.textContent = "🃏 Your hand is full (" + HAND_CAP + ") — no room for a new card.";
    return false;
  }
  comps[team] -= price;
  packOffer = { team: team, cards: dealCardPack() };
  message.textContent = "🃏 Opened a card pack — pick one card to keep.";
  afterShopChange();
  return true;
}

// Take one card out of the open pack. It goes to the HAND (not the shoe), so it's usable
// immediately; the two you didn't pick simply never existed, so there's nothing to discard.
function takeFromPack(idx) {
  if (!packOffer) return;
  const team = packOffer.team;
  const card = packOffer.cards[idx];
  if (!card) return;
  packOffer = null;
  if (hands[team].length >= HAND_CAP) {
    // Only reachable if the hand filled up between opening and picking. Say so rather
    // than silently dropping the card the player just paid for.
    message.textContent = "🃏 Hand is full (" + HAND_CAP + ") — the pack was lost.";
  } else {
    hands[team].push(card);
    message.textContent = "🃏 Kept " + rankLabel(card.rank) + SUITS[card.suit].symbol +
      " (" + card.attack + "/" + card.hp + ") — it's in your hand.";
  }
  afterShopChange();
}

// One repaint path for everything a purchase can touch.
function afterShopChange() {
  updateChipInfo();
  updateShopPanel();
  renderJokers();
  renderPackOffer();
  renderHands();
  updateRedrawButton();
}

// Refresh the two shop buttons: live prices, and disabled when you can't afford or
// can't act. The labels carry the price so the cost is never a surprise click.
function updateShopPanel() {
  const rBtn = document.getElementById("buyRerollButton");
  const pBtn = document.getElementById("buyPackButton");
  if (!rBtn || !pBtn) return;
  const open = canShop() && !packOffer;
  const rPrice = rerollPrice("player1");
  const pPrice = packPrice("player1");
  rBtn.textContent = "🔄 +1 Redraw (" + COMPS_ICON + rPrice + ")";
  pBtn.textContent = "🃏 Card pack (" + COMPS_ICON + pPrice + ")";
  rBtn.disabled = !open || comps.player1 < rPrice;
  // A full bench can't take the card, so the button says so by being off rather than
  // taking the comps and then refusing.
  pBtn.disabled = !open || comps.player1 < pPrice || hands.player1.length >= HAND_CAP;
}

// ── Display ───────────────────────────────────────────────────────────────────

// Paint the human's joker row. Hidden entirely while they hold none and none is
// pending, so a player who never draws a joker never sees an empty rail.
function renderJokers() {
  if (SIM_MODE) return;                             // headless: no DOM (see sim.js)
  const row = document.getElementById("jokerRow");
  if (!row) return;
  const held = jokers.player1;
  if (held.length === 0 && !jokerSwapPending) { row.style.display = "none"; return; }
  row.style.display = "block";

  let slots = "";
  for (let i = 0; i < JOKER_SLOTS; i++) {
    const j = held[i];
    if (!j) { slots += '<div class="jslot empty">+</div>'; continue; }
    const meta = JOKERS[j.jokerKey];
    // An ACTIVATED joker reads its own state on the slot: ready to fire, currently armed,
    // or spent for this round. Passive jokers get none of these classes and look as before.
    const armed = !!(jokerActionPending && jokerActionPending.key === j.jokerKey);
    const spent = meta.activated && jokerActionUsed("player1", j.jokerKey);
    const ready = meta.activated && jokerActionReady("player1", j.jokerKey);
    slots +=
      '<div class="jslot filled' + (jokerSwapPending ? " swappable" : "") +
        (armed ? " armed" : "") + (spent ? " spent" : "") + (ready ? " ready" : "") +
        '" data-idx="' + i + '" ' +
        'title="' + meta.name + ' — ' + meta.blurb +
          (meta.activated ? (spent ? "  (used this round)" : "  (click to use)") : "") + '">' +
        '<div class="jfig">' + meta.icon + '</div>' +
        '<div class="jname">' + meta.name + '</div>' +
        (meta.activated ? '<div class="juse">' + (spent ? "✓ used" : "● use") + '</div>' : '') +
      '</div>';
  }

  // The suit chooser, shown once an activated joker reaches its "suit" stage. Built here
  // rather than as fixed markup because the whole row is already rebuilt wholesale on every
  // paint, and this way it can't get out of sync with the pending action.
  //
  // A card-targeting joker dims the suit the card already is (nothing to do); a
  // board-targeting one has no such suit, so all four are live.
  let chooser = "";
  if (jokerActionPending && jokerActionPending.stage === "suit") {
    const c = jokerActionPending.card;
    const prompt = c
      ? "🧵 Recut " + rankLabel(c.rank) + SUITS[c.suit].symbol + " — pick a suit"
      : JOKERS[jokerActionPending.key].icon + " Call a suit for the community board";
    chooser = '<div class="pack-title">' + prompt + '</div><div class="jslot-row">' +
      SUIT_NAMES.map(function (s) {
        const same = !!(c && s === c.suit);
        return '<div class="suitpick' + (same ? " same" : "") + '" data-suit="' + s + '" ' +
          'title="' + (same ? "already this suit" : "choose " + s) + '" ' +
          'style="color:' + SUITS[s].cardColor + '">' + SUITS[s].symbol + '</div>';
      }).join("") + '</div>';
  }

  // A Dealer call already placed this round: show WHAT was called, since it doesn't resolve
  // until Round Start and there'd otherwise be nothing on screen to confirm it landed.
  let called = "";
  if (jokerSuitPick.player1) {
    called = '<div class="joker-called">🎴 Called <span style="color:' +
      SUITS[jokerSuitPick.player1].cardColor + '">' + SUITS[jokerSuitPick.player1].symbol +
      '</span> — resolves at Round Start</div>';
  }

  // The title carries whatever the row is waiting for, so the prompt is where you're looking.
  let hint = "";
  if (jokerSwapPending) hint = " — click one to replace it";
  else if (jokerActionPending && jokerActionPending.stage === "target") hint = " — now click a card in your hand";
  else if (jokerActionPending) hint = " — pick a suit below";

  row.innerHTML =
    '<div class="joker-title">🃏 Your jokers (' + held.length + '/' + JOKER_SLOTS + ')' +
      hint + '</div>' +
    '<div class="jslot-row">' + slots + '</div>' + chooser + called;

  // Listeners are attached fresh each paint (the row is small and rebuilt wholesale),
  // matching how renderOneHand and the damage panel already work.
  row.querySelectorAll(".jslot.filled:not(.pack)").forEach(function (el) {
    el.addEventListener("click", function () {
      const card = jokers.player1[Number(el.dataset.idx)];
      if (!card) return;
      // A click on a held joker means one of three things, in this order: finish a swap
      // (that mode was entered from the hand and must win, or you'd be trapped in it),
      // cancel an activation already armed on THIS joker, or start one.
      if (jokerSwapPending) { trySwapInto("player1", card); return; }
      if (jokerActionPending && jokerActionPending.key === card.jokerKey) {
        message.textContent = JOKERS[card.jokerKey].name + " — cancelled.";
        cancelJokerAction();
        return;
      }
      const meta = JOKERS[card.jokerKey];
      if (!meta.activated) return;                    // passive joker: nothing to click
      if (jokerActionUsed("player1", card.jokerKey)) {
        message.textContent = meta.icon + " " + meta.name + " has already been used this round.";
        return;
      }
      if (!beginJokerAction("player1", card.jokerKey)) {
        message.textContent = meta.icon + " " + meta.name + " can't be used right now.";
      }
    });
  });
  row.querySelectorAll(".suitpick").forEach(function (el) {
    el.addEventListener("click", function () { finishJokerAction("player1", el.dataset.suit); });
  });
}

// Paint an open CARD pack in its own row. Deliberately NOT part of renderJokers: the joker
// row is what you KEEP for the rest of the game, and a card pack is a one-off purchase
// going into this round's hand — merging them would blur exactly that distinction.
//
// The cards are drawn as real card faces (same .card markup and sprite as the hand) rather
// than as abstract slots, because the whole value of a pack is judging actual cards — you
// need to see the suit, the rank and the stat line to choose.
function renderPackOffer() {
  if (SIM_MODE) return;                             // headless: no DOM (see sim.js)
  const row = document.getElementById("packRow");
  if (!row) return;
  if (!packOffer || packOffer.team !== "player1") { row.style.display = "none"; return; }
  row.style.display = "block";

  const faces = packOffer.cards.map(function (c, i) {
    const cs = SUITS[c.suit];
    return '<div class="card packcard" data-pick="' + i + '" title="' + figureTitle(c) + '">' +
      '<div class="cart"></div>' +
      '<div class="cfig" style="color:' + cs.cardColor + '">' + rankLabel(c.rank) + cs.symbol + '</div>' +
      '<div class="cstat">' + c.attack + "/" + c.hp + '</div></div>';
  }).join("");

  row.innerHTML = '<div class="pack-title">🃏 Card pack — pick one to keep</div>' +
    '<div class="packcard-row">' + faces + '</div>';

  // Sprites are applied after the markup exists, the same way renderOneHand does it, so
  // the pack and the hand can't disagree about what a 9♠ looks like.
  row.querySelectorAll(".packcard").forEach(function (el) {
    const c = packOffer.cards[Number(el.dataset.pick)];
    const art = (typeof unitArtFor === "function") ? unitArtFor(c) : null;
    if (art) { el.classList.add("has-art"); applyUnitArt(el.querySelector(".cart"), art); }
    el.addEventListener("click", function () { takeFromPack(Number(el.dataset.pick)); });
  });
}
