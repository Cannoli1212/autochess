// ── THE JOKER OFFER ──────────────────────────────────────────────────────────
// A joker used to arrive in your hand in total silence: a cyan card among the normal
// ones, unplayable, taking up a slot, with nothing to tell you it was there or what it
// did. You had to already know to click it. This makes the draw an EVENT — the joker
// announces itself, explains itself, and you say yes or no.
//
// THREE THINGS CHANGE ABOUT A DRAWN JOKER:
//   1. It pops. A panel over the board, not a line in the message bar.
//   2. You can say NO. Until now the only ways out were claiming it or flushing your
//      whole hand with a redraw — there was no decline at all.
//   3. It costs you nothing to look. Whichever way you answer, the joker LEAVES your
//      hand and one replacement card is drawn, so the hand is back to its schedule size.
//      Drawing a joker is no longer quietly a card down.
//
// SHAPE OF THE CODE. Modelled on js/flopreveal.js, which is the game's only other
// full-screen stage, for the reasons set out in its header: a fixed element on
// document.body (the fx layer is clipped inside #board and could never hold this), a
// panel centred on the BOARD rather than the viewport, element.animate() rather than
// CSS classes so an animation can't get stuck, and a CALLBACK continuation rather than
// a promise, because there is no async anywhere in this codebase.
//
// ONE DELIBERATE DIFFERENCE FROM flopreveal: its dim is a SKIP target — click anywhere
// to hurry the show along. This dim swallows clicks instead. It is the first genuinely
// blocking prompt in the game, and a choice you can dismiss by clicking next to it is
// not a choice.

let jokerStageEl = null;

// ── The offer chain ──────────────────────────────────────────────────────────
// Called after anything that puts cards in a hand. Finds the first unoffered joker and
// opens the panel on it; does nothing at all in every other case.
//
// It calls ITSELF from the resolution callback, and that recursion is the point: a
// redraw deals a whole fresh hand and can turn up two jokers at once, and the single
// replacement card drawn after an offer can itself be a joker. Chaining through the
// callback shows them one at a time, in order, with no loop and no possibility of two
// stages on screen at once.
function maybeOfferJoker(team) {
  if (SIM_MODE) return;                  // headless: no DOM, no player to ask
  if (team !== "player1") return;        // the AI has no popup to work — see the note at the foot
  if (jokerOffer) return;                // one at a time; the chain will come back for the rest

  let card = null;
  for (let i = 0; i < hands[team].length; i++) {
    if (cardIsJoker(hands[team][i])) { card = hands[team][i]; break; }
  }
  if (!card) return;

  offerJoker(team, card, function () {
    // Whatever was decided, the joker is out of the hand — put a real card in its place
    // so the offer never costs a slot. This does NOT touch redrawsLeft: the redraw budget
    // is the player's resource, and spending it to be shown a joker would be a fine.
    topUpHand(team);
    afterShopChange();                   // the one existing path that repaints everything
    maybeOfferJoker(team);               // ...and the replacement might be a joker too
  });
}

// Open the stage on one card. `done` fires exactly once, on every path.
function offerJoker(team, card, done) {
  jokerOffer = { team: team, card: card, stage: "choose", done: done };
  buildJokerStage();
}

// Resolve and tear down. Every button below funnels through here, so the teardown and
// the continuation can't be forgotten on one branch.
function jokerOfferResolve() {
  const offer = jokerOffer;
  if (!offer) return;
  jokerOffer = null;
  teardownJokerStage();
  if (offer.done) offer.done();
}

// Tear the stage down WITHOUT firing the continuation — for a round change or a new
// game, where the hand this offer was about is being replaced anyway. The twin of
// flopRevealAbort, and called from the same two places.
function jokerOfferAbort() {
  jokerOffer = null;
  teardownJokerStage();
}

function teardownJokerStage() {
  if (jokerStageEl) { jokerStageEl.remove(); jokerStageEl = null; }
}

// ── The two answers ──────────────────────────────────────────────────────────
function jokerOfferAccept() {
  if (!jokerOffer) return;
  const team = jokerOffer.team, card = jokerOffer.card;
  // Row full? Don't dead-end and don't kick the decision out to the message bar — show
  // the three you're holding and let the swap happen right here, inside the same panel.
  if (jokerSlotsFree(team) <= 0) {
    jokerOffer.stage = "replace";
    paintJokerPanel();
    return;
  }
  const dupe = holdsJoker(team, card.jokerKey);
  // claimJoker refuses if the card isn't in the hand any more. That shouldn't be reachable
  // while the stage is up — it blocks every other input — but report what actually
  // happened rather than announcing a claim that didn't occur. Either way the offer
  // resolves: leaving the stage up with no way out would be strictly worse.
  if (claimJoker(team, card)) {
    message.textContent = "🃏 Claimed " + JOKERS[card.jokerKey].name + "." +
      (dupe ? "  (A second copy — its effect stacks.)" : "");
  } else {
    message.textContent = "🃏 " + JOKERS[card.jokerKey].name + " got away.";
  }
  jokerOfferResolve();
}

function jokerOfferDecline() {
  if (!jokerOffer) return;
  const team = jokerOffer.team, card = jokerOffer.card;
  const idx = hands[team].indexOf(card);
  // Declined jokers go to DISCARD rather than out of the game, which is the same place a
  // swapped-out one goes (claimJoker's header explains the asymmetry): you passed on it
  // this time, and it can come round again on a reshuffle.
  if (idx !== -1) {
    hands[team].splice(idx, 1);
    discard[team].push(card);
  }
  message.textContent = "🃏 Passed on " + JOKERS[card.jokerKey].name + ".";
  jokerOfferResolve();
}

