// test3.js - forecast engine tests (projectCutoff, drawProbability, buildBullForecast,
// computeGroupStaggering). This replaces the old static hand-set-MPR / deterministic
// pass-fail model with a trend fitted to real WMU 24 draw data and a probability ramp.
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

check("WMU24_TRENDS.bullGunPrimary holds the real 2021-2025 cutoffs, not a guessed constant", () => {
  const trend = APP.WMU24_TRENDS.bullGunPrimary;
  assert.strictEqual(trend.length, 5);
  const byYear = Object.fromEntries(trend.map((p) => [p.year, p.cutoff]));
  assert.deepStrictEqual(byYear, { 2021: 11, 2022: 10, 2023: 12, 2024: 12, 2025: 12 });
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

check("projectCutoff on the real bull-gun trend projects forward past the historical range", () => {
  const cutoff2028 = APP.projectCutoff(APP.WMU24_TRENDS.bullGunPrimary, 2028);
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

check("buildBullForecast projects a hunter's points forward and ramps probability with the trend", () => {
  const hunter = { name: "Test", pointsHistory: [{ year: 2026, points: 8, tagType: null, claimed: false, northernResident: false }] };
  const trend = [
    { year: 2026, cutoff: 10 },
    { year: 2027, cutoff: 10 },
    { year: 2028, cutoff: 10 }
  ];
  const forecast = APP.buildBullForecast(hunter, 2026, 2028, trend);
  assert.strictEqual(forecast.length, 3);
  assert.strictEqual(forecast[0].points, 8);
  assert.strictEqual(forecast[0].probability, 0);
  assert.strictEqual(forecast[1].points, 9);
  assert.strictEqual(forecast[1].probability, 0.5);
  assert.strictEqual(forecast[2].points, 10);
  assert.strictEqual(forecast[2].probability, 1);
});

check("buildBullForecast adds the Northern bonus to probability only, not to projected points", () => {
  const hunter = { name: "North", pointsHistory: [{ year: 2026, points: 9, tagType: null, claimed: false, northernResident: true }] };
  const trend = [{ year: 2026, cutoff: 10 }];
  const forecast = APP.buildBullForecast(hunter, 2026, 2026, trend);
  assert.strictEqual(forecast[0].points, 9, "raw projected points exclude the bonus");
  assert.strictEqual(forecast[0].probability, 1, "9 banked + 1 Northern bonus clears a cutoff of 10");
});

check("computeGroupStaggering flags a gap year when nobody is likely bull-ready", () => {
  const hunters = [
    { name: "A", pointsHistory: [{ year: 2026, points: 0, tagType: null, claimed: false }] },
    { name: "B", pointsHistory: [{ year: 2026, points: 1, tagType: null, claimed: false }] }
  ];
  const trend = [{ year: 2026, cutoff: 12 }];
  const staggering = APP.computeGroupStaggering(hunters, 2026, 2026, trend);
  assert.strictEqual(staggering[0].status, "gap");
  assert.strictEqual(staggering[0].expected, 0);
});

check("computeGroupStaggering flags a stacked year when several hunters are likely bull-ready at once", () => {
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
  const staggering = APP.computeGroupStaggering(APP.HUNTER_SEED, 2021, 2025, APP.WMU24_TRENDS.bullGunPrimary);
  const cutoffs = staggering.map((r) => r.cutoff);
  const expected = [10.6, 11, 11.4, 11.8, 12.2];
  cutoffs.forEach((c, i) => assert.ok(Math.abs(c - expected[i]) < 0.001, `year ${staggering[i].year}: ${c} ~= ${expected[i]}`));
  const unique = new Set(cutoffs);
  assert.ok(unique.size > 1, "a real trend-based cutoff must vary year to year, unlike a hand-set flat MPR constant");
});

check("renderForecast populates the forecast table in the DOM with one row per projected year", () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  dom.window.APP.render();
  const rows = dom.window.document.querySelectorAll("#forecastBody tr");
  assert.strictEqual(rows.length, 8, "current year plus 7 years ahead");
});

console.log(`\n${passed} passed (test3.js)`);
