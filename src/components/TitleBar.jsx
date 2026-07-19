import React, { useRef } from 'react';
import { Minus, Square, Copy, X, Settings } from 'lucide-react';
import { isMac } from '../platform.js';

/**
 * Barre de titre custom (frame: false côté Electron).
 * La zone est « draggable » sauf les éléments interactifs (no-drag via CSS).
 * Les onglets (TabBar) sont passés en `children` et vivent dans cette barre,
 * façon Chrome.
 *
 * À gauche : le logo Terma (monogramme « ❯_ ») qui ouvre le menu de
 * l'application — même rôle que le chevron de Windows Terminal.
 *
 * macOS : les « feux » natifs (titleBarStyle hiddenInset) occupent la gauche
 * de la barre (padding via .platform-darwin en CSS) et remplacent les boutons
 * custom Réduire/Agrandir/Fermer, qui ne sont pas rendus.
 */
export default function TitleBar({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  onOpenSettings,
  onOpenAppMenu,
  children,
}) {
  const logoRef = useRef(null);

  const openMenu = () => {
    const rect = logoRef.current?.getBoundingClientRect();
    onOpenAppMenu({
      x: rect ? rect.left : 8,
      y: rect ? rect.bottom + 6 : 40,
    });
  };

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <button
          ref={logoRef}
          className="brand-logo"
          title="Menu"
          aria-label="Menu de l'application"
          aria-haspopup="menu"
          onClick={openMenu}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <defs>
              {/* Noir dominant → accent du thème dans le coin : le logo se
                  re-teinte automatiquement pour chaque thème (intégré ou perso),
                  via la variable --accent. Le chevron blanc reste lisible car il
                  se trouve sur la zone sombre. */}
              <linearGradient id="terma-logo-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#100d16" />
                <stop offset="0.55" stopColor="#100d16" />
                <stop offset="1" stopColor="var(--accent, #9a6bff)" />
              </linearGradient>
            </defs>
            <rect
              x="0.75"
              y="0.75"
              width="18.5"
              height="18.5"
              rx="5.5"
              fill="url(#terma-logo-grad)"
            />
            <path
              d="M5.6 6.6 L9.2 10 L5.6 13.4"
              stroke="#ffffff"
              strokeWidth="1.7"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M11.2 13.4 H14.6"
              stroke="#ffffff"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
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

        {!isMac && (
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
        )}
      </div>
    </div>
  );
}
