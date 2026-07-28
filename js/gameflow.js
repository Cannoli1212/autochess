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

  // Phase D: fold the live result back into the SEATS, then run the two other
  // matchups headless so the whole table advances this round. Must run AFTER the live
  // steal/tax math above (it reads the post-round chips.player1/2).
  if (tableActive && tablePairing) {
    const oppName = seats[opponentSeat].name;
    const youBefore = seats[0].chips;
    seats[0].chips = chips.player1;              // your post-round stack
    seats[opponentSeat].chips = chips.player2;   // this round's opponent's stack
    const youDelta = seats[0].chips - youBefore; // net change to your stack this round
    let liveLine, liveTab;
    if (winner === "draw") { liveLine = "You drew " + oppName + " — no chips moved"; liveTab = "You vs " + oppName + " (draw)"; }
    else if (winner === "player1") { liveLine = "🏆 You beat " + oppName + " — won " + youDelta + " chips"; liveTab = "You ✓ vs " + oppName; }
    else { liveLine = "💀 " + oppName + " beat You — lost " + Math.abs(youDelta) + " chips"; liveTab = "You vs " + oppName + " ✓"; }

    // Phase D2: your fight is the first recording (captured live in the combat timer);
    // runHeadlessMatchups appends the other two. Then show the tab bar on tab 0 (yours).
    matchRecordings = [{ label: liveTab, frames: liveFrames }];
    runHeadlessMatchups(liveLine);               // fills tableRecap + appends 2 recordings
    viewingTab = 0;
    renderTable();
    renderMatchTabs();
    updateRoundInfo();                           // refresh standings NOW that seats are settled
  }

  if (roundNumber < MAX_ROUNDS) {
    // More rounds to play — reveal the Next Round button. Leftover cards now carry
    // automatically (no click-to-hold), so there's nothing to pick here.
    message.textContent =
      "Your unplayed card(s) carry to next round — press Next Round.";
    nextButton.style.display = "inline-block";
  } else {
    // That was the final round — decide the overall winner.
    endGame();
  }
}

