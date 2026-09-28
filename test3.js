// test3.js - forecast engine tests (projectCutoff, drawProbability, buildHunterForecast,
// computeGroupStaggering, MOOSE_TRENDS/getTrendSeries). This replaces the old static
// hand-set-MPR / deterministic pass-fail model with a trend fitted to real WMU draw
// data (any WMU/tag type/season, not just WMU 24 bull) and a probability ramp.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function freshApp() {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  return dom.window.APP;
}

const APP = freshApp();

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

check("MOOSE_TRENDS holds real WMU 24 bull/gun/primary/1st-choice cutoffs for 2021-2025", () => {
  const series = APP.getTrendSeries({ wmu: "24", mooseType: "Bull", season: "Gun", stage: "Primary", choice: "1" });
  assert.ok(series, "trend series should resolve for the default target");
  const byYear = Object.fromEntries(series.map((p) => [p.year, p.cutoff]));
  assert.deepStrictEqual(byYear, { 2021: 11, 2022: 10, 2023: 12, 2024: 12, 2025: 12 });
});

check("MOOSE_TRENDS has real data for many WMUs, so a group can choose any one WMU to forecast (never several at once)", () => {
  const wmus = APP.availableWMUs();
  assert.ok(wmus.length > 30, "should have real draw data for dozens of WMUs");
  assert.ok(wmus.includes("24"));
  assert.ok(wmus.includes("28"), "another WMU (28) should also have data");
  const wmu28Bull = APP.getTrendSeries({ wmu: "28", mooseType: "Bull", season: "Gun", stage: "Primary", choice: "1" });
  assert.ok(wmu28Bull && wmu28Bull.length > 0);
});

check("getTrendSeries returns null for a combination with no full-award data on record", () => {
  const series = APP.getTrendSeries({ wmu: "24", mooseType: "Bull", season: "Gun", stage: "Primary", choice: "3" });
  assert.strictEqual(series, null);
});

check("availableMooseTypes/Seasons/Stages/Choices cascade correctly for a known WMU", () => {
  assert.ok(APP.availableMooseTypes("24").includes("Bull"));
  assert.ok(APP.availableSeasons("24", "Bull").includes("Gun"));
  assert.ok(APP.availableStages("24", "Bull", "Gun").includes("Primary"));
  assert.ok(APP.availableChoices("24", "Bull", "Gun", "Primary").includes("1"));
  assert.strictEqual(APP.availableMooseTypes("does-not-exist").length, 0, "unknown WMU has no available moose types");
});

check("projectCutoff fits a known linear trend exactly", () => {
  const trend = [
    { year: 2020, cutoff: 1 },
    { year: 2021, cutoff: 3 },
    { year: 2022, cutoff: 5 }
  ];
  assert.strictEqual(APP.projectCutoff(trend, 2023), 7);
  assert.strictEqual(APP.projectCutoff(trend, 2020), 1);
});

check("projectCutoff on the real WMU24 bull trend projects forward past the historical range", () => {
  const trend = APP.getTrendSeries({ wmu: "24", mooseType: "Bull", season: "Gun", stage: "Primary", choice: "1" });
  const cutoff2028 = APP.projectCutoff(trend, 2028);
  assert.ok(cutoff2028 > 12, "cutoff should keep climbing past 2025's observed 12");
  assert.ok(Math.abs(cutoff2028 - 13.4) < 0.01);
});

check("drawProbability is 0 well below cutoff, 1 at/above cutoff, and ramps linearly between", () => {
  assert.strictEqual(APP.drawProbability(5, 12), 0);
  assert.strictEqual(APP.drawProbability(10, 12), 0);
  assert.strictEqual(APP.drawProbability(11, 12), 0.5);
  assert.strictEqual(APP.drawProbability(12, 12), 1);
  assert.strictEqual(APP.drawProbability(15, 12), 1, "points above cutoff still cap at 1, not overflow past 1");
});

