(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WroInternational = factory();
})(globalThis, function () {
  "use strict";

  // Figure 8c, read with the inner wall at the top. Left to right is gate 3 to gate 1.
  // Card identities are kept even when two faces have the same placement.
  const cards = [
    "GI3", "RI3", "GI2", "RI2", "GI1", "RI1", "GO3", "RO3", "GO2", "RO2", "GI1", "RI1",
    "GO3+GI1", "GO3+RI1", "RO3+GI1", "GO3+RI1", "RO3+GI1", "RO3+RI1",
    "GI3+GO1", "GI3+RO1", "RI3+GO1", "GI3+RO1", "RI3+GO1", "RI3+RO1",
    "GI3+GI1", "GI3+RI1", "RI3+GI1", "GI3+RI1", "RI3+GI1", "RI3+RI1",
    "GO3+GO1", "GO3+RO1", "RO3+GO1", "GO3+RO1", "RO3+GO1", "RO3+RO1",
  ];
  const sections = ["A", "B", "C", "D"];
  const sectionWidths = { A: "bottom", B: "left", C: "top", D: "right" };
  const pick = (list, random) => list[Math.floor(random() * list.length)];
  const slot = (section, gate) => `${section}${gate}`;
  const decode = (code) => ({ color: code[0], band: code[1], gate: code[2] });

  function fromCards(singleSection, singleColor, cardIds, startSection) {
    const singleIndex = sections.indexOf(singleSection);
    const signs = Array.from({ length: 4 }, () => []);
    signs[singleIndex] = [`${singleColor}O2`];
    cardIds.forEach((id, index) => {
      signs[(singleIndex + index + 1) % 4] = cards[id - 1].split("+");
    });
    const parkingIndex = sections.indexOf(startSection);
    signs[parkingIndex] = signs[parkingIndex].map((code) => `${code[0]}I${code[2]}`);
    return { ruleset: "international", raceMode: "obstacle", startSection, signs: signs.map((row) => row.map(decode)) };
  }

  function drawObstacle(random) {
    const single = pick(sections, random);
    const color = pick(["G", "R"], random);
    const deck = cards.map((_, index) => index + 1).filter((id) => id !== (color === "G" ? 9 : 10));
    const drawn = [];
    while (drawn.length < 3) drawn.push(deck.splice(Math.floor(random() * deck.length), 1)[0]);
    return fromCards(single, color, drawn, pick(sections, random));
  }

  function orderedSigns(config, direction) {
    const step = direction === "CW" ? 1 : -1;
    const start = sections.indexOf(config.startSection);
    const ordered = sections.map((_, index) => (start + step * index + 4) % 4).map((index) =>
      config.signs[index].map((item) => ({ ...item, section: sections[index] }))
        .sort((a, b) => step * (Number(a.gate) - Number(b.gate))));
    // The illustrated bay and the zone above it lie between gates 1 and 2.
    const ahead = (item) => direction === "CW" ? item.gate !== "1" : item.gate === "1";
    return [...ordered[0].filter(ahead), ...ordered.slice(1).flat(), ...ordered[0].filter((item) => !ahead(item))];
  }

  function modifiedSign(config) {
    if (!config.surprise) return null;
    const { section, gate, height } = config.surprise;
    const sign = config.signs[sections.indexOf(section)].find((item) => item.gate === gate);
    return { ...sign, section, height, visibleColor: sign.color === "R" ? "G" : "R" };
  }

  function withSurprise(config, direction, random) {
    const { section, gate } = pick(orderedSigns(config, direction).slice(1), random);
    return { ...config, surprise: { section, gate, height: pick([50, 150], random) } };
  }

  function legalSurprise(config, direction) {
    if (!config.surprise) return true;
    const first = orderedSigns(config, direction)[0];
    return slot(first.section, first.gate) !== slot(config.surprise.section, config.surprise.gate);
  }

  function openStartZones(config) {
    // Figure 7c, looking at the left straight with the outer wall on the left.
    const width = config[sectionWidths[config.startSection]];
    return [1, 2, 3, 4, 5, 6].filter((number) => width === 1000 || number % 3 !== 0);
  }

  function drawRound(settings, random = Math.random) {
    const directions = [settings.includeCW && "CW", settings.includeCCW && "CCW"].filter(Boolean);
    const direction = pick(directions.length ? directions : ["CW"], random);
    if (settings.raceMode === "free") {
      const config = { ruleset: "international", raceMode: "free", startSection: pick(sections, random) };
      for (const side of Object.values(sectionWidths)) config[side] = pick([600, 1000], random);
      return { config, direction, zoneNumber: pick(openStartZones(config), random) };
    }
    const base = drawObstacle(random);
    const config = settings.surpriseRule ? withSurprise(base, direction, random) : base;
    return { config, direction };
  }

  return { cards, sections, sectionWidths, fromCards, drawRound, orderedSigns, modifiedSign, legalSurprise, openStartZones };
});
