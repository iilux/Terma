import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Check,
  Plus,
  Download,
  Upload,
  FolderOpen,
  Pencil,
  Trash2,
  ArrowLeft,
} from 'lucide-react';

/* Clés éditables dans l'éditeur (hex uniquement — les valeurs rgba comme les
   survols sont héritées du thème de base et restent modifiables via le JSON). */
const UI_EDIT_KEYS = [
  ['background', 'Fond'],
  ['backgroundElevated', 'Fond élevé'],
  ['titlebar', 'Barre de titre'],
  ['panel', 'Panneau'],
  ['panelSecondary', 'Panneau secondaire'],
  ['border', 'Bordure'],
  ['borderSoft', 'Bordure douce'],
  ['text', 'Texte'],
  ['textBright', 'Texte vif'],
  ['textDim', 'Texte atténué'],
  ['textFaint', 'Texte discret'],
  ['accent', 'Accent'],
  ['danger', 'Danger'],
];

const TERM_EDIT_KEYS = [
  ['background', 'Fond'],
  ['foreground', 'Texte'],
  ['cursor', 'Curseur'],
  ['selectionBackground', 'Sélection'],
  ['black', 'Noir'],
  ['red', 'Rouge'],
  ['green', 'Vert'],
  ['yellow', 'Jaune'],
  ['blue', 'Bleu'],
  ['magenta', 'Magenta'],
  ['cyan', 'Cyan'],
  ['white', 'Blanc'],
  ['brightBlack', 'Noir vif'],
  ['brightRed', 'Rouge vif'],
  ['brightGreen', 'Vert vif'],
  ['brightYellow', 'Jaune vif'],
  ['brightBlue', 'Bleu vif'],
  ['brightMagenta', 'Magenta vif'],
  ['brightCyan', 'Cyan vif'],
  ['brightWhite', 'Blanc vif'],
];

const ANSI_PREVIEW = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];

/**
 * Panneau de gestion des thèmes : sélection, import/export, suppression,
 * et éditeur intégré (créer un thème à partir d'une copie, couleurs en direct).
 */
