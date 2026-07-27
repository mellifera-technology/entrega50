(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const apiBase = String(window.MELLIFERA_CONFIG?.API_BASE || '').replace(/\/+$/, '');
  const apiUrl = path => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  const state = {
    csrf: '',
    actor: null,
    users: [],
    incomingPage: 1,
    incomingPages: 1,
    currentView: 'server',
  };

  const viewMeta = {
    server: ['Administración', 'Estado del servidor'],
    users: ['Administración', 'Usuarios'],
    incoming: ['Administración', 'Recepciones'],
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatMeasurement(item) {
    if (item.measurement_num !== null && item.measurement_num !== undefined && item.measurement_num !== '') {
      return Number(item.measurement_num).toLocaleString('es-AR', { maximumFractionDigits: 6 });
    }
    return item.measurement_text || '—';
  }

  function setLoading(show) {
    $('#loadingOverlay')?.classList.toggle('show', show);
  }

  function toast(message, type = 'success') {
    const container = $('#toastContainer');
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.textContent = message;
    container.appendChild(element);
    setTimeout(() => element.remove(), 4500);
  }

  async function api(path, options = {}) {
    const response = await fetch(apiUrl(path), {
      method: options.method || 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.csrf === false ? {} : { 'X-CSRF-Token': state.csrf }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`La API devolvió una respuesta inválida (HTTP ${response.status}).`); }

    if (response.status === 401) {
      location.replace('login.html');
      throw new Error('Sesión vencida.');
    }
    if (!response.ok) throw new Error(data.message || `Error HTTP ${response.status}`);
    if (data.csrf_token) state.csrf = data.csrf_token;
    return data;
  }

  async function bootstrap() {
    setLoading(true);
    try {
      const me = await api('/api/auth/me.php', { csrf: false });
      if (!me.authenticated) {
        location.replace('login.html');
        return;
      }
      state.actor = me.actor || me.user;
      state.csrf = me.csrf_token || '';
      if (state.actor?.role !== 'admin') {
        location.replace('dashboard.html');
        return;
      }
      if (me.impersonating) {
        await api('/api/admin/stop_impersonation.php', { method: 'POST', body: {} });
      }

      $('#adminName').textContent = state.actor.name;
      $('#adminAvatar').textContent = state.actor.name.trim().charAt(0).toUpperCase();
      bindEvents();
      await Promise.all([loadServerStatus(), loadUsers()]);
      await loadIncoming();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function bindEvents() {
    $('#openSidebar')?.addEventListener('click', () => $('#sidebar')?.classList.add('open'));
    $('#closeSidebar')?.addEventListener('click', () => $('#sidebar')?.classList.remove('open'));
    $$('#adminNav [data-admin-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.adminView)));
    $('#adminRefreshButton')?.addEventListener('click', refreshCurrentView);
    $('#refreshUsersButton')?.addEventListener('click', loadUsers);
    $('#refreshIncomingButton')?.addEventListener('click', () => { state.incomingPage = 1; loadIncoming(); });
    $('#adminLogoutButton')?.addEventListener('click', logout);
    $('#adminUserSearch')?.addEventListener('input', renderUsers);
    $('#incomingStatus')?.addEventListener('change', () => { state.incomingPage = 1; loadIncoming(); });
    $('#incomingUser')?.addEventListener('change', () => { state.incomingPage = 1; loadIncoming(); });
    $('#incomingSearch')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { state.incomingPage = 1; loadIncoming(); }
    });
    $('#incomingPrev')?.addEventListener('click', () => {
      if (state.incomingPage > 1) { state.incomingPage--; loadIncoming(); }
    });
    $('#incomingNext')?.addEventListener('click', () => {
      if (state.incomingPage < state.incomingPages) { state.incomingPage++; loadIncoming(); }
    });
    document.addEventListener('click', handleClick);
  }

  async function switchView(view) {
    if (!viewMeta[view]) return;
    state.currentView = view;
    $$('[data-admin-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.adminPanel === view));
    $$('#adminNav [data-admin-view]').forEach(button => button.classList.toggle('active', button.dataset.adminView === view));
    $('#adminEyebrow').textContent = viewMeta[view][0];
    $('#adminTitle').textContent = viewMeta[view][1];
    $('#sidebar')?.classList.remove('open');
    await refreshCurrentView();
  }

  async function refreshCurrentView() {
    setLoading(true);
    try {
      if (state.currentView === 'server') await loadServerStatus();
      if (state.currentView === 'users') await loadUsers();
      if (state.currentView === 'incoming') await loadIncoming();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadServerStatus() {
    const data = await api('/api/admin/status.php');
    $('#serverApi').textContent = data.server.api === 'online' ? 'En línea' : data.server.api;
    $('#serverDatabase').textContent = data.server.database === 'connected' ? 'Conectada' : data.server.database;
    $('#serverHost').textContent = data.server.host || '—';
    $('#serverSchema').textContent = `Esquema ${data.server.schema_version || '—'}`;
    $('#serverUsers').textContent = data.totals.active_users;
    $('#serverUsersTotal').textContent = `${data.totals.users} registrados`;
    $('#serverToday').textContent = data.totals.receptions_today;
    $('#serverTotal').textContent = `${data.totals.receptions} históricas`;
    $('#serverHives').textContent = data.totals.hives;
    $('#serverLastReception').textContent = formatDate(data.last_reception_at);
    $('#serverTime').textContent = formatDate(data.server.server_time);
    $('#serverTimezone').textContent = data.server.timezone || '—';
    $('#serverPhp').textContent = data.server.php_version || '—';
    $('#adminConnection span').textContent = 'Conectado';
    $('#adminConnection').classList.remove('offline');
  }

  async function loadUsers() {
    const data = await api('/api/admin/users.php');
    state.users = data.items || [];
    populateUserFilter();
    renderUsers();
  }

  function populateUserFilter() {
    const select = $('#incomingUser');
    if (!select) return;
    const current = select.value;
    const users = state.users.filter(item => item.role !== 'admin');
    select.innerHTML = `<option value="">Todos los usuarios</option>${users.map(item => `<option value="${item.id}">${escapeHtml(item.name)} · ${escapeHtml(item.email)}</option>`).join('')}`;
    if (current && users.some(item => String(item.id) === current)) select.value = current;
  }

  function renderUsers() {
    const table = $('#adminUsersTable');
    if (!table) return;
    const search = ($('#adminUserSearch')?.value || '').trim().toLocaleLowerCase('es');
    const items = state.users.filter(item => {
      if (!search) return true;
      return [item.name, item.email, item.internal_code, item.status, item.role]
        .some(value => String(value || '').toLocaleLowerCase('es').includes(search));
    });

    if (!items.length) {
      table.innerHTML = '<tr><td colspan="8">No hay usuarios que coincidan con la búsqueda.</td></tr>';
      return;
    }

    table.innerHTML = items.map(item => `<tr>
      <td><div class="admin-user-main"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.role)}</small></div></td>
      <td>${escapeHtml(item.email)}</td>
      <td><div class="admin-code-cell"><code>${escapeHtml(item.internal_code)}</code><button class="mini-button" data-copy-code="${item.id}" type="button">Copiar</button></div></td>
      <td><span class="status-badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
      <td>${Number(item.hives_count || 0)}</td>
      <td>${Number(item.receptions_count || 0)}</td>
      <td>${formatDate(item.last_received_at)}</td>
      <td>${item.role === 'admin' ? '' : `<button class="mini-button" data-enter-user="${item.id}" type="button" ${item.status !== 'active' ? 'disabled' : ''}>Entrar como usuario</button>`}</td>
    </tr>`).join('');
  }

  async function loadIncoming() {
    const params = new URLSearchParams({ page: String(state.incomingPage), limit: '100' });
    const search = ($('#incomingSearch')?.value || '').trim();
    const status = $('#incomingStatus')?.value || '';
    const userId = $('#incomingUser')?.value || '';
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (userId) params.set('user_id', userId);

    const data = await api(`/api/admin/incoming.php?${params}`);
    const items = data.items || [];
    state.incomingPage = Number(data.pagination?.page || 1);
    state.incomingPages = Number(data.pagination?.pages || 1);
    renderIncoming(items, data.pagination || {});
  }

  function renderIncoming(items, pagination) {
    const table = $('#adminIncomingTable');
    if (!items.length) {
      table.innerHTML = '<tr><td colspan="8">No hay recepciones para estos filtros.</td></tr>';
    } else {
      table.innerHTML = items.map(item => `<tr>
        <td>${formatDate(item.received_at)}</td>
        <td><div class="admin-user-main"><b>${escapeHtml(item.user_name || 'Sin usuario')}</b><small>${escapeHtml(item.user_email || 'Código no reconocido')}</small></div></td>
        <td><code class="nowrap-code">${escapeHtml(item.account_code || '—')}</code></td>
        <td><code class="nowrap-code">${escapeHtml(item.device_mac || '—')}</code></td>
        <td><span class="sensor-badge">${escapeHtml(item.sensor || '—')}</span></td>
        <td><span class="value-badge">${escapeHtml(formatMeasurement(item))}</span></td>
        <td>${escapeHtml(item.hive_name || '—')}</td>
        <td><div class="result-cell"><span class="status-badge ${escapeHtml(item.processing_status)}">${escapeHtml(item.processing_status)}</span><small>${escapeHtml(item.processing_message || '')}</small></div></td>
      </tr>`).join('');
    }

    const total = Number(pagination.total || 0);
    $('#incomingPaginationLabel').textContent = `Página ${state.incomingPage} de ${state.incomingPages} · ${total} recepciones`;
    $('#incomingPrev').disabled = state.incomingPage <= 1;
    $('#incomingNext').disabled = state.incomingPage >= state.incomingPages;
  }

  async function handleClick(event) {
    const copy = event.target.closest('[data-copy-code]');
    if (copy) {
      const user = state.users.find(item => String(item.id) === copy.dataset.copyCode);
      if (!user) return;
      try {
        await navigator.clipboard.writeText(user.internal_code);
        toast('Código único copiado.');
      } catch {
        toast('No se pudo copiar automáticamente.', 'error');
      }
      return;
    }

    const enter = event.target.closest('[data-enter-user]');
    if (enter) {
      const user = state.users.find(item => String(item.id) === enter.dataset.enterUser);
      if (!user) return;
      if (!confirm(`¿Entrar al panel de ${user.name}?`)) return;
      setLoading(true);
      try {
        await api('/api/admin/impersonate.php', { method: 'POST', body: { user_id: user.id } });
        location.replace('dashboard.html');
      } catch (error) {
        toast(error.message, 'error');
        setLoading(false);
      }
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout.php', { method: 'POST', body: {} });
    } finally {
      location.replace('login.html');
    }
  }

  window.addEventListener('offline', () => {
    $('#adminConnection').classList.add('offline');
    $('#adminConnection span').textContent = 'Sin conexión';
  });
  window.addEventListener('online', () => {
    $('#adminConnection').classList.remove('offline');
    $('#adminConnection span').textContent = 'Conectado';
  });

  bootstrap();
})();
