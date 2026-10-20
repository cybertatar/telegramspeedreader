// Показ слов по таймеру. Главное здесь — паузы: текст не должен убегать,
// когда человек отвлёкся, и после паузы надо вернуть его в контекст.

import { blockStartOf, itemDelay, sentenceStartOf, type Stream } from './stream';

/** Пауза короче — не откатываем: человек просто перехватил телефон. */
export const SHORT_PAUSE = 2000;
/** Пауза длиннее — откатываем к началу абзаца, а не предложения. */
export const LONG_PAUSE = 60000;
/** Разгон после паузы: с 60% скорости до заданной. */
export const RAMP_MS = 2500;
const RAMP_FROM = 0.6;

export type PauseReason = 'user' | 'auto' | 'card' | 'jump' | 'end';
export type FiguresMode = 'stop' | 'glance' | 'skip';

export interface PlayerSettings {
  wpm: number;
  pauseScale: number;
  figures: FiguresMode;
  rewind: boolean;
  ramp: boolean;
}

export type PlayerEvent =
  | { type: 'word'; pos: number }
  | { type: 'state'; playing: boolean; reason?: PauseReason }
  | { type: 'card'; pos: number }
  | { type: 'glance'; pos: number }
  | { type: 'rewind'; from: number; to: number; scope: 'sentence' | 'paragraph' };

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
};

export class Player {
  pos = 0;
  playing = false;
  private timer: unknown = null;
  private nextAt = 0;
  private pausedAt = 0;
  private reason: PauseReason = 'jump';
  private rampStart = 0;
  private listeners = new Set<(e: PlayerEvent) => void>();

  constructor(
    readonly stream: Stream,
    public settings: PlayerSettings,
    private clock: Clock = realClock,
  ) {}

  on(fn: (e: PlayerEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: PlayerEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get pauseReason() {
    return this.reason;
  }

  play() {
    if (this.playing || !this.stream.items.length) return;
    if (this.reason === 'end') return;
    const away = this.clock.now() - this.pausedAt;
    let ramp = this.reason === 'jump';
    if (this.reason === 'card') {
      if (this.stream.items[this.pos]?.kind === 'card') this.pos++;
    } else if ((this.reason === 'user' || this.reason === 'auto') && away >= SHORT_PAUSE) {
      ramp = true;
      if (this.settings.rewind) {
        const to =
          away >= LONG_PAUSE
            ? blockStartOf(this.stream, this.pos)
            : sentenceStartOf(this.stream, this.pos);
        if (to !== this.pos)
          this.emit({
            type: 'rewind',
            from: this.pos,
            to,
            scope: away >= LONG_PAUSE ? 'paragraph' : 'sentence',
          });
        this.pos = to;
      }
    }
    this.rampStart = ramp && this.settings.ramp ? this.clock.now() : 0;
    this.playing = true;
    this.emit({ type: 'state', playing: true });
    this.nextAt = this.clock.now();
    this.step();
  }

  pause(reason: PauseReason = 'user') {
    if (!this.playing) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.playing = false;
    this.pausedAt = this.clock.now();
    this.reason = reason;
    this.emit({ type: 'state', playing: false, reason });
  }

  toggle() {
    if (this.playing) this.pause('user');
    else this.play();
  }

  /** Переход в другое место: без отката, с разгоном. */
  seek(pos: number) {
    const was = this.playing;
    this.pause('jump');
    this.reason = 'jump';
    this.pos = Math.max(0, Math.min(pos, this.stream.items.length - 1));
    this.emit({ type: 'word', pos: this.pos });
    if (was) this.play();
  }

  private step = () => {
    const items = this.stream.items;
    const it = items[this.pos];
    if (!it) {
      this.pos = items.length - 1;
      this.playing && this.pause('end');
      return;
    }
    if (it.kind === 'card') {
      const mode =
        it.cardType === 'figure'
          ? this.settings.figures
          : this.settings.figures === 'skip'
            ? 'skip'
            : 'stop';
      if (mode === 'stop') {
        this.emit({ type: 'card', pos: this.pos });
        this.pause('card');
        return;
      }
      if (mode === 'glance') this.emit({ type: 'glance', pos: this.pos });
      this.pos++;
      this.step();
      return;
    }

    this.emit({ type: 'word', pos: this.pos });
    const now = this.clock.now();
    let d = itemDelay(it, this.settings.wpm, this.settings.pauseScale);
    if (this.rampStart) {
      const t = now - this.rampStart;
      if (t >= RAMP_MS) this.rampStart = 0;
      else d /= RAMP_FROM + ((1 - RAMP_FROM) * t) / RAMP_MS;
    }
    // Свёрнутая вкладка копит отставание — не выпускаем слова очередью.
    if (this.nextAt < now - 100) this.nextAt = now;
    this.nextAt += d;
    this.timer = this.clock.setTimeout(
      () => {
        this.pos++;
        this.step();
      },
      Math.max(0, this.nextAt - now),
    );
  };

  dispose() {
    this.clock.clearTimeout(this.timer);
    this.listeners.clear();
  }
}
