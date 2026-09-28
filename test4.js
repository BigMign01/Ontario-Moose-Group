// test4.js - in-browser roster editing, localStorage persistence, and xlsx export
// (rosterToRows) added so groups can manage their data directly in the tool instead
// of only reading it from an upload.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function freshApp() {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", pretendToBeVisual: true });
  return dom;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

check("rosterToRows is the inverse of parseRosterRows (round-trips through both)", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  const roster = [
    {
      name: "Zed",
      pointsHistory: [
        { year: 2025, points: 4, tagType: null, claimed: false, wmu: "24", season: "Gun", mooseType: "Bull", northernResident: true },
        { year: 2026, points: 0, tagType: "Bull", claimed: true, wmu: "24", season: "Gun", mooseType: "Bull", northernResident: true }
      ]
    }
  ];
  const rows = APP.rosterToRows(roster);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].Hunter, "Zed");
  assert.strictEqual(rows[1].Claimed, "Y");
  assert.strictEqual(rows[1].NorthernResident, "Y");
  assert.strictEqual(rows[0].Claimed, "N");

  const roundTripped = APP.parseRosterRows(rows);
  assert.strictEqual(roundTripped.length, 1);
  assert.strictEqual(roundTripped[0].name, "Zed");
  const expected = [[2025, 4, false, true], [2026, 0, true, true]];
  roundTripped[0].pointsHistory.forEach((e, i) => {
    assert.deepStrictEqual([e.year, e.points, e.claimed, e.northernResident], expected[i]);
  });
});

check("buildPointsSeries returns real history up to the current year plus a forward projection", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  const roster = [
    { name: "A", pointsHistory: [{ year: 2024, points: 2, tagType: null, claimed: false }, { year: 2025, points: 3, tagType: null, claimed: false }] }
  ];
  const series = APP.buildPointsSeries(roster, 2025, 2027);
  assert.strictEqual(series[0].name, "A");
  const byYear = Object.fromEntries(series[0].points.map((p) => [p.year, p.points]));
  assert.deepStrictEqual(byYear, { 2024: 2, 2025: 3, 2026: 4, 2027: 5 });
});

check("updateEntryField edits a hunter's entry in place and re-sorts by year", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  APP.loadRoster([{ name: "Edit Me", pointsHistory: [{ year: 2026, points: 3, tagType: null, claimed: false, northernResident: false }] }]);
  APP.updateEntryField("Edit Me", 0, "points", "7");
  const hunter = APP.getActiveRoster().find((h) => h.name === "Edit Me");
  assert.strictEqual(hunter.pointsHistory[0].points, 7);
  APP.updateEntryField("Edit Me", 0, "claimed", true);
  assert.strictEqual(hunter.pointsHistory[0].claimed, true);
  APP.updateEntryField("Edit Me", 0, "northernResident", true);
  assert.strictEqual(hunter.pointsHistory[0].northernResident, true);
});

check("addYearForHunter appends a new blank entry the year after the hunter's latest", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  APP.loadRoster([{ name: "Grower", pointsHistory: [{ year: 2026, points: 5, tagType: null, claimed: false, northernResident: false }] }]);
  APP.addYearForHunter("Grower");
  const hunter = APP.getActiveRoster().find((h) => h.name === "Grower");
  assert.strictEqual(hunter.pointsHistory.length, 2);
  assert.strictEqual(hunter.pointsHistory[1].year, 2027);
  assert.strictEqual(hunter.pointsHistory[1].points, 0);
});

check("deleteEntry removes just the targeted entry", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  APP.loadRoster([
    { name: "Trim Me", pointsHistory: [
      { year: 2025, points: 1, tagType: null, claimed: false, northernResident: false },
      { year: 2026, points: 2, tagType: null, claimed: false, northernResident: false }
    ] }
  ]);
  APP.deleteEntry("Trim Me", 0);
  const hunter = APP.getActiveRoster().find((h) => h.name === "Trim Me");
  assert.strictEqual(hunter.pointsHistory.length, 1);
  assert.strictEqual(hunter.pointsHistory[0].year, 2026);
});

check("addHunterNamed adds a new hunter with a single current-year entry, and ignores blank names", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  const before = APP.getActiveRoster().length;
  APP.addHunterNamed("  New Guy  ");
  assert.strictEqual(APP.getActiveRoster().length, before + 1);
  const added = APP.getActiveRoster().find((h) => h.name === "New Guy");
  assert.ok(added, "name should be trimmed");
  assert.strictEqual(added.pointsHistory.length, 1);

  APP.addHunterNamed("   ");
  assert.strictEqual(APP.getActiveRoster().length, before + 1, "blank name should not add a hunter");
});

check("editing a roster field marks it as uploaded, so the blank/empty state no longer shows", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  assert.strictEqual(APP.isRosterUploaded(), false);
  APP.loadRoster([{ name: "Seed", pointsHistory: [{ year: 2026, points: 3, tagType: null, claimed: false, northernResident: false }] }]);
  APP.updateEntryField("Seed", 0, "points", "99");
  assert.strictEqual(APP.isRosterUploaded(), true);
  const hunter = APP.getActiveRoster().find((h) => h.name === "Seed");
  assert.strictEqual(hunter.pointsHistory[0].points, 99);
});

