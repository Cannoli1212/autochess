// gameflow.js — round/match loop + chip economy. Owns the combat interval.
// INVERSION #1: gameflow drives the combat loop and reacts to combatStep()'s
// returned result (combat no longer calls back into game flow).
// Depends on: config, state, flop, synergies, board, hands, hud, combat.

// A round is over: stop the battle, record who won, then continue or end game.
function finishRound(winner) {
  clearInterval(combatTimer);
  inCombat = false;
  traps = [];                   // the fight is over — un-sprung bombs come off the board with it
  render();                     // nothing else repaints here, and the glyphs are drawn from `traps`
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

    // The Highwayman at four Jacks (teamLootSkim) takes his cut off the top even when the
    // job goes bad: the LOSER claws back a fraction of what was just taken. A transfer out
    // of the winner's stack, not minted chips, so the table's conservation check still
    // balances — and capped at the winner's stack for the same reason the steal is capped
    // at the loser's. 0 for everyone below quads, so this line is inert until then.
    const skim = Math.min(Math.round(steal * teamLootSkim(loser)), chips[winner]);
    if (skim > 0) {
      chips[winner] = chips[winner] - skim;
      chips[loser] = chips[loser] + skim;
    }

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
      (fusedBonus > 0 ? "  ✨ Made-hand bonus: +" + fusedBonus + " chips!" : "") +
      // Without this the loser's stack would simply be higher than the announced steal,
      // with nothing on screen saying why — a silent refund is worse than no refund.
      (skim > 0 ? "  ♦J Highwayman skims " + skim + " back for " + label(loser) + "!" : "");
  }
  // Queen of Spades — the Black Lady: any player still holding her (or another
  // houseTax card) at round end is bled to the house. Clamped so chips never go
  // negative; applies to BOTH sides and recurs each round she's held. Runs after the
  // win/steal math so the results banner can tack the tax note on the end.
  //
  // OF-A-KIND (face-card pass): from a pair she also works in REVERSE once FIELDED — the
  // enemy bleeds instead, and at quads ("shooting the moon") that doubles and her owner
  // stops paying the house at all. Both directions drain to `house`, the same neutral sink
  // the held penalty always used, so nothing is minted and no stack can go negative.
  let taxNote = "";
  ["player1", "player2"].forEach(function (team) {
    const enemy = (team === "player1") ? "player2" : "player1";

    const owed = houseTaxImmune(team) ? 0 : Math.min(handTax(team), chips[team]);
    if (owed > 0) {
      chips[team] = chips[team] - owed;
      house = house + owed;
      taxNote += "  ♠Q " + label(team) + " bled " + owed + " chips to the house!";
    }

    // Passing the Black Lady along. Reads `team`'s FIELDED queens and bills the enemy —
    // clamped at the enemy's stack for the same reason the held penalty is clamped.
    const passed = Math.min(blackLadyDrain(team), chips[enemy]);
    if (passed > 0) {
      chips[enemy] = chips[enemy] - passed;
      house = house + passed;
      taxNote += "  ♠Q " + label(team) + " passes the Black Lady — " + label(enemy) +
                 " bleeds " + passed + " chips to the house!";
    }
  });
  turnStatus.textContent = turnStatus.textContent + taxNote;

  // ── Comps: the shop currency ────────────────────────────────────────────────
  // MINTED, not stolen — nothing is deducted from anyone, so this can't push a stack
  // negative and needs none of the clamping the chip math above does. Both players
  // always earn COMPS_INCOME (so a losing streak still funds a reroll to dig out of
  // it); the round winner earns COMPS_WIN_BONUS on top. A draw pays income only.
  //
  // Position matters: this sits AFTER the house-tax loop because that's the only
  // block above that touches both players regardless of who won, and BEFORE the seat
  // write-back below — which is what actually persists these values onto the seats.
  // A DRAW counts as a loss for nobody: compsOnLoss (The Cocktail Waitress) pays only
  // on a round you actually lost, so a draw pays plain income like it always has.
  ["player1", "player2"].forEach(function (team) {
    const lost = winner !== "draw" && team !== winner;
    const enemy = (team === "player1") ? "player2" : "player1";
    comps[team] = comps[team] + COMPS_INCOME + (team === winner ? COMPS_WIN_BONUS : 0) +
      jokerSum(team, "compsPerRound") +                          // The Regular and friends
      (lost ? jokerSum(team, "compsOnLoss") : 0) +               // The Cocktail Waitress
      // The Enforcer / Dead Man's Hand. Your KILLS are the enemy's death count, and your
      // losses are your own — one tally, read from both ends.
      jokerTriggerComps(jokers[team], roundDeaths[enemy], roundDeaths[team]);
  });
  turnStatus.textContent = turnStatus.textContent +
    "  " + COMPS_ICON + " +" + COMPS_INCOME + " " + COMPS_LABEL.toLowerCase() + " each" +
    (winner === "draw" ? "." : " (+" + COMPS_WIN_BONUS + " more to " + label(winner) + ").");

  // The ramp jokers bank this round's growth. Must run while `played` still holds the board
  // that fought — nextRound consumes it (returning the Bagman's survivors, discarding the
  // rest), so this can't wait until then.
  ["player1", "player2"].forEach(function (team) { bankJokerGrowth(team); });

  updateRoundInfo();

  // Phase D: fold the live result back into the SEATS, then run the two other
  // matchups headless so the whole table advances this round. Must run AFTER the live
  // steal/tax math above (it reads the post-round chips.player1/2).
  if (tableActive && tablePairing) {
    const oppName = seats[opponentSeat].name;
    const youBefore = seats[0].chips;
    seats[0].chips = chips.player1;              // your post-round stack
    seats[opponentSeat].chips = chips.player2;   // this round's opponent's stack
    seats[0].comps = comps.player1;              // ...and the shop money each just earned
    seats[opponentSeat].comps = comps.player2;
    seats[0].jokers = jokers.player1;
    seats[opponentSeat].jokers = jokers.player2;
    const youDelta = seats[0].chips - youBefore; // net change to your stack this round
    let liveLine, liveTab;
    if (winner === "draw") { liveLine = "You drew " + oppName + " — no chips moved"; liveTab = "You vs " + oppName + " (draw)"; }
    else if (winner === "player1") { liveLine = "🏆 You beat " + oppName + " — won " + youDelta + " chips"; liveTab = "You ✓ vs " + oppName; }
    else { liveLine = "💀 " + oppName + " beat You — lost " + Math.abs(youDelta) + " chips"; liveTab = "You vs " + oppName + " ✓"; }

    // Phase D2: your fight is the first recording (captured live in the combat timer);
    // runHeadlessMatchups appends the other two. Then show the tab bar on tab 0 (yours).
    matchRecordings = [{ label: liveTab, frames: liveFrames }];
    runHeadlessMatchups(liveLine);               // fills tableRecap + appends 2 recordings
    // Every AI seat takes its shop turn once the round is fully settled — after BOTH the
    // live payout above and the headless payouts inside runHeadlessMatchups, so a seat
    // spends the comps it actually finished the round with.
    for (let i = 1; i < seats.length; i++) aiSeatShop(seats[i]);
    comps.player2 = seats[opponentSeat].comps;   // your opponent may have just spent; keep the badge honest
    jokers.player2 = seats[opponentSeat].jokers;
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
      if (u && u.team === enemy) {
        // Airstrike kills happen HERE, outside combatStep — which is why they were the one
        // kind of death in the game that left no ghost. The unit's HP went to zero and the
        // next render simply found an empty square, so a whole unit blinked out of
        // existence with nothing to say it had been bombed. Emit the same death event
        // combatStep does, so a struck unit topples and sinks like any other.
        emitFx("death", { x: u.x, y: u.y, uid: u.uid, suit: u.suit, rank: u.rank, fused: u.fused, card: u.card });
        u.hp = 0;
        killed = killed + 1;
      }
    });
  });
  if (killed > 0) units = units.filter(function (u) { return u.hp > 0; });
  strikeMarks = { player1: [], player2: [] };   // marks are single-use
  return killed;
}

