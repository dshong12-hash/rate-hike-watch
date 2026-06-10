const STORAGE_KEY = "rate-hike-watch.v1";
const HISTORY_KEY = "rate-hike-watch.history.v1";

const fredSeries = {
  DFEDTARU: "정책금리 상단",
  DGS2: "미국 2년물",
  DGS10: "미국 10년물",
  T10YIE: "10년 기대인플레",
  CPIAUCSL: "CPI",
  PCEPILFE: "Core PCE",
  UNRATE: "실업률"
};

const state = {
  fred: {},
  manual: loadManual(),
  history: loadHistory(),
  snapshotUpdatedAt: null,
  sourceStatus: "대기 중"
};

const els = {
  freshness: document.querySelector("#freshness"),
  coverageReadout: document.querySelector("#coverageReadout"),
  snapshotReadout: document.querySelector("#snapshotReadout"),
  refreshBtn: document.querySelector("#refreshBtn"),
  pressureScore: document.querySelector("#pressureScore"),
  pressureLabel: document.querySelector("#pressureLabel"),
  pressureCopy: document.querySelector("#pressureCopy"),
  scoreRing: document.querySelector("#scoreRing"),
  fedwatchReadout: document.querySelector("#fedwatchReadout"),
  twoYearGap: document.querySelector("#twoYearGap"),
  topDriver: document.querySelector("#topDriver"),
  asOfDate: document.querySelector("#asOfDate"),
  fedwatchInput: document.querySelector("#fedwatchInput"),
  payrollInput: document.querySelector("#payrollInput"),
  fedToneInput: document.querySelector("#fedToneInput"),
  saveBtn: document.querySelector("#saveBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  historyList: document.querySelector("#historyList"),
  indicatorGrid: document.querySelector("#indicatorGrid"),
  template: document.querySelector("#indicatorTemplate"),
  chart: document.querySelector("#trendChart")
};

const indicatorModel = [
  {
    id: "market",
    title: "시장 기대",
    weight: 35,
    note: "가장 직접적인 지표는 Fed Funds futures 기반의 CME FedWatch입니다. 자동 수집이 막힐 수 있어 수동 입력으로 운영합니다.",
    metrics: [
      {
        label: "CME 연내 인상 확률",
        value: () => numberOrNull(state.manual.fedwatch),
        format: (v) => `${formatNumber(v, 1)}%`,
        score: (v) => clamp(v)
      },
      {
        label: "2년물 - 정책금리 상단",
        value: () => latestValue("DGS2") - latestValue("DFEDTARU"),
        format: (v) => `${formatSigned(v, 2)}%p`,
        score: (v) => scaleHigher(v, -0.25, 0.75)
      },
      {
        label: "2년물 금리",
        value: () => latestValue("DGS2"),
        format: (v) => `${formatNumber(v, 2)}%`,
        score: (v) => scaleHigher(v, 3.5, 5.0)
      }
    ]
  },
  {
    id: "inflation",
    title: "물가 압력",
    weight: 35,
    note: "CPI와 Core PCE는 월간 지표라 매일 변하지 않습니다. 대신 발표 이후 금리 인상 기대의 방향성을 크게 바꿀 수 있습니다.",
    metrics: [
      {
        label: "CPI 전년 대비",
        value: () => yearOverYear("CPIAUCSL"),
        format: (v) => `${formatNumber(v, 1)}%`,
        score: (v) => scaleHigher(v, 2.5, 4.5)
      },
      {
        label: "Core PCE 전년 대비",
        value: () => yearOverYear("PCEPILFE"),
        format: (v) => `${formatNumber(v, 1)}%`,
        score: (v) => scaleHigher(v, 2.2, 4.0)
      },
      {
        label: "10년 기대인플레",
        value: () => latestValue("T10YIE"),
        format: (v) => `${formatNumber(v, 2)}%`,
        score: (v) => scaleHigher(v, 2.1, 2.8)
      }
    ]
  },
  {
    id: "labor",
    title: "고용 탄력",
    weight: 20,
    note: "고용이 너무 강하면 인플레이션 재가속 우려가 커져 인상 가능성 쪽으로 시장 가격이 움직일 수 있습니다.",
    metrics: [
      {
        label: "실업률",
        value: () => latestValue("UNRATE"),
        format: (v) => `${formatNumber(v, 1)}%`,
        score: (v) => scaleLower(v, 4.6, 3.6)
      },
      {
        label: "실업률 3개월 변화",
        value: () => latestValue("UNRATE") - movingAverage("UNRATE", 3, 1),
        format: (v) => `${formatSigned(v, 2)}%p`,
        score: (v) => scaleLower(v, 0.3, -0.2)
      },
      {
        label: "비농업 고용 서프라이즈",
        value: () => numberOrNull(state.manual.payroll),
        format: (v) => `${formatSigned(v, 0)}천 명`,
        score: (v) => scaleHigher(v, -50, 150)
      }
    ]
  },
  {
    id: "fed",
    title: "Fed 커뮤니케이션",
    weight: 10,
    note: "회의록, 점도표, 위원 발언이 물가와 고용 데이터를 해석하는 방향을 바꿉니다.",
    metrics: [
      {
        label: "Fed 발언 톤",
        value: () => numberOrNull(state.manual.fedTone),
        format: (v) => toneLabel(v),
        score: (v) => clamp(v)
      },
      {
        label: "정책금리 상단",
        value: () => latestValue("DFEDTARU"),
        format: (v) => `${formatNumber(v, 2)}%`,
        score: () => null
      }
    ]
  }
];

init();

function init() {
  els.asOfDate.value = state.manual.asOfDate || todayIso();
  els.fedwatchInput.value = state.manual.fedwatch ?? "";
  els.payrollInput.value = state.manual.payroll ?? "";
  els.fedToneInput.value = state.manual.fedTone ?? "50";

  bindEvents();
  render();
  refreshData();
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refreshData);
  els.saveBtn.addEventListener("click", saveToday);
  els.sampleBtn.addEventListener("click", applySample);
  els.exportBtn.addEventListener("click", exportCsv);
  window.addEventListener("resize", drawChart);

  [els.asOfDate, els.fedwatchInput, els.payrollInput, els.fedToneInput].forEach((input) => {
    input.addEventListener("input", () => {
      state.manual = readManual();
      saveManual();
      render();
    });
  });
}

