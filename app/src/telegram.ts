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
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  onEvent(e: string, fn: () => void): void;
  BackButton: TgButton;
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
