// flopreveal.js — the Round Start cinematic: dealing the community board as a SHOW.
//
// The community board is the most game-defining thing that happens in a round — it
// feeds pokerPool for both players, gates every rank ability through packCount, and
// swings the flush axis through effectiveSuitCount. It used to appear with no ceremony
// at all: growCommunity() called renderFlop() and three small rectangles blinked into
// existence above the board. This module gives it the entrance it earns:
//
//   ready cascade → cards dealt face-down over the board → flipped ONE AT A TIME with
//   a beat between each → your biggest hand called out → cards shrink into the row →
//   your buffed units pulse → fight.
//
// THREE THINGS SHAPED THIS DESIGN, all of them constraints from the existing code:
//
//  1. growCommunity() runs HEADLESS too (table.js, sim.js call it inside SIM_MODE,
//     six-plus times a round). So the reveal hangs off startRound, never off the deal
//     itself, and guards on SIM_MODE at its own front door regardless.
//  2. #fxLayer CANNOT host this. It lives inside #board with overflow:hidden, and the
//     flop row lives outside #board — a card can't travel between them. Hence a
//     position:fixed stage over the whole viewport, positioned from the board's
//     getBoundingClientRect(). Fixed coords and viewport coords are the same thing, so
//     there's no new geometry maths here at all.
//  3. There is NO async anywhere in this codebase — no await, no Promise, everything is
//     setTimeout/setInterval. So the reveal takes a CALLBACK continuation rather than
//     introducing the first Promise. startRound hands us `done`; we call it when the
//     show is over, and the fight starts inside it.
//
// Animations are element.animate(), for exactly the reason playLunge/playFlinch use it
// (board.js): calling it always starts a NEW run, it can't get stuck the way a leftover
// CSS class can, and it cleans up after itself. Nothing here touches game state — the
// cards were already dealt and shaped by growCommunity before we're called, so this is
// render-only and cannot move balance.
//
// Depends on: config (timings), state (flop, units, tableActive, seats), cards
// (rankLabel, SUITS), flop (renderFlop), synergies (bestHandsFor), board (unitNodeFor,
// playHandPop).

let flopStageEl = null;      // the stage, or null when no reveal is running
let flopTimers = [];         // every pending beat, so a skip/abort can cancel the lot
let flopBigCards = [];       // the .fbig nodes on the stage, in flop order
let flopDeckOrigin = null;   // viewport point the cards fly FROM
let flopHandRanks = null;    // { rank: true } — the ranks forming the called-out hand
let flopDoneCb = null;       // the continuation; nulled the instant it fires (once only)

// Every duration in this file passes through here, so FLOP_REVEAL_SPEED scales the
// whole show while keeping the beats in proportion.
function fms(ms) {
  return Math.max(0, Math.round(ms * FLOP_REVEAL_SPEED));
}

// Schedule one beat. `ms` is UNSCALED — the timeline below is written in the tuned
// numbers from config and the scaling happens here, in one place.
function flopAt(ms, fn) {
  flopTimers.push(setTimeout(fn, fms(ms)));
}

