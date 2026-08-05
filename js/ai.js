// ai.js — the computer opponent (first step toward a solo 6-player game).
// Given a team, the bot drafts and places its army for the round: it picks the
// strongest cards in its hand and drops them into its zone, melee up front and
// ranged in the back. It reuses the SAME playCard() a human uses, so it can never
// do anything a human couldn't. Depends on: config, state, cards, board, placement.
//
// This is deliberately simple (a "greedy" bot: always grab the biggest card). It's
// good enough to play against and is the exact logic that will later fill seats
// 2–6 when we scale past two players — nothing here assumes there are only two.

// The rows that make up a team's zone, FRONT row (nearest the enemy) listed first.
// Ties to zoneOfRow(): player2 owns the top rows 0–2 (front = 2, closest to center);
// player1 owns the bottom rows 5–7 (front = 5).
function zoneRows(team) {
  if (team === "player2") return [2, 1, 0];
  return [5, 6, 7];
}

// Choose an empty cell for one card. Melee (range 1) wants the front row so it
// reaches the enemy fast; ranged wants the back so it's shielded. Fills each row
// left-to-right. Returns {x, y}, or null if the whole zone is full.
function aiPickCell(team, card) {
  const rows = zoneRows(team);
  // Melee: front → back. Ranged: back → front (reverse the same list).
  const order = (card.range <= 1) ? rows : rows.slice().reverse();
  for (let r = 0; r < order.length; r++) {
    const y = order[r];
    for (let x = 0; x < COLS; x++) {
      if (findUnitAt(x, y) === null) return { x: x, y: y };
    }
  }
  return null;
}

// Place a full army for an AI team: strongest card first (by attack + hp), until
// it has placed its roundNumber units or runs out of cards. We re-scan the hand
// each pass because playCard() splices the placed card out of it.
function aiPlaceUnits(team) {
  while (countUnits(team) < armySize() && hands[team].length > 0) {
    // Find the strongest card still in hand. JOKERS are skipped: they have no attack
    // or hp (the score would be NaN) and they can't be placed at all. bestIdx starts
    // at -1 rather than 0 so a hand of nothing but jokers breaks out of the loop
    // instead of trying to field one — otherwise playCard would refuse forever and
    // this would spin.
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < hands[team].length; i++) {
      const c = hands[team][i];
      if (cardIsJoker(c)) continue;
      const score = c.attack + c.hp;             // raw power; refine later if we like
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx === -1) break;                   // nothing placeable left in hand
    const cell = aiPickCell(team, hands[team][bestIdx]);
    if (cell === null) break;                    // no room left (shouldn't happen)
    playCard(team, bestIdx, cell.x, cell.y);     // same entry point a human uses
  }
}
