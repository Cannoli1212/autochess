// main.js — bootstrap. The single entry point: build the board, wire input and
// buttons, then kick off the first round. Loaded LAST.

// Wire the control buttons.
startButton.addEventListener("click", startRound);
nextButton.addEventListener("click", nextRound);
resetButton.addEventListener("click", resetGame);

// Part B step 1 (now 3-way): cycle Player 2 between the computer, a second human, and
// PLAYTEST (a sandbox with a card picker). player2IsAI stays true only in "computer" mode.
const aiToggleButton = document.getElementById("aiToggleButton");
const playtestPanel = document.getElementById("playtestPanel");
const P2_MODE_CYCLE = { computer: "human", human: "playtest", playtest: "computer" };
const P2_MODE_LABEL = { computer: "🤖 P2: Computer", human: "🧑 P2: Human", playtest: "🧪 P2: Playtest" };
aiToggleButton.addEventListener("click", function () {
  p2Mode = P2_MODE_CYCLE[p2Mode];
  player2IsAI = (p2Mode === "computer");
  aiToggleButton.textContent = P2_MODE_LABEL[p2Mode];
  playtestPanel.style.display = (p2Mode === "playtest") ? "block" : "none";
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

// Build the shoes + community deck, draw the opening hands, and paint the
// starting board and texts.
initShoes();
initCommunityDeck();
hideFlop();
// Phase D: default mode is vs-computer, so open at a fresh 6-seat table.
tableActive = (p2Mode === "computer");
if (tableActive) makeLiveSeats();
render();
updateStatus();
updateRoundInfo();
drawHands();
renderTable();
