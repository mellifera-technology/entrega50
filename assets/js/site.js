(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const apiBase = String(window.MELLIFERA_CONFIG?.API_BASE || '').replace(/\/+$/, '');
  const apiUrl = path => `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let csrf = '';

  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  $('#mobileMenu')?.addEventListener('click', () => $('#marketingNav')?.classList.toggle('open'));
  $$('#marketingNav a').forEach(link => link.addEventListener('click', () => $('#marketingNav')?.classList.remove('open')));

  const header = $('#marketingHeader');
  const updateHeader = () => header?.classList.toggle('compact', scrollY > 40);
  updateHeader();
  addEventListener('scroll', updateHeader, { passive: true });

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  $$('.reveal').forEach((element, index) => {
    element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    observer.observe(element);
  });

  const stage = $('#heroStage');
  if (stage && matchMedia('(pointer:fine)').matches && !reducedMotion) {
    stage.addEventListener('pointermove', event => {
      const rect = stage.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 10;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * -8;
      const card = $('.dashboard-preview', stage);
      if (card) card.style.transform = `rotateY(${x - 8}deg) rotateX(${y + 3}deg) translate3d(0,0,0)`;
    });
    stage.addEventListener('pointerleave', () => {
      const card = $('.dashboard-preview', stage);
      if (card) card.style.transform = '';
    });
  }

  $$('.bento').forEach(card => {
    card.addEventListener('pointermove', event => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });

  async function loadSession() {
    const response = await fetch(apiUrl('/api/auth/me.php'), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'No se pudo consultar la sesión.');
    csrf = data.csrf_token || '';
    if (data.authenticated) {
      $('#headerPanelButton')?.removeAttribute('hidden');
      $('#headerGuestActions')?.setAttribute('hidden', '');
      const hero = $('#heroPrimaryAction');
      if (hero) { hero.href = data.user?.role === 'admin' ? 'admin.html' : 'dashboard.html'; hero.textContent = 'Ir al panel'; }
    }
  }

  $('#contactForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $('#contactStatus');
    const button = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Enviando…';
    try {
      if (!csrf) await loadSession();
      const response = await fetch(apiUrl('/api/contact.php'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo enviar la consulta.');
      form.reset();
      status.className = 'form-status success';
      status.textContent = 'Consulta enviada correctamente.';
    } catch (error) {
      status.className = 'form-status error';
      status.textContent = error.message || 'No se pudo conectar con el servidor.';
    } finally {
      button.disabled = false;
    }
  });

  loadSession().catch(() => {});
})();
