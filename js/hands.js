// hands.js — hand + draw/discard pile rendering.
// Depends on: config, state, cards.

// Fill each hand up to its target size for the round: HAND_SCHEDULE[round]
// (rounds 1..7 → 3,3,4,4,5,5,6). Any leftover cards carried from last round COUNT
// toward that total, so we only draw enough to top the hand off — a carried card
// replaces a fresh draw, never a bonus. Callers must set the starting hand (empty,
// or the carried leftovers) first.
function drawHands() {
  ["player1", "player2"].forEach(function (team) {
    const targetSize = handTarget(team);   // per-team: a joker may widen one hand and not the other
    while (hands[team].length < targetSize) {
      hands[team].push(drawCard(team));
    }
  });
  renderHands();
}

// This round's hand size (with a safe fallback past the last scheduled round), plus
// any joker that widens the hand. `team` is optional: called without one — as the
// sim harnesses do — it returns the plain schedule, so a headless fight can never
// pick up a live player's joker bonus.
function handTarget(team) {
  const base = HAND_SCHEDULE[roundNumber] || HAND_SCHEDULE[HAND_SCHEDULE.length - 1];
  return base + (team ? jokerSum(team, "handBonus") : 0);
}

// Spend one redraw: throw the whole hand away and deal a brand-new one of the same
// size. "Stuck" cards (e.g. the Queen of Spades hot potato) can't be discarded, so
// they stay and the fresh cards fill in around them. Returns false if no redraws
// remain (or, defensively, in SIM_MODE). aiMaybeReroll drives the computer's copy.
function rerollHand(team) {
  if (redrawsLeft[team] <= 0) return false;
  tapSel = null;                 // the selected card is about to be discarded
  const kept = [];
  hands[team].forEach(function (c) {
    if (cardCannotDiscard(c)) { kept.push(c); }   // hot potato can't leave the hand
    else { discard[team].push(c); }
  });
  hands[team] = kept;
  const targetSize = handTarget(team);
  while (hands[team].length < targetSize) hands[team].push(drawCard(team));
  redrawsLeft[team] -= 1;
  renderHands();
  return true;
}

// The computer opponent's redraw policy: a simple, tunable heuristic — reroll while
// the army it would field (its best armySize() cards) is below average rank, up to
// its redraw budget. Rank 8 is the midpoint of 2..14, so a below-8 average hand is
// worse than a random one and worth gambling a reroll on.
function aiMaybeReroll(team) {
  for (let n = 0; n < REDRAWS_PER_ROUND; n++) {
    // Judge the hand on its PLACEABLE cards only — a joker has no attack/hp, so
    // leaving it in would make every comparison NaN and the average meaningless.
    const sorted = hands[team].filter(function (c) { return !cardIsJoker(c); })
      .sort(function (a, b) {
        return (b.attack + b.hp) - (a.attack + a.hp);
      });
    const top = sorted.slice(0, armySize());
    if (top.length === 0) break;
    const avgRank = top.reduce(function (s, c) { return s + c.rank; }, 0) / top.length;
    if (avgRank >= 8) break;                 // decent enough — keep this hand
    if (!rerollHand(team)) break;            // out of redraws
  }
}

