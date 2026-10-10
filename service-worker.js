const CACHE_NAME = "family-business-pwa-v3";
const ROOT = new URL("./", self.location.href).pathname;

const PRECACHE = [
  ROOT + "pwa/install.js",
  ROOT + "pwa/install.css",
  ROOT + "pwa/offline.html",
  ROOT + "pwa/icons/icon-192.png",
  ROOT + "pwa/icons/icon-512.png",
  ROOT + "pwa/icons/supermarket-192.png",
  ROOT + "pwa/icons/supermarket-512.png",
  ROOT + "pwa/icons/restaurant-192.png",
  ROOT + "pwa/icons/restaurant-512.png",
  ROOT + "pwa/icons/bakery-192.png",
  ROOT + "pwa/icons/bakery-512.png",
  ROOT + "pwa/icons/laundry-192.png",
  ROOT + "pwa/icons/laundry-512.png",
  ROOT + "core/qr/customer-qr.js",
  ROOT + "core/qr/vendor/qrcode.mjs"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function sameOrigin(request){
  try{return new URL(request.url).origin === self.location.origin;}catch{return false;}
}

async function networkFirst(request){
  const cache = await caches.open(CACHE_NAME);
  try{
    const response = await fetch(request);
    if(response && response.ok && sameOrigin(request)) cache.put(request, response.clone());
    return response;
  }catch{
    return (await cache.match(request)) || (await cache.match(ROOT + "pwa/offline.html"));
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if(response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network || Response.error();
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if(request.method !== "GET" || !sameOrigin(request)) return;

  if(request.mode === "navigate"){
    event.respondWith(networkFirst(request));
    return;
  }

  const destination = request.destination;
  if(["script","style","image","font","manifest"].includes(destination)){
    event.respondWith(staleWhileRevalidate(request));
  }
});
