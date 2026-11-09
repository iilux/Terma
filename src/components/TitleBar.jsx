import React, { useRef } from 'react';
import { Minus, Square, Copy, X, Settings } from 'lucide-react';
import { isMac } from '../platform.js';

/**
 * Logo Terma en un seul tracé (même dessin que build/icon.svg) : le carré
 * arrondi, puis les 9 cellules du T. En fill-rule « evenodd », les cellules
 * sont découpées dans le carré : le T laisse voir le fond de la barre et le
 * logo s'adapte à n'importe quel thème avec une seule couleur (currentColor).
 */
const LOGO_PATH =
  'M124 16H388A108 108 0 0 1 496 124V388A108 108 0 0 1 388 496H124' +
  'A108 108 0 0 1 16 388V124A108 108 0 0 1 124 16Z' +
  'M100 100h56v56h-56zM164 100h56v56h-56zM228 100h56v56h-56z' +
  'M292 100h56v56h-56zM356 100h56v56h-56z' +
  'M228 164h56v56h-56zM228 228h56v56h-56zM228 292h56v56h-56zM228 356h56v56h-56z';

/**
 * Barre de titre custom (frame: false côté Electron).
 * La zone est « draggable » sauf les éléments interactifs (no-drag via CSS).
 * Les onglets (TabBar) sont passés en `children` et vivent dans cette barre,
 * façon Chrome.
 *
 * À gauche : le logo Terma (T sur grille de caractères) qui ouvre le menu de
 * l'application — même rôle que le chevron de Windows Terminal.
 *
 * macOS : les « feux » natifs (titleBarStyle hiddenInset) occupent la gauche
 * de la barre (padding via .platform-darwin en CSS) et remplacent les boutons
 * custom Réduire/Agrandir/Fermer, qui ne sont pas rendus. Le logo-menu non
 * plus : son menu vit dans la barre de menus système (electron/main.js), donc
 * la barre commence directement par les onglets, après les feux.
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
      {!isMac && (
        <div className="titlebar-brand">
          <button
            ref={logoRef}
            className="brand-logo"
            title="Menu"
            aria-label="Menu de l'application"
            aria-haspopup="menu"
            onClick={openMenu}
          >
            <svg width="18" height="18" viewBox="0 0 512 512" aria-hidden="true">
              <path d={LOGO_PATH} fill="currentColor" fillRule="evenodd" />
            </svg>
          </button>
          <span className="brand-name">Terma</span>
        </div>
      )}

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
