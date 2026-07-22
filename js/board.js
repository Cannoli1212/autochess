// board.js — the grid itself + render() units onto squares.
// Owns grid LOGIC only; input handlers live in placement.js (initInput).
// Depends on: config, state, cards.

// Find the cell element at a given x,y coordinate.
function cellAt(x, y) {
  return document.querySelector('.cell[data-x="' + x + '"][data-y="' + y + '"]');
}

// Find the unit standing at x,y (or null if that square is empty).
function findUnitAt(x, y) {
  for (let i = 0; i < units.length; i++) {
    if (units[i].x === x && units[i].y === y) return units[i];
  }
  return null;
}

// Redraw the whole board from the units array. The array is the TRUTH;
// the board is just a picture of it. Clear every cell, then draw each unit.
function render() {
  if (SIM_MODE) return;   // headless batch sim: skip all DOM work (see sim.js)
  const allCells = document.querySelectorAll(".cell");
  for (let i = 0; i < allCells.length; i++) {
    allCells[i].innerHTML = "";
    allCells[i].classList.remove("unit-player1", "unit-player2", "unique", "fused", "strike-mark", "casting", "spell-hit", "healed", "trap-sprung", "trap-player1", "trap-player2");
    allCells[i].draggable = false;            // empty cells can't be dragged
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const cell = cellAt(u.x, u.y);
    const su = SUITS[u.suit];
    // Health bar: how full is this unit's HP? maxHp is set when the unit is made
    // (and again by applySynergies), so hp/maxHp is a 0..1 fraction of health left.
    // Clamp to 0..1 so a poison overkill or a buff quirk can't overflow the bar.
    const frac = Math.max(0, Math.min(1, u.hp / u.maxHp));
    const pct = Math.round(frac * 100);
    // Green when healthy, yellow when hurt, red when nearly dead — read at a glance.
    const barColor = frac > 0.5 ? "#4caf50" : (frac > 0.25 ? "#ffb300" : "#e53935");
    // Draw the unit as its rank + suit, a health bar, then attack / current-health.
    // A fused unit shows both parts (7♠2♦) via the shared glyph helper (reads u.card).
    const figInner = u.fused ? fusedGlyphHTML(u.card, "unitColor") : (rankLabel(u.rank) + su.symbol);
    // Mana bar (Phase 4): casters only. mana/manaMax as a blue fill under the HP bar.
    const manaBar = u.caster
      ? '<div class="manabar"><div class="manabar-fill" style="width:' +
        Math.round(Math.min(1, u.mana / u.manaMax) * 100) + '%"></div></div>'
      : '';
    // Shield bar (casting, Riley 2026-07-15): shown ONLY when the unit carries a shield pool
    // (rank-5 Ward / Ace of Diamonds' Aegis). A TALLER steel-white bar with the exact shield
    // NUMBER centered ON it (not in the HP stat line), so armor reads as its own separate thing —
    // you can SEE it soak hits before HP drops. Width = shield/maxHp clamped at 100% (shields
    // stack past a full bar — a full white bar just means "≥ one health bar of shield").
    const shieldBar = (u.shield > 0)
      ? '<div class="shieldbar"><div class="shieldbar-fill" style="width:' +
        Math.round(Math.min(1, u.shield / u.maxHp) * 100) + '%"></div>' +
        '<span class="shield-amt">' + u.shield + '</span></div>'
      : '';
    cell.innerHTML =
      '<div class="fig" style="color:' + su.unitColor + '">' + figInner + '</div>' +
      '<div class="hpbar"><div class="hpbar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
      shieldBar +
      manaBar +
      '<div class="stat">' + u.attack + " / " + u.hp + '</div>';
    cell.classList.add("unit-" + u.team);
    if (uniqueOf(u)) cell.classList.add("unique");   // legendary → purple glow
    if (u.fused) cell.classList.add("fused");        // made hand → green glow
    // Cast flashes (Phase 4): tick-stamps set in combat.js light the cell for one tick.
    if (tickCount < (u.castFlashUntil || 0)) cell.classList.add("casting");   // mage discharging
    if (tickCount < (u.spellHitUntil || 0)) cell.classList.add("spell-hit");  // fireball impact
    if (tickCount < (u.healFlashUntil || 0)) cell.classList.add("healed");    // Cleric mend (green)
    if (tickCount < (u.trapSprungUntil || 0)) cell.classList.add("trap-sprung"); // stepped on a trap
    if (tickCount < (u.stunUntil || 0)) cell.classList.add("stunned");           // frozen (purple)
    if (tickCount < (u.atkBuffUntil || 0)) cell.classList.add("buffed");          // K♥ rally on Q♥ (gold) — lingers while active
    if (tickCount < (u.untargetableUntil || 0)) cell.classList.add("vanished");   // Ace of Spades hidden (faded) — lingers while active
    cell.title = figureTitle(u);
    cell.draggable = true;                     // a cell with a unit can be dragged
  }

  // Airstrike marks (King of Clubs): overlay a red ✕ on each marked square so the
  // player sees their blind targets. State owns the marks; the board just draws them.
  const marks = strikeMarks.player1.concat(strikeMarks.player2);
  for (let i = 0; i < marks.length; i++) {
    const cell = cellAt(marks[i].x, marks[i].y);
    if (!cell) continue;
    cell.classList.add("strike-mark");
    if (cell.innerHTML === "") {
      cell.innerHTML = '<div class="fig" style="color:#ff5252">✕</div>';
    }
  }

  // Traplines (rank 8): overlay each live trap on its cell, colored by owner team, so
  // the player can see the hazard field. State owns the traps; the board just draws them.
  // Drawn UNDER units — a trap on a cell an enemy is standing on still shows the unit's
  // glyph (the trap sprang this tick anyway), so only add the marker to empty cells.
  for (let i = 0; i < traps.length; i++) {
    const trap = traps[i];
    const cell = cellAt(trap.x, trap.y);
    if (!cell) continue;
    cell.classList.add("trap-" + trap.team);
    if (cell.innerHTML === "") {
      cell.innerHTML = '<div class="trap-glyph">✵</div>';
    }
  }

  renderDmgPanel();   // keep the live damage tracker in lockstep with the board
}

