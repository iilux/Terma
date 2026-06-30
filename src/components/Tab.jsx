import React from 'react';
import { X, TerminalSquare } from 'lucide-react';

/**
 * Un onglet (façon Chrome). Draggable pour le réordonnancement.
 */
export default function Tab({
  tab,
  active,
  dragging,
  onActivate,
  onClose,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}) {
  return (
    <div
      className={
        'tab' + (active ? ' active' : '') + (dragging ? ' dragging' : '')
      }
      draggable
      onMouseDown={(e) => {
        // clic molette = fermer l'onglet (comme Chrome)
        if (e.button === 1) {
          e.preventDefault();
          onClose(tab.id);
        }
      }}
      onClick={() => onActivate(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, tab.id);
      }}
      onDragStart={(e) => onDragStart(e, tab.id)}
      onDragOver={(e) => onDragOver(e, tab.id)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, tab.id)}
      title={tab.cwd || tab.title}
    >
      <TerminalSquare className="tab-icon" size={14} strokeWidth={1.5} />
      <span className="tab-title">{tab.title}</span>
      <button
        className="tab-close"
        title="Fermer l'onglet"
        aria-label="Fermer l'onglet"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
      >
        <X size={13} strokeWidth={1.75} />
      </button>
    </div>
  );
}
