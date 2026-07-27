(() => {
  'use strict';

  const form = document.getElementById('authForm');
  if (!form) return;

  const config = window.MELLIFERA_CONFIG || {};
  const apiBase = String(config.API_BASE || '').replace(/\/+$/, '');
  const status = document.getElementById('authStatus');
  const mode = form.dataset.mode;
  let csrf = '';

  const apiUrl = path => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;

  function redirectForSession(data) {
    if (!data?.authenticated && !data?.user) return false;
    const user = data.user;
    const actor = data.actor || user;
    const impersonating = Boolean(data.impersonating);
    location.replace(actor?.role === 'admin' && !impersonating ? 'admin.html' : 'dashboard.html');
    return true;
  }

  async function readJson(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`La API devolvió una respuesta inválida (HTTP ${response.status}).`);
    }
  }

  async function loadSession() {
    const response = await fetch(apiUrl('/api/auth/me.php'), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.message || 'No se pudo iniciar la sesión segura.');
    csrf = data.csrf_token || '';
    redirectForSession(data);
  }

  document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const field = document.getElementById(button.dataset.target);
      if (!field) return;
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      button.textContent = show ? 'Ocultar' : 'Ver';
    });
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());

    if (mode === 'register' && payload.password !== payload.password_confirm) {
      status.className = 'form-status error';
      status.textContent = 'Las contraseñas no coinciden.';
      return;
    }

    submit.disabled = true;
    status.className = 'form-status';
    status.textContent = mode === 'login' ? 'Ingresando…' : 'Creando cuenta…';

    try {
      if (!csrf) await loadSession();
      const response = await fetch(apiUrl(`/api/auth/${mode}.php`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || 'No se pudo completar la operación.');
      if (!redirectForSession({ ...data, authenticated: true })) {
        location.replace('dashboard.html');
      }
    } catch (error) {
      status.className = 'form-status error';
      status.textContent = error.message || 'No se pudo conectar con el servidor.';
      submit.disabled = false;
    }
  });

  loadSession().catch(error => {
    status.className = 'form-status error';
    status.textContent = `No se pudo conectar con Mellifera: ${error.message}`;
  });
})();
