import React, { useEffect } from 'react';
import { X, RotateCcw, Trash2, Palette } from 'lucide-react';

/**
 * Réglages essentiels de la session (le panneau complet arrive en Phase 6).
 * Pour l'instant : thèmes, (dé)activer la restauration de session + effacer
 * la session enregistrée. Les réglages sont persistés dans session.json.
 */
export default function SettingsPopover({
  settings,
  onChange,
  onClearSession,
  onOpenThemes,
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

        <div className="settings-footer">Terma — v0.2.0</div>
      </div>
    </div>
  );
}
