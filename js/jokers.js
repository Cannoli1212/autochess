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

// ── Rules ─────────────────────────────────────────────────────────────────────

// How many free slots a player has left.
function jokerSlotsFree(team) {
  return JOKER_SLOTS - jokers[team].length;
}

// Does this player already hold a joker of this kind? Duplicates are allowed in the
// shoe but pointless to hold twice, so the UI warns rather than forbids.
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
      (dupe ? "  (You already hold one — a second copy does nothing yet.)" : "");
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
    slots +=
      '<div class="jslot filled' + (jokerSwapPending ? " swappable" : "") + '" data-idx="' + i + '" ' +
        'title="' + meta.name + ' — ' + meta.blurb + '">' +
        '<div class="jfig">' + meta.icon + '</div>' +
        '<div class="jname">' + meta.name + '</div>' +
      '</div>';
  }
  row.innerHTML =
    '<div class="joker-title">🃏 Your jokers (' + held.length + '/' + JOKER_SLOTS + ')' +
      (jokerSwapPending ? ' — click one to replace it' : '') + '</div>' +
    '<div class="jslot-row">' + slots + '</div>';

  // Listeners are attached fresh each paint (the row is small and rebuilt wholesale),
  // matching how renderOneHand and the damage panel already work.
  row.querySelectorAll(".jslot.filled").forEach(function (el) {
    el.addEventListener("click", function () {
      trySwapInto("player1", jokers.player1[Number(el.dataset.idx)]);
    });
  });
}