async function refreshData() {
  els.freshness.textContent = "데이터 확인 중";
  els.refreshBtn.disabled = true;

  const snapshotLoaded = await loadSnapshot();

  if (snapshotLoaded) {
    state.sourceStatus = "저장된 FRED 스냅샷 사용";
  } else {
    state.sourceStatus = "자동 데이터 없음, 수동 입력 사용";
  }

  els.refreshBtn.disabled = false;
  render();
}

async function loadSnapshot() {
  try {
    const response = await fetch("data/fred-snapshot.json", { cache: "no-store" });
    if (!response.ok) return false;
    const snapshot = await response.json();
    if (!snapshot.series) return false;
    state.snapshotUpdatedAt = snapshot.updatedAt || null;
    Object.entries(snapshot.series).forEach(([id, rows]) => {
      state.fred[id] = rows.map((row) => ({
        date: row.date,
        value: numberOrNull(row.value)
      })).filter((row) => row.value !== null);
    });
    return Object.keys(snapshot.series).length > 0;
  } catch {
    return false;
  }
}

function render() {
  const indicatorResults = indicatorModel.map(scoreIndicator);
  const overall = weightedScore(indicatorResults);
  const scoreColor = scoreToColor(overall.score);
  const fedwatch = numberOrNull(state.manual.fedwatch);
  const twoYearGap = latestValue("DGS2") - latestValue("DFEDTARU");
  const top = indicatorResults
    .filter((item) => item.score !== null)
    .sort((a, b) => b.weighted - a.weighted)[0];

  els.freshness.textContent = `${state.sourceStatus} · ${latestFredDateText()}`;
  els.pressureScore.textContent = overall.score === null ? "0" : Math.round(overall.score);
  els.scoreRing.style.setProperty("--score", overall.score ?? 0);
  els.scoreRing.style.setProperty("--score-color", scoreColor);
  els.pressureLabel.textContent = pressureLabel(overall.score);
  els.pressureCopy.textContent = pressureCopy(overall.score, overall.coverage);
  els.coverageReadout.textContent = `${overall.coverage}%`;
  els.snapshotReadout.textContent = snapshotDateText();
  els.fedwatchReadout.textContent = fedwatch === null ? "입력 필요" : `${formatNumber(fedwatch, 1)}%`;
  els.twoYearGap.textContent = Number.isFinite(twoYearGap) ? `${formatSigned(twoYearGap, 2)}%p` : "-";
  els.topDriver.textContent = top ? top.title : "-";

  renderIndicators(indicatorResults);
  renderHistory();
  drawChart();
}

