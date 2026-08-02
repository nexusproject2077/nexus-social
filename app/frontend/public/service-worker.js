// public/service-worker.js - Service Worker pour PWA

const CACHE_NAME = 'nexus-social-v1';
const RUNTIME_CACHE = 'nexus-runtime-v1';

// Fichiers à mettre en cache au premier chargement.
// NB : on ne précache PAS les bundles JS/CSS — leurs noms sont hashés par CRA
// (main.<hash>.js), donc des chemins fixes renverraient un 404 et feraient
// échouer tout addAll() (→ SW non installé). Ils sont mis en cache à la volée.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Installation du Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precaching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activation du Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interception des requêtes
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-HTTP
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Ignorer les appels API et WebSocket
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
    return;
  }

  // Stratégie Cache First pour les assets statiques
  if (request.destination === 'image' || 
      request.destination === 'style' || 
      request.destination === 'script' ||
      request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((response) => {
          // Mettre en cache si succès
          if (response.status === 200) {
            const responseToCache = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Stratégie Network First pour les pages HTML
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Mettre en cache si succès
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback sur le cache si offline
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Page offline de secours
          return caches.match('/index.html');
        });
      })
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

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
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
      timestamp: Date.now()
    },
    actions: data.actions || [
      {
        action: 'open',
        title: 'Ouvrir'
      },
      {
        action: 'close',
        title: 'Fermer'
      }
    ],
    tag: data.tag || 'nexus-notification',
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Nexus Social', options)
  );
});

// Click sur notification
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');

  event.notification.close();
  if (event.action === 'close') return;

  const rawUrl = event.notification.data?.url || '/';
  // URL absolue basée sur l'origine du SW (les URLs stockées sont relatives).
  const target = new URL(rawUrl, self.location.origin);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Réutiliser une fenêtre déjà ouverte sur l'app : la focus puis naviguer.
        for (const client of clientList) {
          try {
            const cu = new URL(client.url);
            if (cu.origin === target.origin && 'focus' in client) {
              return client.focus().then((c) => {
                const f = c || client;
                // navigate() n'est pas partout dispo → message au client sinon.
                if ('navigate' in f) {
                  return f.navigate(target.href).catch(() => f);
                }
                if (f.postMessage) f.postMessage({ type: 'navigate', url: rawUrl });
                return f;
              });
            }
          } catch (e) { /* ignore */ }
        }
        // Aucune fenêtre : en ouvrir une nouvelle sur la destination.
        if (clients.openWindow) {
          return clients.openWindow(target.href);
        }
      })
  );
});

// Background sync (pour posts offline)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);

  if (event.tag === 'sync-posts') {
    event.waitUntil(syncOfflinePosts());
  }
});

async function syncOfflinePosts() {
  // Récupérer posts en attente depuis IndexedDB
  const db = await openDB('nexus-offline', 1);
  const posts = await db.getAll('pending-posts');

  for (const post of posts) {
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${post.token}`
        },
        body: JSON.stringify(post.data)
      });

      if (response.ok) {
        // Supprimer de la file d'attente
        await db.delete('pending-posts', post.id);
        console.log('[SW] Post synced:', post.id);
      }
    } catch (error) {
      console.error('[SW] Failed to sync post:', error);
    }
  }
}

// Helper IndexedDB
function openDB(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-posts')) {
        db.createObjectStore('pending-posts', { keyPath: 'id' });
      }
    };
  });
}

console.log('[SW] Service Worker loaded');
