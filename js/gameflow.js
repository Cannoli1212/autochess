// gameflow.js — round/match loop + chip economy. Owns the combat interval.
// INVERSION #1: gameflow drives the combat loop and reacts to combatStep()'s
// returned result (combat no longer calls back into game flow).
// Depends on: config, state, flop, synergies, board, hands, hud, combat.

// A round is over: stop the battle, record who won, then continue or end game.
function finishRound(winner) {
  clearInterval(combatTimer);
  inCombat = false;
  startButton.disabled = true;

  if (winner === "draw") {
    turnStatus.textContent = "🤝 Round " + roundNumber + " is a draw — no chips change hands!";
  } else {
    roundWins[winner] = roundWins[winner] + 1;   // add a point for the winner

    // Phase C: steal chips based on margin of victory (the winner's survivors).
    // Jack of Diamonds' loot fattens the haul (teamLootMult) before the loser-cap.
    const loser = (winner === "player1") ? "player2" : "player1";
    const survivors = countUnits(winner);
    const lootMult = teamLootMult(winner);
    const steal = Math.min(Math.round(survivors * CHIPS_PER_SURVIVOR * (1 + lootMult)), chips[loser]);
    chips[winner] = chips[winner] + steal;
    chips[loser] = chips[loser] - steal;

    // B6.1 chunk 3: the "7-2 game" — winning with a 7 AND a 2 in your pool
    // (cards you played this round + the flop) steals bonus chips. Capped so the
    // loser still can't go below 0 (chips[loser] is already the post-steal total).
    const winnerPool = played[winner].concat(flop);
    let bonus = 0;
    if (hasSevenTwo(winnerPool)) {
      bonus = Math.min(SEVEN_TWO_BONUS, chips[loser]);
      chips[winner] = chips[winner] + bonus;
      chips[loser] = chips[loser] - bonus;
    }

    // Fusion payoff: a FUSED made-hand the winner PLAYED pays its own bigger bonus
    // (its economy identity — see FUSABLE_HANDS.bonusChips). Separate from the loose
    // 7-2 above and capped at the loser's now-remaining chips (never below 0).
    let fusedBonus = Math.min(fusedHandBonus(winner), chips[loser]);
    if (fusedBonus > 0) {
      chips[winner] = chips[winner] + fusedBonus;
      chips[loser] = chips[loser] - fusedBonus;
    }

    turnStatus.textContent = "🏆 " + label(winner) + " wins round " + roundNumber +
      " with " + survivors + " unit(s) left — steals " + steal + " chips!" +
      (bonus > 0 ? "  🃏 7-2 bonus: +" + bonus + " chips!" : "") +
      (fusedBonus > 0 ? "  ✨ Made-hand bonus: +" + fusedBonus + " chips!" : "");
  }
  // Queen of Spades — the Black Lady: any player still holding her (or another
  // houseTax card) at round end is bled to the house. Clamped so chips never go
  // negative; applies to BOTH sides and recurs each round she's held. Runs after the
  // win/steal math so the results banner can tack the tax note on the end.
  let taxNote = "";
  ["player1", "player2"].forEach(function (team) {
    const owed = Math.min(handTax(team), chips[team]);
    if (owed > 0) {
      chips[team] = chips[team] - owed;
      house = house + owed;
      taxNote += "  ♠Q " + label(team) + " bled " + owed + " chips to the house!";
    }
  });
  turnStatus.textContent = turnStatus.textContent + taxNote;

  updateRoundInfo();

  if (roundNumber < MAX_ROUNDS) {
    // More rounds to play — reveal the Next Round button.
    // Phase E: open hold mode so players can click leftover cards to keep them.
    // holdLimit = the round just played (roundNumber, before nextRound bumps it).
    holdMode = true;
    renderHands();               // redraw hands so they become clickable-to-hold
    message.textContent =
      "Click any leftover card(s) to hold for next round, then press Next Round.";
    nextButton.style.display = "inline-block";
  } else {
    // That was the final round — decide the overall winner.
    endGame();
  }
}

