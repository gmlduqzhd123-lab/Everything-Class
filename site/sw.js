// 초등 수업 대백과 오프라인 지원 — 같은 주소(github.io)의 다른 엽쌤 앱과 캐시 저장소를 같이 쓰므로 내 접두어 캐시만 지운다
// 영상 목록(videos.json)과 화면 파일은 항상 네트워크 우선이라 시트 갱신이 바로 보인다. 유튜브 등 다른 주소 요청은 건드리지 않는다.
const CACHE = 'everything-class-v1';
const CACHE_PREFIX = 'everything-class-v';
const CORE = ['./', './index.html', './style.css', './manifest.webmanifest', './ys-install.js', './ys-qr.js', './qr.svg', './icons/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; })
    .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
