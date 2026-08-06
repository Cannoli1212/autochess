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

// Redraw the live synergy display. There used to be a second set of per-player
// chip lists under the hands (renderOneSynergy / renderOnePoker); they said the
// same thing as the sidebar and were removed with the elements they wrote into,
// so the trait bar is now the one place suits and poker hands are shown.
function renderSynergies() {
  renderTraitBar();
}

// ── TFT-style LEFT trait sidebar (Riley, 2026-07-22) ───────────────────────
// YOUR (player1) live traits, lit as you field units — sits left of the board so it
// never covers gameplay. Two sections: SUIT traits (the team synergies, breakpoints
// 2/3/5) and POKER (the of-a-kind ladder pair→trips→quads plus any named/shaped
// hands). Every row reuses the SAME detectors as the combat buffs and the bottom
// panel (effectiveSuitCount / synergyTier / rankCounts / bestStraight / …), so the
// three displays can never disagree. Hover a row for a tooltip of every breakpoint
// with the active tier highlighted; tooltips open to the LEFT, into empty margin.

// Pretty-print a suit key as its capitalized name ("hearts" → "Hearts").
function suitName(suit) { return suit.charAt(0).toUpperCase() + suit.slice(1); }

// Build one trait row element from its parts. Shared by the suit and poker sections.
//   pips: [{ label, hit, cur }]  — the breakpoint chips (hit = reached, cur = active tier)
function traitRowEl(symbolText, symbolColor, nameHTML, pips, tooltipHTML, active) {
  const row = document.createElement("div");
  row.className = "trait-row" + (active ? " active" : " inactive");

  const sym = document.createElement("div");
  sym.className = "trait-sym";
  if (symbolColor) sym.style.color = symbolColor;
  sym.textContent = symbolText;
  row.appendChild(sym);

  const body = document.createElement("div");
  body.className = "trait-body";
  const name = document.createElement("div");
  name.className = "trait-name";
  name.innerHTML = nameHTML;
  body.appendChild(name);

  const pipWrap = document.createElement("div");
  pipWrap.className = "trait-pips";
  pips.forEach(function (p) {
    const el = document.createElement("span");
    el.className = "pip" + (p.hit ? " hit" : "") + (p.cur ? " cur" : "");
    el.textContent = p.label;
    pipWrap.appendChild(el);
  });
  body.appendChild(pipWrap);
  row.appendChild(body);

  const tip = document.createElement("div");
  tip.className = "trait-tooltip";
  tip.innerHTML = tooltipHTML;
  row.appendChild(tip);

  return row;
}

// Redraw the whole left sidebar for player1.
function renderTraitBar() {
  const bar = document.getElementById("traitBar");
  if (!bar) return;                         // SIM_MODE / older pages have no sidebar
  const team = "player1";
  bar.innerHTML = "";

  // ── Suit traits ─────────────────────────────────────────────────────────
  const suitTitle = document.createElement("div");
  suitTitle.className = "trait-section-title";
  suitTitle.textContent = "Suit traits";
  bar.appendChild(suitTitle);

  for (let i = 0; i < SUIT_NAMES.length; i++) {
    const suit = SUIT_NAMES[i];
    const info = SYNERGIES[suit];
    const count = effectiveSuitCount(team, suit);
    const tier = synergyTier(count);
    const extinguished = isSuitExtinguished(team, suit);
    const active = tier > 0 && !extinguished;

    // Breakpoint pips: 2 / 3 / 5, lit once your count reaches each; the active tier
    // (highest reached) gets the extra "cur" outline.
    const pips = [2, 3, 5].map(function (bp) {
      return { label: bp, hit: count >= bp && !extinguished, cur: tier === bp && !extinguished };
    });

    // Tooltip: every tier's effect, active one highlighted, dimmer ones as "what you'd
    // get" if you add more of the suit.
    let tip = '<div class="tip-head" style="color:' + info.color + '">' +
              info.label + " " + suitName(suit) + " · " + count + " fielded</div>";
    [2, 3, 5].forEach(function (bp) {
      const on = tier === bp && !extinguished;
      tip += '<div class="tip-tier' + (on ? " on" : "") + (count >= bp ? " reached" : "") + '">' +
             '<b>' + bp + (bp === 5 ? " · Flush" : "") + '</b> ' + info.tiers[bp].text + '</div>';
    });
    if (extinguished) tip += '<div class="tip-note">Extinguished by an enemy Queen this round.</div>';

    const nameHTML = suitName(suit) + ' <span class="trait-count">×' + count + '</span>' +
                     (extinguished ? ' <span class="trait-off">off</span>' : '');
    bar.appendChild(traitRowEl(info.label, info.color, nameHTML, pips, tip, active));
  }

  // ── Poker traits ────────────────────────────────────────────────────────
  renderPokerTraits(bar, team);
}

