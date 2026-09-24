// test5.js - tab navigation and the Overview "at a glance" panel added to make the
// tool easier to use: related tools are grouped into tabs instead of one long scroll,
// and Overview gives a glanceable summary (hunter count, group target, this year's
// outlook) instead of making the reader read every section to find the same info.
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

check("the app opens on the overview tab by default, with only that panel active", () => {
  const dom = freshApp();
  assert.strictEqual(dom.window.APP.getActiveTab(), "overview");
  const doc = dom.window.document;
  ["overview", "roster", "forecast", "rules", "data"].forEach((id) => {
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
  const forecastBtn = doc.getElementById("tabBtnForecast");
  forecastBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.strictEqual(dom.window.APP.getActiveTab(), "forecast");
  assert.ok(doc.getElementById("tab-forecast").classList.contains("active"));
});

check("the overview panel shows hunter count, group target, and this year's forecast status for demo data", () => {
  const dom = freshApp();
  const doc = dom.window.document;
  const statsHtml = doc.getElementById("overviewStats").innerHTML;
  assert.ok(statsHtml.includes(">3<"), "demo HUNTER_SEED has 3 hunters");
  assert.ok(statsHtml.includes("WMU 24"), "default group target is WMU 24");
  assert.ok(/pill pill-(gap|ok|stacked)/.test(statsHtml), "this year's status should render as a colored pill");
});

check("switching the group target updates the overview's target stat without a full page reload", () => {
  const dom = freshApp();
  dom.window.APP.setGroupTarget({ wmu: "28" });
  const statsHtml = dom.window.document.getElementById("overviewStats").innerHTML;
  assert.ok(statsHtml.includes("WMU 28"));
  dom.window.APP.setGroupTarget({ wmu: "24" }); // restore default
});

check("setLang re-renders tab labels in the chosen language", () => {
  const dom = freshApp();
  dom.window.APP.setLang("fr");
  const doc = dom.window.document;
  assert.strictEqual(doc.getElementById("tabBtnOverview").textContent, dom.window.APP.I18N.fr.tabOverview);
  assert.strictEqual(doc.getElementById("tabBtnRoster").textContent, dom.window.APP.I18N.fr.tabRoster);
  dom.window.APP.setLang("en");
});

console.log(`\n${passed} passed (test5.js)`);
