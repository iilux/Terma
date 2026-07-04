import React, { useEffect } from 'react';
import { X, RotateCcw, Trash2, Palette, Image as ImageIcon, Droplets } from 'lucide-react';

/** Dernier segment d'un chemin (affichage du nom de l'image de fond). */
function fileNameOf(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Réglages essentiels de la session (le panneau complet arrive en Phase 6).
 * Pour l'instant : thèmes, image d'arrière-plan (optionnelle, flou réglable),
 * (dé)activer la restauration de session + effacer la session enregistrée.
 * Les réglages sont persistés dans session.json.
 */
export default function SettingsPopover({
  settings,
  onChange,
  onClearSession,
  onOpenThemes,
  onPickBackground,
  onClearBackground,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="popover-backdrop" onMouseDown={onClose}>
      <div className="settings-popover" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Paramètres</span>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-label">Apparence</div>
          <button className="settings-action" onClick={onOpenThemes}>
            <Palette size={14} strokeWidth={1.5} />
            Gérer les thèmes…
          </button>

          <button className="settings-action" onClick={onPickBackground}>
            <ImageIcon size={14} strokeWidth={1.5} />
            {settings.backgroundImage
              ? "Changer l'image d'arrière-plan…"
              : "Image d'arrière-plan… (optionnelle)"}
          </button>

          {settings.backgroundImage && (
            <>
              <div className="settings-bg-row">
                <span className="settings-bg-name" title={settings.backgroundImage}>
                  {fileNameOf(settings.backgroundImage)}
                </span>
                <button
                  className="icon-btn small danger"
                  onClick={onClearBackground}
                  aria-label="Retirer l'image d'arrière-plan"
                  title="Retirer l'image"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </div>

              <label className="settings-row">
                <span className="settings-row-text">
                  <Droplets size={14} strokeWidth={1.5} />
                  Flou
                </span>
                <span className="slider-wrap">
                  <input
                    type="range"
                    className="slider"
                    min="0"
                    max="24"
                    step="1"
                    value={settings.backgroundBlur || 0}
                    onChange={(e) =>
                      onChange({ ...settings, backgroundBlur: Number(e.target.value) })
                    }
                  />
                  <span className="slider-value">{settings.backgroundBlur || 0}px</span>
                </span>
              </label>
            </>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-label">Session</div>

          <label className="settings-row">
            <span className="settings-row-text">
              <RotateCcw size={14} strokeWidth={1.5} />
              Restaurer la session au démarrage
            </span>
            <button
              className={'toggle' + (settings.restoreSession ? ' on' : '')}
              role="switch"
              aria-checked={settings.restoreSession}
              onClick={() =>
                onChange({ ...settings, restoreSession: !settings.restoreSession })
              }
            >
              <span className="toggle-knob" />
            </button>
          </label>

          <button className="settings-action danger" onClick={onClearSession}>
            <Trash2 size={14} strokeWidth={1.5} />
            Effacer la session enregistrée
          </button>
        </div>

        <div className="settings-footer">Terma — v0.3.0</div>
      </div>
    </div>
  );
}