// Refresh the human's Redraw button: label shows redraws left, and it's only usable
// while you're still planning AND haven't placed a unit yet (redraw first, then place).
function updateRedrawButton() {
  if (!redrawButton) return;
  const left = redrawsLeft.player1;
  redrawButton.textContent = "🔄 Redraw (" + left + " left)";
  const usable = placementOpen && !inCombat && !isPlaytest() &&
                 left > 0 && countUnits("player1") === 0;
  redrawButton.disabled = !usable;
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
    // The unit this card BECOMES, drawn on the card itself — so choosing what to play is a
    // choice between visible things rather than between two numbers and a suit symbol.
    // unitArtFor takes a card as happily as a unit (both carry suit+rank), so the hand and
    // the board can't disagree about what a 9♠ looks like.
    //
    // Note the priority flips between the two views. On the BOARD the sprite is the figure
    // and the rank/suit is a corner tag; in the HAND the rank/suit stays the headline and
    // the sprite is the supporting cue — because a hand is read as a poker hand first.
    // A JOKER renders as its own thing and stops here: it has no suit to colour by,
    // no rank glyph and no attack/hp line, and unitArtFor would hand it a melee
    // sprite it has no business wearing. It also gets none of the listeners below —
    // it can't be dragged, played or fused, so the only interaction it has is the
    // claim click added in Slice 3.
    if (cardIsJoker(c)) {
      const j = JOKERS[c.jokerKey];
      const pending = (jokerSwapPending === c);
      card.className = "card joker" + (pending ? " pending" : "");
      card.draggable = false;
      card.title = figureTitle(c);
      card.innerHTML =
        '<div class="jfig">' + j.icon + '</div>' +
        '<div class="jname">' + j.name + '</div>';
      // The one interaction a joker has: click to CLAIM it into the joker row. Clicking
      // the card that's already mid-swap cancels instead, so you're never trapped in
      // swap mode with no way out.
      if (team === "player1") {
        card.addEventListener("click", function () {
          if (jokerSwapPending === c) {
            jokerSwapPending = null;
            message.textContent = "Swap cancelled.";
            renderJokers();
            renderHands();
            return;
          }
          tryClaimFromHand("player1", c);
        });
      }
      cardsEl.appendChild(card);
      continue;
    }
    const art = (typeof unitArtFor === "function") ? unitArtFor(c) : null;
    const isTapSel = tapSel && tapSel.kind === "card" && tapSel.card === c;
    // An ACTIVATED joker awaiting a target (The Tailor) turns your own cards into pick
    // targets. Only while it's waiting, and only your hand — otherwise a card is a card.
    const awaitingPick = !!(jokerActionPending && jokerActionPending.team === team &&
                            jokerActionPending.stage === "target" && team === "player1");
    const isJokerTarget = !!(jokerActionPending && jokerActionPending.card === c);
    card.className = "card" + (art ? " has-art" : "") + (c.held ? " held" : "") +
      (uniqueOf(c) ? " unique" : "") + (c.fused ? " fused" : "") +
      (isTapSel ? " tap-sel" : "") +
      (awaitingPick && !c.fused ? " jpick" : "") + (isJokerTarget ? " jtarget" : "");
    // Phase E: in hold mode cards are clicked (not dragged) to hold/release.
    card.draggable = !holdMode;
    const cs = SUITS[c.suit];
    card.title = figureTitle(c);
    // A fused card shows BOTH parts (7♠2♦); a normal card its single rank+suit.
    const figInner = c.fused ? fusedGlyphHTML(c, "cardColor") : (rankLabel(c.rank) + cs.symbol);
    card.innerHTML =
      (art ? '<div class="cart"></div>' : '') +
      '<div class="cfig" style="color:' + cs.cardColor + '">' + figInner + '</div>' +
      '<div class="cstat">' + c.attack + "/" + c.hp + "</div>" +
      (c.held ? '<div class="chold">📌 held</div>'
              : (cardCannotDiscard(c) ? '<div class="chold">🔒 stuck</div>' : ""));
    if (art) applyUnitArt(card.querySelector(".cart"), art);
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
    } else {
      // TAP TO PLACE (see placement.js): tap a card to select it, tap a square to play
      // it. Tapping a second card that FUSES with the selected one performs the fusion
      // — the tapped card is the "onto" whose suit wins, exactly as with a drop.
      card.addEventListener("click", function () {
        if (!placementOpen) return;
        // An armed activated joker (The Tailor) is waiting for a card: this tap picks its
        // target rather than selecting the card to play. Checked FIRST — the activation was
        // started deliberately from the joker row, so it owns the next click.
        if (jokerActionPending && jokerActionPending.team === team &&
            jokerActionPending.stage === "target") {
          chooseJokerTarget(team, c);
          return;
        }
        // A unit is selected: this tap means "put it back on the bench". Do nothing here
        // and let it bubble to the hand-row handler, which owns that action.
        if (tapSel && tapSel.kind === "unit") return;
        if (tapSel && tapSel.kind === "card" && tapSel.card === c) {
          tapClear();                               // tapped the selected card again
          updatePlacementMessage();
          return;
        }
        if (tapSel && tapSel.kind === "card" && tapSel.team === team) {
          const fromIdx = hands[team].indexOf(tapSel.card);
          if (fromIdx !== -1 && fromIdx !== cardIndex &&
              fusableKeyFor(tapSel.card, c)) {
            tapClear(false);
            if (fuseCards(team, cardIndex, fromIdx)) {
              message.textContent = "🃏 Fused into " +
                FUSABLE_HANDS[hands[team][Math.min(cardIndex, fromIdx)].fusedKey].label +
                " — one body with both cards' abilities.";
              renderHands();
              return;
            }
          }
        }
        tapSelectCard(team, c);                     // otherwise: select (or switch to) this card
      });
    }
    cardsEl.appendChild(card);
  }
}