// All rounds done: whoever has the most chips wins.
function endGame() {
  holdMode = false;             // no holding once the game is over
  let result;
  if (chips.player1 > chips.player2) {
    result = "🎉 Player 1 (blue) wins — " + chips.player1 + " vs " + chips.player2 +
      " chips (up " + (chips.player1 - chips.player2) + ")!";
  } else if (chips.player2 > chips.player1) {
    result = "🎉 Player 2 (red) wins — " + chips.player2 + " vs " + chips.player1 +
      " chips (up " + (chips.player2 - chips.player1) + ")!";
  } else {
    result = "🤝 Dead even at " + chips.player1 + " chips each — push!";
  }
  turnStatus.textContent = result;
  message.textContent = "Press Reset Game to play again.";
  nextButton.style.display = "none";
}

// King of Clubs' Airstrike: with both armies now on the board, destroy any enemy
// unit standing on a square its opponent marked during planning. Marks are clamped
// to the striker's live allowance (removing the King voids them) and then consumed.
// Returns how many units were destroyed, for the Round-Start banner.
function resolveStrikes() {
  let killed = 0;
  ["player1", "player2"].forEach(function (team) {
    const enemy = (team === "player1") ? "player2" : "player1";
    const marks = strikeMarks[team].slice(0, strikeAllowance(team));
    marks.forEach(function (m) {
      const u = findUnitAt(m.x, m.y);
      if (u && u.team === enemy) { u.hp = 0; killed = killed + 1; }
    });
  });
  if (killed > 0) units = units.filter(function (u) { return u.hp > 0; });
  strikeMarks = { player1: [], player2: [] };   // marks are single-use
  return killed;
}

// Pressing the button starts the fight — but only when both armies are placed.
function startRound() {
  if (inCombat) return;                        // already fighting

  // Part B step 1: if Player 2 is the computer, let the AI place its army now —
  // just before the fight, so the human sees the enemy board appear at Round Start
  // (it stays hidden during planning, like the real game will work). Render right
  // away so those units show before combat begins.
  if (player2IsAI && countUnits("player2") < armySize()) {
    aiPlaceUnits("player2");
    render();
  }

  if (isPlaytest()) {
    // Playtest: no fixed army size — just need at least one unit on each side to fight.
    if (countUnits("player1") < 1 || countUnits("player2") < 1) {
      message.textContent = "Playtest: place at least one unit on EACH side, then Round Start.";
      return;
    }
  } else if (countUnits("player1") < armySize() || countUnits("player2") < armySize()) {
    message.textContent =
      "Place all your units first — " + armySize() + " each this round.";
    return;
  }
  inCombat = true;
  placementOpen = false;         // lock the board once the fight begins
  tickCount = 0;
  traps = [];                    // clear any traplines from a prior fight
  resetRoundStats();             // zero the live damage panel for this fight
  startButton.disabled = true;

  // Phase E (holds): unplayed cards NO LONGER discard here — they stay in the
  // hand through the fight so the player can pick which to hold on the results
  // screen. They're discarded (or kept) in nextRound() instead.

  // Phase A: TOP UP the community board to this round's target. This reveals the
  // round's new card — the flop (R1), turn (R4), or river (R6) — that was hidden
  // during planning. On the "stays" rounds the board is already full, so it's a
  // no-op. Cards from earlier rounds were already face-up while you planned.
  growCommunity();
  renderSynergies();

  // King of Clubs' Airstrike: the enemy army has appeared — destroy any enemy unit
  // caught on a marked square BEFORE synergies bake on the survivors (so the dead
  // don't count toward the enemy's suit/poker bonuses).
  const struck = resolveStrikes();

  // B5.2: bake each team's suit synergies into their units, then redraw so the
  // boosted stats are visible as the fight begins.
  applySynergies();

  // Rank abilities that fire once as the fight begins (Rally). Run AFTER
  // applySynergies so an aura multiplies the already-buffed attack numbers.
  for (let i = 0; i < units.length; i++) {
    runAbilityHook(units[i], "onRoundStart", {});
  }

  render();

  message.textContent = "";
  turnStatus.textContent = (struck > 0 ? "✕ Airstrike hit " + struck + " unit(s)! " : "") + "⚔️ Fight!";

  // gameflow owns the combat loop: run a step every 500ms; when combatStep
  // reports a result (non-null), stop the loop and finish the round.
  combatTimer = setInterval(function () {
    const result = combatStep();
    if (result !== null) {
      clearInterval(combatTimer);
      finishRound(result);
    }
  }, 500);
}