// The poker section of the sidebar: an of-a-kind ladder row per repeated rank (so you
// see pair→trips→quads), plus a compact row for each active named/shaped hand.
// Rank 2's of-a-kind reward is the Berserker ABILITY now, not the flat +atk/HP stat
// buff (see pokerBuffs' rank-2 guard + abilities.js `berserker`). So the poker chips /
// tooltips must NOT print "+50% atk/HP" for a pair/trips/quads of 2s — they'd lie. This
// returns the correct rung text: the Berserker ladder for rank 2, the generic of-a-kind
// text for everyone else. `rung` is the of-a-kind count clamped to 2/3/4.
const BERSERKER_RUNG_TEXT = {
  2: "unlock + HP · ramp when hurt · shields on cast",
  3: "+more HP/ramp · bigger shield/cast",
  4: "+big HP · biggest shield/cast",
};
// Rank 3 of-a-kind text (redesigned 2026-07-22): a pair/trips/quads of 3s rewards BOTH
// the flat HP buff (still applied by pokerBuffs — keep advertising it) AND the Thorns
// reflect %, which now SCALES with the of-a-kind count (see RANK_ABILITIES[3] tiers). Both
// numbers are read LIVE from their source (POKER_HANDS.ofAKind for HP, the thorns tiers for
// reflect) so the tooltip can never drift from the actual buffs when either is retuned.
function thornsRungText(rung) {
  const hp = Math.round(POKER_HANDS.ofAKind[rung].hpMult * 100);
  const thorns = RANK_ABILITIES[3].find(function (a) { return a.kind === "thorns"; });
  const reflect = Math.round(thorns.tiers[rung].reflect * 100);
  return "+" + hp + "% HP · reflect " + reflect + "% of damage";
}
// Rank 8 of-a-kind text (redesigned 2026-07-23): a pair/trips/quads of 8s still gets the flat
// +atk/HP buff (pokerBuffs keeps applying it — keep advertising it) AND the redesigned Bulwark/
// trap ladder. DR CLIMBS every rung and the trap CAST unlocks at a pair, grows at trips, and
// becomes a full line at quads. The DR number is read LIVE from RANK_ABILITIES[8]'s bulwark tiers
// so the tooltip can never drift from the actual reduction when it's retuned. `rung` is 2/3/4.
function bulwarkRungText(rung) {
  const hp = Math.round(POKER_HANDS.ofAKind[rung].hpMult * 100);
  const bulwark = RANK_ABILITIES[8].find(function (a) { return a.kind === "bulwark"; });
  const dr = bulwark.tiers[rung].reduce;
  const trap = { 2: "traps unlock", 3: "more traps", 4: "trap line across" }[rung];
  return "+" + hp + "% HP · −" + dr + " dmg taken · " + trap;
}
// Rank 9 of-a-kind text (redesigned 2026-08-05): a pair/trips/quads of 9s still gets the flat
// +atk/HP buff (pokerBuffs keeps applying it — keep advertising it) AND the redesigned poison
// ladder. The per-tick STACK climbs every rung, the CAST unlocks at a pair and grows its reach,
// and the PLAGUE jump turns on at trips (half stacks) then goes full at quads. Stack and plague
// are read LIVE from RANK_ABILITIES[9]'s poison tiers so the tooltip can never drift. `rung` is 2/3/4.
function poisonRungText(rung) {
  const hp = Math.round(POKER_HANDS.ofAKind[rung].hpMult * 100);
  const poison = RANK_ABILITIES[9].find(function (a) { return a.kind === "poison"; });
  const t = poison.tiers[rung];
  const cast = { 2: "cast unlocks", 3: "longer reach", 4: "widest reach" }[rung];
  const plague = t.transferPct
    ? " · plague " + Math.round(t.transferPct * 100) + "%"
    : "";
  return "+" + hp + "% HP · " + t.stackDamage + " poison/tick · " + cast + plague;
}
// Rank 10 of-a-kind text (redesigned 2026-08-05): a pair/trips/quads of 10s still gets the flat
// +atk/HP buff (pokerBuffs keeps applying it — keep advertising it) AND a stronger Rally aura.
// The awkward bit is that the chip is per-RANK while Rally's magnitude is per-SUIT — the four 10s
// have four separate ladders — so print all four, in the suit order the ability entry lists them.
// Note the two buffs land on DIFFERENT units: the flat +HP on the 10s themselves, the rally on
// their NEIGHBORS. Every number is read LIVE off RANK_ABILITIES[10] so the tooltip can't drift.
function rallyRungText(rung) {
  const hp = Math.round(POKER_HANDS.ofAKind[rung].hpMult * 100);
  const rally = RANK_ABILITIES[10].find(function (a) { return a.kind === "rally"; });
  const pct = function (suit, key) {
    return Math.round(rally.suits[suit].tiers[rung][key] * 100);
  };
  return "+" + hp + "% HP · rally: +" + pct("hearts", "hpMult") + "% HP / +"
    + pct("spades", "critBonus") + "% crit / +" + pct("clubs", "speedMult") + "% spd / "
    + pct("diamonds", "lifestealPct") + "% drain";
}
function ofAKindText(rank, rung) {
  if (Number(rank) === 2) return BERSERKER_RUNG_TEXT[rung];
  if (Number(rank) === 3) return thornsRungText(rung);
  if (Number(rank) === 8) return bulwarkRungText(rung);
  if (Number(rank) === 9) return poisonRungText(rung);
  if (Number(rank) === 10) return rallyRungText(rung);
  return POKER_HANDS.ofAKind[rung].text;
}

