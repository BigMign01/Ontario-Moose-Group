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

check("MOOSE_TRENDS covers more than just WMU 24 - the dataset is province-wide", () => {
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

check("default group target resolves to real trend data out of the box (WMU 24 bull/gun/primary)", () => {
  const target = APP.getGroupTarget();
  assert.deepStrictEqual(target, APP.DEFAULT_GROUP_TARGET);
  assert.ok(APP.getTrendSeries(target), "the default target must have data, or the app opens with an empty forecast");
});

check("setGroupTarget updates state and re-renders the forecast for the new target", () => {
  const before = APP.getGroupTarget();
  assert.strictEqual(before.wmu, "24");
  APP.setGroupTarget({ wmu: "28" });
  assert.strictEqual(APP.getGroupTarget().wmu, "28");
  APP.setGroupTarget({ wmu: "24" }); // restore default for any later checks in this process
});

check("renderForecast populates the forecast table in the DOM with one row per projected year", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  dom.window.APP.render();
  const rows = dom.window.document.querySelectorAll("#forecastBody tr");
  assert.strictEqual(rows.length, 8, "current year plus 7 years ahead");
});

check("renderTargetSelector populates all five target dropdowns for the default target", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  dom.window.APP.render();
  const doc = dom.window.document;
  assert.strictEqual(doc.getElementById("targetWmu").value, "24");
  assert.strictEqual(doc.getElementById("targetMooseType").value, "Bull");
  assert.strictEqual(doc.getElementById("targetSeason").value, "Gun");
  assert.strictEqual(doc.getElementById("targetStage").value, "Primary");
  assert.strictEqual(doc.getElementById("targetChoice").value, "1");
  assert.ok(doc.getElementById("targetWmu").options.length > 30);
});

console.log(`\n${passed} passed (test3.js)`);
