// ── CHAMPION TOOLTIP ─────────────────────────────────────────────────────────
// Hover a unit on the board and get the whole card explained: what it is, what its
// abilities do, and the four of-a-kind rungs with the one you're standing on lit up.
// The trait sidebar already does this for SUIT and POKER traits (synergies.js) — this
// is the same idea aimed at a single champion, which is the thing a player actually
// points at when they ask "what does this one do?".
//
// WHY IT ISN'T A CSS TOOLTIP. The trait sidebar's .trait-tooltip is pure CSS: a hidden
// absolutely-positioned child revealed by `.trait-row:hover`. That works there because
// the sidebar sits OUTSIDE the board in open margin. It cannot work here — a .cell lives
// inside #board, which clips its overflow, and #fxLayer sits over the whole thing at
// z-index 20. A tooltip anchored inside a cell would be sliced off at the board's edge.
// So this is ONE element parked on document.body, position:fixed, moved into place by
// JS on hover — the same conclusion js/flopreveal.js reached for the same reason.
//
// WHY THE LISTENERS ARE DELEGATED. renderCells() blanks every cell's innerHTML and
// rebuilds its className on every single combat tick. Per-cell listeners would be
// attached to elements that churn constantly. The CELLS themselves are permanent
// (buildBoard makes them once), so one mousemove listener on #board that works out
// which cell the pointer is over is both cheaper and immune to the churn.
//
// The unit layer is deliberately transparent to the mouse (see the note in renderCells),
// so the SQUARE is the hover target — the same element that is already the drag handle.

// TWO PLACES IT OPENS, and they ask slightly different questions. On the BOARD you're
// asking "what is this thing doing?" — the unit is real, its abilities are baked onto it,
// its of-a-kind count is settled. In the HAND (the bench) you're asking "what would this
// BECOME?" — nothing is resolved yet, so the panel derives the kit the card would run and
// reports the count it WOULD reach if you played it. Same panel, one honest difference in
// the header, because choosing what to play is the decision the tooltip most needs to help
// with and a bench card that quoted a board card's numbers would be lying.

// ── The element ──────────────────────────────────────────────────────────────
let championTipEl     = null;   // the one panel, created on first hover
let championTipAnchor = null;   // the element we're describing (null = hidden)
// How to find the thing again on a refresh. A unit can die or walk off its square and a
// hand card can be played, so neither is safe to hold onto across a repaint — we hold the
// question, not the answer.
let championTipLookup = null;

function championTipNode() {
  if (championTipEl) return championTipEl;
  championTipEl = document.createElement("div");
  championTipEl.id = "championTip";
  document.body.appendChild(championTipEl);
  return championTipEl;
}

// ── Reading an ability's shape ───────────────────────────────────────────────
// Three different shapes for "which tier table applies", all of which already exist in
// RANK_ABILITIES and all of which rankAbilityText already has to cope with:
//   a.suits[suit].tiers  — rank 10, four faces with four separate ladders
//   a.tiersRanged/Melee  — rank 4's Giant Slayer, one ladder per role
//   a.tiers              — everything else
// Returns null for an ungated ability with no ladder at all (Slippery, Lifesteal).
function tipTierTable(a, u) {
  if (a.suits) {
    const face = a.suits[u.suit];
    return face ? face.tiers : null;
  }
  if (a.tiersRanged || a.tiersMelee) {
    return isRangedSuit(u.suit) ? a.tiersRanged : a.tiersMelee;
  }
  return a.tiers || null;
}

// Rank 10 renames itself per suit ("Blood Banner", not "Rally"); everything else has one
// name. The last fallback is for the SUIT abilities, which are bare `{ kind }` entries in
// SUITS with no name to show — without it a ♦ unit's Lifesteal renders as a blank heading
// above its description.
function tipAbilityName(a, u) {
  const face = a.suits && a.suits[u.suit];
  if (face && face.name) return face.name;
  if (a.name) return a.name;
  const words = ABILITY_TEXT[a.kind];
  return (words && words.name) ? words.name : "";
}