// Picked which held joker the new one takes over from.
function jokerOfferReplace(heldIndex) {
  if (!jokerOffer) return;
  const team = jokerOffer.team, card = jokerOffer.card;
  const held = jokers[team][heldIndex];
  if (!held) return;
  if (swapJoker(team, card, held)) {
    message.textContent = "🃏 Swapped " + JOKERS[held.jokerKey].name + " out for " +
      JOKERS[card.jokerKey].name + ".";
  }
  jokerOfferResolve();
}

// ── The stage ────────────────────────────────────────────────────────────────
function buildJokerStage() {
  teardownJokerStage();                          // never two stages at once
  const boardEl = document.getElementById("board");

  const stage = document.createElement("div");
  stage.id = "jokerStage";

  const dim = document.createElement("div");
  dim.className = "jstage-dim";
  // Swallow the click rather than acting on it. No skip: the whole point is the choice.
  dim.addEventListener("click", function (e) { e.stopPropagation(); });
  stage.appendChild(dim);

  const panel = document.createElement("div");
  panel.className = "jstage-panel";
  // Centred on the BOARD, not the viewport — same reasoning as buildFlopStage: on a wide
  // window the board sits well off centre, and the board is what you're looking at.
  if (boardEl) {
    const rect = boardEl.getBoundingClientRect();
    panel.style.left = Math.round(rect.left + rect.width / 2) + "px";
    panel.style.top  = Math.round(rect.top + rect.height / 2) + "px";
  } else {
    panel.style.left = "50%";
    panel.style.top  = "50%";
  }
  stage.appendChild(panel);

  document.body.appendChild(stage);
  jokerStageEl = stage;
  paintJokerPanel();

  // The pop. Overshoot at 0.72 and settle — the same shape (and the same reasoning) as
  // flopDealCard's thud: a card that lands exactly on its mark reads as a slide, and a
  // card that overshoots and settles reads as an arrival.
  panel.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.55)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.06)", opacity: 1, offset: 0.72 },
      { transform: "translate(-50%, -50%) scale(1)",    opacity: 1 },
    ],
    { duration: 380, easing: "cubic-bezier(.2,.8,.3,1)" }
  );
}

// Rebuilt wholesale on every state change, listeners reattached — the same discipline as
// renderJokers and renderPackOffer, so the panel can't disagree with jokerOffer.stage.
function paintJokerPanel() {
  if (!jokerStageEl || !jokerOffer) return;
  const panel = jokerStageEl.querySelector(".jstage-panel");
  const meta = JOKERS[jokerOffer.card.jokerKey];

  let h =
    '<div class="jstage-tag">A joker turned up in your hand</div>' +
    '<div class="jstage-icon">' + meta.icon + "</div>" +
    '<div class="jstage-name">' + meta.name + "</div>" +
    '<div class="jstage-blurb">' + meta.blurb + "</div>";

  if (jokerOffer.stage === "replace") {
    h += '<div class="jstage-ask">Your joker row is full — pick one to replace</div>' +
         '<div class="jstage-slots">';
    for (let i = 0; i < jokers[jokerOffer.team].length; i++) {
      const m = JOKERS[jokers[jokerOffer.team][i].jokerKey];
      h += '<div class="jslot filled swappable" data-swap="' + i + '" title="' +
             m.name + " — " + m.blurb + '">' +
             '<div class="jfig">' + m.icon + "</div>" +
             '<div class="jname">' + m.name + "</div>" +
           "</div>";
    }
    h += "</div>" +
         '<div class="jstage-buttons">' +
           '<button type="button" class="jstage-btn back" data-act="back">← Back</button>' +
         "</div>";
  } else {
    // Both answers cost the same: the joker leaves and a fresh card takes its slot. Saying
    // so on the panel is what makes declining feel like a choice rather than a loss.
    h += '<div class="jstage-buttons">' +
           '<button type="button" class="jstage-btn yes" data-act="accept">Take it</button>' +
           '<button type="button" class="jstage-btn no"  data-act="decline">Pass</button>' +
         "</div>" +
         '<div class="jstage-foot">Either way you draw a replacement card — this costs you ' +
         "no hand slot and no redraw.</div>";
  }
  panel.innerHTML = h;

  panel.querySelectorAll("[data-act]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const act = btn.dataset.act;
      if (act === "accept") jokerOfferAccept();
      else if (act === "decline") jokerOfferDecline();
      else if (act === "back") { jokerOffer.stage = "choose"; paintJokerPanel(); }
    });
  });
  panel.querySelectorAll("[data-swap]").forEach(function (el) {
    el.addEventListener("click", function () {
      jokerOfferReplace(Number(el.dataset.swap));
    });
  });
}

// ── Why there is no AI counterpart ───────────────────────────────────────────
// Headless seats never draw from a shoe (simDraftHand invents their hands), so an offer
// made at draw time cannot reach them at all. They already buy jokers outright in
// aiSeatShop, which is an unconditional accept — the AI's answer to this question, and
// it shipped long ago. The live player2 opponent draws jokers and has never claimed one;
// the `team !== "player1"` guard above preserves that exactly rather than quietly
// changing the opponent's strength as a side effect of a UI change.
