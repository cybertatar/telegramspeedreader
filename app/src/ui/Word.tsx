import { orpIndex } from '../engine/orp';

/**
 * Слово, выровненное по опорной букве: левая часть прижата к ней справа,
 * правая — слева, опорная буква стоит ровно под засечками.
 */
export function Word({ text }: { text: string }) {
  const i = orpIndex(text);
  return (
    <div class="word" aria-live="off">
      <span class="word-left">{text.slice(0, i)}</span>
      <span class="word-pivot">{text[i] ?? ''}</span>
      <span class="word-right">{text.slice(i + 1)}</span>
    </div>
  );
}
