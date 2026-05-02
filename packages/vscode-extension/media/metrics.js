(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  let state = null;

  // ── Message handling ──────────────────────────────────────────────────────

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg.type !== 'setData') return;

    if (msg.error) {
      document.getElementById('metrics-content').innerHTML =
        '<div class="metrics-error">Error loading metrics: ' + escHtml(msg.error) + '</div>';
      return;
    }

    state = { cards: msg.cards || [], columns: msg.columns || [] };
    render();
  });

  vscode.postMessage({ type: 'ready' });

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const header = document.getElementById('metrics-header');
    const content = document.getElementById('metrics-content');
    if (!state) return;

    // Header
    header.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'metrics-title';
    title.textContent = 'Kanban Metrics';
    header.appendChild(title);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'refresh-btn';
    refreshBtn.textContent = '\u21BB Refresh';
    refreshBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'refresh' });
    });
    header.appendChild(refreshBtn);

    // Content
    content.innerHTML = '';

    const { cards, columns } = state;
    const now = Date.now();

    const completed = cards.filter(function (c) { return !!c.done_at; });
    const active    = cards.filter(function (c) { return !c.done_at && !c.archived_at; });

    content.appendChild(renderSummary(completed, active, now));
    content.appendChild(renderThroughputSection(completed));
    content.appendChild(renderFlowTimesSection(completed));
    content.appendChild(renderBoardSnapshot(active, columns, now));
  }

  // ── Summary tiles ─────────────────────────────────────────────────────────

  function renderSummary(completed, active, now) {
    const section = makeSection('Summary');
    const grid = document.createElement('div');
    grid.className = 'stat-grid';

    const cycleTimes = completed
      .filter(function (c) { return c.active_at; })
      .map(function (c) { return new Date(c.done_at).getTime() - new Date(c.active_at).getTime(); });

    const leadTimes = completed
      .map(function (c) { return new Date(c.done_at).getTime() - new Date(c.created_at).getTime(); });

    const last4wkCount = completed.filter(function (c) {
      return new Date(c.done_at).getTime() >= now - 28 * 86400000;
    }).length;

    grid.appendChild(makeTile('Completed', String(completed.length), 'all time'));
    grid.appendChild(makeTile('Active', String(active.length), 'on the board'));
    grid.appendChild(makeTile(
      'Cycle time (avg)',
      cycleTimes.length ? formatDuration(mean(cycleTimes)) : '\u2014',
      cycleTimes.length ? 'median ' + formatDuration(median(cycleTimes)) : 'no data'
    ));
    grid.appendChild(makeTile(
      'Lead time (avg)',
      leadTimes.length ? formatDuration(mean(leadTimes)) : '\u2014',
      leadTimes.length ? 'median ' + formatDuration(median(leadTimes)) : 'no data'
    ));
    grid.appendChild(makeTile(
      'Throughput',
      (last4wkCount / 4).toFixed(1),
      'cards/week (last 4wk)'
    ));

    section.appendChild(grid);
    return section;
  }

  function makeTile(label, value, sub) {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';

    const l = document.createElement('div');
    l.className = 'stat-label';
    l.textContent = label;

    const v = document.createElement('div');
    v.className = 'stat-value';
    v.textContent = value;

    tile.appendChild(l);
    tile.appendChild(v);

    if (sub) {
      const s = document.createElement('div');
      s.className = 'stat-sub';
      s.textContent = sub;
      tile.appendChild(s);
    }

    return tile;
  }

  // ── Throughput chart ──────────────────────────────────────────────────────

  function renderThroughputSection(completed) {
    const section = makeSection('Throughput (last 12 weeks)');

    const weeks = computeWeeklyThroughput(completed, 12);
    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    wrap.appendChild(barChart(weeks, { barClass: 'chart-bar-primary', height: 180, padLeft: 36, padBottom: 36 }));
    section.appendChild(wrap);

    return section;
  }

  // ── Flow times section ────────────────────────────────────────────────────

  function renderFlowTimesSection(completed) {
    const section = makeSection('Flow Time Distributions');
    const row = document.createElement('div');
    row.className = 'charts-row';

    const cycleMs = completed
      .filter(function (c) { return c.active_at; })
      .map(function (c) { return new Date(c.done_at).getTime() - new Date(c.active_at).getTime(); });

    const leadMs = completed
      .map(function (c) { return new Date(c.done_at).getTime() - new Date(c.created_at).getTime(); });

    const cycleWrap = document.createElement('div');
    cycleWrap.className = 'chart-wrap';
    if (cycleMs.length === 0) {
      cycleWrap.appendChild(noDataEl('Cycle Time \u2014 no data yet'));
    } else {
      const cycleData = distributeTimes(cycleMs);
      cycleWrap.appendChild(chartTitle('Cycle Time'));
      cycleWrap.appendChild(barChart(cycleData, { barClass: 'chart-bar-primary', height: 160, padLeft: 36, padBottom: 36 }));
    }
    row.appendChild(cycleWrap);

    const leadWrap = document.createElement('div');
    leadWrap.className = 'chart-wrap';
    if (leadMs.length === 0) {
      leadWrap.appendChild(noDataEl('Lead Time \u2014 no data yet'));
    } else {
      const leadData = distributeTimes(leadMs);
      leadWrap.appendChild(chartTitle('Lead Time'));
      leadWrap.appendChild(barChart(leadData, { barClass: 'chart-bar-secondary', height: 160, padLeft: 36, padBottom: 36 }));
    }
    row.appendChild(leadWrap);

    section.appendChild(row);
    return section;
  }

  // ── Board snapshot ────────────────────────────────────────────────────────

  function renderBoardSnapshot(active, columns, now) {
    const section = makeSection('Board Snapshot');

    if (columns.length === 0) {
      section.appendChild(noDataEl('No columns configured.'));
      return section;
    }

    const table = document.createElement('table');
    table.className = 'snapshot-table';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    ['Column', 'Cards', 'Avg age (created)'].forEach(function (h) {
      const th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    columns.forEach(function (col) {
      const colCards = active.filter(function (c) { return c.column === col.id; });
      const ages = colCards.map(function (c) { return now - new Date(c.created_at).getTime(); });

      const tr = document.createElement('tr');

      const labelTd = document.createElement('td');
      labelTd.className = 'col-label-cell';
      labelTd.textContent = col.label;
      tr.appendChild(labelTd);

      const countTd = document.createElement('td');
      countTd.className = 'col-count-cell';
      countTd.textContent = String(colCards.length);
      tr.appendChild(countTd);

      const ageTd = document.createElement('td');
      ageTd.className = 'col-age-cell';
      ageTd.textContent = ages.length ? formatDuration(mean(ages)) : '\u2014';
      tr.appendChild(ageTd);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  // ── Chart helpers ─────────────────────────────────────────────────────────

  /**
   * Render a vertical bar chart as an SVG element.
   * @param {Array<{label: string, value: number}>} data
   * @param {{ barClass?: string, height?: number, padLeft?: number, padBottom?: number }} opts
   */
  function barChart(data, opts) {
    const barClass   = opts.barClass   || 'chart-bar-primary';
    const height     = opts.height     || 180;
    const padLeft    = opts.padLeft    || 36;
    const padBottom  = opts.padBottom  || 36;
    const padTop     = 20;
    const padRight   = 16;
    const viewW      = 520;
    const chartW     = viewW - padLeft - padRight;
    const chartH     = height - padTop - padBottom;

    const maxVal = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    // Nice Y-axis max: round up to next multiple of a step
    const step = niceStep(maxVal);
    const yMax = Math.ceil(maxVal / step) * step;

    const svg = svgEl('svg');
    svg.setAttribute('viewBox', '0 0 ' + viewW + ' ' + height);

    // Y-axis gridlines + labels
    const yTicks = Math.min(4, yMax);
    for (var t = 0; t <= yTicks; t++) {
      const yVal  = Math.round((yMax * t) / yTicks);
      const yPos  = padTop + chartH - (yVal / yMax) * chartH;

      const line = svgEl('line');
      line.setAttribute('class', 'chart-axis');
      line.setAttribute('x1', padLeft);
      line.setAttribute('y1', yPos);
      line.setAttribute('x2', padLeft + chartW);
      line.setAttribute('y2', yPos);
      svg.appendChild(line);

      const lbl = svgEl('text');
      lbl.setAttribute('class', 'chart-label');
      lbl.setAttribute('x', padLeft - 4);
      lbl.setAttribute('y', yPos + 3);
      lbl.setAttribute('text-anchor', 'end');
      lbl.textContent = String(yVal);
      svg.appendChild(lbl);
    }

    // Bars
    const barW    = chartW / data.length;
    const gutter  = Math.max(2, barW * 0.2);
    const netBarW = barW - gutter;

    data.forEach(function (d, i) {
      const barH = yMax > 0 ? (d.value / yMax) * chartH : 0;
      const x    = padLeft + i * barW + gutter / 2;
      const y    = padTop + chartH - barH;

      const rect = svgEl('rect');
      rect.setAttribute('class', barClass);
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', Math.max(netBarW, 1));
      rect.setAttribute('height', Math.max(barH, 1));
      rect.setAttribute('rx', '2');
      svg.appendChild(rect);

      if (d.value > 0) {
        const vl = svgEl('text');
        vl.setAttribute('class', 'chart-value-label');
        vl.setAttribute('x', x + netBarW / 2);
        vl.setAttribute('y', y - 3);
        vl.setAttribute('text-anchor', 'middle');
        vl.textContent = String(d.value);
        svg.appendChild(vl);
      }

      const xl = svgEl('text');
      xl.setAttribute('class', 'chart-label');
      xl.setAttribute('x', x + netBarW / 2);
      xl.setAttribute('y', padTop + chartH + 14);
      xl.setAttribute('text-anchor', 'middle');
      xl.textContent = d.label;
      svg.appendChild(xl);
    });

    // Baseline
    const base = svgEl('line');
    base.setAttribute('class', 'chart-axis');
    base.setAttribute('x1', padLeft);
    base.setAttribute('y1', padTop + chartH);
    base.setAttribute('x2', padLeft + chartW);
    base.setAttribute('y2', padTop + chartH);
    svg.appendChild(base);

    return svg;
  }

  function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  function chartTitle(text) {
    const el = document.createElement('div');
    el.style.fontSize = '11px';
    el.style.fontWeight = '600';
    el.style.marginBottom = '6px';
    el.style.color = 'var(--vscode-foreground)';
    el.style.opacity = '0.8';
    el.textContent = text;
    return el;
  }

  function noDataEl(text) {
    const el = document.createElement('div');
    el.className = 'no-data';
    el.textContent = text;
    return el;
  }

  function makeSection(title) {
    const section = document.createElement('div');
    section.className = 'metrics-section';

    const heading = document.createElement('div');
    heading.className = 'section-title';
    heading.textContent = title;
    section.appendChild(heading);

    return section;
  }

  // ── Metric computations ───────────────────────────────────────────────────

  function computeWeeklyThroughput(completed, numWeeks) {
    const now = new Date();
    const weekStart = getMondayStart(now);
    const result = [];

    for (var i = numWeeks - 1; i >= 0; i--) {
      const start = new Date(weekStart.getTime() - i * 7 * 86400000);
      const end   = new Date(start.getTime() + 7 * 86400000);
      const count = completed.filter(function (c) {
        const t = new Date(c.done_at).getTime();
        return t >= start.getTime() && t < end.getTime();
      }).length;
      // Label: "M/D" for the week's Monday
      const label = (start.getMonth() + 1) + '/' + start.getDate();
      result.push({ label: label, value: count });
    }

    return result;
  }

  const TIME_BUCKETS = [
    { label: '<1d',   maxMs: 86400000 },
    { label: '1\u20133d', maxMs: 3 * 86400000 },
    { label: '3\u20137d', maxMs: 7 * 86400000 },
    { label: '1\u20132wk', maxMs: 14 * 86400000 },
    { label: '2\u20134wk', maxMs: 28 * 86400000 },
    { label: '>4wk',  maxMs: Infinity },
  ];

  function distributeTimes(timesMs) {
    const counts = TIME_BUCKETS.map(function () { return 0; });
    timesMs.forEach(function (ms) {
      for (var i = 0; i < TIME_BUCKETS.length; i++) {
        if (ms < TIME_BUCKETS[i].maxMs) {
          counts[i]++;
          break;
        }
      }
    });
    return TIME_BUCKETS.map(function (b, i) { return { label: b.label, value: counts[i] }; });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function getMondayStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function niceStep(maxVal) {
    if (maxVal <= 4)  return 1;
    if (maxVal <= 10) return 2;
    if (maxVal <= 20) return 5;
    if (maxVal <= 50) return 10;
    return Math.pow(10, Math.floor(Math.log10(maxVal)));
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '0m';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60)  return (minutes || 0) + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24)    return hours + 'h';
    const days = Math.floor(hours / 24);
    if (days < 7)      return days + 'd';
    const weeks = Math.floor(days / 7);
    if (weeks < 8)     return weeks + 'wk';
    return Math.floor(days / 30) + 'mo';
  }

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

}());
