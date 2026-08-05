// tableview.js — the 6-seat TABLE panel (Phase D). Read-only DOM, like hud.js:
// it paints the six seats' chip stacks + last round's recap from state. It draws
// nothing when tableActive is false, so the classic 2-player modes are unaffected.
// Depends on: state (seats, opponentSeat, tableRecap, tableActive), config (MAX_ROUNDS).

function renderTable() {
  const panel = document.getElementById("tablePanel");
  if (!panel) return;
  if (!tableActive) { panel.style.display = "none"; return; }
  panel.style.display = "block";

  // One badge per seat: YOU is highlighted, the seat you fought this round is tagged
  // "vs YOU", and the current chip leader gets a crown so the standings read at a glance.
  const leadChips = Math.max.apply(null, seats.map(function (s) { return s.chips; }));
  let badges = "";
  seats.forEach(function (s) {
    const isOpp = (s.id === opponentSeat && !s.isHuman);
    const cls = "seat-badge" + (s.isHuman ? " you" : "") + (isOpp ? " opp" : "");
    const crown = (s.chips === leadChips) ? "👑 " : "";
    const tag = s.isHuman ? "YOU" : (isOpp ? "vs YOU" : "");
    badges +=
      '<div class="' + cls + '" style="border-color:' + s.color + '">' +
        '<div class="seat-name" style="color:' + s.color + '">' + crown + s.name + '</div>' +
        '<div class="seat-chips">💰 ' + s.chips + '</div>' +
        (tag ? '<div class="seat-tag">' + tag + '</div>' : '') +
      '</div>';
  });

  let recap = "";
  if (tableRecap.length) {
    recap = '<div class="recap-title">Last round</div>' +
      tableRecap.map(function (l) { return '<div class="recap-line">' + l + '</div>'; }).join("");
  }

  panel.innerHTML =
    '<div class="table-title">♠ The Table — most chips after ' + MAX_ROUNDS + ' rounds wins ♠</div>' +
    '<div class="seat-row">' + badges + '</div>' +
    recap;
}

// ── Phase D2: record & replay the fights ──────────────────────────────────────

// A single replay frame: a shallow clone of everything render() reads off the board.
// Units/traps are cloned so their x/y/hp are frozen at this tick; u.card is a stable
// reference kept as-is. snapshotFrame() does NO DOM work, so it's safe to call inside
// the headless combat loop (SIM_MODE on) as well as the live one.
function snapshotFrame() {
  // WEEK 3: also capture the tick's EFFECTS. Everything else here is state — where units
  // are, what their HP is — and a status badge is read straight off that state, which is
  // why badges already replayed for free. Damage numbers, beams and death ghosts are
  // different: they're events that happened AT a moment, and once playFx has drained them
  // they're gone. lastTickFx is where playFx leaves them (see fx.js).
  //
  // Read and reset, because snapshotFrame is called exactly once per tick on both paths.
  // Without the reset, a tick where nothing happened would replay the previous tick's
  // effects all over again.
  const fx = lastTickFx;
  lastTickFx = [];
  return {
    units: units.map(function (u) { return Object.assign({}, u); }),
    traps: traps.map(function (t) { return Object.assign({}, t); }),
    strikeMarks: { player1: strikeMarks.player1.slice(), player2: strikeMarks.player2.slice() },
    tick: tickCount,
    fx: fx,
  };
}

// Paint one recorded frame onto the real board by swapping it into the globals render()
// reads, then rendering. Replay is display-only; nextRound rebuilds the true board.
function showFrame(f) {
  units = f.units; traps = f.traps; strikeMarks = f.strikeMarks; tickCount = f.tick;
  render();
  // Replay the tick's effects in the same order the live fight does: render() first, so
  // the numbers land over the board state they describe, then playFx. A copy is handed
  // over because playFx empties the queue — the recording has to survive being watched
  // more than once.
  fxEvents = f.fx ? f.fx.slice() : [];
  playFx();
}

// Draw the tab bar for this round's three fights (yours first). Hidden when there's
// nothing to watch (off-table, or before the round is fought / after nextRound clears it).
function renderMatchTabs() {
  const bar = document.getElementById("matchTabs");
  if (!bar) return;
  if (!tableActive || matchRecordings.length === 0) { bar.style.display = "none"; bar.innerHTML = ""; return; }
  bar.style.display = "flex";
  bar.innerHTML = '<span class="match-tabs-label">▶ Watch:</span>' +
    matchRecordings.map(function (rec, i) {
      const active = (i === viewingTab) ? " active" : "";
      return '<button class="match-tab' + active + '" data-idx="' + i + '">' + rec.label + '</button>';
    }).join("");
  const btns = bar.querySelectorAll(".match-tab");
  for (let i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () { watchMatch(Number(this.dataset.idx)); });
  }
}

// Play recording `idx` on the board: step through its frames on a brisk timer.
function watchMatch(idx) {
  clearInterval(replayTimer);
  viewingTab = idx;
  renderMatchTabs();                    // refresh the active-tab highlight
  const rec = matchRecordings[idx];
  if (!rec || rec.frames.length === 0) return;
  clearFx();                            // wipe effects from the last thing watched
  motionReset();                        // and forget where the last thing watched left its units,
                                        // or they'd walk in from those old squares (motion.js)
  replaying = true;                     // lets the lunge/flinch animations run (see board.js)
  let i = 0;
  // REPLAY_TICK_MS, not the old hard-coded 130ms. Every effect in the game is sized
  // against an 800ms combat tick — a beam runs 320ms, a damage number 900ms — so at 130ms
  // a tick's effects would still be mid-flight when the next six ticks' worth landed on
  // top of them. Fast enough to skim, slow enough that the effects read.
  replayTimer = setInterval(function () {
    if (i >= rec.frames.length) {
      clearInterval(replayTimer); replayTimer = null; replaying = false;
      // The watched fight is over, so its bombs come off the board — same rule finishRound
      // applies to your live fight. showFrame left `traps` pointing at the last frame's
      // array, and without this they'd sit on the freeze-frame until Next Round.
      traps = []; render();
      return;
    }
    showFrame(rec.frames[i]); i++;
  }, REPLAY_TICK_MS);
}

// Tear down the tab bar + any running replay (called by nextRound / resetGame).
function clearMatchTabs() {
  clearInterval(replayTimer); replayTimer = null;
  replaying = false;
  motionReset();                        // no half-finished walks left running (motion.js)
  traps = [];                           // showFrame points `traps` at the watched frame's array,
                                        // so drop it here or a replay re-litters the live board
  matchRecordings = []; viewingTab = 0;
  const bar = document.getElementById("matchTabs");
  if (bar) { bar.style.display = "none"; bar.innerHTML = ""; }
}