// The mana profile in words. Casters differ in HOW they charge (a regen clock vs banking
// mana per swing) and in what they aim at, and both change how the card plays.
function tipCastLine(a) {
  if (!a.cast) return "";
  const charge = a.manaPerAttack ? (a.manaPerAttack + " per attack")
                                 : ((a.manaRegen || 0) + " per tick");
  const aim = a.castTargeting === "self"  ? "fires the moment it fills"
            : a.castTargeting === "ally"  ? "aimed at an ally"
            : "aimed at an enemy" + (a.castRange ? " within " + a.castRange : "");
  return "⚡ Cast · " + a.manaMax + " mana (" + charge + ") · " + aim;
}

// ── The content ──────────────────────────────────────────────────────────────
// One ability's block: name, what it does, then its ladder with the current rung lit.
// The .tip-tier / .reached / .on classes are the sidebar's, reused rather than
// reinvented — same meaning, same look, one place to restyle.
function tipAbilityHTML(a, u, count) {
  const words = ABILITY_TEXT[a.kind] || null;
  let h = '<div class="tip-abil">' + tipAbilityName(a, u) + "</div>";
  if (words && words.desc) h += '<div class="tip-desc">' + words.desc + "</div>";

  const cast = tipCastLine(a);
  if (cast) h += '<div class="tip-cast">' + cast + "</div>";

  // An ungated ability whose numbers live on the entry itself gets one plain line.
  if (words && words.flat) h += '<div class="tip-tier reached">' + words.flat(a) + "</div>";

  const tiers = tipTierTable(a, u);
  if (!tiers) return h;

  // The ladder always shows all four rungs, including ones this ability doesn't have a
  // row for — that gap IS the information. A rung with no row is where the ability is
  // still switched off, and seeing "1 — locked" is exactly how you learn that drawing a
  // second copy is what turns the card on.
  for (let k = 1; k <= 4; k++) {
    const t = tiers[k];
    const on = (Math.min(count, 4) === k);
    const reached = (count >= k);
    const label = { 1: "1", 2: "2", 3: "3", 4: "4" }[k];
    let line;
    if (!t) line = '<span class="tip-locked">locked</span>';
    else if (words && words.rung) line = words.rung(t, a, k);
    else line = "";
    h += '<div class="tip-tier' + (reached ? " reached" : "") + (on ? " on" : "") + '">' +
         "<b>" + label + "</b> " + line + "</div>";
  }
  return h;
}

// A placed unit already carries its resolved ability list (placement.js:222 bakes
// unitAbilities onto it). A card in hand has never been through that, so it derives the
// same list from the same function — which is what guarantees the bench tooltip and the
// board tooltip describe a 9♠ identically.
function tipAbilitiesOf(obj) {
  return obj.abilities || unitAbilities(obj);
}

// The of-a-kind count to show, and whether it's settled or hypothetical.
// On the board: whatever the unit actually counts as, straight from the engine.
// In hand: what it WOULD count as with this card added — the pool's current tally for the
// rank, plus this one. Note the pool is a LOWER BOUND during placement, because the flop
// isn't dealt until Round Start (synergies.js:285) and those cards count too. Better to
// under-promise here than to quote a number the round might not honour.
function tipCount(obj, team) {
  // A FUSED body has no rank in the poker pool by design (synergies.js:290) — it can't
  // complete anyone's pair and nobody completes its. So there is no count to show, and
  // asking for one would report a meaningless 1.
  if (obj.fused) return { n: 0, hypothetical: false };
  if (obj.team) return { n: packCount(obj), hypothetical: false };
  const pooled = rankCounts(pokerPool(team))[obj.rank] || 0;
  return { n: packGateFloor(team, pooled + 1), hypothetical: true };
}

