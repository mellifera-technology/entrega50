(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const csrfMeta = $('meta[name="csrf-token"]');
  const apiBase = String(window.MELLIFERA_CONFIG?.API_BASE || '').replace(/\/+$/, '');
  const apiUrl = path => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  const state = {
    csrf: csrfMeta?.content || '',
    user: null,
    apiaries: [],
    hives: [],
    devices: [],
    overview: null,
    currentView: 'overview',
    charts: {},
    readingItems: [],
    adminUsers: [],
    adminProvisioning: null,
    calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  };

  const viewMeta = {
    overview: ['Panel general', 'Resumen del apiario'],
    apiaries: ['Organización', 'Apiarios'],
    hives: ['Organización', 'Colmenas'],
    readings: ['Telemetría', 'Mediciones'],
    alerts: ['Telemetría', 'Alertas'],
    production: ['Gestión', 'Producción'],
    health: ['Gestión', 'Sanidad'],
    queens: ['Gestión', 'Reinas'],
    calendar: ['Gestión', 'Calendario'],
    notes: ['Gestión', 'Anotaciones'],
    devices: ['Infraestructura', 'Dispositivos'],
    admin: ['Administración', 'Usuarios y dispositivos'],
  };

  const metricLabels = {
    temperature_in: ['Temperatura interna', '°C'], humidity_in: ['Humedad interna', '%'],
    temperature_out: ['Temperatura exterior', '°C'], humidity_out: ['Humedad exterior', '%'],
    weight_kg: ['Peso', 'kg'], co2_ppm: ['CO₂', 'ppm'], oxygen_pct: ['Oxígeno', '%'],
    sound_level: ['Sonido', 'dB'], vibration_level: ['Vibración', 'u'], battery_v: ['Batería', 'V'],
    solar_v: ['Panel solar', 'V'], bee_flow_in: ['Entrada de abejas', 'conteo'],
    bee_flow_out: ['Salida de abejas', 'conteo'], food_level_pct: ['Alimento', '%'],
  };

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

  function dateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function setLoading(show) {
    $('#loadingOverlay')?.classList.toggle('show', show);
  }

  function toast(message, type = 'success') {
    const container = $('#toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4500);
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

    let data;
    try { data = await response.json(); }
    catch { data = { message: `Error HTTP ${response.status}` }; }

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

  function lineChart(key, canvasId, labels, values, unit = '') {
    destroyChart(key);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    state.charts[key] = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: '#f3b61f',
          backgroundColor: 'rgba(243,182,31,.12)',
          borderWidth: 2,
          pointRadius: labels.length > 80 ? 0 : 2,
          pointHoverRadius: 4,
          fill: true,
          tension: .28,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${formatNumber(ctx.raw, 2)} ${unit}` } },
        },
        scales: {
          x: { ticks: { color: '#808895', maxTicksLimit: 9 }, grid: { color: 'rgba(255,255,255,.04)' } },
          y: { ticks: { color: '#808895', callback: value => `${value}${unit ? ` ${unit}` : ''}` }, grid: { color: 'rgba(255,255,255,.055)' } },
        },
      },
    });
  }

  function barChart(key, canvasId, labels, values, unit = '') {
    destroyChart(key);
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    state.charts[key] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: 'rgba(243,182,31,.75)', borderRadius: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${formatNumber(ctx.raw, 2)} ${unit}` } } },
        scales: {
          x: { ticks: { color: '#808895' }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#808895' }, grid: { color: 'rgba(255,255,255,.055)' } },
        },
      },
    });
  }

  async function bootstrap() {
    try {
      const me = await api('/api/auth/me.php', { csrf: false });
      if (!me.authenticated) {
        location.href = 'login.html';
        return;
      }
      state.user = me.user;
      state.csrf = me.csrf_token;
      $('#sidebarUserName').textContent = me.user.name;
      $('#sidebarUserEmail').textContent = me.user.email;
      $('#userAvatar').textContent = me.user.name.trim().charAt(0).toUpperCase();
      $('#welcomeName').textContent = me.user.name.trim().split(/\s+/)[0];
      $('#todayLabel').textContent = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (me.user.role === 'admin') {
        $('#adminNavButton')?.removeAttribute('hidden');
      }

      const today = new Date();
      $('#readingTo').value = dateInput(today);
      const sevenDays = new Date(today); sevenDays.setDate(today.getDate() - 7);
      $('#readingFrom').value = dateInput(sevenDays);

      await Promise.all([loadApiaries(), loadHives(), loadDevices()]);
      populateAllSelects();
      await loadOverview();
      bindEvents();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function bindEvents() {
    $('#openSidebar')?.addEventListener('click', () => $('#sidebar')?.classList.add('open'));
    $('#closeSidebar')?.addEventListener('click', () => $('#sidebar')?.classList.remove('open'));

    $$('#sideNav button[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-go-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.goView)));

    $('#refreshButton')?.addEventListener('click', () => refreshCurrentView(true));
    $('#logoutButton')?.addEventListener('click', logout);

    $$('[data-open-dialog]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.openDialog)));
    $$('.app-dialog form').forEach(form => form.addEventListener('submit', submitDialogForm));

    $$('[data-overview-metric]').forEach(button => button.addEventListener('click', async () => {
      $$('[data-overview-metric]').forEach(item => item.classList.toggle('active', item === button));
      await loadOverviewChart(button.dataset.overviewMetric);
    }));

    $('#hiveSearch')?.addEventListener('input', renderHives);
    $('#hiveApiaryFilter')?.addEventListener('change', renderHives);
    $('#loadReadings')?.addEventListener('click', loadReadings);
    $('#readingMetric')?.addEventListener('change', loadReadings);
    $('#readingHive')?.addEventListener('change', loadReadings);
    $('#exportReadings')?.addEventListener('click', exportReadingsCsv);
    $('#alertStatusFilter')?.addEventListener('change', loadAlerts);
    $('#calendarPrev')?.addEventListener('click', () => changeCalendarMonth(-1));
    $('#calendarNext')?.addEventListener('click', () => changeCalendarMonth(1));
    $('#adminUserSearch')?.addEventListener('input', renderAdminUsers);
    $('#adminRefreshButton')?.addEventListener('click', loadAdminUsers);
    $('#copyProvisioningButton')?.addEventListener('click', copyProvisioningConfiguration);

    document.addEventListener('click', handleDelegatedClick);
  }

  async function logout() {
    try {
      await api('/api/auth/logout.php', { method: 'POST', body: {} });
    } finally {
      location.href = 'login.html';
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
        await Promise.all([loadApiaries(), loadHives(), loadDevices()]);
        populateAllSelects();
      }
      const loaders = {
        overview: loadOverview,
        apiaries: async () => { await loadApiaries(); renderApiaries(); },
        hives: async () => { await loadHives(); renderHives(); },
        readings: loadReadings,
        alerts: loadAlerts,
        production: loadProduction,
        health: loadHealth,
        queens: loadQueens,
        calendar: loadCalendar,
        notes: loadNotes,
        devices: async () => { await loadDevices(); renderDevices(); },
        admin: loadAdminUsers,
      };
      await loaders[state.currentView]?.();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadApiaries() {
    const data = await api('/api/dashboard/apiaries.php');
    state.apiaries = data.items || [];
    renderApiaries();
    return state.apiaries;
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

  function populateAllSelects() {
    const apiaryOptions = state.apiaries.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    $$('select[name="apiary_id"]').forEach(select => {
      const current = select.value;
      select.innerHTML = `<option value="">Seleccione...</option>${apiaryOptions}`;
      if (current) select.value = current;
    });
    $('#hiveApiaryFilter').innerHTML = `<option value="">Todos los apiarios</option>${apiaryOptions}`;

    const hiveOptions = state.hives.map(item => `<option value="${item.id}">${escapeHtml(item.display_name)} · ${escapeHtml(item.apiary_name)}</option>`).join('');
    $$('select[name="hive_id"]').forEach(select => {
      const optional = select.closest('form')?.dataset.form === 'event' || select.closest('form')?.dataset.form === 'note' || select.closest('form')?.dataset.form === 'device';
      const current = select.value;
      select.innerHTML = `${optional ? '<option value="">Sin asignar / General</option>' : '<option value="">Seleccione...</option>'}${hiveOptions}`;
      if (current) select.value = current;
    });
    $('#readingHive').innerHTML = `<option value="">Todas las colmenas</option>${hiveOptions}`;
  }

  async function loadOverview() {
    const data = await api('/api/dashboard/overview.php');
    state.overview = data;
    const s = data.summary || {};
    $('#sumHives').textContent = s.hives ?? 0;
    $('#sumApiaries').textContent = `${s.apiaries ?? 0} apiarios`;
    $('#sumOnline').textContent = s.devices_online ?? 0;
    $('#sumDevices').textContent = `${s.devices_total ?? 0} registrados`;
    $('#sumAlerts').textContent = s.open_alerts ?? 0;
    $('#sumProduction').textContent = formatNumber(s.month_production_kg ?? 0, 1);
    renderOverviewHives(data.hives || []);
    renderOverviewAlerts(data.alerts || []);
    renderOverviewEvents(data.events || []);
    loadWeather(data.weather_location);
    await loadOverviewChart('temperature_in');
  }

  function renderOverviewHives(items) {
    const container = $('#overviewHiveCards');
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">Todavía no hay colmenas. Cree la primera y luego asigne el dispositivo detectado.</div>';
      return;
    }
    container.innerHTML = items.slice(0, 6).map(item => {
      const online = item.last_seen_at && (Date.now() - new Date(item.last_seen_at.replace(' ', 'T')).getTime() <= 20 * 60 * 1000);
      return `<article class="hive-mini">
        <div class="hive-mini-head"><div><h4>${escapeHtml(item.display_name)}</h4><small>${escapeHtml(item.apiary_name)}</small></div><i class="status-dot ${online ? 'online' : ''}" title="${online ? 'En línea' : 'Sin conexión reciente'}"></i></div>
        <div class="hive-metrics"><span>Temperatura<b>${formatNumber(item.temperature_in)} °C</b></span><span>Humedad<b>${formatNumber(item.humidity_in)} %</b></span><span>Peso<b>${formatNumber(item.weight_kg)} kg</b></span></div>
      </article>`;
    }).join('');
  }

  function renderOverviewAlerts(items) {
    const container = $('#overviewAlerts');
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">No hay alertas abiertas.</div>';
      return;
    }
    container.innerHTML = items.map(item => `<article class="alert-item ${escapeHtml(item.severity)}"><i></i><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.hive_name || 'Sistema')} · ${formatDate(item.detected_at, true)}</small></div></article>`).join('');
  }

  function renderOverviewEvents(items) {
    const container = $('#overviewEvents');
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">No hay eventos programados para los próximos 14 días.</div>';
      return;
    }
    container.innerHTML = items.map(item => `<article class="event-chip"><time>${formatDate(item.event_date)}${item.start_time ? ` · ${escapeHtml(item.start_time.slice(0, 5))}` : ''}</time><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.hive_name || 'Todo el apiario')}</small></article>`).join('');
  }

  async function loadOverviewChart(metric) {
    const to = new Date();
    const from = new Date(); from.setDate(to.getDate() - 2);
    const data = await api(`/api/dashboard/readings.php?metric=${encodeURIComponent(metric)}&from=${dateInput(from)}&to=${dateInput(to)}&limit=600`);
    const items = data.items || [];
    $('#overviewChartEmpty').style.display = items.length ? 'none' : 'grid';
    lineChart('overview', 'overviewChart', items.map(item => formatDate(item.measured_at, true)), items.map(item => Number(item.value)), data.metric.unit);
  }

  async function loadWeather(location) {
    if (!location || location.latitude === null || location.longitude === null) {
      $('#weatherPlace').textContent = 'Sin ubicación';
      $('#weatherText').textContent = 'Agregue latitud y longitud al apiario para ver el pronóstico.';
      $('#weatherTemp').textContent = '—';
      $('#weatherHumidity').textContent = '—';
      $('#weatherWind').textContent = '—';
      return;
    }
    $('#weatherPlace').textContent = location.name;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
      const response = await fetch(url);
      const data = await response.json();
      const current = data.current || {};
      const code = Number(current.weather_code);
      const descriptions = { 0: ['Despejado','☀'], 1: ['Mayormente despejado','🌤'], 2: ['Parcialmente nublado','⛅'], 3: ['Nublado','☁'], 45: ['Niebla','🌫'], 48: ['Niebla','🌫'], 51: ['Llovizna','🌦'], 53: ['Llovizna','🌦'], 55: ['Llovizna intensa','🌧'], 61: ['Lluvia','🌧'], 63: ['Lluvia','🌧'], 65: ['Lluvia intensa','🌧'], 80: ['Chaparrones','🌦'], 81: ['Chaparrones','🌧'], 82: ['Chaparrones fuertes','⛈'], 95: ['Tormenta','⛈'] };
      const desc = descriptions[code] || ['Condiciones variables','◌'];
      $('#weatherTemp').textContent = formatNumber(current.temperature_2m, 0);
      $('#weatherHumidity').textContent = `${formatNumber(current.relative_humidity_2m, 0)} %`;
      $('#weatherWind').textContent = `${formatNumber(current.wind_speed_10m, 0)} km/h`;
      $('#weatherText').textContent = `${desc[0]} en ${location.locality || location.province || location.name}.`;
      $('#weatherIcon').textContent = desc[1];
    } catch {
      $('#weatherText').textContent = 'No se pudo consultar el pronóstico en este momento.';
    }
  }

  function renderApiaries() {
    const container = $('#apiaryCards');
    if (!container) return;
    if (!state.apiaries.length) {
      container.innerHTML = '<div class="empty-state">No hay apiarios registrados.</div>';
      return;
    }
    container.innerHTML = state.apiaries.map(item => `<article class="content-card">
      <div class="card-top"><div><small>Apiario</small><h3>${escapeHtml(item.name)}</h3></div><span class="status-badge ${escapeHtml(item.status)}">${item.status === 'active' ? 'Activo' : 'Inactivo'}</span></div>
      <p>${escapeHtml([item.locality, item.province, item.country].filter(Boolean).join(', ') || 'Ubicación sin completar')}</p>
      <div class="hive-metrics"><span>Colmenas<b>${item.hive_count ?? 0}</b></span><span>Latitud<b>${item.latitude ?? '—'}</b></span><span>Longitud<b>${item.longitude ?? '—'}</b></span></div>
      <div class="card-actions"><button class="mini-button" data-edit-apiary="${item.id}">Editar</button><button class="mini-button danger" data-delete-apiary="${item.id}">Eliminar</button></div>
    </article>`).join('');
  }

  function renderHives() {
    const container = $('#hiveCards');
    if (!container) return;
    const search = ($('#hiveSearch')?.value || '').toLowerCase();
    const apiary = $('#hiveApiaryFilter')?.value || '';
    const items = state.hives.filter(item => {
      const matchesSearch = !search || `${item.display_name} ${item.apiary_name}`.toLowerCase().includes(search);
      const matchesApiary = !apiary || String(item.apiary_id) === apiary;
      return matchesSearch && matchesApiary;
    });
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">No hay colmenas para mostrar.</div>';
      return;
    }
    container.innerHTML = items.map(item => {
      const online = item.last_seen_at && (Date.now() - new Date(item.last_seen_at.replace(' ', 'T')).getTime() <= 20 * 60 * 1000);
      return `<article class="content-card">
        <div class="card-top"><div><small>${escapeHtml(item.apiary_name)}</small><h3>${escapeHtml(item.display_name)}</h3></div><i class="status-dot ${online ? 'online' : ''}" title="${online ? 'En línea' : 'Sin conexión reciente'}"></i></div>
        <p>${item.device_uid ? `Dispositivo ${escapeHtml(item.device_uid)}` : 'Sin dispositivo asignado'}</p>
        <div class="hive-metrics"><span>Temperatura<b>${formatNumber(item.temperature_in)} °C</b></span><span>Humedad<b>${formatNumber(item.humidity_in)} %</b></span><span>Peso<b>${formatNumber(item.weight_kg)} kg</b></span></div>
        <div class="card-actions"><button class="mini-button" data-open-reading-hive="${item.id}">Mediciones</button><button class="mini-button" data-edit-hive="${item.id}">Editar</button><button class="mini-button danger" data-delete-hive="${item.id}">Eliminar</button></div>
      </article>`;
    }).join('');
  }

  async function loadReadings() {
    const metric = $('#readingMetric').value;
    const hive = $('#readingHive').value;
    const from = $('#readingFrom').value;
    const to = $('#readingTo').value;
    const params = new URLSearchParams({ metric, from, to, limit: '3000' });
    if (hive) params.set('hive_id', hive);
    const data = await api(`/api/dashboard/readings.php?${params}`);
    state.readingItems = data.items || [];
    $('#readingChartTitle').textContent = data.metric.label;
    $('#readingUnit').textContent = data.metric.unit;
    $('#readingChartEmpty').style.display = state.readingItems.length ? 'none' : 'grid';
    lineChart('readings', 'readingChart', state.readingItems.map(item => formatDate(item.measured_at, true)), state.readingItems.map(item => Number(item.value)), data.metric.unit);
    $('#readingTable').innerHTML = state.readingItems.length ? state.readingItems.slice().reverse().map(item => `<tr><td>${formatDate(item.measured_at, true)}</td><td>${escapeHtml(item.hive_name || 'Sin asignar')}</td><td>${escapeHtml(item.device_uid)}</td><td><span class="value-badge">${formatNumber(item.value, 2)} ${escapeHtml(data.metric.unit)}</span></td></tr>`).join('') : '<tr><td colspan="4">Sin mediciones en el rango seleccionado.</td></tr>';
  }

  function exportReadingsCsv() {
    if (!state.readingItems.length) {
      toast('No hay mediciones para exportar.', 'error');
      return;
    }
    const metric = $('#readingMetric').value;
    const rows = [['fecha','colmena','dispositivo',metric], ...state.readingItems.map(item => [item.measured_at, item.hive_name || '', item.device_uid, item.value])];
    downloadCsv(`mellifera_${metric}_${dateInput(new Date())}.csv`, rows);
  }

  async function loadAlerts() {
    const status = $('#alertStatusFilter')?.value ?? 'open';
    const query = status ? `&status=${encodeURIComponent(status)}` : '';
    const data = await api(`/api/manage/records.php?resource=alerts&limit=500${query}`);
    const container = $('#alertBoard');
    if (!data.items.length) {
      container.innerHTML = '<div class="empty-state">No hay alertas en este estado.</div>';
      return;
    }
    container.innerHTML = data.items.map(item => `<article class="alert-card ${escapeHtml(item.severity)}"><span class="alert-card-icon">!</span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.hive_name || 'Sistema')} · ${formatDate(item.detected_at, true)} · ${escapeHtml(item.severity)}</small></div><div class="alert-actions">${item.status === 'open' ? `<button class="mini-button" data-alert-action="acknowledged" data-id="${item.id}">Reconocer</button>` : ''}${item.status !== 'closed' ? `<button class="mini-button" data-alert-action="closed" data-id="${item.id}">Cerrar</button>` : ''}</div></article>`).join('');
  }

  async function loadProduction() {
    const data = await api('/api/manage/records.php?resource=production&limit=1000');
    const items = data.items || [];
    const total = items.reduce((sum, item) => sum + Number(item.kilos || 0), 0);
    $('#productionTotal').textContent = formatNumber(total, 1);
    $('#productionCount').textContent = `${items.length} registros`;
    $('#productionTable').innerHTML = items.length ? items.map(item => `<tr><td>${formatDate(item.produced_on)}</td><td>${escapeHtml(item.hive_name)}</td><td>${formatNumber(item.kilos, 2)} kg</td><td>${escapeHtml(item.harvest_type || '—')}</td><td>${escapeHtml(item.notes || '—')}</td><td><button class="mini-button danger" data-delete-record="production" data-id="${item.id}">Eliminar</button></td></tr>`).join('') : '<tr><td colspan="6">Todavía no hay registros de producción.</td></tr>';
    const monthly = new Map();
    items.forEach(item => {
      const key = String(item.produced_on).slice(0, 7);
      monthly.set(key, (monthly.get(key) || 0) + Number(item.kilos || 0));
    });
    const labels = [...monthly.keys()].sort();
    $('#productionChartEmpty').style.display = labels.length ? 'none' : 'grid';
    barChart('production', 'productionChart', labels.map(key => new Date(`${key}-01T00:00:00`).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })), labels.map(key => monthly.get(key)), 'kg');
  }

  async function loadHealth() {
    const [treatments, varroa] = await Promise.all([
      api('/api/manage/records.php?resource=treatments&limit=500'),
      api('/api/manage/records.php?resource=varroa&limit=500'),
    ]);
    $('#treatmentTable').innerHTML = treatments.items.length ? treatments.items.map(item => {
      const active = !item.removed_on;
      return `<tr><td>${escapeHtml(item.hive_name)}</td><td>${escapeHtml(item.product_name)}</td><td>${formatDate(item.started_on)}</td><td>${formatDate(item.removed_on || item.expected_removal_on)}</td><td><span class="status-badge ${active ? 'open' : 'active'}">${active ? 'En curso' : 'Finalizado'}</span></td><td><button class="mini-button danger" data-delete-record="treatments" data-id="${item.id}">Eliminar</button></td></tr>`;
    }).join('') : '<tr><td colspan="6">No hay tratamientos registrados.</td></tr>';

    const latestByHive = new Map();
    varroa.items.forEach(item => { if (!latestByHive.has(item.hive_id)) latestByHive.set(item.hive_id, item); });
    const latest = [...latestByHive.values()];
    $('#varroaCards').innerHTML = latest.length ? latest.map(item => {
      const pct = Number(item.percentage);
      const cls = pct >= 3 ? 'bad' : pct >= 1.5 ? 'warn' : '';
      return `<article class="stack-item"><div class="varroa-meter"><div><b>${escapeHtml(item.hive_name)}</b><small>${formatDate(item.measured_on)} · ${escapeHtml(item.method || 'Método no indicado')}</small></div><div class="varroa-bar"><i class="${cls}" style="width:${Math.min(100, pct * 20)}%"></i></div><strong>${formatNumber(pct, 1)}%</strong><button class="mini-button danger" data-delete-record="varroa" data-id="${item.id}">×</button></div></article>`;
    }).join('') : '<div class="empty-state">No hay conteos de varroa registrados.</div>';
  }

  function queenColor(year, explicit) {
    if (explicit) return explicit.toLowerCase();
    const d = Math.abs(Number(year)) % 10;
    if ([1,6].includes(d)) return '#f5f5f5';
    if ([2,7].includes(d)) return '#ffd54f';
    if ([3,8].includes(d)) return '#ff6b6b';
    if ([4,9].includes(d)) return '#49d17d';
    if ([5,0].includes(d)) return '#4da3ff';
    return '#8d96a3';
  }

  async function loadQueens() {
    const data = await api('/api/manage/records.php?resource=queens&limit=500');
    const container = $('#queenCards');
    if (!data.items.length) {
      container.innerHTML = '<div class="empty-state">No hay reinas registradas.</div>';
      return;
    }
    const colorNames = { blanco: '#f5f5f5', amarillo: '#ffd54f', rojo: '#ff6b6b', verde: '#49d17d', azul: '#4da3ff' };
    container.innerHTML = data.items.map(item => {
      const color = colorNames[String(item.marking_color || '').toLowerCase()] || queenColor(item.birth_year, null);
      return `<article class="content-card queen-card"><span class="queen-color" style="background:${color}"></span><div><div class="card-top"><div><small>${escapeHtml(item.hive_name)}</small><h3>Reina ${item.birth_year || 'sin año'}</h3></div><span class="status-badge ${item.status === 'active' ? 'active' : ''}">${escapeHtml(item.status)}</span></div><p>Introducida ${formatDate(item.introduced_on)} · ${escapeHtml(item.origin || 'Origen no indicado')}</p><div class="card-actions"><button class="mini-button danger" data-delete-record="queens" data-id="${item.id}">Eliminar</button></div></div></article>`;
    }).join('');
  }

  async function loadCalendar() {
    const month = `${state.calendarDate.getFullYear()}-${String(state.calendarDate.getMonth() + 1).padStart(2, '0')}`;
    const data = await api(`/api/manage/records.php?resource=calendar&month=${month}&limit=500`);
    renderCalendar(data.items || []);
  }

  function renderCalendar(items) {
    const date = state.calendarDate;
    $('#calendarTitle').textContent = date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(first);
    const mondayIndex = (first.getDay() + 6) % 7;
    start.setDate(first.getDate() - mondayIndex);
    const eventsByDate = new Map();
    items.forEach(item => {
      if (!eventsByDate.has(item.event_date)) eventsByDate.set(item.event_date, []);
      eventsByDate.get(item.event_date).push(item);
    });
    const weekdays = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day => `<div class="calendar-weekday">${day}</div>`).join('');
    let days = '';
    for (let i = 0; i < 42; i++) {
      const current = new Date(start); current.setDate(start.getDate() + i);
      const key = dateInput(current);
      const sameMonth = current.getMonth() === date.getMonth();
      const today = key === dateInput(new Date());
      const dayEvents = eventsByDate.get(key) || [];
      days += `<div class="calendar-day ${sameMonth ? '' : 'other'} ${today ? 'today' : ''}" data-calendar-date="${key}"><span>${current.getDate()}</span>${dayEvents.slice(0, 3).map(event => `<b class="calendar-event-pill" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</b>`).join('')}</div>`;
    }
    $('#calendarGrid').innerHTML = weekdays + days;
    $('#calendarEvents').innerHTML = items.length ? items.map(item => `<article class="stack-item"><div><b>${escapeHtml(item.title)}</b><small>${formatDate(item.event_date)}${item.start_time ? ` · ${item.start_time.slice(0, 5)}` : ''} · ${escapeHtml(item.hive_name || 'Todo el apiario')}</small></div><button class="mini-button danger" data-delete-record="calendar" data-id="${item.id}">×</button></article>`).join('') : '<div class="empty-state">No hay eventos este mes.</div>';
  }

  async function changeCalendarMonth(offset) {
    state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + offset, 1);
    await loadCalendar();
  }

  async function loadNotes() {
    const data = await api('/api/manage/records.php?resource=notes&limit=500');
    const container = $('#noteGrid');
    if (!data.items.length) {
      container.innerHTML = '<div class="empty-state">Todavía no hay anotaciones.</div>';
      return;
    }
    container.innerHTML = data.items.map(item => `<article class="note-card ${Number(item.pinned) ? 'pinned' : ''}"><small>${escapeHtml(item.hive_name || 'General')} · ${formatDate(item.created_at, true)}</small><h3>${escapeHtml(item.title || 'Anotación')}</h3><p>${escapeHtml(item.note_text)}</p><div class="card-actions"><button class="mini-button danger" data-delete-record="notes" data-id="${item.id}">Eliminar</button></div></article>`).join('');
  }

  function renderDevices() {
    const table = $('#deviceTable');
    if (!table) return;
    if (!state.devices.length) {
      table.innerHTML = '<tr><td colspan="7">No hay dispositivos provisionados.</td></tr>';
      return;
    }
    table.innerHTML = state.devices.map(item => `<tr><td>${item.device_type === 'mother' ? 'Madre' : 'Hijo'}</td><td><b>${escapeHtml(item.display_name || item.device_uid)}</b><br><small>${escapeHtml(item.device_uid)}</small></td><td>${escapeHtml(item.parent_uid || '—')}</td><td>${escapeHtml(item.hive_name || 'Sin asignar')}</td><td><span class="status-badge ${item.status === 'unassigned' ? 'unassigned' : item.is_online ? 'active' : ''}">${item.is_online ? 'En línea' : escapeHtml(item.status)}</span></td><td>${formatDate(item.last_seen_at, true)}</td><td>${item.device_type === 'child' ? `<button class="mini-button" data-assign-device="${item.id}">Asignar</button>` : ''}</td></tr>`).join('');
  }

  async function loadAdminUsers() {
    if (state.user?.role !== 'admin') return;
    const data = await api('/api/admin/users.php');
    state.adminUsers = data.items || [];
    populateAdminUserSelect();
    renderAdminUsers();
  }

  function populateAdminUserSelect() {
    const select = $('#adminMotherUser');
    if (!select) return;
    const current = select.value;
    const users = state.adminUsers.filter(item => item.role !== 'admin' && item.status === 'active');
    select.innerHTML = `<option value="">Seleccione...</option>${users.map(item => `<option value="${item.id}">${escapeHtml(item.name)} · ${escapeHtml(item.email)}</option>`).join('')}`;
    if (current && users.some(item => String(item.id) === String(current))) select.value = current;
  }

  function renderAdminUsers() {
    const table = $('#adminUserTable');
    if (!table || state.user?.role !== 'admin') return;
    const search = ($('#adminUserSearch')?.value || '').trim().toLocaleLowerCase('es');
    const items = state.adminUsers.filter(item => {
      if (!search) return true;
      return [item.name, item.email, item.internal_code, item.role, item.status]
        .some(value => String(value || '').toLocaleLowerCase('es').includes(search));
    });

    if (!items.length) {
      table.innerHTML = '<tr><td colspan="7">No hay usuarios que coincidan con la búsqueda.</td></tr>';
      return;
    }

    table.innerHTML = items.map(item => {
      const canProvision = item.role !== 'admin' && item.status === 'active';
      const nextStatus = item.status === 'active' ? 'blocked' : 'active';
      const statusLabel = item.status === 'active' ? 'Bloquear' : 'Activar';
      return `<tr>
        <td><div class="admin-user-main"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.role)}</small></div></td>
        <td>${escapeHtml(item.email)}</td>
        <td><div class="admin-code-cell"><code>${escapeHtml(item.internal_code)}</code><button class="mini-button" data-copy-user-code="${item.id}" type="button">Copiar</button></div></td>
        <td><span class="status-badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td><div class="admin-device-counts"><span>${Number(item.mothers_count || 0)} madres</span><span>${Number(item.children_count || 0)} hijos</span></div></td>
        <td>${formatDate(item.last_seen_at, true)}</td>
        <td><div class="admin-actions">${canProvision ? `<button class="mini-button" data-admin-provision-user="${item.id}" type="button">Nueva madre</button>` : ''}${item.role === 'admin' ? '' : `<button class="mini-button ${nextStatus === 'blocked' ? 'danger' : ''}" data-admin-user-status="${nextStatus}" data-id="${item.id}" type="button">${statusLabel}</button>`}</div></td>
      </tr>`;
    }).join('');
  }

  function showProvisioningConfiguration(provisioning) {
    state.adminProvisioning = provisioning || null;
    const panel = $('#adminProvisionResult');
    const pre = $('#adminProvisioningJson');
    if (!panel || !pre || !state.adminProvisioning) return;
    pre.textContent = JSON.stringify(state.adminProvisioning, null, 2);
    panel.removeAttribute('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copyProvisioningConfiguration() {
    if (!state.adminProvisioning) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.adminProvisioning, null, 2));
      toast('Configuración copiada.');
    } catch {
      toast('No se pudo copiar automáticamente.', 'error');
    }
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
    dialog.showModal();
  }

  async function submitDialogForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.dataset.form;
    const data = Object.fromEntries(new FormData(form).entries());
    $$('input[type="checkbox"]', form).forEach(input => { data[input.name] = input.checked ? 1 : 0; });

    if (type === 'admin-mother') {
      setLoading(true);
      try {
        const result = await api('/api/admin/mothers.php', { method: 'POST', body: data });
        form.closest('dialog').close();
        showProvisioningConfiguration(result.provisioning);
        toast('Madre provisionada correctamente.');
        await loadAdminUsers();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    let endpoint = '';
    let method = 'POST';

    if (type === 'apiary') { endpoint = '/api/dashboard/apiaries.php'; method = data.id ? 'PUT' : 'POST'; }
    if (type === 'hive') { endpoint = '/api/dashboard/hives.php'; method = data.id ? 'PUT' : 'POST'; }
    if (type === 'device') { endpoint = '/api/dashboard/devices.php'; method = 'PUT'; }

    const resourceMap = { production: 'production', treatment: 'treatments', varroa: 'varroa', queen: 'queens', event: 'calendar', note: 'notes' };
    if (resourceMap[type]) endpoint = `/api/manage/records.php?resource=${resourceMap[type]}`;

    if (!endpoint) return;
    setLoading(true);
    try {
      await api(endpoint, { method, body: data });
      form.closest('dialog').close();
      toast('Registro guardado correctamente.');
      await Promise.all([loadApiaries(), loadHives(), loadDevices()]);
      populateAllSelects();
      await refreshCurrentView(false);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelegatedClick(event) {
    const closeDialog = event.target.closest('[data-close-dialog]');
    if (closeDialog) {
      closeDialog.closest('dialog')?.close();
      return;
    }
    const copyUserCode = event.target.closest('[data-copy-user-code]');
    if (copyUserCode) {
      const item = state.adminUsers.find(row => String(row.id) === String(copyUserCode.dataset.copyUserCode));
      if (!item) return;
      try {
        await navigator.clipboard.writeText(item.internal_code);
        toast('Código único copiado.');
      } catch {
        toast('No se pudo copiar automáticamente.', 'error');
      }
      return;
    }
    const provisionUser = event.target.closest('[data-admin-provision-user]');
    if (provisionUser) {
      openDialog('motherProvisionDialog', { user_id: provisionUser.dataset.adminProvisionUser });
      return;
    }
    const statusAction = event.target.closest('[data-admin-user-status]');
    if (statusAction) {
      const status = statusAction.dataset.adminUserStatus;
      const label = status === 'blocked' ? 'bloquear' : 'activar';
      if (!confirm(`¿Confirma ${label} este usuario?`)) return;
      try {
        await api('/api/admin/users.php', { method: 'PUT', body: { id: statusAction.dataset.id, status } });
        toast('Estado del usuario actualizado.');
        await loadAdminUsers();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    const apiaryEdit = event.target.closest('[data-edit-apiary]');
    if (apiaryEdit) {
      const item = state.apiaries.find(row => String(row.id) === apiaryEdit.dataset.editApiary);
      if (item) openDialog('apiaryDialog', item);
      return;
    }
    const hiveEdit = event.target.closest('[data-edit-hive]');
    if (hiveEdit) {
      const item = state.hives.find(row => String(row.id) === hiveEdit.dataset.editHive);
      if (item) openDialog('hiveDialog', item);
      return;
    }
    const readHive = event.target.closest('[data-open-reading-hive]');
    if (readHive) {
      switchView('readings');
      $('#readingHive').value = readHive.dataset.openReadingHive;
      await loadReadings();
      return;
    }
    const assign = event.target.closest('[data-assign-device]');
    if (assign) {
      const item = state.devices.find(row => String(row.id) === assign.dataset.assignDevice);
      if (item) openDialog('deviceDialog', { id: item.id, hive_id: item.hive_id || '', display_name: item.display_name || '' });
      return;
    }
    const alertAction = event.target.closest('[data-alert-action]');
    if (alertAction) {
      await api('/api/manage/records.php?resource=alerts', { method: 'PUT', body: { id: alertAction.dataset.id, status: alertAction.dataset.alertAction } });
      toast('Alerta actualizada.');
      await loadAlerts();
      return;
    }
    const deleteRecord = event.target.closest('[data-delete-record]');
    if (deleteRecord) {
      if (!confirm('¿Eliminar este registro?')) return;
      await api(`/api/manage/records.php?resource=${deleteRecord.dataset.deleteRecord}`, { method: 'DELETE', body: { id: deleteRecord.dataset.id } });
      toast('Registro eliminado.');
      await refreshCurrentView(false);
      return;
    }
    const deleteApiary = event.target.closest('[data-delete-apiary]');
    if (deleteApiary) {
      if (!confirm('¿Eliminar este apiario?')) return;
      try {
        await api('/api/dashboard/apiaries.php', { method: 'DELETE', body: { id: deleteApiary.dataset.deleteApiary } });
        toast('Apiario eliminado.');
        await loadApiaries(); populateAllSelects();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const deleteHive = event.target.closest('[data-delete-hive]');
    if (deleteHive) {
      if (!confirm('¿Eliminar esta colmena y sus registros asociados?')) return;
      try {
        await api('/api/dashboard/hives.php', { method: 'DELETE', body: { id: deleteHive.dataset.deleteHive } });
        toast('Colmena eliminada.');
        await Promise.all([loadHives(), loadDevices()]); populateAllSelects();
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    const calDay = event.target.closest('[data-calendar-date]');
    if (calDay) openDialog('eventDialog', { event_date: calDay.dataset.calendarDate });
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  }

  window.addEventListener('online', () => { $('#connectionChip').classList.remove('offline'); $('#connectionChip span').textContent = 'Conectado'; });
  window.addEventListener('offline', () => { $('#connectionChip').classList.add('offline'); $('#connectionChip span').textContent = 'Sin conexión'; });

  bootstrap();
})();