function scoreIndicator(indicator) {
  const rows = indicator.metrics.map((metric) => {
    const value = metric.value();
    const score = value === null || !Number.isFinite(value) ? null : metric.score(value);
    return { ...metric, value, score };
  });
  const validScores = rows.map((row) => row.score).filter((score) => score !== null);
  const score = validScores.length ? average(validScores) : null;

  return {
    ...indicator,
    rows,
    score,
    weighted: score === null ? 0 : score * indicator.weight
  };
}

function weightedScore(results) {
  const valid = results.filter((item) => item.score !== null);
  if (!valid.length) return { score: null, coverage: 0 };
  const weighted = valid.reduce((sum, item) => sum + item.score * item.weight, 0);
  const weights = valid.reduce((sum, item) => sum + item.weight, 0);
  return {
    score: weighted / weights,
    coverage: Math.round((weights / indicatorModel.reduce((sum, item) => sum + item.weight, 0)) * 100)
  };
}

function renderIndicators(results) {
  els.indicatorGrid.innerHTML = "";

  results.forEach((indicator) => {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector(".indicator-card");
    const title = node.querySelector("h2");
    const weight = node.querySelector(".weight");
    const score = node.querySelector(".indicator-score");
    const meter = node.querySelector(".meter span");
    const list = node.querySelector("dl");
    const note = node.querySelector(".note");
    const value = indicator.score ?? 0;

    card.dataset.indicator = indicator.id;
    title.textContent = indicator.title;
    weight.textContent = `${indicator.weight}% weight`;
    score.textContent = indicator.score === null ? "-" : Math.round(indicator.score);
    score.style.color = scoreToColor(value);
    meter.style.width = `${value}%`;
    meter.style.background = scoreToColor(value);
    note.textContent = indicator.note;

    indicator.rows.forEach((row) => {
      const wrapper = document.createElement("div");
      wrapper.className = "metric-row";
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = row.label;
      dd.textContent = row.value === null || !Number.isFinite(row.value) ? "데이터 없음" : row.format(row.value);
      wrapper.append(dt, dd);
      list.append(wrapper);
    });

    els.indicatorGrid.append(node);
  });
}

