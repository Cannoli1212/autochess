// hud.js — read-only on-screen text: status hint, scoreboard, chip badges.
// Depends on: state, synergies.

// Refresh the placement hint and each player's placement progress.
function updateStatus() {
  if (SIM_MODE) return;   // headless batch sim: skip DOM (see sim.js)
  updateRedrawButton();   // keep the Redraw button's count + enabled state in sync
  const limit = armySize();
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
  // Phase D3: at a 6-seat table the old "Player 1 vs Player 2 rounds won" line is
  // meaningless — show your live standing (chips + rank) and the current leader instead.
  if (tableActive && seats.length) {
    const ranked = seats.slice().sort(function (a, b) { return b.chips - a.chips || a.id - b.id; });
    const place = ranked.findIndex(function (s) { return s.isHuman; }) + 1;
    const leader = ranked[0];
    roundInfo.textContent =
      "Round " + roundNumber + " of " + MAX_ROUNDS + "   —   You: 💰" + seats[0].chips +
      " (" + ordinal(place) + " of " + seats.length + ")   ·   Leader: " + leader.name +
      " 💰" + leader.chips;
    updateChipInfo();
    return;
  }
  roundInfo.textContent =
    "Round " + roundNumber + " of " + MAX_ROUNDS + "   —   Rounds won:  Player 1: " +
    roundWins.player1 + "  ·  Player 2: " + roundWins.player2;
  updateChipInfo();
}

// Phase C: refresh each player's chip stack in their side badge — and, under it, their
// COMPS. Two currencies, two lines, deliberately not merged into one: chips are the
// score you're fighting over, comps are what you spend, and blurring them would undo
// the whole reason there are two (see COMPS_INCOME in config.js).
//
// The comps element is written from here rather than sitting in the markup because
// game.html is double-encoded on disk — its literal emoji are mojibake. Setting
// textContent from JS sidesteps that entirely.
function updateChipInfo() {
  document.querySelector("#chip-player1 .chip-amount").textContent = "💰 " + chips.player1;
  document.querySelector("#chip-player2 .chip-amount").textContent = "💰 " + chips.player2;
  const c1 = document.getElementById("comp-player1");
  const c2 = document.getElementById("comp-player2");
  if (c1) c1.textContent = COMPS_ICON + " " + comps.player1;
  if (c2) c2.textContent = COMPS_ICON + " " + comps.player2;
}

// Distinct bar colors for the per-card rows (hearts/diamonds share a unitColor,
// clubs/spades share one too, so those can't tell suits apart — use our own here).
const DMG_SUIT_COLORS = { hearts: "#ff6b6b", diamonds: "#ffd76b", clubs: "#5fd35f", spades: "#cfd6e0" };

// Which number the per-card bars GRAPH: "dealt" (the default — who's carrying) or
// "taken" (who's soaking). Flipped by the tabs at the top of the panel. It's a view
// preference, not game state, so it deliberately survives rounds and Reset Game —
// only a click changes it. Whichever view is off still shows as the muted second
// number on each row, so you never lose sight of the other half.
let dmgView = "dealt";

// The two metrics, keyed by view. Keeping them in one table is what lets
// renderDmgPanel be written once instead of branching all the way down.
const DMG_VIEWS = {
  dealt: { map: "byCard",      total: "dealt", label: "dealt" },
  taken: { map: "takenByCard", total: "taken", label: "taken" },
};

// Flip the panel to a view and repaint. Safe to call mid-fight — render() will
// repaint over it on the next tick anyway, with the same dmgView.
function setDmgView(view) {
  if (!DMG_VIEWS[view] || dmgView === view) return;
  dmgView = view;
  renderDmgPanel();
}

// The live damage tracker: THIS round's dealt/taken, per team AND per card. Called
// from render(), so it stays in lockstep with the board and ticks up as the fight
// runs. The numbers survive the end of the fight (resetRoundStats fires at Round
// Start, not at Next Round) so you can actually read the result before moving on.
//
// Per-card rows are keyed by CARD identity ("suit-rank"), not by unit — so if you
// field two copies of the same card they share one row. That's the same key
// recordDamage books under, and it's what makes a row mean "this card" rather
// than "this particular body on the board".
function renderDmgPanel() {
  if (!dmgPanel) return;
  const r = dmgStats.round;
  const fmt = function (n) { return Math.round(n).toLocaleString(); };

  const view  = DMG_VIEWS[dmgView];
  const other = DMG_VIEWS[dmgView === "dealt" ? "taken" : "dealt"];

  // Scale every bar to the single busiest card across BOTH teams — on the metric
  // being GRAPHED — so a row's length means the same thing wherever it appears.
  let max = 1;
  ["player1", "player2"].forEach(function (team) {
    const m = r[team][view.map];
    for (const k in m) if (m[k] > max) max = m[k];
  });

  // One row per card that dealt OR took damage this round — union of both maps, so
  // a unit that only got hit still shows up. Sorted by whichever metric is graphed.
  function cardRows(team) {
    const pri = r[team][view.map], sec = r[team][other.map];
    const seen = {};
    for (const k in pri) seen[k] = true;
    for (const k in sec) seen[k] = true;
    const keys = Object.keys(seen).sort(function (a, b) {
      return (pri[b] || 0) - (pri[a] || 0);
    });
    if (keys.length === 0) return '<div class="dmg-empty">— nothing yet —</div>';
    return keys.map(function (key) {
      const parts = key.split("-");                 // "suit-rank", split back into a label
      const su = parts[0], rank = Number(parts[1]);
      const p = pri[key] || 0, s = sec[key] || 0;
      const pct = Math.round((p / max) * 100);
      return '<div class="dmg-bar-row">' +
        '<span class="dmg-card-lbl" style="color:' + DMG_SUIT_COLORS[su] + '">' + rankLabel(rank) + SUITS[su].symbol + '</span>' +
        '<span class="dmg-bar-track"><span class="dmg-bar-fill" style="width:' + pct + '%;background:' + DMG_SUIT_COLORS[su] + '"></span></span>' +
        '<span class="dmg-bar-num">' + fmt(p) + '</span>' +
        '<span class="dmg-bar-alt">' + fmt(s) + '</span>' +
      '</div>';
    }).join("");
  }

  // The tabs are rebuilt with the rest of the panel every tick, so they carry no
  // listeners of their own — main.js delegates clicks off #dmgPanel by data-view.
  function tab(key) {
    return '<button type="button" class="dmg-tab' + (dmgView === key ? " on" : "") +
      '" data-view="' + key + '">' + DMG_VIEWS[key].label + '</button>';
  }

  function teamBlock(team, name, cls) {
    return '<div class="dmg-team ' + cls + '">' +
      '<div class="dmg-name">' + name + '</div>' +
      '<div class="dmg-line"><span>Dealt</span><b>' + fmt(r[team].dealt) + '</b></div>' +
      '<div class="dmg-line"><span>Taken</span><b>' + fmt(r[team].taken) + '</b></div>' +
      '<div class="dmg-cards-head"><span>card</span><span>' + view.label + '</span><span>' + other.label + '</span></div>' +
      cardRows(team) +
    '</div>';
  }

  dmgPanel.innerHTML =
    '<div class="dmg-title">Damage — this round</div>' +
    '<div class="dmg-tabs">' + tab("dealt") + tab("taken") + '</div>' +
    teamBlock("player1", "Player 1", "p1") +
    teamBlock("player2", "Player 2", "p2");
}
