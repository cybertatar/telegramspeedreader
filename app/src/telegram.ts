// Тонкая обёртка над Telegram Mini Apps SDK. Вне Telegram (обычный браузер,
// превью) всё молча работает без него.

interface TgButton {
  show(): void;
  hide(): void;
  onClick(fn: () => void): void;
  offClick(fn: () => void): void;
}

interface TgWebApp {
  initData: string;
  version: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  isVersionAtLeast(v: string): boolean;
  platform: string;
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  onEvent(e: string, fn: () => void): void;
  BackButton: TgButton;
  CloudStorage?: {
    setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
    getItems(
      keys: string[],
      cb: (err: string | null, values?: Record<string, string>) => void,
    ): void;
    removeItems(keys: string[], cb?: (err: string | null, ok?: boolean) => void): void;
    getKeys(cb: (err: string | null, keys?: string[]) => void): void;
  };
  HapticFeedback?: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    selectionChanged(): void;
    notificationOccurred(t: 'error' | 'success' | 'warning'): void;
  };
}

const tg: TgWebApp | undefined = (window as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** Открыто ли внутри Telegram (скрипт SDK грузится и в браузере, но initData пустой). */
export const inTelegram = !!tg?.initData;

export function initTelegram() {
  if (!inTelegram || !tg) return;
  tg.ready();
  tg.expand();
  // Иначе свайп вниз для замедления сворачивает мини-апп.
  if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.('bg_color');
  tg.setBackgroundColor?.('bg_color');
  if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor?.('bg_color');

  // Полный экран — только на телефонах: на компьютере он развернул бы окно Telegram.
  // Сверху остаются кнопки Telegram «Закрыть» и «⋯», шапка приложения встаёт между ними.
  const markFullscreen = () =>
    document.documentElement.toggleAttribute('data-fullscreen', !!tg.isFullscreen);
  if (tg.isVersionAtLeast('8.0') && ['ios', 'android'].includes(tg.platform)) {
    tg.onEvent('fullscreenChanged', markFullscreen);
    if (!tg.isFullscreen) tg.requestFullscreen?.();
    markFullscreen();
  }
}

/** Приложение свернули или закрыли шторкой — чтение надо остановить. */
export function onDeactivate(fn: () => void) {
  if (inTelegram && tg?.isVersionAtLeast('8.0')) tg.onEvent('deactivated', fn);
}

export const haptic = {
  tick: () => tg?.HapticFeedback?.selectionChanged(),
  bump: () => tg?.HapticFeedback?.impactOccurred('light'),
  stop: () => tg?.HapticFeedback?.impactOccurred('medium'),
};

let backHandler: (() => void) | null = null;

/** Системная кнопка «Назад» Telegram; `null` — спрятать. */
export function setBack(fn: (() => void) | null) {
  if (!inTelegram || !tg) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = fn;
  if (fn) {
    tg.BackButton.onClick(fn);
    tg.BackButton.show();
  } else tg.BackButton.hide();
}

/** Подпись Telegram для запросов к нашему Worker. */
export const initData = inTelegram ? tg!.initData : '';

// Облачное хранилище Telegram: до 1024 ключей по 4 КБ у каждого пользователя бота.
// Список книг и прогресс видны на всех устройствах.
const cloud = inTelegram && tg?.isVersionAtLeast('6.9') ? tg.CloudStorage : undefined;
export const hasCloudStorage = !!cloud;

const call = <T>(fn: (cb: (err: string | null, v?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, v) => (err ? reject(new Error(err)) : resolve(v!))));

export const cloudStorage = {
  async keys(): Promise<string[]> {
    return cloud ? call<string[]>((cb) => cloud.getKeys(cb)) : [];
  },
  async get(keys: string[]): Promise<Record<string, string>> {
    if (!cloud || !keys.length) return {};
    // За один запрос — не больше сотни ключей.
    const out: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += 100)
      Object.assign(
        out,
        await call<Record<string, string>>((cb) => cloud.getItems(keys.slice(i, i + 100), cb)),
      );
    return out;
  },
  async set(key: string, value: string) {
    if (cloud) await call((cb) => cloud.setItem(key, value, cb));
  },
  async remove(keys: string[]) {
    if (cloud && keys.length) await call((cb) => cloud.removeItems(keys, cb));
  },
};
