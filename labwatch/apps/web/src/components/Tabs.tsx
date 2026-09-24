import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Accessible name when the label is not plain text. */
  title?: string;
}

/**
 * WAI-ARIA tabs with automatic activation: Left/Right move and select, Home/End jump,
 * only the selected tab is in the Tab order (roving tabindex).
 */
export function TabList({
  items,
  selectedId,
  onSelect,
  label,
  variant,
  panelId,
  after,
}: {
  items: TabItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  label: string;
  variant: 'primary' | 'secondary';
  panelId: string;
  after?: ReactNode;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const move = (event: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const target = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[
      event.key
    ];
    if (target === undefined) return;
    event.preventDefault();
    const item = items[target]!;
    refs.current.get(item.id)?.focus();
    onSelect(item.id);
  };

  const focusable = items.some((i) => i.id === selectedId) ? selectedId : items[0]?.id;

  return (
    <div className={`tabs tabs-${variant}`}>
      <div role="tablist" aria-label={label} className="tablist">
        {items.map((item, index) => {
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) refs.current.set(item.id, el);
                else refs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`tab-${variant}-${item.id}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={item.id === focusable ? 0 : -1}
              title={item.title}
              className={`tab${selected ? ' tab-selected' : ''}`}
              onClick={() => onSelect(item.id)}
              onKeyDown={(e) => move(e, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {after}
    </div>
  );
}

/** The trailing "…" menu with merged and idle branches. */
export function OverflowMenu({ items, onSelect, label }: { items: TabItem[]; onSelect: (id: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== button.current) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (items.length === 0) return null;

  const onKey = (e: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const target = { ArrowDown: index === last ? 0 : index + 1, ArrowUp: index === 0 ? last : index - 1, Home: 0, End: last }[e.key];
    if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') button.current?.focus();
      return;
    }
    if (target !== undefined) {
      e.preventDefault();
      itemRefs.current[target]?.focus();
    }
  };

  return (
    <div className="overflow">
      <button
        ref={button}
        type="button"
        className="tab overflow-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} (${items.length})`}
        title={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        … <span className="count">{items.length}</span>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} className="menu">
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                if (el) itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="menu-item"
              onKeyDown={(e) => onKey(e, index)}
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