export default function ThemesPanel({
  themes,
  activeTheme,
  onSelect,
  onImport,
  onDelete,
  onExport,
  onSaveCustom,
  onOpenFolder,
  onPreview,
  onClose,
}) {
  const [mode, setMode] = useState('list'); // 'list' | 'editor'
  const [draft, setDraft] = useState(null);
  const [editingFileName, setEditingFileName] = useState(null);
  const [error, setError] = useState(null);

  // Échap : fermer (ou quitter l'éditeur)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (mode === 'editor') leaveEditor();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Sécurité : toujours couper la prévisualisation quand le panneau disparaît
  useEffect(() => () => onPreview(null), [onPreview]);

  const builtins = useMemo(() => themes.filter((t) => t.builtin), [themes]);
  const customs = useMemo(() => themes.filter((t) => !t.builtin), [themes]);

  const startCreate = () => {
    setDraft({
      name: `${activeTheme.name} (copie)`,
      author: '',
      version: '1.0.0',
      description: '',
      ui: { ...activeTheme.ui },
      terminal: { ...activeTheme.terminal },
    });
    setEditingFileName(null);
    setMode('editor');
  };

  const startEdit = (theme) => {
    setDraft({
      name: theme.name,
      author: theme.author || '',
      version: theme.version || '1.0.0',
      description: theme.description || '',
      ui: { ...theme.ui },
      terminal: { ...theme.terminal },
    });
    setEditingFileName(theme.fileName);
    setMode('editor');
  };

  const leaveEditor = () => {
    onPreview(null);
    setDraft(null);
    setEditingFileName(null);
    setMode('list');
  };

  const patchDraft = (section, key, value) => {
    setDraft((prev) => {
      const next =
        section === null
          ? { ...prev, [key]: value }
          : { ...prev, [section]: { ...prev[section], [key]: value } };
      onPreview({ ...next, id: '@preview', builtin: false, fileName: null });
      return next;
    });
  };

  const handleSave = async () => {
    if (!draft.name.trim()) return;
    const id = await onSaveCustom(draft, editingFileName);
    onPreview(null);
    onSelect(id);
    leaveEditor();
  };

  const handleImport = async () => {
    setError(null);
    const res = await onImport();
    if (res && !res.ok) setError(`Import impossible : ${res.error}`);
    else if (res?.themeId) onSelect(res.themeId);
  };

  return (
    <div className="popover-backdrop" onMouseDown={onClose}>
      <div
        className="themes-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          {mode === 'editor' ? (
            <button className="icon-btn" onClick={leaveEditor} aria-label="Retour">
              <ArrowLeft size={15} strokeWidth={1.5} />
            </button>
          ) : (
            <span />
          )}
          <span className="settings-title">
            {mode === 'editor'
              ? editingFileName
                ? 'Modifier le thème'
                : 'Créer un thème'
              : 'Thèmes'}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        {mode === 'list' ? (
          <div className="themes-body">
            <div className="settings-section-label">Thèmes intégrés</div>
            <div className="theme-grid">
              {builtins.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  active={t.id === activeTheme.id}
                  onSelect={() => onSelect(t.id)}
                  onExport={() => onExport(t)}
                />
              ))}
            </div>

            <div className="settings-section-label themes-gap">Mes thèmes</div>
            {customs.length === 0 ? (
              <div className="themes-empty">
                Aucun thème personnalisé. Créez-en un à partir du thème actuel,
                ou importez un fichier <code>.termatheme</code> partagé par la
                communauté.
              </div>
            ) : (
              <div className="theme-grid">
                {customs.map((t) => (
                  <ThemeCard
                    key={t.id}
                    theme={t}
                    active={t.id === activeTheme.id}
                    onSelect={() => onSelect(t.id)}
                    onExport={() => onExport(t)}
                    onEdit={() => startEdit(t)}
                    onDelete={() => onDelete(t)}
                  />
                ))}
              </div>
            )}

            {error && <div className="themes-error">{error}</div>}

            <div className="themes-actions">
              <button className="settings-action" onClick={startCreate}>
                <Plus size={14} strokeWidth={1.5} />
                Créer un thème (copie de « {activeTheme.name} »)
              </button>
              <button className="settings-action" onClick={handleImport}>
                <Download size={14} strokeWidth={1.5} />
                Importer un thème…
              </button>
              <button className="settings-action" onClick={onOpenFolder}>
                <FolderOpen size={14} strokeWidth={1.5} />
                Ouvrir le dossier des thèmes
              </button>
            </div>
          </div>
        ) : (
          <div className="themes-body">
            <div className="editor-meta">
              <label className="editor-field">
                <span>Nom</span>
                <input
                  type="text"
                  value={draft.name}
                  maxLength={48}
                  onChange={(e) => patchDraft(null, 'name', e.target.value)}
                />
              </label>
              <label className="editor-field">
                <span>Auteur</span>
                <input
                  type="text"
                  value={draft.author}
                  maxLength={48}
                  placeholder="pseudo"
                  onChange={(e) => patchDraft(null, 'author', e.target.value)}
                />
              </label>
            </div>

            <div className="settings-section-label">Interface</div>
            <div className="editor-colors">
              {UI_EDIT_KEYS.map(([key, label]) => (
                <ColorRow
                  key={key}
                  label={label}
                  value={draft.ui[key]}
                  onChange={(v) => patchDraft('ui', key, v)}
                />
              ))}
            </div>

            <div className="settings-section-label themes-gap">Terminal</div>
            <div className="editor-colors">
              {TERM_EDIT_KEYS.map(([key, label]) => (
                <ColorRow
                  key={key}
                  label={label}
                  value={draft.terminal[key]}
                  onChange={(v) => patchDraft('terminal', key, v)}
                />
              ))}
            </div>

            <div className="themes-actions">
              <button
                className="settings-action accent"
                disabled={!draft.name.trim()}
                onClick={handleSave}
              >
                <Check size={14} strokeWidth={1.5} />
                Enregistrer
              </button>
              <button
                className="settings-action"
                onClick={() => onExport({ ...draft, builtin: false, fileName: null })}
              >
                <Upload size={14} strokeWidth={1.5} />
                Exporter en .termatheme…
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ carte de thème ---------------------------- */

function ThemeCard({ theme, active, onSelect, onExport, onEdit, onDelete }) {
  const term = theme.terminal || {};
  return (
    <div
      className={'theme-card' + (active ? ' active' : '')}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
    >
      <div
        className="theme-preview"
        style={{ background: term.background || theme.ui?.background || '#0d0d0d' }}
      >
        <span
          className="theme-preview-prompt"
          style={{ color: theme.ui?.accent || '#4d8dff' }}
        >
          ❯
        </span>
        <span
          className="theme-preview-text"
          style={{ color: term.foreground || '#e0e0e0' }}
        >
          Aa
        </span>
        <span className="theme-preview-dots">
          {ANSI_PREVIEW.map((k) => (
            <i key={k} style={{ background: term[k] || '#888' }} />
          ))}
        </span>
      </div>
      <div className="theme-card-info">
        <span className="theme-card-name" title={theme.description || theme.name}>
          {theme.name}
        </span>
        <span className="theme-card-author">
          {theme.builtin ? 'intégré' : theme.author || 'personnalisé'}
        </span>
      </div>
      <div className="theme-card-actions" onClick={(e) => e.stopPropagation()}>
        {onEdit && (
          <button className="icon-btn small" title="Modifier" onClick={onEdit}>
            <Pencil size={12} strokeWidth={1.5} />
          </button>
        )}
        <button className="icon-btn small" title="Exporter" onClick={onExport}>
          <Upload size={12} strokeWidth={1.5} />
        </button>
        {onDelete && (
          <button className="icon-btn small danger" title="Supprimer" onClick={onDelete}>
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {active && (
        <span className="theme-card-check">
          <Check size={13} strokeWidth={2} />
        </span>
      )}
    </div>
  );
}

/* ----------------------------- ligne de couleur --------------------------- */

function ColorRow({ label, value, onChange }) {
  const hex = normalizeHex(value);
  return (
    <label className="color-row">
      <span className="color-row-label">{label}</span>
      <span className="color-row-inputs">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className="color-row-hex"
          value={value || ''}
          maxLength={9}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

/** #rgb → #rrggbb ; toute valeur non-hex retombe sur noir (pour input color). */
function normalizeHex(v) {
  if (typeof v !== 'string') return '#000000';
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  }
  return '#000000';
}
