// hud.js — read-only on-screen text: status hint, scoreboard, chip badges.
// Depends on: state, synergies.

// Refresh the placement hint and each player's placement progress.
function updateStatus() {
  if (SIM_MODE) return;   // headless batch sim: skip DOM (see sim.js)
  const limit = roundNumber;
  if (isPlaytest()) {
    turnStatus.textContent =
      "🧪 Playtest — add any card below, place units on EITHER side (no unit cap), then Round Start.";
    counter.textContent =
      "Player 1: " + countUnits("player1") + " placed   |   Player 2: " + countUnits("player2") + " placed";
    renderSynergies();
    return;
  }
  turnStatus.textContent = player2IsAI
    ? "Place your " + limit + " unit(s), then press Round Start — Player 2 is the computer."
    : "Drag cards from your hand onto your zone — place " + limit + " unit(s) each.";
  const p2Label = player2IsAI
    ? "Player 2 (computer): placed at Round Start"
    : "Player 2: " + countUnits("player2") + "/" + limit + " placed";
  counter.textContent =
    "Player 1: " + countUnits("player1") + "/" + limit + " placed   |   " + p2Label;
  renderSynergies();
}

// Refresh the round number and the rounds-won scoreboard.
function updateRoundInfo() {
  roundInfo.textContent =
    "Round " + roundNumber + " of 5   —   Rounds won:  Player 1: " +
    roundWins.player1 + "  ·  Player 2: " + roundWins.player2;
  updateChipInfo();
}

// Phase C: refresh each player's chip stack in their side badge.
function updateChipInfo() {
  document.querySelector("#chip-player1 .chip-amount").textContent = "💰 " + chips.player1;
  document.querySelector("#chip-player2 .chip-amount").textContent = "💰 " + chips.player2;
}

// Distinct bar colors for the suit breakdown (hearts/diamonds share a unitColor,
// clubs/spades share one too, so those can't tell suits apart — use our own here).
const DMG_SUIT_COLORS = { hearts: "#ff6b6b", diamonds: "#ffd76b", clubs: "#5fd35f", spades: "#cfd6e0" };

// The live damage tracker. Top half = THIS round's running dealt/taken per team
// (updates every combat tick via render()); bottom half = SESSION damage split by
// suit — the number that actually tells you if a suit is over/undertuned. Called
// from render() so it stays in lockstep with the board.
function renderDmgPanel() {
  if (!dmgPanel) return;
  const r = dmgStats.round, se = dmgStats.session;
  const fmt = function (n) { return Math.round(n).toLocaleString(); };

  function teamBlock(team, name, cls) {
    return '<div class="dmg-team ' + cls + '">' +
      '<div class="dmg-name">' + name + '</div>' +
      '<div class="dmg-line"><span>Dealt</span><b>' + fmt(r[team].dealt) + '</b></div>' +
      '<div class="dmg-line"><span>Taken</span><b>' + fmt(r[team].taken) + '</b></div>' +
    '</div>';
  }

  // Pool both teams' session damage by suit, and scale bars to the busiest suit.
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const totals = {};
  let max = 1;
  suits.forEach(function (su) {
    totals[su] = se.player1.bySuit[su] + se.player2.bySuit[su];
    if (totals[su] > max) max = totals[su];
  });
  let bars = "";
  suits.forEach(function (su) {
    const pct = Math.round((totals[su] / max) * 100);
    bars += '<div class="dmg-bar-row">' +
      '<span class="dmg-bar-suit" style="color:' + DMG_SUIT_COLORS[su] + '">' + SUITS[su].symbol + '</span>' +
      '<span class="dmg-bar-track"><span class="dmg-bar-fill" style="width:' + pct + '%;background:' + DMG_SUIT_COLORS[su] + '"></span></span>' +
      '<span class="dmg-bar-num">' + fmt(totals[su]) + '</span>' +
    '</div>';
  });

  // Top individual CARDS by session damage, pooled across both teams. `field`
  // selects the map: "byCard" (damage dealt) or "takenByCard" (damage taken).
  // Keys are "suit-rank", split back into a rank+suit label. Top 5 (52 won't fit).
  function topCardRows(field) {
    const totals = {};
    ["player1", "player2"].forEach(function (team) {
      const m = se[team][field];
      for (const key in m) totals[key] = (totals[key] || 0) + m[key];
    });
    const keys = Object.keys(totals)
      .sort(function (a, b) { return totals[b] - totals[a]; })
      .slice(0, 5);
    if (keys.length === 0) return '<div class="dmg-empty">— no fights yet —</div>';
    const mx = totals[keys[0]];                     // scale bars to the biggest entry
    return keys.map(function (key) {
      const parts = key.split("-");
      const su = parts[0], rank = Number(parts[1]);
      const pct = Math.round((totals[key] / mx) * 100);
      return '<div class="dmg-bar-row">' +
        '<span class="dmg-card-lbl" style="color:' + DMG_SUIT_COLORS[su] + '">' + rankLabel(rank) + SUITS[su].symbol + '</span>' +
        '<span class="dmg-bar-track"><span class="dmg-bar-fill" style="width:' + pct + '%;background:' + DMG_SUIT_COLORS[su] + '"></span></span>' +
        '<span class="dmg-bar-num">' + fmt(totals[key]) + '</span>' +
      '</div>';
    }).join("");
  }

  dmgPanel.innerHTML =
    '<div class="dmg-title">Damage — this round</div>' +
    teamBlock("player1", "Player 1", "p1") +
    teamBlock("player2", "Player 2", "p2") +
    '<div class="dmg-title">Session by suit (dealt)</div>' +
    bars +
    '<div class="dmg-title">Top cards — dealt</div>' +
    topCardRows("byCard") +
    '<div class="dmg-title">Top cards — taken</div>' +
    topCardRows("takenByCard");
}
