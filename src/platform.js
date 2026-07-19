/**
 * Helpers de plateforme côté renderer (la valeur vient du preload).
 * Sur macOS la touche de commande applicative est Cmd (metaKey) ; ailleurs
 * c'est Ctrl. Les raccourcis « terminal » (Ctrl+Shift+C/V, Ctrl+Tab) restent
 * identiques partout.
 */
export const platform = window.terma?.platform || 'win32';
export const isMac = platform === 'darwin';

/** La touche de commande de l'app est-elle enfoncée ? (Cmd sur mac, Ctrl sinon) */
export function isMod(e) {
  return isMac ? e.metaKey : e.ctrlKey;
}

/**
 * Libellé d'un raccourci pour la plateforme courante.
 * Par défaut : 'Ctrl+T' → '⌘T', 'Ctrl+Shift+D' → '⇧⌘D' sur mac.
 * `macLabel` force un libellé mac spécifique (ex: copier = '⌘C').
 */
export function shortcut(winLabel, macLabel) {
  if (!isMac) return winLabel;
  if (macLabel) return macLabel;
  return winLabel.replace(/^Ctrl\+Shift\+/, '⇧⌘').replace(/^Ctrl\+/, '⌘');
}
