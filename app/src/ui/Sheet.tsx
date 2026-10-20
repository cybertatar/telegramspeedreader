import type { ComponentChildren } from 'preact';
import { IconClose } from './icons';

/** Шторка снизу: оглавление, настройки, карточки. */
export function Sheet(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  full?: boolean;
}) {
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`sheet${props.full ? ' sheet-full' : ''}`} role="dialog" aria-label={props.title}>
        <div class="sheet-head">
          <h2>{props.title}</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </div>
        <div class="sheet-body">{props.children}</div>
        {props.footer && <div class="sheet-foot">{props.footer}</div>}
      </div>
    </div>
  );
}