// All rounds done: whoever has the most chips wins.
function endGame() {
  holdMode = false;             // no holding once the game is over

  // Phase D: at a full table the winner is simply the richest of the six seats
  // (no elimination — everyone played all MAX_ROUNDS rounds). Ties share the pot.
  if (tableActive) {
    const ranked = seats.slice().sort(function (a, b) { return b.chips - a.chips || a.id - b.id; });
    const top = ranked[0];
    const tied = ranked.filter(function (s) { return s.chips === top.chips; });
    const place = ranked.findIndex(function (s) { return s.isHuman; }) + 1;
    if (tied.length > 1) {
      turnStatus.textContent = "🤝 Split pot at " + top.chips + " chips — " +
        tied.map(function (s) { return s.name; }).join(" & ") + "!";
    } else {
      turnStatus.textContent = "🎉 " + top.name + " wins the table with " + top.chips +
        " chips!" + (top.isHuman ? " That's you!" : "  You finished " + ordinal(place) + ".");
    }
    message.textContent = "Press Reset Game to play again.";
    nextButton.style.display = "none";
    renderTable();
    return;
  }

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

  // Phase D: in table mode, pick this round's live opponent and load the two dueling
  // seats' stacks onto the player1/player2 sides BEFORE the AI places, so gold-scaling
  // abilities read the real seat chips. The opponent is a rotating seat; mechanically
  // the live fight is identical to the old 1-AI game — it's just "you vs seat N" now.
  if (tableActive) {
    pairRound();
    chips.player1 = seats[0].chips;
    chips.player2 = seats[opponentSeat].chips;
    weakCardsPlayed.player2 = 0;               // fresh opponent each round (your own tally persists)
  }

  // Part B step 1: if Player 2 is the computer, let the AI place its army now —
  // just before the fight, so the human sees the enemy board appear at Round Start
  // (it stays hidden during planning, like the real game will work). Render right
  // away so those units show before combat begins.
  if (player2IsAI && countUnits("player2") < armySize()) {
    aiMaybeReroll("player2");     // opponent reshapes a weak hand before committing
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
  clearFx();                     // and any effects still floating from the last one
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

  // Phase D2: record YOUR live fight tick-by-tick so it can be rewatched from the tab
  // bar alongside the other matchups. Snapshot the opening board, then one per tick.
  liveFrames = [];
  if (tableActive) liveFrames.push(snapshotFrame());

  // gameflow owns the combat loop: run a step every COMBAT_TICK_MS (config.js —
  // playback speed only, the engine is unchanged); when combatStep reports a
  // result (non-null), stop the loop and finish the round.
  combatTimer = setInterval(function () {
    const result = combatStep();
    if (tableActive) liveFrames.push(snapshotFrame());
    if (result !== null) {
      clearInterval(combatTimer);
      finishRound(result);
    }
  }, COMBAT_TICK_MS);
}

// Advance to the next round: clear the board; the placement limit rises by 1
// automatically because it equals roundNumber.
function nextRound() {
  clearMatchTabs();             // Phase D2: stop any replay + drop last round's recordings
  clearFx();                    // wipe any effects still floating from the fight just ended
  // Every unplayed leftover card carries into the next round automatically (holding
  // is no longer optional). We just clear any stale `held` flag; nothing is discarded
  // here — drawHands only tops the carried hand up to the new round's HAND_SCHEDULE.
  ["player1", "player2"].forEach(function (team) {
    hands[team].forEach(function (c) { c.held = false; });
  });
  holdMode = false;
  redrawsLeft = { player1: REDRAWS_PER_ROUND, player2: REDRAWS_PER_ROUND };  // fresh redraws

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
  // Community is RE-RANDOMIZED every round (it no longer persists): wipe the board and
  // give it a fresh deck, so growCommunity() deals a brand-new random flop/turn/river at
  // Round Start. Until then it stays face-down ("?"), hidden while you plan.
  flop = [];
  flopRevealed = false;
  initCommunityDeck();
  renderFlop();
  render();
  updateStatus();
  updateRoundInfo();
  drawHands();                  // top the carried hand up to this round's HAND_SCHEDULE
  renderTable();                // Phase D: keep the seat stacks on screen (no-op off-table)
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
  clearMatchTabs();             // Phase D2: stop any replay + drop recordings
  clearFx();                    // and clear the effect layer
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
  redrawsLeft = { player1: REDRAWS_PER_ROUND, player2: REDRAWS_PER_ROUND };  // fresh redraws
  initShoes();                  // fresh 2-deck shoe per player, empty discards
  initCommunityDeck();
  hideFlop();
  if (tableActive) makeLiveSeats();   // Phase D: fresh 6-seat table for the new game
  render();
  updateStatus();
  updateRoundInfo();
  drawHands();                  // deal fresh round-1 hands
  renderTable();                // Phase D: paint the reset seat stacks (no-op off-table)
}

// ── Phase D helpers (6-seat table) ────────────────────────────────────────────

// Pair the table for one round: you (seat 0) face a random other seat, and the
// remaining four split into the two headless matchups. No byes — all six seats always
// play (most-chips win condition, nobody is eliminated). `shuffle` lives in table.js.
function pairRound() {
  const others = shuffle([1, 2, 3, 4, 5]);
  opponentSeat = others[0];
  const rest = others.slice(1);              // the four seats you're NOT facing
  tablePairing = {
    opponentSeat: opponentSeat,
    headless: [[rest[0], rest[1]], [rest[2], rest[3]]],
  };
}

// Run this round's two OTHER matchups with no UI, folding each result into the seats.
// Bracketed by simInstall/simRestore (+ SIM_MODE) exactly like a balance scan, so the
// finished LIVE board (units, chips, hands, flop) is preserved and restored afterward —
// tableMatch stomps those same globals. `liveLine` is your own recap, shown first.
function runHeadlessMatchups(liveLine) {
  const size = armySize();                   // same army size as the live round just fought
  const saved = simInstall();                // swap live globals for a clean sandbox
  SIM_MODE = true;
  tableRecap = [liveLine];
  tablePairing.headless.forEach(function (pair) {
    const a = seats[pair[0]], b = seats[pair[1]];
    const frames = [];                       // Phase D2: capture this fight for replay
    const out = tableMatch(a, b, size, frames);   // settles the chip steal on the seat objects
    tableRecap.push(buildRecapLine(out, a, b));
    const tab = out.draw ? (a.name + " vs " + b.name + " (draw)")
      : (out.winnerId === a.id ? (a.name + " ✓ vs " + b.name) : (a.name + " vs " + b.name + " ✓"));
    matchRecordings.push({ label: tab, frames: frames });
  });
  SIM_MODE = false;
  simRestore(saved);                         // restore the player's real board
}

// One human-readable line for a headless matchup result.
function buildRecapLine(out, a, b) {
  if (out.draw) return a.name + " drew " + b.name + " — no chips moved";
  const w = (out.winnerId === a.id) ? a : b;
  const l = (out.winnerId === a.id) ? b : a;
  return w.name + " beat " + l.name + " — stole " + out.steal + " chips";
}

// 1 → "1st", 2 → "2nd", 3 → "3rd", ... for the end-of-game placement text.
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
