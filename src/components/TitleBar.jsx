import React from 'react';
import { Minus, Square, Copy, X, Settings } from 'lucide-react';

/**
 * Barre de titre custom (frame: false côté Electron).
 * La zone est « draggable » sauf les éléments interactifs (no-drag via CSS).
 * Les onglets (TabBar) sont passés en `children` et vivent dans cette barre,
 * façon Chrome.
 */
export default function TitleBar({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  onOpenSettings,
  children,
}) {
  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-dot" />
        <span className="brand-name">Terma</span>
      </div>

      {children}

      <div className="titlebar-drag" />

      <div className="titlebar-actions">
        <button
          className="icon-btn"
          title="Paramètres"
          onClick={onOpenSettings}
          aria-label="Paramètres"
        >
          <Settings size={15} strokeWidth={1.5} />
        </button>

        <div className="window-controls">
          <button
            className="win-btn"
            title="Réduire"
            onClick={onMinimize}
            aria-label="Réduire"
          >
            <Minus size={15} strokeWidth={1.5} />
          </button>
          <button
            className="win-btn"
            title={isMaximized ? 'Restaurer' : 'Agrandir'}
            onClick={onToggleMaximize}
            aria-label={isMaximized ? 'Restaurer' : 'Agrandir'}
          >
            {isMaximized ? (
              <Copy size={13} strokeWidth={1.5} />
            ) : (
              <Square size={13} strokeWidth={1.5} />
            )}
          </button>
          <button
            className="win-btn win-close"
            title="Fermer"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
