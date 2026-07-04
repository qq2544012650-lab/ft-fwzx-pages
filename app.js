const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

const targetRatioByDay = { 3: 500, 4: 300, 5: 200, 6: 170, 7: 150, 8: 130, 9: 130, 10: 130, 11: 130, 12: 130, 13: 130 };
const rewardLevels = [
  { ratio: 130, reward: 222 },
  { ratio: 110, reward: 333 },
  { ratio: 100, reward: 555 }
];
const tiers = [
  [70000, 0.04],
  [100000, 0.05],
  [150000, 0.06],
  [200000, 0.065],
  [250000, 0.07],
  [350000, 0.075],
  [Infinity, 0.08]
];
const ALL_TEAMS = "all";
const UNASSIGNED_TEAM = "__unassigned";
const defaultTeams = [
  { id: "team-1", name: "团队1", active: true },
  { id: "team-2", name: "团队2", active: true },
  { id: "team-3", name: "团队3", active: true }
];

const isLocalServer = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const cloudEnabled = window.location.hostname.endsWith(".netlify.app");
const uploadEnabled = isLocalServer || cloudEnabled;
const publicPreview = new URLSearchParams(window.location.search).get("view") === "public";
const adminMode = (isLocalServer || cloudEnabled) && !publicPreview;
let data = await loadInitialData();
const state = await loadState();

function beijingToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

async function loadInitialData() {
  const staticData = await fetch(`./data/generated.json?ts=${Date.now()}`, { cache: "no-store" }).then((res) => res.json());
  if (!cloudEnabled) return staticData;
  try {
    const response = await fetch("/.netlify/functions/data", { cache: "no-store" });
    const result = await response.json();
    return result.ok && result.generated ? result.generated : staticData;
  } catch {
    return staticData;
  }
}

async function loadState() {
  const saved = JSON.parse(localStorage.getItem("sales-dashboard-state") || "{}");
  const defaultState = data.defaults?.state || {};
  const today = beijingToday();
  const sharedState = isLocalServer || cloudEnabled ? saved : defaultState;
  const fallbackState = isLocalServer || cloudEnabled ? defaultState : saved;
  const teamSource = Number(fallbackState.teamConfigVersion || 0) > Number(sharedState.teamConfigVersion || 0)
    ? fallbackState
    : sharedState;
  const sharedMonth = sharedState.month || "";
  const fallbackMonth = fallbackState.month || "";
  const useFallbackMonth = fallbackMonth && (!sharedMonth || fallbackMonth > sharedMonth);
  const month = useFallbackMonth
    ? fallbackMonth
    : sharedMonth || today.slice(0, 7) || data.defaults.month;
  const tracks = mergeTracks(fallbackState.tracks || data.defaults.tracks || [], sharedState.tracks || []);
  const localState = {
    month,
    today,
    selectedTrack: (useFallbackMonth ? fallbackState.selectedTrack : sharedState.selectedTrack) || fallbackState.selectedTrack || data.defaults.tracks[0].id,
    selectedTeam: teamSource.selectedTeam || sharedState.selectedTeam || fallbackState.selectedTeam || ALL_TEAMS,
    teamConfigVersion: teamSource.teamConfigVersion || sharedState.teamConfigVersion || fallbackState.teamConfigVersion || 0,
    tracks,
    teams: normalizeTeams(nonEmptyArray(teamSource.teams) || nonEmptyArray(sharedState.teams) || nonEmptyArray(fallbackState.teams) || []),
    teamAssignments: nonEmptyObject(teamSource.teamAssignments) || nonEmptyObject(sharedState.teamAssignments) || nonEmptyObject(fallbackState.teamAssignments) || {},
    employeeAliases: {
      "松明老师": "刘萌萌",
      ...(teamSource.employeeAliases || sharedState.employeeAliases || fallbackState.employeeAliases || {})
    },
    costs: sharedState.costs || fallbackState.costs || {},
    employeeCosts: sharedState.employeeCosts || fallbackState.employeeCosts || {},
    teamCosts: sharedState.teamCosts || fallbackState.teamCosts || {},
    channelSort: saved.channelSort || { key: "revenue", direction: "desc" },
    attendanceSort: saved.attendanceSort || { key: "totalAttendRate", direction: "desc" },
    fullAttendanceSort: saved.fullAttendanceSort || { key: "d1Full", direction: "desc" },
    orderOverrides: sharedState.orderOverrides || fallbackState.orderOverrides || {},
    deletedOrders: sharedState.deletedOrders || fallbackState.deletedOrders || {},
    depositOverrides: sharedState.depositOverrides || fallbackState.depositOverrides || {}
  };
  const monthTracks = tracks.filter((track) => track.startDate?.startsWith(month));
  const selectableTracks = monthTracks.length ? monthTracks : tracks;
  if (!selectableTracks.some((track) => track.id === localState.selectedTrack)) {
    localState.selectedTrack = selectableTracks[0]?.id || data.defaults.tracks[0].id;
  }
  if (!cloudEnabled) return localState;
  try {
    const response = await fetch("/.netlify/functions/state", { cache: "no-store" });
    const result = await response.json();
    if (!result.ok || !result.state) return localState;
    const remoteState = { ...localState, ...result.state, today };
    remoteState.tracks = mergeTracks(localState.tracks, result.state.tracks || []);
    alignSelectedTrackWithMonth(remoteState);
    return remoteState;
  } catch {
    return localState;
  }
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length ? value : null;
}

function nonEmptyObject(value) {
  return value && typeof value === "object" && Object.keys(value).length ? value : null;
}

function mergeTracks(baseTracks, savedTracks) {
  const map = new Map();
  for (const track of [...baseTracks, ...savedTracks]) {
    if (!track?.id) continue;
    map.set(track.id, { ...(map.get(track.id) || {}), ...track });
  }
  return [...map.values()].sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));
}

function tracksForMonth(month = state.month) {
  const tracks = state.tracks.filter((track) => track.startDate?.startsWith(month));
  return tracks.length ? tracks : state.tracks;
}

function syncSelectedTrackWithMonth() {
  alignSelectedTrackWithMonth(state);
}

function alignSelectedTrackWithMonth(targetState) {
  const tracks = targetState.tracks.filter((track) => track.startDate?.startsWith(targetState.month));
  const selectableTracks = tracks.length ? tracks : targetState.tracks;
  if (!selectableTracks.some((track) => track.id === targetState.selectedTrack)) {
    targetState.selectedTrack = selectableTracks[0]?.id || targetState.selectedTrack;
  }
}

function normalizeTeams(teams) {
  const source = Array.isArray(teams) && teams.length ? teams : defaultTeams;
  return source.map((team, index) => ({
    id: tidy(team.id) || `team-${index + 1}`,
    name: tidy(team.name) || `团队${index + 1}`,
    active: team.active !== false
  }));
}

function saveState() {
  localStorage.setItem("sales-dashboard-state", JSON.stringify(state));
  if (isLocalServer) {
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    }).catch(() => {});
  }
  if (cloudEnabled) {
    fetch("/.netlify/functions/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    }).catch(() => {});
  }
}

async function persistStateToDisk() {
  if (!isLocalServer) {
    throw new Error("请在 Mac 本机打开本地大屏后保存成本。");
  }
  const response = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state)
  });
  const result = await readJsonResponse(response);
  if (!result.ok) throw new Error(result.error || "保存失败");
  return result;
}

