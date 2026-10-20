import { pageLabel, type CardItem, type Stream } from '../engine/stream';
import { Sheet } from './Sheet';

/**
 * Что показывать в оглавлении и на полосе прогресса: иллюстрации, таблицы, формулы
 * с номером и листинги с номером. Безымянных листингов в технической книге сотни.
 */
export const notable = (stream: Stream, cards: number[]) =>
  cards.filter((i) => {
    const c = stream.items[i] as CardItem;
    return c.cardType !== 'code' || c.title !== 'Листинг';
  });

/** Оглавление: главы со страницами, под каждой — её иллюстрации, листинги и таблицы. */
export function Toc(props: {
  stream: Stream;
  current: number;
  onChapter: (start: number) => void;
  onCard: (i: number) => void;
  onClose: () => void;
}) {
  const { stream } = props;
  return (
    <Sheet title="Оглавление" onClose={props.onClose}>
      <ol class="toc">
        {stream.chapters.map((c, ci) => (
          <li class={ci === props.current ? 'is-current' : undefined}>
            <button class="toc-chapter" onClick={() => props.onChapter(c.start)}>
              <span>{c.title}</span>
              <span class="toc-page">{pageLabel(stream, stream.items[c.start]?.page ?? 1)}</span>
            </button>
            {notable(stream, c.cards).length > 0 && (
              <div class="toc-cards">
                {notable(stream, c.cards).map((i) => (
                  <button class="chip" onClick={() => props.onCard(i)}>
                    {(stream.items[i] as CardItem).title}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
