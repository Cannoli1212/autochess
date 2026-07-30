// placement.js — drag-and-drop input (the only player input).
// Owns input handling; wires drag events onto the cells that board.buildBoard
// created, plus the hand drop areas. Depends on: config, state, board, hands, hud.

// Attach all drag/drop handlers. Call AFTER buildBoard() has created the cells.
function initInput() {
  // Every board cell is a drop target (drop a card to play it) and, when it
  // holds a unit, draggable (drag it out to move it or return it to the hand).
  const cells = document.querySelectorAll(".cell");
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    cell.addEventListener("dragover", function (e) { e.preventDefault(); });
    cell.addEventListener("drop", function (e) {
      e.preventDefault();
      handleDropOnCell(cell);
    });
    cell.addEventListener("dragstart", function (e) {
      const ux = Number(cell.dataset.x);
      const uy = Number(cell.dataset.y);
      const u = findUnitAt(ux, uy);
      if (u === null) { e.preventDefault(); return; }  // empty cell: nothing to drag
      dragData = { kind: "unit", x: ux, y: uy, team: u.team };
      // Drag the UNIT's picture, not the square's. The browser makes the drag preview by
      // photographing the element you grabbed — which used to contain the glyph, and since
      // the motion pass contains nothing, so you'd be dragging a blank tile. Point it at
      // the unit's own shape instead; half a square puts the cursor at its middle.
      const node = unitNodeFor(u);
      if (node && e.dataTransfer && e.dataTransfer.setDragImage) {
        e.dataTransfer.setDragImage(node, CELL_PX / 2, CELL_PX / 2);
      }
    });
    // Plain click = mark/unmark an enemy square for the King of Clubs' airstrike.
    cell.addEventListener("click", function () {
      handleStrikeClick(Number(cell.dataset.x), Number(cell.dataset.y));
    });
  }

  // The WHOLE hand row is a drop target: drag a unit anywhere onto your bench row to
  // return it to hand. (Was the skinny `.cards` span, which collapses to near-zero
  // width when the hand is nearly empty — easy to miss. The full row is a big, fixed
  // hitbox.) We only accept a UNIT drag from THAT row's own team, and light the row
  // up while it's a valid target so you can see exactly where to drop.
  ["player1", "player2"].forEach(function (team) {
    const rowEl = document.querySelector('.hand-row[data-team="' + team + '"]');
    if (!rowEl) return;
    rowEl.addEventListener("dragover", function (e) {
      if (placementOpen && dragData && dragData.kind === "unit" && dragData.team === team) {
        e.preventDefault();                  // allow the drop
        rowEl.classList.add("bench-drop");   // highlight the landing zone
      }
    });
    rowEl.addEventListener("dragleave", function (e) {
      // Only clear when the pointer actually leaves the row (not when crossing a child).
      if (!rowEl.contains(e.relatedTarget)) rowEl.classList.remove("bench-drop");
    });
    rowEl.addEventListener("drop", function (e) {
      e.preventDefault();
      rowEl.classList.remove("bench-drop");
      handleDropOnHand(team);
    });
  });
}

// Which player's zone does a given row belong to?
function zoneOfRow(y) {
  if (y < 3) return "player2";
  if (y >= ROWS - 3) return "player1";
  return "neutral";
}

// May this card/unit legally sit on row y for `team`? Normally only that team's
// own colored zone. A card with a "place anywhere" unique (Ace of Spades) ignores
// the restriction and may go on ANY row — including the enemy's and the neutral
// middle. Takes a card-like object (card or unit; both have suit + rank).
function canPlaceAt(card, y, team) {
  if (zoneOfRow(y) === team) return true;
  return cardCanPlaceAnywhere(card);
}

// Something was dropped on a board cell.
function handleDropOnCell(cell) {
  if (!placementOpen) { dragData = null; return; }
  if (dragData === null) return;

  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);

  if (dragData.kind === "card") {
    playCard(dragData.team, dragData.index, x, y);
  } else if (dragData.kind === "unit") {
    moveUnit(dragData, x, y);
  }
  dragData = null;
}

