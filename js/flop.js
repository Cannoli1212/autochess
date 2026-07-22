// flop.js — the shared community board (own deck, grow/reveal, display).
// Phase A (Poker Streets): the community is no longer re-dealt every round. It
// GROWS and PERSISTS across the whole game — flop (3) → turn (4th) → river (5th),
// each card staying once dealt (see COMMUNITY_SCHEDULE in config.js).
// NOTE: the `flop` array now holds the WHOLE community board (up to 5 cards by the
// river) — we kept the name `flop` from when the community was only ever 3 cards.
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

// Round Start: TOP UP the community board to this round's target, KEEPING every
// card already dealt. On the flop/turn/river rounds this reveals the new card(s);
// on the "stays" rounds the board is already full, so this does nothing.
function growCommunity() {
  const target = communityTarget(roundNumber);
  while (flop.length < target) {
    if (communityDeck.length === 0) communityDeck = buildShoe();   // reshuffle if drained
    flop.push(communityDeck.pop());
  }
  flopRevealed = true;
  renderFlop();
}

// How many community cards are of a given suit (feeds effectiveSuitCount). Only
// counts cards actually dealt (face-up) — a pending turn/river card isn't in
// `flop` yet, so it correctly doesn't count while it's still hidden.
function flopCount(suit) {
  return flop.filter(function (c) { return c.suit === suit; }).length;
}

// Draw the community board: cards already dealt show FACE-UP (known while you plan
// — poker-authentic), and any not-yet-dealt card for THIS round shows as a
// face-down "?" back (the turn/river reveal that lands at Round Start).
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
