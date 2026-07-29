// main.js — bootstrap. The single entry point: build the board, wire input and
// buttons, then kick off the first round. Loaded LAST.

// Wire the control buttons.
startButton.addEventListener("click", startRound);
nextButton.addEventListener("click", nextRound);
resetButton.addEventListener("click", resetGame);

// Redraw: reroll your whole hand (up to REDRAWS_PER_ROUND per round). Only your own
// hand; the AI opponent rerolls itself at Round Start. updateStatus() repaints the
// button's count + enabled state.
redrawButton.addEventListener("click", function () {
  if (rerollHand("player1")) {
    message.textContent = "🔄 Redrew your hand — " + redrawsLeft.player1 + " redraw(s) left.";
    updateStatus();
  }
});

// Part B step 1 (now 3-way): cycle Player 2 between the computer, a second human, and
// PLAYTEST (a sandbox with a card picker). player2IsAI stays true only in "computer" mode.
const aiToggleButton = document.getElementById("aiToggleButton");
const playtestPanel = document.getElementById("playtestPanel");
const P2_MODE_CYCLE = { computer: "human", human: "playtest", playtest: "computer" };
const P2_MODE_LABEL = { computer: "🤖 P2: Computer", human: "🧑 P2: Human", playtest: "🧪 P2: Playtest" };
// Player 2's hand is the computer's private cards — hide the whole P2 hand row while
// P2 is the computer, and show it again in Human/Playtest (where you need to see it).
function applyP2HandVisibility() {
  const row = document.querySelector('.hand-row[data-team="player2"]');
  if (row) row.style.display = (p2Mode === "computer") ? "none" : "";
}

aiToggleButton.addEventListener("click", function () {
  p2Mode = P2_MODE_CYCLE[p2Mode];
  player2IsAI = (p2Mode === "computer");
  aiToggleButton.textContent = P2_MODE_LABEL[p2Mode];
  playtestPanel.style.display = (p2Mode === "playtest") ? "block" : "none";
  applyP2HandVisibility();
  // Phase D: the 6-seat table is on ONLY in vs-computer mode. Switching modes rebuilds
  // the table (fresh stacks) so it never carries stale seats from a prior mode.
  tableActive = (p2Mode === "computer");
  if (tableActive) makeLiveSeats();
  renderTable();
  updateStatus();
  updatePlacementMessage();
});

// Playtest card picker: fill the rank dropdown (2..14 with card labels) and wire "Add".
const ptRank = document.getElementById("ptRank");
for (let r = 2; r <= 14; r++) {
  const opt = document.createElement("option");
  opt.value = r;
  opt.textContent = rankLabel(r);
  ptRank.appendChild(opt);
}
document.getElementById("ptAddButton").addEventListener("click", function () {
  const team = document.getElementById("ptTeam").value;
  const suit = document.getElementById("ptSuit").value;
  const rank = parseInt(ptRank.value, 10);
  addPlaytestCard(team, suit, rank);
});

// Build the grid, then attach the drag-and-drop input to it (inversion #2).
buildBoard();
initInput();

// The motion pass measures the board's geometry once and then does arithmetic (see
// boardMetrics in board.js), so anything that changes that geometry has to say so —
// otherwise units get drawn against a layout that no longer exists.
//
// A window resize is the obvious case. The one that actually caused trouble is not obvious
// at all: the board shares a flex row with the damage panel, that panel grows taller as a
// fight goes on, and the row stretches the BOARD to match — so the squares change size
// without the window moving at all. Watching the board itself catches both, and anything
// else that ever nudges it (a font finishing loading, browser zoom, a new side panel).
// renderUnits already re-measures before every redraw, so correctness does not depend on
// what follows — this only makes the board catch up SOONER, within the same frame it
// resized rather than at the next redraw. Kept in a variable because an observer with no
// reference to it is a thing the browser is allowed to throw away.
let boardResizeObserver = null;
if (typeof ResizeObserver !== "undefined") {
  boardResizeObserver = new ResizeObserver(function () { motionSyncGeometry(); });
  boardResizeObserver.observe(board);
} else {
  window.addEventListener("resize", motionSyncGeometry);
}

// Build the shoes + community deck, draw the opening hands, and paint the
// starting board and texts.
initShoes();
initCommunityDeck();
hideFlop();
// Phase D: default mode is vs-computer, so open at a fresh 6-seat table.
tableActive = (p2Mode === "computer");
if (tableActive) makeLiveSeats();
applyP2HandVisibility();
render();
updateStatus();
updateRoundInfo();
drawHands();
renderTable();