// Turn a CARD into a board UNIT object at (x, y) for a team. One shared builder so
// every path that spawns a unit — a human/AI playing a card (playCard) AND a card
// summoned mid-combat by the Ace of Hearts (summonOnKill) — produces identical
// units. A unique may override a base STAT here: today only the Ace of Clubs, whose
// `range` field replaces the suit's range. `shield` starts empty and fills via the
// Ace of Diamonds' onKill hook (see combat.js for how it soaks damage).
function buildUnit(card, x, y, team) {
  const uniq = uniqueOf(card);
  // Range: a unique may hard-SET it (Ace of Clubs' `range`) and/or ADD to the base
  // (Queen of Hearts' `rangeBonus`). Apply the override first, then the bonus.
  let range = card.range;
  if (uniq && uniq.range !== undefined) range = uniq.range;
  if (uniq && uniq.rangeBonus !== undefined) range = range + uniq.rangeBonus;
  // Casting (pure mana-regen, Phase 1): a card with a cast ability becomes a caster —
  // its mana profile (manaMax / manaRegen / manaStart / castRange) is stamped onto the
  // unit here so the mana/cast pass in combatStep can build mana and fire onCast.
  // Non-casters leave `caster` false and skip the pass entirely.
  const castAbility = castAbilityOf(card);
  return {
    // The view's name tag for this unit (see nextUid in state.js). Not read by the engine.
    uid: nextUid++,
    x: x, y: y, attack: card.attack, hp: card.hp, maxHp: card.hp,
    range: range,
    suit: card.suit, rank: card.rank, team: team,
    // Attack speed: a unique may hard-SET it (Ace of Clubs' sniper 0.5), else the
    // suit's base (clubs 1.5, others 1). applySynergies re-derives this the same way
    // at Round Start, so keep the two in sync.
    attackSpeed: (uniq && uniq.attackSpeed !== undefined) ? uniq.attackSpeed : (SUITS[card.suit].attackSpeed || 1),
    abilities: unitAbilities(card),
    inert: cardIsInert(card),   // Target Dummy (rank 3): combatStep skips its turn — never moves/attacks
    fused: !!card.fused,        // a "made hand" (7-2): self-contained for poker (no pool feed / no of-a-kind buff)
    shield: 0,           // Ace of Diamonds' banked shield (a damage pool)
    invulnUntil: 0,      // tick until which the unit ignores all damage (Q♥ mourning)
    stunUntil: 0,        // tick until which the unit is STUNNED (no move/attack/cast) — see applyStun
    untargetableUntil: 0,// tick until which the unit can't be aggroed (Ace of Spades' drop-aggro) — nearestEnemy skips it
    atkBuffUntil: 0,     // tick until which auto-attacks are multiplied by atkBuffMult (King of Hearts' rally on Q♥)
    atkBuffMult: 1,      // the temporary outgoing-damage multiplier while the window above is open
    attackCharge: 0, moveCooldown: 0, card: card,
    // Mana meter (0 / undefined-ish for non-casters). castRange defaults to the unit's
    // attack range when the ability doesn't set its own. mana starts at manaStart.
    caster: !!castAbility,
    mana: castAbility ? (castAbility.manaStart || 0) : 0,
    manaMax: castAbility ? castAbility.manaMax : 0,
    manaRegen: castAbility ? (castAbility.manaRegen || 0) : 0,
    // Attack-mana model (Slice 2): mana gained per auto-attack. 0 = pure regen caster.
    manaPerAttack: castAbility ? (castAbility.manaPerAttack || 0) : 0,
    // BASE mana regen (2026-07-29): the trickle EVERY caster gets every tick, walking or
    // not — a fixed slice of its own bar (see BASE_MANA_FILL_TICKS). Baked here off the
    // card's manaMax so the cast pass just adds it; non-casters get 0 like the rest.
    baseManaRegen: castAbility ? (castAbility.manaMax || 0) / BASE_MANA_FILL_TICKS : 0,
    manaStart: castAbility ? (castAbility.manaStart || 0) : 0,
    castRange: castAbility ? (castAbility.castRange || range) : 0,
    // WHO the cast needs in range: "enemy" (Fireball, default), "self" (Trapline — fires
    // on a full bar with no target). The cast pass in combat.js branches on this.
    castTargeting: castAbility ? (castAbility.castTargeting || "enemy") : null,
    // Pure caster (Phase 3): moves into castRange but never auto-attacks — the mana/cast
    // pass is its only offense. Lighter than `inert` (which freezes a unit in place).
    noAutoAttack: !!(castAbility && castAbility.noAutoAttack),
    castsFired: 0,
    // Phase 4 visual flash tick-stamps: `castFlashUntil` (this unit is discharging a cast),
    // `spellHitUntil` (this unit just took spell damage). render() reads them vs tickCount.
    castFlashUntil: 0, spellHitUntil: 0, healFlashUntil: 0,
  };
}

