// familytodo - sw.js
// Service Worker: オフライン対応のためにアプリファイルをキャッシュします。

const CACHE_NAME = "familytodo-v1";

// インストール時にキャッシュするファイル一覧
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// インストール: アプリシェルをキャッシュに保存
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// アクティベート: 古いキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// フェッチ: todo.txt はネットワーク優先、その他はキャッシュ優先
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isTodoFile = url.pathname.endsWith("todo.txt");

  if (isTodoFile) {
    // ネットワーク優先: 取得できたらキャッシュも更新、失敗したらキャッシュから返す
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, clone)
            );
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // キャッシュ優先: キャッシュになければネットワークから取得
    event.respondWith(
      caches.match(event.request).then(
        (cached) => cached || fetch(event.request).catch(() => new Response("", { status: 503 }))
      )
    );
  }
});