function flopClearTimers() {
  for (let i = 0; i < flopTimers.length; i++) clearTimeout(flopTimers[i]);
  flopTimers = [];
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Play the reveal, then call done(). ALWAYS calls done exactly once, on every path —
// it's the only thing that starts the fight, so losing it would hang the round.
function flopReveal(done) {
  const rowEl = document.getElementById("flop-cards");
  const boardEl = document.getElementById("board");
  // Headless, switched off, or no DOM to draw on: fall straight back to the old
  // behaviour — snap the board face-up and get on with the fight.
  if (SIM_MODE || FLOP_REVEAL_SPEED <= 0 || !rowEl || !boardEl || flop.length === 0) {
    renderFlop();
    done();
    return;
  }
  flopRevealAbort();          // belt and braces: never two shows at once
  flopDoneCb = done;
  buildFlopStage(boardEl);
  runFlopTimeline();
}

// Tear the show down WITHOUT starting the fight. For nextRound/resetGame, where the
// round the reveal belongs to is being thrown away.
function flopRevealAbort() {
  flopDoneCb = null;
  teardownFlopStage();
}

// Hand off to the fight. The null-out is what makes a skip racing the natural end
// harmless: whichever gets here first fires the continuation, the other finds nothing.
function flopFinish() {
  const cb = flopDoneCb;
  flopDoneCb = null;
  teardownFlopStage();
  if (cb) cb();
}

// Click anywhere: jump to the end state now. Not a nicety — it's what keeps a ~4s
// cinematic tolerable on the hundredth round rather than only the first.
function flopSkip() {
  if (!flopDoneCb) return;
  flopClearTimers();
  for (let i = 0; i < flopBigCards.length; i++) flopSnapFaceUp(flopBigCards[i]);
  // Run the callout for its SIDE EFFECT, not its banner — the stage is about to be
  // destroyed, so nobody reads the text. It's what populates flopHandRanks, and the
  // unit pop below outlives the teardown, so skipping still shows you which of your
  // units the board just buffed. (The trait sidebar names the hand a moment later.)
  flopShowCallout();
  renderFlop();
  flopPopBuffedUnits();
  flopFinish();
}

function teardownFlopStage() {
  flopClearTimers();
  if (flopStageEl) { flopStageEl.remove(); flopStageEl = null; }
  flopBigCards = [];
  flopHandRanks = null;
  flopDeckOrigin = null;
  const rowEl = document.getElementById("flop-cards");
  if (rowEl) rowEl.style.visibility = "";   // undo the measure-then-reveal trick
}

// ── Building the stage ────────────────────────────────────────────────────────

function buildFlopStage(boardEl) {
  const rect = boardEl.getBoundingClientRect();

  const stage = document.createElement("div");
  stage.id = "flopStage";

  const dim = document.createElement("div");
  dim.className = "fstage-dim";
  dim.addEventListener("click", flopSkip);
  stage.appendChild(dim);

  // Centred on the BOARD, not the viewport — the board is what the player is looking
  // at, and on a wide window it sits well off centre.
  const panel = document.createElement("div");
  panel.className = "fstage-panel";
  panel.style.left = Math.round(rect.left + rect.width / 2) + "px";
  panel.style.top = Math.round(rect.top + rect.height / 2) + "px";
  stage.appendChild(panel);

  panel.appendChild(buildReadyChips());

  const banner = document.createElement("div");
  banner.className = "fstage-banner";
  panel.appendChild(banner);

  const row = document.createElement("div");
  row.className = "fstage-row";
  // Big cards are ~2× a hand card (46×58). Shrink them only if five river cards would
  // otherwise overflow the board's width — the show should never be wider than the
  // thing it's playing over.
  const base = 96, gap = 14;
  const want = flop.length * base + (flop.length - 1) * gap;
  const room = rect.width * 0.92;
  const scale = want > room ? room / want : 1;
  row.style.setProperty("--fbig-w", Math.round(base * scale) + "px");
  row.style.setProperty("--fbig-h", Math.round(base * 1.375 * scale) + "px");
  row.style.setProperty("--fbig-gap", Math.round(gap * scale) + "px");
  panel.appendChild(row);

  flopBigCards = [];
  for (let i = 0; i < flop.length; i++) {
    const card = buildBigCard(flop[i]);
    row.appendChild(card);
    flopBigCards.push(card);
  }

  document.body.appendChild(stage);
  flopStageEl = stage;
  // The shoe sits off the board's right edge; cards fly in from there.
  flopDeckOrigin = { x: rect.right + 90, y: rect.top + rect.height / 2 };
}

// The ready cascade. Rendered on the STAGE rather than stamped onto the seat badges in
// #tablePanel deliberately: renderTable() rebuilds that markup wholesale, so anything
// written into it is one repaint away from vanishing. This owns its own pixels.
function buildReadyChips() {
  const ready = document.createElement("div");
  ready.className = "fstage-ready";
  const atTable = (typeof tableActive !== "undefined") && tableActive &&
                  (typeof seats !== "undefined") && seats;
  const n = atTable ? seats.length : 2;
  for (let i = 0; i < n; i++) {
    const chip = document.createElement("span");
    chip.className = "fstage-chip";
    chip.textContent = (i === 0) ? "YOU" : (atTable ? "S" + i : "P2");
    ready.appendChild(chip);
  }
  return ready;
}

function buildBigCard(c) {
  const cs = SUITS[c.suit];
  const card = document.createElement("div");
  card.className = "fbig";
  card.title = rankLabel(c.rank) + cs.symbol + " (community)";

  // Two faces sharing one 3D box. The front is pre-rotated 180°, so turning the inner
  // to -180° swaps which one faces the viewer — backface-visibility does the rest.
  const inner = document.createElement("div");
  inner.className = "fbig-inner";
  const back = document.createElement("div");
  back.className = "fbig-face fbig-back";
  const front = document.createElement("div");
  front.className = "fbig-face fbig-front";
  front.style.color = cs.cardColor;
  front.textContent = rankLabel(c.rank) + cs.symbol;
  inner.appendChild(back);
  inner.appendChild(front);
  card.appendChild(inner);

  card._inner = inner;
  card._rank = c.rank;
  return card;
}

// ── The timeline ──────────────────────────────────────────────────────────────

// `t` walks forward in UNSCALED milliseconds; flopAt does the scaling. Written as one
// flat schedule rather than nested callbacks so the whole shape of the show is legible
// in one screen — and so a skip only has to clear one flat list of timers.
function runFlopTimeline() {
  const n = flopBigCards.length;
  let t = 0;

  // 1. Seats ready up, left to right.
  const chips = flopStageEl.querySelectorAll(".fstage-chip");
  const step = FLOP_READY_MS / (chips.length + 1);
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    flopAt(t + step * i, function () { chip.classList.add("lit"); });
  }
  flopAt(t + step * chips.length, function () { setFlopBanner("ALL IN — DEALING", "deal"); });
  t += FLOP_READY_MS;

  // 2. The deal: cards fly in from the shoe, face-down, on a stagger.
  for (let i = 0; i < n; i++) {
    const card = flopBigCards[i];
    flopAt(t + FLOP_DEAL_GAP * i, function () { flopDealCard(card); });
  }
  t += FLOP_DEAL_MS + FLOP_DEAL_GAP * (n - 1);

  // 3. The pause before anything turns over. This beat is the whole point.
  t += FLOP_SETTLE_MS;

  // 4. The flips, one at a time, with silence in between.
  for (let i = 0; i < n; i++) {
    const card = flopBigCards[i];
    flopAt(t, function () { flopFlipCard(card); });
    t += FLOP_FLIP_MS + FLOP_FLIP_GAP;
  }
  t -= FLOP_FLIP_GAP;          // no beat owed after the last card

  // 5. What you made.
  flopAt(t, flopShowCallout);
  t += FLOP_CALLOUT_MS;

  // 6. The cards settle into the row and the dim lifts.
  flopAt(t, flopShrinkToRow);
  t += FLOP_SHRINK_MS;

  // 7. Finally the units that earn the buff pulse — AFTER the dim has gone, which is
  //    what makes the causal read land: those cards did this to these units. The fight
  //    is handed off in the SAME beat rather than after the pop: combat's setInterval
  //    waits a full COMBAT_TICK_MS before its first step, so the pop plays out during
  //    dead air that already existed. Waiting for it would just add 400ms of nothing.
  flopAt(t, function () { flopPopBuffedUnits(); flopFinish(); });
}