check("buildHunterForecast projects a hunter's points forward and ramps probability with the trend", () => {
  const hunter = { name: "Test", pointsHistory: [{ year: 2026, points: 8, tagType: null, claimed: false, northernResident: false }] };
  const trend = [
    { year: 2026, cutoff: 10 },
    { year: 2027, cutoff: 10 },
    { year: 2028, cutoff: 10 }
  ];
  const forecast = APP.buildHunterForecast(hunter, 2026, 2028, trend);
  assert.strictEqual(forecast.length, 3);
  assert.strictEqual(forecast[0].points, 8);
  assert.strictEqual(forecast[0].probability, 0);
  assert.strictEqual(forecast[1].points, 9);
  assert.strictEqual(forecast[1].probability, 0.5);
  assert.strictEqual(forecast[2].points, 10);
  assert.strictEqual(forecast[2].probability, 1);
});

check("buildHunterForecast adds the Northern bonus to probability only, not to projected points", () => {
  const hunter = { name: "North", pointsHistory: [{ year: 2026, points: 9, tagType: null, claimed: false, northernResident: true }] };
  const trend = [{ year: 2026, cutoff: 10 }];
  const forecast = APP.buildHunterForecast(hunter, 2026, 2026, trend);
  assert.strictEqual(forecast[0].points, 9, "raw projected points exclude the bonus");
  assert.strictEqual(forecast[0].probability, 1, "9 banked + 1 Northern bonus clears a cutoff of 10");
});

check("computeGroupStaggering flags a gap year when nobody is likely tag-ready", () => {
  const hunters = [
    { name: "A", pointsHistory: [{ year: 2026, points: 0, tagType: null, claimed: false }] },
    { name: "B", pointsHistory: [{ year: 2026, points: 1, tagType: null, claimed: false }] }
  ];
  const trend = [{ year: 2026, cutoff: 12 }];
  const staggering = APP.computeGroupStaggering(hunters, 2026, 2026, trend);
  assert.strictEqual(staggering[0].status, "gap");
  assert.strictEqual(staggering[0].expected, 0);
});

check("computeGroupStaggering flags a stacked year when several hunters are likely ready at once", () => {
  const hunters = [
    { name: "A", pointsHistory: [{ year: 2026, points: 12, tagType: null, claimed: false }] },
    { name: "B", pointsHistory: [{ year: 2026, points: 13, tagType: null, claimed: false }] }
  ];
  const trend = [{ year: 2026, cutoff: 12 }];
  const staggering = APP.computeGroupStaggering(hunters, 2026, 2026, trend);
  assert.strictEqual(staggering[0].status, "stacked");
  assert.strictEqual(staggering[0].expected, 2);
});

check("computeGroupStaggering's cutoff moves with the fitted trend instead of staying flat across years", () => {
  const trend = APP.getTrendSeries({ wmu: "24", mooseType: "Bull", season: "Gun", stage: "Primary", choice: "1" });
  const staggering = APP.computeGroupStaggering(APP.HUNTER_SEED, 2021, 2025, trend);
  const cutoffs = staggering.map((r) => r.cutoff);
  const expected = [10.6, 11, 11.4, 11.8, 12.2];
  cutoffs.forEach((c, i) => assert.ok(Math.abs(c - expected[i]) < 0.001, `year ${staggering[i].year}: ${c} ~= ${expected[i]}`));
  const unique = new Set(cutoffs);
  assert.ok(unique.size > 1, "a real trend-based cutoff must vary year to year, unlike a hand-set flat MPR constant");
});

check("default group choice resolves to real trend data out of the box (Primary choice 1 = WMU 24 bull/gun)", () => {
  const gc = APP.getGroupChoice();
  assert.deepStrictEqual(gc, APP.DEFAULT_GROUP_CHOICE);
  const slots = APP.collectChoiceSlots(gc);
  assert.strictEqual(slots.length, 1);
  assert.strictEqual(slots[0].stage, "Primary");
  assert.strictEqual(slots[0].choice, "1");
});

