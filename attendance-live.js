(function () {
  const refreshMs = 60000;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function archiveDate(record) {
    if (record.archiveDate) return record.archiveDate;
    if (!record.recordedAt) return "-";
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(record.recordedAt));
  }

  function roomName(record) {
    return record.monitorName || record.archiveRoomName || record.roomName || "未命名直播间";
  }

  function roomKey(record) {
    return record.monitorId || `legacy:${roomName(record)}`;
  }

  function formatTime(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    }).format(new Date(value));
  }

  function rate(online, expected) {
    if (!expected) return "-";
    return `${(((online || 0) / expected) * 100).toFixed(1)}%`;
  }

  function render(records, errorMessage = "") {
    const status = document.querySelector("#attendanceStatus");
    const summary = document.querySelector("#attendanceSummary");
    const table = document.querySelector("#attendanceLiveTable tbody");
    if (!status || !summary || !table) return;

    if (errorMessage) {
      status.textContent = errorMessage;
      table.innerHTML = '<tr><td colspan="4">暂时读取不到线上出勤记录。</td></tr>';
      return;
    }

    const sorted = [...records]
      .filter((record) => record && record.recordedAt)
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
    const latest = sorted.at(-1);

    if (!latest) {
      status.textContent = "暂无线上出勤记录。";
      table.innerHTML = '<tr><td colspan="4">操作端开启自动记录后，这里会显示最新出勤情况。</td></tr>';
      return;
    }

    const latestDate = archiveDate(latest);
    const latestRoomKey = roomKey(latest);
    const roomRecords = sorted.filter((record) => archiveDate(record) === latestDate && roomKey(record) === latestRoomKey);
    const peakOnline = Math.max(0, ...roomRecords.map((record) => Number(record.totalOnline || 0)));
    const assistants = [...(latest.assistants || [])].sort((a, b) => {
      return (b.online || 0) - (a.online || 0) || String(a.assistant || "").localeCompare(String(b.assistant || ""), "zh-CN");
    });

    status.textContent = `自动同步最新记录，每 ${Math.round(refreshMs / 1000)} 秒刷新一次。`;
    summary.innerHTML = [
      ["归档日期", latestDate],
      ["直播间", roomName(latest)],
      ["最近记录", formatTime(latest.recordedAt)],
      ["总在线", `${latest.totalOnline || 0} 人`],
      ["今日记录", `${roomRecords.length} 条`],
      ["最高在线", `${peakOnline} 人`]
    ].map(([label, value]) => `
      <div>
        <span>${label}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("");

    if (assistants.length === 0) {
      table.innerHTML = '<tr><td colspan="4">暂无助教出勤明细。</td></tr>';
      return;
    }

    const rows = assistants.map((row) => `
      <tr>
        <td>${escapeHtml(row.assistant || "-")}</td>
        <td>${row.online || 0}</td>
        <td>${row.expected || "-"}</td>
        <td>${rate(row.online || 0, row.expected || 0)}</td>
      </tr>
    `);
    const visibleRows = assistants.filter((row) => !row.missing);
    if (visibleRows.length > 0) {
      const totalOnline = visibleRows.reduce((sum, row) => sum + (row.online || 0), 0);
      const totalExpected = visibleRows.reduce((sum, row) => sum + (row.expected || 0), 0);
      rows.push(`
        <tr>
          <td><strong>总计</strong></td>
          <td><strong>${totalOnline}</strong></td>
          <td><strong>${totalExpected || "-"}</strong></td>
          <td><strong>${rate(totalOnline, totalExpected)}</strong></td>
        </tr>
      `);
    }
    table.innerHTML = rows.join("");
  }

  async function refresh() {
    const status = document.querySelector("#attendanceStatus");
    if (status) status.textContent = "正在读取出勤记录...";
    try {
      const response = await fetch(`./data/attendance-live.json?ts=${Date.now()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "读取失败");
      render(Array.isArray(body.records) ? body.records : []);
    } catch {
      render([], "最新出勤 JSON 发布后，这里会自动显示记录。");
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    refresh();
    window.setInterval(refresh, refreshMs);
  });
})();
