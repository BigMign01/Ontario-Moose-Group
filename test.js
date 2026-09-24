// test.js - general structural tests for index.html (I18N, HUNTER_SEED, rules, roster rendering)
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function freshApp() {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  return dom.window;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

const win = freshApp();
const APP = win.APP;

check("window.APP is exposed with expected members", () => {
  assert.ok(APP, "APP should be exposed on window");
  assert.ok(APP.I18N && APP.I18N.en && APP.I18N.fr, "I18N.en/I18N.fr must exist");
  assert.strictEqual(typeof APP.t, "function");
  assert.strictEqual(typeof APP.getSeasonPhase, "function");
  assert.strictEqual(typeof APP.computeTimeline, "function");
  assert.strictEqual(APP.NORTHERN_PREFERENCE_POINT, 1);
});

check("I18N has both languages for all rule cards, including new 2027 cards", () => {
  const ruleKeys = ["ruleLicence", "ruleRadius", "ruleKill", "ruleNotch", "ruleReport", "ruleWatch", "ruleAllocation2027"];
  ["en", "fr"].forEach((lang) => {
    ruleKeys.forEach((key) => {
      const rule = APP.I18N[lang][key];
      assert.ok(rule, `${lang}.${key} should exist`);
      assert.strictEqual(typeof rule.h, "string");
      assert.strictEqual(typeof rule.p, "string");
      assert.ok(rule.h.length > 0 && rule.p.length > 0);
    });
  });
});

check("ruleWatch no longer contains the old vague 'watch this link' placeholder text", () => {
  ["en", "fr"].forEach((lang) => {
    const text = (APP.I18N[lang].ruleWatch.h + " " + APP.I18N[lang].ruleWatch.p).toLowerCase();
    assert.ok(!text.includes("watch this link"));
  });
});

check("ruleWatch documents that awarded (not just claimed) first-choice forfeits points, and 99Z is unaffected", () => {
  const p = APP.I18N.en.ruleWatch.p.toLowerCase();
  assert.ok(p.includes("awarded"), "should mention being AWARDED forfeits points");
  assert.ok(p.includes("99z"), "should mention 99Z is unaffected");
});

check("ruleAllocation2027 documents the TBD claim deadline and provisional Last Chance stage", () => {
  const p = APP.I18N.en.ruleAllocation2027.p.toLowerCase();
  assert.ok(p.includes("mnr"), "should mention MNR confirms the date");
  assert.ok(p.includes("last chance"), "should describe the Last Chance Allocation stage");
  assert.ok(p.includes("provisional") || p.includes("not yet finalized"));
});

check("HUNTER_SEED has the expected shape", () => {
  assert.ok(Array.isArray(APP.HUNTER_SEED) && APP.HUNTER_SEED.length > 0);
  APP.HUNTER_SEED.forEach((hunter) => {
    assert.strictEqual(typeof hunter.name, "string");
    assert.ok(Array.isArray(hunter.pointsHistory));
    hunter.pointsHistory.forEach((entry) => {
      assert.strictEqual(typeof entry.year, "number");
      assert.strictEqual(typeof entry.points, "number");
      assert.strictEqual(typeof entry.claimed, "boolean");
    });
  });
});

check("Alex's 2026 entry reflects the claimed Cow/calf tag with points reset to 0 (primary / 2nd-chance 1st-choice case)", () => {
  const alex = APP.HUNTER_SEED.find((h) => h.name === "Alex");
  assert.ok(alex, "Alex should be in HUNTER_SEED");
  const entry2026 = alex.pointsHistory.find((e) => e.year === 2026);
  assert.ok(entry2026, "Alex should have a 2026 entry");
  assert.strictEqual(entry2026.tagType, "Cow/calf");
  assert.strictEqual(entry2026.claimed, true);
  assert.strictEqual(entry2026.points, 0);
});

check("computeTimeline applies NORTHERN_PREFERENCE_POINT to MPR only for northernResident hunters, not to banked points", () => {
  const hunters = [
    { name: "A", pointsHistory: [{ year: 2026, points: 3, tagType: null, claimed: false, northernResident: true }] },
    { name: "B", pointsHistory: [{ year: 2026, points: 5, tagType: null, claimed: false, northernResident: false }] }
  ];
  const timeline = APP.computeTimeline(hunters);
  const a = timeline.find((h) => h.name === "A");
  const b = timeline.find((h) => h.name === "B");
  assert.strictEqual(a.banked, 3);
  assert.strictEqual(a.mpr, 3 + APP.NORTHERN_PREFERENCE_POINT, "northernResident hunter gets the bonus in MPR only");
  assert.strictEqual(b.banked, 5);
  assert.strictEqual(b.mpr, 5, "non-northernResident hunter gets no bonus");
  assert.strictEqual(timeline[0].name, "B", "B's unboosted 5 still outranks A's boosted 4");
});

check("computeTimeline gives no Northern bonus when northernResident is absent or false for everyone", () => {
  const hunters = [
    { name: "A", pointsHistory: [{ year: 2026, points: 3, tagType: null, claimed: false }] },
    { name: "B", pointsHistory: [{ year: 2026, points: 3, tagType: null, claimed: false, northernResident: false }] }
  ];
  const timeline = APP.computeTimeline(hunters);
  timeline.forEach((h) => assert.strictEqual(h.mpr, h.banked));
});

check("parseRosterRows groups flat spreadsheet rows into HUNTER_SEED-shaped roster, including NorthernResident", () => {
  const rows = [
    { Hunter: "Zed", Year: 2025, Points: 4, TagType: null, Claimed: null, WMU: "24", Season: "Gun", MooseType: null, NorthernResident: "Y" },
    { Hunter: "Zed", Year: 2026, Points: 5, TagType: null, Claimed: "N", WMU: "24", Season: "Gun", MooseType: null, NorthernResident: "Y" },
    { Hunter: "Amy", Year: 2026, Points: 0, TagType: "Bull", Claimed: "Y", WMU: "28", Season: "Bow", MooseType: "Bull", NorthernResident: "N" },
    { Hunter: "", Year: 2026, Points: 1 } // blank hunter name should be skipped
  ];
  const roster = APP.parseRosterRows(rows);
  assert.strictEqual(roster.length, 2);
  assert.strictEqual(roster[0].name, "Amy", "roster is sorted by name");
  assert.strictEqual(roster[1].name, "Zed");
  const zed = roster.find((h) => h.name === "Zed");
  assert.strictEqual(zed.pointsHistory.length, 2);
  assert.strictEqual(zed.pointsHistory[0].year, 2025, "rows are sorted by year within a hunter");
  assert.strictEqual(zed.pointsHistory[1].points, 5);
  assert.strictEqual(zed.pointsHistory[1].claimed, false);
  assert.strictEqual(zed.pointsHistory[1].northernResident, true);
  const amy = roster.find((h) => h.name === "Amy");
  assert.strictEqual(amy.pointsHistory[0].tagType, "Bull");
  assert.strictEqual(amy.pointsHistory[0].claimed, true);
  assert.strictEqual(amy.pointsHistory[0].northernResident, false);
});

check("renderRules renders a card in the DOM for ruleAllocation2027", () => {
  APP.render();
  const card = win.document.querySelector('[data-rule="ruleAllocation2027"]');
  assert.ok(card, "ruleAllocation2027 card should be rendered");
  assert.ok(card.querySelector("h3").textContent.length > 0);
});

check("renderRoster renders one editable row per pointsHistory entry plus an add-year row per hunter, including Alex's 2026 claimed row", () => {
  APP.render();
  const allRows = win.document.querySelectorAll("#rosterBody tr");
  const totalEntries = APP.HUNTER_SEED.reduce((sum, h) => sum + h.pointsHistory.length, 0);
  assert.strictEqual(allRows.length, totalEntries + APP.HUNTER_SEED.length, "one row per entry plus one add-year row per hunter");
  const entryRows = Array.from(allRows).filter((tr) => tr.children.length > 1);
  const alexRow = entryRows.find(
    (tr) => tr.children[0].textContent === "Alex" && tr.children[1].textContent === "2026"
  );
  assert.ok(alexRow, "Alex 2026 row should exist");
  assert.strictEqual(alexRow.children[3].querySelector("input").value, "Cow/calf");
  assert.strictEqual(alexRow.children[4].querySelector("input").checked, true);
});

check("setLang('fr') swaps rendered rule text to French", () => {
  APP.setLang("fr");
  const card = win.document.querySelector('[data-rule="ruleWatch"]');
  assert.strictEqual(card.querySelector("h3").textContent, APP.I18N.fr.ruleWatch.h);
  APP.setLang("en");
});

check("before any upload, the roster is the demo HUNTER_SEED data, not marked as uploaded", () => {
  assert.strictEqual(APP.isRosterUploaded(), false);
  assert.strictEqual(APP.getActiveRoster(), APP.HUNTER_SEED);
});

check("loadRoster() swaps the active roster, marks it as uploaded, and re-renders (run last: mutates shared app state)", () => {
  const uploaded = [
    { name: "Uploaded Hunter", pointsHistory: [{ year: 2026, points: 2, tagType: null, claimed: false, northernResident: true }] }
  ];
  APP.loadRoster(uploaded);
  assert.strictEqual(APP.isRosterUploaded(), true);
  assert.strictEqual(APP.getActiveRoster(), uploaded);
  const rows = win.document.querySelectorAll("#rosterBody tr");
  assert.strictEqual(rows.length, 2, "one entry row plus one add-year row");
  assert.strictEqual(rows[0].children[0].textContent, "Uploaded Hunter");
  const status = win.document.getElementById("dataStatus").textContent;
  assert.ok(status.includes("1"), "data status should reflect the uploaded roster's hunter count");
});

console.log(`\n${passed} passed (test.js)`);