// Pressing the button starts the fight — but only when both armies are placed.
function startRound() {
  if (inCombat) return;                        // already fighting
  tapSel = null;                               // drop any tap-to-place selection before the fight

  // Phase D: in table mode, pick this round's live opponent and load the two dueling
  // seats' stacks onto the player1/player2 sides BEFORE the AI places, so gold-scaling
  // abilities read the real seat chips. The opponent is a rotating seat; mechanically
  // the live fight is identical to the old 1-AI game — it's just "you vs seat N" now.
  if (tableActive) {
    pairRound();
    chips.player1 = seats[0].chips;
    chips.player2 = seats[opponentSeat].chips;
    // Chips are PULLED from both seats: nothing changes them between rounds, so the
    // seat is the source of truth for both sides.
    //
    // Comps and jokers are different, and the direction matters. You SPEND comps and
    // CLAIM jokers during PLACEMENT — before this runs — so pulling seat 0's copies
    // here would overwrite everything you just did and silently refund it. Your side
    // is therefore PUSHED to the seat; only the opponent (a different seat each round,
    // which nothing local has touched) is pulled.
    seats[0].comps = comps.player1;
    seats[0].jokers = jokers.player1;
    comps.player2 = seats[opponentSeat].comps;
    jokers.player2 = seats[opponentSeat].jokers;
    renderJokers();
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
  traps = [];                    // belt-and-braces: finishRound already emptied these
  clearFx();                     // and any effects still floating from the last one
  resetRoundStats();             // zero the live damage panel for this fight
  startButton.disabled = true;

  // Phase E (holds): unplayed cards NO LONGER discard here — they stay in the
  // hand through the fight so the player can pick which to hold on the results
  // screen. They're discarded (or kept) in nextRound() instead.

  // Deal this round's community board. DEALT, not yet SHOWN: growCommunity no longer
  // renders — flopReveal (below) owns the reveal, so the cards can't appear face-up in
  // the row before the cinematic has turned them over.
  growCommunity();

  // King of Clubs' Airstrike: the enemy army has appeared — destroy any enemy unit
  // caught on a marked square BEFORE synergies bake on the survivors (so the dead
  // don't count toward the enemy's suit/poker bonuses).
  //
  // Moved AHEAD of the reveal (it used to sit just below): an enemy airstrike can kill
  // one of YOUR units, and the hand the reveal calls out must not be built on a unit
  // that's already dead. Its own ordering constraint is untouched — applySynergies
  // still runs after it, down in beginFight. The render() picks up the casualties so
  // the board underneath the reveal is honest; the strike's queued fx still drain at
  // playFx() as the fight opens, which is exactly where those death ghosts belong.
  const struck = resolveStrikes();
  render();

  // THE REVEAL (flopreveal.js). Everything from here to the first combat tick now
  // happens inside a callback: the community board is dealt as a cinematic and the
  // fight begins when it lands. There's no async anywhere in this codebase, so this is
  // a plain continuation rather than a promise — and flopReveal guarantees it fires
  // exactly once on every path (headless, switched off via FLOP_REVEAL_SPEED, skipped
  // by a click, or played in full). inCombat and the disabled start button are already
  // set above, so nothing can re-enter startRound while the show is running.
  flopReveal(function () { beginFight(struck); });
}

// The second half of starting a round: bake every buff, paint the board, and run the
// combat loop. Split out of startRound so the flop reveal can sit between the two.
// Nothing in here was reordered — it's the same sequence it always was, just deferred
// until the reveal is done. renderSynergies in particular has to be on THIS side of the
// seam: run any earlier and the trait sidebar would name your hand while the community
// cards were still face-down.
function beginFight(struck) {
  renderSynergies();

  // B5.2: bake each team's suit synergies into their units, then redraw so the
  // boosted stats are visible as the fight begins.
  applySynergies();

  // FREEZE the poker pool for the round (face-card pass). Taken here, with the flop
  // revealed and the full army still standing, because this is the last moment the pool
  // describes the army that is about to fight — the death filter starts eating it on the
  // first tick. finishRound's of-a-kind reads (loot, the Black Lady's tax) count off this.
  ["player1", "player2"].forEach(function (team) { roundPool[team] = pokerPool(team); });

  // Rank abilities that fire once as the fight begins (Rally). Run AFTER
  // applySynergies so an aura multiplies the already-buffed attack numbers.
  for (let i = 0; i < units.length; i++) {
    runAbilityHook(units[i], "onRoundStart", {});
  }

  // Jokers bake LAST, after synergies and every round-start ability, so a joker that
  // scales the army multiplies the finished number rather than a half-built one —
  // the same ordering reason Rally runs after applySynergies.
  const hrP1 = applyJokerRoundStart("player1");   // kept: the banner reports YOUR multiplier
  applyJokerRoundStart("player2");                // the opponent's applies just the same, silently

  render();
  // Drain the queue NOW rather than letting the first combat tick do it. Everything above
  // this line — the airstrike's deaths, and every round-start buff (the Bowers, Midas,
  // Warlord's Levy, Rally) — emitted outside the combat loop, and playFx is only otherwise
  // called from inside it. Left alone, those effects would sit queued for a full 800ms and
  // then paint over a board where units have already moved, pointing at the wrong squares.
  // clearFx() ran earlier in this function, so this drains only what round start produced.
  playFx();

  message.textContent = "";
  const hrNote = hrP1 > 1 ? "  💎 High Roller: your army swings at " + Math.round(hrP1 * 100) + "%." : "";
  turnStatus.textContent = (struck > 0 ? "✕ Airstrike hit " + struck + " unit(s)! " : "") + "⚔️ Fight!" + hrNote;

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
  flopRevealAbort();            // and any half-played reveal, WITHOUT starting its fight
  jokerOfferAbort();            // and any unanswered joker offer — its hand is about to
                                // be topped up anyway, and drawHands re-offers below
  tapSel = null;                // and any tap-to-place selection from last round
  roundPool = { player1: [], player2: [] };   // last round's frozen poker pool is spent;
                                // empty again means "we are between rounds", so
                                // packCountForRank goes back to reading the live pool
  // Every unplayed leftover card carries into the next round automatically (holding
  // is no longer optional). We just clear any stale `held` flag; nothing is discarded
  // here — drawHands only tops the carried hand up to the new round's HAND_SCHEDULE.
  ["player1", "player2"].forEach(function (team) {
    hands[team].forEach(function (c) { c.held = false; });
  });
  holdMode = false;
  jokerSwapPending = null;      // an unfinished joker swap doesn't survive the round
  jokerActionPending = null;    // nor a half-finished activation (The Tailor)
  jokerUsedThisRound = { player1: [], player2: [] };   // activated jokers recharge each round
  jokerSuitPick = { player1: null, player2: null };    // last round's Dealer call is spent
  packOffer = null;             // nor an unopened pick — the comps are spent either way
  rerollsBought = { player1: 0, player2: 0 };   // reroll prices reset with the free redraws
  // Fresh redraws, widened by any joker that grants extras (The Mechanic).
  redrawsLeft = {
    player1: REDRAWS_PER_ROUND + jokerSum("player1", "redrawBonus"),
    player2: REDRAWS_PER_ROUND + jokerSum("player2", "redrawBonus"),
  };

  // Phase D: cards played this round (the whole board) go to the discard piles — except
  // any THE BAGMAN keeps, which go back to the hand instead. Retained cards must be picked
  // while `units` still holds the survivors, so this runs before the board is cleared below.
  // A retained card counts toward this round's hand target like a carried leftover does
  // (drawHands only tops up), so it replaces a draw rather than adding to it.
  ["player1", "player2"].forEach(function (team) {
    // THE CARD SHARP goes FIRST, while the hand is still only the cards that sat out the
    // round. Aging after the Bagman's returns would pay a survivor for a round it spent
    // fighting on the board, which is the opposite of what "unplayed" means.
    applyJokerCardAging(team);

    const kept = jokerRetainedCards(team);
    played[team].forEach(function (c) {
      // HAND_CAP is the bench ceiling: a full board coming home could otherwise push the
      // hand past it. Anything over the cap discards as normal rather than being lost.
      if (kept.indexOf(c) !== -1 && hands[team].length < HAND_CAP) hands[team].push(c);
      else discard[team].push(c);
    });
    played[team] = [];
  });

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
  renderJokers();
  renderPackOffer();            // packOffer was cleared above — hide the row with it
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
  // Belt and braces: the dim swallows clicks during a reveal (they skip it instead), so
  // Reset can't normally land mid-show — but if a reveal is somehow still up, tear the
  // stage down. Abort, not finish: the discarded round's fight must never start.
  flopRevealAbort();
  jokerOfferAbort();             // same belt and braces for an unanswered joker offer
  units = [];
  strikeMarks = { player1: [], player2: [] };
  tapSel = null;                // no tap-to-place selection survives a new game
  roundNumber = 1;
  roundWins = { player1: 0, player2: 0 };
  chips = { player1: 100, player2: 100 };
  comps = { player1: 0, player2: 0 };              // shop money doesn't carry between games
  jokers = { player1: [], player2: [] };           // ...nor does the joker collection
  jokerSwapPending = null;
  jokerActionPending = null;
  jokerUsedThisRound = { player1: [], player2: [] };
  jokerSuitPick = { player1: null, player2: null };
  rankGrowth = { player1: {}, player2: {} };       // banked growth is per-GAME, so a new game clears it
  suitGrowth = { player1: {}, player2: {} };
  packOffer = null;
  rerollsBought = { player1: 0, player2: 0 };
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
  renderJokers();
  renderPackOffer();
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
  // These two fights get REPLAYED on the watch tabs, so keep their effects even though
  // they run headless (week 3). This is the only place the flag is ever turned on:
  // simTableScan and sim.js don't touch it, so batch balance scans stay as cheap as ever.
  RECORD_FX = true;
  tableRecap = [liveLine];
  tablePairing.headless.forEach(function (pair) {
    const a = seats[pair[0]], b = seats[pair[1]];
    const frames = [];                       // Phase D2: capture this fight for replay
    const out = tableMatch(a, b, size, frames);   // settles the chip steal on the seat objects
    // Comps for the two seats that just fought headless. The live pair were already paid
    // in finishRound, so between the two paths all six seats earn every round — without
    // this, the four background seats would never be able to buy anything and the whole
    // table economy would be yours alone.
    // seatA fought as player1 and seatB as player2 (see tableMatch), so each seat's KILLS
    // are the other side's death count.
    const d = out.deaths || { player1: 0, player2: 0 };
    paySeatComps(a, { won: out.winnerId === a.id, lost: !out.draw && out.winnerId !== a.id,
                      kills: d.player2, deaths: d.player1 });
    paySeatComps(b, { won: out.winnerId === b.id, lost: !out.draw && out.winnerId !== b.id,
                      kills: d.player1, deaths: d.player2 });
    tableRecap.push(buildRecapLine(out, a, b));
    const tab = out.draw ? (a.name + " vs " + b.name + " (draw)")
      : (out.winnerId === a.id ? (a.name + " ✓ vs " + b.name) : (a.name + " vs " + b.name + " ✓"));
    matchRecordings.push({ label: tab, frames: frames });
  });
  RECORD_FX = false;
  SIM_MODE = false;
  // simInstall/simRestore don't know about the fx queue, so tidy it here: the last tick of
  // the last headless matchup leaves its events behind, and they must not leak onto the
  // live board or into the first frame of the next fight.
  fxEvents = [];
  lastTickFx = [];
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
