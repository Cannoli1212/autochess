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
