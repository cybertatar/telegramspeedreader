import { useState } from 'preact/hooks';
import type { Book } from '../book/types';
import type { CardItem } from '../engine/stream';
import { Sheet } from './Sheet';

/** Содержимое карточки: картинка с увеличением по тапу, код, таблица. */
export function CardContent({ card, book }: { card: CardItem; book: Book }) {
  const [zoom, setZoom] = useState(false);
  const src = card.source;
  if (src.type === 'figure') {
    const fig = book.figures[src.id];
    if (!fig) return null;
    return (
      <figure class="card-figure">
        <div class={`zoom${zoom ? ' is-zoomed' : ''}`} onClick={() => setZoom(!zoom)}>
          <img src={fig.src} alt={fig.caption ?? card.title} />
        </div>
        {fig.caption && <figcaption>{fig.caption}</figcaption>}
        <p class="hint-small">{zoom ? 'Нажмите, чтобы уменьшить' : 'Нажмите, чтобы увеличить'}</p>
      </figure>
    );
  }
  if (src.type === 'code')
    return (
      <figure>
        {src.caption && <figcaption>{src.caption}</figcaption>}
        <pre class="card-code">
          <code>{src.text}</code>
        </pre>
      </figure>
    );
  if (src.type === 'table') {
    const [head, ...rows] = src.rows;
    return (
      <figure>
        {src.caption && <figcaption>{src.caption}</figcaption>}
        <div class="card-table">
          <table>
            <thead>
              <tr>
                {head?.map((c) => (
                  <th>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr>
                  {r.map((c) => (
                    <td>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    );
  }
  return null;
}

/**
 * `stop` — чтение дошло до карточки и встало; `view` — открыта из оглавления
 * или текста на паузе, можно перейти к её месту.
 */
export function CardView(props: {
  card: CardItem;
  book: Book;
  mode: 'stop' | 'view';
  onClose: () => void;
  onContinue: () => void;
  onGoTo: () => void;
}) {
  const footer =
    props.mode === 'stop' ? (
      <button class="btn btn-primary" onClick={props.onContinue}>
        Читать дальше
      </button>
    ) : (
      <button class="btn" onClick={props.onGoTo}>
        Перейти к месту в тексте
      </button>
    );
  return (
    <Sheet title={props.card.title} onClose={props.onClose} footer={footer} full>
      <CardContent card={props.card} book={props.book} />
    </Sheet>
  );
}
