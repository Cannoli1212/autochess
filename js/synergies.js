// synergies.js — suit-count synergy detection + buff application.
// Depends on: config, state, flop.

// How many units of a suit a team currently has placed.
function suitCount(team, suit) {
  return units.filter(function (u) {
    return u.team === team && u.suit === suit;
  }).length;
}

// Effective suit count for synergies = a team's own units of that suit PLUS the
// shared community flop's cards of that suit (Phase E). Used for the display
// AND the actual buffs, so both stay in sync.
function effectiveSuitCount(team, suit) {
  return suitCount(team, suit) + flopCount(suit);
}

// Which synergy tier a count unlocks: 5 (flush), 3, 2, or 0 (none). Breakpoints
// 2/3/5 (Riley, 2026-07-15, was 2/4/5) — the middle tier now unlocks at three.
function synergyTier(count) {
  if (count >= 5) return 5;
  if (count >= 3) return 3;
  if (count >= 2) return 2;
  return 0;
}

// Redraw both players' synergy panels (suit auras AND poker hands).
function renderSynergies() {
  renderOneSynergy("player1");
  renderOneSynergy("player2");
  renderPokerHands();
}

// ── B6.1: poker-hand detection (reads RANKS) ───────────────────────────────

// The poker "pool" for a team: the ranks of its placed units PLUS the shared
// flop cards (Texas Hold'em — units are hole cards, flop is community). The flop
// is empty while hidden during placement, so the pool is just units until Round
// Start reveals it — same timing as the suit synergies above.
function pokerPool(team) {
  const ranks = [];
  // Fused "made hands" are self-contained (Riley, 2026-07-14): a 7-2 does NOT add
  // a 7 or a 2 to the pool, so it can't complete other units' pairs / Doyle.
  units.forEach(function (u) { if (u.team === team && !u.fused) ranks.push(u.rank); });
  flop.forEach(function (c) { ranks.push(c.rank); });
  return ranks;
}

// The best STRAIGHT in a rank-count map (from rankCounts): the LONGEST run of
// consecutive ranks each present at least once, so long as it reaches the small-
// straight breakpoint of 3. Returns the run as an array of ranks (high → low), or
// null if the longest run is under 3. The caller reads run.length for the tier —
// 5+ = a full straight, 3–4 = a small straight (see POKER_HANDS.shaped.straight).
// An Ace (14) also plays LOW as 1 so the wheel A-2-3-4-5 counts, like real poker;
// a low ace in the run is mapped back to 14 so the buff finds your Ace units. Ties
// on length go to the HIGHER run (the better straight).
function bestStraight(counts) {
  const present = {};
  Object.keys(counts).forEach(function (r) { if (counts[r] >= 1) present[Number(r)] = true; });
  if (present[14]) present[1] = true;                      // ace plays low
  let best = null;
  let r = 1;
  while (r <= 14) {
    if (!present[r]) { r++; continue; }
    const start = r;
    while (present[r + 1]) r++;                             // extend the run
    const len = r - start + 1;                             // run spans [start .. r]
    if (len >= 3 && (best === null || len > best.len || (len === best.len && r > best.top))) {
      best = { start: start, top: r, len: len };
    }
    r++;
  }
  if (best === null) return null;
  const run = [];
  for (let k = best.top; k >= best.start; k--) run.push(k === 1 ? 14 : k);   // high → low
  return run;
}

// A FULL HOUSE in a rank-count map: three of one rank AND two of a DIFFERENT rank.
// Returns [tripsRank, pairRank] (both the highest available), or null. Distinct ranks
// are required — a single rank with 5+ copies is quads (capped), not a full house.
function fullHouseRanks(counts) {
  const ranks = Object.keys(counts).map(Number).sort(function (a, b) { return b - a; });
  let trips = null;
  for (let i = 0; i < ranks.length; i++) { if (counts[ranks[i]] >= 3) { trips = ranks[i]; break; } }
  if (trips === null) return null;
  let pair = null;
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== trips && counts[ranks[i]] >= 2) { pair = ranks[i]; break; }
  }
  return (pair === null) ? null : [trips, pair];
}

// True if a set of cards contains at least one 7 AND at least one 2 (the "7-2").
// Used by finishRound to award the 7-2 chip bonus (B6.1 chunk 3).
function hasSevenTwo(cards) {
  const has7 = cards.some(function (c) { return c.rank === 7; });
  const has2 = cards.some(function (c) { return c.rank === 2; });
  return has7 && has2;
}

// Tally how many times each rank appears: { rank: count, ... }.
function rankCounts(ranks) {
  const counts = {};
  ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
  return counts;
}

// Redraw both players' poker panels.
function renderPokerHands() {
  renderOnePoker("player1");
  renderOnePoker("player2");
}