// The whole panel for one unit OR one card in hand. `team` is only consulted for a card,
// which carries no team of its own.
function championTipHTML(u, team) {
  const s = SUITS[u.suit];
  const fused = !!u.fused;
  const tally = tipCount(u, team);
  const count = tally.n;
  const uniq  = uniqueOf(u);
  const artName = (typeof unitArtName === "function") ? unitArtName(u) : "";

  let h = "";

  // Header: what card this is, then what kind of body it is.
  if (fused) {
    const src = u.parts ? u : u.card;
    const entry = FUSABLE_HANDS[src.fusedKey];
    const parts = src.parts.map(function (p) {
      return rankLabel(p.rank) + SUITS[p.suit].symbol;
    }).join(" + ");
    h += '<div class="tip-head" style="color:#7fe0a0">✨ ' +
         (entry ? entry.label : "Fused") + "</div>";
    h += '<div class="tip-sub">fused ' + parts + " — one body, both kits</div>";
  } else {
    h += '<div class="tip-head" style="color:' + s.unitColor + '">' +
         rankLabel(u.rank) + s.symbol + (artName ? " · " + artName : "") + "</div>";
    // "would be 2 of a kind" on the bench, "2 of a kind" on the board. The word carries
    // the whole difference between a plan and a fact, so it's worth the four characters.
    h += '<div class="tip-sub">' + s.desc + " · range " + u.range + " · " +
         (tally.hypothetical ? "would be " : "") + count + " of a kind</div>";
  }

  // Legendary flavour sits above the kit: it's the reason you kept the card.
  if (uniq) h += '<div class="tip-star">★ ' + uniq.name + " — " + uniq.blurb + "</div>";

  // Suit's + rank's role-filtered set + legendary's, or a fusion's authored kit —
  // whichever this thing turns out to be. See tipAbilitiesOf.
  const list = tipAbilitiesOf(u);
  let shown = 0;
  for (let i = 0; i < list.length; i++) {
    if (!list[i].name && !ABILITY_TEXT[list[i].kind]) continue;   // internal markers, not player-facing
    h += tipAbilityHTML(list[i], u, count);
    shown++;
  }
  if (shown === 0) h += '<div class="tip-desc">No special abilities — just a body.</div>';

  // Live statuses, mid-fight. Same statusList the badge row reads, so the glyphs on the
  // square and the words in here can never disagree. A card in hand has none by
  // definition — it isn't in the fight yet — and statusList would read undefined timers
  // off it, so only a real unit is asked.
  const st = u.team ? statusList(u) : [];
  if (st.length) {
    h += '<div class="tip-status">' + st.map(function (x) { return x[2]; }).join(" · ") + "</div>";
  }
  return h;
}

// ── Placement ────────────────────────────────────────────────────────────────
// Open to the RIGHT of the anchor, and flip to the left if that would run off the
// window — the same call the trait sidebar makes (styles.css:970), except this one has
// to make it at runtime because a board square or a bench card can be anywhere on screen.
//
// The vertical clamp matters more for the bench than the board: the hands sit at the
// bottom of the page, so a full ability panel opened level with a hand card would hang
// off the bottom of the window every time. Clamping pushes it up until it fits.
function championTipPlace(anchorRect) {
  const tip = championTipNode();
  const r = tip.getBoundingClientRect();   // width is fixed by CSS, so this is stable
  const gap = 10;
  const edge = 6;

  let left = anchorRect.right + gap;
  if (left + r.width > window.innerWidth - edge) left = anchorRect.left - gap - r.width;
  if (left < edge) left = edge;

  let top = anchorRect.top;
  if (top + r.height > window.innerHeight - edge) top = window.innerHeight - edge - r.height;
  if (top < edge) top = edge;

  tip.style.left = Math.round(left) + "px";
  tip.style.top  = Math.round(top) + "px";
}

