// flop.js — the shared community board (own deck, deal/reveal, display).
// The community is RE-RANDOMIZED every round: nextRound wipes it + reshuffles the
// deck, then growCommunity() deals a fresh random flop/turn/river at Round Start. The
// COMMUNITY_SCHEDULE count still grows across the game — flop (3) → turn (4) → river
// (5) — but the cards themselves are new each round and hidden until Round Start.
// NOTE: the `flop` array holds the WHOLE community board (up to 5 cards) — we kept the
// name `flop` from when the community was only ever 3 cards.
// Depends on: config, state, cards.

// Fresh community deck (its own shoe, separate from the players').
function initCommunityDeck() {
  communityDeck = buildShoe();
}

// How many community cards should be face-up by a given round, read from the
// schedule and clamped at both ends so any round number is safe.
function communityTarget(round) {
  if (round < 1) return 0;
  if (round >= COMMUNITY_SCHEDULE.length) return COMMUNITY_SCHEDULE[COMMUNITY_SCHEDULE.length - 1];
  return COMMUNITY_SCHEDULE[round];
}

// Clear the WHOLE community board (new game / page load). The flop is dealt fresh
// at round 1's Round Start.
function hideFlop() {
  flop = [];
  flopRevealed = false;
  renderFlop();
}

// Round Start: deal this round's community up to its target count. The board was
// wiped at nextRound (and is empty on a fresh game), so this deals a full fresh
// random flop/turn/river — revealing it face-up as the fight begins.
function growCommunity() {
  const target = communityTarget(roundNumber);
  while (flop.length < target) {
    if (communityDeck.length === 0) communityDeck = buildShoe();   // reshuffle if drained
    flop.push(communityDeck.pop());
  }
  // Jokers reshape the board AFTER it's dealt but BEFORE it's revealed, so the cards the
  // players actually see are the final ones — there's no visible "shuffle" of a board that
  // was already on screen. Runs here rather than in gameflow so tableMatch's own
  // growCommunity call (table.js) shapes a headless fight identically.
  applyJokerFlopShaping();
  flopRevealed = true;
  renderFlop();
}

// ── Joker shaping (The Optimist / The Cooler / The Dealer) ────────────────────

// The middle card's rank — the pivot the shift measures against. Sorted, then the middle
// element; on an even board that's the upper-middle, chosen because it's a REAL rank on the
// board rather than an average that might sit between two cards.
function communityMiddleRank() {
  if (flop.length === 0) return 0;
  const ranks = flop.map(function (c) { return c.rank; }).sort(function (a, b) { return a - b; });
  return ranks[Math.floor(ranks.length / 2)];
}

// Shift every community card `dir` ranks toward the middle (dir > 0) or away from it
// (dir < 0). A card already ON the middle rank never moves — it IS the pivot — and the
// 2..14 ends clamp, so an ace pushed further out simply stays an ace.
//
// Cards are rebuilt through makeCardOf so attack/hp re-derive from suit × rank × STAT_SCALE;
// editing `rank` in place would leave a 9's stats on a 10.
//
// SPREADING (dir < 0, The Cooler) doesn't just step outward — it keeps going past any rank
// another community card already holds, to the first free one. Two measurements forced that:
//
//   plain step outward, stacking allowed  → pairs 59%→69%, straights 22%→7%
//   step outward, skip the move on collision → pairs 59%→40%, straights 22%→19%
//   step outward, SLIDE PAST to a free rank  → pairs 59%→38%, straights 22%→9%
//
// The first version manufactured the very pairs the Cooler exists to deny, by slamming
// several cards into the 2 and 14 clamps where they piled up. The second fixed that but did
// nothing to straights, because a blocked card simply never moved. Sliding past does both:
// the board spreads toward the extremes AND no two cards land on the same rank.
//
// Converging (The Optimist) has no such rule — stacking ranks is precisely what it's for.
function shiftCommunityTowardMiddle(dir) {
  const mid = communityMiddleRank();
  const spreading = dir < 0;
  for (let i = 0; i < flop.length; i++) {
    const c = flop[i];
    if (c.rank === mid) continue;
    const toward = (c.rank < mid) ? 1 : -1;          // which way "the middle" is from here
    let rank = Math.max(2, Math.min(14, c.rank + toward * dir));
    if (spreading) {
      // Slide further out (away from the middle) until the rank is free, or we run off the
      // end — in which case this card stays where it is rather than doubling one up.
      const outward = -toward;
      while (rank >= 2 && rank <= 14 && rankOccupiedInCommunity(rank, i)) rank += outward;
      if (rank < 2 || rank > 14) continue;
    }
    if (rank === c.rank) continue;
    flop[i] = makeCardOf(c.suit, rank);
  }
}

