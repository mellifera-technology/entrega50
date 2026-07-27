(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const apiBase = String(window.MELLIFERA_CONFIG?.API_BASE || '').replace(/\/+$/, '');
  const apiUrl = path => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;

  const state = {
    csrf: '',
    user: null,
    actor: null,
    impersonating: false,
    hives: [],
    devices: [],
    overview: null,
    currentView: 'overview',
    charts: {},
    overviewMetric: 'temperature_in',
    overviewSeries: null,
    calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calendarItems: [],
  };

  const viewMeta = {
    overview: ['Panel general', 'Resumen del apiario'],
    hives: ['Organización', 'Colmenas'],
    readings: ['Telemetría', 'Mediciones generales'],
    alerts: ['Telemetría', 'Alertas'],
    production: ['Gestión', 'Producción'],
    health: ['Gestión', 'Sanidad'],
    calendar: ['Gestión', 'Calendario y tareas'],
    notes: ['Gestión', 'Anotaciones'],
    devices: ['Infraestructura', 'Dispositivos'],
    history: ['Telemetría', 'Historial recibido'],
  };

  const palette = ['#f3b61f', '#65a7ff', '#5ad890', '#b58cff', '#ff9c56', '#ff7070', '#5dd5d5', '#e98bd0', '#a7d66f', '#8fa8ff'];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

  function formatNumber(value, digits = 1) {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
    return Number(value).toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('es-AR', withTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'short' });
  }

  function shortDateTime(value) {
    if (!value) return '';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function dateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isRecent(value, minutes = 20) {
    if (!value) return false;
    const date = new Date(String(value).replace(' ', 'T'));
    return !Number.isNaN(date.getTime()) && Date.now() - date.getTime() <= minutes * 60 * 1000;
  }

  function hasEntranceActivity(item) {
    return Number(item.movement_value || 0) > 0 && isRecent(item.movement_at, 20);
  }

  function hasPositionAlarm(item) {
    return Number(item.position_alarm_open || 0) === 1
      || Math.abs(Number(item.position_value || 0)) > 0.000001;
  }

  function setLoading(show) {
    $('#loadingOverlay')?.classList.toggle('show', show);
  }

  function toast(message, type = 'success') {
    const container = $('#toastContainer');
    if (!container) return;
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.textContent = message;
    container.appendChild(element);
    setTimeout(() => element.remove(), 4600);
  }

  async function api(path, options = {}) {
    const response = await fetch(apiUrl(path), {
      method: options.method || 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(options.csrf === false ? {} : { 'X-CSRF-Token': state.csrf }),
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`La API devolvió una respuesta inválida (HTTP ${response.status}).`);
      }
    }

    if (response.status === 401) {
      location.href = 'login.html';
      throw new Error('Sesión vencida.');
    }
    if (!response.ok) throw new Error(data.message || `Error HTTP ${response.status}`);
    if (data.csrf_token) state.csrf = data.csrf_token;
    return data;
  }

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  }

  function buildLineChart(key, canvasId, labels, datasets, unit, emptyId) {
    destroyChart(key);
    const canvas = document.getElementById(canvasId);
    const empty = document.getElementById(emptyId);
    const hasValues = datasets.some(dataset => dataset.data.some(value => value !== null && value !== undefined));
    if (empty) empty.style.display = hasValues ? 'none' : 'grid';
    if (!canvas || !window.Chart || !hasValues) return;

    state.charts[key] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: datasets.length <= 12, labels: { color: '#b9c1cc', boxWidth: 14, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label}: ${formatNumber(context.raw, 2)} ${unit}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#808895', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,.04)' } },
          y: { ticks: { color: '#808895', callback: value => `${value} ${unit}` }, grid: { color: 'rgba(255,255,255,.055)' } },
        },
      },
    });
  }

  function buildBarChart(key, canvasId, labels, values, unit, emptyId) {
    destroyChart(key);
    const empty = document.getElementById(emptyId);
    if (empty) empty.style.display = labels.length ? 'none' : 'grid';
    if (!labels.length || !window.Chart) return;
    state.charts[key] = new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: 'rgba(243,182,31,.75)', borderRadius: 8 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${formatNumber(context.raw, 2)} ${unit}` } } },
        scales: {
          x: { ticks: { color: '#808895' }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#808895' }, grid: { color: 'rgba(255,255,255,.055)' } },
        },
      },
    });
  }

  function datasetsFromSeries(data, search = '', averageOnly = false) {
    const normalizedSearch = search.trim().toLocaleLowerCase('es');
    const series = (data.series || []).filter(item => !normalizedSearch || item.hive_name.toLocaleLowerCase('es').includes(normalizedSearch));
    const labels = [...new Set([
      ...series.flatMap(item => item.points.map(point => point.at)),
      ...(data.average || []).map(point => point.at),
    ])].sort();

    const datasets = [];
    if (!averageOnly) {
      series.forEach((item, index) => {
        const points = new Map(item.points.map(point => [point.at, Number(point.value)]));
        const color = palette[index % palette.length];
        datasets.push({
          label: item.hive_name,
          data: labels.map(label => points.has(label) ? points.get(label) : null),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: labels.length > 60 ? 0 : 2,
          pointHoverRadius: 4,
          tension: .28,
          spanGaps: true,
        });
      });
    }

    const averageMap = new Map((data.average || []).map(point => [point.at, Number(point.value)]));
    datasets.push({
      label: 'Promedio general',
      data: labels.map(label => averageMap.has(label) ? averageMap.get(label) : null),
      borderColor: '#f4f2eb',
      backgroundColor: '#f4f2eb',
      borderWidth: 2.5,
      borderDash: [7, 6],
      pointRadius: 0,
      tension: .25,
      spanGaps: true,
    });

    return { labels: labels.map(shortDateTime), datasets };
  }

  async function bootstrap() {
    try {
      const me = await api('/api/auth/me.php', { csrf: false });
      if (!me.authenticated) {
        location.href = 'login.html';
        return;
      }

      state.user = me.user;
      state.actor = me.actor || me.user;
      state.impersonating = Boolean(me.impersonating);
      state.csrf = me.csrf_token;

      if (state.actor?.role === 'admin' && !state.impersonating) {
        location.replace('admin.html');
        return;
      }

      const initial = me.user.name.trim().charAt(0).toUpperCase();
      $('#sessionUserName').textContent = me.user.name;
      $('#sessionUserEmail').textContent = me.user.email;
      $('#sessionAvatar').textContent = initial;
      $('#sessionMenuAvatar').textContent = initial;
      $('#sessionMenuName').textContent = me.user.name;
      $('#sessionRole').textContent = me.user.role === 'technician' ? 'Técnico' : 'Productor';
      $('#welcomeName').textContent = me.user.name.trim().split(/\s+/)[0];
      $('#todayLabel').textContent = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      if (state.impersonating) {
        $('#impersonationBanner')?.removeAttribute('hidden');
        $('#impersonationUserName').textContent = me.user.name;
      }

      const today = new Date();
      $('#historyTo').value = dateInput(today);
      const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);
      $('#historyFrom').value = dateInput(monthAgo);

      await Promise.all([loadHives(), loadDevices()]);
      populateHiveControls();
      bindEvents();
      await loadOverview();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function bindEvents() {
    $('#openSidebar')?.addEventListener('click', () => $('#sidebar')?.classList.add('open'));
    $('#closeSidebar')?.addEventListener('click', () => $('#sidebar')?.classList.remove('open'));
    $('#sessionButton')?.addEventListener('click', event => {
      event.stopPropagation();
      const button = event.currentTarget;
      const menu = $('#sessionMenu');
      const opening = menu.hasAttribute('hidden');
      menu.toggleAttribute('hidden', !opening);
      button.setAttribute('aria-expanded', String(opening));
    });
    $$('#sideNav button[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-go-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.goView)));
    $('#refreshButton')?.addEventListener('click', () => refreshCurrentView(true));
    $('#logoutButton')?.addEventListener('click', logout);
    $('#stopImpersonationButton')?.addEventListener('click', stopImpersonation);
    $$('[data-open-dialog]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.openDialog)));
    $$('.app-dialog form').forEach(form => form.addEventListener('submit', submitDialogForm));

    $$('[data-overview-metric]').forEach(button => button.addEventListener('click', async () => {
      state.overviewMetric = button.dataset.overviewMetric;
      $$('[data-overview-metric]').forEach(item => item.classList.toggle('active', item === button));
      await loadOverviewSeries();
    }));
    $('#overviewDays')?.addEventListener('change', loadOverviewSeries);
    $('#overviewHiveSearch')?.addEventListener('input', renderOverviewSeries);
    $('#hiveSearch')?.addEventListener('input', renderHives);
    $('#hiveTypeFilter')?.addEventListener('change', renderHives);
    $('#readingDays')?.addEventListener('change', loadReadings);
    $('#loadReadings')?.addEventListener('click', loadReadings);
    $('#alertStatusFilter')?.addEventListener('change', loadAlerts);
    $('#calendarPrev')?.addEventListener('click', () => changeCalendarMonth(-1));
    $('#calendarNext')?.addEventListener('click', () => changeCalendarMonth(1));
    $('#historySensor')?.addEventListener('change', loadHistory);
    $('#loadHistory')?.addEventListener('click', loadHistory);
    $('#treatmentAllHives')?.addEventListener('change', toggleTreatmentChecklist);

    document.addEventListener('click', event => {
      if (!event.target.closest('.session-control')) {
        $('#sessionMenu')?.setAttribute('hidden', '');
        $('#sessionButton')?.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('click', handleDelegatedClick);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragover', event => {
      if (event.target.closest('[data-task-column]')) event.preventDefault();
    });
    document.addEventListener('drop', handleTaskDrop);
  }

  async function logout() {
    try { await api('/api/auth/logout.php', { method: 'POST', body: {} }); }
    finally { location.href = 'login.html'; }
  }

  async function stopImpersonation() {
    try {
      await api('/api/admin/stop_impersonation.php', { method: 'POST', body: {} });
      location.href = 'admin.html';
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function switchView(view) {
    if (!viewMeta[view]) return;
    state.currentView = view;
    $$('.dash-view').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === view));
    $$('#sideNav button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('#viewEyebrow').textContent = viewMeta[view][0];
    $('#viewTitle').textContent = viewMeta[view][1];
    $('#sidebar').classList.remove('open');
    await refreshCurrentView(false);
  }

  async function refreshCurrentView(forceBase = false) {
    setLoading(true);
    try {
      if (forceBase) {
        await Promise.all([loadHives(), loadDevices()]);
        populateHiveControls();
      }
      const loaders = {
        overview: loadOverview,
        hives: async () => { await loadHives(); renderHives(); },
        readings: loadReadings,
        alerts: loadAlerts,
        production: loadProduction,
        health: loadHealth,
        calendar: loadCalendar,
        notes: loadNotes,
        devices: async () => { await loadDevices(); renderDevices(); },
        history: loadHistory,
      };
      await loaders[state.currentView]?.();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadHives() {
    const data = await api('/api/dashboard/hives.php');
    state.hives = data.items || [];
    renderHives();
    return state.hives;
  }

  async function loadDevices() {
    const data = await api('/api/dashboard/devices.php');
    state.devices = data.items || [];
    renderDevices();
    return state.devices;
  }

  function populateHiveControls() {
    const options = state.hives.map(item => `<option value="${item.id}">${escapeHtml(item.display_name)}</option>`).join('');
    $$('select[name="hive_id"]').forEach(select => {
      const formType = select.closest('form')?.dataset.form;
      const optional = ['event', 'note', 'device'].includes(formType);
      const current = select.value;
      select.innerHTML = `${optional ? '<option value="">General / Sin asignar</option>' : '<option value="">Seleccione...</option>'}${options}`;
      if (current) select.value = current;
    });

    const checklist = $('#treatmentHiveChecklist');
    if (checklist) {
      checklist.innerHTML = state.hives.length
        ? state.hives.map(item => `<label><input type="checkbox" name="hive_ids" value="${item.id}"><span>${escapeHtml(item.display_name)}</span></label>`).join('')
        : '<div class="empty-state">No hay colmenas disponibles.</div>';
    }
  }

  async function loadOverview() {
    const data = await api('/api/dashboard/overview.php');
    state.overview = data;
    const summary = data.summary || {};
    const manualCount = state.hives.filter(item => Number(item.is_manual) === 1).length;
    const automaticCount = state.hives.length - manualCount;
    $('#sumHives').textContent = summary.hives ?? 0;
    $('#sumHiveTypes').textContent = `${automaticCount} con sensores · ${manualCount} manuales`;
    $('#sumOnline').textContent = summary.devices_online ?? 0;
    $('#sumDevices').textContent = `${summary.devices_total ?? 0} registrados`;
    $('#sumAlerts').textContent = summary.open_alerts ?? 0;
    const positionCount = Number(summary.position_alarms || 0);
    const alarmBanner = $('#criticalPositionBanner');
    if (positionCount > 0) {
      alarmBanner?.removeAttribute('hidden');
      $('#criticalPositionText').textContent = positionCount === 1
        ? 'Una colmena informó una caída o movimiento crítico. Revísela de inmediato.'
        : `${positionCount} colmenas informaron una caída o movimiento crítico. Revise las alertas de inmediato.`;
    } else {
      alarmBanner?.setAttribute('hidden', '');
    }
    renderOverviewHives(data.hives || []);
    renderOverviewAlerts(data.alerts || []);
    renderOverviewEvents(data.events || []);
    await loadOverviewSeries();
  }

  function renderOverviewHives(items) {
    const container = $('#overviewHiveCards');
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">Las colmenas con sensores aparecerán automáticamente cuando llegue la publicación NEW.</div>';
      return;
    }
    container.innerHTML = items.slice(0, 6).map(item => {
      const online = isRecent(item.last_seen_at, 20);
      const activity = hasEntranceActivity(item);
      const positionAlarm = hasPositionAlarm(item);
      return `<article class="hive-mini ${positionAlarm ? 'hive-mini-alarm' : ''}">
        <div class="hive-mini-head"><div><h4>${escapeHtml(item.display_name)}</h4><small>${item.device_id ? 'Con sensores' : 'Manual'}</small></div><i class="status-dot ${online ? 'online' : ''}"></i></div>
        ${positionAlarm ? '<div class="hive-position-alarm">Posible caída o movimiento crítico</div>' : ''}
        ${activity ? '<span class="hive-activity-badge"><i></i>Actividad en la piquera</span>' : ''}
        <div class="hive-metrics two"><span>Temperatura<b>${formatNumber(item.temperature_in)} °C</b></span><span>Humedad<b>${formatNumber(item.humidity_in)} %</b></span></div>
        <div class="hive-mini-sensors"><span>Ruido <b>${formatNumber(item.sound_level)}</b></span><span>CO₂ <b>${formatNumber(item.co2_ppm, 0)} ppm</b></span><span>NH₃ <b>${formatNumber(item.nh3_ppm, 0)} ppm</b></span></div>
      </article>`;
    }).join('');
  }

  function renderOverviewAlerts(items) {
    const container = $('#overviewAlerts');
    container.innerHTML = items.length
      ? items.map(item => `<article class="alert-item ${escapeHtml(item.severity)}"><i></i><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.hive_name || 'Sistema')} · ${formatDate(item.detected_at, true)}</small></div></article>`).join('')
      : '<div class="empty-state">No hay alertas abiertas.</div>';
  }

  function renderOverviewEvents(items) {
    const container = $('#overviewEvents');
    container.innerHTML = items.length
      ? items.map(item => `<article class="event-chip"><time>${formatDate(item.event_date)}${item.start_time ? ` · ${escapeHtml(item.start_time.slice(0, 5))}` : ''}</time><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.hive_name || 'Todo el apiario')}</small></article>`).join('')
      : '<div class="empty-state">No hay tareas programadas para los próximos 14 días.</div>';
  }

  async function loadOverviewSeries() {
    const days = $('#overviewDays')?.value || '2';
    const data = await api(`/api/dashboard/overview_series.php?metric=${encodeURIComponent(state.overviewMetric)}&days=${encodeURIComponent(days)}`);
    state.overviewSeries = data;
    $('#overviewChartTitle').textContent = `${data.metric.label} de todas las colmenas`;
    renderOverviewSeries();
  }

  function renderOverviewSeries() {
    if (!state.overviewSeries) return;
    const search = $('#overviewHiveSearch')?.value || '';
    const chartData = datasetsFromSeries(state.overviewSeries, search, false);
    buildLineChart('overview', 'overviewChart', chartData.labels, chartData.datasets, state.overviewSeries.metric.unit, 'overviewChartEmpty');
  }

  function queenColor(year) {
    const digit = Math.abs(Number(year)) % 10;
    if ([1, 6].includes(digit)) return '#f5f5f5';
    if ([2, 7].includes(digit)) return '#ffd54f';
    if ([3, 8].includes(digit)) return '#ff6b6b';
    if ([4, 9].includes(digit)) return '#49d17d';
    if ([5, 0].includes(digit)) return '#4da3ff';
    return '#8d96a3';
  }

  function renderHives() {
    const container = $('#hiveCards');
    if (!container) return;
    const search = ($('#hiveSearch')?.value || '').trim().toLocaleLowerCase('es');
    const type = $('#hiveTypeFilter')?.value || '';
    const items = state.hives.filter(item => {
      const manual = Number(item.is_manual) === 1;
      const typeMatches = !type || (type === 'manual' ? manual : !manual);
      const searchMatches = !search || `${item.display_name} ${item.notes || ''} ${item.queen_birth_year || ''}`.toLocaleLowerCase('es').includes(search);
      return typeMatches && searchMatches;
    });

    if (!items.length) {
      container.innerHTML = '<div class="empty-state">No hay colmenas para mostrar.</div>';
      return;
    }

    container.innerHTML = items.map(item => {
      const manual = Number(item.is_manual) === 1;
      const online = isRecent(item.last_seen_at, 20);
      const activity = hasEntranceActivity(item);
      const positionAlarm = hasPositionAlarm(item);
      const queenYear = item.queen_birth_year || 'Sin registrar';
      const varroa = item.latest_varroa_percentage === null ? '—' : `${formatNumber(item.latest_varroa_percentage, 1)}%`;
      return `<article class="content-card hive-detail-card ${positionAlarm ? 'hive-card-critical' : ''}">
        <div class="card-top"><div><small>${manual ? 'Colmena manual' : 'Colmena con sensores'}</small><h3>${escapeHtml(item.display_name)}</h3></div>${manual ? '<span class="status-badge manual">Manual</span>' : `<i class="status-dot ${online ? 'online' : ''}" title="${online ? 'En línea' : 'Sin conexión reciente'}"></i>`}</div>
        ${positionAlarm ? '<div class="hive-position-alarm">ALARMA: posible caída, vuelco o desplazamiento</div>' : ''}
        ${activity ? '<span class="hive-activity-badge"><i></i>Hay actividad en la piquera</span>' : ''}
        <div class="hive-card-identity"><span class="queen-dot" style="background:${queenColor(item.queen_birth_year)}"></span><div><small>Reina</small><b>${escapeHtml(queenYear)}</b></div><div><small>Tratamientos activos</small><b>${Number(item.active_treatment_count || 0)}</b></div><div><small>Última varroa</small><b>${varroa}</b></div></div>
        ${manual ? '<div class="manual-hive-notice">Sin sensores: disponible para reina, sanidad, producción y observaciones manuales.</div>' : `<div class="hive-sensor-grid"><span><small>Temperatura</small><b>${formatNumber(item.temperature_in)} °C</b></span><span><small>Humedad</small><b>${formatNumber(item.humidity_in)} %</b></span><span><small>Ruido</small><b>${formatNumber(item.sound_level)}</b></span><span><small>CO₂</small><b>${formatNumber(item.co2_ppm, 0)} ppm</b></span><span><small>NH₃</small><b>${formatNumber(item.nh3_ppm, 0)} ppm</b></span></div>`}
        <p class="hive-notes-preview">${escapeHtml(item.notes || 'Sin observaciones.')}</p>
        <div class="card-actions"><button class="mini-button" data-edit-hive="${item.id}">Editar nombre, reina y observaciones</button>${manual ? `<button class="mini-button danger" data-delete-hive="${item.id}">Eliminar manual</button>` : ''}</div>
      </article>`;
    }).join('');
  }

  async function loadReadings() {
    const days = $('#readingDays')?.value || '7';
    const [temperature, humidity, summary] = await Promise.all([
      api(`/api/dashboard/overview_series.php?metric=temperature_in&days=${encodeURIComponent(days)}`),
      api(`/api/dashboard/overview_series.php?metric=humidity_in&days=${encodeURIComponent(days)}`),
      api('/api/dashboard/sensor_summary.php'),
    ]);

    $('#measurementTemperature').textContent = formatNumber(temperature.stats.average, 1);
    $('#measurementTemperatureRange').textContent = temperature.stats.average === null ? 'Sin datos' : `${formatNumber(temperature.stats.minimum, 1)} a ${formatNumber(temperature.stats.maximum, 1)} °C · ${temperature.stats.hive_count} colmenas`;
    $('#measurementHumidity').textContent = formatNumber(humidity.stats.average, 1);
    $('#measurementHumidityRange').textContent = humidity.stats.average === null ? 'Sin datos' : `${formatNumber(humidity.stats.minimum, 1)} a ${formatNumber(humidity.stats.maximum, 1)} % · ${humidity.stats.hive_count} colmenas`;

    const metrics = summary.metrics || {};
    $('#measurementActivity').textContent = summary.activity_hives ?? 0;
    $('#measurementActivityText').textContent = Number(summary.activity_hives || 0) === 1 ? 'colmena con movimiento reciente' : 'colmenas con movimiento reciente';
    $('#measurementSound').textContent = formatNumber(metrics.RUI?.average, 1);
    $('#measurementSoundText').textContent = metrics.RUI ? `${metrics.RUI.hive_count} colmenas con lectura` : 'nivel promedio actual';
    $('#measurementCo2').textContent = formatNumber(metrics.CO2?.average, 0);
    $('#measurementCo2Text').textContent = metrics.CO2 ? `${metrics.CO2.hive_count} colmenas con lectura` : 'promedio general';
    $('#measurementNh3').textContent = formatNumber(metrics.NH3?.average, 0);
    $('#measurementNh3Text').textContent = metrics.NH3 ? `${metrics.NH3.hive_count} colmenas con lectura` : 'promedio general';
    $('#measurementPosition').textContent = summary.position_alarms ?? 0;
    $('#measurementPositionText').textContent = Number(summary.position_alarms || 0) === 1 ? 'colmena en alarma' : 'colmenas en alarma';

    const tempChart = datasetsFromSeries(temperature, '', true);
    const humidityChart = datasetsFromSeries(humidity, '', true);
    buildLineChart('temperatureGeneral', 'temperatureGeneralChart', tempChart.labels, tempChart.datasets, '°C', 'temperatureGeneralEmpty');
    buildLineChart('humidityGeneral', 'humidityGeneralChart', humidityChart.labels, humidityChart.datasets, '%', 'humidityGeneralEmpty');
  }

  async function loadAlerts() {
    const status = $('#alertStatusFilter')?.value || '';
    const data = await api(`/api/manage/records.php?resource=alerts&limit=500${status ? `&status=${encodeURIComponent(status)}` : ''}`);
    const board = $('#alertBoard');
    board.innerHTML = data.items.length
      ? data.items.map(item => `<article class="alert-card ${escapeHtml(item.severity)}"><div class="alert-marker">!</div><div><div class="card-top"><div><small>${escapeHtml(item.hive_name || 'Sistema')} · ${formatDate(item.detected_at, true)}</small><h3>${escapeHtml(item.title)}</h3></div><span class="status-badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></div><p>${escapeHtml(item.message)}</p></div><div class="alert-actions">${item.status === 'open' ? `<button class="mini-button" data-alert-action="acknowledged" data-id="${item.id}">Reconocer</button>` : ''}${item.status !== 'closed' ? `<button class="mini-button" data-alert-action="closed" data-id="${item.id}">Cerrar</button>` : ''}</div></article>`).join('')
      : '<div class="empty-state">No hay alertas para este estado.</div>';
  }

  async function loadProduction() {
    const data = await api('/api/manage/records.php?resource=production&limit=1000');
    const items = data.items || [];
    const total = items.reduce((sum, item) => sum + Number(item.kilos || 0), 0);
    $('#productionTotal').textContent = formatNumber(total, 1);
    $('#productionCount').textContent = `${items.length} registros`;
    $('#productionTable').innerHTML = items.length
      ? items.map(item => `<tr><td>${formatDate(item.produced_on)}</td><td>${escapeHtml(item.hive_name)}</td><td>${formatNumber(item.kilos, 2)} kg</td><td>${escapeHtml(item.harvest_type || '—')}</td><td>${escapeHtml(item.notes || '—')}</td><td><button class="mini-button danger" data-delete-record="production" data-id="${item.id}">Eliminar</button></td></tr>`).join('')
      : '<tr><td colspan="6">Todavía no hay registros de producción.</td></tr>';

    const monthly = new Map();
    items.forEach(item => {
      const key = String(item.produced_on).slice(0, 7);
      monthly.set(key, (monthly.get(key) || 0) + Number(item.kilos || 0));
    });
    const labels = [...monthly.keys()].sort();
    buildBarChart('production', 'productionChart', labels.map(key => new Date(`${key}-01T00:00:00`).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })), labels.map(key => monthly.get(key)), 'kg', 'productionChartEmpty');
  }

  async function loadHealth() {
    const [treatments, varroa] = await Promise.all([
      api('/api/manage/records.php?resource=treatments&limit=1000'),
      api('/api/manage/records.php?resource=varroa&limit=1000'),
    ]);

    $('#treatmentTable').innerHTML = treatments.items.length
      ? treatments.items.map(item => {
        const active = !item.removed_on;
        return `<tr><td>${escapeHtml(item.hive_name)}</td><td>${escapeHtml(item.product_name)}</td><td>${formatDate(item.started_on)}</td><td>${formatDate(item.removed_on || item.expected_removal_on)}</td><td><span class="status-badge ${active ? 'open' : 'active'}">${active ? 'En curso' : 'Finalizado'}</span></td><td><button class="mini-button danger" data-delete-record="treatments" data-id="${item.id}">Eliminar</button></td></tr>`;
      }).join('')
      : '<tr><td colspan="6">No hay tratamientos registrados.</td></tr>';

    const latestByHive = new Map();
    varroa.items.forEach(item => { if (!latestByHive.has(item.hive_id)) latestByHive.set(item.hive_id, item); });
    const latest = [...latestByHive.values()];
    $('#varroaCards').innerHTML = latest.length
      ? latest.map(item => {
        const percentage = Number(item.percentage);
        const cls = percentage >= 3 ? 'bad' : percentage >= 1.5 ? 'warn' : '';
        return `<article class="stack-item"><div class="varroa-meter"><div><b>${escapeHtml(item.hive_name)}</b><small>${formatDate(item.measured_on)} · ${escapeHtml(item.method || 'Método no indicado')}</small></div><div class="varroa-bar"><i class="${cls}" style="width:${Math.min(100, percentage * 20)}%"></i></div><strong>${formatNumber(percentage, 1)}%</strong><button class="mini-button danger" data-delete-record="varroa" data-id="${item.id}">×</button></div></article>`;
      }).join('')
      : '<div class="empty-state">No hay conteos de varroa registrados.</div>';
  }

  async function loadCalendar() {
    const month = `${state.calendarDate.getFullYear()}-${String(state.calendarDate.getMonth() + 1).padStart(2, '0')}`;
    const [monthData, allData] = await Promise.all([
      api(`/api/manage/records.php?resource=calendar&month=${month}&limit=500`),
      api('/api/manage/records.php?resource=calendar&limit=1000'),
    ]);
    state.calendarItems = allData.items || [];
    renderCalendar(monthData.items || []);
    renderKanban(state.calendarItems);
  }

  function renderCalendar(items) {
    const date = state.calendarDate;
    $('#calendarTitle').textContent = date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const eventsByDate = new Map();
    items.forEach(item => {
      if (!eventsByDate.has(item.event_date)) eventsByDate.set(item.event_date, []);
      eventsByDate.get(item.event_date).push(item);
    });

    const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => `<div class="calendar-weekday">${day}</div>`).join('');
    let days = '';
    for (let index = 0; index < 42; index++) {
      const current = new Date(start); current.setDate(start.getDate() + index);
      const key = dateInput(current);
      const dayEvents = eventsByDate.get(key) || [];
      days += `<div class="calendar-day ${current.getMonth() === date.getMonth() ? '' : 'other'} ${key === dateInput(new Date()) ? 'today' : ''}" data-calendar-date="${key}"><span>${current.getDate()}</span>${dayEvents.slice(0, 3).map(event => `<b class="calendar-event-pill" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</b>`).join('')}</div>`;
    }
    $('#calendarGrid').innerHTML = weekdays + days;
    $('#calendarEvents').innerHTML = items.length
      ? items.map(item => `<article class="stack-item"><div><b>${escapeHtml(item.title)}</b><small>${formatDate(item.event_date)}${item.start_time ? ` · ${item.start_time.slice(0, 5)}` : ''} · ${escapeHtml(item.hive_name || 'Todo el apiario')}</small></div><button class="mini-button danger" data-delete-record="calendar" data-id="${item.id}">×</button></article>`).join('')
      : '<div class="empty-state">No hay eventos este mes.</div>';
  }

  function renderKanban(items) {
    const groups = { pending: [], in_progress: [], done: [] };
    items.forEach(item => {
      const status = groups[item.task_status] ? item.task_status : (Number(item.completed) ? 'done' : 'pending');
      groups[status].push(item);
    });

    const targets = { pending: '#pendingTasks', in_progress: '#progressTasks', done: '#doneTasks' };
    const counters = { pending: '#pendingTaskCount', in_progress: '#progressTaskCount', done: '#doneTaskCount' };
    Object.entries(groups).forEach(([status, rows]) => {
      $(counters[status]).textContent = rows.length;
      $(targets[status]).innerHTML = rows.length
        ? rows.map(item => `<article class="kanban-card" draggable="true" data-task-id="${item.id}"><small>${formatDate(item.event_date)} · ${escapeHtml(item.hive_name || 'Todo el apiario')}</small><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.notes || item.event_type || '')}</p><div class="kanban-actions">${status !== 'pending' ? `<button class="mini-button" data-task-move="pending" data-id="${item.id}">Pendiente</button>` : ''}${status !== 'in_progress' ? `<button class="mini-button" data-task-move="in_progress" data-id="${item.id}">Haciéndose</button>` : ''}${status !== 'done' ? `<button class="mini-button" data-task-move="done" data-id="${item.id}">Terminar</button>` : ''}<button class="mini-button danger" data-delete-record="calendar" data-id="${item.id}">×</button></div></article>`).join('')
        : '<div class="kanban-empty">Sin tareas</div>';
    });
  }

  async function changeCalendarMonth(offset) {
    state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + offset, 1);
    await loadCalendar();
  }

  async function moveTask(id, status) {
    const item = state.calendarItems.find(row => String(row.id) === String(id));
    if (!item) return;
    await api('/api/manage/records.php?resource=calendar', {
      method: 'PUT',
      body: {
        id: item.id,
        hive_id: item.hive_id || '',
        event_date: item.event_date,
        start_time: item.start_time || '',
        title: item.title,
        event_type: item.event_type,
        notes: item.notes || '',
        task_status: status,
      },
    });
    await loadCalendar();
  }

  function handleDragStart(event) {
    const card = event.target.closest('[data-task-id]');
    if (!card || !event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', card.dataset.taskId);
    event.dataTransfer.effectAllowed = 'move';
  }

  async function handleTaskDrop(event) {
    const column = event.target.closest('[data-task-column]');
    if (!column || !event.dataTransfer) return;
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    if (!id) return;
    try { await moveTask(id, column.dataset.taskColumn); }
    catch (error) { toast(error.message, 'error'); }
  }

  async function loadNotes() {
    const data = await api('/api/manage/records.php?resource=notes&limit=1000');
    $('#noteGrid').innerHTML = data.items.length
      ? data.items.map(item => `<article class="note-card ${Number(item.pinned) ? 'pinned' : ''}"><small>${escapeHtml(item.hive_name || 'General')} · ${formatDate(item.created_at, true)}</small><h3>${escapeHtml(item.title || 'Anotación')}</h3><p>${escapeHtml(item.note_text)}</p><div class="card-actions"><button class="mini-button danger" data-delete-record="notes" data-id="${item.id}">Eliminar</button></div></article>`).join('')
      : '<div class="empty-state">Todavía no hay anotaciones.</div>';
  }

  function renderDevices() {
    const table = $('#deviceTable');
    if (!table) return;
    table.innerHTML = state.devices.length
      ? state.devices.map(item => `<tr><td>${item.device_type === 'mother' ? 'Madre' : 'Hijo'}</td><td><b>${escapeHtml(item.display_name || 'Dispositivo')}</b></td><td>${escapeHtml(item.parent_name || '—')}</td><td>${escapeHtml(item.hive_name || 'Sin asignar')}</td><td><span class="status-badge ${item.status === 'unassigned' ? 'unassigned' : item.is_online ? 'active' : ''}">${item.is_online ? 'En línea' : escapeHtml(item.status)}</span></td><td>${formatDate(item.last_seen_at, true)}</td><td>${item.device_type === 'child' ? `<button class="mini-button" data-edit-device="${item.id}">Editar</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="7">No hay dispositivos provisionados.</td></tr>';
  }

  async function loadHistory() {
    const params = new URLSearchParams({ limit: '1000' });
    if ($('#historyFrom')?.value) params.set('from', $('#historyFrom').value);
    if ($('#historyTo')?.value) params.set('to', $('#historyTo').value);
    if (($('#historySensor')?.value || '').trim()) params.set('sensor', $('#historySensor').value.trim().toUpperCase());
    const data = await api(`/api/history.php?${params}`);
    $('#historyTable').innerHTML = data.items.length
      ? data.items.map(item => `<tr><td>${formatDate(item.received_at, true)}</td><td>${escapeHtml(item.hive_name || 'Pendiente')}</td><td>${escapeHtml(item.device_name || 'Sin vincular')}</td><td><b>${escapeHtml(item.sensor || '—')}</b></td><td>${escapeHtml(item.measurement_text ?? item.measurement_num ?? '—')}</td><td><span class="status-badge ${escapeHtml(item.processing_status)}">${escapeHtml(item.processing_status)}</span><small class="history-message">${escapeHtml(item.processing_message || '')}</small></td></tr>`).join('')
      : '<tr><td colspan="6">No hay publicaciones para los filtros seleccionados.</td></tr>';
  }

  function toggleTreatmentChecklist() {
    const disabled = $('#treatmentAllHives')?.checked || false;
    $$('#treatmentHiveChecklist input[type="checkbox"]').forEach(input => {
      input.disabled = disabled;
      if (disabled) input.checked = false;
    });
    $('#treatmentHiveChecklist')?.classList.toggle('disabled', disabled);
  }

  function openDialog(id, preset = {}) {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    const form = dialog.querySelector('form');
    form?.reset();
    if (form) {
      $$('input[type="date"]', form).forEach(input => { if (!input.value) input.value = dateInput(new Date()); });
      Object.entries(preset).forEach(([name, value]) => {
        const field = form.elements.namedItem(name);
        if (field) field.value = value ?? '';
      });
    }
    if (id === 'treatmentDialog') toggleTreatmentChecklist();
    dialog.showModal();
  }

  async function submitDialogForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.dataset.form;
    const data = Object.fromEntries(new FormData(form).entries());
    $$('input[type="checkbox"]', form).forEach(input => {
      if (input.name !== 'hive_ids') data[input.name] = input.checked ? 1 : 0;
    });

    let endpoint = '';
    let method = 'POST';
    if (type === 'hive') { endpoint = '/api/dashboard/hives.php'; method = data.id ? 'PUT' : 'POST'; }
    if (type === 'device') { endpoint = '/api/dashboard/devices.php'; method = 'PUT'; }
    const resourceMap = { production: 'production', treatment: 'treatments', varroa: 'varroa', event: 'calendar', note: 'notes' };
    if (resourceMap[type]) endpoint = `/api/manage/records.php?resource=${resourceMap[type]}`;
    if (!endpoint) return;

    if (type === 'treatment') {
      data.hive_ids = $$('#treatmentHiveChecklist input[name="hive_ids"]:checked').map(input => Number(input.value));
    }

    setLoading(true);
    try {
      const result = await api(endpoint, { method, body: data });
      form.closest('dialog').close();
      toast(type === 'treatment' && result.created_count ? `Tratamiento aplicado a ${result.created_count} colmenas.` : 'Registro guardado correctamente.');
      await Promise.all([loadHives(), loadDevices()]);
      populateHiveControls();
      await refreshCurrentView(false);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelegatedClick(event) {
    const close = event.target.closest('[data-close-dialog]');
    if (close) {
      close.closest('dialog')?.close();
      return;
    }

    const editHive = event.target.closest('[data-edit-hive]');
    if (editHive) {
      const item = state.hives.find(row => String(row.id) === editHive.dataset.editHive);
      if (item) {
        $('#hiveDialogTitle').textContent = 'Editar colmena';
        openDialog('hiveDialog', {
          id: item.id,
          display_name: item.display_name,
          queen_birth_year: item.queen_birth_year || '',
          notes: item.notes || '',
        });
      }
      return;
    }

    const deleteHive = event.target.closest('[data-delete-hive]');
    if (deleteHive) {
      if (!confirm('¿Eliminar esta colmena manual y sus registros relacionados?')) return;
      try {
        await api('/api/dashboard/hives.php', { method: 'DELETE', body: { id: deleteHive.dataset.deleteHive } });
        toast('Colmena manual eliminada.');
        await loadHives();
        populateHiveControls();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const editDevice = event.target.closest('[data-edit-device]');
    if (editDevice) {
      const item = state.devices.find(row => String(row.id) === editDevice.dataset.editDevice);
      if (item) openDialog('deviceDialog', { id: item.id, display_name: item.display_name || '', hive_id: item.hive_id || '' });
      return;
    }

    const alertAction = event.target.closest('[data-alert-action]');
    if (alertAction) {
      try {
        await api('/api/manage/records.php?resource=alerts', { method: 'PUT', body: { id: alertAction.dataset.id, status: alertAction.dataset.alertAction } });
        await loadAlerts();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const taskMove = event.target.closest('[data-task-move]');
    if (taskMove) {
      try { await moveTask(taskMove.dataset.id, taskMove.dataset.taskMove); }
      catch (error) { toast(error.message, 'error'); }
      return;
    }

    const deleteRecord = event.target.closest('[data-delete-record]');
    if (deleteRecord) {
      if (!confirm('¿Eliminar este registro?')) return;
      try {
        await api(`/api/manage/records.php?resource=${deleteRecord.dataset.deleteRecord}`, { method: 'DELETE', body: { id: deleteRecord.dataset.id } });
        toast('Registro eliminado.');
        await refreshCurrentView(false);
        if (deleteRecord.dataset.deleteRecord === 'treatments' || deleteRecord.dataset.deleteRecord === 'varroa') await loadHives();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }

    const calendarDay = event.target.closest('[data-calendar-date]');
    if (calendarDay) {
      openDialog('eventDialog', { event_date: calendarDay.dataset.calendarDate, task_status: 'pending' });
    }
  }

  bootstrap();
})();