// Show one player's active poker hands as chips (detection + display only —
// no combat buffs yet; that's the next chunk).
function renderOnePoker(team) {
  const el = document.getElementById("poker-" + team);
  el.innerHTML = "";
  let anyActive = false;

  const counts = rankCounts(pokerPool(team));

  // Of-a-kind: any rank appearing 2+ times → pair / trips / quads. Show the
  // biggest hands first (highest rank breaks ties).
  const ranks = Object.keys(counts).map(Number).sort(function (a, b) {
    return counts[b] - counts[a] || b - a;
  });
  ranks.forEach(function (rank) {
    let n = counts[rank];
    if (n < 2) return;
    if (n > 4) n = 4;                          // cap at quads
    const info = POKER_HANDS.ofAKind[n];
    anyActive = true;
    const chip = document.createElement("span");
    chip.className = "synergy-chip";
    chip.innerHTML =
      "<b>" + info.label + " of " + rankLabel(rank) + "</b> " + info.text;
    el.appendChild(chip);
  });

  // Named hands: active when ALL their required ranks are present in the pool.
  Object.keys(POKER_HANDS.named).forEach(function (key) {
    const hand = POKER_HANDS.named[key];
    const has = hand.ranks.every(function (r) { return (counts[r] || 0) >= 1; });
    if (!has) return;
    anyActive = true;
    const chip = document.createElement("span");
    chip.className = "synergy-chip";
    chip.innerHTML = "<b>" + hand.label + "</b> " + hand.text;
    el.appendChild(chip);
  });

  // Shaped hands (straight / full house) — per-card on the forming cards. Detected the
  // SAME way pokerBuffs applies them, so the panel and the buffs always agree. (Flush is
  // NOT here — it's the suit synergy panel; a straight flush shows a Straight chip here
  // AND a suit FLUSH chip there.)
  const straightRun = bestStraight(counts);
  if (straightRun) {
    anyActive = true;
    const cfg = POKER_HANDS.shaped.straight;
    const full = straightRun.length >= 5;
    const tier = full ? cfg.full : cfg.small;
    const buffed = full ? straightRun.slice(0, 5) : straightRun;   // a full straight is the top 5
    const seq = buffed.slice().reverse().map(function (r) { return rankLabel(r); }).join("-");
    const chip = document.createElement("span");
    chip.className = "synergy-chip";
    chip.innerHTML = "<b>" + (full ? cfg.label : "Small " + cfg.label) + " (" + seq + ")</b> " + tier.text;
    el.appendChild(chip);
  }

  const fh = fullHouseRanks(counts);
  if (fh) {
    anyActive = true;
    const info = POKER_HANDS.shaped.fullHouse;
    const chip = document.createElement("span");
    chip.className = "synergy-chip";
    chip.innerHTML = "<b>" + info.label + " (" + rankLabel(fh[0]) + " over " + rankLabel(fh[1]) + ")</b> " + info.text;
    el.appendChild(chip);
  }

  if (!anyActive) el.textContent = "—";        // nothing active yet
}

// Show one player's active suit synergies as chips.
function renderOneSynergy(team) {
  const el = document.getElementById("synergy-" + team);
  el.innerHTML = "";
  let anyActive = false;

  for (let i = 0; i < SUIT_NAMES.length; i++) {
    const suit = SUIT_NAMES[i];
    const count = effectiveSuitCount(team, suit);
    const tier = synergyTier(count);
    if (tier === 0) continue;            // need at least 2 of a suit

    anyActive = true;
    const info = SYNERGIES[suit];
    const chip = document.createElement("span");
    chip.className = "synergy-chip";
    // If an enemy Queen extinguished this suit, show it struck through so the panel
    // matches what actually happens in combat (teamSynergyEffects skips it).
    if (isSuitExtinguished(team, suit)) {
      chip.style.opacity = "0.5";
      chip.style.textDecoration = "line-through";
      chip.innerHTML =
        '<b style="color:' + info.color + '">' + info.label + "×" + count + "</b> " +
        info.tiers[tier].text + " — extinguished";
    } else {
      chip.innerHTML =
        '<b style="color:' + info.color + '">' + info.label + "×" + count + "</b> " +
        info.tiers[tier].text;
    }
    el.appendChild(chip);
  }

  if (!anyActive) el.textContent = "—";   // nothing active yet
}

// Work out a team's combined synergy effects from its suit counts.
function teamSynergyEffects(team) {
  const eff = { hpMult: 0, atkMult: 0, critBonus: 0, speedBonus: 0 };
  for (let i = 0; i < SUIT_NAMES.length; i++) {
    const suit = SUIT_NAMES[i];
    if (isSuitExtinguished(team, suit)) continue;   // an enemy Queen snuffed this suit's flush
    const tier = synergyTier(effectiveSuitCount(team, suit));
    if (tier === 0) continue;
    const t = SYNERGIES[suit].tiers[tier];
    // All four suit synergies are team-wide (Part 1).
    if (t.hpMult !== undefined) eff.hpMult = t.hpMult;             // hearts
    if (t.atkMult !== undefined) eff.atkMult = t.atkMult;          // diamonds
    if (t.critBonus !== undefined) eff.critBonus = t.critBonus;    // spades
    if (t.speedBonus !== undefined) eff.speedBonus = t.speedBonus; // clubs
  }
  return eff;
}

