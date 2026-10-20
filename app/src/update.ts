// Telegram на телефоне долго держит мини-апп в кэше, и после публикации открывается
// старая версия. При запуске и при возвращении в приложение сверяем номер сборки
// с version.json на сайте и, если вышла новая, перезагружаемся с новым адресом —
// по другому адресу страница кэшем уже не подменится.

declare const __BUILD__: string;

const TRIED = 'tsr:update-tried';

async function check() {
  if (import.meta.env.DEV || import.meta.env.MODE === 'preview') return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build: string };
    if (!build || build === __BUILD__) return;
    // Одна попытка на версию: если и после перезагрузки старая — не зацикливаемся.
    if (sessionStorage.getItem(TRIED) === build) return;
    sessionStorage.setItem(TRIED, build);
    const url = new URL(location.href);
    url.searchParams.set('v', build);
    location.replace(url.toString());
  } catch {
    /* нет сети или хранилища — работаем на том, что есть */
  }
}

export function watchForUpdates() {
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