function renderPokerTraits(bar, team) {
  const pokerTitle = document.createElement("div");
  pokerTitle.className = "trait-section-title";
  pokerTitle.textContent = "Poker hands";
  bar.appendChild(pokerTitle);

  const counts = rankCounts(pokerPool(team));
  let any = false;

  // Of-a-kind ladders (biggest first). The pips 2/3/4 are the pair/trips/quads rungs.
  Object.keys(counts).map(Number)
    .sort(function (a, b) { return counts[b] - counts[a] || b - a; })
    .forEach(function (rank) {
      const n = counts[rank];
      if (n < 2) return;
      any = true;
      const shown = Math.min(n, 4);
      const info = POKER_HANDS.ofAKind[shown];
      const pips = [2, 3, 4].map(function (k) {
        return { label: k, hit: n >= k, cur: shown === k };
      });
      let tip = '<div class="tip-head">' + rankLabel(rank) + "s · " + n + " in pool</div>";
      [2, 3, 4].forEach(function (k) {
        const t = POKER_HANDS.ofAKind[k];
        const on = shown === k;
        tip += '<div class="tip-tier' + (on ? " on" : "") + (n >= k ? " reached" : "") + '">' +
               '<b>' + t.label + " · " + k + '</b> ' + ofAKindText(rank, k) + '</div>';
      });
      const nameHTML = info.label + " of " + rankLabel(rank) +
                       ' <span class="trait-count">×' + n + '</span>';
      bar.appendChild(traitRowEl("🂠", "#cdd6e5", nameHTML, pips, tip, true));
    });

  // Named hands (Doyle, 7-2): active when all their ranks are present.
  Object.keys(POKER_HANDS.named).forEach(function (key) {
    const hand = POKER_HANDS.named[key];
    const has = hand.ranks.every(function (r) { return (counts[r] || 0) >= 1; });
    if (!has) return;
    any = true;
    const tip = '<div class="tip-head">' + hand.label + '</div>' +
                '<div class="tip-tier on reached">' + hand.text + '</div>';
    bar.appendChild(traitRowEl("★", "#ffd76b", hand.label, [{ label: "✓", hit: true, cur: true }], tip, true));
  });

  // Shaped hands (straight / full house) — detected the same way pokerBuffs applies them.
  const run = bestStraight(counts);
  if (run) {
    any = true;
    const cfg = POKER_HANDS.shaped.straight;
    const full = run.length >= 5;
    const t = full ? cfg.full : cfg.small;
    const seq = (full ? run.slice(0, 5) : run).slice().reverse()
      .map(function (r) { return rankLabel(r); }).join("-");
    const label = (full ? cfg.label : "Small " + cfg.label);
    const tip = '<div class="tip-head">' + label + " (" + seq + ")</div>" +
                '<div class="tip-tier on reached">' + t.text + '</div>';
    bar.appendChild(traitRowEl("➜", "#9ecbff", label, [{ label: "✓", hit: true, cur: true }], tip, true));
  }
  const fh = fullHouseRanks(counts);
  if (fh) {
    any = true;
    const info = POKER_HANDS.shaped.fullHouse;
    const tip = '<div class="tip-head">' + info.label + " (" + rankLabel(fh[0]) + " over " + rankLabel(fh[1]) + ")</div>" +
                '<div class="tip-tier on reached">' + info.text + '</div>';
    bar.appendChild(traitRowEl("🂠", "#2ecc71", info.label, [{ label: "✓", hit: true, cur: true }], tip, true));
  }

  if (!any) {
    const empty = document.createElement("div");
    empty.className = "trait-empty";
    empty.textContent = "No poker hands yet";
    bar.appendChild(empty);
  }
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

  // THE UNDERSTUDY (joker): a WILD card in the pool. It RESOLVES to a concrete rank here,
  // before the pool is returned, which is what keeps this from being the invasive change it
  // looks like — rankCounts, bestStraight, fullHouseRanks, packCount and renderPokerTraits
  // all keep reading a plain number[] and need no changes at all.
  //
  // It resolves to the rank the team has MOST of, so it extends your biggest group. That's
  // the dominant use of a wild here by a wide margin, because of-a-kind count doesn't just
  // pay stats — via packCount it GATES and TIERS every rank ability, so turning a pair into
  // trips is worth more than any straight. Re-picked after each wild, so two Understudies
  // both pile onto the (now larger) group rather than splitting.
  const wilds = jokerSum(team, "wildCards");
  for (let i = 0; i < wilds; i++) {
    const r = mostCommonRank(ranks);
    if (r === null) break;                 // nothing on the board yet: a wild has nothing to copy
    ranks.push(r);
  }
  return ranks;
}

