// Service Worker for Fractonaut PWA
// Checks for updates on every launch, uses cache when offline

const CACHE_NAME = 'fractonaut-v1';
const RUNTIME_CACHE = 'fractonaut-runtime';
const CACHE_VERSION = 'v1';

// Files to cache on install
const PRECACHE_FILES = [
  './',
  './index.html',
  './script.js',
  './style.css',
  './manifest.json',
  './256.png',
  './512.png',
  './1024.png'
];

// Install event - cache files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_FILES);
    })
  );
  // Force activation of new service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE;
          })
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  // Take control of all pages immediately
  return self.clients.claim();
});

// Fetch event - network first when online, cache when offline
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-first strategy: try network, fallback to cache
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        // If online and successful, update cache and return fresh response
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // If offline or fetch fails, return from cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

