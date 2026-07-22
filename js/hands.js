// hands.js — hand + draw/discard pile rendering.
// Depends on: config, state, cards.

// Fill each hand up to its target size for the round: 2 × round number
// (round 1 = 2, round 2 = 4, round 5 = 10). Phase E: any cards the player held
// from last round COUNT toward that total, so we only draw enough to top the
// hand off. Holding a card therefore replaces a fresh draw — it's never a bonus
// card. Callers must set the starting hand (empty, or the kept-held cards) first.
function drawHands() {
  // Fill up to 2×round, but never past the bench cap (HAND_CAP). Rounds 1-5 are
  // unchanged (2→10); rounds 6-7 hold at HAND_CAP instead of ballooning to 12/14.
  const targetSize = Math.min(roundNumber * 2, HAND_CAP);
  ["player1", "player2"].forEach(function (team) {
    while (hands[team].length < targetSize) {
      hands[team].push(drawCard(team));
    }
  });
  renderHands();
}

// Phase E: count how many of a player's hand cards are marked held.
function heldCount(team) {
  return hands[team].filter(function (c) { return c.held; }).length;
}

// Phase E: on the results screen, clicking a card toggles its "held" mark.
// Bench cap: you may hold up to HAND_CAP cards (in practice you can keep every
// leftover, since held cards always fit within next round's capped hand).
function toggleHold(team, index) {
  const card = hands[team][index];
  if (card.held) {
    card.held = false;                       // un-hold: always allowed
  } else {
    if (heldCount(team) >= HAND_CAP) {       // bench full — must free a slot first
      message.textContent = label(team) + " bench is full (" + HAND_CAP +
        ") — unclick one first.";
      return;
    }
    card.held = true;
  }
  renderHands();
}

// Draw both players' hands onto the page.
function renderHands() {
  if (SIM_MODE) return;   // headless batch sim: skip DOM (see sim.js)
  renderOneHand("player1");
  renderOneHand("player2");
  updateShoeDisplay();
}

// Phase D: refresh each player's draw-pile and discard-pile counts.
function updateShoeDisplay() {
  ["player1", "player2"].forEach(function (team) {
    document.querySelector("#draw-" + team + " .pile-count").textContent = draw[team].length;
    document.querySelector("#discard-" + team + " .pile-count").textContent = discard[team].length;
  });
}

// Draw a single player's hand as a row of little card rectangles.
function renderOneHand(team) {
  const labelEl = document.getElementById("hand-label-" + team);
  const cardsEl = document.getElementById("hand-" + team);
  const hand = hands[team];

  labelEl.textContent = label(team) + " hand (" + hand.length + " cards):";
  cardsEl.innerHTML = "";
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    const card = document.createElement("div");
    card.className = "card" + (c.held ? " held" : "") + (uniqueOf(c) ? " unique" : "") +
      (c.fused ? " fused" : "");
    // Phase E: in hold mode cards are clicked (not dragged) to hold/release.
    card.draggable = !holdMode;
    const cs = SUITS[c.suit];
    card.title = figureTitle(c);
    // A fused card shows BOTH parts (7♠2♦); a normal card its single rank+suit.
    const figInner = c.fused ? fusedGlyphHTML(c, "cardColor") : (rankLabel(c.rank) + cs.symbol);
    card.innerHTML =
      '<div class="cfig" style="color:' + cs.cardColor + '">' + figInner + '</div>' +
      '<div class="cstat">' + c.attack + "/" + c.hp + "</div>" +
      (c.held ? '<div class="chold">📌 held</div>'
              : (cardCannotDiscard(c) ? '<div class="chold">🔒 stuck</div>' : ""));
    // Remember which hand and which card this is when a drag begins.
    const cardIndex = i;
    card.addEventListener("dragstart", function () {
      dragData = { kind: "card", team: team, index: cardIndex };
    });
    // FUSION: a hand card is also a DROP target. Dragging one card onto a partner
    // that forms a FUSABLE_HANDS pair (e.g. 7 onto 2) fuses them into one made
    // hand — the card dropped ONTO keeps its suit. Only during placement, same
    // team, and only for a valid pair (dragover highlights valid targets).
    card.addEventListener("dragover", function (e) {
      if (!placementOpen || holdMode) return;
      if (dragData && dragData.kind === "card" && dragData.team === team &&
          dragData.index !== cardIndex &&
          fusableKeyFor(hands[team][dragData.index], c)) {
        e.preventDefault();               // allow the drop
        card.classList.add("fuse-target");
      }
    });
    card.addEventListener("dragleave", function () { card.classList.remove("fuse-target"); });
    card.addEventListener("drop", function (e) {
      // A UNIT dropped onto a hand card isn't a fusion — let it bubble up to the
      // hand-row drop handler, which returns the unit to the bench. (Bail BEFORE
      // touching dragData so the row handler still sees it.)
      if (dragData && dragData.kind === "unit") return;
      e.preventDefault();
      card.classList.remove("fuse-target");
      if (!placementOpen || holdMode) { dragData = null; return; }
      if (dragData && dragData.kind === "card" && dragData.team === team &&
          dragData.index !== cardIndex) {
        // The dragged card (dragData.index) is dropped ONTO this one (cardIndex),
        // so THIS card is the "onto" whose suit wins.
        if (fuseCards(team, cardIndex, dragData.index)) {
          message.textContent = "🃏 Fused into " +
            FUSABLE_HANDS[hands[team][Math.min(cardIndex, dragData.index)].fusedKey].label +
            " — one body with both cards' abilities.";
          dragData = null;
          renderHands();
          return;
        }
      }
      dragData = null;
    });
    // Phase E: on the results screen, click to toggle holding this card.
    if (holdMode) {
      card.addEventListener("click", function () { toggleHold(team, cardIndex); });
    }
    cardsEl.appendChild(card);
  }
}