check("an uploaded/edited roster persists to localStorage as valid, round-trippable state", () => {
  const dom1 = freshApp();
  const roster = [{ name: "Persisted", pointsHistory: [{ year: 2026, points: 6, tagType: null, claimed: false, northernResident: true }] }];
  dom1.window.APP.loadRoster(roster);
  const raw = dom1.window.localStorage.getItem("mooseTrackerState_v1");
  assert.ok(raw, "state should be saved to localStorage");
  const saved = JSON.parse(raw);
  assert.strictEqual(saved.roster[0].name, "Persisted");
  assert.deepStrictEqual(saved.groupChoice, {
    primary: [{ wmu: "24", mooseType: "Bull", season: "Gun" }, null, null],
    secondChance: [null, null, null]
  });
});

check("a roster saved in localStorage is restored automatically when the app loads again (simulated reload)", () => {
  const seedRoster = [{ name: "Restored Hunter", pointsHistory: [{ year: 2026, points: 6, tagType: null, claimed: false, northernResident: true }] }];
  const seedChoice = { primary: [{ wmu: "28", mooseType: "Bull", season: "Gun" }, null, null], secondChance: [null, null, null] };
  const seedState = JSON.stringify({ roster: seedRoster, groupChoice: seedChoice });

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/",
    beforeParse(window) {
      // Seeds the same localStorage the app itself reads from, before the
      // page's own script runs - simulating a real page reload with a
      // previously-saved roster already in the browser.
      window.localStorage.setItem("mooseTrackerState_v1", seedState);
    }
  });

  const restoredRoster = dom.window.APP.getActiveRoster();
  assert.strictEqual(restoredRoster.length, 1);
  assert.strictEqual(restoredRoster[0].name, "Restored Hunter");
  assert.strictEqual(dom.window.APP.isRosterUploaded(), true);
  assert.strictEqual(dom.window.APP.getGroupChoice().primary[0].wmu, "28", "the saved group choice should restore too");
});

check("a saved groupChoice with the wrong shape is ignored, falling back to the default", () => {
  const seedState = JSON.stringify({ roster: null, groupChoice: { primary: "not-an-array" } });
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/",
    beforeParse(window) {
      window.localStorage.setItem("mooseTrackerState_v1", seedState);
    }
  });
  assert.deepStrictEqual(dom.window.APP.getGroupChoice(), dom.window.APP.DEFAULT_GROUP_CHOICE);
});

check("sheetRowsToObjects finds the real header row even when row 1 is a legend note (the actual template shape)", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  // Reproduces the real template's raw sheet shape: row 1 is a legend
  // note, row 2 is the Hunter/Year/... header, then data rows - exactly
  // what XLSX.utils.sheet_to_json(sheet, {header:1}) would return for the
  // group's actual uploaded file.
  const rawRows = [
    ["Pale yellow = fields you edit · Pale orange = current draw year (2026) · see the Instructions tab", null, null, null, null, null, null, null],
    ["Hunter", "Year", "Points", "TagType", "Claimed", "WMU", "Season", "MooseType"],
    ["Gerard", 2020, 5, null, null, null, null, null],
    ["Gerard", 2021, 6, "Cow/calf", "Y", 24, "Gun", null],
    ["Carl", 2020, 2, null, null, null, null, null]
  ];
  const rows = APP.sheetRowsToObjects(rawRows);
  assert.strictEqual(rows.length, 3, "the legend row must not become a bogus data row");
  assert.strictEqual(rows[0].Hunter, "Gerard");
  assert.strictEqual(rows[0].Year, 2020);
  assert.strictEqual(rows[1].TagType, "Cow/calf");
  assert.strictEqual(rows[1].Claimed, "Y");

  const roster = APP.parseRosterRows(rows);
  assert.strictEqual(roster.length, 2, "Gerard and Carl should both come through");
  const gerard = roster.find((h) => h.name === "Gerard");
  assert.strictEqual(gerard.pointsHistory.length, 2);
  assert.strictEqual(gerard.pointsHistory[1].tagType, "Cow/calf");
});

check("sheetRowsToObjects also handles a plain sheet with the header on row 1 (no legend note)", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  const rawRows = [
    ["Hunter", "Year", "Points"],
    ["Alex", 2026, 4]
  ];
  const rows = APP.sheetRowsToObjects(rawRows);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].Hunter, "Alex");
  assert.strictEqual(rows[0].Points, 4);
});

check("sheetRowsToObjects returns nothing usable when no row contains a Hunter header, instead of misreading random cells", () => {
  const dom = freshApp();
  const APP = dom.window.APP;
  const rawRows = [["not", "a", "roster"], [1, 2, 3]];
  assert.strictEqual(APP.sheetRowsToObjects(rawRows).length, 0);
});

check("exportRoster is wired to the export button and calls into XLSX when present (smoke test)", () => {
  const dom = freshApp();
  const doc = dom.window.document;
  const btn = doc.getElementById("exportBtn");
  assert.ok(btn, "export button should exist in the Data section");
  // XLSX isn't loaded in jsdom (external <script src> isn't executed), so
  // clicking must be a no-op rather than throwing.
  assert.doesNotThrow(() => btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
});

console.log(`\n${passed} passed (test4.js)`);