check("setChoiceSlot fills a slot, cascades WMU->type->season, and can clear a slot back to null", () => {
  APP.setChoiceSlot("primary", 1, "wmu", "28");
  let gc = APP.getGroupChoice();
  assert.strictEqual(gc.primary[1].wmu, "28");
  assert.ok(gc.primary[1].mooseType, "picking a WMU should auto-fill a valid tag type");
  assert.ok(gc.primary[1].season, "picking a WMU should auto-fill a valid season");

  APP.setChoiceSlot("primary", 1, "wmu", "");
  gc = APP.getGroupChoice();
  assert.strictEqual(gc.primary[1], null, "clearing the WMU clears the whole slot");
});

check("collectChoiceSlots only returns filled slots, across both Primary and Second Chance", () => {
  APP.setChoiceSlot("secondChance", 0, "wmu", "24");
  APP.setChoiceSlot("secondChance", 0, "mooseType", "Calf");
  APP.setChoiceSlot("secondChance", 0, "season", "All Seasons");
  const slots = APP.collectChoiceSlots(APP.getGroupChoice());
  assert.strictEqual(slots.length, 2, "Primary choice 1 (default) plus the new Second Chance choice 1");
  assert.ok(slots.some((s) => s.stage === "Second Chance" && s.choice === "1"));
  // restore default for later checks
  APP.setChoiceSlot("secondChance", 0, "wmu", "");
});

check("hunterCombinedProbability combines multiple filled slots as an OR (any slot succeeding is enough)", () => {
  // Two real WMUs with resolvable trends - the OR-combination should never do worse than one alone.
  const real = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  const realTwo = {
    primary: [
      { wmu: "24", mooseType: "Bull", season: "Gun" },
      { wmu: "28", mooseType: "Bull", season: "Gun" }
    ],
    secondChance: [null, null, null]
  };
  const readyHunter = { name: "Multi", pointsHistory: [{ year: 2026, points: 11, tagType: null, claimed: false, northernResident: false }] };
  const pOne = APP.hunterCombinedProbability(readyHunter, 2026, real);
  const pTwo = APP.hunterCombinedProbability(readyHunter, 2026, realTwo);
  assert.ok(pOne !== null && pTwo !== null);
  assert.ok(pTwo >= pOne, "adding a second slot should never lower the combined probability");
});

check("hunterCombinedProbability returns null when no slots are filled or points are unknown", () => {
  const hunter = { name: "Empty", pointsHistory: [] };
  const empty = { primary: [null, null, null], secondChance: [null, null, null] };
  assert.strictEqual(APP.hunterCombinedProbability(hunter, 2026, empty), null, "no filled slots -> null");
  const real = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  assert.strictEqual(APP.hunterCombinedProbability(hunter, 2026, real), null, "no points history at all -> null");
});

check("groupProbability combines every hunter as an OR (the group succeeds if any one hunter does)", () => {
  const target = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  const readyHunter = { name: "Ready", pointsHistory: [{ year: 2026, points: 12, tagType: null, claimed: false, northernResident: false }] };
  const farHunter = { name: "Far", pointsHistory: [{ year: 2026, points: 0, tagType: null, claimed: false, northernResident: false }] };
  const soloGroup = APP.groupProbability([farHunter], 2026, target);
  const pairGroup = APP.groupProbability([farHunter, readyHunter], 2026, target);
  assert.ok(pairGroup > soloGroup, "adding a ready hunter should raise the group's odds");
});

check("buildGroupProbabilityTable returns one row per year and probabilities never exceed 1", () => {
  const target = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  const hunters = [{ name: "A", pointsHistory: [{ year: 2026, points: 5, tagType: null, claimed: false, northernResident: false }] }];
  const table = APP.buildGroupProbabilityTable(hunters, target, 2026, 2030);
  assert.strictEqual(table.length, 5);
  table.forEach((row) => {
    if (row.probability !== null) {
      assert.ok(row.probability >= 0 && row.probability <= 1);
    }
  });
  assert.ok(table[table.length - 1].probability >= table[0].probability, "odds should not decrease as points build up");
});

