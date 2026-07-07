import React, { useEffect } from 'react';
import {
  X,
  RotateCcw,
  Trash2,
  Palette,
  Image as ImageIcon,
  Droplets,
  Gamepad2,
  Moon,
} from 'lucide-react';

/** Dernier segment d'un chemin (affichage du nom de l'image de fond). */
function fileNameOf(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Libellé humain du statut d'une intégration (remonté par le main). */
const INTEGRATION_STATUS_LABELS = {
  unconfigured: "ID d'application Discord non configuré",
  connecting: 'Connexion à Discord…',
  connected: 'Connecté à Discord',
  unavailable: 'Discord introuvable — vérifie qu’il est lancé',
};

/**
 * Réglages essentiels de la session (le panneau complet arrive en Phase 6).
 * Pour l'instant : thèmes, image d'arrière-plan (optionnelle, flou réglable),
 * (dé)activer la restauration de session + effacer la session enregistrée.
 * Les réglages sont persistés dans session.json.
 */
export default function SettingsPopover({
  settings,
  integrationStatus,
  onChange,
  onClearSession,
  onOpenThemes,
  onPickBackground,
  onClearBackground,
  onClose,
}) {
  const discord = settings.integrations?.discordRpc || {
    enabled: false,
    showTabName: false,
  };
  const setDiscord = (patch) =>
    onChange({
      ...settings,
      integrations: {
        ...settings.integrations,
        discordRpc: { ...discord, ...patch },
      },
    });
  const discordStatusLabel =
    INTEGRATION_STATUS_LABELS[integrationStatus?.['discord-rpc']] || null;

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
          <div className="settings-section-label">Intégrations</div>

          <label className="settings-row">
            <span className="settings-row-text">
              <Gamepad2 size={14} strokeWidth={1.5} />
              Discord Rich Presence
            </span>
            <button
              className={'toggle' + (discord.enabled ? ' on' : '')}
              role="switch"
              aria-checked={discord.enabled}
              onClick={() => setDiscord({ enabled: !discord.enabled })}
            >
              <span className="toggle-knob" />
            </button>
          </label>

          {discord.enabled && (
            <>
              <label className="settings-row">
                <span className="settings-row-text sub">
                  Afficher le nom de l’onglet actif
                </span>
                <button
                  className={'toggle' + (discord.showTabName ? ' on' : '')}
                  role="switch"
                  aria-checked={discord.showTabName}
                  onClick={() => setDiscord({ showTabName: !discord.showTabName })}
                >
                  <span className="toggle-knob" />
                </button>
              </label>
              {discordStatusLabel && (
                <div className="settings-hint">{discordStatusLabel}</div>
              )}
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

          <label className="settings-row">
            <span className="settings-row-text">
              <Moon size={14} strokeWidth={1.5} />
              Continuer en arrière-plan à la fermeture
            </span>
            <button
              className={'toggle' + (settings.keepInBackground !== false ? ' on' : '')}
              role="switch"
              aria-checked={settings.keepInBackground !== false}
              onClick={() =>
                onChange({
                  ...settings,
                  keepInBackground: settings.keepInBackground === false,
                })
              }
            >
              <span className="toggle-knob" />
            </button>
          </label>
          <div className="settings-hint">
            Fermer la fenêtre garde les shells actifs dans la barre système —
            rouvrir Terma reprend exactement où vous en étiez.
          </div>

          <button className="settings-action danger" onClick={onClearSession}>
            <Trash2 size={14} strokeWidth={1.5} />
            Effacer la session enregistrée
          </button>
        </div>

        <div className="settings-footer">Terma — v0.4.0</div>
      </div>
    </div>
  );
}