// The rank appearing most often in `ranks`, ties going to the HIGHER rank (the same
// tie-break bestStraight uses). Null for an empty pool. Only The Understudy needs this.
function mostCommonRank(ranks) {
  if (ranks.length === 0) return null;
  const counts = rankCounts(ranks);
  let bestRank = null, bestCount = 0;
  Object.keys(counts).forEach(function (key) {
    const r = Number(key), n = counts[key];
    if (n > bestCount || (n === bestCount && r > bestRank)) { bestRank = r; bestCount = n; }
  });
  return bestRank;
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

// NOTE: renderOnePoker / renderPokerHands / renderOneSynergy used to live here.
// They wrote per-player chip lists into #poker-<team> and #synergy-<team> under
// the hands. Those elements are gone, and the trait sidebar (renderTraitBar /
// renderPokerTraits above) already shows the same information beside the board.
// The DETECTION helpers they used — pokerPool, rankCounts, bestStraight,
// fullHouseRanks, ofAKindText, effectiveSuitCount, isSuitExtinguished — all stay:
// the sidebar and pokerBuffs read them, which is what keeps the display and the
// combat buffs agreeing.

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
    if (Number(rank) === 2) return;   // 2s' of-a-kind reward is the Berserker ability now
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

// The poker hands a team has MADE, strongest first — the read-only counterpart to
// pokerBuffs. Same pool, same evaluators (rankCounts / bestStraight / fullHouseRanks),
// so the flop reveal's callout and the buffs that actually land can never disagree:
// this returns DESCRIPTIONS where pokerBuffs returns multipliers. That's the same
// reason the detection helpers were kept centralized when the old per-player hand
// lists were deleted (see the note above teamSynergyEffects).
//
// Each entry carries the `ranks` that FORM the hand, which is exactly what the reveal
// glows on the community cards and pulses on your units.
//
// Ordered by the atkMult the hand actually PAYS, not by poker's own hand ranking,
// because "your biggest hand" here means the one that buffs you most — quads (+400%)
// genuinely beat a full house (+150%) in this game, and a small straight (+40%) loses
// to a plain pair (+50%). Reading the number straight out of POKER_HANDS means
// retuning those rewards re-sorts this automatically. The small per-shape bonus only
// breaks ties between hands paying the same multiplier (full house over trips).
function bestHandsFor(team) {
  const counts = rankCounts(pokerPool(team));
  const out = [];

  Object.keys(counts).forEach(function (key) {
    const rank = Number(key);
    let n = counts[key];
    if (n < 2) return;
    // Rank 2 pays NO stat buff — its of-a-kind reward is the Berserker ability
    // (see pokerBuffs) — so it's announced as an unlock and scored below every real
    // hand, letting the callout fall through to whatever else you made.
    if (rank === 2) {
      out.push({ key: "berserk", name: "BERSERKERS", ranks: [2],
                 detail: "your 2s wake up", score: 0.01 });
      return;
    }
    if (n > 4) n = 4;                                  // cap at quads, like pokerBuffs
    const t = POKER_HANDS.ofAKind[n];
    out.push({ key: "ofAKind" + n, name: t.label.toUpperCase(), ranks: [rank],
               detail: rankLabel(rank) + "s", score: t.atkMult + 0.02 });
  });

  const doyle = POKER_HANDS.named.doyle;
  if (doyle.ranks.every(function (r) { return (counts[r] || 0) >= 1; })) {
    out.push({ key: "doyle", name: doyle.label.toUpperCase(), ranks: doyle.ranks.slice(),
               detail: "10 + 2", score: doyle.atkMult + 0.01 });
  }

  // Straight and full house mirror pokerBuffs' tiering exactly — including the
  // run.slice(0, 5) that decides WHICH five of a longer run actually get buffed, so
  // the cards that glow are the cards that pay.
  const run = bestStraight(counts);
  if (run) {
    const cfg = POKER_HANDS.shaped.straight;
    const full = run.length >= 5;
    const tier = full ? cfg.full : cfg.small;
    const buffed = full ? run.slice(0, 5) : run.slice();
    out.push({ key: full ? "straight" : "smallStraight",
               name: full ? "STRAIGHT" : "SMALL STRAIGHT",
               ranks: buffed,
               detail: buffed.map(rankLabel).join(" · "),
               score: tier.atkMult + 0.03 });
  }

  const fh = fullHouseRanks(counts);
  if (fh) {
    const f = POKER_HANDS.shaped.fullHouse;
    out.push({ key: "fullHouse", name: f.label.toUpperCase(), ranks: fh.slice(),
               detail: rankLabel(fh[0]) + "s full of " + rankLabel(fh[1]) + "s",
               score: f.atkMult + 0.05 });
  }

  out.sort(function (a, b) { return b.score - a.score; });
  return out;
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

      // JOKER multipliers, both added into the SAME bracket as the suit and poker buffs
      // rather than multiplied on afterwards — so a unit gets one combined multiplier and a
      // low card riding a flush, a pair and a full growth bank can't compound into something
      // absurd.
      //   low   — The Sucker: a flat bonus to ranks 2-5 only.
      //   grown — The Grinder / The Believer: the permanent bank on this unit's rank + suit.
      const low = (u.rank <= JOKER_LOW_RANK_MAX) ? jokerSum(team, "lowRankMult") : 0;
      const grown = jokerGrowthFor(team, u.rank, u.suit);
      const jokerMult = low + grown;

      // HP = base × (1 + hearts team buff + this unit's poker HP buff). Start full.
      u.maxHp = Math.round(u.maxHp * (1 + eff.hpMult + pb.hpMult + jokerMult));
      u.hp = u.maxHp;

      // Attack = base × (1 + diamonds team buff + this unit's poker attack buff).
      u.attack = Math.round(u.attack * (1 + eff.atkMult + pb.atkMult + jokerMult));

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