// Advance to the next round: clear the board; the placement limit rises by 1
// automatically because it equals roundNumber.
function nextRound() {
  // Phase E: keep each player's HELD leftover cards; discard the rest.
  ["player1", "player2"].forEach(function (team) {
    const kept = [];
    hands[team].forEach(function (c) {
      // Held by choice, OR a hot potato that can't be discarded (Queen of Spades):
      // either way it carries into the next hand. Everything else is discarded.
      if (c.held || cardCannotDiscard(c)) { c.held = false; kept.push(c); }
      else { discard[team].push(c); }                // unheld leftovers get discarded
    });
    hands[team] = kept;
  });
  holdMode = false;             // hold window closes for this round

  // Phase D: cards played this round (the whole board) go to the discard piles.
  discard.player1 = discard.player1.concat(played.player1);
  discard.player2 = discard.player2.concat(played.player2);
  played.player1 = [];
  played.player2 = [];

  roundNumber = roundNumber + 1;
  units = [];
  strikeMarks = { player1: [], player2: [] };   // last round's airstrike marks clear
  inCombat = false;
  placementOpen = true;         // players may edit the board again
  tickCount = 0;
  startButton.disabled = false;
  nextButton.style.display = "none";
  message.textContent = "";
  // Phase A: the community PERSISTS across rounds — do NOT wipe it. Just repaint so
  // the new round shows the cards dealt so far face-up (known while you plan) plus
  // any pending back (the turn/river reveal still to come this round).
  renderFlop();
  render();
  updateStatus();
  updateRoundInfo();
  drawHands();                  // deal fresh hands (2 x the new round number)
}

// Playtest mode: drop a hand-picked card (any suit+rank) into a team's hand so you can
// drag-place it and test specific interactions. Reuses makeCardOf + the normal hand/drag
// flow, so the placed unit behaves exactly like a drafted one.
function addPlaytestCard(team, suit, rank) {
  hands[team].push(makeCardOf(suit, rank));
  renderHands();
  message.textContent =
    "Playtest: added " + rankLabel(rank) + SUITS[suit].symbol + " to " + label(team) +
    "'s hand — drag it onto their zone.";
}

// Reset the WHOLE game back to round 1 with a clean scoreboard.
function resetGame() {
  clearInterval(combatTimer);   // stop any battle that's running
  units = [];
  strikeMarks = { player1: [], player2: [] };
  roundNumber = 1;
  roundWins = { player1: 0, player2: 0 };
  chips = { player1: 100, player2: 100 };
  house = 0;                                       // the casino's pot empties
  weakCardsPlayed = { player1: 0, player2: 0 };   // King of Spades' scaling resets
  resetAllStats();                                 // clear round + session damage totals
  inCombat = false;
  placementOpen = true;
  holdMode = false;
  tickCount = 0;
  startButton.disabled = false;
  nextButton.style.display = "none";
  message.textContent = "";
  hands = { player1: [], player2: [] };  // empty hands (drawHands now appends)
  initShoes();                  // fresh 2-deck shoe per player, empty discards
  initCommunityDeck();
  hideFlop();
  render();
  updateStatus();
  updateRoundInfo();
  drawHands();                  // deal fresh round-1 hands
}
