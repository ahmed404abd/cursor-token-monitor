(function () {
  const vscode = acquireVsCodeApi();
  const CIRC = 2 * Math.PI * 52;
  const MINI_CIRC = 2 * Math.PI * 34;

  let state = vscode.getState() || { vm: null };
  let sortable = null;

  const els = {
    stateBanner: document.getElementById('stateBanner'),
    planRingFg: document.getElementById('planRingFg'),
    planRingPct: document.getElementById('planRingPct'),
    accountEmail: document.getElementById('accountEmail'),
    planChip: document.getElementById('planChip'),
    planMessage: document.getElementById('planMessage'),
    usedLabel: document.getElementById('usedLabel'),
    limitLabel: document.getElementById('limitLabel'),
    remainingLabel: document.getElementById('remainingLabel'),
    billingCycle: document.getElementById('billingCycle'),
    resetIn: document.getElementById('resetIn'),
    resetTime: document.getElementById('resetTime'),
    updatedLabel: document.getElementById('updatedLabel'),
    todaySpend: document.getElementById('todaySpend'),
    yesterdaySpend: document.getElementById('yesterdaySpend'),
    avg7Spend: document.getElementById('avg7Spend'),
    total7Spend: document.getElementById('total7Spend'),
    sessionSection: document.getElementById('sessionSection'),
    sessionStarted: document.getElementById('sessionStarted'),
    sessionEvents: document.getElementById('sessionEvents'),
    sessionTokens: document.getElementById('sessionTokens'),
    sessionSpend: document.getElementById('sessionSpend'),
    insightGrid: document.getElementById('insightGrid'),
    cardGrid: document.getElementById('cardGrid'),
    groupLabel: document.getElementById('groupLabel'),
    spendChart: document.getElementById('spendChart'),
    tokenChart: document.getElementById('tokenChart'),
    activityFeed: document.getElementById('activityFeed'),
    topDaysBody: document.getElementById('topDaysBody'),
    sessionsBody: document.getElementById('sessionsBody'),
    autoCard: document.getElementById('autoCard'),
    totalEvents: document.getElementById('totalEvents'),
    totalChats: document.getElementById('totalChats'),
    totalIn: document.getElementById('totalIn'),
    totalOut: document.getElementById('totalOut'),
    issuesLink: document.getElementById('issuesLink'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    btnGroup: document.getElementById('btnGroup'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnResetOrder: document.getElementById('btnResetOrder'),
    btnSettings: document.getElementById('btnSettings'),
    btnExportCsv: document.getElementById('btnExportCsv'),
    btnExportJson: document.getElementById('btnExportJson'),
    btnExportMd: document.getElementById('btnExportMd'),
    btnCopy: document.getElementById('btnCopy'),
    settingsForm: document.getElementById('settingsForm'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
  };

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(cents) {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }

  function setRing(fgEl, pctEl, percent, health) {
    const pct = Math.max(0, Math.min(100, percent || 0));
    const offset = CIRC - (CIRC * pct) / 100;
    fgEl.style.strokeDasharray = String(CIRC);
    fgEl.style.strokeDashoffset = String(offset);
    fgEl.classList.remove('warning', 'critical');
    if (health === 'warning') fgEl.classList.add('warning');
    if (health === 'critical') fgEl.classList.add('critical');
    pctEl.textContent = `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  }

  function miniRing(percent, health) {
    const pct = Math.max(0, Math.min(100, percent || 0));
    const offset = MINI_CIRC - (MINI_CIRC * pct) / 100;
    const cls = health === 'critical' ? 'critical' : health === 'warning' ? 'warning' : '';
    return `<div class="mini-ring-wrap">
      <svg viewBox="0 0 84 84" class="mini-ring" aria-hidden="true">
        <circle class="ring-bg" cx="42" cy="42" r="34"></circle>
        <circle class="ring-fg ${cls}" cx="42" cy="42" r="34"
          stroke-dasharray="${MINI_CIRC}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="mini-ring-center">${pct.toFixed(0)}%</div>
    </div>`;
  }

  function barChart(points, metric) {
    if (!points || !points.length) {
      return `<div class="empty">No daily history yet — keep the extension running to build trends.</div>`;
    }
    const width = 640;
    const height = 180;
    const padL = 36;
    const padB = 36;
    const padT = 12;
    const padR = 8;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const gap = 4;
    const barW = Math.max(4, (innerW - gap * (points.length - 1)) / points.length);
    const valueOf = (p) => (metric === 'tokens' ? p.tokens : p.spendCents);
    const max = Math.max(...points.map(valueOf), 0.01);
    const bars = points
      .map((p, i) => {
        const h = Math.max(2, (valueOf(p) / max) * innerH);
        const x = padL + i * (barW + gap);
        const y = padT + innerH - h;
        const title =
          metric === 'tokens'
            ? `${p.label}: ${p.tokens.toLocaleString()} tokens`
            : `${p.label}: ${money(p.spendCents)} · ${p.events} events`;
        return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${esc(title)}</title></rect>`;
      })
      .join('');
    const labelStep = Math.max(1, Math.ceil(points.length / 8));
    const labels = points
      .map((p, i) => {
        if (i % labelStep !== 0 && i !== points.length - 1) return '';
        const x = padL + i * (barW + gap) + barW / 2;
        return `<text class="axis" x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle">${esc(p.label)}</text>`;
      })
      .join('');
    return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img">${bars}${labels}</svg>`;
  }

  function tokenBar(value, max, cls) {
    const width = Math.max(4, max ? (value / max) * 100 : 0);
    return `<div class="token-bar ${cls}"><span style="width:${width.toFixed(1)}%"></span></div>`;
  }

  function formatToken(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return String(n);
  }

  function renderCard(card, viewMode) {
    const maxTok = Math.max(card.tokensIn, card.tokensOut, 1);
    const pills = (card.pills || [])
      .map(
        (p) =>
          `<span class="pill">${esc(p.label)}${p.detail ? ` <strong>${esc(p.detail)}</strong>` : ''}</span>`
      )
      .join('');
    const pinLabel = card.isPinned ? 'Unpin' : 'Pin';
    return `<article class="cockpit-card" data-id="${esc(card.id)}" data-kind="${esc(card.kind)}">
      <div class="card__head">
        <span class="card__dot ${esc(card.health)}"></span>
        <div class="card__titles">
          <div class="card__title" data-role="title">${esc(card.title)}</div>
          <div class="card__subtitle">${esc(card.subtitle)}</div>
        </div>
        <div class="card__actions">
          ${
            card.kind === 'model'
              ? `<button type="button" data-action="rename" title="Rename">✎</button>
                 <button type="button" data-action="pin" title="${pinLabel}">${card.isPinned ? '★' : '☆'}</button>`
              : ''
          }
        </div>
      </div>
      <div class="card__body">
        ${miniRing(card.percent, card.health)}
        <div class="card__metrics">
          <div class="row"><span class="muted">Spend</span><strong>${esc(card.spendLabel)}</strong></div>
          <div class="row"><span class="muted">Share</span><strong>${card.sharePercent.toFixed(1)}%</strong></div>
          <div class="row"><span class="muted">Events</span><strong>${card.events}</strong></div>
          <div class="row"><span class="muted">Status</span><strong>${esc(card.health)}</strong></div>
          <div class="row"><span class="muted">Reset in</span><strong>${esc(card.resetInLabel)}</strong></div>
          <div class="token-bars">
            <div class="row"><span class="muted">In ${formatToken(card.tokensIn)}</span></div>
            ${tokenBar(card.tokensIn, maxTok, '')}
            <div class="row"><span class="muted">Out ${formatToken(card.tokensOut)}</span></div>
            ${tokenBar(card.tokensOut, maxTok, 'out')}
          </div>
        </div>
        ${
          viewMode === 'list'
            ? `<div class="card__metrics"><div class="row"><span class="muted">Reset</span><strong>${esc(card.resetTimeLabel)}</strong></div></div>`
            : ''
        }
      </div>
      <div class="pills">${pills || '<span class="pill">No details</span>'}</div>
      ${card.isEstimate ? '<div class="estimate-tag">Estimated workspace snapshot</div>' : ''}
    </article>`;
  }

  function bindSortable(vm) {
    if (sortable) {
      sortable.destroy();
      sortable = null;
    }
    if (typeof Sortable === 'undefined' || !els.cardGrid) return;
    sortable = Sortable.create(els.cardGrid, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: () => {
        const order = [...els.cardGrid.querySelectorAll('.cockpit-card')].map((el) => el.dataset.id);
        vscode.postMessage({ type: 'reorder', order, groupMode: vm.prefs.groupMode });
      },
    });
  }

  function render(vm) {
    if (!vm) {
      els.stateBanner.textContent = 'No usage data yet. Click Refresh after signing into Cursor.';
      els.stateBanner.classList.add('visible');
      return;
    }
    els.stateBanner.classList.remove('visible');
    state.vm = vm;
    vscode.setState(state);

    setRing(els.planRingFg, els.planRingPct, vm.percentUsed, vm.planHealth);
    els.accountEmail.textContent = vm.accountEmail;
    els.planChip.textContent = vm.planPrice ? `${vm.planName} · ${vm.planPrice}` : vm.planName;
    els.planMessage.textContent = vm.displayMessage;
    els.usedLabel.textContent = vm.usedLabel;
    els.limitLabel.textContent = vm.limitLabel;
    els.remainingLabel.textContent = vm.remainingLabel;
    els.billingCycle.textContent = vm.billingCycleLabel;
    els.resetIn.textContent = vm.resetInLabel;
    els.resetTime.textContent = vm.resetTimeLabel;
    els.updatedLabel.textContent = vm.updatedLabel;

    els.todaySpend.textContent = money(vm.spendSummary.todayCents);
    els.yesterdaySpend.textContent = money(vm.spendSummary.yesterdayCents);
    els.avg7Spend.textContent = money(vm.spendSummary.sevenDayAvgCents);
    els.total7Spend.textContent = money(vm.spendSummary.sevenDayTotalCents);

    if (vm.session) {
      els.sessionSection.style.display = '';
      els.sessionStarted.textContent = vm.session.startedLabel;
      els.sessionEvents.textContent = String(vm.session.events);
      els.sessionTokens.textContent = vm.session.tokensLabel;
      els.sessionSpend.textContent = vm.session.spendLabel;
    } else {
      els.sessionSection.style.display = 'none';
    }

    els.insightGrid.innerHTML = (vm.insights || [])
      .map(
        (i) => `<article class="insight ${esc(i.level)}">
          <div class="insight__title">${esc(i.title)}</div>
          <div class="insight__detail">${esc(i.detail)}</div>
        </article>`
      )
      .join('') || '<div class="empty">No insights yet.</div>';

    const viewMode = vm.settings.viewMode || 'card';
    els.cardGrid.classList.toggle('list', viewMode === 'list');
    els.groupLabel.textContent =
      vm.prefs.groupMode === 'workspace' ? 'Grouped by workspace' : 'Grouped by model';
    els.btnGroup.textContent =
      vm.prefs.groupMode === 'workspace' ? 'Group: Workspace' : 'Group: Model';
    els.btnGroup.classList.toggle('active', true);

    els.cardGrid.innerHTML = (vm.cards || []).map((c) => renderCard(c, viewMode)).join('') ||
      '<div class="empty">No cards yet.</div>';
    bindSortable(vm);

    els.spendChart.innerHTML = barChart(vm.charts.spend, 'spend');
    els.tokenChart.innerHTML = barChart(vm.charts.tokens, 'tokens');

    els.activityFeed.innerHTML = (vm.activity || [])
      .map(
        (a) => `<div class="feed-item">
          <span class="feed-item__time">${esc(a.timeLabel)}</span>
          <span class="pill">${esc(a.model)}</span>
          <span class="feed-item__tokens">${esc(a.tokensLabel)} ${esc(a.kind)}</span>
          <span class="feed-item__cost">${esc(a.costLabel)}</span>
        </div>`
      )
      .join('') || '<div class="empty">No recent activity.</div>';

    els.topDaysBody.innerHTML = (vm.topDays || [])
      .map(
        (d, i) => `<tr><td>${i + 1}. ${esc(d.label)}</td><td class="num">${esc(d.spendLabel)}</td><td class="num">${d.events}</td></tr>`
      )
      .join('') || '<tr><td colspan="3">Not enough history yet.</td></tr>';

    els.sessionsBody.innerHTML = (vm.longestSessions || [])
      .map(
        (s) => `<tr><td><code>${esc(s.id)}</code></td><td class="num">${esc(s.duration)}</td><td class="num">${s.events}</td><td class="num">${esc(s.spendLabel)}</td></tr>`
      )
      .join('') || '<tr><td colspan="4">No sessions yet.</td></tr>';

    const auto = vm.autoEstimate;
    els.autoCard.innerHTML = `<div><strong>${auto.autoEventCount}</strong> Auto events · confidence <strong>${esc(auto.confidence)}</strong></div>
      <div class="pills" style="margin-top:10px">${
        (auto.likelyModels || []).map((m) => `<span class="pill">${esc(m)}</span>`).join('') || '—'
      }</div>
      <p style="margin:8px 0 0;color:var(--muted);font-size:12px">${esc(auto.note)}</p>`;

    els.totalEvents.textContent = String(vm.totals.events);
    els.totalChats.textContent = String(vm.totals.chats);
    els.totalIn.textContent = vm.totals.tokensIn;
    els.totalOut.textContent = vm.totals.tokensOut;
    els.issuesLink.href = vm.issuesUrl;

    fillSettingsForm(vm.settings);
  }

  function fillSettingsForm(settings) {
    const form = els.settingsForm;
    if (!form || !settings) return;
    form.statusBarFormat.value = settings.statusBarFormat;
    form.statusBarMode.value = settings.statusBarMode;
    form.notificationsEnabled.checked = !!settings.notificationsEnabled;
    form.warningThreshold.value = settings.warningThreshold;
    form.criticalThreshold.value = settings.criticalThreshold;
    form.viewMode.value = settings.viewMode;
    form.displayMode.value = settings.displayMode;
  }

  function openSettings() {
    els.settingsOverlay.classList.add('open');
  }
  function closeSettings() {
    els.settingsOverlay.classList.remove('open');
  }

  function startRename(cardEl) {
    const titleEl = cardEl.querySelector('[data-role="title"]');
    if (!titleEl || titleEl.querySelector('input')) return;
    const current = titleEl.textContent || '';
    titleEl.innerHTML = `<input class="rename-input" value="${esc(current)}" />`;
    const input = titleEl.querySelector('input');
    input.focus();
    input.select();
    const commit = () => {
      const next = input.value.trim() || current;
      vscode.postMessage({ type: 'renameModel', modelId: cardEl.dataset.id, alias: next });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') render(state.vm);
    });
    input.addEventListener('blur', commit);
  }

  els.btnRefresh?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  els.btnResetOrder?.addEventListener('click', () => vscode.postMessage({ type: 'resetOrder' }));
  els.btnGroup?.addEventListener('click', () => {
    const next = state.vm?.prefs?.groupMode === 'workspace' ? 'model' : 'workspace';
    vscode.postMessage({ type: 'setGroupMode', groupMode: next });
  });
  els.btnSettings?.addEventListener('click', openSettings);
  els.btnCloseSettings?.addEventListener('click', closeSettings);
  els.settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === els.settingsOverlay) closeSettings();
  });
  els.btnExportCsv?.addEventListener('click', () => vscode.postMessage({ type: 'exportCsv' }));
  els.btnExportJson?.addEventListener('click', () => vscode.postMessage({ type: 'exportJson' }));
  els.btnExportMd?.addEventListener('click', () => vscode.postMessage({ type: 'exportMarkdown' }));
  els.btnCopy?.addEventListener('click', () => vscode.postMessage({ type: 'copyReport' }));
  els.issuesLink?.addEventListener('click', (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'openIssues' });
  });

  els.btnSaveSettings?.addEventListener('click', () => {
    const form = els.settingsForm;
    const warning = Number(form.warningThreshold.value);
    const critical = Number(form.criticalThreshold.value);
    if (!(warning < critical)) {
      els.stateBanner.textContent = 'Warning threshold must be lower than critical threshold.';
      els.stateBanner.classList.add('visible');
      return;
    }
    vscode.postMessage({
      type: 'updateSettings',
      settings: {
        statusBarFormat: form.statusBarFormat.value,
        statusBarMode: form.statusBarMode.value,
        notificationsEnabled: form.notificationsEnabled.checked,
        warningThreshold: warning,
        criticalThreshold: critical,
        viewMode: form.viewMode.value,
        displayMode: form.displayMode.value,
      },
    });
    closeSettings();
  });

  els.cardGrid?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('.cockpit-card');
    if (!card) return;
    if (btn.dataset.action === 'rename') startRename(card);
    if (btn.dataset.action === 'pin') {
      vscode.postMessage({ type: 'togglePin', modelId: card.dataset.id });
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'usageUpdate') render(msg.data);
    if (msg.type === 'error') {
      els.stateBanner.textContent = msg.message || 'Something went wrong.';
      els.stateBanner.classList.add('visible');
    }
  });

  if (state.vm) render(state.vm);
  vscode.postMessage({ type: 'ready' });
})();