check("buildGroupMatrix: past years show actual points and tag result; future years show a plain projected number", () => {
  const hunter = {
    name: "Test",
    pointsHistory: [
      { year: 2024, points: 5, tagType: null, claimed: false, northernResident: false },
      { year: 2025, points: 0, tagType: "Bull", claimed: true, northernResident: false }
    ]
  };
  const groupChoice = { primary: [{ wmu: "x", mooseType: "x", season: "x" }, null, null], secondChance: [null, null, null] };
  const matrix = APP.buildGroupMatrix([hunter], groupChoice, 2023, 2027);
  const cells = matrix.rows[0].cells;
  assert.strictEqual(cells[0].year, 2023);
  assert.strictEqual(cells[0].kind, "empty", "no history and before the earliest record");
  assert.strictEqual(cells[1].kind, "actual");
  assert.strictEqual(cells[1].points, 5);
  assert.strictEqual(cells[1].tagType, null);
  assert.strictEqual(cells[2].kind, "actual");
  assert.strictEqual(cells[2].points, 0);
  assert.strictEqual(cells[2].tagType, "Bull");
  assert.strictEqual(cells[2].claimed, true);
  assert.strictEqual(cells[3].kind, "projected", "2026: one year past the hunter's latest record");
  assert.strictEqual(cells[3].points, 1);
  assert.strictEqual(cells[4].kind, "projected");
  assert.strictEqual(cells[4].points, 2);
});

check("buildGroupMatrix flags a projected cell 'ready' only once combined probability reaches 1 (never shows a percentage)", () => {
  const hunter = { name: "Ready Soon", pointsHistory: [{ year: 2026, points: 8, tagType: null, claimed: false, northernResident: false }] };
  const noDataChoice = { primary: [{ wmu: "x", mooseType: "x", season: "x" }, null, null], secondChance: [null, null, null] };
  const matrix = APP.buildGroupMatrix([hunter], noDataChoice, 2026, 2028);
  const cells = matrix.rows[0].cells;
  assert.strictEqual(cells[0].kind, "actual");
  // no trend resolves for a made-up WMU/type/season, so ready must default false
  assert.strictEqual(cells[1].ready, false);
  assert.strictEqual(cells[2].ready, false);
});

check("buildGroupMatrix highlights 'ready' using the real WMU24 bull trend once projected points clear the cutoff", () => {
  const hunter = { name: "Nearly There", pointsHistory: [{ year: 2026, points: 11, tagType: null, claimed: false, northernResident: false }] };
  const groupChoice = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  const matrix = APP.buildGroupMatrix([hunter], groupChoice, 2026, 2028);
  const cells = matrix.rows[0].cells;
  // 2027 projected points = 12, that year's fitted cutoff is ~13 -> not ready yet
  assert.strictEqual(cells[1].points, 12);
  assert.strictEqual(cells[1].ready, false);
  // confirm ready is a plain boolean either way, never a numeric probability
  assert.strictEqual(typeof cells[2].ready, "boolean");
});

check("pointsGoingForward treats a claimed tag on the latest row as a reset, even with no later row recording it", () => {
  const claimed = { name: "Alex", pointsHistory: [{ year: 2026, points: 9, tagType: "Cow/calf", claimed: true, northernResident: false }] };
  assert.strictEqual(APP.pointsGoingForward(claimed), 0, "a claimed tag resets points going into the next year");

  const unclaimed = { name: "Building", pointsHistory: [{ year: 2026, points: 9, tagType: null, claimed: false, northernResident: false }] };
  assert.strictEqual(APP.pointsGoingForward(unclaimed), 9, "no tag claimed - points carry forward as-is");

  const noHistory = { name: "Blank", pointsHistory: [] };
  assert.strictEqual(APP.pointsGoingForward(noHistory), 0);
});

