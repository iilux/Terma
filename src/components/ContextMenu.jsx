import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Menu contextuel entièrement custom (jamais le menu OS).
 * @param {{x:number, y:number, items:Array, onClose:Function}} props
 * items : [{ label, icon, onClick, danger, disabled } | { separator:true }]
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  // garder le menu dans la fenêtre
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let nx = x;
    let ny = y;
    if (x + rect.width + pad > window.innerWidth) nx = window.innerWidth - rect.width - pad;
    if (y + rect.height + pad > window.innerHeight) ny = window.innerHeight - rect.height - pad;
    setPos({ x: Math.max(pad, nx), y: Math.max(pad, ny) });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-sep" />
        ) : (
          <button
            key={i}
            className={'context-item' + (item.danger ? ' danger' : '')}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.icon ? <span className="context-icon">{item.icon}</span> : <span className="context-icon" />}
            <span className="context-label">{item.label}</span>
            {item.shortcut ? <span className="context-shortcut">{item.shortcut}</span> : null}
          </button>
        )
      )}
    </div>
  );
}