// ── What an anchor is describing ─────────────────────────────────────────────
// Both lookups re-read from the state arrays rather than closing over the object, so a
// refresh after a repaint can never describe a unit that has died or a card that has
// been played. They return null when the thing is gone, which is the hide signal.
function championTipUnitLookup(cell) {
  return function () {
    const u = findUnitAt(Number(cell.dataset.x), Number(cell.dataset.y));
    return u ? { obj: u, team: u.team } : null;
  };
}

function championTipCardLookup(team, index) {
  return function () {
    const c = hands[team][index];
    // Jokers get no panel: they have no suit, rank or kit to describe, and their own
    // catalog blurb is already on the card face and in its native title.
    if (!c || cardIsJoker(c)) return null;
    return { obj: c, team: team };
  };
}

// ── Show / hide / refresh ────────────────────────────────────────────────────
function championTipHide() {
  championTipAnchor = null;
  championTipLookup = null;
  if (championTipEl) championTipEl.style.display = "none";
}

function championTipShow(anchor, lookup) {
  const found = lookup();
  if (!found) { championTipHide(); return; }
  const tip = championTipNode();
  tip.innerHTML = championTipHTML(found.obj, found.team);
  tip.style.display = "block";
  championTipAnchor = anchor;
  championTipLookup = lookup;
  championTipPlace(anchor.getBoundingClientRect());
}

// Called at the end of render(), which runs every combat tick. Rebuilds the panel in
// place so a tooltip you're already holding open tracks HP, statuses and shields as the
// fight moves — without this it would freeze at whatever the unit looked like when you
// first pointed at it, which reads as a bug rather than as a snapshot.
function championTipRefresh() {
  if (!championTipAnchor || !championTipEl) return;
  // renderOneHand rebuilds every card element from scratch, so an anchor can be orphaned
  // out of the document while the pointer is still resting on where it used to be. A
  // detached anchor has a zero-size rect, which would fling the panel into the corner.
  if (!championTipAnchor.isConnected) { championTipHide(); return; }
  const found = championTipLookup();
  if (!found) { championTipHide(); return; }   // it died, walked away, or was played
  championTipEl.innerHTML = championTipHTML(found.obj, found.team);
  championTipPlace(championTipAnchor.getBoundingClientRect());
}

// ── Wiring ───────────────────────────────────────────────────────────────────
(function wireChampionTip() {
  if (SIM_MODE) return;                       // headless batch sim: no DOM, no listeners

  // mousemove rather than mouseover, because the contents of both surfaces are destroyed
  // and rebuilt constantly — cells every combat tick, hand cards on every repaint.
  // mouseover/mouseout would fire endlessly as the element under the pointer vanished,
  // and the panel would strobe. Tracking the anchor and only acting when it CHANGES makes
  // that churn invisible. One delegated listener per surface, on a container that itself
  // never gets replaced.
  function wireSurface(container, selector, lookupFor) {
    if (!container) return;                   // older pages / harnesses without this surface
    container.addEventListener("mousemove", function (e) {
      const el = e.target.closest ? e.target.closest(selector) : null;
      if (!el) { championTipHide(); return; }
      if (el === championTipAnchor) return;   // same thing, nothing to redo
      championTipShow(el, lookupFor(el));
    });
    container.addEventListener("mouseleave", championTipHide);
    // Picking something up shouldn't drag a description sheet around with it.
    container.addEventListener("mousedown", championTipHide);
  }

  wireSurface(document.getElementById("board"), ".cell", championTipUnitLookup);

  // THE BENCH. Both hands, because player2's is visible in the two-player and playtest
  // modes and an opponent's card deserves the same reading. The card's own index is
  // stamped on it by renderOneHand — DOM position would work today but would break
  // silently the first time the hand row grows a header or a spacer.
  ["player1", "player2"].forEach(function (team) {
    wireSurface(document.getElementById("hand-" + team), ".card", function (el) {
      return championTipCardLookup(team, Number(el.dataset.handIndex));
    });
  });

  // Fixed positioning is measured against the viewport, so a scroll strands the panel.
  window.addEventListener("scroll", championTipHide, true);
})();