check("buildGroupMatrix continues the simulation from 0 the year after a REAL claimed tag (not the raw recorded points)", () => {
  // Exactly Alex's real shape: last actual row is 2026, points=9, but
  // already claimed a Cow/calf tag that year. 2027's simulated points
  // must start from 0+1=1, not 9+1=10.
  const alex = { name: "Alex", pointsHistory: [{ year: 2026, points: 9, tagType: "Cow/calf", claimed: true, northernResident: false }] };
  const target = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  const matrix = APP.buildGroupMatrix([alex], target, 2026, 2029);
  const cells = matrix.rows[0].cells;
  assert.strictEqual(cells[0].kind, "actual");
  assert.strictEqual(cells[0].points, 9);
  assert.strictEqual(cells[0].tagType, "Cow/calf");
  assert.strictEqual(cells[1].kind, "projected");
  assert.strictEqual(cells[1].points, 1, "2027 restarts from 0, not from the claimed year's 9");
  assert.strictEqual(cells[2].points, 2);
  assert.strictEqual(cells[3].points, 3);
});

check("buildGroupMatrix resets a hunter's simulated points to 0 the year after they clear the cutoff (simulated tag year)", () => {
  // Uses the real WMU24 bull/gun trend (fitted cutoff sequence from
  // earlier tests: 2026≈12.6, 2027≈13, 2028≈13.4, 2029≈13.8) so the math
  // is checked against genuine MOOSE_TRENDS data, not a synthetic stub.
  const target = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  // Fitted cutoff sequence (from earlier tests): 2026≈12.6, 2027≈13,
  // 2028≈13.4, 2029≈13.8. Start a hunter at 11 banked points (2026).
  const nearHunter = { name: "Solo", pointsHistory: [{ year: 2026, points: 11, tagType: null, claimed: false, northernResident: false }] };
  const matrix = APP.buildGroupMatrix([nearHunter], target, 2026, 2032);
  const cells = matrix.rows[0].cells;
  // find the first cell that clears the cutoff (sequenceTag true)
  const tagIdx = cells.findIndex((c) => c.sequenceTag);
  assert.ok(tagIdx > 0, "the hunter should eventually clear the cutoff and get a simulated tag");
  assert.strictEqual(cells[tagIdx].ready, true);
  const nextCell = cells[tagIdx + 1];
  assert.ok(nextCell, "there should be a year after the tag year in this window");
  assert.strictEqual(nextCell.points, 1, "points restart from 0+1 the year after a simulated tag");
  assert.strictEqual(nextCell.sequenceTag, false, "the restart year is not itself a tag year");
});

check("buildGroupMatrix picks only one hunter as that year's tag holder when several would clear the cutoff, and clearly marks it", () => {
  const target = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  // Both hunters already at/above the 2026 fitted cutoff (~12.6), so both
  // are "ready" the very first projected year - a guaranteed collision.
  const hunterA = { name: "Ahigh", pointsHistory: [{ year: 2026, points: 20, tagType: null, claimed: false, northernResident: false }] };
  const hunterB = { name: "Blow", pointsHistory: [{ year: 2026, points: 15, tagType: null, claimed: false, northernResident: false }] };
  const matrix = APP.buildGroupMatrix([hunterA, hunterB], target, 2026, 2027);
  const rowA = matrix.rows.find((r) => r.name === "Ahigh");
  const rowB = matrix.rows.find((r) => r.name === "Blow");
  // 2027 is the first projected year for both (2026 is their actual entry)
  const cellA = rowA.cells.find((c) => c.year === 2027);
  const cellB = rowB.cells.find((c) => c.year === 2027);
  assert.strictEqual(cellA.ready, true);
  assert.strictEqual(cellB.ready, true);
  // both clear the cutoff, but only the higher-points hunter (Ahigh) is
  // picked as this year's tag holder
  assert.strictEqual(cellA.sequenceTag, true, "the hunter with more points wins the tie-break");
  assert.strictEqual(cellB.sequenceTag, false, "the other ready hunter is not reset, even though they also cleared the cutoff");
});

