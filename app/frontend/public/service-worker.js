// public/service-worker.js — Service Worker « push uniquement ».
//
// ⚠️ IMPORTANT : ce worker NE MET RIEN EN CACHE et n'intercepte AUCUNE requête
// réseau (pas de handler `fetch`). Une version précédente faisait du
// « Cache First » sur les scripts/styles + un précache du HTML : une fois le SW
// activé, il servait d'anciens bundles et cassait le chargement après chaque
// déploiement (« rien ne charge », lenteurs, ancienne interface figée).
// On garde donc UNIQUEMENT ce qui est nécessaire aux notifications push, et on
// PURGE les anciens caches à l'activation pour réparer les navigateurs touchés.

// Version : incrémenter pour forcer les navigateurs à mettre à jour le SW.
const SW_VERSION = 'nexus-push-2';

self.addEventListener('install', () => {
  // Pas de précache. On prend la main tout de suite.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Supprime TOUS les anciens caches (dont l'app shell obsolète) qui
      // pouvaient figer l'interface sur une ancienne version.
      try {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      } catch (e) {
        // ignore
      }
      await self.clients.claim();
    })()
  );
});

// Aucun handler `fetch` : le navigateur charge tout depuis le réseau
// normalement (plus de contenu périmé, plus de blocage).

// ── Notifications push ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Nexus Social', body: event.data.text() };
    }
  }

  const options = {
    body: data.body || 'Nouvelle notification',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/', timestamp: Date.now() },
    tag: data.tag || 'nexus-notification',
    renotify: false,
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Nexus Social', options)
  );
});

// Clic sur une notification → ouvre (ou focus) la bonne page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Réutilise un onglet ouvert de l'app si possible.
      for (const client of all) {
        try {
          const u = new URL(client.url);
          if (u.origin === self.location.origin && 'focus' in client) {
            if ('navigate' in client) { try { await client.navigate(target); } catch (e) { /* ignore */ } }
            return client.focus();
          }
        } catch (e) { /* ignore */ }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })()
  );
});
