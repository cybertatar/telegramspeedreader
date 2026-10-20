import { orpIndex } from '../engine/orp';

/**
 * Слово, выровненное по опорной букве: левая часть прижата к ней справа,
 * правая — слева, опорная буква стоит ровно под засечками.
 */
export function Word({ text, mono }: { text: string; mono?: boolean }) {
  if (mono) {
    // Команда показывается целиком по центру; длинную уменьшаем, чтобы влезла.
    const scale = Math.min(1, 16 / text.length);
    return (
      <div class="word word-mono" style={{ fontSize: `calc(var(--word-size) * ${0.8 * scale})` }}>
        {text}
      </div>
    );
  }
  const i = orpIndex(text);
  return (
    <div class="word" aria-live="off">
      <span class="word-left">{text.slice(0, i)}</span>
      <span class="word-pivot">{text[i] ?? ''}</span>
      <span class="word-right">{text.slice(i + 1)}</span>
    </div>
  );
}
