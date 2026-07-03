/**
 * Moteur de thèmes de Terma (même philosophie que Strok) :
 * un thème = DES DONNÉES, jamais du code. C'est un JSON déclaratif
 * (extension `.termatheme`, JSON classique accepté) avec :
 *   - un manifest (name, author, version, description)
 *   - `ui`       : couleurs de l'interface (clés lisibles → variables CSS whitelistées)
 *   - `terminal` : palette xterm (fond, curseur, sélection, 16 couleurs ANSI)
 *
 * Rien d'autre n'est appliqué : clés inconnues ignorées, valeurs filtrées par
 * whitelist + regex. Un thème ne peut donc ni casser la mise en page ni
 * injecter quoi que ce soit.
 */

/** Clés `ui` autorisées → variable CSS pilotée. */
export const UI_TOKENS = {
  background: '--bg',
  backgroundElevated: '--bg-elev',
  panel: '--panel',
  panelSecondary: '--panel-2',
  titlebar: '--titlebar',
  border: '--border',
  borderSoft: '--border-soft',
  text: '--text',
  textBright: '--text-bright',
  textDim: '--text-dim',
  textFaint: '--text-faint',
  accent: '--accent',
  danger: '--danger',
  closeHover: '--close-hover',
  hover: '--hover',
  hoverStrong: '--hover-strong',
  scrollbar: '--scrollbar',
  scrollbarHover: '--scrollbar-hover',
};

/** Clés `terminal` autorisées (thème xterm.js). */
export const TERMINAL_KEYS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

// Valeurs de couleur uniquement : hex, rgb()/rgba(), noms simples.
const VALUE_RE = /^[#a-zA-Z0-9 .,()%/-]+$/;
const MAX_VALUE_LEN = 64;

function safeValue(v) {
  return typeof v === 'string' && v.length <= MAX_VALUE_LEN && VALUE_RE.test(v.trim())
    ? v.trim()
    : null;
}

export function sanitizeUi(ui) {
  const out = {};
  if (!ui || typeof ui !== 'object') return out;
  for (const key of Object.keys(UI_TOKENS)) {
    const v = safeValue(ui[key]);
    if (v) out[key] = v;
  }
  return out;
}

export function sanitizeTerminal(terminal) {
  const out = {};
  if (!terminal || typeof terminal !== 'object') return out;
  for (const key of TERMINAL_KEYS) {
    const v = safeValue(terminal[key]);
    if (v) out[key] = v;
  }
  return out;
}

export function slugify(name) {
  return (
    String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'theme'
  );
}

/**
 * Valide et normalise un JSON de thème (importé ou lu sur disque).
 * @returns {{ ok:true, theme:object } | { ok:false, error:string }}
 */
export function normalizeTheme(raw, { fileName = null, builtin = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'JSON invalide (objet attendu)' };
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 48) : null;
  if (!name) return { ok: false, error: 'Champ "name" manquant' };

  const ui = sanitizeUi(raw.ui);
  const terminal = sanitizeTerminal(raw.terminal);
  if (Object.keys(ui).length === 0 && Object.keys(terminal).length === 0) {
    return { ok: false, error: 'Aucune couleur valide ("ui" ou "terminal")' };
  }

  return {
    ok: true,
    theme: {
      id: builtin ? `@builtin/${slugify(name)}` : `custom/${fileName || slugify(name)}`,
      name,
      author: typeof raw.author === 'string' ? raw.author.trim().slice(0, 48) : '',
      version: typeof raw.version === 'string' ? raw.version.trim().slice(0, 16) : '1.0.0',
      description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 160) : '',
      ui,
      terminal,
      builtin,
      fileName,
    },
  };
}

/** JSON exportable/partageable d'un thème (sans champs internes). */
export function themeToJson(theme) {
  return {
    name: theme.name,
    author: theme.author || '',
    version: theme.version || '1.0.0',
    description: theme.description || '',
    ui: { ...theme.ui },
    terminal: { ...theme.terminal },
  };
}

/**
 * Applique les variables CSS d'un thème sur :root.
 * `baseUi` (le thème par défaut) sert de socle pour que les thèmes partiels
 * restent cohérents : chaque token est TOUJOURS défini.
 */
export function applyUiTheme(ui, baseUi) {
  const root = document.documentElement;
  const merged = { ...baseUi, ...ui };
  for (const [key, cssVar] of Object.entries(UI_TOKENS)) {
    const v = safeValue(merged[key]);
    if (v) root.style.setProperty(cssVar, v);
    else root.style.removeProperty(cssVar);
  }
}

/** Palette xterm complète d'un thème (complétée par le thème par défaut). */
export function terminalThemeOf(theme, baseTerminal) {
  return { ...baseTerminal, ...(theme?.terminal || {}) };
}
