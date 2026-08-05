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

// A seat's automatic shop turn. Deliberately dumb: buy a pack whenever it can afford
// one and has a slot free, otherwise bank. It doesn't buy rerolls, because tableMatch
// doesn't emulate rerolling at all (a pre-existing gap, see table.js) — so paying for
// one would be spending comps on nothing.
//
// AI packs mint straight into the row rather than offering a choice; there's no one
// to choose. Duplicates are allowed, matching what a player can end up holding.
function aiSeatShop(seat) {
  if (!seat || seat.isHuman) return false;
  const price = Math.max(1, COMPS_PACK_COST - jokerSumOf(seat.jokers, "packDiscount"));
  if (seat.comps < price) return false;
  if ((seat.jokers || []).length >= JOKER_SLOTS) return false;
  const key = pickJokerKey(null, true);      // forSeat: skip what a seat can't use
  if (!key) return false;
  seat.comps -= price;
  seat.jokers.push(makeJokerCard(key));
  return true;
}

// Pay one seat its round comps. Mirrors the live payout in finishRound exactly — income
// for everyone, a bonus for the winner, the loser's consolation, plus whatever its jokers
// add.
//
// `won` and `lost` are BOTH passed rather than inferring one from the other, because a
// DRAW is neither: it pays plain income, exactly as the live round does. Deriving lost
// as !won would quietly pay the consolation to both seats of every draw.
function paySeatComps(seat, won, lost) {
  seat.comps = (seat.comps || 0) + COMPS_INCOME + (won ? COMPS_WIN_BONUS : 0) +
    jokerSumOf(seat.jokers, "compsPerRound") +
    (lost ? jokerSumOf(seat.jokers, "compsOnLoss") : 0);
}

// The COMBAT integration point, called once per team from startRound's onRoundStart
// pass — after synergies have baked, so this multiplies the finished number the way
// the round-start ability hooks do.
//
// Today that's just The High Roller: attack scales with how far your chip stack has
// grown past the opening one, capped at JOKER_ATK_CAP. Reads `chips`, which in table
// mode has already been loaded from the seats, so it sees the real stack.
function applyJokerRoundStart(team) {
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

// What a pack costs. Same floor-at-1 rule as rerollPrice, for the same reason — The
// Loan Shark makes packs cheap, not free.
function packPrice(team) {
  return Math.max(1, COMPS_PACK_COST - jokerSum(team, "packDiscount"));
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

// Buy a pack: PACK_SIZE jokers revealed, you keep one. The jokers are minted here
// rather than drawn from the shoe, so the two you turn down simply never existed —
// there's nothing to hand back, and a pack can't deplete your draw pile.
function buyPack(team) {
  if (!canShop() || packOffer) return false;
  const price = packPrice(team);
  if (comps[team] < price) return false;
  comps[team] -= price;
  const picks = [];
  let pool = JOKER_KEYS.slice();
  for (let i = 0; i < PACK_SIZE && pool.length; i++) {
    // Draw WITHOUT replacement so a pack never shows you the same joker twice —
    // three identical options wouldn't be a choice. Weighted, so a pack is mostly
    // commons with a rare turning up occasionally.
    const key = pickJokerKey(pool);
    picks.push(makeJokerCard(key));
    pool = pool.filter(function (k) { return k !== key; });
  }
  packOffer = { team: team, cards: picks };
  message.textContent = "🎁 Opened a pack — pick one joker to keep.";
  afterShopChange();
  return true;
}

// Take one joker out of the open pack. If the row is full this hands off to the same
// two-step swap a drawn joker uses, so there's one swap flow, not two.
function takeFromPack(idx) {
  if (!packOffer) return;
  const team = packOffer.team;
  const card = packOffer.cards[idx];
  if (!card) return;
  packOffer = null;
  if (jokerSlotsFree(team) > 0) {
    jokers[team].push(card);
    message.textContent = "🃏 Claimed " + JOKERS[card.jokerKey].name + " from the pack.";
  } else {
    // Park it in hand so the existing full-row swap can resolve it, then arm that swap.
    hands[team].push(card);
    jokerSwapPending = card;
    message.textContent = "🃏 Joker row is full (" + JOKER_SLOTS + ") — click one above to " +
      "replace it with " + JOKERS[card.jokerKey].name + ".";
  }
  afterShopChange();
}

// One repaint path for everything a purchase can touch.
function afterShopChange() {
  updateChipInfo();
  updateShopPanel();
  renderJokers();
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
  pBtn.textContent = "🎁 Joker pack (" + COMPS_ICON + pPrice + ")";
  rBtn.disabled = !open || comps.player1 < rPrice;
  pBtn.disabled = !open || comps.player1 < pPrice;
}

// ── Display ───────────────────────────────────────────────────────────────────

// Paint the human's joker row. Hidden entirely while they hold none and none is
// pending, so a player who never draws a joker never sees an empty rail.
function renderJokers() {
  if (SIM_MODE) return;                             // headless: no DOM (see sim.js)
  const row = document.getElementById("jokerRow");
  if (!row) return;
  const held = jokers.player1;
  if (held.length === 0 && !jokerSwapPending && !packOffer) { row.style.display = "none"; return; }
  row.style.display = "block";

  let slots = "";
  for (let i = 0; i < JOKER_SLOTS; i++) {
    const j = held[i];
    if (!j) { slots += '<div class="jslot empty">+</div>'; continue; }
    const meta = JOKERS[j.jokerKey];
    slots +=
      '<div class="jslot filled' + (jokerSwapPending ? " swappable" : "") + '" data-idx="' + i + '" ' +
        'title="' + meta.name + ' — ' + meta.blurb + '">' +
        '<div class="jfig">' + meta.icon + '</div>' +
        '<div class="jname">' + meta.name + '</div>' +
      '</div>';
  }
  // An open pack sits directly under the row, so the choice and the slots it's
  // competing for are read in one glance.
  let pack = "";
  if (packOffer && packOffer.team === "player1") {
    pack = '<div class="pack-title">🎁 Pick one to keep</div><div class="jslot-row">' +
      packOffer.cards.map(function (c, i) {
        const m = JOKERS[c.jokerKey];
        return '<div class="jslot filled pack" data-pick="' + i + '" title="' + m.name + ' — ' + m.blurb + '">' +
          '<div class="jfig">' + m.icon + '</div><div class="jname">' + m.name + '</div></div>';
      }).join("") + '</div>';
  }

  row.innerHTML =
    '<div class="joker-title">🃏 Your jokers (' + held.length + '/' + JOKER_SLOTS + ')' +
      (jokerSwapPending ? ' — click one to replace it' : '') + '</div>' +
    '<div class="jslot-row">' + slots + '</div>' + pack;

  // Listeners are attached fresh each paint (the row is small and rebuilt wholesale),
  // matching how renderOneHand and the damage panel already work.
  row.querySelectorAll(".jslot.filled:not(.pack)").forEach(function (el) {
    el.addEventListener("click", function () {
      trySwapInto("player1", jokers.player1[Number(el.dataset.idx)]);
    });
  });
  row.querySelectorAll(".jslot.pack").forEach(function (el) {
    el.addEventListener("click", function () { takeFromPack(Number(el.dataset.pick)); });
  });
}