function flopDealCard(card) {
  const r = card.getBoundingClientRect();
  const dx = Math.round(flopDeckOrigin.x - (r.left + r.width / 2));
  const dy = Math.round(flopDeckOrigin.y - (r.top + r.height / 2));
  card.style.opacity = "1";
  // The overshoot at 78% IS the thud — the card arrives slightly too big and settles.
  card._dealAnim = card.animate([
    { transform: "translate(" + dx + "px," + dy + "px) rotate(-16deg) scale(.66)", opacity: 0 },
    { transform: "translate(0,0) rotate(0deg) scale(1.07)", opacity: 1, offset: 0.78 },
    { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
  ], { duration: fms(FLOP_DEAL_MS), easing: "cubic-bezier(.2,.8,.3,1)" });
}

function flopFlipCard(card) {
  card._flipAnim = card._inner.animate([
    { transform: "rotateY(0deg) scale(1)" },
    { transform: "rotateY(-90deg) scale(1.09)", offset: 0.5 },
    { transform: "rotateY(-180deg) scale(1)" },
  ], { duration: fms(FLOP_FLIP_MS), easing: "cubic-bezier(.35,0,.25,1)", fill: "forwards" });
  // Also written inline: a filled animation outranks inline style while it exists, so
  // this changes nothing now — but if a skip CANCELS the animation mid-turn, the card
  // still lands face-up instead of snapping back to its back.
  card._inner.style.transform = "rotateY(-180deg)";
  card.classList.add("faceup");
}

function flopSnapFaceUp(card) {
  if (card._dealAnim) card._dealAnim.cancel();
  if (card._flipAnim) card._flipAnim.cancel();
  card.style.opacity = "1";
  card.style.transform = "none";
  card._inner.style.transform = "rotateY(-180deg)";
  card.classList.add("faceup");
}

// ── The callout ───────────────────────────────────────────────────────────────

// Name your best hand and light up the cards that form it. bestHandsFor reads the same
// pool and the same evaluators pokerBuffs does, so what's announced here is exactly
// what gets baked onto your units a moment later in applySynergies.
function flopShowCallout() {
  if (!flopStageEl) return;
  const hands = bestHandsFor("player1");
  flopHandRanks = {};
  if (hands.length === 0) {
    setFlopBanner("NO HAND — the board gave you nothing", "cold");
    return;
  }
  const best = hands[0];
  for (let i = 0; i < best.ranks.length; i++) flopHandRanks[best.ranks[i]] = true;
  setFlopBanner("⚡ " + best.name + " — " + best.detail, "hit");
  // Only the community cards that actually form the hand glow. If the hand came
  // entirely from your own units, nothing on the stage lights and the banner carries
  // it alone — which is truthful: the flop didn't help.
  for (let i = 0; i < flopBigCards.length; i++) {
    if (flopHandRanks[flopBigCards[i]._rank]) flopBigCards[i].classList.add("fbig-hit");
  }
}

function setFlopBanner(text, kind) {
  if (!flopStageEl) return;
  const b = flopStageEl.querySelector(".fstage-banner");
  b.textContent = text;
  b.className = "fstage-banner " + (kind || "");
  b.animate([
    { opacity: 0, transform: "scale(.84)" },
    { opacity: 1, transform: "scale(1)" },
  ], { duration: fms(260), easing: "cubic-bezier(.2,.9,.3,1)" });
}

// Pulse every one of YOUR units the called-out hand buffs. Fused units are skipped for
// the same reason pokerBuffs skips them: a made hand is self-contained and takes no
// poker buff, so popping one would promise a boost it never gets.
function flopPopBuffedUnits() {
  if (!flopHandRanks) return;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.team !== "player1" || u.fused || !flopHandRanks[u.rank]) continue;
    playHandPop(unitNodeFor(u));
  }
}

