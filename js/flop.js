// flop.js — the shared community flop (own deck, hide/reveal, display).
// Depends on: config, state, cards.

// Fresh community deck (its own shoe, separate from the players').
function initCommunityDeck() {
  communityDeck = buildShoe();
}

// Hide the flop during placement: face-down, empty, and NOT counted yet.
function hideFlop() {
  flop = [];
  flopRevealed = false;
  renderFlop();
}

// Reveal the flop at Round Start: deal FLOP_SIZE community cards, face-up.
function dealFlop() {
  flop = [];
  for (let i = 0; i < FLOP_SIZE; i++) {
    if (communityDeck.length === 0) communityDeck = buildShoe();
    flop.push(communityDeck.pop());
  }
  flopRevealed = true;
  renderFlop();
}

// How many flop cards are of a given suit (0 while hidden, since flop is empty).
function flopCount(suit) {
  return flop.filter(function (c) { return c.suit === suit; }).length;
}

// Draw the flop: face-down "?" backs until it's revealed at Round Start.
function renderFlop() {
  if (SIM_MODE) return;   // headless batch sim: skip DOM (see sim.js)
  const el = document.getElementById("flop-cards");
  el.innerHTML = "";

  if (!flopRevealed) {
    for (let i = 0; i < FLOP_SIZE; i++) {
      const back = document.createElement("div");
      back.className = "card flop-card flop-back";
      back.innerHTML = '<div class="cfig">?</div>';
      el.appendChild(back);
    }
    return;
  }

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
}
