import { palette } from '../book/cover';
import type { BookMeta } from '../book/types';

/**
 * Обложка книги. Своей нет (TXT или книга ещё не скачана) — рисуем «издательскую»:
 * автор, название и черта на цветном фоне, цвет у каждой книги свой и постоянный.
 */
export function Cover({ meta, src }: { meta: BookMeta; src?: string }) {
  // Картинка вписана целиком, а поля заполняет она же, размытая: пропорции у обложек разные.
  if (src)
    return (
      <div class="cover">
        <img class="cover-blur" src={src} alt="" aria-hidden="true" decoding="async" />
        <img class="cover-img" src={src} alt="" loading="lazy" decoding="async" />
      </div>
    );
  const [bg, fg, accent] = palette(meta.title + (meta.author ?? ''));
  return (
    <div class="cover">
      <div class="cover-gen" style={{ '--c-bg': bg, '--c-fg': fg, '--c-acc': accent }}>
        {meta.author && <span class="cover-author">{meta.author}</span>}
        <span class="cover-title">{meta.title}</span>
        <i class="cover-rule" />
      </div>
    </div>
  );
}
