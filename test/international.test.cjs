const assert = require("node:assert/strict");
const test = require("node:test");
const Engine = require("../engine.js");
const International = require("../international.js");

const seeded = () => {
  let seed = 48112;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
};

test("the card draw preserves card identities and relocates every parking-straight sign", () => {
  assert.equal(International.cards.length, 36);
  assert.equal(International.cards.slice(12).every((card) => card.includes("+")), true);
  assert.equal(International.cards[4], International.cards[10]);
  assert.equal(International.cards[8], "GO2");
  assert.equal(International.cards[9], "RO2");
  const config = International.fromCards("D", "G", [19, 2, 36], "C");
  assert.equal(Engine.configKey(config), "INT:C:GI3+GO1/RI3/RI1+RI3/GO2");
  assert.equal(Engine.directedObstaclePairs(config, "CW").length, 6);
  assert.equal(Engine.directedObstaclePairs(config, "CCW").length, 6);
});

test("randomised obstacle rounds round-trip and never modify the drawn direction's first sign", () => {
  const random = seeded();
  const settings = Engine.normalizeSettings({ surpriseRule: true });
  const starts = new Set();
  const heights = new Set();
  const sizes = new Set();
  for (let index = 0; index < 600; index += 1) {
    const { config, direction } = International.drawRound(settings, random);
    const key = Engine.configKey(config);
    assert.equal(Engine.configKey(Engine.parseConfigKey(key)), key);
    assert(Engine.layoutMatchesSettings(key, settings));
    assert(!Engine.layoutMatchesSettings(key, Engine.normalizeSettings({ surpriseRule: false })));
    const first = International.orderedSigns(config, direction)[0];
    const modified = International.modifiedSign(config);
    assert.notEqual(`${first.section}${first.gate}`, `${modified.section}${modified.gate}`);
    for (const variant of Engine.legalRunVariants(config, settings)) {
      assert(International.legalSurprise(config, variant.direction));
    }
    assert(config.signs[International.sections.indexOf(config.startSection)].every((item) => item.band === "I"));
    assert.notEqual(modified.color, modified.visibleColor);
    starts.add(config.startSection);
    heights.add(modified.height);
    sizes.add(config.signs.flat().length);
  }
  assert.deepEqual([...starts].sort(), ["A", "B", "C", "D"]);
  assert.deepEqual([...heights].sort((a, b) => a - b), [50, 150]);
  assert.deepEqual([...sizes].sort(), [4, 5, 6, 7]);
});

test("first-sign exclusion follows exit direction and can disable the opposite variant", () => {
  const config = International.fromCards("D", "G", [25, 2, 36], "A");
  config.surprise = { section: "A", gate: "3", height: 150 };
  assert.equal(International.legalSurprise(config, "CW"), false);
  assert.equal(International.legalSurprise(config, "CCW"), true);
  assert(Engine.legalRunVariants(config, Engine.normalizeSettings({ surpriseRule: true }))
    .every((variant) => variant.direction === "CCW"));
});

test("Open draws and planner variants use only available starting zones", () => {
  const settings = Engine.normalizeSettings({ raceMode: "free", surpriseRule: true });
  assert.equal(Engine.candidateLayouts(settings).length, 64);
  for (const config of Engine.candidateLayouts(settings)) {
    const width = config[International.sectionWidths[config.startSection]];
    const expected = width === 600 ? [1, 2, 4, 5] : [1, 2, 3, 4, 5, 6];
    assert.deepEqual(International.openStartZones(config), expected);
    assert.deepEqual(Engine.parseConfigKey(Engine.configKey(config)), config);
    for (const variant of Engine.legalRunVariants(config, settings)) {
      assert(expected.includes(variant.zoneNumber));
      assert.deepEqual(Engine.parseRunVariantKey(Engine.runVariantKey(variant)), variant);
    }
  }
});

test("legacy layouts retain their keys and coverage stays in the active ruleset", () => {
  const german = Engine.normalizeSettings({ ruleset: "german" });
  const international = Engine.normalizeSettings();
  assert.equal(international.ruleset, "international");
  assert.equal(Engine.candidateLayouts(german).length, 10368);
  assert.equal(Engine.exactRunCycleStats([], german).total, 27648);
  const legacy = { layoutKey: "RI1-GI2-GO3-RO1", variantKey: "CW:zone", result: "pass" };
  assert(Engine.recordMatchesSettings(legacy, german));
  assert(!Engine.recordMatchesSettings(legacy, international));
  const plan = Engine.suggestNext({ records: [legacy], settings: international });
  assert(Engine.layoutMatchesSettings(plan.layoutKey, international));
  const played = { layoutKey: plan.layoutKey, variantKey: Engine.runVariantKey(plan.variants[0]), result: "pass" };
  assert.equal(Engine.coverageFromRecords([legacy, played], international).attemptedLayouts.size, 1);
  assert.equal(Engine.coverageFromRecords([legacy, played], german).attemptedLayouts.size, 1);
});
