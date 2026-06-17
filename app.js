(function () {
  "use strict";

  const Engine = window.WroPlannerEngine;
  const STORAGE_KEY = "wro-fe-test-planner-v1";
  const FIELD_SIZE = 3000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const BARRIER_THICKNESS = 24;
  const OBSTACLE_SIZE = 45;
  const MARKER_SIZE = 85.5;
  const MARKER_SQUARE_SIZE = 52.1;
  const START_ZONE = { width: 500, height: 200 };
  const GATE_LINES = [1000, 1500, 2000];
  const BAND_OFFSET = 400;
  const OUTER_GUIDE_INSET = 50;
  const OUTER_GUIDE_RADIUS = 313.6;
  const PREVIEW_DECK_LIMIT = 4;
  const FAILURE_TAGS = [
    { id: "hit-red", label: "Hit red" },
    { id: "hit-green", label: "Hit green" },
    { id: "wrong-side", label: "Wrong side" },
    { id: "gate-drift", label: "Gate drift" },
    { id: "corner-exit", label: "Corner exit" },
    { id: "start-fail", label: "Start fail" },
    { id: "parking-fail", label: "Parking fail" },
    { id: "unpark-fail", label: "Unpark failed" },
    { id: "localization", label: "Localization" },
    { id: "too-fast", label: "Too fast" },
    { id: "code-bug", label: "Code bug" },
  ];
  const CONDITION_PROFILES = [
    { id: "normal", label: "Normal conditions" },
    { id: "low-light", label: "Low light" },
    { id: "bright-light", label: "Bright light" },
    { id: "mixed-light", label: "Mixed light" },
    { id: "cold-field", label: "Cold field" },
    { id: "warm-field", label: "Warm field" },
    { id: "low-battery", label: "Low battery" },
    { id: "custom", label: "Custom condition" },
  ];

  const els = {};
  let state = loadState();
  let previewRenderToken = 0;
  let resetArmedUntil = 0;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    bindEvents();
    ensureCurrentLayout();
    render();
  }

  function bindElements() {
    for (const id of [
      "layoutTitle",
      "nextBtn",
      "completeBtn",
      "undoBtn",
      "exportBtn",
      "importInput",
      "resetBtn",
      "analyticsBanner",
      "recommendationCount",
      "recommendationSummary",
      "field",
      "layoutMeta",
      "changeTitle",
      "changeList",
      "runList",
      "coverageCards",
      "bars",
      "storageStatus",
      "previewDeck",
      "historyList",
      "settingsForm",
      "raceMode",
      "coverageMode",
      "changePenalty",
      "parkingRobotLength",
      "specialConditions",
      "conditionProfile",
      "conditionChecks",
      "includeCW",
      "includeCCW",
      "includeZoneStart",
      "includeParkingStart",
      "includeOppositeZone",
      "strictStartGateRule",
      "mirrorStartGateRule",
      "retestFailedTransitions",
    ]) {
      els[id] = document.getElementById(id);
    }
  }

  function bindEvents() {
    els.nextBtn.addEventListener("click", chooseNextSetup);
    els.completeBtn.addEventListener("click", completeCurrentSetup);
    els.undoBtn.addEventListener("click", undoLastRecord);
    els.exportBtn.addEventListener("click", exportState);
    els.importInput.addEventListener("change", importState);
    els.resetBtn.addEventListener("click", resetState);

    for (const id of [
      "coverageMode",
      "raceMode",
      "changePenalty",
      "includeCW",
      "includeCCW",
      "includeZoneStart",
      "includeParkingStart",
      "includeOppositeZone",
      "strictStartGateRule",
      "mirrorStartGateRule",
      "retestFailedTransitions",
      "specialConditions",
      "conditionProfile",
    ]) {
      els[id].addEventListener("change", updateSettingsFromForm);
    }
    els.parkingRobotLength.addEventListener("change", updateSettingsFromForm);
    els.conditionChecks.addEventListener("change", updateSettingsFromForm);
  }

  function defaultState() {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: Object.assign({}, Engine.DEFAULT_SETTINGS),
      records: [],
      currentLayoutKey: null,
      currentPlan: null,
      lastLayoutKey: null,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return migrateState(parsed);
    } catch (error) {
      console.warn("Failed to load planner state", error);
      return defaultState();
    }
  }

  function migrateState(input) {
    const fresh = defaultState();
    const migrated = Object.assign(fresh, input || {});
    migrated.settings = Engine.normalizeSettings(migrated.settings);
    migrated.records = Array.isArray(migrated.records) ? migrated.records.map(normalizeRecord) : [];
    migrated.currentPlan = normalizePlan(migrated.currentPlan, migrated.currentLayoutKey, migrated.records.length);
    return migrated;
  }

  function normalizeRecord(record) {
    const next = Object.assign({ note: "", failureTags: [] }, record || {});
    next.note = typeof next.note === "string" ? next.note : "";
    next.failureTags = Array.isArray(next.failureTags) ? next.failureTags.filter((tag) => failureTagById(tag)) : [];
    next.condition = normalizeConditionSnapshot(next.condition);
    return next;
  }

  function normalizePlan(plan, layoutKey, recordCount) {
    if (!plan || !layoutKey || plan.layoutKey !== layoutKey || !Array.isArray(plan.variantKeys)) return null;
    const parsedStart = Number(plan.recordStartIndex);
    return {
      layoutKey,
      variantKeys: plan.variantKeys.filter(Boolean),
      kind: plan.kind || "coverage",
      reason: plan.reason || "New coverage",
      recordStartIndex: Number.isInteger(parsedStart)
        ? Math.max(0, Math.min(recordCount, parsedStart))
        : recordCount,
    };
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStorageStatus("Saved", false);
  }

  function setStorageStatus(text, warn) {
    els.storageStatus.textContent = text;
    els.storageStatus.classList.toggle("warn", Boolean(warn));
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function ensureCurrentLayout() {
    if (state.currentLayoutKey && !layoutIsValidForMode(state.currentLayoutKey, state.settings.raceMode)) {
      state.currentLayoutKey = null;
      state.currentPlan = null;
    }
    if (state.lastLayoutKey && !layoutIsValidForMode(state.lastLayoutKey, state.settings.raceMode)) {
      state.lastLayoutKey = null;
    }
    if (state.currentPlan && state.currentPlan.layoutKey !== state.currentLayoutKey) {
      state.currentPlan = null;
    }
    if (state.currentLayoutKey) return;
    const suggestion = nextSuggestion();
    if (!suggestion) return;
    applySuggestion(suggestion);
    saveState();
  }

  function nextSuggestion() {
    return Engine.suggestNext(state) || fallbackSuggestion();
  }

  function fallbackSuggestion() {
    const config = Engine.candidateLayouts(state.settings)
      .find((candidate) => Engine.legalRunVariants(candidate, state.settings).length > 0);
    if (!config) return null;
    const variants = Engine.legalRunVariants(config, state.settings).slice(0, 2);
    return {
      layoutKey: Engine.configKey(config),
      config,
      score: 0,
      newAtoms: 0,
      newFeatures: 0,
      failedRetests: 0,
      changes: Engine.changesBetweenKeys(state.lastLayoutKey, Engine.configKey(config)),
      variants,
      kind: "rotation",
      reason: "Maintenance rotation",
    };
  }

  function applySuggestion(suggestion) {
    state.currentLayoutKey = suggestion.layoutKey;
    state.currentPlan = {
      layoutKey: suggestion.layoutKey,
      variantKeys: (suggestion.variants || []).map(Engine.runVariantKey),
      kind: suggestion.kind || "coverage",
      reason: suggestion.reason || "New coverage",
      recordStartIndex: state.records.length,
    };
  }

  function updateSettingsFromForm() {
    const previousRaceMode = state.settings.raceMode;
    const selectedRaceMode = els.raceMode.value;
    const preserveObstacleOnlySettings = previousRaceMode === "free" || selectedRaceMode === "free";
    const next = Object.assign({}, state.settings, {
      raceMode: selectedRaceMode,
      coverageMode: els.coverageMode.value,
      includeCW: els.includeCW.checked,
      includeCCW: els.includeCCW.checked,
      includeZoneStart: els.includeZoneStart.checked,
      includeParkingStart: preserveObstacleOnlySettings ? state.settings.includeParkingStart : els.includeParkingStart.checked,
      includeOppositeZone: els.includeOppositeZone.checked,
      strictStartGateRule: preserveObstacleOnlySettings ? state.settings.strictStartGateRule : els.strictStartGateRule.checked,
      mirrorStartGateRule: preserveObstacleOnlySettings ? state.settings.mirrorStartGateRule : els.mirrorStartGateRule.checked,
      retestFailedTransitions: els.retestFailedTransitions.checked,
      specialConditions: els.specialConditions.checked,
      conditionProfile: els.specialConditions.checked ? els.conditionProfile.value : "normal",
      conditionChecks: String(els.conditionChecks.value || "").slice(0, 220),
      changePenalty: Number(els.changePenalty.value),
      parkingRobotLength: clampNumber(els.parkingRobotLength.value, 100, 300, Engine.DEFAULT_SETTINGS.parkingRobotLength),
    });
    if (!next.includeCW && !next.includeCCW) {
      next.includeCW = true;
    }
    if (!next.includeZoneStart && !next.includeParkingStart && !next.includeOppositeZone) {
      next.includeZoneStart = true;
    }
    state.settings = Engine.normalizeSettings(next);
    if (state.settings.raceMode !== previousRaceMode) {
      state.currentLayoutKey = null;
      state.currentPlan = null;
      state.lastLayoutKey = null;
    }
    saveState();
    ensureCurrentLayout();
    render();
  }

  function renderSettings() {
    const settings = Engine.normalizeSettings(state.settings);
    els.raceMode.value = settings.raceMode;
    els.coverageMode.value = settings.coverageMode;
    els.changePenalty.value = String(settings.changePenalty);
    els.parkingRobotLength.value = String(settings.parkingRobotLength);
    els.specialConditions.checked = Boolean(settings.specialConditions);
    els.conditionProfile.value = settings.specialConditions ? conditionProfileById(settings.conditionProfile).id : "normal";
    els.conditionProfile.disabled = !settings.specialConditions;
    els.conditionChecks.value = settings.conditionChecks || "";
    els.conditionChecks.disabled = !settings.specialConditions;
    els.includeCW.checked = settings.includeCW;
    els.includeCCW.checked = settings.includeCCW;
    els.includeZoneStart.checked = settings.includeZoneStart;
    els.includeParkingStart.checked = settings.raceMode === "obstacle" && settings.includeParkingStart;
    els.includeOppositeZone.checked = settings.includeOppositeZone;
    els.strictStartGateRule.checked = settings.raceMode === "obstacle" && settings.strictStartGateRule;
    els.mirrorStartGateRule.checked = settings.raceMode === "obstacle" && settings.mirrorStartGateRule;
    els.retestFailedTransitions.checked = settings.retestFailedTransitions;
    els.includeParkingStart.disabled = settings.raceMode === "free";
    els.strictStartGateRule.disabled = settings.raceMode === "free";
    els.mirrorStartGateRule.disabled = settings.raceMode === "free";
  }

  function render() {
    renderSettings();
    renderCurrentLayout();
    renderCoverage();
    renderRecommendations();
    renderPreviewDeck();
    renderHistory();
    els.undoBtn.disabled = state.records.length === 0;
  }

  function renderCurrentLayout() {
    if (!state.currentLayoutKey) {
      els.layoutTitle.textContent = "No setup available";
      els.field.innerHTML = "";
      els.layoutMeta.innerHTML = "";
      els.changeList.innerHTML = emptyState("No valid setup matches the active filters.");
      els.runList.innerHTML = "";
      return;
    }
    const config = Engine.parseConfigKey(state.currentLayoutKey);
    els.layoutTitle.textContent = layoutLabel(state.currentLayoutKey);
    els.changeTitle.textContent = state.settings.raceMode === "free" ? "Wall changes" : "Obstacle changes";
    renderField(config);
    renderLayoutMeta(config);
    renderChanges();
    renderRunList(config);
  }

  function renderField(config) {
    els.field.replaceChildren(buildFieldSvg(config));
  }

  function buildFieldSvg(config) {
    const isObstacle = Array.isArray(config);
    const offsets = isObstacle ? { top: 1000, right: 1000, bottom: 1000, left: 1000 } : config;
    const inner = innerRect(offsets);
    const svg = svgEl("svg", {
      viewBox: `-140 -140 ${FIELD_SIZE + 280} ${FIELD_SIZE + 280}`,
      class: "field-svg",
      role: "img",
      "aria-label": isObstacle ? "Obstacle race field" : "Free race field",
    });

    drawSvgDefs(svg);
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: FIELD_SIZE, height: FIELD_SIZE, class: "mat-bg" }));
    drawObstacleMarkerLines(svg);
    drawObstacleMarkers(svg);
    drawGuideLines(svg);
    drawBarriers(svg, inner);
    drawSectionLabels(svg);
    if (isObstacle) {
      drawStartZones(svg);
      drawParking(svg);
      drawObstacles(svg, config, offsets);
    } else {
      drawFreeMeasurements(svg, offsets, inner);
      drawStartZones(svg);
    }
    drawDirectionIndicators(svg, config);
    return svg;
  }

  function innerRect(offsets) {
    return {
      x: offsets.left,
      y: offsets.top,
      width: FIELD_SIZE - offsets.left - offsets.right,
      height: FIELD_SIZE - offsets.top - offsets.bottom,
    };
  }

  function svgEl(name, attrs, text) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function drawSvgDefs(svg) {
    const defs = svgEl("defs", {});
    const marker = svgEl("marker", {
      id: "directionArrowHead",
      viewBox: "0 0 10 10",
      refX: 8,
      refY: 5,
      markerWidth: 8,
      markerHeight: 8,
      orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "direction-arrow-head" }));
    defs.appendChild(marker);
    svg.appendChild(defs);
  }

  function drawGuideLines(svg) {
    const staticInner = { x: 1000, y: 1000, width: 1000, height: 1000 };
    drawOuterGuideLine(svg);
    const corners = guideSegments(staticInner);
    for (const corner of corners) {
      svg.appendChild(svgEl("line", {
        x1: corner.from[0],
        y1: corner.from[1],
        x2: corner.to[0],
        y2: corner.to[1],
        class: `guide-line ${corner.cls}`,
      }));
    }
  }

  function drawOuterGuideLine(svg) {
    svg.appendChild(svgEl("rect", {
      x: OUTER_GUIDE_INSET,
      y: OUTER_GUIDE_INSET,
      width: FIELD_SIZE - OUTER_GUIDE_INSET * 2,
      height: FIELD_SIZE - OUTER_GUIDE_INSET * 2,
      rx: OUTER_GUIDE_RADIUS,
      ry: OUTER_GUIDE_RADIUS,
      class: "outer-guide-line",
    }));
  }

  function guideSegments(inner) {
    const x1 = inner.x;
    const x2 = inner.x + inner.width;
    const y1 = inner.y;
    const y2 = inner.y + inner.height;
    return [
      { from: [x1, y1], to: [x1 - 500, 0], cls: "guide-blue" },
      { from: [x1, y1], to: [0, y1 - 500], cls: "guide-orange" },
      { from: [x2, y1], to: [x2 + 500, 0], cls: "guide-orange" },
      { from: [x2, y1], to: [FIELD_SIZE, y1 - 500], cls: "guide-blue" },
      { from: [x2, y2], to: [FIELD_SIZE, y2 + 500], cls: "guide-orange" },
      { from: [x2, y2], to: [x2 + 500, FIELD_SIZE], cls: "guide-blue" },
      { from: [x1, y2], to: [x1 - 500, FIELD_SIZE], cls: "guide-orange" },
      { from: [x1, y2], to: [0, y2 + 500], cls: "guide-blue" },
    ];
  }

  function drawCornerArcs(svg, inner) {
    const arcs = [
      `M ${inner.x - 500} 0 Q 0 0 0 ${inner.y - 500}`,
      `M ${inner.x + inner.width + 500} 0 Q ${FIELD_SIZE} 0 ${FIELD_SIZE} ${inner.y - 500}`,
      `M ${FIELD_SIZE} ${inner.y + inner.height + 500} Q ${FIELD_SIZE} ${FIELD_SIZE} ${inner.x + inner.width + 500} ${FIELD_SIZE}`,
      `M ${inner.x - 500} ${FIELD_SIZE} Q 0 ${FIELD_SIZE} 0 ${inner.y + inner.height + 500}`,
    ];
    for (const d of arcs) svg.appendChild(svgEl("path", { d, class: "corner-arc" }));
  }

  function drawDirectionIndicators(svg, config) {
    const directions = new Set(Engine.legalRunVariants(config, state.settings).map((variant) => variant.direction));
    const rows = [];
    if (directions.size > 1) {
      if (directions.has("CW")) rows.push({ direction: "CW", y: 3095, x1: 1280, x2: 900, labelX: 1090 });
      if (directions.has("CCW")) rows.push({ direction: "CCW", y: 3095, x1: 1720, x2: 2100, labelX: 1910 });
    } else {
      if (directions.has("CW")) rows.push({ direction: "CW", y: 3095, x1: 1720, x2: 1280, labelX: 1500 });
      if (directions.has("CCW")) rows.push({ direction: "CCW", y: 3095, x1: 1280, x2: 1720, labelX: 1500 });
    }
    for (const row of rows) {
      svg.appendChild(svgEl("line", {
        x1: row.x1,
        y1: row.y,
        x2: row.x2,
        y2: row.y,
        class: "direction-arrow",
        "marker-end": "url(#directionArrowHead)",
      }));
      svg.appendChild(svgEl("text", {
        x: row.labelX,
        y: row.y - 26,
        class: "direction-label",
        "text-anchor": "middle",
      }, row.direction));
    }
  }

  function drawBarriers(svg, inner) {
    const group = svgEl("g", { class: "barriers" });
    const outer = [
      { x: -BARRIER_THICKNESS, y: -BARRIER_THICKNESS, width: FIELD_SIZE + BARRIER_THICKNESS * 2, height: BARRIER_THICKNESS },
      { x: -BARRIER_THICKNESS, y: FIELD_SIZE, width: FIELD_SIZE + BARRIER_THICKNESS * 2, height: BARRIER_THICKNESS },
      { x: -BARRIER_THICKNESS, y: -BARRIER_THICKNESS, width: BARRIER_THICKNESS, height: FIELD_SIZE + BARRIER_THICKNESS * 2 },
      { x: FIELD_SIZE, y: -BARRIER_THICKNESS, width: BARRIER_THICKNESS, height: FIELD_SIZE + BARRIER_THICKNESS * 2 },
    ];
    const innerWalls = [
      { x: inner.x, y: inner.y, width: inner.width, height: BARRIER_THICKNESS },
      { x: inner.x, y: inner.y + inner.height - BARRIER_THICKNESS, width: inner.width, height: BARRIER_THICKNESS },
      { x: inner.x, y: inner.y, width: BARRIER_THICKNESS, height: inner.height },
      { x: inner.x + inner.width - BARRIER_THICKNESS, y: inner.y, width: BARRIER_THICKNESS, height: inner.height },
    ];
    for (const wall of outer.concat(innerWalls)) {
      group.appendChild(svgEl("rect", Object.assign({}, wall, { class: "barrier-board" })));
    }
    svg.appendChild(group);
  }

  function drawSectionLabels(svg) {
    const labels = [
      ["C", 1500, 165],
      ["D", 2835, 1510],
      ["A START-FINISH", 1500, 2835],
      ["B", 165, 1510],
    ];
    for (const [label, x, y] of labels) {
      svg.appendChild(svgEl("text", { x, y, class: "section-label", "text-anchor": "middle" }, label));
    }
  }

  function drawStartZones(svg) {
    const zones = [
      { x: 1500, y: 2400, cls: "start-zone primary-zone", label: "zone" },
      { x: 1000, y: 2400, cls: "start-zone secondary-zone", label: "opposite" },
    ];
    for (const zone of zones) {
      svg.appendChild(svgEl("rect", {
        x: zone.x,
        y: zone.y,
        width: START_ZONE.width,
        height: START_ZONE.height,
        rx: 0,
        class: zone.cls,
      }));
      svg.appendChild(svgEl("text", {
        x: zone.x + START_ZONE.width / 2,
        y: zone.y + START_ZONE.height / 2 + 20,
        class: "tiny-label start-zone-label",
        "text-anchor": "middle",
      }, zone.label));
    }
  }

  function drawParking(svg) {
    const robotLength = clampNumber(state.settings.parkingRobotLength, 100, 300, Engine.DEFAULT_SETTINGS.parkingRobotLength);
    const gap = robotLength * 1.5;
    const wallThickness = 19;
    const wallLength = 200;
    const rightWallX = 2000;
    const leftWallX = rightWallX - gap - wallThickness;
    for (const x of [leftWallX, rightWallX]) {
      svg.appendChild(svgEl("rect", { x, y: FIELD_SIZE - wallLength, width: wallThickness, height: wallLength, rx: 4, class: "parking-wall" }));
    }
    svg.appendChild(svgEl("line", {
      x1: leftWallX + wallThickness,
      y1: FIELD_SIZE - wallLength - 32,
      x2: rightWallX,
      y2: FIELD_SIZE - wallLength - 32,
      class: "parking-depth",
    }));
    svg.appendChild(svgEl("text", { x: leftWallX + wallThickness + gap / 2, y: FIELD_SIZE - wallLength - 64, class: "tiny-label", "text-anchor": "middle" }, "parking"));
  }

  function drawObstacleMarkers(svg) {
    for (const section of Engine.SECTIONS) {
      for (const band of Engine.BANDS) {
        for (const gate of Engine.GATES) {
          const point = obstaclePoint(section.id, band.id, gate.id, { top: 1000, right: 1000, bottom: 1000, left: 1000 });
          svg.appendChild(svgEl("circle", { cx: point.x, cy: point.y, r: MARKER_SIZE / 2, class: "marker-circle" }));
          svg.appendChild(svgEl("rect", {
            x: point.x - MARKER_SQUARE_SIZE / 2,
            y: point.y - MARKER_SQUARE_SIZE / 2,
            width: MARKER_SQUARE_SIZE,
            height: MARKER_SQUARE_SIZE,
            class: "marker-square",
          }));
        }
      }
    }
  }

  function drawObstacleMarkerLines(svg) {
    const sections = [
      { id: "C", horizontal: true, x1: 1000, x2: 2000, y1: 0, y2: 1000, rows: [400, 600], gates: GATE_LINES },
      { id: "D", horizontal: false, x1: 2000, x2: 3000, y1: 1000, y2: 2000, rows: [2400, 2600], gates: GATE_LINES },
      { id: "A", horizontal: true, x1: 1000, x2: 2000, y1: 2000, y2: 3000, rows: [2400, 2600], gates: GATE_LINES },
      { id: "B", horizontal: false, x1: 0, x2: 1000, y1: 1000, y2: 2000, rows: [400, 600], gates: GATE_LINES },
    ];
    for (const section of sections) {
      if (section.horizontal) {
        for (const x of section.gates) {
          svg.appendChild(svgEl("line", { x1: x, y1: section.y1, x2: x, y2: section.y2, class: "marker-line" }));
        }
        for (const y of section.rows) {
          svg.appendChild(svgEl("line", { x1: section.x1, y1: y, x2: section.x2, y2: y, class: "marker-line" }));
        }
      } else {
        for (const y of section.gates) {
          svg.appendChild(svgEl("line", { x1: section.x1, y1: y, x2: section.x2, y2: y, class: "marker-line" }));
        }
        for (const x of section.rows) {
          svg.appendChild(svgEl("line", { x1: x, y1: section.y1, x2: x, y2: section.y2, class: "marker-line" }));
        }
      }
    }
  }

  function drawObstacles(svg, config, offsets) {
    Engine.SECTIONS.forEach((section, index) => {
      const item = config[index];
      const point = obstaclePoint(section.id, item.band, item.gate, offsets);
      const group = svgEl("g", { class: "obstacle-node" });
      group.appendChild(svgEl("rect", {
        x: point.x - OBSTACLE_SIZE / 2,
        y: point.y - OBSTACLE_SIZE / 2,
        width: OBSTACLE_SIZE,
        height: OBSTACLE_SIZE,
        rx: 4,
        class: item.color === "R" ? "obstacle-block red-block" : "obstacle-block green-block",
      }));
      const label = obstacleLabelPosition(section.id, point);
      group.appendChild(svgEl("text", {
        x: label.x,
        y: label.y,
        class: "obstacle-label",
        "text-anchor": label.anchor,
      }, `${section.id} ${Engine.shortStateLabel(item)}`));
      svg.appendChild(group);
    });
  }

  function obstaclePoint(sectionId, bandId, gateId, offsets) {
    const gate = Number(gateId);
    if (sectionId === "A") {
      return {
        x: GATE_LINES[3 - gate],
        y: bandId === "I" ? FIELD_SIZE - offsets.bottom + BAND_OFFSET : FIELD_SIZE - BAND_OFFSET,
      };
    }
    if (sectionId === "B") {
      return {
        x: bandId === "I" ? offsets.left - BAND_OFFSET : BAND_OFFSET,
        y: GATE_LINES[3 - gate],
      };
    }
    if (sectionId === "C") {
      return {
        x: GATE_LINES[gate - 1],
        y: bandId === "I" ? offsets.top - BAND_OFFSET : BAND_OFFSET,
      };
    }
    return {
      x: bandId === "I" ? FIELD_SIZE - offsets.right + BAND_OFFSET : FIELD_SIZE - BAND_OFFSET,
      y: GATE_LINES[gate - 1],
    };
  }

  function obstacleLabelPosition(sectionId, point) {
    if (sectionId === "A") return { x: point.x, y: point.y - 76, anchor: "middle" };
    if (sectionId === "B") return { x: point.x + 122, y: point.y + 24, anchor: "start" };
    if (sectionId === "C") return { x: point.x, y: point.y + 132, anchor: "middle" };
    return { x: point.x - 122, y: point.y + 24, anchor: "end" };
  }

  function drawFreeMeasurements(svg, offsets, inner) {
    const measurements = [
      { section: "C", value: offsets.top, x1: 1250, y1: 0, x2: 1250, y2: inner.y, lx: 1250, ly: inner.y / 2 },
      { section: "D", value: offsets.right, x1: inner.x + inner.width, y1: 1750, x2: FIELD_SIZE, y2: 1750, lx: inner.x + inner.width + offsets.right / 2, ly: 1750 },
      { section: "A", value: offsets.bottom, x1: 1750, y1: inner.y + inner.height, x2: 1750, y2: FIELD_SIZE, lx: 1750, ly: FIELD_SIZE - 260 },
      { section: "B", value: offsets.left, x1: 0, y1: 1250, x2: inner.x, y2: 1250, lx: Math.max(420, inner.x / 2), ly: 1250 },
    ];
    for (const measurement of measurements) {
      svg.appendChild(svgEl("line", {
        x1: measurement.x1,
        y1: measurement.y1,
        x2: measurement.x2,
        y2: measurement.y2,
        class: "measure-line",
      }));
      svg.appendChild(svgEl("text", {
        x: measurement.lx,
        y: measurement.ly,
        class: "measure-label",
        "text-anchor": "middle",
      }, `${measurement.value} mm`));
    }
  }

  function renderLayoutMeta(config) {
    const legalVariants = visibleRunVariants(config);
    const progress = Engine.coverageFromRecords(state.records, state.settings);
    const coverageUnion = new Set();
    const featureUnion = new Set();
    for (const variant of legalVariants) {
      for (const atom of Engine.runVariantCoverage(config, variant, state.settings)) coverageUnion.add(atom);
      for (const atom of Engine.runVariantFeatureCoverage(config, variant)) featureUnion.add(atom);
    }
    const newAtoms = countNew(coverageUnion, progress.covered);
    const newFeatures = countNew(featureUnion, progress.features);
    const changes = Engine.changesBetweenKeys(state.lastLayoutKey, state.currentLayoutKey);
    const condition = currentConditionSnapshot();
    els.layoutMeta.innerHTML = [
      metric("Legal runs", legalVariants.length),
      metric(newCoverageLabel(), newAtoms),
      metric("New features", newFeatures),
      metric(state.settings.raceMode === "free" ? "Wall changes" : "Obstacle changes", state.lastLayoutKey ? changes : 4),
      metric("Plan", planLabel(state.currentPlan)),
      metric("Condition", conditionLabel(condition)),
    ].join("");
  }

  function countNew(items, covered) {
    let count = 0;
    for (const item of items) {
      if (!covered.has(item)) count += 1;
    }
    return count;
  }

  function metric(label, value) {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function renderChanges() {
    if (!state.lastLayoutKey) {
      els.changeList.innerHTML = emptyState("Initial setup.");
      return;
    }
    const changes = Engine.describeChanges(state.lastLayoutKey, state.currentLayoutKey);
    if (changes.length === 0) {
      els.changeList.innerHTML = emptyState("No obstacle changes.");
      return;
    }
    els.changeList.innerHTML = changes
      .map((item) => {
        return `<div class="change-item"><strong>${item.section.id}</strong> ${escapeHtml(changeLabel(item.from))} to ${escapeHtml(changeLabel(item.to))}</div>`;
      })
      .join("");
  }

  function changeLabel(item) {
    return item.label || Engine.shortStateLabel(item);
  }

  function renderRunList(config) {
    const variants = visibleRunVariants(config);
    if (variants.length === 0) {
      els.runList.innerHTML = emptyState("No legal run variants for this setup.");
      return;
    }
    const layoutKey = Engine.configKey(config);
    els.runList.innerHTML = variants.map((variant) => runCard(layoutKey, variant)).join("");
    els.runList.querySelectorAll("[data-run-action]").forEach((button) => {
      button.addEventListener("click", () => {
        recordRun(button.dataset.variant, button.dataset.runAction);
      });
    });
    els.runList.querySelectorAll("[data-tag]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleFailureTag(button.dataset.record, button.dataset.tag);
      });
    });
    els.runList.querySelectorAll("[data-note-record]").forEach((input) => {
      input.addEventListener("input", () => {
        updateIssueNote(input.dataset.noteRecord, input.value);
      });
      input.addEventListener("blur", render);
    });
  }

  function runCard(layoutKey, variant) {
    const variantKey = Engine.runVariantKey(variant);
    const record = latestCurrentRecord(layoutKey, variantKey);
    const stats = runStats(layoutKey, variantKey);
    const startMode = labelForStartMode(variant.startMode);
    const direction = variant.direction;
    const statusClass = record && record.result === "issue" ? "issue" : record ? "done" : "";
    const statusText = record ? resultLabel(record.result) : "Open";
    const condition = record ? record.condition : currentConditionSnapshot();
    const failurePanel = record && record.result === "issue" ? failureTagPanel(record) : "";
    return `
      <div class="run-card ${statusClass}">
        <div class="run-head">
          <div>
            <div class="run-title">${escapeHtml(direction)} - ${escapeHtml(startMode)}</div>
            <div class="run-meta">${escapeHtml(statusText)} - ${escapeHtml(conditionLabel(condition))}</div>
          </div>
          <div class="run-meta">${escapeHtml(variantKey)}</div>
        </div>
        ${runStatsMarkup(stats)}
        ${failurePanel}
        <div class="run-actions">
          <button class="button primary" type="button" data-run-action="pass" data-variant="${escapeHtml(variantKey)}">Pass</button>
          <button class="button" type="button" data-run-action="issue" data-variant="${escapeHtml(variantKey)}">Issue</button>
          <button class="button ghost" type="button" data-run-action="skip" data-variant="${escapeHtml(variantKey)}">Skip</button>
        </div>
      </div>`;
  }

  function runStats(layoutKey, variantKey) {
    const stats = { attempts: 0, passes: 0, issues: 0, skips: 0, latestIssue: null };
    for (const record of state.records) {
      if (record.layoutKey !== layoutKey || record.variantKey !== variantKey) continue;
      if (record.result === "pass") {
        stats.attempts += 1;
        stats.passes += 1;
      } else if (record.result === "issue") {
        stats.attempts += 1;
        stats.issues += 1;
        stats.latestIssue = record;
      } else if (record.result === "skip") {
        stats.skips += 1;
      }
    }
    stats.passRate = stats.attempts ? Math.round((stats.passes / stats.attempts) * 100) : null;
    return stats;
  }

  function runStatsMarkup(stats) {
    if (!stats.attempts && !stats.skips) {
      return `<div class="run-stats"><span>0 attempts</span></div>`;
    }
    const items = [];
    if (stats.attempts) items.push(`${stats.attempts} ${stats.attempts === 1 ? "attempt" : "attempts"}`);
    if (stats.passRate !== null) items.push(`${stats.passRate}% pass`);
    if (stats.issues) items.push(`${stats.issues} ${stats.issues === 1 ? "issue" : "issues"}`);
    if (stats.skips && !stats.attempts) items.push(`${stats.skips} skipped`);
    return `<div class="run-stats">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function failureTagPanel(record) {
    const active = new Set(record.failureTags || []);
    return `
      <div class="failure-panel">
        <div class="failure-title">Tag latest issue</div>
        <div class="failure-tags">
          ${FAILURE_TAGS.map((tag) => {
            const isActive = active.has(tag.id);
            return `<button class="failure-tag ${isActive ? "active" : ""}" type="button" data-record="${escapeHtml(record.id)}" data-tag="${escapeHtml(tag.id)}">${escapeHtml(tag.label)}</button>`;
          }).join("")}
        </div>
        <label class="failure-note">
          <span>Optional note</span>
          <textarea rows="2" data-note-record="${escapeHtml(record.id)}" placeholder="Add a custom issue note">${escapeHtml(record.note || "")}</textarea>
        </label>
      </div>`;
  }

  function toggleFailureTag(recordId, tagId) {
    if (!failureTagById(tagId)) return;
    const record = state.records.find((item) => item.id === recordId);
    if (!record || record.result !== "issue") return;
    record.failureTags = Array.isArray(record.failureTags) ? record.failureTags : [];
    const index = record.failureTags.indexOf(tagId);
    if (index >= 0) {
      record.failureTags.splice(index, 1);
    } else {
      record.failureTags.push(tagId);
    }
    saveState();
    render();
  }

  function updateIssueNote(recordId, value) {
    const record = state.records.find((item) => item.id === recordId);
    if (!record || record.result !== "issue") return;
    record.note = String(value || "").slice(0, 500);
    saveState();
  }

  function failureTagById(tagId) {
    return FAILURE_TAGS.find((tag) => tag.id === tagId) || null;
  }

  function failureTagLabel(tagId) {
    const tag = failureTagById(tagId);
    return tag ? tag.label : tagId;
  }

  function latestRecord(layoutKey, variantKey) {
    return latestRecordFrom(layoutKey, variantKey, 0);
  }

  function latestCurrentRecord(layoutKey, variantKey) {
    return latestRecordFrom(layoutKey, variantKey, currentPlanRecordStartIndex(layoutKey));
  }

  function latestRecordFrom(layoutKey, variantKey, startIndex) {
    const floor = Math.max(0, Number(startIndex) || 0);
    for (let i = state.records.length - 1; i >= floor; i -= 1) {
      const record = state.records[i];
      if (record.layoutKey === layoutKey && record.variantKey === variantKey) return record;
    }
    return null;
  }

  function currentPlanRecordStartIndex(layoutKey) {
    if (!state.currentPlan || state.currentPlan.layoutKey !== layoutKey) return 0;
    const index = Number(state.currentPlan.recordStartIndex);
    return Number.isInteger(index) ? Math.max(0, Math.min(state.records.length, index)) : 0;
  }

  function resultLabel(result) {
    if (result === "pass") return "Passed";
    if (result === "issue") return "Issue logged";
    if (result === "skip") return "Skipped";
    return result;
  }

  function labelForStartMode(mode) {
    const item = Engine.START_MODES.find((startMode) => startMode.id === mode);
    return item ? item.label : mode;
  }

  function recordRun(variantKey, result) {
    state.records.push(createRunRecord(state.currentLayoutKey, variantKey, result));
    state.lastLayoutKey = state.currentLayoutKey;
    saveState();
    render();
  }

  function createRunRecord(layoutKey, variantKey, result) {
    return {
      id: createId(),
      layoutKey,
      variantKey,
      result,
      note: "",
      failureTags: [],
      condition: currentConditionSnapshot(),
      createdAt: new Date().toISOString(),
      raceMode: state.settings.raceMode,
    };
  }

  function createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function completeCurrentSetup() {
    if (!state.currentLayoutKey) return;
    const config = Engine.parseConfigKey(state.currentLayoutKey);
    const variants = visibleRunVariants(config);
    let added = 0;
    for (const variant of variants) {
      const variantKey = Engine.runVariantKey(variant);
      if (latestCurrentRecord(state.currentLayoutKey, variantKey)) continue;
      state.records.push(createRunRecord(state.currentLayoutKey, variantKey, "pass"));
      added += 1;
    }
    if (added > 0 || variants.every((variant) => latestCurrentRecord(state.currentLayoutKey, Engine.runVariantKey(variant)))) {
      state.lastLayoutKey = state.currentLayoutKey;
      state.currentLayoutKey = null;
      state.currentPlan = null;
      ensureCurrentLayout();
      saveState();
      render();
    }
  }

  function chooseNextSetup() {
    if (state.currentLayoutKey) {
      const config = Engine.parseConfigKey(state.currentLayoutKey);
      const variants = visibleRunVariants(config);
      for (const variant of variants) {
        const variantKey = Engine.runVariantKey(variant);
        if (latestCurrentRecord(state.currentLayoutKey, variantKey)) continue;
        state.records.push(createRunRecord(state.currentLayoutKey, variantKey, "skip"));
      }
      state.lastLayoutKey = state.currentLayoutKey;
      state.currentLayoutKey = null;
      state.currentPlan = null;
    }
    const suggestion = nextSuggestion();
    if (!suggestion) {
      setStorageStatus("Complete", false);
      return;
    }
    applySuggestion(suggestion);
    saveState();
    render();
  }

  function visibleRunVariants(config) {
    const layoutKey = Engine.configKey(config);
    const minimal = Engine.minimalRunVariants(config, state.settings, state.records);
    const visibleKeys = new Set(minimal.map(Engine.runVariantKey));
    const legal = Engine.legalRunVariants(config, state.settings);
    if (state.currentPlan && state.currentPlan.layoutKey === layoutKey) {
      for (const variantKey of state.currentPlan.variantKeys) visibleKeys.add(variantKey);
    }
    for (const variant of legal) {
      const variantKey = Engine.runVariantKey(variant);
      if (visibleKeys.has(variantKey)) continue;
      if (latestCurrentRecord(layoutKey, variantKey)) visibleKeys.add(variantKey);
    }
    return legal.filter((variant) => visibleKeys.has(Engine.runVariantKey(variant)));
  }

  function undoLastRecord() {
    if (state.records.length === 0) return;
    state.records.pop();
    const last = lastAttemptedLayoutKey();
    state.lastLayoutKey = last;
    if (!state.currentLayoutKey) ensureCurrentLayout();
    saveState();
    render();
  }

  function lastAttemptedLayoutKey() {
    for (let i = state.records.length - 1; i >= 0; i -= 1) {
      if (state.records[i].result === "pass" || state.records[i].result === "issue") {
        return state.records[i].layoutKey;
      }
    }
    return null;
  }

  function renderCoverage() {
    const progress = Engine.coverageFromRecords(state.records, state.settings);
    const cycle = Engine.exactRunCycleStats(state.records, state.settings);
    const coveragePercent = progress.targetCount ? Math.round((progress.coveredCount / progress.targetCount) * 100) : 0;
    const featurePercent = progress.featureTargetCount ? Math.round((progress.featureCoveredCount / progress.featureTargetCount) * 100) : 0;
    const activeRecords = state.records.filter((record) => recordRaceMode(record) === state.settings.raceMode);
    const attempts = activeRecords.filter((record) => record.result === "pass" || record.result === "issue").length;
    const passes = activeRecords.filter((record) => record.result === "pass").length;
    const issues = activeRecords.filter((record) => record.result === "issue").length;
    const passPercent = attempts ? Math.round((passes / attempts) * 100) : 0;
    const exactLabel = state.settings.raceMode === "free" ? "Geometry" : state.settings.includeZoneStart ? "Targets" : "Transitions";
    const barLabel = state.settings.raceMode === "free" ? "Exact geometry" : state.settings.includeZoneStart ? "Exact targets" : "Exact transitions";
    const cycleValue = cycle.total
      ? `${cycle.cycle} (${cycle.cycleCompleted}/${cycle.total})`
      : String(cycle.cycle);
    els.coverageCards.innerHTML = [
      coverageCard(exactLabel, `${progress.coveredCount}/${progress.targetCount}`),
      coverageCard("Coverage", `${coveragePercent}%`),
      coverageCard("Attempts", attempts),
      coverageCard("Issues", issues),
      coverageCard("Cycle", cycleValue),
    ].join("");
    els.bars.innerHTML = [
      barRow(barLabel, coveragePercent),
      barRow("First pass", cycle.firstPassPercent),
      barRow(`Cycle ${cycle.cycle}`, cycle.cyclePercent),
      barRow("Feature pairs", featurePercent),
      barRow("Pass rate", passPercent),
    ].join("");
  }

  function renderRecommendations() {
    const recommendations = recommendationItems();
    const count = recommendations.length;
    els.recommendationCount.textContent = `${count} ${count === 1 ? "recommendation" : "recommendations"}`;
    els.recommendationSummary.textContent = count
      ? recommendations[0].summary
      : "Record a few runs to unlock improvement signals.";
    els.analyticsBanner.classList.toggle("has-recommendations", count > 0);
  }

  function recommendationItems() {
    const records = state.records.filter((record) => recordRaceMode(record) === state.settings.raceMode && (record.result === "pass" || record.result === "issue"));
    if (records.length === 0) return [];
    const recommendations = [];
    const weakCount = Engine.weakAtomStats(state.records, state.settings).size;
    if (weakCount > 0) {
      recommendations.push({ summary: `${weakCount} weak target${weakCount === 1 ? "" : "s"} ready for focused retesting.` });
    }
    const directionRec = groupComparisonRecommendation(records, {
      a: "CW",
      b: "CCW",
      labelFor: (record) => parseVariant(record.variantKey).direction,
      summary: (better, weaker, diff) => `${better.label} is ${diff} points more reliable than ${weaker.label}.`,
    });
    if (directionRec) recommendations.push(directionRec);
    const startRec = groupComparisonRecommendation(records, {
      a: "Parking start",
      b: "Zone start",
      labelFor: (record) => labelForStartMode(parseVariant(record.variantKey).startMode),
      summary: (better, weaker, diff) => weaker.label === "Parking start"
        ? `Parking starts cost ${diff} reliability points vs zone starts.`
        : `${better.label} is ${diff} points more reliable than ${weaker.label}.`,
    });
    if (startRec) recommendations.push(startRec);
    const conditionRec = conditionRecommendation(records);
    if (conditionRec) recommendations.push(conditionRec);
    const tagCounts = new Map();
    for (const record of records) {
      if (record.result !== "issue") continue;
      for (const tag of record.failureTags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    const topTag = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (topTag && topTag[1] >= 2) {
      recommendations.push({ summary: `${failureTagLabel(topTag[0])} appears in ${topTag[1]} issue logs.` });
    }
    const attempts = records.length;
    const issues = records.filter((record) => record.result === "issue").length;
    if (attempts >= 6 && issues / attempts >= 0.2) {
      recommendations.push({ summary: `${Math.round((issues / attempts) * 100)}% issue pressure across recent attempts.` });
    }
    return recommendations.slice(0, 4);
  }

  function groupComparisonRecommendation(records, options) {
    const groups = comparisonGroups(records, options.labelFor);
    const first = groups.get(options.a);
    const second = groups.get(options.b);
    if (!first || !second || first.attempts < 2 || second.attempts < 2) return null;
    const better = first.passRate >= second.passRate ? first : second;
    const weaker = better === first ? second : first;
    const diff = Math.abs(first.passRate - second.passRate);
    if (diff < 5) return null;
    return { summary: options.summary(better, weaker, diff) };
  }

  function comparisonGroups(records, labelFor) {
    const groups = new Map();
    for (const record of records) {
      const label = labelFor(record);
      const group = groups.get(label) || { label, attempts: 0, passes: 0 };
      group.attempts += 1;
      if (record.result === "pass") group.passes += 1;
      group.passRate = Math.round((group.passes / group.attempts) * 100);
      groups.set(label, group);
    }
    return groups;
  }

  function parseVariant(key) {
    const [direction, startMode] = String(key || "").split(":");
    return { direction: direction || "", startMode: startMode || "" };
  }

  function conditionRecommendation(records) {
    const groups = conditionGroups(records);
    const normal = groups.get("normal");
    if (!normal || normal.attempts < 3) return null;
    const normalRate = normal.passes / normal.attempts;
    let weakest = null;
    for (const [key, group] of groups.entries()) {
      if (key === "normal" || group.attempts < 2) continue;
      const rate = group.passes / group.attempts;
      const delta = normalRate - rate;
      if (delta >= 0.12 && (!weakest || delta > weakest.delta)) {
        weakest = { key, group, delta };
      }
    }
    if (!weakest) return null;
    return { summary: `${weakest.group.label} is ${Math.round(weakest.delta * 100)} points below normal conditions.` };
  }

  function conditionGroups(records) {
    const groups = new Map();
    for (const record of records) {
      const condition = normalizeConditionSnapshot(record.condition);
      const key = condition.profileId || "normal";
      const group = groups.get(key) || { label: conditionLabel(condition), attempts: 0, passes: 0, issues: 0 };
      group.attempts += 1;
      if (record.result === "pass") group.passes += 1;
      if (record.result === "issue") group.issues += 1;
      groups.set(key, group);
    }
    return groups;
  }

  function coverageCard(label, value) {
    return `<div class="coverage-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function newCoverageLabel() {
    if (state.settings.raceMode === "free") return "New geometry";
    return state.settings.includeZoneStart ? "New targets" : "New transitions";
  }

  function recordRaceMode(record) {
    return record.raceMode || (record.layoutKey && record.layoutKey.startsWith("FREE:") ? "free" : "obstacle");
  }

  function barRow(label, percent) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${escapeHtml(label)}</span><span>${safe}%</span></div>
        <div class="bar"><span style="width:${safe}%"></span></div>
      </div>`;
  }

  function renderPreviewDeck() {
    const token = ++previewRenderToken;
    const snapshot = {
      settings: Object.assign({}, state.settings),
      records: state.records.slice(),
      currentLayoutKey: state.currentLayoutKey,
      currentPlan: state.currentPlan,
      lastLayoutKey: state.lastLayoutKey,
    };
    if (!els.previewDeck.children.length) {
      els.previewDeck.innerHTML = emptyState("Updating next setups.");
    }
    window.setTimeout(() => {
      if (token !== previewRenderToken) return;
      renderPreviewDeckNow(snapshot);
    }, 0);
  }

  function renderPreviewDeckNow(snapshot) {
    const deck = Engine.buildPreviewDeck(snapshot, PREVIEW_DECK_LIMIT);
    if (deck.length === 0) {
      const uncovered = Engine.uncoveredAtoms(snapshot.records, snapshot.settings, 4);
      els.previewDeck.innerHTML = uncovered.length
        ? uncovered.map((atom) => `<div class="preview-item"><strong>${escapeHtml(Engine.atomLabel(atom))}</strong><span>uncovered</span></div>`).join("")
        : emptyState("All active targets are covered.");
      return;
    }
    els.previewDeck.innerHTML = deck
      .map((item, index) => {
        return `
          <div class="preview-item">
            <div>
              <strong>${index + 1}. ${escapeHtml(layoutLabel(item.layoutKey))}</strong>
              <span>${escapeHtml(previewItemLabel(item))}</span>
            </div>
            <span>${Math.round(item.score)}</span>
          </div>`;
      })
      .join("");
  }

  function renderHistory() {
    const recent = state.records.slice(-12).reverse();
    if (recent.length === 0) {
      els.historyList.innerHTML = emptyState("No runs recorded.");
      return;
    }
    els.historyList.innerHTML = recent
      .map((record) => {
        const variant = Engine.parseRunVariantKey(record.variantKey);
        const time = new Date(record.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const tags = record.failureTags && record.failureTags.length
          ? ` - ${record.failureTags.map(failureTagLabel).join(", ")}`
          : "";
        const condition = normalizeConditionSnapshot(record.condition);
        const conditionText = condition.profileId !== "normal" || condition.notes ? ` - ${conditionLabel(condition)}` : "";
        const note = record.note ? ` - ${record.note}` : "";
        return `
          <div class="history-item">
            <strong>${escapeHtml(layoutLabel(record.layoutKey))}</strong>
            <span>${escapeHtml(variant.direction)} ${escapeHtml(labelForStartMode(variant.startMode))} - ${escapeHtml(resultLabel(record.result))}${escapeHtml(conditionText)}${escapeHtml(tags)}${escapeHtml(note)} - ${escapeHtml(time)}</span>
          </div>`;
      })
      .join("");
  }

  function exportState() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wro-fe-test-planner-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importState(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = migrateState(JSON.parse(String(reader.result || "{}")));
        saveState();
        ensureCurrentLayout();
        render();
      } catch (error) {
        window.alert("Import failed.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function resetState() {
    const now = Date.now();
    if (now > resetArmedUntil) {
      resetArmedUntil = now + 4500;
      els.resetBtn.textContent = "Confirm reset";
      els.resetBtn.classList.add("armed");
      setStorageStatus("Click reset again to clear progress", true);
      window.setTimeout(() => {
        if (Date.now() <= resetArmedUntil) return;
        resetArmedUntil = 0;
        els.resetBtn.textContent = "Reset";
        els.resetBtn.classList.remove("armed");
        setStorageStatus("Saved", false);
      }, 4600);
      return;
    }
    resetArmedUntil = 0;
    els.resetBtn.textContent = "Reset";
    els.resetBtn.classList.remove("armed");
    state = defaultState();
    saveState();
    ensureCurrentLayout();
    render();
  }

  function emptyState(text) {
    return `<div class="empty-state">${escapeHtml(text)}</div>`;
  }

  function layoutRaceMode(key) {
    return key && key.startsWith("FREE:") ? "free" : "obstacle";
  }

  function layoutIsValidForMode(key, mode) {
    if (!key || layoutRaceMode(key) !== mode) return false;
    if (mode !== "free") return true;
    try {
      const config = Engine.parseConfigKey(key);
      return ["top", "right", "bottom", "left"].every((side) => Engine.FREE_OFFSETS.includes(config[side]));
    } catch (error) {
      return false;
    }
  }

  function layoutLabel(key) {
    if (!key) return "";
    if (!key.startsWith("FREE:")) return key.replaceAll("-", " ");
    const config = Engine.parseConfigKey(key);
    return `A${config.bottom} B${config.left} C${config.top} D${config.right}`;
  }

  function planLabel(plan) {
    if (!plan) return "Coverage";
    if (plan.kind === "weakness") return "Weakness retest";
    if (plan.kind === "rotation") return "Rotation";
    return "Coverage";
  }

  function previewItemLabel(item) {
    if (item.kind === "weakness") return `${item.variants.length} retest run${item.variants.length === 1 ? "" : "s"}, ${item.changes} changes`;
    if (item.kind === "rotation") return `${item.variants.length} rotation run${item.variants.length === 1 ? "" : "s"}, ${item.changes} changes`;
    return `${item.newAtoms} new, ${item.changes} changes`;
  }

  function conditionProfileById(id) {
    return CONDITION_PROFILES.find((profile) => profile.id === id) || CONDITION_PROFILES[0];
  }

  function currentConditionSnapshot() {
    const settings = Engine.normalizeSettings(state.settings);
    const special = Boolean(settings.specialConditions);
    const profile = special ? conditionProfileById(settings.conditionProfile) : conditionProfileById("normal");
    return {
      special,
      profileId: profile.id,
      label: profile.label,
      notes: special ? String(settings.conditionChecks || "").slice(0, 220) : "",
    };
  }

  function normalizeConditionSnapshot(condition) {
    const profile = conditionProfileById(condition && condition.profileId);
    return {
      special: Boolean(condition && condition.special && profile.id !== "normal"),
      profileId: profile.id,
      label: profile.label,
      notes: condition && typeof condition.notes === "string" ? condition.notes : "",
    };
  }

  function conditionLabel(condition) {
    const normalized = normalizeConditionSnapshot(condition);
    if (normalized.profileId === "custom" && normalized.notes) return `Custom: ${normalized.notes.slice(0, 28)}`;
    return normalized.label.replace(" conditions", "");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