// ── Landing ───────────────────────────────────────────────────────────────────

// Fly the big cards down into the real flop row. The trick: build the real row FIRST
// but keep it invisible, measure where each card actually landed, and animate to that
// measured rect. That way the landing is pixel-exact without this file knowing
// anything about how #flop-cards lays itself out.
function flopShrinkToRow() {
  if (!flopStageEl) return;
  const rowEl = document.getElementById("flop-cards");
  rowEl.style.visibility = "hidden";
  renderFlop();
  const slots = rowEl.querySelectorAll(".flop-card");

  flopStageEl.style.pointerEvents = "none";        // skipping is moot from here on
  const fade = { duration: fms(FLOP_SHRINK_MS), easing: "ease-out", fill: "forwards" };
  flopStageEl.querySelector(".fstage-dim").animate([{ opacity: 1 }, { opacity: 0 }], fade);
  flopStageEl.querySelector(".fstage-ready").animate([{ opacity: 1 }, { opacity: 0 }], fade);
  flopStageEl.querySelector(".fstage-banner").animate(
    [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.9)" }], fade);

  for (let i = 0; i < flopBigCards.length; i++) {
    const card = flopBigCards[i];
    const slot = slots[i];
    if (!slot) continue;
    const a = card.getBoundingClientRect();
    const b = slot.getBoundingClientRect();
    const dx = Math.round((b.left + b.width / 2) - (a.left + a.width / 2));
    const dy = Math.round((b.top + b.height / 2) - (a.top + a.height / 2));
    const s = a.width ? (b.width / a.width) : 0.5;
    card.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(" + s + ")", opacity: 0.1 },
    ], { duration: fms(FLOP_SHRINK_MS), easing: "cubic-bezier(.5,0,.6,1)", fill: "forwards" });
  }

  flopAt(FLOP_SHRINK_MS, function () { rowEl.style.visibility = ""; });
}
