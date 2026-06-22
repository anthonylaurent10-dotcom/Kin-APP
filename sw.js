// ============================================================
// SERVICE WORKER — KinéApp
// Ce fichier tourne en arrière-plan même quand le site est fermé
// ============================================================

const CACHE_NAME = 'kineapp-v1';

// === ÉVÉNEMENT : Installation du Service Worker ===
// Se déclenche la première fois que l'utilisateur visite le site
self.addEventListener('install', event => {
  console.log('[SW] Service Worker installé');
  // On prend le contrôle immédiatement sans attendre
  self.skipWaiting();
});

// === ÉVÉNEMENT : Activation ===
// Se déclenche quand le SW devient actif
self.addEventListener('activate', event => {
  console.log('[SW] Service Worker activé');
  event.waitUntil(clients.claim());
});

// === ÉVÉNEMENT : Réception d'une notification push ===
// C'est ICI que la notification s'affiche sur l'écran
self.addEventListener('push', event => {
  console.log('[SW] Notification push reçue');

  // Si pas de données, on affiche un message par défaut
  if (!event.data) {
    console.log('[SW] Pas de données dans la notification');
    return;
  }

  // On récupère les données envoyées par le serveur
  let data;
  try {
    data = event.data.json();
  } catch(e) {
    data = {
      title: 'KinéApp',
      body: event.data.text(),
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      url: '/'
    };
  }

  // Options d'affichage de la notification
  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/badge-72.png',
    // vibration: motif en millisecondes [vibrer, pause, vibrer]
    vibration: [200, 100, 200],
    // data: on stocke l'URL où aller quand le patient clique
    data: {
      url: data.url || '/',
      notificationId: data.notificationId || null
    },
    // Actions : boutons sous la notification (Android)
    actions: data.actions || [],
    // requireInteraction: la notification reste jusqu'à interaction
    requireInteraction: data.requireInteraction || false,
    // tag: si même tag, la nouvelle remplace l'ancienne (évite le spam)
    tag: data.tag || 'kineapp-default',
    // timestamp: heure d'affichage
    timestamp: data.timestamp || Date.now()
  };

  // On affiche la notification
  // event.waitUntil garantit que le SW reste actif jusqu'à la fin
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// === ÉVÉNEMENT : Clic sur la notification ===
// Quand l'utilisateur clique sur la notification
self.addEventListener('notificationclick', event => {
  console.log('[SW] Clic sur notification');

  // On ferme la notification
  event.notification.close();

  // On récupère l'URL cible
  const targetUrl = event.notification.data?.url || '/';

  // On ouvre ou focus l'onglet correspondant
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Cherche si un onglet avec cette URL est déjà ouvert
        const existingWindow = windowClients.find(
          client => client.url.includes(targetUrl)
        );

        if (existingWindow) {
          // L'onglet existe → on le met au premier plan
          return existingWindow.focus();
        } else {
          // L'onglet n'existe pas → on en ouvre un nouveau
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// === ÉVÉNEMENT : Fermeture de la notification ===
self.addEventListener('notificationclose', event => {
  console.log('[SW] Notification fermée sans clic');
  // Ici on pourrait enregistrer un stat "notification ignorée"
});