function daysBetween(a, b) {
  return Math.floor((new Date(`${b}T00:00:00+08:00`) - new Date(`${a}T00:00:00+08:00`)) / 86400000) + 1;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function activeTrackForDate(date) {
  const sorted = [...state.tracks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  let active = sorted[0];
  for (const track of sorted) {
    if (date >= track.startDate) active = track;
  }
  return active;
}

function selectedTrack() {
  return tracksForMonth().find((track) => track.id === state.selectedTrack) || tracksForMonth()[0] || state.tracks[0];
}

function trackEnd(track) {
  return track.settledAt || addDays(track.startDate, 12);
}

function inTrack(item, track) {
  if (item.trackId && item.trackId === track.id) return true;
  if (item.trackId && item.trackId !== track.id) return false;
  if (item.trackName && item.trackName === track.name) return true;
  if (!item.date) return track.id === "0605";
  return item.date >= track.startDate && item.date <= trackEnd(track) && activeTrackForDate(item.date).id === track.id;
}

function costKey(studio, channel) {
  return `${state.month}|${selectedTrack().id}|${studio}|${channel}`;
}

function leadCost(card) {
  const trackId = card.trackId || selectedTrack().id;
  return Number(state.costs[`${state.month}|${trackId}|${card.studio}|${card.channel}`] || 0);
}

function employeeCostKey(employee, trackId = selectedTrack().id) {
  return `${state.month}|${trackId}|${employee}`;
}

function teamCostKey(trackId = selectedTrack().id) {
  return `${state.month}|${trackId}|团队总计`;
}

function referenceEmployeeCost(cards) {
  return cards.reduce((sum, card) => sum + leadCost(card), 0);
}

function employeeCost(employee, cards, trackId = selectedTrack().id) {
  const key = employeeCostKey(employee, trackId);
  const manual = tidy(state.employeeCosts?.[key]);
  if (manual !== "") return Number(manual) || 0;
  return referenceEmployeeCost(cards);
}

function teamCost(referenceCost, trackId = selectedTrack().id) {
  const manual = tidy(state.teamCosts?.[teamCostKey(trackId)]);
  if (manual !== "") return Number(manual) || 0;
  return referenceCost;
}

function tidy(value) {
  return String(value ?? "").trim();
}

function normalizeEmployeeName(employee) {
  const raw = tidy(employee);
  if (!raw) return "";
  const mapped = state.employeeAliases?.[raw];
  if (mapped) return mapped;
  return raw
    .replace(/[\s_-]*[A-Z]\d+$/i, "")
    .replace(/[\s_-]*\d+$/i, "");
}

function activeTeams() {
  return state.teams.filter((team) => team.active !== false);
}

function teamLabel(teamId) {
  if (teamId === UNASSIGNED_TEAM) return "未分配团队";
  return state.teams.find((team) => team.id === teamId)?.name || "未知团队";
}

function trackAssignments(trackId = selectedTrack().id) {
  state.teamAssignments ||= {};
  state.teamAssignments[trackId] ||= {};
  return state.teamAssignments[trackId];
}

function assignmentTeamId(employee, trackId = selectedTrack().id) {
  const employeeName = normalizeEmployeeName(employee);
  if (!employeeName) return UNASSIGNED_TEAM;
  let teamId = state.teamAssignments?.[trackId]?.[employeeName] || "";
  if (!teamId) {
    const currentTrack = state.tracks.find((track) => track.id === trackId) || selectedTrack();
    const previousTracks = [...state.tracks]
      .filter((track) => track.startDate <= currentTrack.startDate)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    for (const track of previousTracks) {
      teamId = state.teamAssignments?.[track.id]?.[employeeName] || "";
      if (teamId) break;
    }
  }
  return state.teams.some((team) => team.id === teamId) ? teamId : UNASSIGNED_TEAM;
}

function selectedTeamId() {
  if (state.selectedTeam === ALL_TEAMS) return ALL_TEAMS;
  if (state.selectedTeam === UNASSIGNED_TEAM) return UNASSIGNED_TEAM;
  return state.teams.some((team) => team.id === state.selectedTeam) ? state.selectedTeam : ALL_TEAMS;
}

function inSelectedTeam(item) {
  const teamId = selectedTeamId();
  return teamId === ALL_TEAMS || item.teamId === teamId;
}

function annotateTeam(item, trackId = selectedTrack().id, overrideTeamId = "") {
  const employee = normalizeEmployeeName(item.employee);
  const teamId = overrideTeamId || assignmentTeamId(employee, trackId);
  return { ...item, employee, teamId };
}

function employeesForTrack(track = selectedTrack()) {
  const names = new Set();
  for (const card of data.cards.filter((card) => inTrack(card, track))) names.add(normalizeEmployeeName(card.employee));
  for (const order of applyOrderOverrides({ includeDeleted: true }).filter((order) => inTrack(order, track))) names.add(normalizeEmployeeName(order.employee));
  for (const deposit of applyDepositOverrides().filter((deposit) => inTrack(deposit, track))) names.add(normalizeEmployeeName(deposit.employee));
  for (const item of (data.attendance || []).filter((item) => !item.trackId || item.trackId === track.id)) names.add(normalizeEmployeeName(item.employee));
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function escapeHtml(value) {
  return tidy(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cardKey(card, index) {
  return [
    index,
    card.trackId,
    card.customerId,
    card.nickname,
    card.employee,
    card.studio,
    card.channel,
    card.createdAt
  ].map(tidy).join("|");
}

function orderKey(order, index) {
  return [
    index,
    order.customer,
    order.employee,
    order.amount,
    order.date,
    order.status,
    order.source,
    order.studio,
    order.channel
  ].map(tidy).join("|");
}

function depositKey(deposit, index) {
  return [
    index,
    deposit.customer,
    deposit.employee,
    deposit.amount,
    deposit.date,
    deposit.status,
    deposit.source
  ].map(tidy).join("|");
}

function cardCatalog(track = null) {
  return data.cards.map((card, index) => ({
    ...card,
    employee: normalizeEmployeeName(card.employee),
    _cardKey: cardKey(card, index),
    _label: [card.trackName || card.trackId, card.nickname || "未命名", normalizeEmployeeName(card.employee), card.studio, card.channel].filter(Boolean).join(" / ")
  })).filter((card) => !track || inTrack(card, track));
}

function systemMatchedCard(order, cards = cardCatalog()) {
  if (!order.matchedCard || order._manualOverride) return null;
  let candidates = cards.filter((card) => card.nickname && card.nickname === order.customer && (!order.trackId || (card.trackId || "0605") === order.trackId));
  if (candidates.length > 1 && order.employee) {
    const next = candidates.filter((card) => card.employee === order.employee);
    if (next.length) candidates = next;
  }
  if (candidates.length > 1 && (order.studio || order.channel)) {
    const next = candidates.filter((card) => (!order.studio || card.studio === order.studio) && (!order.channel || card.channel === order.channel));
    if (next.length) candidates = next;
  }
  return candidates[0] || null;
}

function cardSearchText(card) {
  return [card.nickname, card.employee, card.studio, card.channel, card.trackName, card.trackId, card._label]
    .map(tidy)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function renderMatchCardPicker(kind, key, selectedCardKey, cards) {
  const searchAttr = kind === "order" ? "data-order-card-search" : "data-deposit-card-search";
  const selectAttr = kind === "order" ? "data-order-card" : "data-deposit-card";
  const selectedCard = cards.find((card) => card._cardKey === selectedCardKey);
  const options = cards.map((card) => `
    <option
      value="${escapeHtml(card._cardKey)}"
      data-search="${escapeHtml(cardSearchText(card))}"
      ${card._cardKey === selectedCardKey ? "selected" : ""}
    >${escapeHtml(card._label)}</option>
  `).join("");
  return `
    <div class="match-card-picker">
      <input
        class="match-card-search"
        type="search"
        ${searchAttr}="${escapeHtml(key)}"
        value="${escapeHtml(selectedCard?.nickname || "")}"
        placeholder="输入学员昵称搜索"
      >
      <select class="match-card-select" ${selectAttr}="${escapeHtml(key)}">
        <option value="">不指定名片</option>
        ${options}
      </select>
      <div class="match-card-count muted"></div>
    </div>
  `;
}

function renderTeamPicker(key, selectedTeam, disabled = false) {
  const teamIds = new Set(activeTeams().map((team) => team.id));
  if (selectedTeam && selectedTeam !== UNASSIGNED_TEAM) teamIds.add(selectedTeam);
  const options = [
    `<option value="">跟随运营</option>`,
    `<option value="${UNASSIGNED_TEAM}" ${selectedTeam === UNASSIGNED_TEAM ? "selected" : ""}>未分配团队</option>`,
    ...[...teamIds].map((teamId) => `<option value="${escapeHtml(teamId)}" ${teamId === selectedTeam ? "selected" : ""}>${escapeHtml(teamLabel(teamId))}</option>`)
  ].join("");
  return `<select class="match-small-input" data-order-team="${escapeHtml(key)}" ${disabled ? "disabled" : ""}>${options}</select>`;
}

function filterMatchCardPicker(input) {
  const picker = input.closest(".match-card-picker");
  const select = picker?.querySelector(".match-card-select");
  const count = picker?.querySelector(".match-card-count");
  if (!select) return [];

  const query = tidy(input.value).toLowerCase();
  const matches = [];
  for (const option of select.options) {
    if (!option.value) {
      option.hidden = false;
      continue;
    }
    const matched = !query || option.dataset.search.includes(query);
    option.hidden = !matched;
    if (matched) matches.push(option);
  }
  if (count) {
    count.textContent = query
      ? matches.length ? `${matches.length} 个匹配，按回车选第一个` : "没有匹配的名片"
      : "";
  }
  return matches;
}

function applyOrderOverrides({ includeDeleted = false } = {}) {
  const cardsByKey = new Map(cardCatalog().map((card) => [card._cardKey, card]));
  return data.orders.map((order, index) => {
    const _orderKey = orderKey(order, index);
    const deletedInfo = state.deletedOrders?.[_orderKey];
    const override = state.orderOverrides?.[_orderKey];
    const matchedCard = override?.cardKey ? cardsByKey.get(override.cardKey) : null;
    const trackId = order.trackId || activeTrackForDate(order.date || state.today)?.id || selectedTrack().id;
    if (!override) return annotateTeam({ ...order, _orderKey, _manualOverride: false, _deleted: Boolean(deletedInfo), _deletedAt: deletedInfo?.deletedAt || "" }, trackId);
    const employee = tidy(override.employee) || matchedCard?.employee || order.employee;
    const attributedStudio = tidy(override.studio) || matchedCard?.studio || order.attributedStudio || order.studio || "未匹配渠道";
    const attributedChannel = tidy(override.channel) || matchedCard?.channel || order.attributedChannel || order.channel || "未匹配渠道";
    return annotateTeam({
      ...order,
      employee,
      attributedStudio,
      attributedChannel,
      matchedCard: Boolean(matchedCard) || Boolean(order.matchedCard && !override.cardKey),
      manualMatchedCard: matchedCard ? matchedCard.nickname : "",
      _orderKey,
      _manualOverride: true,
      _deleted: Boolean(deletedInfo),
      _deletedAt: deletedInfo?.deletedAt || ""
    }, trackId, tidy(override.teamId));
  }).filter((order) => includeDeleted || !order._deleted);
}

function applyDepositOverrides() {
  const cardsByKey = new Map(cardCatalog().map((card) => [card._cardKey, card]));
  return (data.deposits || []).map((deposit, index) => {
    const _depositKey = depositKey(deposit, index);
    const override = state.depositOverrides?.[_depositKey];
    const matchedCard = override?.cardKey ? cardsByKey.get(override.cardKey) : null;
    const trackId = deposit.trackId || activeTrackForDate(deposit.date || state.today)?.id || selectedTrack().id;
    if (!override) return annotateTeam({ ...deposit, _depositKey, _manualOverride: false }, trackId);
    const employee = tidy(override.employee) || matchedCard?.employee || deposit.employee;
    const attributedStudio = tidy(override.studio) || matchedCard?.studio || deposit.attributedStudio || "未匹配渠道";
    const attributedChannel = tidy(override.channel) || matchedCard?.channel || deposit.attributedChannel || "未匹配渠道";
    return annotateTeam({
      ...deposit,
      employee,
      attributedStudio,
      attributedChannel,
      matchedCard: Boolean(matchedCard) || Boolean(deposit.matchedCard && !override.cardKey),
      manualMatchedCard: matchedCard ? matchedCard.nickname : "",
      _depositKey,
      _manualOverride: true
    }, trackId);
  });
}

function orderMatchStats(orders) {
  const total = orders.length;
  const matchedCard = orders.filter((order) => order.matchedCard).length;
  const manual = orders.filter((order) => order._manualOverride).length;
  const unresolved = orders.filter((order) => !order.matchedCard && !order._manualOverride).length;
  return { total, matchedCard, manual, unresolved };
}

function depositMatchStats(deposits) {
  const total = deposits.length;
  const matchedCard = deposits.filter((deposit) => deposit.matchedCard).length;
  const manual = deposits.filter((deposit) => deposit._manualOverride).length;
  const unresolved = deposits.filter((deposit) => !deposit.matchedCard && !deposit._manualOverride).length;
  return { total, matchedCard, manual, unresolved };
}

function ratioClass(value) {
  if (!Number.isFinite(value) || value === 0) return "muted";
  if (value <= 130) return "good";
  if (value <= 210) return "warn";
  return "bad";
}

function amountClass(value) {
  if (value <= 0) return "good";
  return "bad";
}

function completionClass(value) {
  if (value >= 1) return "good";
  if (value >= 0.7) return "warn";
  return "bad";
}

function targetFor(track) {
  const day = daysBetween(track.startDate, state.today);
  return targetRatioByDay[Math.max(1, Math.min(13, day))] || null;
}

function targetRevenue(cost, targetRatio) {
  if (!targetRatio || !cost) return 0;
  return cost / (targetRatio / 100) / 0.92;
}

function performanceRatio(cost, paidAmount) {
  if (!paidAmount) return 0;
  return cost / (paidAmount * 0.92) * 100;
}

function coefficient(ratio) {
  if (ratio < 100) return 1.2;
  if (ratio < 135) return 1.15;
  if (ratio < 165) return 1.1;
  if (ratio < 210) return 1;
  if (ratio < 260) return 0.8;
  return 0.7;
}

function tieredCommission(performanceRevenue, coeff) {
  let previous = 0;
  let total = 0;
  for (const [limit, rate] of tiers) {
    const part = Math.max(0, Math.min(performanceRevenue, limit) - previous);
    if (part > 0) total += part * rate * 0.5 + part * rate * 0.5 * coeff;
    previous = limit;
    if (performanceRevenue <= limit) break;
  }
  return total;
}

function performanceEmployee(employee) {
  return normalizeEmployeeName(employee);
}

function employeeTrackReward(employee, track, ordersWithOverrides = applyOrderOverrides()) {
  const cards = data.cards
    .filter((card) => inTrack(card, track))
    .map((card) => ({ ...card, employee: normalizeEmployeeName(card.employee) }))
    .filter((card) => card.employee === employee);
  const orders = ordersWithOverrides.filter((order) => inTrack(order, track) && performanceEmployee(order.employee) === employee);
  const cost = employeeCost(employee, cards, track.id);
  const revenue = orders.reduce((sum, order) => sum + order.amount, 0);
  if (!cards.length || !cost || !revenue) return 0;
  const rewardProgress = rewardLevels.map((level) => ({
    ...level,
    needed: Math.max(0, targetRevenue(cost, level.ratio) - revenue)
  }));
  return [...rewardProgress].reverse().find((level) => level.needed === 0)?.reward || 0;
}

function decayRate(previous, current) {
  if (!previous) return null;
  return (previous - current) / previous;
}

function dailyDecayRates(rates) {
  return rates.map((rate, index) => index === 0 ? null : decayRate(rates[index - 1], rate));
}

function attendanceRowsForTrack(trackCards, track) {
  const attendance = (data.attendance || [])
    .filter((item) => (!item.trackId || item.trackId === track.id))
    .map((item) => annotateTeam(item, item.trackId || track.id))
    .filter(inSelectedTeam);
  const employeeCards = new Map();
  for (const card of trackCards) {
    if (!card.employee) continue;
    employeeCards.set(card.employee, (employeeCards.get(card.employee) || 0) + 1);
  }
  return [...employeeCards.entries()].map(([employee, cards]) => {
    const records = attendance.filter((item) => item.employee === employee);
    const totalAttend = records.filter((item) => Number(item.totalMinutes) > 1).length;
    const totalFull = records.filter((item) => Number(item.totalMinutes) >= 60).length;
    const dayAttendCounts = [0, 1, 2, 3, 4].map((index) => records.filter((item) => Number(item.dayMinutes?.[index]) > 1).length);
    const dayFullCounts = [0, 1, 2, 3, 4].map((index) => records.filter((item) => Number(item.dayMinutes?.[index]) >= 60).length);
    const dayAttendRates = dayAttendCounts.map((count) => cards ? count / cards : 0);
    const dayFullRates = dayFullCounts.map((count) => cards ? count / cards : 0);
    return {
      employee,
      cards,
      records: records.length,
      totalAttend,
      totalFull,
      dayAttendCounts,
      dayFullCounts,
      totalAttendRate: cards ? totalAttend / cards : 0,
      dayAttendRates,
      dayAttendDecays: dailyDecayRates(dayAttendRates),
      dayFullRates,
      dayFullDecays: dailyDecayRates(dayFullRates)
    };
  }).sort((a, b) => b.totalAttendRate - a.totalAttendRate || b.cards - a.cards);
}

function uploadedAttendanceDays(cards) {
  let days = 0;
  for (let index = 0; index < 5; index++) {
    if (cards.some((card) => Number(card.dailyMinutes?.[index]) > 1)) days = index + 1;
  }
  return days || 5;
}

function continuousAttendance(card, days) {
  return Array.from({ length: days }, (_, index) => Number(card.dailyMinutes?.[index]) > 1)
    .every(Boolean);
}

function buildTeamRows({ track, cards, orders, deposits }) {
  const teamIds = new Set(activeTeams().map((team) => team.id));
  for (const item of [...cards, ...orders, ...deposits]) {
    if (item.teamId) teamIds.add(item.teamId);
  }
  return [...teamIds].map((teamId) => {
    const teamCards = cards.filter((card) => card.teamId === teamId);
    const teamOrders = orders.filter((order) => order.teamId === teamId);
    const teamDeposits = deposits.filter((deposit) => deposit.teamId === teamId);
    const cost = teamCards.reduce((sum, card) => sum + leadCost(card), 0);
    const revenue = teamOrders.reduce((sum, order) => sum + order.amount, 0);
    const targetRatio = targetFor(track);
    const required = targetRevenue(cost, targetRatio);
    const completionBase = targetRevenue(cost, 130);
    return {
      teamId,
      teamName: teamLabel(teamId),
      cards: teamCards.length,
      orders: teamOrders.length,
      deposits: teamDeposits.length,
      cost,
      revenue,
      required,
      diff: required - revenue,
      ratio: cost && revenue ? cost / (revenue * 0.92) * 100 : 0,
      completion: completionBase ? revenue / completionBase : 0
    };
  }).filter((row) => row.teamId !== UNASSIGNED_TEAM || row.cards || row.orders || row.deposits)
    .sort((a, b) => {
      if (a.teamId === UNASSIGNED_TEAM) return 1;
      if (b.teamId === UNASSIGNED_TEAM) return -1;
      return b.revenue - a.revenue || b.cards - a.cards || a.teamName.localeCompare(b.teamName, "zh-CN");
    });
}

function aggregate() {
  const track = selectedTrack();
  const viewTeamId = selectedTeamId();
  const ordersWithOverrides = applyOrderOverrides();
  const depositsWithOverrides = applyDepositOverrides();
  const allTrackCards = data.cards
    .filter((card) => inTrack(card, track))
    .map((card) => annotateTeam(card, card.trackId || track.id));
  const allTrackOrders = ordersWithOverrides.filter((order) => inTrack(order, track));
  const allTrackDeposits = depositsWithOverrides.filter((deposit) => inTrack(deposit, track));
  const trackCards = allTrackCards.filter(inSelectedTeam);
  const trackOrders = allTrackOrders.filter(inSelectedTeam);
  const trackDeposits = allTrackDeposits.filter(inSelectedTeam);
  const monthOrdersAllTeams = ordersWithOverrides.filter((order) => order.date?.startsWith(state.month));
  const monthOrders = monthOrdersAllTeams.filter(inSelectedTeam);
  const monthPeriodOrders = (data.periodOrders || []).filter((order) => order.date?.startsWith(state.month));
  const monthCardsAllTeams = data.cards.filter((card) => {
    const track = state.tracks.find((item) => item.id === (card.trackId || "0605"));
    return !track || track.startDate.startsWith(state.month);
  }).map((card) => annotateTeam(card, card.trackId || "0605"));
  const monthCards = monthCardsAllTeams.filter(inSelectedTeam);
  const employees = [...new Set([...trackCards.map((c) => c.employee), ...trackOrders.map((o) => o.employee)].filter(Boolean))].sort();
  const attendanceRows = attendanceRowsForTrack(trackCards, track);
  const continuousAttendanceDays = uploadedAttendanceDays(trackCards);

  const employeeRows = employees.map((employee) => {
    const cards = trackCards.filter((card) => card.employee === employee);
    const orders = trackOrders.filter((order) => order.employee === employee);
    const referenceCost = referenceEmployeeCost(cards);
    const cost = employeeCost(employee, cards, track.id);
    const revenue = orders.reduce((sum, order) => sum + order.amount, 0);
    const todayRevenue = orders.filter((order) => order.date === state.today).reduce((sum, order) => sum + order.amount, 0);
    const targetRatio = targetFor(track);
    const required = targetRevenue(cost, targetRatio);
    const diff = required - revenue;
    const ratio = cost && revenue ? cost / (revenue * 0.92) * 100 : 0;
    const trackCompletionBase = targetRevenue(cost, 130);
    const trackCompletion = trackCompletionBase ? revenue / trackCompletionBase : 0;
    const rewardProgress = rewardLevels.map((level) => ({
      ...level,
      needed: Math.max(0, targetRevenue(cost, level.ratio) - revenue)
    }));
    const bestReward = cost && revenue ? [...rewardProgress].reverse().find((level) => level.needed === 0)?.reward || 0 : 0;
    const teamId = assignmentTeamId(employee, track.id);
    return { employee, teamId, teamName: teamLabel(teamId), cards: cards.length, cost, referenceCost, orders: orders.length, revenue, todayRevenue, targetRatio, required, diff, ratio, trackCompletion, bestReward, rewardProgress };
  }).sort((a, b) => {
    if (a.ratio && b.ratio) return a.ratio - b.ratio || b.revenue - a.revenue;
    if (a.ratio) return -1;
    if (b.ratio) return 1;
    return b.revenue - a.revenue;
  });
  const referenceTeamCost = employeeRows.reduce((sum, row) => sum + row.cost, 0);
  const trackCost = viewTeamId === ALL_TEAMS ? teamCost(referenceTeamCost, track.id) : referenceTeamCost;
  const teamRows = buildTeamRows({ track, cards: allTrackCards, orders: allTrackOrders, deposits: allTrackDeposits });

  const channelMap = new Map();
  for (const card of trackCards) {
    const key = `${card.studio || "未匹配渠道"}|${card.channel || "未匹配渠道"}`;
    if (!channelMap.has(key)) channelMap.set(key, { studio: card.studio || "未匹配渠道", channel: card.channel || "未匹配渠道", cards: 0, deletedCards: 0, attend: 0, validAttend: 0, continuousAttend: 0, cost: 0, depositCount: 0, orderCount: 0, revenue: 0 });
    const row = channelMap.get(key);
    row.cards++;
    row.deletedCards += card.deleted ? 1 : 0;
    row.attend += card.attended ? 1 : 0;
    row.validAttend += card.validAttendance ? 1 : 0;
    row.continuousAttend += continuousAttendance(card, continuousAttendanceDays) ? 1 : 0;
    row.cost += leadCost(card);
  }
  for (const deposit of trackDeposits) {
    const key = `${deposit.attributedStudio || "未匹配渠道"}|${deposit.attributedChannel || "未匹配渠道"}`;
    if (!channelMap.has(key)) channelMap.set(key, { studio: deposit.attributedStudio || "未匹配渠道", channel: deposit.attributedChannel || "未匹配渠道", cards: 0, deletedCards: 0, attend: 0, validAttend: 0, continuousAttend: 0, cost: 0, depositCount: 0, orderCount: 0, revenue: 0 });
    const row = channelMap.get(key);
    row.depositCount++;
  }
  for (const order of trackOrders) {
    const key = `${order.attributedStudio || "未匹配渠道"}|${order.attributedChannel || "未匹配渠道"}`;
    if (!channelMap.has(key)) channelMap.set(key, { studio: order.attributedStudio || "未匹配渠道", channel: order.attributedChannel || "未匹配渠道", cards: 0, deletedCards: 0, attend: 0, validAttend: 0, continuousAttend: 0, cost: 0, depositCount: 0, orderCount: 0, revenue: 0 });
    const row = channelMap.get(key);
    row.orderCount++;
    row.revenue += order.amount;
  }
  const channelRows = [...channelMap.values()].sort((a, b) => b.revenue - a.revenue || b.cards - a.cards);
  const monthlyTracks = state.tracks.filter((item) => item.startDate?.startsWith(state.month));
  const monthChannelMap = new Map();
  for (const card of monthCards) {
    const studio = card.studio || "未匹配渠道";
    const channel = card.channel || "未匹配渠道";
    const key = `${studio}|${channel}`;
    if (!monthChannelMap.has(key)) monthChannelMap.set(key, { studio, channel, cards: 0, cost: 0, orderCount: 0, revenue: 0 });
    const row = monthChannelMap.get(key);
    row.cards++;
    row.cost += leadCost(card);
  }
  for (const order of monthOrders) {
    const studio = order.attributedStudio || "未匹配渠道";
    const channel = order.attributedChannel || "未匹配渠道";
    const key = `${studio}|${channel}`;
    if (!monthChannelMap.has(key)) monthChannelMap.set(key, { studio, channel, cards: 0, cost: 0, orderCount: 0, revenue: 0 });
    const row = monthChannelMap.get(key);
    row.orderCount++;
    row.revenue += order.amount;
  }
  const monthChannelRows = [...monthChannelMap.values()]
    .map((row) => ({
      ...row,
      ratio: row.cost && row.revenue ? row.cost / (row.revenue * 0.92) * 100 : 0
    }))
    .filter((row) => row.cost > 0 && row.revenue > 0)
    .sort((a, b) => a.ratio - b.ratio || b.revenue - a.revenue);

  const monthEmployeeMap = new Map();
  for (const order of monthOrdersAllTeams) {
    const employee = performanceEmployee(order.employee);
    const row = monthEmployeeMap.get(employee) || { employee, paid: 0, periodPaid: 0, cost: 0, teamIds: new Set() };
    row.paid += order.amount;
    row.teamIds.add(order.teamId || assignmentTeamId(employee, order.trackId || selectedTrack().id));
    monthEmployeeMap.set(employee, row);
  }
  for (const order of monthPeriodOrders) {
    const employee = performanceEmployee(order.employee);
    const row = monthEmployeeMap.get(employee) || { employee, paid: 0, periodPaid: 0, cost: 0, teamIds: new Set() };
    row.periodPaid += order.amount;
    row.teamIds.add(assignmentTeamId(employee, activeTrackForDate(order.date || state.today)?.id || selectedTrack().id));
    monthEmployeeMap.set(employee, row);
  }
  for (const card of monthCardsAllTeams) {
    const employee = performanceEmployee(card.employee);
    const row = monthEmployeeMap.get(employee) || { employee, paid: 0, periodPaid: 0, cost: 0, teamIds: new Set() };
    if (!row.trackCards) row.trackCards = new Map();
    const trackId = card.trackId || "0605";
    const cards = row.trackCards.get(trackId) || [];
    cards.push(card);
    row.trackCards.set(trackId, cards);
    row.teamIds.add(card.teamId || assignmentTeamId(employee, trackId));
    monthEmployeeMap.set(employee, row);
  }
  for (const row of monthEmployeeMap.values()) {
    for (const [trackId, cards] of (row.trackCards || new Map()).entries()) {
      row.cost += employeeCost(row.employee, cards, trackId);
    }
  }
  const periodOrderRows = [...monthPeriodOrders.reduce((map, order) => {
    if (!order.employee) return map;
    const employee = performanceEmployee(order.employee);
    const row = map.get(employee) || { employee, orders: 0, paid: 0 };
    row.orders++;
    row.paid += order.amount;
    map.set(employee, row);
    return map;
  }, new Map()).values()].sort((a, b) => b.paid - a.paid);
  periodOrderRows.forEach((row, index) => {
    row.rank = index + 1;
    row.performanceRevenue = row.paid * 0.92;
  });
  const ranked = [...monthEmployeeMap.values()]
    .filter((row) => row.employee)
    .map((row) => ({ ...row, teamIds: [...(row.teamIds || new Set())], paidWithPeriod: row.paid + (row.periodPaid || 0) }))
    .sort((a, b) => b.paidWithPeriod - a.paidWithPeriod);
  const allPerformanceRows = ranked.map((row, index) => {
    const multiplier = index < 2 ? 1.2 : 1;
    const monthlyProgressRevenue = row.paidWithPeriod * 0.92;
    const perfRevenue = monthlyProgressRevenue * multiplier;
    const ratio = performanceRatio(row.cost, row.paid);
    const ratioWithPeriod = performanceRatio(row.cost, row.paidWithPeriod);
    const coeff = coefficient(ratio);
    const commission = tieredCommission(perfRevenue, coeff);
    const trackReward = monthlyTracks.reduce((sum, track) => sum + employeeTrackReward(row.employee, track, ordersWithOverrides), 0);
    const monthlyTarget = 100000;
    return {
      ...row,
      rank: index + 1,
      multiplier,
      monthlyProgressRevenue,
      monthlyTarget,
      monthlyDiff: monthlyTarget - monthlyProgressRevenue,
      monthlyCompletion: monthlyProgressRevenue / monthlyTarget,
      perfRevenue,
      ratio,
      ratioWithPeriod,
      coeff,
      commission,
      trackReward,
      total: commission + trackReward
    };
  });
  const performanceRows = viewTeamId === ALL_TEAMS
    ? allPerformanceRows
    : allPerformanceRows.filter((row) => row.teamIds.includes(viewTeamId));

  return {
    track,
    viewTeamId,
    teamRows,
    trackCards,
    trackOrders,
    trackDeposits,
    trackCost,
    referenceTeamCost,
    employeeRows,
    attendanceRows,
    channelRows,
    continuousAttendanceDays,
    monthChannelRows,
    performanceRows,
    periodOrderRows,
    ordersWithOverrides,
    depositsWithOverrides,
    matchStats: orderMatchStats(trackOrders),
    depositStats: depositMatchStats(trackDeposits)
  };
}

function render() {
  syncSelectedTrackWithMonth();
  renderMonthSelect();
  document.querySelector("#todayInput").value = state.today;
  const currentTrack = selectedTrack();
  const trackCards = data.cards.filter((card) => inTrack(card, currentTrack)).length;
  const activeOrderCount = applyOrderOverrides().length;
  document.querySelector("#subtitle").textContent = `数据生成时间 ${new Date(data.generatedAt).toLocaleString("zh-CN")} · 月订单 ${activeOrderCount} 笔 · 跨期订单 ${(data.periodOrders || []).length} 笔 · 总名片 ${data.cards.length} 张 · 当前轨次名片 ${trackCards} 张`;
  renderWarnings();
  renderTrackSelect();
  renderTeamSelect();
  renderTrackConfig();
  renderTeamConfig();
  renderUploadAvailability();
  renderCostConfig();
  const model = aggregate();
  renderChromeMode();
  renderKpis(model);
  renderTeamProgressTable(model.teamRows);
  renderTeamOverview(model);
  renderCharts(model);
  renderEmployeeTable(model.employeeRows, model.trackCost);
  renderAttendanceTable(model.attendanceRows);
  renderFullAttendanceTable(model.attendanceRows);
  renderChannelTable(model.channelRows, model.continuousAttendanceDays);
  renderPerformanceTable(model.performanceRows);
  if (adminMode) renderDiagnostics();
  renderOrderMatchModal(model);
  renderDepositMatchModal(model);
}

function renderChromeMode() {
  document.body.classList.toggle("public-view", !adminMode);
  for (const node of document.querySelectorAll(".admin-only")) {
    node.classList.toggle("hidden", !adminMode);
  }
}

function renderUploadAvailability() {
  const uploadTools = document.querySelector(".upload-tools");
  if (!uploadTools) return;
  uploadTools.classList.toggle("hidden", !uploadEnabled);
  const syncButton = document.querySelector("#syncStateToDisk");
  const syncStatus = document.querySelector("#stateSyncStatus");
  if (syncButton) syncButton.classList.toggle("hidden", !isLocalServer);
  if (syncStatus && !isLocalServer) syncStatus.textContent = "线上页只读取已同步成本";
}

function renderWarnings() {
  document.querySelector("#warnings").innerHTML = data.warnings.map((warning) => `<div class="warning">${warning}</div>`).join("");
}

function renderMonthSelect() {
  const select = document.querySelector("#monthInput");
  const months = [...new Set(state.tracks.map((track) => track.startDate?.slice(0, 7)).filter(Boolean))].sort();
  if (state.month && !months.includes(state.month)) months.push(state.month);
  select.innerHTML = months.map((month) => `<option value="${month}" ${month === state.month ? "selected" : ""}>${month}</option>`).join("");
}

function renderTrackSelect() {
  const select = document.querySelector("#trackSelect");
  const tracks = tracksForMonth();
  select.innerHTML = tracks.map((track) => `<option value="${track.id}" ${track.id === state.selectedTrack ? "selected" : ""}>${track.name}</option>`).join("");
  for (const selector of ["#cardsTrackSelect", "#ordersReplaceTrackSelect", "#ordersTrackSelect", "#depositsTrackSelect", "#attendanceTrackSelect"]) {
    const uploadTrackSelect = document.querySelector(selector);
    if (uploadTrackSelect) {
      uploadTrackSelect.innerHTML = tracks.map((track) => `<option value="${track.id}" ${track.id === state.selectedTrack ? "selected" : ""}>上传到：${track.name}</option>`).join("");
    }
  }
}

function renderTeamSelect() {
  const select = document.querySelector("#teamSelect");
  if (!select) return;
  const current = selectedTeamId();
  const hasUnassigned = employeesForTrack(selectedTrack()).some((employee) => assignmentTeamId(employee, selectedTrack().id) === UNASSIGNED_TEAM);
  select.innerHTML = [
    `<option value="${ALL_TEAMS}" ${current === ALL_TEAMS ? "selected" : ""}>全部团队</option>`,
    ...state.teams
      .filter((team) => team.active !== false || team.id === current)
      .map((team) => `<option value="${escapeHtml(team.id)}" ${team.id === current ? "selected" : ""}>${escapeHtml(team.name)}</option>`),
    hasUnassigned ? `<option value="${UNASSIGNED_TEAM}" ${current === UNASSIGNED_TEAM ? "selected" : ""}>未分配团队</option>` : ""
  ].join("");
}

function renderTrackConfig() {
  document.querySelector("#trackConfig").innerHTML = state.tracks.map((track, index) => `
    <div class="track-card">
      <label>轨次名称 <input data-track-name="${index}" value="${track.name}"></label>
      <label>开始日期 <input type="date" data-track-start="${index}" value="${track.startDate}"></label>
      <div class="settled">${track.settled ? `已结算：${track.settledAt || "手动结算"}` : "未结算"}</div>
    </div>
  `).join("");
}

function renderTeamConfig() {
  const track = selectedTrack();
  const employees = employeesForTrack(track);
  const unassigned = employees.filter((employee) => assignmentTeamId(employee, track.id) === UNASSIGNED_TEAM);
  const hint = document.querySelector("#teamConfigHint");
  if (hint) hint.textContent = unassigned.length ? `当前轨次还有 ${unassigned.length} 位运营老师未分配团队。` : "当前轨次人员均已分配团队。";
  const teamConfig = document.querySelector("#teamConfig");
  if (teamConfig) {
    teamConfig.innerHTML = state.teams.map((team, index) => `
      <div class="team-config-card ${team.active === false ? "inactive" : ""}">
        <label>团队名称 <input data-team-name="${index}" value="${escapeHtml(team.name)}"></label>
        <div class="row-actions">
          <button class="secondary-button" data-toggle-team="${index}">${team.active === false ? "启用" : "停用"}</button>
        </div>
      </div>
    `).join("");
  }
  const assignment = trackAssignments(track.id);
  const assignmentConfig = document.querySelector("#teamAssignmentConfig");
  if (assignmentConfig) {
    assignmentConfig.innerHTML = employees.map((employee) => {
      const teamId = assignment[employee] || (assignmentTeamId(employee, track.id) === UNASSIGNED_TEAM ? "" : assignmentTeamId(employee, track.id));
      const teamOptions = new Map(activeTeams().map((team) => [team.id, team]));
      const selectedInactiveTeam = state.teams.find((team) => team.id === teamId);
      if (selectedInactiveTeam) teamOptions.set(selectedInactiveTeam.id, selectedInactiveTeam);
      const options = [
        `<option value="">未分配团队</option>`,
        ...[...teamOptions.values()].map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}${team.active === false ? "（已停用）" : ""}</option>`)
      ].join("");
      return `
        <label class="assignment-row">
          <span>${escapeHtml(employee)}</span>
          <select data-employee-team="${escapeHtml(employee)}">
            ${options.replace(`value="${escapeHtml(teamId)}"`, `value="${escapeHtml(teamId)}" selected`)}
          </select>
        </label>
      `;
    }).join("") || `<div class="muted">当前轨次还没有可分配的运营老师。</div>`;
  }
}

function renderTeamProgressTable(rows) {
  table("#teamProgressTable", ["团队", "名片", "订金", "订单", "成交", "成本", "目标流水", "差额", "费比", "完成度"], rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.teamName)}</td>
      <td>${row.cards}</td>
      <td>${row.deposits}</td>
      <td>${row.orders}</td>
      <td>${currency.format(row.revenue)}</td>
      <td>${currency.format(row.cost)}</td>
      <td>${currency.format(row.required)}</td>
      <td class="${amountClass(row.diff)}">${currency.format(row.diff)}</td>
      <td class="${ratioClass(row.ratio)}">${row.ratio ? `${number.format(row.ratio)}%` : "未计算"}</td>
      <td class="${completionClass(row.completion)}">${pct.format(row.completion)}</td>
    </tr>
  `));
}

function renderCostConfig() {
  const track = selectedTrack();
  const pairs = new Map();
  for (const card of data.cards.filter((card) => inTrack(card, track))) {
    const studio = card.studio || "未匹配渠道";
    const channel = card.channel || "未匹配渠道";
    const key = `${studio}|${channel}`;
    pairs.set(key, { studio, channel, count: (pairs.get(key)?.count || 0) + 1 });
  }
  document.querySelector("#costGrid").innerHTML = [...pairs.values()].map((item) => `
    <div class="cost-card">
      <strong>${item.studio}</strong>
      <div>${item.channel}</div>
      <div class="muted">名片 ${item.count} 张</div>
      <label>均价 <input type="number" min="0" step="0.01" data-cost="${costKey(item.studio, item.channel)}" value="${state.costs[costKey(item.studio, item.channel)] || ""}"></label>
    </div>
  `).join("");
}

function renderKpis({ employeeRows, channelRows, trackOrders, trackCards, track, trackCost, matchStats, performanceRows }) {
  const cost = trackCost ?? employeeRows.reduce((sum, row) => sum + row.cost, 0);
  const revenue = employeeRows.reduce((sum, row) => sum + row.revenue, 0);
  const todayRevenue = employeeRows.reduce((sum, row) => sum + row.todayRevenue, 0);
  const monthPaid = performanceRows.reduce((sum, row) => sum + (row.paidWithPeriod || row.paid || 0), 0);
  const monthPerformanceRevenue = monthPaid * 0.92;
  const targetRatio = targetFor(track);
  const required = targetRevenue(cost, targetRatio);
  const ratio = cost && revenue ? cost / (revenue * 0.92) * 100 : 0;
  const diff = required - revenue;
  const todayRequired = targetRevenue(cost, targetRatio);
  document.querySelector("#kpis").innerHTML = [
    ["轨次成交", currency.format(revenue), `${track.name} · ${track.startDate} 至 ${trackEnd(track)}`],
    ["团队费比", ratio ? `${number.format(ratio)}%` : "成本未填写", `目标 ${targetRatio ? `${targetRatio}%` : "第1-2天不考核"}`],
    ["轨次差额", currency.format(diff), `目标流水 ${currency.format(required)}`, amountClass(diff)],
    ["今日成交", currency.format(todayRevenue), `今日目标 ${currency.format(todayRequired)}`],
    ["月度绩效流水", currency.format(monthPerformanceRevenue), `含跨期月流水 ${currency.format(monthPaid)}`],
    ["名片/订单", `${trackCards.length} / ${trackOrders.length}`, `${channelRows.length} 个渠道组合`],
    adminMode
      ? ["订单归因率", pct.format(matchStats.total ? (matchStats.total - matchStats.unresolved) / matchStats.total : 0), `名片匹配 ${matchStats.matchedCard} 笔 · 手动 ${matchStats.manual} 笔`]
      : ["渠道组合", channelRows.length, `当前轨次订单 ${trackOrders.length} 笔`]
  ].map(([label, value, hint, cls = ""]) => `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="hint">${hint}</div></div>`).join("");
}

function renderTeamOverview({ performanceRows, channelRows }) {
  const monthPaid = performanceRows.reduce((sum, row) => sum + (row.paid || 0), 0);
  const periodPaid = performanceRows.reduce((sum, row) => sum + (row.periodPaid || 0), 0);
  const monthPaidWithPeriod = monthPaid + periodPaid;
  const monthCost = performanceRows.reduce((sum, row) => sum + (row.cost || 0), 0);
  const monthRatio = performanceRatio(monthCost, monthPaid);
  const monthRatioWithPeriod = performanceRatio(monthCost, monthPaidWithPeriod);
  const target = performanceRows.length * 100000;
  const completion = target ? monthPaidWithPeriod / target : 0;
  const periodShare = monthPaidWithPeriod ? periodPaid / monthPaidWithPeriod : 0;
  const topChannel = channelRows[0];
  document.querySelector("#teamOverview").innerHTML = `
    <div class="overview-hero">
      <div>
        <div class="overview-label">月度已付流水</div>
        <div class="overview-value">${currency.format(monthPaidWithPeriod)}</div>
        <div class="overview-note">当期 ${currency.format(monthPaid)} · 跨期 ${currency.format(periodPaid)}</div>
      </div>
      <div class="overview-badge ${ratioClass(monthRatioWithPeriod)}">${monthRatioWithPeriod ? `${number.format(monthRatioWithPeriod)}%` : "未计算"} 含跨期费比</div>
    </div>
    <div class="overview-metrics">
      ${overviewMetric("月目标完成", completion, pct.format(completion), currency.format(target))}
      ${overviewMetric("跨期占比", periodShare, pct.format(periodShare), currency.format(periodPaid))}
      ${overviewMetric("原月费比", monthRatio ? monthRatio / 100 : 0, monthRatio ? `${number.format(monthRatio)}%` : "未计算", "不含跨期流水")}
    </div>
    <div class="overview-foot">
      <span>参与运营 ${performanceRows.length} 人</span>
      <span>渠道最高：${escapeHtml(topChannel ? `${topChannel.studio} / ${topChannel.channel}` : "暂无")}</span>
    </div>
    <div class="employee-overview-list">
      ${performanceRows.map((row) => `
        <div class="employee-overview-row">
          <div>
            <strong>${escapeHtml(row.employee)}</strong>
            <span>当期 ${currency.format(row.paid)} · 跨期 ${currency.format(row.periodPaid || 0)}</span>
          </div>
          <div>
            <strong>${currency.format(row.paidWithPeriod || row.paid)}</strong>
            <span class="${ratioClass(row.ratioWithPeriod)}">${row.ratioWithPeriod ? `${number.format(row.ratioWithPeriod)}%` : "费比未计算"}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function overviewMetric(label, value, display, hint) {
  const width = Math.max(2, Math.min(100, Number(value || 0) * 100));
  return `
    <div class="overview-metric">
      <div class="overview-metric-top"><span>${label}</span><strong>${display}</strong></div>
      <div class="progress-track"><div class="progress-fill" style="width:${width}%"></div></div>
      <div class="overview-note">${hint}</div>
    </div>
  `;
}

function renderCharts({ employeeRows, performanceRows, channelRows, monthChannelRows }) {
  renderBarChart("#employeeRevenueChart", employeeRows.slice(0, 8).map((row) => ({
    label: row.employee,
    value: row.revenue,
    display: currency.format(row.revenue)
  })));
  renderBarChart("#trackEmployeeRatioChart", employeeRows.filter((row) => row.ratio > 0).sort((a, b) => a.ratio - b.ratio).slice(0, 8).map((row) => ({
    label: row.employee,
    value: row.ratio,
    display: `${number.format(row.ratio)}%`,
    className: ratioClass(row.ratio)
  })), { emptyText: "成本未填写，暂无费比数据" });
  renderBarChart("#monthEmployeeRatioChart", performanceRows.filter((row) => row.ratio > 0).sort((a, b) => a.ratio - b.ratio).slice(0, 8).map((row) => ({
    label: row.employee,
    value: row.ratio,
    display: `${number.format(row.ratio)}%`,
    className: ratioClass(row.ratio)
  })), { emptyText: "成本未填写，暂无费比数据" });
  renderChannelRatioChart(monthChannelRows.slice(0, 8));
}

function renderBarChart(target, rows, options = {}) {
  const node = document.querySelector(target);
  if (!rows.length) {
    node.innerHTML = `<div class="empty-chart">${options.emptyText || "暂无可展示数据"}</div>`;
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  node.innerHTML = rows.map((row) => {
    const width = Math.max(3, Math.min(100, row.value / max * 100));
    const className = row.className || "";
    return `
      <div class="bar-row">
        <div class="bar-label" title="${row.label}">${row.label}</div>
        <div class="bar-track"><div class="bar-fill ${className}" style="width:${width}%"></div></div>
        <div class="bar-value">${row.display}</div>
      </div>
    `;
  }).join("");
}

function renderChannelRatioChart(rows) {
  const node = document.querySelector("#channelRevenueChart");
  if (!rows.length) {
    node.innerHTML = `<div class="empty-chart">成本未填写，暂无渠道费比数据</div>`;
    return;
  }
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 1);
  node.innerHTML = rows.map((row) => {
    const width = Math.max(3, Math.min(100, row.revenue / maxRevenue * 100));
    return `
      <div class="channel-ratio-row">
        <div class="channel-ratio-head">
          <div class="bar-label" title="${escapeHtml(`${row.studio}/${row.channel}`)}">${escapeHtml(`${row.studio}/${row.channel}`)}</div>
          <strong class="${ratioClass(row.ratio)}">${number.format(row.ratio)}%</strong>
        </div>
        <div class="channel-ratio-body">
          <div class="bar-track"><div class="bar-fill ${ratioClass(row.ratio)}" style="width:${width}%"></div></div>
          <span>${currency.format(row.revenue)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function table(target, headers, rows, footerRows = []) {
  document.querySelector(target).innerHTML = `
    <thead><tr>${headers.map((h) => typeof h === "string" ? `<th>${h}</th>` : `<th>${h.html}</th>`).join("")}</tr></thead>
    <tbody>${rows.join("")}</tbody>
    ${footerRows.length ? `<tfoot>${footerRows.join("")}</tfoot>` : ""}
  `;
}

function renderEmployeeTable(rows, trackCost) {
  const targetRatio = targetFor(selectedTrack());
  const headers = ["运营老师", "名片", "成本", "订单", "成交", "费比", `${targetRatio || "-"}%费比差额`, "今日成交", "当轨完成度", "奖励进度"];
  const costCell = (row, isTotal = false) => {
    if (!adminMode) return currency.format(row.cost);
    if (!isTotal) {
      const key = employeeCostKey(row.employee, selectedTrack().id);
      return `<input class="table-number-input" type="number" min="0" step="0.01" data-employee-cost="${escapeHtml(key)}" value="${escapeHtml(state.employeeCosts?.[key] ?? "")}" placeholder="${currency.format(row.referenceCost ?? row.cost)}">`;
    }
    if (selectedTeamId() !== ALL_TEAMS) return currency.format(row.cost);
    const key = teamCostKey(selectedTrack().id);
    return `<input class="table-number-input" type="number" min="0" step="0.01" data-team-cost="${escapeHtml(key)}" value="${escapeHtml(state.teamCosts?.[key] ?? "")}" placeholder="${currency.format(row.cost)}">`;
  };
  const rowHtml = (row, firstCell = row.employee, isTotal = false) => `
    <tr>
      <td>${row.employee}</td><td>${row.cards}</td><td>${costCell(row, isTotal)}</td><td>${row.orders}</td>
      <td>${currency.format(row.revenue)}</td><td class="${ratioClass(row.ratio)}">${row.ratio ? `${number.format(row.ratio)}%` : "未计算"}</td>
      <td class="${amountClass(row.diff)}">${currency.format(row.diff)}</td>
      <td>${currency.format(row.todayRevenue)}</td>
      <td class="${completionClass(row.trackCompletion)}">${pct.format(row.trackCompletion)}</td>
      <td>${rewardStatus(row)}</td>
    </tr>
  `.replace(`<td>${row.employee}</td>`, `<td>${firstCell}</td>`);
  const total = rows.reduce((sum, row) => ({
    employee: "团队总计",
    cards: sum.cards + row.cards,
    cost: sum.cost + row.cost,
    orders: sum.orders + row.orders,
    revenue: sum.revenue + row.revenue,
    todayRevenue: sum.todayRevenue + row.todayRevenue
  }), { employee: "团队总计", cards: 0, cost: 0, orders: 0, revenue: 0, todayRevenue: 0 });
  total.cost = trackCost ?? total.cost;
  total.ratio = total.cost && total.revenue ? total.cost / (total.revenue * 0.92) * 100 : 0;
  total.required = targetRevenue(total.cost, targetRatio);
  total.diff = total.required - total.revenue;
  total.trackCompletion = targetRevenue(total.cost, 130) ? total.revenue / targetRevenue(total.cost, 130) : 0;
  total.rewardProgress = rewardLevels.map((level) => ({ ...level, needed: Math.max(0, targetRevenue(total.cost, level.ratio) - total.revenue) }));
  table("#employeeTable", headers, rows.map((row) => rowHtml(row)), rows.length ? [rowHtml(total, "团队总计", true)] : []);
}

function renderAttendanceTable(rows) {
  const sortedRows = sortAttendanceRows(rows, "attendance");
  const total = attendanceTotalRow(rows);
  const headers = [
    ["employee", "运营老师"],
    ["cards", "当轨名片"],
    ["totalAttend", "出勤人数"],
    ["totalAttendRate", "总出勤率"],
    ["d1Attend", "D1出勤"],
    ["d2Attend", "D2出勤"],
    ["d2AttendDecay", "D2出勤衰减"],
    ["d3Attend", "D3出勤"],
    ["d3AttendDecay", "D3出勤衰减"],
    ["d4Attend", "D4出勤"],
    ["d4AttendDecay", "D4出勤衰减"],
    ["d5Attend", "D5出勤"],
    ["d5AttendDecay", "D5出勤衰减"]
  ].map(([key, label]) => ({ html: metricSortHeader("attendance", key, label) }));
  const rowHtml = (row, isTotal = false) => `
    <tr>
      <td>${escapeHtml(row.employee)}</td>
      <td>${row.cards}</td>
      <td>${row.totalAttend}</td>
      <td class="${isTotal ? "" : metricCompareClass(row.totalAttendRate, total.totalAttendRate)}">${pct.format(row.totalAttendRate)}</td>
      ${dailyRateCells(row.dayAttendRates, row.dayAttendDecays, total.dayAttendRates, total.dayAttendDecays, isTotal)}
    </tr>
  `;
  table("#attendanceTable", headers, sortedRows.map((row) => rowHtml(row)), rows.length ? [rowHtml(total, true)] : []);
}

function renderFullAttendanceTable(rows) {
  const sortedRows = sortAttendanceRows(rows, "fullAttendance");
  const total = attendanceTotalRow(rows);
  const headers = [
    ["employee", "运营老师"],
    ["cards", "当轨名片"],
    ["totalFull", "足课人数"],
    ["d1Full", "D1足课"],
    ["d2Full", "D2足课"],
    ["d2FullDecay", "D2足课衰减"],
    ["d3Full", "D3足课"],
    ["d3FullDecay", "D3足课衰减"],
    ["d4Full", "D4足课"],
    ["d4FullDecay", "D4足课衰减"],
    ["d5Full", "D5足课"],
    ["d5FullDecay", "D5足课衰减"]
  ].map(([key, label]) => ({ html: metricSortHeader("fullAttendance", key, label) }));
  const rowHtml = (row, isTotal = false) => `
    <tr>
      <td>${escapeHtml(row.employee)}</td>
      <td>${row.cards}</td>
      <td>${row.totalFull}</td>
      ${dailyRateCells(row.dayFullRates, row.dayFullDecays, total.dayFullRates, total.dayFullDecays, isTotal)}
    </tr>
  `;
  table("#fullAttendanceTable", headers, sortedRows.map((row) => rowHtml(row)), rows.length ? [rowHtml(total, true)] : []);
}

function dailyRateCells(rates, decays, averageRates = [], averageDecays = [], isTotal = false) {
  return rates.map((rate, index) => {
    const cells = [`<td class="${isTotal ? "" : metricCompareClass(rate, averageRates[index])}">${pct.format(rate)}</td>`];
    if (index > 0) {
      const decay = decays[index];
      cells.push(`<td class="${isTotal ? "" : metricCompareClass(decay, averageDecays[index], true)}">${decay === null ? "-" : pct.format(decay)}</td>`);
    }
    return cells.join("");
  }).join("");
}

function metricCompareClass(value, average, lowerIsBetter = false) {
  if (value === null || average === null || value === undefined || average === undefined || value === average) return "";
  return value > average
    ? (lowerIsBetter ? "bad" : "good")
    : (lowerIsBetter ? "good" : "bad");
}

function attendanceTotalRow(rows) {
  const total = rows.reduce((sum, row) => {
    sum.cards += row.cards;
    sum.records += row.records;
    sum.totalAttend += row.totalAttend;
    sum.totalFull += row.totalFull;
    row.dayAttendCounts.forEach((count, index) => { sum.dayAttendCounts[index] += count; });
    row.dayFullCounts.forEach((count, index) => { sum.dayFullCounts[index] += count; });
    return sum;
  }, { employee: "团队总计", cards: 0, records: 0, totalAttend: 0, totalFull: 0, dayAttendCounts: [0, 0, 0, 0, 0], dayFullCounts: [0, 0, 0, 0, 0] });
  total.totalAttendRate = total.cards ? total.totalAttend / total.cards : 0;
  total.dayAttendRates = total.dayAttendCounts.map((count) => total.cards ? count / total.cards : 0);
  total.dayAttendDecays = dailyDecayRates(total.dayAttendRates);
  total.dayFullRates = total.dayFullCounts.map((count) => total.cards ? count / total.cards : 0);
  total.dayFullDecays = dailyDecayRates(total.dayFullRates);
  return total;
}

function metricSortHeader(type, key, label) {
  const stateKey = type === "attendance" ? "attendanceSort" : "fullAttendanceSort";
  const attr = type === "attendance" ? "data-attendance-sort" : "data-full-attendance-sort";
  const active = state[stateKey]?.key === key;
  const mark = active ? (state[stateKey].direction === "asc" ? "↑" : "↓") : "↕";
  return `<button class="sort-button ${active ? "active" : ""}" ${attr}="${key}" title="按${label}排序">${label}<span>${mark}</span></button>`;
}

function attendanceMetric(row, key) {
  const dayMatch = /^d([1-5])(Attend|Full)(Decay)?$/.exec(key);
  if (dayMatch) {
    const index = Number(dayMatch[1]) - 1;
    const field = dayMatch[2] === "Attend" ? "dayAttend" : "dayFull";
    return dayMatch[3] ? row[`${field}Decays`][index] : row[`${field}Rates`][index];
  }
  return row[key];
}

function sortAttendanceRows(rows, type) {
  const sort = type === "attendance"
    ? (state.attendanceSort || { key: "totalAttendRate", direction: "desc" })
    : (state.fullAttendanceSort || { key: "d1Full", direction: "desc" });
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = attendanceMetric(a, sort.key);
    const right = attendanceMetric(b, sort.key);
    if (typeof left === "string" || typeof right === "string") {
      return String(left || "").localeCompare(String(right || ""), "zh-CN") * direction || b.records - a.records;
    }
    return ((Number(left) || 0) - (Number(right) || 0)) * direction || b.records - a.records;
  });
}

function rewardStatus(row) {
  if (!row.cost || !row.revenue) return "未计算";
  const next = row.rewardProgress.find((level) => level.needed > 0);
  if (next) return `距${next.ratio}%差 ${currency.format(next.needed)}`;
  return `已达100%档 ${currency.format(555)}`;
}

function renderChannelTable(rows, continuousAttendanceDays = 5) {
  const sortedRows = sortChannelRows(rows);
  const headers = [
    ["studio", "工作室"],
    ["channel", "渠道"],
    ["cards", "名片"],
    ["deletedRate", "删除率"],
    ["attend", "出勤"],
    ["validAttend", "有效出勤"],
    ["attendRate", "出勤率"],
    ["validRate", "有效率"],
    ["continuousRate", `连续出勤${continuousAttendanceDays}天`],
    ["depositCount", "订金"],
    ["depositRate", "订金率"],
    ["orderCount", "订单"],
    ["revenue", "成交"],
    ["conversionRate", "转化率"],
    ["cost", "总成本"],
    ["ratio", "费比"]
  ].map(([key, label]) => ({ html: channelSortHeader(key, label) }));
  table("#channelTable", headers, sortedRows.map((row) => {
    const ratio = row.cost && row.revenue ? row.cost / (row.revenue * 0.92) * 100 : 0;
    return `<tr>
      <td>${row.studio}</td><td>${row.channel}</td><td>${row.cards}</td><td>${pct.format(row.cards ? row.deletedCards / row.cards : 0)}</td><td>${row.attend}</td><td>${row.validAttend}</td>
      <td>${pct.format(row.cards ? row.attend / row.cards : 0)}</td><td>${pct.format(row.cards ? row.validAttend / row.cards : 0)}</td>
      <td>${pct.format(row.cards ? row.continuousAttend / row.cards : 0)}</td>
      <td>${row.depositCount}</td><td>${pct.format(row.cards ? row.depositCount / row.cards : 0)}</td>
      <td>${row.orderCount}</td><td>${currency.format(row.revenue)}</td><td>${pct.format(row.cards ? row.orderCount / row.cards : 0)}</td>
      <td>${currency.format(row.cost)}</td><td class="${ratioClass(ratio)}">${ratio ? `${number.format(ratio)}%` : "未计算"}</td>
    </tr>`;
  }));
}

function channelSortHeader(key, label) {
  const active = state.channelSort?.key === key;
  const mark = active ? (state.channelSort.direction === "asc" ? "↑" : "↓") : "↕";
  return `<button class="sort-button ${active ? "active" : ""}" data-channel-sort="${key}" title="按${label}排序">${label}<span>${mark}</span></button>`;
}

function channelMetric(row, key) {
  const ratio = row.cost && row.revenue ? row.cost / (row.revenue * 0.92) * 100 : 0;
  const metrics = {
    studio: row.studio,
    channel: row.channel,
    cards: row.cards,
    deletedRate: row.cards ? row.deletedCards / row.cards : 0,
    attend: row.attend,
    validAttend: row.validAttend,
    attendRate: row.cards ? row.attend / row.cards : 0,
    validRate: row.cards ? row.validAttend / row.cards : 0,
    continuousRate: row.cards ? row.continuousAttend / row.cards : 0,
    depositCount: row.depositCount,
    depositRate: row.cards ? row.depositCount / row.cards : 0,
    orderCount: row.orderCount,
    revenue: row.revenue,
    conversionRate: row.cards ? row.orderCount / row.cards : 0,
    cost: row.cost,
    ratio
  };
  return metrics[key];
}

function sortChannelRows(rows) {
  const sort = state.channelSort || { key: "revenue", direction: "desc" };
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = channelMetric(a, sort.key);
    const right = channelMetric(b, sort.key);
    if (typeof left === "string" || typeof right === "string") {
      const compared = String(left || "").localeCompare(String(right || ""), "zh-CN");
      return compared * direction || b.revenue - a.revenue || b.cards - a.cards;
    }
    return ((Number(left) || 0) - (Number(right) || 0)) * direction || b.revenue - a.revenue || b.cards - a.cards;
  });
}

function renderPerformanceTable(rows) {
  const total = rows.reduce((sum, row) => {
    sum.paid += row.paid || 0;
    sum.periodPaid += row.periodPaid || 0;
    sum.paidWithPeriod += row.paidWithPeriod || 0;
    sum.monthlyProgressRevenue += row.monthlyProgressRevenue || 0;
    sum.cost += row.cost || 0;
    sum.commission += row.commission || 0;
    sum.trackReward += row.trackReward || 0;
    sum.total += row.total || 0;
    return sum;
  }, { paid: 0, periodPaid: 0, paidWithPeriod: 0, monthlyProgressRevenue: 0, cost: 0, commission: 0, trackReward: 0, total: 0 });
  total.ratio = performanceRatio(total.cost, total.paid);
  total.ratioWithPeriod = performanceRatio(total.cost, total.paidWithPeriod);
  const headers = ["排名", "运营老师", "当期已付", "跨期流水", "月度已付", "真实绩效流水", "月度目标", "月度差额", "完成度", "成本", "月费比", "含跨期费比", "倍数", "核算流水", "系数", "流水绩效", "轨次奖励", "预计总绩效"];
  const rowHtml = (row) => `
    <tr>
      <td>${row.rank}</td><td>${row.employee}</td><td>${currency.format(row.paid)}</td><td>${currency.format(row.periodPaid || 0)}</td>
      <td>${currency.format(row.paidWithPeriod || row.paid)}</td><td>${currency.format(row.monthlyProgressRevenue)}</td>
      <td>${currency.format(row.monthlyTarget)}</td><td class="${amountClass(row.monthlyDiff)}">${currency.format(row.monthlyDiff)}</td>
      <td class="${completionClass(row.monthlyCompletion)}">${pct.format(row.monthlyCompletion)}</td><td>${currency.format(row.cost)}</td>
      <td class="${ratioClass(row.ratio)}">${row.ratio ? `${number.format(row.ratio)}%` : "未计算"}</td>
      <td class="${ratioClass(row.ratioWithPeriod)}">${row.ratioWithPeriod ? `${number.format(row.ratioWithPeriod)}%` : "未计算"}</td>
      <td>${row.multiplier}</td><td>${currency.format(row.perfRevenue)}</td>
      <td>${row.coeff}</td><td>${currency.format(row.commission)}</td><td>${currency.format(row.trackReward)}</td><td>${currency.format(row.total)}</td>
    </tr>
  `;
  const footer = rows.length ? [`
    <tr>
      <td>-</td><td>团队总计</td><td>${currency.format(total.paid)}</td><td>${currency.format(total.periodPaid)}</td>
      <td>${currency.format(total.paidWithPeriod)}</td><td>${currency.format(total.monthlyProgressRevenue)}</td>
      <td>-</td><td>-</td><td>-</td><td>${currency.format(total.cost)}</td>
      <td class="${ratioClass(total.ratio)}">${total.ratio ? `${number.format(total.ratio)}%` : "未计算"}</td>
      <td class="${ratioClass(total.ratioWithPeriod)}">${total.ratioWithPeriod ? `${number.format(total.ratioWithPeriod)}%` : "未计算"}</td>
      <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
    </tr>
  `] : [];
  table("#performanceTable", headers, rows.map(rowHtml), footer);
}

function renderDiagnostics() {
  const sheets = data.sheetSummary.map((file) => `<div class="diag-card"><h3>${file.file}</h3><ul>${file.sheets.map((sheet) => `<li>${sheet.sheetName}: ${sheet.rowCount} 行</li>`).join("")}</ul></div>`).join("");
  const model = aggregate();
  const orders = model.trackOrders;
  const stats = orderMatchStats(orders);
  const deposits = model.trackDeposits;
  const depositStats = depositMatchStats(deposits);
  document.querySelector("#diagnostics").innerHTML = `
    <div class="diag-card"><h3>字段识别</h3><ul>${data.fieldMap.cardFields.concat(data.fieldMap.orderFields, data.fieldMap.periodOrderFields || [], data.fieldMap.depositFields || []).map((field) => `<li>${field}</li>`).join("")}</ul></div>
    <div class="diag-card"><h3>${model.track.name}订单匹配</h3><ul><li>订单 ${stats.total} 笔</li><li>匹配名片 ${stats.matchedCard} 笔</li><li>手动修正 ${stats.manual} 笔</li><li>未处理 ${stats.unresolved} 笔</li></ul></div>
    <div class="diag-card"><h3>${model.track.name}订金匹配</h3><ul><li>订金 ${depositStats.total} 笔</li><li>匹配名片 ${depositStats.matchedCard} 笔</li><li>手动修正 ${depositStats.manual} 笔</li><li>未处理 ${depositStats.unresolved} 笔</li></ul></div>
    ${sheets}
  `;
}

function renderOrderMatchModal(model = aggregate()) {
  const modal = document.querySelector("#orderMatchModal");
  if (!modal || modal.classList.contains("hidden")) return;
  const search = tidy(document.querySelector("#orderMatchSearch")?.value).toLowerCase();
  const filter = document.querySelector("#orderMatchFilter")?.value || "all";
  const stats = model.matchStats;
  const ordersIncludingDeleted = applyOrderOverrides({ includeDeleted: true });
  const deletedCount = ordersIncludingDeleted.filter((order) => order._deleted && inTrack(order, model.track) && (selectedTeamId() === ALL_TEAMS || order.teamId === selectedTeamId())).length;
  document.querySelector("#orderMatchSummary").textContent = `共 ${stats.total} 笔订单，名片匹配 ${stats.matchedCard} 笔，手动修正 ${stats.manual} 笔，未处理 ${stats.unresolved} 笔，已删除 ${deletedCount} 笔`;

  const cards = cardCatalog(model.track).sort((a, b) => a.nickname.localeCompare(b.nickname, "zh-CN"));
  const ordersForModal = filter === "deleted" ? ordersIncludingDeleted : model.ordersWithOverrides;

  const rows = ordersForModal
    .filter((order) => inTrack(order, model.track))
    .filter((order) => filter === "deleted" ? (selectedTeamId() === ALL_TEAMS || order.teamId === selectedTeamId()) : true)
    .filter((order) => {
      if (filter === "deleted") return order._deleted;
      if (filter === "unmatched" && (order.matchedCard || order._manualOverride)) return false;
      if (filter === "manual" && !order._manualOverride) return false;
      if (filter === "matched" && !order.matchedCard) return false;
      if (!search) return true;
      return [order.customer, order.employee, order.studio, order.channel, order.attributedStudio, order.attributedChannel, teamLabel(order.teamId), order.source]
        .some((value) => tidy(value).toLowerCase().includes(search));
    })
    .map((order) => {
      const override = state.orderOverrides?.[order._orderKey] || {};
      const status = order._deleted ? "已删除" : order._manualOverride ? "手动" : order.matchedCard ? "已匹配" : "未匹配";
      const statusClass = order._deleted ? "bad" : order._manualOverride ? "warn" : order.matchedCard ? "good" : "bad";
      const systemCard = systemMatchedCard(order, cards);
      const operation = order._deleted
        ? `<button class="secondary-button" data-restore-order="${escapeHtml(order._orderKey)}">恢复</button>`
        : `<div class="row-actions"><button class="secondary-button" data-reset-order="${escapeHtml(order._orderKey)}">重置</button><button class="danger-button" data-delete-order="${escapeHtml(order._orderKey)}">删除</button></div>`;
      return `
        <tr>
          <td><span class="${statusClass}">${status}</span></td>
          <td>${escapeHtml(order.customer || "-")}</td>
          <td>${escapeHtml(order.date || "-")}</td>
          <td>${currency.format(order.amount || 0)}</td>
          <td>
            <div>${escapeHtml(order.employee || "-")}</div>
            <div class="muted">${escapeHtml(order.source || "")}</div>
          </td>
          <td>
            <div>${escapeHtml(order.studio || "-")}</div>
            <div class="muted">${escapeHtml(order.channel || "-")}</div>
          </td>
          <td>
            <div>${escapeHtml(order.attributedStudio || "-")}</div>
            <div class="muted">${escapeHtml(order.attributedChannel || "-")}</div>
          </td>
          <td>
            ${order._deleted ? escapeHtml(teamLabel(order.teamId)) : renderTeamPicker(order._orderKey, override.teamId || "", order._deleted)}
            <div class="muted">${escapeHtml(teamLabel(order.teamId))}</div>
          </td>
          <td>
            ${order._deleted ? `<div class="muted">已删除，不参与流水统计</div>` : renderMatchCardPicker("order", order._orderKey, override.cardKey || "", cards)}
            ${order._deleted ? "" : `<div class="muted">${systemCard ? `系统匹配：${escapeHtml(systemCard._label)}` : "未找到系统匹配名片"}</div>`}
          </td>
          <td><input class="match-small-input" data-order-employee="${escapeHtml(order._orderKey)}" value="${escapeHtml(override.employee || "")}" placeholder="${escapeHtml(order.employee || "运营")}" ${order._deleted ? "disabled" : ""}></td>
          <td><input class="match-small-input" data-order-studio="${escapeHtml(order._orderKey)}" value="${escapeHtml(override.studio || "")}" placeholder="${escapeHtml(order.attributedStudio || "工作室")}" ${order._deleted ? "disabled" : ""}></td>
          <td><input class="match-small-input" data-order-channel="${escapeHtml(order._orderKey)}" value="${escapeHtml(override.channel || "")}" placeholder="${escapeHtml(order.attributedChannel || "渠道")}" ${order._deleted ? "disabled" : ""}></td>
          <td>${operation}</td>
        </tr>
      `;
    });

  table("#orderMatchTable", ["状态", "客户", "日期", "金额", "订单员工", "原始渠道", "当前归因", "归属团队", "匹配名片", "改运营", "改工作室", "改渠道", "操作"], rows);
}

function renderDepositMatchModal(model = aggregate()) {
  const modal = document.querySelector("#depositMatchModal");
  if (!modal || modal.classList.contains("hidden")) return;
  const search = tidy(document.querySelector("#depositMatchSearch")?.value).toLowerCase();
  const filter = document.querySelector("#depositMatchFilter")?.value || "all";
  const stats = model.depositStats;
  document.querySelector("#depositMatchSummary").textContent = `共 ${stats.total} 笔订金，名片匹配 ${stats.matchedCard} 笔，手动修正 ${stats.manual} 笔，未处理 ${stats.unresolved} 笔`;

  const cards = cardCatalog(model.track).sort((a, b) => a.nickname.localeCompare(b.nickname, "zh-CN"));

  const rows = model.depositsWithOverrides
    .filter((deposit) => inTrack(deposit, model.track))
    .filter((deposit) => {
      if (filter === "unmatched" && (deposit.matchedCard || deposit._manualOverride)) return false;
      if (filter === "manual" && !deposit._manualOverride) return false;
      if (filter === "matched" && !deposit.matchedCard) return false;
      if (!search) return true;
      return [deposit.customer, deposit.employee, deposit.attributedStudio, deposit.attributedChannel, deposit.source]
        .some((value) => tidy(value).toLowerCase().includes(search));
    })
    .map((deposit) => {
      const override = state.depositOverrides?.[deposit._depositKey] || {};
      const status = deposit._manualOverride ? "手动" : deposit.matchedCard ? "已匹配" : "未匹配";
      const statusClass = deposit._manualOverride ? "warn" : deposit.matchedCard ? "good" : "bad";
      const systemCard = systemMatchedCard(deposit, cards);
      return `
        <tr>
          <td><span class="${statusClass}">${status}</span></td>
          <td>${escapeHtml(deposit.customer || "-")}</td>
          <td>${escapeHtml(deposit.date || "-")}</td>
          <td>${currency.format(deposit.amount || 0)}</td>
          <td>
            <div>${escapeHtml(deposit.employee || "-")}</div>
            <div class="muted">${escapeHtml(deposit.source || "")}</div>
          </td>
          <td>
            <div>${escapeHtml(deposit.attributedStudio || "-")}</div>
            <div class="muted">${escapeHtml(deposit.attributedChannel || "-")}</div>
          </td>
          <td>
            ${renderMatchCardPicker("deposit", deposit._depositKey, override.cardKey || "", cards)}
            <div class="muted">${systemCard ? `系统匹配：${escapeHtml(systemCard._label)}` : "未找到系统匹配名片"}</div>
          </td>
          <td><input class="match-small-input" data-deposit-employee="${escapeHtml(deposit._depositKey)}" value="${escapeHtml(override.employee || "")}" placeholder="${escapeHtml(deposit.employee || "运营")}"></td>
          <td><input class="match-small-input" data-deposit-studio="${escapeHtml(deposit._depositKey)}" value="${escapeHtml(override.studio || "")}" placeholder="${escapeHtml(deposit.attributedStudio || "工作室")}"></td>
          <td><input class="match-small-input" data-deposit-channel="${escapeHtml(deposit._depositKey)}" value="${escapeHtml(override.channel || "")}" placeholder="${escapeHtml(deposit.attributedChannel || "渠道")}"></td>
          <td><button class="secondary-button" data-reset-deposit="${escapeHtml(deposit._depositKey)}">重置</button></td>
        </tr>
      `;
    });

  table("#depositMatchTable", ["状态", "客户", "日期", "金额", "发放人", "当前归因", "匹配名片", "改运营", "改工作室", "改渠道", "操作"], rows);
}

function openOrderMatchModal() {
  const modal = document.querySelector("#orderMatchModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderOrderMatchModal();
}

function openDepositMatchModal() {
  const modal = document.querySelector("#depositMatchModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderDepositMatchModal();
}

function closeOrderMatchModal() {
  const modal = document.querySelector("#orderMatchModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function closeDepositMatchModal() {
  const modal = document.querySelector("#depositMatchModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function updateOrderOverride(key, patch) {
  if (state.deletedOrders?.[key]) return;
  state.orderOverrides ||= {};
  const current = state.orderOverrides[key] || {};
  const next = { ...current, ...patch };
  for (const field of ["cardKey", "employee", "studio", "channel", "teamId"]) {
    if (!tidy(next[field])) delete next[field];
  }
  if (Object.keys(next).length) state.orderOverrides[key] = next;
  else delete state.orderOverrides[key];
  saveState();
  render();
}

function deleteOrder(key) {
  const order = applyOrderOverrides({ includeDeleted: true }).find((item) => item._orderKey === key);
  if (!order || order._deleted) return;
  const label = [order.customer || "未命名客户", order.date, currency.format(order.amount || 0)].filter(Boolean).join(" / ");
  if (!window.confirm(`确认删除这笔订单吗？\n${label}\n删除后，这笔订单产生的流水会从大屏统计里移除。`)) return;
  state.deletedOrders ||= {};
  state.deletedOrders[key] = {
    deletedAt: new Date().toISOString(),
    customer: order.customer || "",
    amount: order.amount || 0,
    date: order.date || "",
    source: order.source || ""
  };
  if (state.orderOverrides?.[key]) delete state.orderOverrides[key];
  saveState();
  render();
}

function restoreOrder(key) {
  if (!state.deletedOrders?.[key]) return;
  delete state.deletedOrders[key];
  saveState();
  render();
}

function updateDepositOverride(key, patch) {
  state.depositOverrides ||= {};
  const current = state.depositOverrides[key] || {};
  const next = { ...current, ...patch };
  for (const field of ["cardKey", "employee", "studio", "channel"]) {
    if (!tidy(next[field])) delete next[field];
  }
  if (Object.keys(next).length) state.depositOverrides[key] = next;
  else delete state.depositOverrides[key];
  saveState();
  render();
}

function updateEmployeeCost(key, value) {
  state.employeeCosts ||= {};
  const next = tidy(value);
  if (next === "") delete state.employeeCosts[key];
  else state.employeeCosts[key] = next;
  saveState();
}

function updateTeamCost(key, value) {
  state.teamCosts ||= {};
  const next = tidy(value);
  if (next === "") delete state.teamCosts[key];
  else state.teamCosts[key] = next;
  saveState();
}

async function refreshData() {
  if (cloudEnabled) {
    const result = await fetch(`/.netlify/functions/data?ts=${Date.now()}`, { cache: "no-store" }).then((res) => res.json());
    if (result.ok && result.generated) data = result.generated;
    else data = await fetch(`./data/generated.json?ts=${Date.now()}`).then((res) => res.json());
  } else {
    data = await fetch(`./data/generated.json?ts=${Date.now()}`).then((res) => res.json());
  }
  render();
}

async function uploadFile(kind, file) {
  if (!uploadEnabled) throw new Error("线上展示页不支持直接上传，请在 Mac 本机更新后推送。");
  const status = document.querySelector("#uploadStatus");
  const trackSelectMap = {
    cards: "#cardsTrackSelect",
    ordersReplace: "#ordersReplaceTrackSelect",
    orders: "#ordersTrackSelect",
    periodOrders: "",
    deposits: "#depositsTrackSelect",
    attendance: "#attendanceTrackSelect"
  };
  const uploadTrackId = trackSelectMap[kind] ? document.querySelector(trackSelectMap[kind])?.value || selectedTrack().id : selectedTrack().id;
  const uploadTrack = state.tracks.find((track) => track.id === uploadTrackId) || selectedTrack();
  const periodMode = document.querySelector("#periodOrdersMode")?.value || "replace";
  const label = kind === "cards" ? `${uploadTrack.name}名片表` : kind === "ordersReplace" ? `${uploadTrack.name}订单总表` : kind === "periodOrders" ? (periodMode === "add" ? "新增跨期订单" : "跨期订单") : kind === "deposits" ? `${uploadTrack.name}订金列表` : kind === "attendance" ? `${uploadTrack.name}出勤表` : `${uploadTrack.name}新订单表`;
  status.textContent = `正在上传${label}...`;
  const response = cloudEnabled
    ? await fetch("/.netlify/functions/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        mode: kind === "periodOrders" ? periodMode : undefined,
        trackId: uploadTrack.id,
        filename: file.name,
        fileBase64: await fileToBase64(file),
        currentData: {
          cards: data.cards,
          orders: data.orders,
          periodOrders: data.periodOrders || [],
          deposits: data.deposits || [],
          attendance: data.attendance || [],
          files: data.files,
          defaults: data.defaults
        }
      })
    })
    : await fetch(`/api/upload?kind=${kind}&mode=${encodeURIComponent(kind === "periodOrders" ? periodMode : "")}&trackId=${encodeURIComponent(uploadTrack.id)}&filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await file.arrayBuffer()
    });
  const result = await readJsonResponse(response);
  if (!result.ok) throw new Error(result.error || "上传失败");
  if (result.generated) {
    data = result.generated;
    render();
  } else {
    await refreshData();
  }
  status.textContent = `${label}已并入统计，数据已重新计算。`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `上传接口异常：${response.status} ${text || response.statusText}` };
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.orderCard !== undefined) {
    updateOrderOverride(target.dataset.orderCard, { cardKey: target.value });
    return;
  }
  if (target.dataset.orderEmployee !== undefined) {
    updateOrderOverride(target.dataset.orderEmployee, { employee: target.value });
    return;
  }
  if (target.dataset.orderStudio !== undefined) {
    updateOrderOverride(target.dataset.orderStudio, { studio: target.value });
    return;
  }
  if (target.dataset.orderChannel !== undefined) {
    updateOrderOverride(target.dataset.orderChannel, { channel: target.value });
    return;
  }
  if (target.dataset.orderTeam !== undefined) {
    updateOrderOverride(target.dataset.orderTeam, { teamId: target.value });
    return;
  }
  if (target.dataset.depositCard !== undefined) {
    updateDepositOverride(target.dataset.depositCard, { cardKey: target.value });
    return;
  }
  if (target.dataset.depositEmployee !== undefined) {
    updateDepositOverride(target.dataset.depositEmployee, { employee: target.value });
    return;
  }
  if (target.dataset.depositStudio !== undefined) {
    updateDepositOverride(target.dataset.depositStudio, { studio: target.value });
    return;
  }
  if (target.dataset.depositChannel !== undefined) {
    updateDepositOverride(target.dataset.depositChannel, { channel: target.value });
    return;
  }
  if (target.id === "monthInput") {
    state.month = target.value;
    syncSelectedTrackWithMonth();
  }
  if (target.id === "todayInput") state.today = target.value;
  if (target.dataset.trackName !== undefined) state.tracks[Number(target.dataset.trackName)].name = target.value;
  if (target.dataset.trackStart !== undefined) state.tracks[Number(target.dataset.trackStart)].startDate = target.value;
  if (target.dataset.teamName !== undefined) state.teams[Number(target.dataset.teamName)].name = target.value;
  if (target.dataset.employeeTeam !== undefined) {
    const assignments = trackAssignments(selectedTrack().id);
    const employee = normalizeEmployeeName(target.dataset.employeeTeam);
    if (target.value) assignments[employee] = target.value;
    else delete assignments[employee];
  }
  if (target.dataset.cost) state.costs[target.dataset.cost] = target.value;
  if (target.dataset.employeeCost) {
    updateEmployeeCost(target.dataset.employeeCost, target.value);
    render();
    return;
  }
  if (target.dataset.teamCost) {
    updateTeamCost(target.dataset.teamCost, target.value);
    render();
    return;
  }
  saveState();
  render();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.dataset.orderCardSearch !== undefined || target.dataset.depositCardSearch !== undefined) {
    filterMatchCardPicker(target);
    return;
  }
  if (target.id === "orderMatchSearch") {
    renderOrderMatchModal();
  }
  if (target.id === "depositMatchSearch") {
    renderDepositMatchModal();
  }
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (event.key !== "Enter") return;
  if (target.dataset?.orderCardSearch === undefined && target.dataset?.depositCardSearch === undefined) return;

  event.preventDefault();
  const matches = filterMatchCardPicker(target);
  const firstMatch = matches[0];
  if (!firstMatch) return;

  const select = target.closest(".match-card-picker")?.querySelector(".match-card-select");
  if (select) select.value = firstMatch.value;
  if (target.dataset.orderCardSearch !== undefined) {
    updateOrderOverride(target.dataset.orderCardSearch, { cardKey: firstMatch.value });
  } else {
    updateDepositOverride(target.dataset.depositCardSearch, { cardKey: firstMatch.value });
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  const attendanceSortButton = target.closest?.("[data-attendance-sort]");
  if (attendanceSortButton) {
    updateMetricSort("attendanceSort", attendanceSortButton.dataset.attendanceSort);
    return;
  }
  const fullAttendanceSortButton = target.closest?.("[data-full-attendance-sort]");
  if (fullAttendanceSortButton) {
    updateMetricSort("fullAttendanceSort", fullAttendanceSortButton.dataset.fullAttendanceSort);
    return;
  }
  const sortButton = target.closest?.("[data-channel-sort]");
  if (sortButton) {
    const key = sortButton.dataset.channelSort;
    const current = state.channelSort || { key: "revenue", direction: "desc" };
    const textKeys = new Set(["studio", "channel"]);
    const defaultDirection = textKeys.has(key) ? "asc" : "desc";
    state.channelSort = {
      key,
      direction: current.key === key && current.direction === defaultDirection
        ? (defaultDirection === "asc" ? "desc" : "asc")
        : defaultDirection
    };
    saveState();
    render();
    return;
  }
  if (target.dataset.closeOrderMatch !== undefined) closeOrderMatchModal();
  if (target.dataset.resetOrder !== undefined) updateOrderOverride(target.dataset.resetOrder, { cardKey: "", employee: "", studio: "", channel: "", teamId: "" });
  if (target.dataset.deleteOrder !== undefined) deleteOrder(target.dataset.deleteOrder);
  if (target.dataset.restoreOrder !== undefined) restoreOrder(target.dataset.restoreOrder);
  if (target.dataset.toggleTeam !== undefined) {
    const team = state.teams[Number(target.dataset.toggleTeam)];
    if (team) {
      team.active = team.active === false;
      if (team.active === false && state.selectedTeam === team.id) state.selectedTeam = ALL_TEAMS;
      saveState();
      render();
    }
    return;
  }
  if (target.dataset.closeDepositMatch !== undefined) closeDepositMatchModal();
  if (target.dataset.resetDeposit !== undefined) updateDepositOverride(target.dataset.resetDeposit, { cardKey: "", employee: "", studio: "", channel: "" });
});

function updateMetricSort(stateKey, key) {
  const current = state[stateKey] || { key, direction: "desc" };
  const defaultDirection = key === "employee" ? "asc" : "desc";
  state[stateKey] = {
    key,
    direction: current.key === key && current.direction === defaultDirection
      ? (defaultDirection === "asc" ? "desc" : "asc")
      : defaultDirection
  };
  saveState();
  render();
}

document.querySelector("#trackSelect").addEventListener("change", (event) => {
  state.selectedTrack = event.target.value;
  saveState();
  render();
});
document.querySelector("#teamSelect").addEventListener("change", (event) => {
  state.selectedTeam = event.target.value;
  saveState();
  render();
});
document.querySelector("#addTeam").addEventListener("click", () => {
  state.teams.push({ id: `team-${Date.now()}`, name: `团队${state.teams.length + 1}`, active: true });
  saveState();
  render();
});
document.querySelector("#openOrderMatch").addEventListener("click", openOrderMatchModal);
document.querySelector("#openDepositMatch").addEventListener("click", openDepositMatchModal);
document.querySelector("#openConfig").addEventListener("click", () => {
  document.querySelector("#configPanel").classList.remove("hidden");
});
document.querySelector("#closeConfig").addEventListener("click", () => {
  document.querySelector("#configPanel").classList.add("hidden");
});
document.querySelector("#settleTrack").addEventListener("click", () => {
  const track = selectedTrack();
  track.settled = true;
  track.settledAt = state.today;
  saveState();
  render();
});
document.querySelector("#syncStateToDisk").addEventListener("click", async () => {
  const status = document.querySelector("#stateSyncStatus");
  try {
    status.textContent = "正在保存...";
    await persistStateToDisk();
    status.textContent = "已保存，双击桌面同步文件即可更新线上";
  } catch (error) {
    status.textContent = error.message;
  }
});
document.querySelector("#toggleDiagnostics").addEventListener("click", (event) => {
  const panel = document.querySelector("#diagnostics");
  const hidden = panel.classList.toggle("hidden");
  event.target.textContent = hidden ? "展开" : "收起";
});
document.querySelector("#orderMatchFilter").addEventListener("change", renderOrderMatchModal);
document.querySelector("#depositMatchFilter").addEventListener("change", renderDepositMatchModal);
document.querySelector("#resetOrderOverrides").addEventListener("click", () => {
  state.orderOverrides = {};
  saveState();
  render();
});
document.querySelector("#resetDepositOverrides").addEventListener("click", () => {
  state.depositOverrides = {};
  saveState();
  render();
});
document.querySelector("#cardsUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await uploadFile("cards", file);
  } catch (error) {
    document.querySelector("#uploadStatus").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#ordersReplaceUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await uploadFile("ordersReplace", file);
  } catch (error) {
    document.querySelector("#uploadStatus").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#ordersUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await uploadFile("orders", file);
  } catch (error) {
    document.querySelector("#uploadStatus").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#periodOrdersUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await uploadFile("periodOrders", file);
  } catch (error) {
    document.querySelector("#uploadStatus").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#depositsUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await uploadFile("deposits", file);
  } catch (error) {
    document.querySelector("#uploadStatus").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#attendanceUpload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await uploadFile("attendance", file);
  } catch (error) {
    document.querySelector("#uploadStatus").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});

render();
