import type { CardItem, Stream } from '../engine/stream';
import { Sheet } from './Sheet';

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
              <span class="toc-page">{stream.items[c.start]?.page}</span>
            </button>
            {c.cards.length > 0 && (
              <div class="toc-cards">
                {c.cards.map((i) => (
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
