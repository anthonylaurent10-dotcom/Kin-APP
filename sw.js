// ============================================================
// SERVICE WORKER — Alyzio
// ============================================================

const CACHE_NAME = 'kineapp-v1';

const APP_SHELL = [
  './',
  './index.html',
  './patient.html',
  './dashboard.html',
  './manifest.json',
  './icon-16.png',
  './icon-32.png',
  './icon-48.png',
  './icon-72.png',
  './icon-96.png',
  './icon-128.png',
  './icon-144.png',
  './icon-152.png',
  './icon-192.png',
  './icon-512.png'
];

// Installation
self.addEventListener('install', event => {
  console.log('[SW] Service Worker installé');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] Cache install ignoré:', err))
  );

  self.skipWaiting();
});

// Activation
self.addEventListener('activate', event => {
  console.log('[SW] Service Worker activé');

  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => clients.claim())
  );
});

// Fetch basique
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Push notification
self.addEventListener('push', event => {
  console.log('[SW] Notification push reçue');

  if (!event.data) return;

  let data;

  try {
    data = event.data.json();
  } catch(e) {
    data = {
      title: 'Alyzio',
      body: event.data.text(),
      icon: './icon-192.png',
      badge: './badge-72.png',
      url: './'
    };
  }

  const options = {
    body: data.body,
    icon: data.icon || './icon-192.png',
    badge: data.badge || './badge-72.png',
    vibration: [200, 100, 200],
    data: {
      url: data.url || './',
      notificationId: data.notificationId || null
    },
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
    tag: data.tag || 'kineapp-default',
    timestamp: data.timestamp || Date.now()
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Alyzio', options)
  );
});

// Clic notification
self.addEventListener('notificationclick', event => {
  console.log('[SW] Clic sur notification');

  event.notification.close();

  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        const existingWindow = windowClients.find(client =>
          client.url.includes(targetUrl)
        );

        if (existingWindow) {
          return existingWindow.focus();
        }

        return clients.openWindow(targetUrl);
      })
  );
});

// Fermeture notification
self.addEventListener('notificationclose', event => {
  console.log('[SW] Notification fermée sans clic');
});
