import React, { useEffect, useRef } from 'react';
import { X, TerminalSquare } from 'lucide-react';

/**
 * Un onglet (façon Chrome). Draggable pour le réordonnancement.
 * Double-clic (ou « Renommer » du menu contextuel) : édition du titre en place.
 */
export default function Tab({
  tab,
  active,
  dragging,
  renaming,
  onActivate,
  onClose,
  onContextMenu,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  return (
    <div
      className={
        'tab' + (active ? ' active' : '') + (dragging ? ' dragging' : '')
      }
      draggable={!renaming}
      onMouseDown={(e) => {
        // clic molette = fermer l'onglet (comme Chrome)
        if (e.button === 1) {
          e.preventDefault();
          onClose(tab.id);
        }
      }}
      onClick={() => onActivate(tab.id)}
      onDoubleClick={() => onStartRename(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, tab.id);
      }}
      onDragStart={(e) => onDragStart(e, tab.id)}
      onDragOver={(e) => onDragOver(e, tab.id)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, tab.id)}
      title={tab.title}
    >
      <TerminalSquare className="tab-icon" size={14} strokeWidth={1.5} />
      {renaming ? (
        <input
          ref={inputRef}
          className="tab-rename-input"
          defaultValue={tab.title}
          maxLength={48}
          spellCheck={false}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onCommitRename(tab.id, e.currentTarget.value);
            else if (e.key === 'Escape') onCancelRename();
          }}
          onBlur={(e) => onCommitRename(tab.id, e.currentTarget.value)}
        />
      ) : (
        <span className="tab-title">{tab.title}</span>
      )}
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
