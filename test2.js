// test2.js - getSeasonPhase() deadline-tracker branching tests, including the
// 2027 ERO 019-7813 allocation-change branching added to the deadline banner.
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

check("Jan 15 (any year) -> applicationOpen", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 0, 15));
  assert.strictEqual(phase.key, "applicationOpen");
  assert.strictEqual(phase.daysUntil, 16);
});

check("May 10 -> drawResults", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 4, 10));
  assert.strictEqual(phase.key, "drawResults");
});

check("Jul 20 -> secondChanceOpen", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 6, 20));
  assert.strictEqual(phase.key, "secondChanceOpen");
});

check("Nov 20 -> seasonActive", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 10, 20));
  assert.strictEqual(phase.key, "seasonActive");
});

check("Dec 20 -> offSeason", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 11, 20));
  assert.strictEqual(phase.key, "offSeason");
});

// --- Pre-2027 (old rules still govern the 2026 season) ---------------------

check("PRE-2027: Aug 1, 2026 -> old secondChanceClaim phase (fixed Aug1-Nov15 window intact)", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 7, 1));
  assert.strictEqual(phase.key, "secondChanceClaim");
  assert.strictEqual(phase.daysUntil, 136); // days to Dec 15, 2026
  assert.strictEqual(APP.t("deadline.secondChanceClaim", phase.daysUntil).includes("Dec 15"), true);
});

check("PRE-2027: Sep 10, 2026 -> still old secondChanceClaim (no lastChance branch before 2027)", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 8, 10));
  assert.strictEqual(phase.key, "secondChanceClaim");
});

check("PRE-2027: Nov 15, 2026 -> last day of old secondChanceClaim window", () => {
  const phase = APP.getSeasonPhase(new Date(2026, 10, 15));
  assert.strictEqual(phase.key, "secondChanceClaim");
  assert.strictEqual(phase.daysUntil, 30);
});

// --- Post-2027 (confirmed ERO 019-7813 changes apply) -----------------------

check("POST-2027: Aug 5, 2027 -> secondChanceClaimAdvanced, no fixed date, TBD wording", () => {
  const phase = APP.getSeasonPhase(new Date(2027, 7, 5));
  assert.strictEqual(phase.key, "secondChanceClaimAdvanced");
  assert.strictEqual(phase.daysUntil, null);
  const text = APP.t("deadline.secondChanceClaimAdvanced");
  assert.ok(text.toLowerCase().includes("tbd") || text.toLowerCase().includes("confirm"));
});

check("POST-2027: Sep 5, 2027 -> lastChanceUpcoming, counts down to provisional Sep 15 start", () => {
  const phase = APP.getSeasonPhase(new Date(2027, 8, 5));
  assert.strictEqual(phase.key, "lastChanceUpcoming");
  assert.strictEqual(phase.daysUntil, 10);
  const text = APP.t("deadline.lastChanceUpcoming", phase.daysUntil);
  assert.ok(text.toLowerCase().includes("tbd") || text.toLowerCase().includes("confirm"));
});

check("POST-2027: Oct 1, 2027 -> lastChance active, TBD wording, no old Aug1-Nov15 secondChanceClaim leak", () => {
  const phase = APP.getSeasonPhase(new Date(2027, 9, 1));
  assert.strictEqual(phase.key, "lastChance");
  assert.notStrictEqual(phase.key, "secondChanceClaim");
  const text = APP.t("deadline.lastChance");
  assert.ok(text.toLowerCase().includes("tbd") || text.toLowerCase().includes("confirm"));
});

check("POST-2027: Nov 15, 2027 -> still within the new lastChance branch, not the old phase", () => {
  const phase = APP.getSeasonPhase(new Date(2027, 10, 15));
  assert.strictEqual(phase.key, "lastChance");
});

check("POST-2027 vs PRE-2027 on the same calendar day diverge (Sep 20 2026 vs Sep 20 2027)", () => {
  const phase2026 = APP.getSeasonPhase(new Date(2026, 8, 20));
  const phase2027 = APP.getSeasonPhase(new Date(2027, 8, 20));
  assert.strictEqual(phase2026.key, "secondChanceClaim");
  assert.strictEqual(phase2027.key, "lastChance");
});

check("All new 2027 deadline keys exist in both I18N.fr.deadline and I18N.en.deadline", () => {
  ["secondChanceClaimAdvanced", "lastChance", "lastChanceUpcoming"].forEach((key) => {
    assert.strictEqual(typeof APP.I18N.en.deadline[key], "function", `en.deadline.${key} missing`);
    assert.strictEqual(typeof APP.I18N.fr.deadline[key], "function", `fr.deadline.${key} missing`);
  });
});

console.log(`\n${passed} passed (test2.js)`);