// B6.1 chunk 2: per-card poker buffs. Returns a map { rank: {atkMult, hpMult} }
// of buffs to ADD on top of the team-wide suit buffs. Scope is per-card: only
// units whose rank matches get the boost (suits = team auras, poker = spikes).
function pokerBuffs(team) {
  const buffs = {};   // { rank: {atkMult,hpMult} } — every poker hand is now rank-keyed
  const counts = rankCounts(pokerPool(team));

  // Of-a-kind: a rank appearing 2+ times buffs every unit of that rank.
  Object.keys(counts).forEach(function (rank) {
    let n = counts[rank];
    if (n < 2) return;
    if (n > 4) n = 4;                          // cap at quads
    const t = POKER_HANDS.ofAKind[n];
    addPokerBuff(buffs, rank, t.atkMult, t.hpMult);
  });

  // Named — Doyle Brunson (a 10 AND a 2 in the pool): buff your 10 & 2 units.
  const doyle = POKER_HANDS.named.doyle;
  const hasDoyle = doyle.ranks.every(function (r) { return (counts[r] || 0) >= 1; });
  if (hasDoyle) {
    doyle.ranks.forEach(function (r) { addPokerBuff(buffs, r, doyle.atkMult, doyle.hpMult); });
  }

  // Shaped hands (Riley, 2026-07-15). Each buffs ONLY the cards that form it, and
  // STACKS on top of the above (a straight through your trips still gets its of-a-kind).
  // Straight: longest run; 5+ = full straight (buff the top 5), 3–4 = small straight.
  const run = bestStraight(counts);
  if (run) {
    const cfg = POKER_HANDS.shaped.straight;
    const full = run.length >= 5;
    const tier = full ? cfg.full : cfg.small;
    const buffed = full ? run.slice(0, 5) : run;
    buffed.forEach(function (r) { addPokerBuff(buffs, r, tier.atkMult, tier.hpMult); });
  }
  // Full house: buff the trips rank AND the pair rank.
  const fh = fullHouseRanks(counts);
  if (fh) {
    const f = POKER_HANDS.shaped.fullHouse;
    fh.forEach(function (r) { addPokerBuff(buffs, r, f.atkMult, f.hpMult); });
  }
  // (No flush here — a flush is the suit synergy, applied team-wide in applySynergies.)
  return buffs;
}

// Accumulate a buff for a rank so hands can stack — e.g. Doyle on top of an of-a-kind,
// or a straight on top of your trips.
function addPokerBuff(buffs, rank, atkMult, hpMult) {
  if (!buffs[rank]) buffs[rank] = { atkMult: 0, hpMult: 0 };
  buffs[rank].atkMult += atkMult;
  buffs[rank].hpMult += hpMult;
}

// B5.2 + B6.1: bake both teams' synergies into their units, just before combat.
function applySynergies() {
  ["player1", "player2"].forEach(function (team) {
    const eff = teamSynergyEffects(team);
    const poker = pokerBuffs(team);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.team !== team) continue;
      const base = SUITS[u.suit];

      // This unit's poker spike (0/0 if its rank matched nothing). ADDED to the
      // team suit multipliers below — NOT overwriting them (the clobber gotcha).
      // A fused made-hand is self-contained: it takes NO poker buff (its power is
      // its taxed stats + doubled abilities + economy, not stacked rank spikes).
      const pb = u.fused ? { atkMult: 0, hpMult: 0 } : (poker[u.rank] || { atkMult: 0, hpMult: 0 });

      // HP = base × (1 + hearts team buff + this unit's poker HP buff). Start full.
      u.maxHp = Math.round(u.maxHp * (1 + eff.hpMult + pb.hpMult));
      u.hp = u.maxHp;

      // Attack = base × (1 + diamonds team buff + this unit's poker attack buff).
      u.attack = Math.round(u.attack * (1 + eff.atkMult + pb.atkMult));

      // Spades (team-wide): crit chance = this unit's own crit + team bonus.
      u.critChance = Math.min(1, (base.crit || 0) + eff.critBonus);

      // Clubs (team-wide): attack speed = this unit's base speed + team bonus. A
      // unique may override the base (Ace of Clubs' sniper 0.5) — read it the same
      // way buildUnit does so the two agree. Reset attack charge for a fresh fight.
      const uSpeedUniq = uniqueOf(u);
      const baseSpeed = (uSpeedUniq && uSpeedUniq.attackSpeed !== undefined)
        ? uSpeedUniq.attackSpeed : (base.attackSpeed || 1);
      u.attackSpeed = baseSpeed + eff.speedBonus;
      u.attackCharge = 0;
      // Casting: reset the mana bar to its opener each fight (like attackCharge), so a
      // caster never carries a full bar between rounds.
      if (u.caster) u.mana = u.manaStart || 0;
    }
  });
}