check("sortMatrixRows sorts by hunter name and by any year column, ascending and descending", () => {
  const matrix = {
    years: [2026, 2027],
    rows: [
      { name: "Zed", cells: [{ year: 2026, kind: "actual", points: 3 }, { year: 2027, kind: "projected", points: 9 }] },
      { name: "Amy", cells: [{ year: 2026, kind: "actual", points: 8 }, { year: 2027, kind: "empty" }] }
    ]
  };
  const byNameAsc = APP.sortMatrixRows(matrix, "name", "asc");
  assert.deepStrictEqual(byNameAsc.rows.map((r) => r.name), ["Amy", "Zed"]);

  const byNameDesc = APP.sortMatrixRows(matrix, "name", "desc");
  assert.deepStrictEqual(byNameDesc.rows.map((r) => r.name), ["Zed", "Amy"]);

  const by2026Desc = APP.sortMatrixRows(matrix, 2026, "desc");
  assert.deepStrictEqual(by2026Desc.rows.map((r) => r.name), ["Amy", "Zed"], "Amy has 8 points in 2026, higher than Zed's 3");

  const by2027Asc = APP.sortMatrixRows(matrix, 2027, "asc");
  assert.deepStrictEqual(by2027Asc.rows.map((r) => r.name), ["Amy", "Zed"], "Amy's empty 2027 cell sorts before Zed's 9");
});

check("sortMatrixBy toggles direction on repeated clicks of the same column and re-renders", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  const appDom = dom.window.APP;
  appDom.loadRoster([
    { name: "Zed", pointsHistory: [{ year: 2026, points: 3, tagType: null, claimed: false, northernResident: false }] },
    { name: "Amy", pointsHistory: [{ year: 2026, points: 8, tagType: null, claimed: false, northernResident: false }] }
  ]);
  assert.strictEqual(appDom.getMatrixSort().key, "name");
  assert.strictEqual(appDom.getMatrixSort().direction, "asc");
  appDom.sortMatrixBy("name");
  assert.strictEqual(appDom.getMatrixSort().direction, "desc", "clicking the already-active column flips direction");
  const doc = dom.window.document;
  const firstRowName = doc.querySelector("#matrixBody tr td.matrix-name").textContent;
  assert.strictEqual(firstRowName, "Zed", "descending name sort should put Zed first");
});

check("renderMatrix populates the matrix table with one row per hunter and one column per year, once a roster is loaded", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  dom.window.APP.loadRoster(JSON.parse(JSON.stringify(dom.window.APP.HUNTER_SEED)));
  const doc = dom.window.document;
  const rows = doc.querySelectorAll("#matrixBody tr");
  assert.strictEqual(rows.length, dom.window.APP.HUNTER_SEED.length);
  const headCells = doc.querySelectorAll("#matrixTableHead th");
  // Name column + (earliest history year..current year+7)
  assert.ok(headCells.length > 8, "should include past history years plus the projected span");
});

check("renderChoiceTable renders 6 rows (Primary 1-3, Second Chance 1-3) with the default slot pre-filled", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  dom.window.APP.render();
  const doc = dom.window.document;
  const selects = doc.querySelectorAll('#choiceBody select[data-field="wmu"]');
  assert.strictEqual(selects.length, 6, "one WMU select per choice slot");
  assert.strictEqual(selects[0].value, "24", "Primary choice 1 defaults to WMU 24");
  assert.strictEqual(selects[1].value, "", "Primary choice 2 starts empty");
  assert.ok(selects[0].options.length > 30);
});

console.log(`\n${passed} passed (test3.js)`);