function saveToday() {
  const results = indicatorModel.map(scoreIndicator);
  const overall = weightedScore(results);
  if (overall.score === null) return;

  const record = {
    date: state.manual.asOfDate || todayIso(),
    score: Math.round(overall.score),
    coverage: overall.coverage,
    fedwatch: numberOrNull(state.manual.fedwatch),
    payroll: numberOrNull(state.manual.payroll),
    fedTone: numberOrNull(state.manual.fedTone),
    indicators: Object.fromEntries(results.map((item) => [item.id, item.score === null ? null : Math.round(item.score)]))
  };

  state.history = [
    record,
    ...state.history.filter((item) => item.date !== record.date)
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90);

  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  render();
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (!state.history.length) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.innerHTML = "<strong>저장 기록 없음</strong><span>오늘 값을 저장하면 추세가 그려집니다.</span>";
    els.historyList.append(empty);
    return;
  }

  state.history.slice(0, 12).forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${item.date}</strong>
        <span>커버리지 ${item.coverage ?? 0}%</span>
      </div>
      <b>${item.score}</b>
    `;
    els.historyList.append(li);
  });
}

function drawChart() {
  const canvas = els.chart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 900;
  const height = Math.max(240, Math.round(width * 0.32));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, width, height);
  const pad = { top: 18, right: 24, bottom: 34, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  ctx.strokeStyle = "#d9e0dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  [25, 50, 75].forEach((tick) => {
    const y = pad.top + plotH - (tick / 100) * plotH;
    ctx.strokeStyle = "#edf1ef";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#68716f";
    ctx.font = "12px system-ui";
    ctx.fillText(String(tick), 10, y + 4);
  });

  const points = [...state.history].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  if (!points.length) {
    ctx.fillStyle = "#68716f";
    ctx.font = "14px system-ui";
    ctx.fillText("저장된 기록이 아직 없습니다.", pad.left + 10, pad.top + 34);
    return;
  }

  const xFor = (index) => pad.left + (points.length === 1 ? plotW : (index / (points.length - 1)) * plotW);
  const yFor = (score) => pad.top + plotH - (score / 100) * plotH;

  ctx.strokeStyle = "#326fa8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.score);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.score);
    ctx.fillStyle = scoreToColor(point.score);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#68716f";
  ctx.font = "12px system-ui";
  ctx.fillText(points[0].date.slice(5), pad.left, height - 10);
  ctx.fillText(points[points.length - 1].date.slice(5), Math.max(pad.left, pad.left + plotW - 42), height - 10);
}

function applySample() {
  els.fedwatchInput.value = "41.2";
  els.payrollInput.value = "95";
  els.fedToneInput.value = "75";
  state.manual = readManual();
  saveManual();
  render();
}

function exportCsv() {
  if (!state.history.length) return;
  const rows = [
    ["date", "score", "coverage", "fedwatch", "payroll", "fedTone"],
    ...state.history.map((item) => [
      item.date,
      item.score,
      item.coverage ?? "",
      item.fedwatch ?? "",
      item.payroll ?? "",
      item.fedTone ?? ""
    ])
  ];
  const csv = rows.map((row) => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rate-hike-watch.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function readManual() {
  return {
    asOfDate: els.asOfDate.value || todayIso(),
    fedwatch: numberOrNull(els.fedwatchInput.value),
    payroll: numberOrNull(els.payrollInput.value),
    fedTone: numberOrNull(els.fedToneInput.value)
  };
}

function loadManual() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { fedTone: 50 };
  } catch {
    return { fedTone: 50 };
  }
}

function saveManual() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.manual));
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function latestValue(id) {
  const rows = state.fred[id] || [];
  return rows.length ? rows[rows.length - 1].value : NaN;
}

function latestFredDateText() {
  const dates = Object.values(state.fred)
    .flat()
    .map((row) => row.date)
    .filter(Boolean)
    .sort();
  return dates.length ? `최신 ${dates[dates.length - 1]}` : "FRED 날짜 없음";
}

function snapshotDateText() {
  if (!state.snapshotUpdatedAt) return "대기 중";
  return new Date(state.snapshotUpdatedAt).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric"
  });
}

function yearOverYear(id) {
  const rows = state.fred[id] || [];
  if (rows.length < 13) return NaN;
  const latest = rows[rows.length - 1].value;
  const previous = rows[rows.length - 13].value;
  if (!previous) return NaN;
  return ((latest / previous) - 1) * 100;
}

function movingAverage(id, count, offset = 0) {
  const rows = state.fred[id] || [];
  const end = rows.length - offset;
  const slice = rows.slice(Math.max(0, end - count), end);
  if (slice.length < count) return NaN;
  return average(slice.map((row) => row.value));
}

function pressureLabel(score) {
  if (score === null) return "데이터 부족";
  if (score >= 75) return "높음";
  if (score >= 55) return "상승 감시";
  if (score >= 35) return "중립";
  return "낮음";
}

function pressureCopy(score, coverage) {
  if (score === null) return "수동값을 입력하거나 FRED 데이터를 불러오면 계산됩니다.";
  if (score >= 75) return `긴축 재가격화가 강한 구간입니다. 계산 커버리지 ${coverage}%.`;
  if (score >= 55) return `인상 가능성 쪽으로 기울 수 있는 지표가 늘고 있습니다. 커버리지 ${coverage}%.`;
  if (score >= 35) return `아직 혼재된 구간입니다. 물가와 고용 발표 후 재확인이 좋습니다. 커버리지 ${coverage}%.`;
  return `현재 조합은 인상 압력이 낮은 편입니다. 커버리지 ${coverage}%.`;
}

function toneLabel(value) {
  if (value >= 85) return "강한 매파";
  if (value >= 70) return "매파적";
  if (value <= 35) return "완화적";
  return "중립";
}

function scoreToColor(score) {
  if (score >= 75) return "#b73e4a";
  if (score >= 55) return "#ca8a2a";
  if (score >= 35) return "#326fa8";
  return "#2f8f68";
}

function scaleHigher(value, low, high) {
  return clamp(((value - low) / (high - low)) * 100);
}

function scaleLower(value, high, low) {
  return clamp(((high - value) / (high - low)) * 100);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined || value === ".") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value, digits) {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatSigned(value, digits) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, digits)}`;
}

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
