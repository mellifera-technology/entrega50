const CACHE = 'mellifera-app-v3';
const STATIC = [
  './', './index.html', './login.html', './register.html', './dashboard.html', './admin.html',
  './config.js', './manifest.webmanifest', './assets/css/app.css',
  './assets/js/site.js', './assets/js/auth.js', './assets/js/dashboard.js', './assets/js/admin.js',
  './assets/img/logo-light.png', './assets/img/logo-dark.png', './assets/img/logo-hero.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname === 'mellifera-api.mellifera-technology.com' || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
