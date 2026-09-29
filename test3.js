// test3.js - the points engine and tag forecast. Points are calculated
// from claimed tags (not read from the sheet), future cutoffs are the latest
// MNR cutoff held flat, and up to 2 tags a year go to the oldest qualifying
// hunters.
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

const BULL_24 = { primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
const row = (year, points, extra) => Object.assign({ year, points, tagType: null, claimed: false }, extra || {});
const cellAt = (matrix, name, year) => matrix.rows.find((r) => r.name === name).cells.find((c) => c.year === year);

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


check("cutoffForYear uses MNR's actual cutoff for years on record and holds the latest one flat after that", () => {
  const trend = APP.getTrendSeries({ wmu: "24", mooseType: "Bull", season: "Gun", stage: "Primary", choice: "1" });
  assert.strictEqual(APP.cutoffForYear(trend, 2022), 10);
  assert.strictEqual(APP.cutoffForYear(trend, 2025), 12);
  assert.strictEqual(APP.cutoffForYear(trend, 2026), 12, "held flat, not extrapolated upward");
  assert.strictEqual(APP.cutoffForYear(trend, 2035), 12);
  assert.strictEqual(APP.cutoffForYear(trend, 2019), null, "no number before the data starts");
});

check("points count from claimed tags: the claim year keeps its points, the next year is 0, then +1 a year", () => {
  const hunter = { name: "B", pointsHistory: [row(2021, 12), row(2022, 13, { tagType: "Bull", claimed: true }), row(2023, null), row(2024, null)] };
  const c = APP.computeHunterPoints(hunter, 2026);
  assert.strictEqual(c.years.map((y) => y.pool).join(","), "12,13,0,1");
  assert.strictEqual(c.nextPool, 2);
});

check("only the first year's Points is used; later rows are calculated, and the sheet is flagged only where it breaks the rules", () => {
  // Jason Roy's real shape: 1, then 0 with no claimed tag recorded, then +1 a year.
  const hunter = { name: "J", pointsHistory: [row(2020, 1), row(2021, 0), row(2022, 1), row(2023, 2)] };
  const c = APP.computeHunterPoints(hunter, 2026);
  assert.strictEqual(c.years.map((y) => y.pool).join(","), "1,2,3,4", "calculated, not copied from the sheet");
  assert.strictEqual(c.years.map((y) => y.mismatch).join(","), "false,true,false,false", "one flag, where the error is");
  assert.strictEqual(c.years[1].expectedFromSheet, 2);
});

check("an awarded but unclaimed tag doesn't reset points", () => {
  const hunter = { name: "P", pointsHistory: [row(2026, 8, { tagType: "Cow/calf", claimed: false })] };
  assert.strictEqual(APP.computeHunterPoints(hunter, 2026).nextPool, 9);
});

check("a year marked Applied = N earns no point", () => {
  const hunter = { name: "F", pointsHistory: [row(2024, 5), row(2025, null, { applied: false }), row(2026, null)] };
  assert.strictEqual(APP.computeHunterPoints(hunter, 2026).years.map((y) => y.pool).join(","), "5,6,6");
});

check("claimed tags from Second Chance choice 2 or 3 don't reset points; Primary and Second Chance 1 do", () => {
  const after = (draw) =>
    APP.computeHunterPoints({ name: "X", pointsHistory: [row(2026, 7, { tagType: "Calf", claimed: true, draw })] }, 2026).nextPool;
  assert.strictEqual(after("Second Chance 2"), 8);
  assert.strictEqual(after("SC3"), 8);
  assert.strictEqual(after("Second Chance 1"), 0);
  assert.strictEqual(after("Primary 2"), 0);
  assert.strictEqual(after(null), 0, "blank Draw is assumed to reset");
});

check("parseDraw understands the common ways of writing a draw", () => {
  assert.strictEqual(JSON.stringify(APP.parseDraw("Primary 3")), JSON.stringify({ stage: "Primary", choice: "3" }));
  assert.strictEqual(JSON.stringify(APP.parseDraw("2nd chance choice 3")), JSON.stringify({ stage: "Second Chance", choice: "3" }));
  assert.strictEqual(JSON.stringify(APP.parseDraw("Deuxième chance 2")), JSON.stringify({ stage: "Second Chance", choice: "2" }));
  assert.strictEqual(APP.parseDraw(""), null);
});

check("rows after the last history year aren't history yet and are ignored", () => {
  const hunter = { name: "T", pointsHistory: [row(2026, 4), row(2027, 5), row(2028, 6)] };
  const c = APP.computeHunterPoints(hunter, 2026);
  assert.strictEqual(c.lastYear, 2026);
  assert.strictEqual(c.nextPool, 5);
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

check("matrix: past cells show calculated points; the year after a real claimed tag starts at 0", () => {
  const alex = { name: "Alex", pointsHistory: [row(2025, 8), row(2026, 9, { tagType: "Cow/calf", claimed: true })] };
  const m = APP.buildGroupMatrix([alex], BULL_24, 2025, 2028, 2026);
  assert.strictEqual(cellAt(m, "Alex", 2026).kind, "actual");
  assert.strictEqual(cellAt(m, "Alex", 2026).points, 9);
  assert.strictEqual(cellAt(m, "Alex", 2027).kind, "projected");
  assert.strictEqual(cellAt(m, "Alex", 2027).points, 0);
  assert.strictEqual(cellAt(m, "Alex", 2028).points, 1);
});

check("matrix: a hunter gets a predicted tag once their points reach the flat cutoff, then resets to 0", () => {
  const carl = { name: "Carl", pointsHistory: [row(2026, 8)] };
  const m = APP.buildGroupMatrix([carl], BULL_24, 2026, 2032, 2026);
  // 9, 10, 11, 12 (= cutoff 12 in 2030) -> tag, then 0, 1
  assert.strictEqual([2027, 2028, 2029, 2030, 2031, 2032].map((y) => cellAt(m, "Carl", y).points).join(","), "9,10,11,12,0,1");
  assert.ok(cellAt(m, "Carl", 2030).tag, "tag in 2030");
  assert.strictEqual(cellAt(m, "Carl", 2030).tag.stage, "Primary");
  assert.strictEqual(m.yearStats.find((s) => s.year === 2030).tags.map((t) => t.name).join(","), "Carl");
});

check("matrix: at most 2 tags a year, oldest first regardless of points; no birth year goes last", () => {
  const hunters = [
    { name: "Young", birthYear: 1990, pointsHistory: [row(2026, 20)] },
    { name: "Old", birthYear: 1950, pointsHistory: [row(2026, 12)] },
    { name: "Mid", birthYear: 1970, pointsHistory: [row(2026, 12)] },
    { name: "Unknown", pointsHistory: [row(2026, 30)] }
  ];
  const m = APP.buildGroupMatrix(hunters, BULL_24, 2026, 2027, 2026);
  assert.strictEqual(APP.MAX_TAGS_PER_YEAR, 2);
  assert.strictEqual(m.yearStats.find((s) => s.year === 2027).tags.map((t) => t.name).join(","), "Old,Mid");
  assert.strictEqual(cellAt(m, "Young", 2027).qualifies, true);
  assert.strictEqual(cellAt(m, "Young", 2027).tag, null, "qualifies, but two older hunters took the tags");
  assert.strictEqual(cellAt(m, "Young", 2027).points, 21);
});

check("matrix: the Northern point counts toward reaching the cutoff", () => {
  const hunters = [
    { name: "North", northernResident: true, pointsHistory: [row(2026, 10)] },
    { name: "South", pointsHistory: [row(2026, 10)] }
  ];
  const m = APP.buildGroupMatrix(hunters, BULL_24, 2026, 2027, 2026);
  assert.strictEqual(cellAt(m, "North", 2027).points, 12, "11 + Northern point");
  assert.ok(cellAt(m, "North", 2027).tag);
  assert.strictEqual(cellAt(m, "South", 2027).qualifies, false);
});

check("matrix: a hunter qualifies for the first Group Choice slot they reach, in draw order", () => {
  const choice = {
    primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null],
    secondChance: [{ wmu: "24", mooseType: "Cow/calf", season: "Gun" }, null, null]
  };
  // 24 Cow/calf Gun Second Chance 1 latest cutoff is 10, bull primary 12.
  const m = APP.buildGroupMatrix([{ name: "C", pointsHistory: [row(2026, 9)] }], choice, 2026, 2027, 2026);
  const tag = cellAt(m, "C", 2027).tag;
  assert.strictEqual(tag.mooseType, "Cow/calf");
  assert.strictEqual(tag.stage, "Second Chance");
  assert.strictEqual(m.cutoffRows.length, 2, "one cutoff row per slot");
});

check("tag timeline lists real tags (claimed or not) for past years and predicted tags after", () => {
  const roster = [
    { name: "Patrick", pointsHistory: [row(2026, 8, { tagType: "Cow/calf", claimed: false })] },
    { name: "Carl", pointsHistory: [row(2026, 11)] }
  ];
  const tl = APP.buildTagTimeline(roster, BULL_24, 2026, 2027, 2026);
  assert.strictEqual(tl[0].actual.length, 1);
  assert.strictEqual(tl[0].actual[0].claimed, false);
  assert.strictEqual(tl[1].predicted.map((t) => t.name).join(","), "Carl", "Carl reaches 12 in 2027");
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
  const firstRowName = doc.querySelector("#matrixBody tr:not(.matrix-cutoff-row) td.matrix-name").textContent;
  assert.strictEqual(firstRowName, "Zed", "descending name sort should put Zed first");
});

check("renderMatrix shows the cutoff row, a row per hunter, the mismatch flag and the missing-birth-year note", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  dom.window.APP.loadRoster([
    { name: "Jason", pointsHistory: [row(2025, 1), row(2026, 0)] },
    { name: "Old", birthYear: 1950, pointsHistory: [row(2026, 3)] }
  ]);
  const doc = dom.window.document;
  assert.strictEqual(doc.querySelectorAll("#matrixBody tr:not(.matrix-cutoff-row)").length, 2);
  const cutoffCells = [...doc.querySelectorAll("#matrixBody tr.matrix-cutoff-row td.matrix-cutoff")];
  assert.ok(cutoffCells.length > 0 && cutoffCells.every((td) => /^(\d+|–)$/.test(td.textContent)), "whole numbers only");
  assert.strictEqual(doc.querySelectorAll("#matrixBody .matrix-flag").length, 1, "Jason's 2026 row breaks the rules");
  const note = doc.getElementById("matrixNote");
  assert.strictEqual(note.hidden, false);
  assert.ok(note.textContent.includes("Jason") && !note.textContent.includes("Old"));
});

check("renderTimelineTable marks predicted tags", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  const year = new Date().getFullYear();
  dom.window.APP.loadRoster([{ name: "Carl", pointsHistory: [row(year, 11)] }]);
  const predicted = dom.window.document.querySelectorAll("#timelineBody .timeline-predicted");
  assert.ok(predicted.length > 0);
  assert.ok(predicted[0].textContent.includes("Carl"));
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