// Play a card from a hand onto an empty cell in that player's zone.
function playCard(team, index, x, y) {
  const card = hands[team][index];
  if (!canPlaceAt(card, y, team)) {
    message.textContent = label(team) + " can only place on their own colored rows.";
    return;
  }
  if (findUnitAt(x, y) !== null) {
    message.textContent = "That square is already taken.";
    return;
  }
  if (!isPlaytest() && countUnits(team) >= armySize()) {   // playtest lifts the per-round cap
    message.textContent =
      label(team) + " has already placed all " + armySize() + " unit(s) this round.";
    return;
  }

  // Take the card out of the hand and turn it into a unit on the board.
  hands[team].splice(index, 1);              // remove 1 card at that position
  played[team].push(card);                   // track it as "on the board" this round
  // King of Spades fuel: tally low cards (ranks 2-5) played across the whole game.
  if (card.rank >= 2 && card.rank <= 5) weakCardsPlayed[team] = weakCardsPlayed[team] + 1;
  units.push(buildUnit(card, x, y, team));

  render();
  renderHands();
  updateStatus();
  updatePlacementMessage();
}

// Move a unit already on the board to another empty cell in its own zone.
function moveUnit(drag, x, y) {
  const u = findUnitAt(drag.x, drag.y);
  if (u === null) return;
  if (!canPlaceAt(u.card, y, drag.team)) {
    message.textContent = "You can only move units within your own zone.";
    return;
  }
  if (findUnitAt(x, y) !== null) {
    message.textContent = "That square is already taken.";
    return;
  }
  u.x = x;
  u.y = y;
  render();
  updateStatus();
}

// Something was dropped on a player's hand area — return that unit to the hand.
function handleDropOnHand(team) {
  if (!placementOpen) { dragData = null; return; }
  if (dragData !== null && dragData.kind === "unit") {
    if (dragData.team === team) {
      returnUnitToHand(dragData);
    } else {
      message.textContent = "That's the other player's unit.";
    }
  }
  dragData = null;
}

// Remove a unit from the board and give its owner a card back.
function returnUnitToHand(drag) {
  const u = findUnitAt(drag.x, drag.y);      // grab the unit before removing it
  units = units.filter(function (uu) {
    return !(uu.x === drag.x && uu.y === drag.y);
  });
  if (u !== null) {
    // Take the played card off the board and return the exact card to the hand.
    const pidx = played[drag.team].indexOf(u.card);
    if (pidx !== -1) played[drag.team].splice(pidx, 1);
    hands[drag.team].push(u.card);
  }
  render();
  renderHands();
  updateStatus();
  updatePlacementMessage();
}

// Mark or unmark an enemy square for the King of Clubs' blind airstrike. Player 1
// (the human) marks the enemy's zone during placement; the strike itself lands at
// Round Start (resolveStrikes). Multiplayer will generalize the fixed marker/enemy.
function handleStrikeClick(x, y) {
  if (!placementOpen) return;
  const marker = "player1";                        // the human
  const enemy = "player2";
  const allowance = strikeAllowance(marker);       // 0 unless a King of Clubs is fielded
  if (allowance <= 0) return;
  if (zoneOfRow(y) !== enemy) return;              // only the enemy's zone is targetable
  if (findUnitAt(x, y) !== null) return;           // never mark an occupied cell

  const marks = strikeMarks[marker];
  const idx = marks.findIndex(function (m) { return m.x === x && m.y === y; });
  if (idx !== -1) {
    marks.splice(idx, 1);                          // click a marked square again to clear it
  } else if (marks.length < allowance) {
    marks.push({ x: x, y: y });                    // add a mark, up to the allowance
  } else {
    message.textContent = "Airstrike: only " + allowance + " square(s) can be marked.";
    return;
  }
  render();
  updatePlacementMessage();
}

// Show the "ready" prompt once both players have placed their full army, plus the
// airstrike hint whenever Player 1 has a King of Clubs to spend marks on.
function updatePlacementMessage() {
  if (SIM_MODE) return;   // headless batch sim: skip DOM (see sim.js)
  // Playtest: ready as soon as BOTH sides have at least one unit (no fixed army size).
  if (isPlaytest()) {
    message.textContent = (countUnits("player1") >= 1 && countUnits("player2") >= 1)
      ? "Playtest army ready — press Round Start!"
      : "Playtest: place at least one unit on each side.";
    return;
  }
  // Against the computer only Player 1 needs to be placed (the AI fills its board
  // at Round Start); in two-human hotseat both armies must be ready.
  const p2Ready = player2IsAI || countUnits("player2") >= armySize();
  const allowance = strikeAllowance("player1");
  const strikeHint = allowance > 0
    ? "  ✕ Airstrike: click enemy (red) squares to mark (" +
      strikeMarks.player1.length + "/" + allowance + ")."
    : "";
  if (countUnits("player1") >= armySize() && p2Ready) {
    message.textContent = "Army ready — press Round Start!" + strikeHint;
  } else {
    message.textContent = strikeHint;
  }
}
