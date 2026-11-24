(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./international.js"));
  } else {
    root.WroPlannerEngine = factory(root.WroInternational);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (International) {
  "use strict";

  const COLORS = [
    { id: "R", label: "Red", passSide: "right" },
    { id: "G", label: "Green", passSide: "left" },
  ];

  const BANDS = [
    { id: "I", label: "Inner" },
    { id: "O", label: "Outer" },
  ];

  const GATES = [
    { id: "1", label: "Gate 1" },
    { id: "2", label: "Gate 2" },
    { id: "3", label: "Gate 3" },
  ];

  const SECTIONS = [
    { id: "A", label: "Start-Finish", type: "start" },
    { id: "B", label: "Right straight", type: "normal" },
    { id: "C", label: "Opposite straight", type: "normal" },
    { id: "D", label: "Left straight", type: "normal" },
  ];

  const DIRECTIONS = [
    { id: "CW", label: "CW" },
    { id: "CCW", label: "CCW" },
  ];

  const START_MODES = [
    { id: "zone", label: "Zone start" },
    { id: "parking", label: "Parking start" },
    { id: "opposite", label: "Opposite zone" },
  ];

  const RACE_MODES = [
    { id: "obstacle", label: "Obstacle race" },
    { id: "free", label: "Free race" },
  ];

  const FREE_OFFSETS = [600, 1000];
  const RETEST_RECENCY_WINDOW = 18;

  const DEFAULT_SETTINGS = {
    ruleset: "international",
    surpriseRule: false,
    raceMode: "obstacle",
    coverageMode: "physical",
    includeCW: true,
    includeCCW: true,
    includeZoneStart: true,
    includeParkingStart: true,
    includeOppositeZone: false,
    strictStartGateRule: true,
    mirrorStartGateRule: false,
    changePenalty: 2.5,
    parkingRobotLength: 300,
    retestFailedTransitions: true,
  };

  const colorById = indexById(COLORS);
  const bandById = indexById(BANDS);
  const gateById = indexById(GATES);
  const sectionById = indexById(SECTIONS);

  let normalStatesCache = null;
  let startStatesCache = null;
  let candidatesCache = null;
  let freeCandidatesCache = null;
  let candidateSummaryCache = Object.create(null);
  let targetCache = Object.create(null);
  const internationalPools = new Map();

  function indexById(items) {
    return items.reduce((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, Object.create(null));
  }

  function state(color, band, gate) {
    return { color, band, gate };
  }

  function stateKey(item) {
    return `${item.color}${item.band}${item.gate}`;
  }

  function parseStateKey(key) {
    return state(key[0], key[1], key[2]);
  }

  function stateLabel(item) {
    return `${colorById[item.color].label} ${bandById[item.band].label} ${gateById[item.gate].label}`;
  }

  function shortStateLabel(item) {
    return `${item.color}${item.band}${item.gate}`;
  }

  function normalStates() {
    if (normalStatesCache) return normalStatesCache.slice();
    normalStatesCache = [];
    for (const color of COLORS) {
      for (const band of BANDS) {
        for (const gate of GATES) {
          normalStatesCache.push(state(color.id, band.id, gate.id));
        }
      }
    }
    return normalStatesCache.slice();
  }

  function startStates() {
    if (startStatesCache) return startStatesCache.slice();
    startStatesCache = [];
    for (const color of COLORS) {
      for (const gate of GATES) {
        startStatesCache.push(state(color.id, "I", gate.id));
      }
    }
    return startStatesCache.slice();
  }

  function allCandidates() {
    if (candidatesCache) return candidatesCache.slice();
    const starts = startStates();
    const normals = normalStates();
    candidatesCache = [];
    for (const a of starts) {
      for (const b of normals) {
        for (const c of normals) {
          for (const d of normals) {
            candidatesCache.push([a, b, c, d]);
          }
        }
      }
    }
    return candidatesCache.slice();
  }

  function freeConfig(top, right, bottom, left) {
    return { raceMode: "free", top, right, bottom, left };
  }

  function freeCandidates() {
    if (freeCandidatesCache) return freeCandidatesCache.slice();
    freeCandidatesCache = [];
    for (const top of FREE_OFFSETS) {
      for (const right of FREE_OFFSETS) {
        for (const bottom of FREE_OFFSETS) {
          for (const left of FREE_OFFSETS) {
            freeCandidatesCache.push(freeConfig(top, right, bottom, left));
          }
        }
      }
    }
    return freeCandidatesCache.slice();
  }

  function candidateLayouts(settings) {
    const normalized = normalizeSettings(settings);
    if (normalized.ruleset === "german") return normalized.raceMode === "free" ? freeCandidates() : allCandidates();
    if (normalized.raceMode === "free") {
      return freeCandidates().flatMap((config) => International.sections.map((startSection) =>
        ({ ...config, ruleset: "international", startSection })));
    }
    const key = [normalized.surpriseRule, normalized.includeCW, normalized.includeCCW].join("|");
    if (!internationalPools.has(key)) {
      let seed = 0x7b8f23ef;
      const random = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
      };
      const layouts = new Map();
      for (let index = 0; index < 1024; index += 1) {
        const { config } = International.drawRound(normalized, random);
        layouts.set(configKey(config), config);
      }
      internationalPools.set(key, [...layouts.values()]);
    }
    return internationalPools.get(key);
  }

  function candidateSummaryKey(settings) {
    const normalized = normalizeSettings(settings);
    return [
      normalized.ruleset,
      normalized.surpriseRule ? "surprise" : "standard",
      normalized.raceMode,
      normalized.coverageMode === "directed" ? "directed" : "physical",
      normalized.includeCW ? "cw" : "no-cw",
      normalized.includeCCW ? "ccw" : "no-ccw",
      normalized.includeZoneStart ? "zone" : "no-zone",
      normalized.includeParkingStart ? "parking" : "no-parking",
      normalized.includeOppositeZone ? "opposite" : "no-opposite",
      normalized.strictStartGateRule ? "strict" : "loose",
      normalized.mirrorStartGateRule ? "mirror" : "normal",
    ].join("|");
  }

  function candidateSummaries(settings) {
    const normalized = normalizeSettings(settings);
    const key = candidateSummaryKey(normalized);
    if (candidateSummaryCache[key]) return candidateSummaryCache[key];
    candidateSummaryCache[key] = candidateLayouts(normalized)
      .map((config) => {
        const layoutKey = configKey(config);
        const variants = legalRunVariants(config, normalized).map((variant) => ({
          variant,
          variantKey: runVariantKey(variant),
          zoneStartAtom: zoneStartBehaviorAtom(config, variant),
          atoms: runVariantCoverage(config, variant, normalized),
          features: runVariantFeatureCoverage(config, variant),
        }));
        return { config, layoutKey, variants };
      })
      .filter((summary) => summary.variants.length > 0);
    return candidateSummaryCache[key];
  }

  function configKey(config) {
    if (config.ruleset === "international" && config.raceMode === "obstacle") {
      const signs = config.signs.map((row) => row.map(stateKey).sort().join("+")).join("/");
      const surprise = config.surprise;
      return `INT:${config.startSection}:${signs}${surprise ? `:${surprise.section}${surprise.gate}:${surprise.height}` : ""}`;
    }
    if (!Array.isArray(config)) {
      const prefix = config.ruleset === "international" ? `INTOPEN:${config.startSection}:` : "FREE:";
      return `${prefix}T${config.top}-R${config.right}-B${config.bottom}-L${config.left}`;
    }
    return config.map(stateKey).join("-");
  }

  function parseConfigKey(key) {
    if (key.startsWith("INT:")) {
      const [, startSection, positions, changed, height, extra] = key.split(":");
      const rows = positions?.split("/");
      if (!sectionById[startSection] || rows?.length !== 4 || extra !== undefined ||
          !rows.every((row) => /^[RG][IO][123](\+[RG][IO][123])?$/.test(row))) {
        throw new Error("Invalid international obstacle setup");
      }
      const config = { ruleset: "international", raceMode: "obstacle", startSection,
        signs: rows.map((row) => row.split("+").map(parseStateKey)) };
      if (config.signs[International.sections.indexOf(startSection)].some((item) => item.band !== "I") ||
          config.signs.some((row) => row.length === 2 && row[0].gate === row[1].gate)) {
        throw new Error("Invalid international sign positions");
      }
      if (changed !== undefined) {
        if (!/^[ABCD][123]$/.test(changed) || !["50", "150"].includes(height) ||
            !config.signs[International.sections.indexOf(changed[0])].some((item) => item.gate === changed[1])) {
          throw new Error("Invalid modified sign");
        }
        config.surprise = { section: changed[0], gate: changed[1], height: Number(height) };
      }
      return config;
    }
    if (key.startsWith("INTOPEN:")) {
      const match = key.match(/^INTOPEN:([ABCD]):T(600|1000)-R(600|1000)-B(600|1000)-L(600|1000)$/);
      if (!match) throw new Error("Invalid international Open setup");
      return { ...freeConfig(...match.slice(2).map(Number)), ruleset: "international", startSection: match[1] };
    }
    if (key.startsWith("FREE:")) {
      const match = key.match(/^FREE:T(\d+)-R(\d+)-B(\d+)-L(\d+)$/);
      if (!match) throw new Error(`Invalid free-race config key: ${key}`);
      return freeConfig(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]));
    }
    return key.split("-").map(parseStateKey);
  }

  function sectionState(config, sectionId) {
    const index = SECTIONS.findIndex((section) => section.id === sectionId);
    return config[index];
  }

  function sectionSigns(config, sectionId) {
    const index = International.sections.indexOf(sectionId);
    return Array.isArray(config) ? [config[index]] : config.signs[index];
  }

  function directionOrder(direction) {
    return direction === "CCW" ? ["A", "D", "C", "B"] : ["A", "B", "C", "D"];
  }

  function edgePairs(direction) {
    const order = directionOrder(direction);
    return order.map((from, index) => ({
      from,
      to: order[(index + 1) % order.length],
    }));
  }

  function normalizeSettings(settings) {
    const normalized = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (normalized.ruleset !== "german") normalized.ruleset = "international";
    normalized.surpriseRule = normalized.surpriseRule === true;
    if (!RACE_MODES.some((mode) => mode.id === normalized.raceMode)) normalized.raceMode = "obstacle";
    normalized.parkingRobotLength = Math.max(100, Math.min(300, Number(normalized.parkingRobotLength) || DEFAULT_SETTINGS.parkingRobotLength));
    return normalized;
  }

  function enabledDirections(settings) {
    const normalized = normalizeSettings(settings);
    const dirs = [];
    if (normalized.includeCW) dirs.push("CW");
    if (normalized.includeCCW) dirs.push("CCW");
    return dirs;
  }

  function enabledStartModes(settings) {
    const normalized = normalizeSettings(settings);
    if (normalized.ruleset === "international" && normalized.raceMode === "free") return ["zone"];
    const modes = [];
    if (normalized.raceMode === "obstacle" && normalized.includeParkingStart) modes.push("parking");
    if (normalized.includeZoneStart) modes.push("zone");
    if (normalized.ruleset === "german" && normalized.includeOppositeZone) modes.push("opposite");
    if (modes.length === 0) modes.push(normalized.raceMode === "obstacle" ? "parking" : "zone");
    return modes;
  }

  function frontGateFor(direction, startMode, settings) {
    const normalized = normalizeSettings(settings);
    const usesPrimaryZone = startMode !== "opposite";
    const primaryZone = normalized.mirrorStartGateRule ? !usesPrimaryZone : usesPrimaryZone;
    if (primaryZone) return direction === "CW" ? "2" : "1";
    return direction === "CW" ? "3" : "2";
  }

  function isRunVariantLegal(config, variant, settings) {
    const normalized = normalizeSettings(settings);
    if (!normalized.strictStartGateRule) return true;
    const start = config[0];
    const blockedGate = frontGateFor(variant.direction, variant.startMode, normalized);
    return start.gate !== blockedGate;
  }

  function runVariantKey(variant) {
    if (variant.zoneNumber) return `${variant.direction}:${variant.startMode}:${variant.zoneNumber}`;
    return `${variant.direction}:${variant.startMode}`;
  }

  function parseRunVariantKey(key) {
    const [direction, startMode, zoneNumber] = key.split(":");
    return zoneNumber ? { direction, startMode, zoneNumber: Number(zoneNumber) } : { direction, startMode };
  }

  function legalRunVariants(config, settings) {
    if (config.ruleset === "international") {
      if (config.raceMode === "free") return enabledDirections(settings).flatMap((direction) =>
        International.openStartZones(config).map((zoneNumber) => ({ direction, startMode: "zone", zoneNumber })));
      return enabledDirections(settings).filter((direction) => International.legalSurprise(config, direction))
        .flatMap((direction) => enabledStartModes(settings).map((startMode) => ({ direction, startMode })));
    }
    const variants = [];
    for (const direction of enabledDirections(settings)) {
      for (const startMode of enabledStartModes(settings)) {
        const variant = { direction, startMode };
        if (!Array.isArray(config) || isRunVariantLegal(config, variant, settings)) {
          variants.push(variant);
        }
      }
    }
    return variants;
  }

  function zoneStartBehaviorAtom(config, variant) {
    if (config.ruleset === "international" && config.raceMode === "obstacle" && variant.startMode === "zone") {
      const first = International.orderedSigns(config, variant.direction)[0];
      return `IX:start:${variant.direction} ${first.section === config.startSection ? "start straight" : "next straight"} ${stateKey(first)}`;
    }
    if (!Array.isArray(config) || !variant || variant.startMode !== "zone") return null;
    const nextSection = variant.direction === "CCW" ? "D" : "B";
    const start = sectionState(config, "A");
    const next = sectionState(config, nextSection);
    return `Z:${variant.direction}:A${stateKey(start)}>${nextSection}${stateKey(next)}`;
  }

  function zoneStartTargets(settings) {
    const normalized = normalizeSettings(settings);
    if (normalized.raceMode !== "obstacle" || !normalized.includeZoneStart) return new Set();
    const targets = [];
    for (const direction of enabledDirections(normalized)) {
      const nextSection = direction === "CCW" ? "D" : "B";
      const blockedGate = frontGateFor(direction, "zone", normalized);
      for (const startItem of startStates()) {
        if (normalized.strictStartGateRule && startItem.gate === blockedGate) continue;
        for (const nextItem of normalStates()) {
          targets.push(`Z:${direction}:A${stateKey(startItem)}>${nextSection}${stateKey(nextItem)}`);
        }
      }
    }
    return new Set(targets);
  }

  function latestRecordFor(records, layoutKey, variantKey) {
    for (let i = (records || []).length - 1; i >= 0; i -= 1) {
      const record = records[i];
      if (record.layoutKey === layoutKey && record.variantKey === variantKey) return record;
    }
    return null;
  }

  function minimalRunVariants(config, settings, records) {
    const normalized = normalizeSettings(settings);
    const variants = legalRunVariants(config, normalized);
    if (normalized.raceMode !== "obstacle") return variants;
    const progress = coverageFromRecords(records || [], normalized);
    const layoutKey = configKey(config);
    return variants.filter((variant) => {
      const atom = zoneStartBehaviorAtom(config, variant);
      if (!atom) return true;
      const latest = latestRecordFor(records || [], layoutKey, runVariantKey(variant));
      if (latest && latest.result === "issue") return true;
      return !progress.covered.has(atom);
    });
  }

  function physicalAtomForEdge(config, edge) {
    const from = sectionState(config, edge.from);
    const to = sectionState(config, edge.to);
    const fromType = sectionById[edge.from].type;
    const toType = sectionById[edge.to].type;
    if (fromType === "start" || toType === "start") {
      const startItem = fromType === "start" ? from : to;
      const normalItem = fromType === "start" ? to : from;
      return `P:S-N:${stateKey(startItem)}|${stateKey(normalItem)}`;
    }
    const pair = [stateKey(from), stateKey(to)].sort();
    return `P:N-N:${pair[0]}|${pair[1]}`;
  }

  function directedAtomForEdge(config, edge) {
    const from = sectionState(config, edge.from);
    const to = sectionState(config, edge.to);
    const fromType = sectionById[edge.from].type === "start" ? "S" : "N";
    const toType = sectionById[edge.to].type === "start" ? "S" : "N";
    return `D:${fromType}-${toType}:${stateKey(from)}>${stateKey(to)}`;
  }

  function featureAtomsForEdge(config, edge) {
    const from = sectionState(config, edge.from);
    const to = sectionState(config, edge.to);
    return [
      `F:color:${from.color}>${to.color}`,
      `F:band:${from.band}>${to.band}`,
      `F:gate:${from.gate}>${to.gate}`,
    ];
  }

  function internationalPairs(config, direction) {
    const inDirection = (section) => sectionSigns(config, section).slice().sort((a, b) =>
      (direction === "CW" ? 1 : -1) * (Number(a.gate) - Number(b.gate)));
    const corners = edgePairs(direction).map(({ from, to }) => [
      from === config.startSection || to === config.startSection ? "bay corner" : "corner",
      inDirection(from).at(-1), inDirection(to)[0],
    ]);
    for (const section of International.sections) {
      const signs = inDirection(section);
      if (signs.length === 2) corners.push([section === config.startSection ? "bay straight" : "straight", ...signs]);
    }
    return corners;
  }

  function directedObstaclePairs(config, direction) {
    if (config.ruleset === "international") {
      return internationalPairs(config, direction).map(([, from, to]) => [stateKey(from), stateKey(to)]);
    }
    return edgePairs(direction).map(({ from, to }) => [stateKey(sectionState(config, from)), stateKey(sectionState(config, to))]);
  }

  function runVariantCoverage(config, variant, settings) {
    const normalized = normalizeSettings(settings);
    if (config.ruleset === "international") {
      if (config.raceMode === "free") return [...freeRunVariantCoverage(config, variant, normalized),
        `IX:Open start:${config.startSection} zone ${variant.zoneNumber} / ${variant.direction}`];
      const atoms = internationalPairs(config, variant.direction).map(([type, from, to]) => {
        const pair = [stateKey(from), stateKey(to)];
        if (normalized.coverageMode !== "directed") pair.sort();
        return `IX:${type}:${pair.join(normalized.coverageMode === "directed" ? " > " : " / ")}`;
      });
      const modified = International.modifiedSign(config);
      if (modified) atoms.push(`IX:modified sign:${modified.color} ${modified.height} mm ${variant.direction}`);
      return unique([...atoms, zoneStartBehaviorAtom(config, variant)].filter(Boolean));
    }
    if (!Array.isArray(config)) {
      return freeRunVariantCoverage(config, variant, normalized);
    }
    const atoms = [];
    for (const edge of edgePairs(variant.direction)) {
      atoms.push(
        normalized.coverageMode === "directed"
          ? directedAtomForEdge(config, edge)
          : physicalAtomForEdge(config, edge)
      );
    }
    const zoneAtom = zoneStartBehaviorAtom(config, variant);
    if (zoneAtom) atoms.push(zoneAtom);
    return unique(atoms);
  }

  function runVariantFeatureCoverage(config, variant) {
    if (config.ruleset === "international" && config.raceMode === "obstacle") {
      return unique(internationalPairs(config, variant.direction).flatMap(([, from, to]) => [
        `F:color:${from.color}>${to.color}`, `F:band:${from.band}>${to.band}`, `F:gate:${from.gate}>${to.gate}`,
      ]));
    }
    if (!Array.isArray(config)) {
      return freeRunVariantFeatureCoverage(config, variant);
    }
    const atoms = [];
    for (const edge of edgePairs(variant.direction)) {
      atoms.push(...featureAtomsForEdge(config, edge));
    }
    return unique(atoms);
  }

  function targetAtoms(settings) {
    const normalized = normalizeSettings(settings);
    if (normalized.ruleset === "international") return internationalTargets(normalized).targets;
    if (normalized.raceMode === "free") return freeTargetAtoms(normalized);
    const key = [
      normalized.raceMode,
      normalized.coverageMode === "directed" ? "directed" : "physical",
      enabledDirections(normalized).join(","),
      normalized.includeZoneStart ? "zone" : "no-zone",
      normalized.strictStartGateRule ? "strict" : "loose",
      normalized.mirrorStartGateRule ? "mirror" : "normal",
    ].join(":");
    if (targetCache[key]) return new Set(targetCache[key]);
    const targets = [];
    if (normalized.coverageMode !== "directed") {
      const starts = startStates();
      const normals = normalStates();
      for (const startItem of starts) {
        for (const normalItem of normals) {
          targets.push(`P:S-N:${stateKey(startItem)}|${stateKey(normalItem)}`);
        }
      }
      for (let i = 0; i < normals.length; i += 1) {
        for (let j = i; j < normals.length; j += 1) {
          const pair = [stateKey(normals[i]), stateKey(normals[j])].sort();
          targets.push(`P:N-N:${pair[0]}|${pair[1]}`);
        }
      }
    } else {
      const starts = startStates();
      const normals = normalStates();
      for (const from of normals) {
        for (const to of normals) {
          targets.push(`D:N-N:${stateKey(from)}>${stateKey(to)}`);
        }
      }
      for (const startItem of starts) {
        for (const normalItem of normals) {
          targets.push(`D:S-N:${stateKey(startItem)}>${stateKey(normalItem)}`);
          targets.push(`D:N-S:${stateKey(normalItem)}>${stateKey(startItem)}`);
        }
      }
    }
    targets.push(...zoneStartTargets(normalized));
    targetCache[key] = unique(targets);
    return new Set(targetCache[key]);
  }

  function featureTargets() {
    return obstacleFeatureTargets();
  }

  function obstacleFeatureTargets() {
    const targets = [];
    for (const from of COLORS) {
      for (const to of COLORS) targets.push(`F:color:${from.id}>${to.id}`);
    }
    for (const from of BANDS) {
      for (const to of BANDS) targets.push(`F:band:${from.id}>${to.id}`);
    }
    for (const from of GATES) {
      for (const to of GATES) targets.push(`F:gate:${from.id}>${to.id}`);
    }
    return new Set(targets);
  }

  const internationalTargetCache = new Map();

  function internationalTargets(settings) {
    const key = candidateSummaryKey(settings);
    if (!internationalTargetCache.has(key)) {
      const targets = new Set();
      const features = new Set();
      for (const { variants } of candidateSummaries(settings)) {
        for (const item of variants) {
          item.atoms.forEach((atom) => targets.add(atom));
          item.features.forEach((feature) => features.add(feature));
        }
      }
      internationalTargetCache.set(key, { targets, features });
    }
    return internationalTargetCache.get(key);
  }

  function freeSides(config) {
    return [
      { section: "A", value: config.bottom },
      { section: "B", value: config.left },
      { section: "C", value: config.top },
      { section: "D", value: config.right },
    ];
  }

  function freeSideValue(config, section) {
    if (section === "A") return config.bottom;
    if (section === "B") return config.left;
    if (section === "C") return config.top;
    return config.right;
  }

  function freeRunVariantCoverage(config, variant, settings) {
    const atoms = [];
    for (const side of freeSides(config)) {
      atoms.push(`FR:side:${side.section}:${side.value}`);
    }
    const order = directionOrder(variant.direction);
    for (let i = 0; i < order.length; i += 1) {
      const fromSection = order[i];
      const toSection = order[(i + 1) % order.length];
      const from = freeSideValue(config, fromSection);
      const to = freeSideValue(config, toSection);
      if (settings.coverageMode === "directed") {
        atoms.push(`FR:corner:${fromSection}-${toSection}:${from}>${to}`);
      } else {
        const pair = [from, to].sort((a, b) => a - b);
        atoms.push(`FR:corner:${cornerId(fromSection, toSection)}:${pair[0]}|${pair[1]}`);
      }
    }
    atoms.push(`FR:direction:${variant.direction}`);
    atoms.push(`FR:start:${variant.startMode}`);
    return unique(atoms);
  }

  function freeRunVariantFeatureCoverage(config, variant) {
    const atoms = [];
    for (const side of freeSides(config)) {
      atoms.push(`FF:width:${side.value}`);
    }
    const order = directionOrder(variant.direction);
    for (let i = 0; i < order.length; i += 1) {
      const from = freeSideValue(config, order[i]);
      const to = freeSideValue(config, order[(i + 1) % order.length]);
      atoms.push(`FF:delta:${Math.abs(from - to)}`);
    }
    atoms.push(`FF:direction:${variant.direction}`);
    atoms.push(`FF:start:${variant.startMode}`);
    return unique(atoms);
  }

  function freeTargetAtoms(settings) {
    const normalized = normalizeSettings(settings);
    const key = `${normalized.raceMode}:${normalized.coverageMode}:${enabledDirections(normalized).join(",")}:${enabledStartModes(normalized).join(",")}`;
    if (targetCache[key]) return new Set(targetCache[key]);
    const targets = [];
    for (const section of ["A", "B", "C", "D"]) {
      for (const value of FREE_OFFSETS) {
        targets.push(`FR:side:${section}:${value}`);
      }
    }
    if (normalized.coverageMode === "directed") {
      for (const direction of enabledDirections(normalized)) {
        const order = directionOrder(direction);
        for (let i = 0; i < order.length; i += 1) {
          const fromSection = order[i];
          const toSection = order[(i + 1) % order.length];
          for (const from of FREE_OFFSETS) {
            for (const to of FREE_OFFSETS) {
              targets.push(`FR:corner:${fromSection}-${toSection}:${from}>${to}`);
            }
          }
        }
      }
    } else {
      const corners = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]];
      for (const [fromSection, toSection] of corners) {
        for (let i = 0; i < FREE_OFFSETS.length; i += 1) {
          for (let j = i; j < FREE_OFFSETS.length; j += 1) {
            targets.push(`FR:corner:${cornerId(fromSection, toSection)}:${FREE_OFFSETS[i]}|${FREE_OFFSETS[j]}`);
          }
        }
      }
    }
    for (const direction of enabledDirections(normalized)) targets.push(`FR:direction:${direction}`);
    for (const startMode of enabledStartModes(normalized)) targets.push(`FR:start:${startMode}`);
    targetCache[key] = unique(targets);
    return new Set(targetCache[key]);
  }

  function cornerId(a, b) {
    return [a, b].sort().join("-");
  }

  function freeFeatureTargets(settings) {
    const normalized = normalizeSettings(settings);
    const targets = [];
    for (const value of FREE_OFFSETS) targets.push(`FF:width:${value}`);
    for (const delta of [0, 400]) targets.push(`FF:delta:${delta}`);
    for (const direction of enabledDirections(normalized)) targets.push(`FF:direction:${direction}`);
    for (const startMode of enabledStartModes(normalized)) targets.push(`FF:start:${startMode}`);
    return new Set(targets);
  }

  function unique(items) {
    return Array.from(new Set(items));
  }

  function recordsForCoverage(records) {
    return (records || []).filter((record) => record.result === "pass" || record.result === "issue");
  }

  function recordRaceMode(record) {
    return record.raceMode || (/^(FREE|INTOPEN):/.test(record.layoutKey) ? "free" : "obstacle");
  }

  function recordMatchesSettings(record, settings) {
    if (!record.layoutKey || !record.variantKey || recordRaceMode(record) !== settings.raceMode) return false;
    return layoutMatchesSettings(record.layoutKey, settings);
  }

  function layoutMatchesSettings(key, settings) {
    try {
      const config = parseConfigKey(key);
      const international = config.ruleset === "international";
      if (international !== (settings.ruleset === "international")) return false;
      if (international) {
        return config.raceMode === settings.raceMode && (config.raceMode === "free" || Boolean(config.surprise) === settings.surpriseRule);
      }
      if (settings.raceMode === "obstacle") return Array.isArray(config) && config.length === 4 &&
        config.every((item) => /^[RG][IO][123]$/.test(stateKey(item)));
      return config.raceMode === "free" && [config.top, config.right, config.bottom, config.left].every((width) => FREE_OFFSETS.includes(width));
    } catch (error) {
      return false;
    }
  }

  function isAttemptRecord(record) {
    return record && (record.result === "pass" || record.result === "issue");
  }

  function coverageFromRecords(records, settings) {
    const normalized = normalizeSettings(settings);
    const covered = new Set();
    const features = new Set();
    const failed = new Set();
    const attemptedVariantKeys = new Set();
    const attemptedLayouts = new Set();
    for (const record of records || []) {
      if (!recordMatchesSettings(record, normalized)) continue;
      attemptedVariantKeys.add(`${record.layoutKey}|${record.variantKey}`);
      if (isAttemptRecord(record)) {
        attemptedLayouts.add(record.layoutKey);
      }
      if (!isAttemptRecord(record)) continue;
      const config = parseConfigKey(record.layoutKey);
      const variant = parseRunVariantKey(record.variantKey);
      for (const atom of runVariantCoverage(config, variant, normalized)) {
        covered.add(atom);
        if (record.result === "issue") failed.add(atom);
      }
      for (const atom of runVariantFeatureCoverage(config, variant)) {
        features.add(atom);
      }
    }
    const targets = targetAtoms(normalized);
    const featureTargetSet = normalized.ruleset === "international" ? internationalTargets(normalized).features
      : normalized.raceMode === "free" ? freeFeatureTargets(normalized) : obstacleFeatureTargets();
    return {
      covered,
      failed,
      targets,
      features,
      featureTargets: featureTargetSet,
      attemptedVariantKeys,
      attemptedLayouts,
      coveredCount: intersectionSize(covered, targets),
      targetCount: targets.size,
      featureCoveredCount: intersectionSize(features, featureTargetSet),
      featureTargetCount: featureTargetSet.size,
    };
  }

  function exactRunCycleStats(records, settings) {
    const normalized = normalizeSettings(settings);
    const summaries = candidateSummaries(normalized);
    const exactKeys = [];
    for (const summary of summaries) {
      for (const item of summary.variants) {
        exactKeys.push(`${summary.layoutKey}|${item.variantKey}`);
      }
    }

    const attemptsByKey = new Map(exactKeys.map((key) => [key, 0]));
    for (const record of records || []) {
      if (!recordMatchesSettings(record, normalized) || !isAttemptRecord(record)) continue;
      const key = `${record.layoutKey}|${record.variantKey}`;
      if (!attemptsByKey.has(key)) continue;
      attemptsByKey.set(key, attemptsByKey.get(key) + 1);
    }

    const total = exactKeys.length;
    if (total === 0) {
      return {
        total,
        firstPassCompleted: 0,
        firstPassPercent: 0,
        cycle: 1,
        cycleCompleted: 0,
        cyclePercent: 0,
      };
    }

    let minAttempts = Infinity;
    let firstPassCompleted = 0;
    for (const count of attemptsByKey.values()) {
      if (count > 0) firstPassCompleted += 1;
      if (count < minAttempts) minAttempts = count;
    }
    const cycle = minAttempts + 1;
    let cycleCompleted = 0;
    for (const count of attemptsByKey.values()) {
      if (count > minAttempts) cycleCompleted += 1;
    }

    return {
      total,
      firstPassCompleted,
      firstPassPercent: Math.round((firstPassCompleted / total) * 100),
      cycle,
      cycleCompleted,
      cyclePercent: Math.round((cycleCompleted / total) * 100),
    };
  }

  function attemptStatsFromRecords(records, settings) {
    const normalized = normalizeSettings(settings);
    const variantStats = new Map();
    const atomStats = new Map();
    (records || []).forEach((record, index) => {
      if (!recordMatchesSettings(record, normalized)) return;
      const variantKey = `${record.layoutKey}|${record.variantKey}`;
      const variant = variantStats.get(variantKey) || { attempts: 0, passes: 0, issues: 0, skips: 0, lastIndex: -1 };
      variant.lastIndex = index;
      if (record.result === "skip") {
        variant.skips += 1;
      } else if (isAttemptRecord(record)) {
        variant.attempts += 1;
        if (record.result === "pass") variant.passes += 1;
        if (record.result === "issue") variant.issues += 1;
      }
      variantStats.set(variantKey, variant);

      if (!isAttemptRecord(record)) return;
      const config = parseConfigKey(record.layoutKey);
      const runVariant = parseRunVariantKey(record.variantKey);
      for (const atom of runVariantCoverage(config, runVariant, normalized)) {
        const stats = atomStats.get(atom) || {
          attempts: 0,
          passes: 0,
          issues: 0,
          lastIndex: -1,
          lastPassIndex: -1,
          lastIssueIndex: -1,
        };
        stats.attempts += 1;
        stats.lastIndex = index;
        if (record.result === "pass") {
          stats.passes += 1;
          stats.lastPassIndex = index;
        } else {
          stats.issues += 1;
          stats.lastIssueIndex = index;
        }
        atomStats.set(atom, stats);
      }
    });
    return { variantStats, atomStats };
  }

  function weakAtomStats(records, settings) {
    const normalized = normalizeSettings(settings);
    const stats = attemptStatsFromRecords(records, normalized).atomStats;
    const targets = targetAtoms(normalized);
    const weak = new Map();
    for (const [atom, item] of stats.entries()) {
      if (!targets.has(atom) || item.issues === 0) continue;
      const issueRate = item.issues / Math.max(1, item.attempts);
      const unresolvedLatestIssue = item.lastIssueIndex > item.lastPassIndex;
      if (issueRate >= 0.18 || item.attempts < 4 || unresolvedLatestIssue) {
        weak.set(atom, item);
      }
    }
    return weak;
  }

  function recentVariantKeys(records, settings, limit) {
    const normalized = normalizeSettings(settings);
    const recent = new Set();
    for (let i = (records || []).length - 1; i >= 0 && recent.size < limit; i -= 1) {
      const record = records[i];
      if (!recordMatchesSettings(record, normalized)) continue;
      recent.add(`${record.layoutKey}|${record.variantKey}`);
    }
    return recent;
  }

  function atomOverlapScore(atoms, statsByAtom) {
    let score = 0;
    for (const atom of atoms) {
      const stats = statsByAtom.get(atom);
      if (!stats) continue;
      const issueRate = stats.issues / Math.max(1, stats.attempts);
      score += 38 + issueRate * 90 + Math.max(0, 4 - stats.attempts) * 8;
      if (stats.lastIssueIndex > stats.lastPassIndex) score += 24;
    }
    return score;
  }

  function variantAttemptScore(layoutKey, variantKey, statsByVariant) {
    const stats = statsByVariant.get(`${layoutKey}|${variantKey}`);
    if (!stats || stats.attempts === 0) return 80;
    return Math.max(8, 48 - stats.attempts * 8 + Math.min(26, Math.max(0, stats.lastIndex)));
  }

  function intersectionSize(a, b) {
    let count = 0;
    for (const item of a) {
      if (b.has(item)) count += 1;
    }
    return count;
  }

  function setDifferenceCount(a, b) {
    let count = 0;
    for (const item of a) {
      if (!b.has(item)) count += 1;
    }
    return count;
  }

  function hammingConfig(a, b) {
    if (!a || !b) return 4;
    if (a.ruleset === "international" || b.ruleset === "international") {
      if (a.ruleset !== b.ruleset || a.raceMode !== b.raceMode) return 4;
      return describeChanges(configKey(a), configKey(b)).length;
    }
    if (!Array.isArray(a) || !Array.isArray(b)) {
      if (Array.isArray(a) || Array.isArray(b)) return 4;
      return ["top", "right", "bottom", "left"].reduce((changes, key) => changes + (a[key] !== b[key] ? 1 : 0), 0);
    }
    let changes = 0;
    for (let i = 0; i < 4; i += 1) {
      if (stateKey(a[i]) !== stateKey(b[i])) changes += 1;
    }
    return changes;
  }

  function changesBetweenKeys(previousKey, nextKey) {
    if (!previousKey || !nextKey) return 4;
    return hammingConfig(parseConfigKey(previousKey), parseConfigKey(nextKey));
  }

  function describeChanges(previousKey, nextKey) {
    if (!previousKey || !nextKey) return [];
    const previous = parseConfigKey(previousKey);
    const next = parseConfigKey(nextKey);
    if (previous.ruleset === "international" && next.ruleset === "international" && previous.raceMode === next.raceMode) {
      const changes = [];
      const add = (id, from, to) => {
        if (from !== to) changes.push({ section: { id }, from: { label: from }, to: { label: to } });
      };
      for (const id of International.sections) {
        if (next.raceMode === "free") add(id, `${freeSideValue(previous, id)} mm`, `${freeSideValue(next, id)} mm`);
        else add(id, sectionSigns(previous, id).map(stateKey).sort().join(" + "), sectionSigns(next, id).map(stateKey).sort().join(" + "));
      }
      add(next.raceMode === "free" ? "Start" : "Parking", previous.startSection, next.startSection);
      const modified = (config) => {
        const item = International.modifiedSign(config);
        return item ? `${item.section}${item.gate} ${item.visibleColor} ${item.height} mm` : "None";
      };
      if (next.raceMode === "obstacle") add("Modified sign", modified(previous), modified(next));
      return changes;
    }
    if (!Array.isArray(previous) || !Array.isArray(next)) {
      if (Array.isArray(previous) || Array.isArray(next)) {
        return [{ section: { id: "Mode" }, from: { label: previousKey }, to: { label: nextKey } }];
      }
      return [
        ["A", "top"],
        ["B", "right"],
        ["C", "bottom"],
        ["D", "left"],
      ]
        .filter((item) => previous[item[1]] !== next[item[1]])
        .map((item) => ({
          section: { id: item[0] },
          from: { label: `${previous[item[1]]} mm` },
          to: { label: `${next[item[1]]} mm` },
        }));
    }
    const changes = [];
    for (let i = 0; i < SECTIONS.length; i += 1) {
      if (stateKey(previous[i]) !== stateKey(next[i])) {
        changes.push({
          section: SECTIONS[i],
          from: previous[i],
          to: next[i],
        });
      }
    }
    return changes;
  }

  function scoreCandidateSummary(summary, plannerState, coverage) {
    const settings = normalizeSettings(plannerState.settings);
    const variantCoverage = summary.variants.filter((item) => {
      if (coverage.attemptedVariantKeys.has(`${summary.layoutKey}|${item.variantKey}`)) return false;
      if (item.zoneStartAtom && coverage.covered.has(item.zoneStartAtom)) return false;
      return true;
    });
    if (variantCoverage.length === 0) {
      return null;
    }

    const unionAtoms = new Set();
    const unionFeatures = new Set();
    let failedRetests = 0;
    for (const item of variantCoverage) {
      for (const atom of item.atoms) {
        unionAtoms.add(atom);
        if (coverage.failed.has(atom)) failedRetests += 1;
      }
      for (const feature of item.features) unionFeatures.add(feature);
    }

    const newAtoms = setDifferenceCount(unionAtoms, coverage.covered);
    const newFeatures = setDifferenceCount(unionFeatures, coverage.features);
    const previousKey = plannerState.currentLayoutKey || plannerState.lastLayoutKey || null;
    const changes = changesBetweenKeys(previousKey, summary.layoutKey);
    const retestBoost = settings.retestFailedTransitions ? failedRetests * 9 : 0;
    const score = newAtoms * 100 + newFeatures * 8 + retestBoost + variantCoverage.length - changes * settings.changePenalty;

    return {
      layoutKey: summary.layoutKey,
      config: summary.config,
      score,
      newAtoms,
      newFeatures,
      failedRetests,
      changes,
      variants: variantCoverage.map((item) => item.variant),
      kind: "coverage",
      reason: newAtoms > 0 ? "New coverage" : "New feature coverage",
    };
  }

  function scoreWeaknessCandidate(summary, plannerState, weakStats, recentKeys, allowRecent) {
    const settings = normalizeSettings(plannerState.settings);
    const scored = summary.variants
      .map((item) => ({
        item,
        score: atomOverlapScore(item.atoms, weakStats),
      }))
      .filter((entry) => entry.score > 0 && (allowRecent || !recentKeys.has(`${summary.layoutKey}|${entry.item.variantKey}`)))
      .sort((a, b) => b.score - a.score || a.item.variantKey.localeCompare(b.item.variantKey));
    if (scored.length === 0) return null;
    const chosen = scored.slice(0, 2);
    const changes = changesBetweenKeys(plannerState.currentLayoutKey || plannerState.lastLayoutKey || null, summary.layoutKey);
    const score = chosen.reduce((total, entry) => total + entry.score, 0) - changes * settings.changePenalty;
    return {
      layoutKey: summary.layoutKey,
      config: summary.config,
      score,
      newAtoms: 0,
      newFeatures: 0,
      failedRetests: chosen.length,
      changes,
      variants: chosen.map((entry) => entry.item.variant),
      kind: "weakness",
      reason: "Retesting weak targets",
    };
  }

  function scoreRotationCandidate(summary, plannerState, attemptStats, recentKeys, allowRecent) {
    const settings = normalizeSettings(plannerState.settings);
    const scored = summary.variants
      .filter((item) => allowRecent || !recentKeys.has(`${summary.layoutKey}|${item.variantKey}`))
      .map((item) => ({
        item,
        score: variantAttemptScore(summary.layoutKey, item.variantKey, attemptStats.variantStats),
      }))
      .sort((a, b) => b.score - a.score || a.item.variantKey.localeCompare(b.item.variantKey));
    if (scored.length === 0) return null;
    const chosen = scored.slice(0, 2);
    const changes = changesBetweenKeys(plannerState.currentLayoutKey || plannerState.lastLayoutKey || null, summary.layoutKey);
    const score = chosen.reduce((total, entry) => total + entry.score, 0) - changes * settings.changePenalty;
    return {
      layoutKey: summary.layoutKey,
      config: summary.config,
      score,
      newAtoms: 0,
      newFeatures: 0,
      failedRetests: 0,
      changes,
      variants: chosen.map((entry) => entry.item.variant),
      kind: "rotation",
      reason: "Maintenance rotation",
    };
  }

  function suggestNext(plannerState) {
    const settings = normalizeSettings(plannerState.settings);
    const coverage = coverageFromRecords(plannerState.records || [], settings);
    let best = null;
    for (const summary of candidateSummaries(settings)) {
      const candidate = scoreCandidateSummary(summary, Object.assign({}, plannerState, { settings }), coverage);
      if (!candidate) continue;
      if (!best || candidate.score > best.score || tieBreakCandidate(candidate, best)) {
        best = candidate;
      }
    }
    if (best && (best.newAtoms > 0 || best.newFeatures > 0 || coverage.coveredCount < coverage.targetCount)) {
      return best;
    }

    const weakStats = weakAtomStats(plannerState.records || [], settings);
    const recentKeys = recentVariantKeys(plannerState.records || [], settings, RETEST_RECENCY_WINDOW);
    if (weakStats.size > 0) {
      const weak = bestRetestCandidate(plannerState, settings, weakStats, recentKeys, false)
        || bestRetestCandidate(plannerState, settings, weakStats, recentKeys, true);
      if (weak) return weak;
    }

    return bestRotationCandidate(plannerState, settings, recentKeys, false)
      || bestRotationCandidate(plannerState, settings, recentKeys, true)
      || best;
  }

  function bestRetestCandidate(plannerState, settings, weakStats, recentKeys, allowRecent) {
    let best = null;
    for (const summary of candidateSummaries(settings)) {
      const candidate = scoreWeaknessCandidate(summary, Object.assign({}, plannerState, { settings }), weakStats, recentKeys, allowRecent);
      if (!candidate) continue;
      if (!best || candidate.score > best.score || tieBreakCandidate(candidate, best)) best = candidate;
    }
    return best;
  }

  function bestRotationCandidate(plannerState, settings, recentKeys, allowRecent) {
    const attemptStats = attemptStatsFromRecords(plannerState.records || [], settings);
    let best = null;
    for (const summary of candidateSummaries(settings)) {
      const candidate = scoreRotationCandidate(summary, Object.assign({}, plannerState, { settings }), attemptStats, recentKeys, allowRecent);
      if (!candidate) continue;
      if (!best || candidate.score > best.score || tieBreakCandidate(candidate, best)) best = candidate;
    }
    return best;
  }

  function tieBreakCandidate(candidate, best) {
    if (candidate.score !== best.score) return false;
    if (candidate.newAtoms !== best.newAtoms) return candidate.newAtoms > best.newAtoms;
    if (candidate.changes !== best.changes) return candidate.changes < best.changes;
    return candidate.layoutKey < best.layoutKey;
  }

  function buildPreviewDeck(plannerState, limit) {
    const state = {
      settings: normalizeSettings(plannerState.settings),
      records: (plannerState.records || []).slice(),
      currentLayoutKey: plannerState.currentLayoutKey || plannerState.lastLayoutKey || null,
      lastLayoutKey: plannerState.lastLayoutKey || null,
    };
    const deck = [];
    for (let i = 0; i < limit; i += 1) {
      const suggestion = suggestNext(state);
      if (!suggestion || (suggestion.kind === "coverage" && suggestion.newAtoms <= 0 && suggestion.newFeatures <= 0)) break;
      deck.push(suggestion);
      for (const variant of suggestion.variants) {
        state.records.push({
          id: `preview-${i}-${runVariantKey(variant)}`,
          layoutKey: suggestion.layoutKey,
          variantKey: runVariantKey(variant),
          result: "pass",
          createdAt: new Date(0).toISOString(),
        });
      }
      state.currentLayoutKey = suggestion.layoutKey;
      state.lastLayoutKey = suggestion.layoutKey;
    }
    return deck;
  }

  function atomLabel(atom) {
    if (atom.startsWith("IX:")) return atom.slice(3).replace(":", " · ");
    if (atom.startsWith("FR:")) {
      const [, type, target, rest] = atom.split(":");
      if (type === "side") return `${target} width ${rest} mm`;
      if (type === "corner") return `${target} ${rest.replace(">", " -> ").replace("|", " / ")} mm`;
      return `${type} ${target}`;
    }
    if (atom.startsWith("FF:")) return atom.slice(3);
    const [kind, type, rest] = atom.split(":");
    if (kind === "P") {
      const [left, right] = rest.split("|");
      return `${type} ${shortStateLabel(parseStateKey(left))} - ${shortStateLabel(parseStateKey(right))}`;
    }
    if (kind === "D") {
      const [left, right] = rest.split(">");
      return `${type} ${shortStateLabel(parseStateKey(left))} -> ${shortStateLabel(parseStateKey(right))}`;
    }
    if (kind === "Z") {
      const [left, right] = rest.split(">");
      return `zone start ${left} -> ${right}`;
    }
    if (kind === "F") {
      return `${type} ${rest}`;
    }
    return atom;
  }

  function uncoveredAtoms(records, settings, limit) {
    const progress = coverageFromRecords(records, settings);
    const items = [];
    for (const atom of progress.targets) {
      if (!progress.covered.has(atom)) items.push(atom);
      if (items.length >= limit) break;
    }
    return items;
  }

  return {
    COLORS,
    BANDS,
    GATES,
    SECTIONS,
    DIRECTIONS,
    START_MODES,
    RACE_MODES,
    FREE_OFFSETS,
    DEFAULT_SETTINGS,
    state,
    stateKey,
    parseStateKey,
    stateLabel,
    shortStateLabel,
    normalStates,
    startStates,
    allCandidates,
    freeCandidates,
    candidateLayouts,
    configKey,
    parseConfigKey,
    sectionSigns,
    recordMatchesSettings,
    layoutMatchesSettings,
    directionOrder,
    edgePairs,
    directedObstaclePairs,
    normalizeSettings,
    enabledDirections,
    enabledStartModes,
    frontGateFor,
    isRunVariantLegal,
    legalRunVariants,
    zoneStartBehaviorAtom,
    zoneStartTargets,
    minimalRunVariants,
    runVariantKey,
    parseRunVariantKey,
    runVariantCoverage,
    runVariantFeatureCoverage,
    targetAtoms,
    featureTargets,
    coverageFromRecords,
    exactRunCycleStats,
    attemptStatsFromRecords,
    weakAtomStats,
    hammingConfig,
    changesBetweenKeys,
    describeChanges,
    suggestNext,
    buildPreviewDeck,
    atomLabel,
    uncoveredAtoms,
  };
});
