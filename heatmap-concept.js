(function () {
  "use strict";

  const STATES = [
    "RI1", "RI2", "RI3", "RO1", "RO2", "RO3",
    "GI1", "GI2", "GI3", "GO1", "GO2", "GO3",
  ];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const STORAGE_KEY = "wro-fe-test-planner-v1";
  const Engine = window.WroPlannerEngine || null;
  const SECTIONS = ["A", "B", "C", "D"];
  const TAGS = ["late turn-in", "gate 3", "outer exit", "camera reacquire", "start drift", "parking follow-up"];
  const ISSUE_COLORS = ["#d41489", "#d91f2b", "#e87924", "#2367b1", "#146b5e"];
  const CONDITION_PROFILES = [
    { id: "normal", label: "Normal" },
    { id: "low-light", label: "Low light" },
    { id: "bright-light", label: "Bright light" },
    { id: "mixed-light", label: "Mixed light" },
    { id: "cold-field", label: "Cold field" },
    { id: "warm-field", label: "Warm field" },
    { id: "low-battery", label: "Low battery" },
    { id: "custom", label: "Custom" },
  ];

  const matrixEl = document.getElementById("transitionMatrix");
  const fieldMapEl = document.getElementById("fieldMap");
  const weakListEl = document.getElementById("weakList");
  const insightListEl = document.getElementById("insightList");
  const insightCountEl = document.getElementById("insightCount");
  const dataModePillEl = document.getElementById("dataModePill");
  const graphWindowPillEl = document.getElementById("graphWindowPill");
  const stabilityChartEl = document.getElementById("stabilityChart");
  const directionChartEl = document.getElementById("directionChart");
  const issueChartEl = document.getElementById("issueChart");
  const conditionChartEl = document.getElementById("conditionChart");
  const stabilityScoreEl = document.getElementById("stabilityScore");
  const directionScoreEl = document.getElementById("directionScore");
  const issueScoreEl = document.getElementById("issueScore");
  const conditionScoreEl = document.getElementById("conditionScore");
  const coverageScoreEl = document.getElementById("coverageScore");
  const transitionCountEl = document.getElementById("transitionCount");
  const weakCountEl = document.getElementById("weakCount");
  const issuePressureEl = document.getElementById("issuePressure");
  const selectedTitleEl = document.getElementById("selectedTitle");
  const selectedBadgeEl = document.getElementById("selectedBadge");
  const selectedAttemptsEl = document.getElementById("selectedAttempts");
  const selectedPassRateEl = document.getElementById("selectedPassRate");
  const selectedLastSeenEl = document.getElementById("selectedLastSeen");
  const selectedValueEl = document.getElementById("selectedValue");

  let activeDirection = "all";
  let selectedPair = ["RI1", "GO3"];

  document.querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      activeDirection = button.dataset.direction;
      document.querySelectorAll("[data-direction]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  function hash(value) {
    let total = 0;
    for (let i = 0; i < value.length; i += 1) total = (total * 33 + value.charCodeAt(i)) % 9973;
    return total;
  }

  function liveData() {
    const state = loadPlannerState();
    state.settings = Engine.normalizeSettings(state.settings);
    const records = (Array.isArray(state.records) ? state.records : [])
      .filter((record) => record && (record.result === "pass" || record.result === "issue"))
      .filter((record) => Engine.recordMatchesSettings(record, state.settings))
      .map((record) => normalizeRecord(record));
    const obstacleRecords = state.settings.raceMode === "obstacle" ? records : [];
    return {
      state,
      records,
      obstacleRecords,
      hasRecords: records.length > 0,
      timeline: liveTimeline(records),
      issueData: liveIssueData(records),
      conditionRows: liveConditionRows(records),
      directionRows: groupedRows(records, (record) => record.direction || "Unknown", ["CW", "CCW"]),
      startRows: groupedRows(obstacleRecords, (record) => startModeLabel(record.startMode), ["Parking start", "Zone start", "Opposite zone"]),
    };
  }

  function loadPlannerState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{\"records\":[]}");
    } catch (error) {
      return { records: [] };
    }
  }

  function normalizeCondition(condition) {
    const profile = conditionProfileById(condition && condition.profileId);
    return {
      profileId: profile.id,
      label: profile.label,
      notes: condition && typeof condition.notes === "string" ? condition.notes : "",
    };
  }

  function normalizeRecord(record) {
    const variant = parseVariant(record.variantKey);
    return Object.assign({}, record, {
      direction: variant.direction,
      startMode: variant.startMode,
      condition: normalizeCondition(record.condition),
    });
  }

  function parseVariant(key) {
    const [direction, startMode] = String(key || "").split(":");
    return { direction: direction || "Unknown", startMode: startMode || "unknown" };
  }

  function startModeLabel(mode) {
    if (mode === "parking") return "Parking start";
    if (mode === "zone") return "Zone start";
    if (mode === "opposite") return "Opposite zone";
    return mode || "Unknown";
  }

  function conditionProfileById(id) {
    return CONDITION_PROFILES.find((profile) => profile.id === id) || CONDITION_PROFILES[0];
  }

  function liveTimeline(records) {
    if (records.length < 1) return [];
    const recent = records.slice(-40);
    return recent.map((record, index) => {
      const windowRecords = recent.slice(Math.max(0, index - 7), index + 1);
      const passes = windowRecords.filter((item) => item.result === "pass").length;
      const issues = windowRecords.length - passes;
      return {
        passRate: Math.round((passes / windowRecords.length) * 100),
        issues,
      };
    });
  }

  function liveIssueData(records) {
    const counts = new Map();
    for (const record of records) {
      if (record.result !== "issue") continue;
      const tags = Array.isArray(record.failureTags) && record.failureTags.length ? record.failureTags : ["untagged"];
      for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, value]) => ({ label: failureTagLabel(tag), value }));
  }

  function liveConditionRows(records) {
    return groupedRows(records, (record) => record.condition.label, ["Normal"])
      .sort((a, b) => (a.label === "Normal" ? -1 : b.label === "Normal" ? 1 : b.attempts - a.attempts))
      .slice(0, 5);
  }

  function groupedRows(records, labelFor, preferredOrder) {
    const groups = new Map();
    for (const record of records) {
      const label = labelFor(record);
      const group = groups.get(label) || { label, attempts: 0, passes: 0, issues: 0 };
      group.attempts += 1;
      if (record.result === "pass") group.passes += 1;
      if (record.result === "issue") group.issues += 1;
      groups.set(label, group);
    }
    const order = new Map((preferredOrder || []).map((label, index) => [label, index]));
    return Array.from(groups.values())
      .map((group) => Object.assign(group, {
        passRate: group.attempts ? Math.round((group.passes / group.attempts) * 100) : 0,
        issueRate: group.attempts ? Math.round((group.issues / group.attempts) * 100) : 0,
      }))
      .sort((a, b) => {
        const aOrder = order.has(a.label) ? order.get(a.label) : 99;
        const bOrder = order.has(b.label) ? order.get(b.label) : 99;
        return aOrder - bOrder || b.attempts - a.attempts || a.label.localeCompare(b.label);
      });
  }

  function failureTagLabel(tag) {
    const labels = {
      "hit-red": "Hit red",
      "hit-green": "Hit green",
      "wrong-side": "Wrong side",
      "gate-drift": "Gate drift",
      "corner-exit": "Corner exit",
      "start-fail": "Start fail",
      "parking-fail": "Parking fail",
      "unpark-fail": "Unpark",
      localization: "Localization",
      "too-fast": "Too fast",
      "code-bug": "Code",
      untagged: "Untagged",
    };
    return labels[tag] || tag;
  }

  function stateParts(value) {
    return {
      color: value[0],
      band: value[1],
      gate: Number(value[2]),
    };
  }

  function scoreFor(from, to) {
    const a = stateParts(from);
    const b = stateParts(to);
    let score = 26 + (hash(`${activeDirection}:${from}:${to}`) % 69);
    if (a.color !== b.color) score += 7;
    if (a.band === b.band) score += 4;
    if (Math.abs(a.gate - b.gate) === 2) score -= 16;
    if (from.endsWith("3") || to.endsWith("3")) score -= 7;
    if (from === "RI1" && to === "GO3") score = 39;
    if (from === "GO3" && to === "RI1") score = 35;
    if (from === "RO2" && to === "GI3") score = 43;
    if (activeDirection === "cw") score += a.band === "I" ? 5 : -3;
    if (activeDirection === "ccw") score += b.band === "O" ? 6 : -2;
    if (activeDirection === "weak") score = Math.min(score, 58 - (hash(`${to}:${from}`) % 24));
    return Math.max(8, Math.min(100, score));
  }

  function attemptsFor(from, to) {
    return 2 + (hash(`${from}|${to}|attempts`) % 9);
  }

  function issuesFor(from, to, score) {
    const base = score < 45 ? 2 : score < 62 ? 1 : 0;
    return base + (hash(`${from}|${to}|issues`) % 2);
  }

  function lastSeenFor(from, to) {
    const seen = 1 + (hash(`${from}|${to}|seen`) % 18);
    return seen === 1 ? "1 run" : `${seen} runs`;
  }

  function cellColor(score) {
    if (score == null) return "#cad2d0";
    const hue = Math.round(score * 1.42);
    const lightness = score < 42 ? 39 : score > 78 ? 42 : 46;
    return `hsl(${hue} 68% ${lightness}%)`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function allPairs(live) {
    const observed = new Map();
    for (const record of fieldRecords(live)) {
      const config = Engine.parseConfigKey(record.layoutKey);
      const keys = new Set(Engine.directedObstaclePairs(config, record.direction).map((pair) => pair.join("|")));
      for (const key of keys) {
        const entry = observed.get(key) || { attempts: 0, issues: 0 };
        entry.attempts += 1;
        entry.issues += Number(record.result === "issue");
        entry.lastSeen = record.createdAt;
        observed.set(key, entry);
      }
    }
    const pairs = [];
    for (const from of STATES) {
      for (const to of STATES) {
        if (live.hasRecords) {
          const entry = observed.get(`${from}|${to}`) || { attempts: 0, issues: 0 };
          const score = entry.attempts ? Math.round(100 * (entry.attempts - entry.issues) / entry.attempts) : null;
          pairs.push({ ...entry, from, to, score, passRate: score, value: entry.issues ? "Retest" : entry.attempts ? "Observed" : "Untested" });
          continue;
        }
        const score = scoreFor(from, to);
        const attempts = attemptsFor(from, to);
        const issues = issuesFor(from, to, score);
        pairs.push({
          from,
          to,
          score,
          attempts,
          issues,
          passRate: Math.max(8, Math.min(99, score - issues * 7 + (hash(`${to}${from}`) % 9))),
          value: score < 50 || issues > 2 ? "High" : score < 70 ? "Medium" : "Stable",
        });
      }
    }
    return pairs;
  }

  function fieldRecords(live) {
    return live.obstacleRecords.filter((record) => (activeDirection === "all") ||
      (activeDirection === "weak" ? record.result === "issue" : record.direction.toLowerCase() === activeDirection));
  }

  function renderMatrix(pairs) {
    const grid = document.createElement("div");
    grid.className = "matrix-grid";
    grid.appendChild(axisCell("From", "corner"));
    for (const state of STATES) grid.appendChild(axisCell(state));

    for (const from of STATES) {
      grid.appendChild(axisCell(from, "row-axis"));
      for (const to of STATES) {
        const pair = pairs.find((item) => item.from === from && item.to === to);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = [
          "matrix-cell",
          pair.score != null && pair.score < 42 ? "low" : "",
          pair.issues > 1 ? "issue" : "",
          selectedPair[0] === from && selectedPair[1] === to ? "active" : "",
        ].filter(Boolean).join(" ");
        cell.style.setProperty("--cell-color", cellColor(pair.score));
        cell.setAttribute("aria-label", `${from} to ${to}: ${pair.score == null ? "untested" : `${pair.score} percent`}`);
        cell.innerHTML = `<span>${pair.score ?? "—"}</span>`;
        cell.addEventListener("click", () => {
          selectedPair = [from, to];
          render();
        });
        grid.appendChild(cell);
      }
    }

    matrixEl.replaceChildren(grid);
  }

  function axisCell(text, extraClass) {
    const cell = document.createElement("div");
    cell.className = ["axis-cell", extraClass || ""].filter(Boolean).join(" ");
    cell.textContent = text;
    return cell;
  }

  function renderFieldMap(live) {
    const observed = new Map();
    for (const record of fieldRecords(live)) {
      const config = Engine.parseConfigKey(record.layoutKey);
      for (const section of SECTIONS) {
        const ids = [section, ...Engine.sectionSigns(config, section).map((item) => `${section}${item.band}${item.gate}`)];
        for (const id of ids) {
          const stats = observed.get(id) || { passes: 0, total: 0 };
          stats.passes += Number(record.result === "pass");
          stats.total += 1;
          observed.set(id, stats);
        }
      }
    }
    const getScore = (id, sample) => {
      if (!live.hasRecords) return sample;
      const stats = observed.get(id);
      return stats ? Math.round(100 * stats.passes / stats.total) : null;
    };
    fieldMapEl.setAttribute("aria-label", live.hasRecords ? "Run outcomes by sign position" : "Simulated field heatmap");
    fieldMapEl.replaceChildren();
    fieldMapEl.appendChild(div("guide-ring"));
    for (const item of [
      ["top", "C"], ["right", "D"], ["bottom", "A"], ["left", "B"],
    ]) {
      const avg = getScore(item[1], sectionAverage(item[1]));
      const band = div(`heat-band ${item[0]}`);
      band.style.setProperty("--band-color", cellColor(avg));
      fieldMapEl.appendChild(band);
    }
    for (const section of SECTIONS) {
      const label = div(`field-label ${section.toLowerCase()}`);
      label.textContent = live.state.settings.ruleset === "german" && section === "A" ? "A start" : section;
      fieldMapEl.appendChild(label);
    }

    for (const point of fieldPoints()) {
      const node = div(`hotspot ${point.band === "O" ? "square" : ""}`);
      node.style.left = `${point.x}%`;
      node.style.top = `${point.y}%`;
      const score = getScore(`${point.section}${point.band}${point.gate}`, point.score);
      node.style.setProperty("--cell-color", cellColor(score));
      node.title = `${point.section} ${point.band}${point.gate}: ${score == null ? "untested" : `${score}%`}`;
      fieldMapEl.appendChild(node);
    }
    const stamp = div("simulated-stamp");
    stamp.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = "SIMULATED";
    stamp.appendChild(label);
    fieldMapEl.appendChild(stamp);
  }

  function sectionAverage(section) {
    let total = 0;
    for (let gate = 1; gate <= 3; gate += 1) {
      total += 44 + (hash(`${activeDirection}:${section}:${gate}`) % 49);
    }
    if (section === "A") total -= 18;
    if (section === "C") total += 8;
    return Math.max(10, Math.min(100, Math.round(total / 3)));
  }

  function fieldPoints() {
    const points = [];
    const xs = [32, 47, 62];
    const ys = [32, 47, 62];
    for (let gate = 1; gate <= 3; gate += 1) {
      points.push(slot("C", "I", gate, xs[gate - 1], 24));
      points.push(slot("C", "O", gate, xs[gate - 1], 13));
      points.push(slot("A", "I", gate, xs[3 - gate], 66));
      points.push(slot("A", "O", gate, xs[3 - gate], 78));
      points.push(slot("B", "I", gate, 24, ys[3 - gate]));
      points.push(slot("B", "O", gate, 13, ys[3 - gate]));
      points.push(slot("D", "I", gate, 66, ys[gate - 1]));
      points.push(slot("D", "O", gate, 78, ys[gate - 1]));
    }
    return points;
  }

  function slot(section, band, gate, x, y) {
    const score = Math.max(12, Math.min(100, 34 + (hash(`${activeDirection}:${section}:${band}:${gate}`) % 64) - (gate === 3 ? 10 : 0)));
    return { section, band, gate, x, y, score };
  }

  function renderSelected(pairs, live) {
    const pair = pairs.find((item) => item.from === selectedPair[0] && item.to === selectedPair[1]) || pairs[0];
    selectedTitleEl.textContent = `${pair.from} -> ${pair.to}`;
    const risk = pair.score != null && (pair.score < 55 || pair.issues > 1);
    selectedBadgeEl.textContent = pair.score == null ? "Untested" : risk ? "Risk" : "Observed";
    selectedBadgeEl.classList.toggle("issue", risk);
    selectedAttemptsEl.textContent = String(pair.attempts);
    selectedPassRateEl.textContent = pair.passRate == null ? "—" : `${pair.passRate}%`;
    selectedLastSeenEl.textContent = live.hasRecords ? pair.lastSeen ? new Date(pair.lastSeen).toLocaleDateString() : "—"
      : pair.score > 80 ? "fresh" : lastSeenFor(pair.from, pair.to);
    selectedValueEl.textContent = pair.value;
  }

  function renderWeakList(pairs, live) {
    const weak = pairs
      .filter((pair) => !live.hasRecords || pair.issues > 0)
      .sort((a, b) => riskScore(b) - riskScore(a))
      .slice(0, 5);
    weakListEl.replaceChildren(...weak.map((pair) => {
      const card = document.createElement("article");
      card.className = "weak-card";
      const tagA = TAGS[hash(pair.from + pair.to) % TAGS.length];
      const tagB = TAGS[hash(pair.to + pair.from + activeDirection) % TAGS.length];
      card.innerHTML = `
        <div>
          <strong>${pair.from} -> ${pair.to}</strong>
          <span>${pair.attempts} attempts, ${pair.passRate}% pass rate</span>
          ${live.hasRecords ? "" : `<div class="tag-row"><span class="tag">${tagA}</span><span class="tag">${tagB}</span></div>`}
        </div>
        <div class="risk">${Math.round(riskScore(pair))}</div>
      `;
      card.addEventListener("click", () => {
        selectedPair = [pair.from, pair.to];
        render();
      });
      return card;
    }));
  }

  function riskScore(pair) {
    return 100 - pair.score + pair.issues * 11 + (pair.value === "High" ? 12 : 0);
  }

  function analyticalInsights(live) {
    if (!live.hasRecords) {
      return [{
        kind: "empty",
        title: "Data readiness",
        delta: "0 runs",
        body: "No local run data yet. Complete or mark issues on a few runs in the test suite to unlock concrete comparisons.",
        meta: "Recommended minimum: 3 attempts per category before trusting a percentage.",
        action: "Run both directions and at least one parking start under normal conditions first.",
      }];
    }

    const insights = [];
    addComparisonInsight(insights, {
      title: "Direction reliability",
      rows: live.directionRows,
      aLabel: "CW",
      bLabel: "CCW",
      minAttempts: 2,
      neutralTitle: "Direction comparison needs more balance",
      action: "Run the weaker or under-sampled direction next so the comparison is not distorted by sample size.",
      strongerText: (stronger, weaker, diff) => `Your robot is ${diff} percentage points more reliable in ${stronger.label} than ${weaker.label} (${stronger.passRate}% vs ${weaker.passRate}%).`,
      weakerAction: (stronger, weaker) => `Prioritize ${weaker.label} retests until its pass rate closes the gap or the issue tags show one dominant cause.`,
    });
    addComparisonInsight(insights, {
      title: "Start-mode cost",
      rows: live.startRows,
      aLabel: "Parking start",
      bLabel: "Zone start",
      minAttempts: 2,
      neutralTitle: "Parking impact needs more data",
      action: "Collect paired parking and zone-start attempts on similar layouts before treating this as a real effect.",
      strongerText: (stronger, weaker, diff) => {
        if (weaker.label === "Parking start") {
          return `Parking currently costs ${diff} reliability points compared with zone starts (${weaker.passRate}% vs ${stronger.passRate}%).`;
        }
        return `${stronger.label} is ${diff} points more reliable than ${weaker.label} (${stronger.passRate}% vs ${weaker.passRate}%).`;
      },
      weakerAction: (stronger, weaker) => weaker.label === "Parking start"
        ? "Treat unpark alignment and parking exit localization as the next focused test topic."
        : `Retest ${weaker.label.toLowerCase()} starts with the same first two sections to isolate the start behavior.`,
    });
    addConditionInsight(insights, live.conditionRows);
    addFailureInsight(insights, live.issueData, live.records);
    addWeakTargetInsight(insights, live);
    addSampleBalanceInsight(insights, live);

    return insights.slice(0, 6);
  }

  function addComparisonInsight(insights, options) {
    const first = options.rows.find((row) => row.label === options.aLabel);
    const second = options.rows.find((row) => row.label === options.bLabel);
    if (!first || !second || first.attempts < options.minAttempts || second.attempts < options.minAttempts) {
      insights.push({
        kind: "warning",
        title: options.neutralTitle,
        delta: "sample",
        body: sampleBody(options.aLabel, first, options.bLabel, second, options.minAttempts),
        meta: "The tool will produce a real delta once both sides have enough attempts.",
        action: options.action,
      });
      return;
    }
    const stronger = first.passRate >= second.passRate ? first : second;
    const weaker = stronger === first ? second : first;
    const diff = Math.abs(first.passRate - second.passRate);
    const kind = diff >= 10 ? "risk" : diff >= 5 ? "warning" : "good";
    insights.push({
      kind,
      title: diff >= 4 ? options.title : `${options.title}: currently balanced`,
      delta: diff >= 4 ? `${diff} pts` : "<4 pts",
      body: diff >= 4
        ? options.strongerText(stronger, weaker, diff)
        : `${first.label} and ${second.label} are close right now (${first.passRate}% vs ${second.passRate}%).`,
      meta: `${first.label}: ${first.passes}/${first.attempts} pass. ${second.label}: ${second.passes}/${second.attempts} pass.`,
      action: diff >= 4 ? options.weakerAction(stronger, weaker) : "Keep alternating both categories to prevent the sample from drifting.",
    });
  }

  function sampleBody(aLabel, first, bLabel, second, minAttempts) {
    const aAttempts = first ? first.attempts : 0;
    const bAttempts = second ? second.attempts : 0;
    return `${aLabel} has ${aAttempts}/${minAttempts} useful attempts and ${bLabel} has ${bAttempts}/${minAttempts}.`;
  }

  function addConditionInsight(insights, rows) {
    const normal = rows.find((row) => row.label === "Normal");
    const specials = rows.filter((row) => row.label !== "Normal");
    if (!normal || normal.attempts < 3 || specials.every((row) => row.attempts < 2)) {
      insights.push({
        kind: "warning",
        title: "Special-condition comparison is not mature yet",
        delta: "sample",
        body: "Normal conditions and at least one special profile need repeated attempts before the comparison is meaningful.",
        meta: normal ? `Normal baseline: ${normal.passes}/${normal.attempts} pass.` : "No normal baseline recorded yet.",
        action: "Record at least 3 normal runs and 2 runs under one special condition such as low light or low battery.",
      });
      return;
    }
    const ranked = specials.filter((row) => row.attempts >= 2)
      .map((row) => Object.assign({}, row, { delta: row.passRate - normal.passRate }))
      .sort((a, b) => a.delta - b.delta);
    const weakest = ranked[0];
    const diff = Math.abs(weakest.delta);
    insights.push({
      kind: weakest.delta < -8 ? "risk" : weakest.delta < -4 ? "warning" : "good",
      title: "Condition sensitivity",
      delta: `${weakest.delta >= 0 ? "+" : "-"}${diff} pts`,
      body: weakest.delta < 0
        ? `${weakest.label} is ${diff} reliability points below normal conditions (${weakest.passRate}% vs ${normal.passRate}%).`
        : `${weakest.label} is not worse than normal in the current sample (${weakest.passRate}% vs ${normal.passRate}%).`,
      meta: `Normal: ${normal.passes}/${normal.attempts} pass. ${weakest.label}: ${weakest.passes}/${weakest.attempts} pass.`,
      action: weakest.delta < 0
        ? `Repeat the next weak layout once under normal and once under ${weakest.label.toLowerCase()} to isolate the cause.`
        : "Keep logging condition profiles so subtle camera and traction effects can show up over time.",
    });
  }

  function addFailureInsight(insights, issueData, records) {
    const issues = records.filter((record) => record.result === "issue").length;
    if (issues === 0) {
      insights.push({
        kind: "good",
        title: "No failure tags recorded",
        delta: "clean",
        body: "There are no issue-tag patterns yet. That can be good, but it also means the analytics cannot tell which failure class to attack first.",
        meta: `${records.length} attempts, 0 issue logs.`,
        action: "When a run fails, use the issue tags instead of skip so the recommendation model has a cause to track.",
      });
      return;
    }
    const top = issueData[0];
    const share = Math.round((top.value / issues) * 100);
    insights.push({
      kind: share >= 45 ? "risk" : "warning",
      title: "Dominant failure class",
      delta: `${share}%`,
      body: `${top.label} accounts for ${share}% of tagged issue pressure (${top.value} of ${issues} issue logs).`,
      meta: "This is usually more actionable than raw pass rate because it points to a subsystem.",
      action: failureAction(top.label),
    });
  }

  function failureAction(label) {
    const lower = label.toLowerCase();
    if (lower.includes("unpark")) return "Make an unpark-only micro-test: same parking setup, repeated exits, no full lap required.";
    if (lower.includes("wrong side")) return "Review obstacle side classification and line-side decision thresholds before adding speed.";
    if (lower.includes("gate")) return "Retest the same obstacle at gate 1, 2, and 3 to separate localization from path planning.";
    if (lower.includes("parking")) return "Separate parking approach reliability from unpark exit reliability in your next session.";
    if (lower.includes("localization")) return "Log lighting and start position with each attempt; localization issues often hide in condition changes.";
    return "Use the next retest to reproduce this tag intentionally, then adjust one subsystem at a time.";
  }

  function addWeakTargetInsight(insights, live) {
    if (!Engine || !Engine.weakAtomStats) return;
    const settings = live.state.settings || {};
    const weak = Engine.weakAtomStats(live.state.records || [], settings);
    if (weak.size === 0) return;
    const item = Array.from(weak.entries()).sort((a, b) => {
      const aStats = a[1];
      const bStats = b[1];
      return bStats.issues / Math.max(1, bStats.attempts) - aStats.issues / Math.max(1, aStats.attempts);
    })[0];
    const atom = item[0];
    const stats = item[1];
    const label = Engine.atomLabel ? Engine.atomLabel(atom) : atom;
    insights.push({
      kind: "risk",
      title: "Weak target ready for retest",
      delta: `${stats.issues}/${stats.attempts}`,
      body: `${label} has unresolved issue pressure and should be pulled into the next focused retest cycle.`,
      meta: `Issue rate: ${Math.round((stats.issues / Math.max(1, stats.attempts)) * 100)}%.`,
      action: "Use the planner's next weakness-retest setup instead of starting a fresh broad coverage run.",
    });
  }

  function addSampleBalanceInsight(insights, live) {
    const attempts = live.records.length;
    if (attempts >= 12) return;
    insights.push({
      kind: "empty",
      title: "Confidence is still limited",
      delta: `${attempts}/12`,
      body: "The recommendations above are early signals, not final conclusions. Percentages move a lot with small samples.",
      meta: "Twelve marked attempts is a practical minimum for the dashboard to become stable.",
      action: "Keep using pass/issue instead of complete-only when you want the analytics to learn faster.",
    });
  }

  function renderInsights(live) {
    if (!insightListEl) return;
    const insights = analyticalInsights(live);
    const activeCount = insights.filter((item) => item.kind !== "empty").length;
    if (insightCountEl) insightCountEl.textContent = `${activeCount} signals`;
    insightListEl.replaceChildren(...insights.map((item) => {
      const card = document.createElement("article");
      card.className = `insight-card ${item.kind || ""}`.trim();
      card.innerHTML = `
        <div class="insight-category">${escapeHtml(insightCategory(item))}</div>
        <h3 class="insight-title">${escapeHtml(item.body)}</h3>
        <div class="insight-evidence">${escapeHtml(item.meta)}</div>
        <div class="insight-action">${escapeHtml(item.action)}</div>
      `;
      return card;
    }));
  }

  function insightCategory(item) {
    const title = (item.title || "").toLowerCase();
    if (title.includes("direction")) return "Direction";
    if (title.includes("parking") || title.includes("start")) return "Start mode";
    if (title.includes("condition")) return "Conditions";
    if (title.includes("failure")) return "Failure tags";
    if (title.includes("target") || title.includes("retest")) return "Retest focus";
    if (title.includes("confidence") || title.includes("data")) return "Confidence";
    return "Signal";
  }

  function renderSummary(pairs, live) {
    if (dataModePillEl) dataModePillEl.textContent = live.hasRecords ? "Live local data" : "Simulated data";
    if (graphWindowPillEl) {
      const localWindow = Math.min(live.records.length, 40);
      graphWindowPillEl.textContent = live.hasRecords ? `Last ${localWindow} local ${localWindow === 1 ? "run" : "runs"}` : "Simulated example";
    }
    document.body.classList.toggle("simulated-analytics", !live.hasRecords);
    document.body.classList.toggle("live-analytics", live.hasRecords);
    if (live.hasRecords) {
      const attempts = live.records.length;
      const issues = live.records.filter((record) => record.result === "issue").length;
      const passes = attempts - issues;
      const passRate = attempts ? Math.round((passes / attempts) * 100) : 0;
      const conditionCount = live.conditionRows.filter((row) => row.label !== "Normal").length;
      coverageScoreEl.textContent = `${passRate}%`;
      transitionCountEl.textContent = `${attempts} runs`;
      weakCountEl.textContent = String(conditionCount);
      const issuePercent = attempts ? Math.round((issues / attempts) * 100) : 0;
      issuePressureEl.textContent = `${issuePercent}%`;
      updateOverviewMeters([
        passRate,
        Math.min(100, Math.round((attempts / 40) * 100)),
        Math.min(100, conditionCount * 18),
        issuePercent,
      ]);
      return;
    }
    const simulated = simulatedOverview();
    coverageScoreEl.textContent = `${simulated.reliability}%`;
    transitionCountEl.textContent = simulated.transitions;
    weakCountEl.textContent = String(simulated.weakClusters);
    issuePressureEl.textContent = `${simulated.issuePressure}%`;
    updateOverviewMeters([
      simulated.reliability,
      simulated.transitionProgress,
      simulated.weakPressure,
      simulated.issuePressure,
    ]);
  }

  function updateOverviewMeters(widths) {
    document.querySelectorAll(".overview-grid .meter span").forEach((node, index) => {
      node.style.width = `${clamp(widths[index] || 0, 0, 100)}%`;
    });
  }

  function simulatedOverview() {
    if (activeDirection === "weak") {
      return { reliability: 86, transitions: "118/144", transitionProgress: 82, weakClusters: 12, weakPressure: 31, issuePressure: 13 };
    }
    if (activeDirection === "ccw") {
      return { reliability: 95, transitions: "132/144", transitionProgress: 92, weakClusters: 5, weakPressure: 14, issuePressure: 6 };
    }
    if (activeDirection === "cw") {
      return { reliability: 96, transitions: "134/144", transitionProgress: 93, weakClusters: 4, weakPressure: 12, issuePressure: 5 };
    }
    return { reliability: 94, transitions: "132/144", transitionProgress: 92, weakClusters: 6, weakPressure: 16, issuePressure: 7 };
  }

  function renderGraphs(pairs, live) {
    renderStabilityGraph(live);
    renderDirectionGraph(pairs, live);
    renderIssueGraph(live);
    renderConditionGraph(live);
  }

  function renderStabilityGraph(live) {
    if (!stabilityChartEl) return;
    const data = live.hasRecords ? live.timeline : timelineData();
    const margin = { left: 44, right: 18, top: 18, bottom: 34 };
    const width = 640;
    const height = 230;
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const bottom = margin.top + chartHeight;
    const yMin = live.hasRecords && data.some((item) => item.passRate < 50) ? 0 : 50;
    const xFor = (index) => data.length === 1 ? margin.left + chartWidth / 2 : margin.left + (index / (data.length - 1)) * chartWidth;
    const yFor = (value) => margin.top + ((100 - clamp(value, yMin, 100)) / (100 - yMin)) * chartHeight;
    const points = data.map((item, index) => ({ x: xFor(index), y: yFor(item.passRate), item }));
    const recent = data.slice(-10);
    const recentAverage = Math.round(recent.reduce((sum, item) => sum + item.passRate, 0) / recent.length);
    stabilityScoreEl.textContent = `${recentAverage}%`;

    stabilityChartEl.replaceChildren();
    for (const tick of yMin === 0 ? [0, 50, 85, 100] : [50, 65, 85, 100]) {
      const y = yFor(tick);
      stabilityChartEl.appendChild(svgEl("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "chart-grid-line" }));
      stabilityChartEl.appendChild(svgEl("text", { x: 12, y: y + 4, class: "chart-axis" }, `${tick}%`));
    }
    const xTicks = data.length >= 40 ? [0, 9, 19, 29, 39] : data.length === 1 ? [0] : [0, Math.floor((data.length - 1) / 2), data.length - 1];
    for (const index of Array.from(new Set(xTicks))) {
      const x = xFor(index);
      stabilityChartEl.appendChild(svgEl("text", { x, y: height - 8, class: "chart-axis", "text-anchor": "middle" }, `R${index + 1}`));
    }
    for (const point of points) {
      const barHeight = point.item.issues * 7;
      stabilityChartEl.appendChild(svgEl("rect", {
        x: point.x - 1.5,
        y: bottom - barHeight,
        width: 3,
        height: barHeight,
        rx: 1.5,
        class: "issue-bar",
      }));
    }
    stabilityChartEl.appendChild(svgEl("path", { d: areaPath(points, bottom), class: "trend-area" }));
    stabilityChartEl.appendChild(svgEl("line", {
      x1: margin.left,
      y1: yFor(85),
      x2: width - margin.right,
      y2: yFor(85),
      class: "target-line",
    }));
    stabilityChartEl.appendChild(svgEl("path", { d: linePath(points), class: "trend-line" }));
    const dotIndexes = data.length >= 40 ? [0, 10, 20, 30, 39] : [0, data.length - 1];
    for (const index of Array.from(new Set(dotIndexes))) {
      const point = points[index];
      stabilityChartEl.appendChild(svgEl("circle", { cx: point.x, cy: point.y, r: 3, class: "chart-dot" }));
    }
  }

  function timelineData() {
    const offset = activeDirection === "cw" ? 4 : activeDirection === "ccw" ? 9 : activeDirection === "weak" ? 14 : 1;
    return Array.from({ length: 40 }, (_, index) => {
      const progress = index / 39;
      const start = activeDirection === "weak" ? 54 : activeDirection === "ccw" ? 62 : 66;
      const finish = activeDirection === "weak" ? 89 : activeDirection === "ccw" ? 96 : activeDirection === "cw" ? 98 : 97;
      const learningCurve = start + (finish - start) * (1 - Math.pow(1 - progress, 1.62));
      const wave = Math.sin((index + offset) / 3.8) * 1.6 + Math.cos((index + offset) / 6.6) * 0.8;
      const earlyDip = index === 6 || index === 14 || index === 23 ? -5 : 0;
      const weakDip = activeDirection === "weak" && (index === 18 || index === 29) ? -8 : 0;
      const passRate = Math.round(clamp(learningCurve + wave + earlyDip + weakDip, 42, 99));
      const incidentPressure = earlyDip || weakDip ? 1 : 0;
      const learningPressure = index < 16 ? 1 : 0;
      const settledBonus = progress > 0.72 ? -1 : 0;
      const issues = clamp(Math.round((100 - passRate) / 30 + incidentPressure + learningPressure + settledBonus), 0, 4);
      return { passRate, issues };
    });
  }

  function renderDirectionGraph(pairs, live) {
    if (!directionChartEl) return;
    const rows = live.hasRecords ? liveComparisonRows(live) : simulatedDirectionRows();
    const scoredRows = rows.filter((row) => typeof row.score === "number");
    const best = scoredRows.reduce((winner, row) => row.score > winner.score ? row : winner, scoredRows[0] || null);
    directionScoreEl.textContent = best ? `${best.label} ${best.score}%` : "No local data";
    directionChartEl.replaceChildren();
    const chart = { x: 104, y: 30, width: 218, row: 40, height: 8, valueX: 402 };
    rows.forEach((row, index) => {
      const y = chart.y + index * chart.row;
      const barY = y + 5;
      const issueWidth = row.issue > 0 ? Math.max(2, Math.round(row.issue * 0.9)) : 0;
      const valueWidth = typeof row.score === "number" ? Math.round(chart.width * row.score / 100) : 0;
      directionChartEl.appendChild(svgEl("text", { x: 14, y: y + 12, class: "chart-axis" }, row.label));
      directionChartEl.appendChild(svgEl("rect", { x: chart.x, y: barY, width: chart.width, height: chart.height, rx: 4, class: "direction-bar-bg" }));
      if (valueWidth > 0) {
        directionChartEl.appendChild(svgEl("rect", {
          x: chart.x,
          y: barY,
          width: valueWidth,
          height: chart.height,
          rx: 4,
          class: "direction-bar",
        }));
      }
      if (issueWidth > 0) {
        directionChartEl.appendChild(svgEl("rect", {
          x: chart.x + chart.width - issueWidth,
          y: barY,
          width: issueWidth,
          height: chart.height,
          rx: 4,
          class: "direction-issue",
        }));
      }
      directionChartEl.appendChild(svgEl("text", { x: chart.valueX, y: y + 12, class: "chart-axis", "text-anchor": "end" }, typeof row.score === "number" ? `${row.score}%` : "no data"));
    });
    directionChartEl.appendChild(svgEl("text", { x: chart.x, y: 208, class: "chart-axis" }, "Pass rate line; red marker = issue rate"));
  }

  function directionalScore(pairs, label, salt) {
    const base = Math.round(pairs.reduce((sum, pair) => sum + pair.passRate, 0) / pairs.length);
    const bias = (hash(`${activeDirection}:${label}:${salt}`) % 23) - 9;
    const weakPenalty = activeDirection === "weak" ? -10 : 0;
    return Math.round(clamp(base + bias + weakPenalty, 42, 97));
  }

  function simulatedDirectionRows() {
    if (activeDirection === "weak") {
      return [
        { label: "CW", score: 86, issue: 7 },
        { label: "CCW", score: 83, issue: 8 },
        { label: "Zone", score: 90, issue: 5 },
        { label: "Parking", score: 79, issue: 10 },
      ];
    }
    if (activeDirection === "cw") {
      return [
        { label: "CW", score: 98, issue: 1 },
        { label: "CCW", score: 94, issue: 3 },
        { label: "Zone", score: 97, issue: 1 },
        { label: "Parking", score: 93, issue: 4 },
      ];
    }
    if (activeDirection === "ccw") {
      return [
        { label: "CW", score: 95, issue: 3 },
        { label: "CCW", score: 97, issue: 2 },
        { label: "Zone", score: 96, issue: 2 },
        { label: "Parking", score: 92, issue: 5 },
      ];
    }
    return [
      { label: "CW", score: 96, issue: 2 },
      { label: "CCW", score: 94, issue: 3 },
      { label: "Zone", score: 97, issue: 1 },
      { label: "Parking", score: 91, issue: 5 },
    ];
  }

  function liveComparisonRows(live) {
    const rowFor = (rows, label) => rows.find((row) => row.label === label);
    const toChartRow = (label, row) => ({
      label,
      score: row ? row.passRate : null,
      issue: row ? row.issueRate / 2 : 0,
    });
    return [
      toChartRow("CW", rowFor(live.directionRows, "CW")),
      toChartRow("CCW", rowFor(live.directionRows, "CCW")),
      toChartRow("Zone", rowFor(live.startRows, "Zone start")),
      toChartRow("Parking", rowFor(live.startRows, "Parking start")),
    ];
  }

  function renderIssueGraph(live) {
    if (!issueChartEl) return;
    const data = live.hasRecords ? (live.issueData.length ? live.issueData : [{ label: "No issues", value: 1, empty: true }]) : issueData();
    const total = data.reduce((sum, item) => sum + item.value, 0);
    const max = Math.max(...data.map((item) => item.value));
    issueScoreEl.textContent = live.hasRecords && data[0].empty ? "0 tags" : `${total} tags`;
    issueChartEl.replaceChildren();

    let angle = -90;
    data.forEach((item, index) => {
      const sweep = (item.value / total) * 360;
      issueChartEl.appendChild(svgEl("path", {
        d: donutPath(94, 104, 64, 50, angle, angle + sweep),
        fill: item.empty ? "#d9e1de" : ISSUE_COLORS[index % ISSUE_COLORS.length],
        class: "issue-slice",
      }));
      angle += sweep;
    });
    issueChartEl.appendChild(svgEl("text", { x: 94, y: 99, class: "chart-axis", "text-anchor": "middle" }, "issues"));
    issueChartEl.appendChild(svgEl("text", { x: 94, y: 121, class: "chart-axis", "text-anchor": "middle" }, `${total}`));

    data.forEach((item, index) => {
      const y = 42 + index * 31;
      const color = item.empty ? "#d9e1de" : ISSUE_COLORS[index % ISSUE_COLORS.length];
      issueChartEl.appendChild(svgEl("rect", { x: 198, y: y - 8, width: 9, height: 9, rx: 2, fill: color }));
      issueChartEl.appendChild(svgEl("text", { x: 218, y: y + 1, class: "chart-axis" }, item.label));
      issueChartEl.appendChild(svgEl("rect", { x: 304, y: y - 6, width: 82, height: 5, rx: 2.5, class: "direction-bar-bg" }));
      issueChartEl.appendChild(svgEl("rect", {
        x: 304,
        y: y - 6,
        width: Math.round((item.value / max) * 82),
        height: 5,
        rx: 2.5,
        fill: color,
      }));
      issueChartEl.appendChild(svgEl("text", { x: 402, y: y + 1, class: "chart-axis", "text-anchor": "end" }, String(item.value)));
    });
  }

  function issueData() {
    const labels = ["Unpark", "Wrong side", "Gate drift", "Parking", "Localization"];
    return labels.map((label, index) => {
      const weakBoost = activeDirection === "weak" && index < 3 ? 2 : 0;
      return { label, value: 1 + weakBoost + (hash(`${activeDirection}:${label}`) % 5) };
    });
  }

  function renderConditionGraph(live) {
    if (!conditionChartEl) return;
    const rows = live.conditionRows.length ? live.conditionRows : simulatedConditionRows();
    const normal = rows.find((row) => row.label === "Normal") || rows[0];
    const weakest = rows.slice().sort((a, b) => a.passRate - b.passRate)[0];
    conditionScoreEl.textContent = live.hasRecords && weakest && normal && weakest.label !== normal.label
      ? `${weakest.label} ${normal.passRate - weakest.passRate >= 0 ? "-" : "+"}${Math.abs(normal.passRate - weakest.passRate)}`
      : `${normal.passRate}% normal`;
    conditionChartEl.replaceChildren();
    const chart = { x: 132, y: 30, width: 196, row: 34, height: 8, valueX: 402 };
    rows.forEach((row, index) => {
      const y = chart.y + index * chart.row;
      const barY = y + 5;
      const issueWidth = row.attempts && row.issues ? Math.max(2, Math.round((row.issues / row.attempts) * 34)) : 0;
      conditionChartEl.appendChild(svgEl("text", { x: 14, y: y + 12, class: "chart-axis" }, row.label.slice(0, 15)));
      conditionChartEl.appendChild(svgEl("rect", { x: chart.x, y: barY, width: chart.width, height: chart.height, rx: 4, class: "direction-bar-bg" }));
      conditionChartEl.appendChild(svgEl("rect", {
        x: chart.x,
        y: barY,
        width: Math.round(chart.width * row.passRate / 100),
        height: chart.height,
        rx: 4,
        class: `direction-bar ${row.passRate >= 85 ? "good" : ""}`,
      }));
      if (issueWidth > 0) {
        conditionChartEl.appendChild(svgEl("rect", {
          x: chart.x + chart.width - issueWidth,
          y: barY,
          width: issueWidth,
          height: chart.height,
          rx: 4,
          class: "direction-issue",
        }));
      }
      conditionChartEl.appendChild(svgEl("text", { x: chart.valueX, y: y + 12, class: "chart-axis", "text-anchor": "end" }, `${row.passRate}%`));
    });
    conditionChartEl.appendChild(svgEl("text", { x: chart.x, y: 208, class: "chart-axis" }, live.hasRecords ? "Local pass rates by condition profile" : "Example comparison until local data exists"));
  }

  function simulatedConditionRows() {
    return [
      { label: "Normal", attempts: 18, passes: 17, issues: 1, passRate: 97 },
      { label: "Low light", attempts: 8, passes: 7, issues: 1, passRate: 90 },
      { label: "Warm field", attempts: 10, passes: 9, issues: 1, passRate: 95 },
      { label: "Low battery", attempts: 6, passes: 5, issues: 1, passRate: 84 },
    ];
  }

  function svgEl(name, attrs, text) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function linePath(points) {
    if (points.length === 1) {
      const point = points[0];
      return `M ${(point.x - 8).toFixed(1)} ${point.y.toFixed(1)} L ${(point.x + 8).toFixed(1)} ${point.y.toFixed(1)}`;
    }
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  }

  function areaPath(points, bottom) {
    if (points.length === 1) {
      const point = points[0];
      return [
        `M ${(point.x - 8).toFixed(1)} ${point.y.toFixed(1)}`,
        `L ${(point.x + 8).toFixed(1)} ${point.y.toFixed(1)}`,
        `L ${(point.x + 8).toFixed(1)} ${bottom}`,
        `L ${(point.x - 8).toFixed(1)} ${bottom}`,
        "Z",
      ].join(" ");
    }
    return `${linePath(points)} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`;
  }

  function polar(cx, cy, radius, angle) {
    const radians = (angle - 90) * Math.PI / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  }

  function donutPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const outerStart = polar(cx, cy, outerRadius, endAngle);
    const outerEnd = polar(cx, cy, outerRadius, startAngle);
    const innerStart = polar(cx, cy, innerRadius, startAngle);
    const innerEnd = polar(cx, cy, innerRadius, endAngle);
    return [
      `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
      `L ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  }

  function div(className) {
    const node = document.createElement("div");
    node.className = className;
    return node;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    const live = liveData();
    const pairs = allPairs(live);
    renderSummary(pairs, live);
    renderInsights(live);
    renderMatrix(pairs);
    renderFieldMap(live);
    renderSelected(pairs, live);
    renderWeakList(pairs, live);
    renderGraphs(pairs, live);
  }

  render();
})();
