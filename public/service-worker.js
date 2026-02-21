// FitMunch Enhanced Service Worker
const CACHE_NAME = 'fitmunch-v1.3.0';
const STATIC_CACHE = 'fitmunch-static-v1.3.0';
const DYNAMIC_CACHE = 'fitmunch-dynamic-v1.3.0';

// Critical assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/style.css',
  '/api_service.js',
  '/script.js',
  '/enhanced_analytics.js',
  '/app_initialization.js',
  '/app_fixes.js',
  '/enhanced_features.css',
  '/enhanced_features.js',
  '/analytics.js'
];

// Runtime cache for API calls and dynamic content
const CACHE_STRATEGIES = {
  '/api/': 'network-first',
  '/images/': 'cache-first',
  '/': 'network-first'
};

// Enhanced install event with better error handling
self.addEventListener('install', (event) => {
  console.log('SW: Installing enhanced service worker');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('SW: Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, {cache: 'reload'})));
      })
      .then(() => {
        console.log('SW: Static assets cached successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('SW: Cache installation failed', error);
      })
  );
});

// Enhanced fetch event with intelligent caching strategies
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and chrome-extension requests
  if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  const url = new URL(event.request.url);
  
  // Handle API requests with network-first strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }

  // Handle JavaScript files with network-first to always get fresh code
  if (url.pathname.match(/\.js$/)) {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }
  
  // Handle other static assets (CSS, images) with cache-first strategy
  if (url.pathname.match(/\.(css|png|jpg|jpeg|svg|ico)$/)) {
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }

  // Handle navigation requests with network-first, fallback to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }

  // Default: cache-first strategy
  event.respondWith(cacheFirstStrategy(event.request));
});

// Network-first strategy for dynamic content
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // Return offline fallback for navigation
    if (request.mode === 'navigate') {
      return caches.match('/');
    }
    throw error;
  }
}

// Cache-first strategy for static assets
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('SW: Fetch failed for', request.url, error);
    throw error;
  }
}

// Enhanced activate event with better cache management
self.addEventListener('activate', (event) => {
  console.log('SW: Activating enhanced service worker');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (![STATIC_CACHE, DYNAMIC_CACHE].includes(cacheName)) {
              console.log('SW: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients immediately
      self.clients.claim()
    ]).then(() => {
      console.log('SW: Enhanced service worker activated successfully');
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'nutrition-sync') {
    event.waitUntil(syncNutritionData());
  }
});

// Sync nutrition data when back online
async function syncNutritionData() {
  try {
    // Get pending sync data from IndexedDB (implement when adding offline support)
    console.log('SW: Syncing nutrition data...');
    // Implementation will be added with offline features
  } catch (error) {
    console.error('SW: Sync failed', error);
  }
}