// test5.js - tab navigation added to make the tool easier to use: related tools are
// grouped into tabs (Overview / Roster / Rules / Data) instead of one long scroll.
// The Overview tab holds the Group Choice (WMU/tag type/season/stage/choice) and the
// team matrix - the two things the group actually opens the tool to see.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function freshApp() {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  dom.window.APP.render();
  return dom;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

const TAB_IDS = ["overview", "alt", "roster", "rules", "data"];

check("the app opens on the overview tab by default, with only that panel active", () => {
  const dom = freshApp();
  assert.strictEqual(dom.window.APP.getActiveTab(), "overview");
  const doc = dom.window.document;
  TAB_IDS.forEach((id) => {
    const panel = doc.getElementById("tab-" + id);
    assert.strictEqual(panel.classList.contains("active"), id === "overview", `tab-${id} active state`);
  });
});

check("showTab switches the active tab and panel classes, deactivating the rest", () => {
  const dom = freshApp();
  dom.window.APP.showTab("roster");
  assert.strictEqual(dom.window.APP.getActiveTab(), "roster");
  const doc = dom.window.document;
  assert.ok(doc.getElementById("tab-roster").classList.contains("active"));
  assert.ok(!doc.getElementById("tab-overview").classList.contains("active"));
  assert.ok(doc.getElementById("tabBtnRoster").classList.contains("active"));
  assert.ok(!doc.getElementById("tabBtnOverview").classList.contains("active"));
});

check("showTab ignores unknown tab names instead of leaving the UI in a broken state", () => {
  const dom = freshApp();
  dom.window.APP.showTab("nonexistent-tab");
  assert.strictEqual(dom.window.APP.getActiveTab(), "overview", "unknown tab name should be a no-op");
});

check("clicking a tab nav button (delegated click) switches tabs, not just the direct API", () => {
  const dom = freshApp();
  const doc = dom.window.document;
  const dataBtn = doc.getElementById("tabBtnData");
  dataBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.strictEqual(dom.window.APP.getActiveTab(), "data");
  assert.ok(doc.getElementById("tab-data").classList.contains("active"));
});

check("the overview tab holds the Group Choice table, the tags-by-year table, and the team matrix", () => {
  const dom = freshApp();
  const doc = dom.window.document;
  const overviewPanel = doc.getElementById("tab-overview");
  assert.ok(overviewPanel.querySelector("#targetSection"), "Group Choice lives in the overview tab");
  assert.ok(overviewPanel.querySelector("#timelineSection"), "the tags-by-year table lives in the overview tab");
  assert.ok(overviewPanel.querySelector("#matrixSection"), "the team matrix lives in the overview tab");
  const firstWmuSelect = doc.querySelector('#choiceBody select[data-field="wmu"]');
  assert.strictEqual(firstWmuSelect.value, dom.window.APP.getGroupChoice().primary[0].wmu);
});

check("filling a second Group Choice slot re-renders the tags-by-year table without breaking the matrix", () => {
  const dom = freshApp();
  dom.window.APP.loadRoster([{ name: "A", pointsHistory: [{ year: 2026, points: 5, tagType: null, claimed: false, northernResident: false }] }]);
  dom.window.APP.setChoiceSlot("primary", 1, "wmu", "28");
  assert.strictEqual(dom.window.APP.getGroupChoice().primary[1].wmu, "28");
  assert.ok(dom.window.document.querySelectorAll("#matrixBody tr").length > 0);
  assert.ok(dom.window.document.querySelectorAll("#timelineBody tr").length > 0);
  dom.window.APP.setChoiceSlot("primary", 1, "wmu", ""); // restore default for later checks
});

check("setLang re-renders tab labels in the chosen language", () => {
  const dom = freshApp();
  dom.window.APP.setLang("fr");
  const doc = dom.window.document;
  assert.strictEqual(doc.getElementById("tabBtnOverview").textContent, dom.window.APP.I18N.fr.tabOverview);
  assert.strictEqual(doc.getElementById("tabBtnRoster").textContent, dom.window.APP.I18N.fr.tabRoster);
  dom.window.APP.setLang("en");
});

check("the Alternative Application tab is a separate Group Choice + tags-by-year + matrix, independent of the Overview one", () => {
  const dom = freshApp();
  const doc = dom.window.document;
  const altPanel = doc.getElementById("tab-alt");
  assert.ok(altPanel.querySelector("#altTargetSection"), "Group Choice lives in the alt tab");
  assert.ok(altPanel.querySelector("#altTimelineSection"), "tags-by-year lives in the alt tab");
  assert.ok(altPanel.querySelector("#altMatrixSection"), "the team matrix lives in the alt tab");

  // Starts blank (not a copy of the default Overview choice), so it's
  // obviously a scenario to configure rather than already "the plan".
  assert.deepStrictEqual(dom.window.APP.getAltGroupChoice(), dom.window.APP.BLANK_GROUP_CHOICE);

  dom.window.APP.setChoiceSlot("primary", 0, "wmu", "28", "alt");
  assert.strictEqual(dom.window.APP.getAltGroupChoice().primary[0].wmu, "28", "alt choice updates independently");
  assert.strictEqual(
    dom.window.APP.getGroupChoice().primary[0].wmu,
    "24",
    "editing the alt choice must never touch the primary Overview choice"
  );

  const altWmuSelect = doc.querySelector('#altChoiceBody select[data-field="wmu"]');
  assert.strictEqual(altWmuSelect.value, "28");
  const overviewWmuSelect = doc.querySelector('#choiceBody select[data-field="wmu"]');
  assert.strictEqual(overviewWmuSelect.value, "24", "the overview table must still show the unrelated primary choice");
});

check("clicking a tab nav button switches to the Alternative Application tab", () => {
  const dom = freshApp();
  const doc = dom.window.document;
  doc.getElementById("tabBtnAlt").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.strictEqual(dom.window.APP.getActiveTab(), "alt");
  assert.ok(doc.getElementById("tab-alt").classList.contains("active"));
});

check("sorting the alt matrix by a year column does not affect the overview matrix's sort state", () => {
  const dom = freshApp();
  dom.window.APP.loadRoster([
    { name: "Zed", pointsHistory: [{ year: 2026, points: 3, tagType: null, claimed: false }] },
    { name: "Amy", pointsHistory: [{ year: 2026, points: 8, tagType: null, claimed: false }] }
  ]);
  dom.window.APP.sortMatrixBy(2026, "alt");
  assert.strictEqual(dom.window.APP.getAltMatrixSort().key, 2026);
  assert.strictEqual(dom.window.APP.getMatrixSort().key, "name", "the overview matrix's own sort must be untouched");
});

console.log(`\n${passed} passed (test5.js)`);