// Is `rank` already on the community board, ignoring the card at `skipIdx`? Used only by the
// spreading path, to keep The Cooler from creating the pairs it exists to prevent.
function rankOccupiedInCommunity(rank, skipIdx) {
  for (let i = 0; i < flop.length; i++) {
    if (i !== skipIdx && flop[i].rank === rank) return true;
  }
  return false;
}

// The Dealer: turn ONE community card into `suit`, keeping its rank. Only cards not already
// that suit are candidates — otherwise the call could land on a card that's already right
// and visibly do nothing, which reads as a bug rather than as bad luck. If every card is
// already that suit there's nothing to do, and you already have a five-card flush.
function convertOneCommunityCard(suit) {
  const candidates = [];
  for (let i = 0; i < flop.length; i++) if (flop[i].suit !== suit) candidates.push(i);
  if (candidates.length === 0) return null;
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  const was = flop[idx];
  flop[idx] = makeCardOf(suit, was.rank);
  return { from: was, to: flop[idx] };
}

// Apply every community-shaping joker either player holds. Called from growCommunity, so it
// covers the live round and headless table matches alike.
//
// flopShift is SUMMED across BOTH players because the board is shared: an Optimist facing a
// Cooler nets zero and the board is dealt straight. Two Optimists shift two ranks. That
// summing is the whole reason the Cooler is a counter rather than a mirror.
function applyJokerFlopShaping() {
  if (flop.length === 0) return;
  const dir = jokerSum("player1", "flopShift") + jokerSum("player2", "flopShift");
  if (dir !== 0) shiftCommunityTowardMiddle(dir);
  // Each player's Dealer call resolves independently — both can land in the same round.
  ["player1", "player2"].forEach(function (team) {
    const suit = (typeof jokerSuitPick !== "undefined") ? jokerSuitPick[team] : null;
    if (suit) convertOneCommunityCard(suit);
  });
}

// How many community cards are of a given suit (feeds effectiveSuitCount). Only
// counts cards actually dealt (face-up) — a pending turn/river card isn't in
// `flop` yet, so it correctly doesn't count while it's still hidden.
function flopCount(suit) {
  return flop.filter(function (c) { return c.suit === suit; }).length;
}

// Draw the community board: once this round's cards are dealt (at Round Start) they
// show FACE-UP; while you're still planning the board is empty, so every slot for
// this round shows as a face-down "?" back until the reveal at Round Start.
function renderFlop() {
  if (SIM_MODE) return;   // headless batch sim: skip DOM (see sim.js)
  const el = document.getElementById("flop-cards");
  el.innerHTML = "";

  // Face-up: every community card dealt so far.
  for (let i = 0; i < flop.length; i++) {
    const c = flop[i];
    const cs = SUITS[c.suit];
    const card = document.createElement("div");
    card.className = "card flop-card";
    card.title = rankLabel(c.rank) + cs.symbol + " (community)";
    card.innerHTML =
      '<div class="cfig" style="color:' + cs.cardColor + '">' + rankLabel(c.rank) + cs.symbol + '</div>';
    el.appendChild(card);
  }

  // Face-down: cards this round will reveal at Round Start but hasn't yet (round
  // 1's flop, round 4's turn, round 6's river). None on the "stays" rounds, where
  // the board is already full.
  const pending = Math.max(0, communityTarget(roundNumber) - flop.length);
  for (let i = 0; i < pending; i++) {
    const back = document.createElement("div");
    back.className = "card flop-card flop-back";
    back.innerHTML = '<div class="cfig">?</div>';
    el.appendChild(back);
  }
}
