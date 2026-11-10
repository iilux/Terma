import React, { useEffect, useRef } from 'react';
import { RotateCcw, Folder, Plus, X, Columns2 } from 'lucide-react';
import { shortcut } from '../platform.js';

const MAX_SESSION_ROWS = 6;

/** « il y a 2 h », « hier »… (pas de dépendance : Intl natif). */
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function timeAgo(ts) {
  if (!ts) return null;
  const diff = (ts - Date.now()) / 1000; // négatif = passé
  const abs = Math.abs(diff);
  if (abs < 60) return 'à l’instant';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Chemin affiché : le dossier personnel devient « ~ ». */
export function displayPath(p, home) {
  if (!p) return '~';
  if (home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\'))) {
    return '~' + p.slice(home.length);
  }
  return p;
}

function baseName(p) {
  const parts = String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** cwd des panneaux d'un onglet sauvegardé (JSON brut v1/v2, sans recréer d'ids). */
function savedCwds(tab, version) {
  if (version < 2) return [tab.cwd || null];
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'split') {
      walk(n.a);
      walk(n.b);
    } else {
      out.push(typeof n.cwd === 'string' ? n.cwd : null);
    }
  };
  walk(tab.layout);
  return out.length ? out : [null];
}

/**
 * Page d'ouverture (façon Chrome) : reprendre la session précédente, rouvrir
 * un dossier récent, ou partir d'un terminal neuf. Affichée au lancement
 * tant qu'aucun onglet n'est ouvert ; la session enregistrée n'est pas
 * écrasée tant que l'utilisateur n'a pas choisi.
 */
export default function StartPage({ saved, recents, home, onResume, onOpenFolder, onRemoveRecent, onNewTerminal }) {
  const primaryRef = useRef(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  const savedTabs = Array.isArray(saved?.tabs) ? saved.tabs : [];
  const version = Number(saved?.version) || 1;
  const rows = savedTabs.map((t) => {
    const cwds = savedCwds(t, version);
    return { title: t.title || 'Terminal', cwd: cwds[0], panes: cwds.length };
  });
  const when = timeAgo(saved?.savedAt);

  return (
    <div className="start-page">
      <div className="start-inner">
        <h1 className="start-title">Reprendre où vous en étiez</h1>

        {rows.length > 0 && (
          <section className="start-section">
            <div className="start-label">
              Session précédente
              {when && <span className="start-label-meta"> · {when}</span>}
            </div>
            <button ref={primaryRef} className="start-resume" onClick={onResume}>
              <span className="start-resume-head">
                <RotateCcw size={15} strokeWidth={1.5} />
                <span className="start-resume-text">
                  Restaurer {rows.length === 1 ? 'l’onglet' : `les ${rows.length} onglets`}
                </span>
                <kbd className="start-kbd">↵</kbd>
              </span>
              <span className="start-resume-list">
                {rows.slice(0, MAX_SESSION_ROWS).map((r, i) => (
                  <span className="start-resume-row" key={i}>
                    <span className="start-resume-name">{r.title}</span>
                    <span className="start-path" title={r.cwd || ''}>
                      {displayPath(r.cwd, home)}
                    </span>
                    {r.panes > 1 && (
                      <span className="start-panes" title={`${r.panes} panneaux`}>
                        <Columns2 size={11} strokeWidth={1.5} />
                        {r.panes}
                      </span>
                    )}
                  </span>
                ))}
                {rows.length > MAX_SESSION_ROWS && (
                  <span className="start-resume-more">
                    + {rows.length - MAX_SESSION_ROWS} autre
                    {rows.length - MAX_SESSION_ROWS > 1 ? 's' : ''}
                  </span>
                )}
              </span>
            </button>
          </section>
        )}

        {recents.length > 0 && (
          <section className="start-section">
            <div className="start-label">Dossiers récents</div>
            <ul className="start-recents">
              {recents.map((r) => (
                <li key={r.path} className="start-recent">
                  <button
                    ref={rows.length === 0 && r === recents[0] ? primaryRef : undefined}
                    className="start-recent-open"
                    onClick={() => onOpenFolder(r.path)}
                    title={r.path}
                  >
                    <Folder size={14} strokeWidth={1.5} />
                    <span className="start-recent-name">{baseName(r.path)}</span>
                    <span className="start-path">{displayPath(r.path, home)}</span>
                    <span className="start-recent-when">{timeAgo(r.at)}</span>
                  </button>
                  <button
                    className="icon-btn small start-recent-remove"
                    onClick={() => onRemoveRecent(r.path)}
                    aria-label={`Retirer ${baseName(r.path)} des récents`}
                    title="Retirer de la liste"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button className="start-new" onClick={onNewTerminal}>
          <Plus size={14} strokeWidth={1.5} />
          Nouveau terminal
          <kbd className="start-kbd">{shortcut('Ctrl+T')}</kbd>
        </button>
      </div>
    </div>
  );
}