// Build the grid: column/row coordinate labels + the ROWS×COLS cells.
// (Drag handlers are attached separately by placement.initInput.)
function buildBoard() {
  // Tell the CSS grid its columns: a narrow first column for row numbers,
  // then COLS board columns of 56px.
  board.style.gridTemplateColumns = "26px repeat(" + COLS + ", 56px)";

  // Top row of coordinate labels: an empty corner, then a number per column.
  const corner = document.createElement("div");
  corner.className = "coord-label";
  board.appendChild(corner);
  for (let cx = 0; cx < COLS; cx++) {
    const colLabel = document.createElement("div");
    colLabel.className = "coord-label";
    colLabel.textContent = String.fromCharCode(65 + cx);  // 0→A, 1→B, ...
    board.appendChild(colLabel);
  }

  // For every row: add a row-number label, then walk across every column
  // creating one cell each. 8 rows x 8 cols = 64 cells.
  for (let y = 0; y < ROWS; y++) {
    const rowLabel = document.createElement("div");
    rowLabel.className = "coord-label";
    rowLabel.textContent = ROWS - y;      // top row = 8 ... bottom row = 1 (chess style)
    board.appendChild(rowLabel);

    for (let x = 0; x < COLS; x++) {
      // Make a new empty square.
      const cell = document.createElement("div");
      cell.className = "cell";

      // Remember this cell's coordinates.
      cell.dataset.x = x;
      cell.dataset.y = y;

      // Tint the home rows: top 3 rows = Player 2, bottom 3 rows = Player 1.
      if (y < 3) {
        cell.classList.add("player2-zone");
      } else if (y >= ROWS - 3) {
        cell.classList.add("player1-zone");
      }

      // Add the finished cell to the board on the page.
      board.appendChild(cell);
    }
  }
}
