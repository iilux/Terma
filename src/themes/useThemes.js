import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUILTIN_THEMES, DEFAULT_THEME } from './builtins.js';
import {
  applyUiTheme,
  normalizeTheme,
  slugify,
  terminalThemeOf,
  themeToJson,
} from './themeHost.js';

/**
 * Gestion des thèmes côté renderer.
 * - liste = thèmes intégrés + fichiers `.termatheme`/`.json` du dossier
 *   userData/themes (lus via IPC, validés/filtrés ici) ;
 * - application à chaud : variables CSS sur :root + palette xterm recalculée ;
 * - `previewTheme` permet à l'éditeur de prévisualiser un brouillon en direct
 *   sans toucher au thème sélectionné.
 */
export function useThemes(themeId, previewTheme) {
  const [customThemes, setCustomThemes] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const entries = (await window.terma?.themes.list()) || [];
      const parsed = [];
      for (const entry of entries) {
        const res = normalizeTheme(entry.data, { fileName: entry.fileName });
        if (res.ok) parsed.push(res.theme);
      }
      parsed.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      setCustomThemes(parsed);
    } catch (err) {
      console.error('[themes] lecture du dossier impossible:', err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const themes = useMemo(() => [...BUILTIN_THEMES, ...customThemes], [customThemes]);

  const activeTheme = useMemo(
    () => themes.find((t) => t.id === themeId) || DEFAULT_THEME,
    [themes, themeId]
  );

  // Thème réellement affiché (brouillon de l'éditeur prioritaire)
  const effectiveTheme = previewTheme || activeTheme;

  // Application à chaud des variables CSS de l'interface
  useEffect(() => {
    applyUiTheme(effectiveTheme.ui, DEFAULT_THEME.ui);
  }, [effectiveTheme]);

  // Palette xterm complète, passée à tous les terminaux
  const termTheme = useMemo(
    () => terminalThemeOf(effectiveTheme, DEFAULT_THEME.terminal),
    [effectiveTheme]
  );

  /* ------------------------------ actions -------------------------------- */

  /** Importe un fichier de thème choisi par l'utilisateur. */
  const importTheme = useCallback(async () => {
    const res = await window.terma?.themes.import();
    if (!res || res.canceled) return { ok: true, canceled: true };
    if (res.error) return { ok: false, error: res.error };
    const check = normalizeTheme(res.data, { fileName: res.fileName });
    if (!check.ok) return { ok: false, error: check.error };
    // copie validée dans le dossier des thèmes
    const fileName = uniqueFileName(slugify(check.theme.name), customThemes);
    await window.terma?.themes.save(fileName, themeToJson(check.theme));
    await refresh();
    return { ok: true, themeId: `custom/${fileName}` };
  }, [customThemes, refresh]);

  /** Enregistre un thème créé/modifié dans l'éditeur intégré. */
  const saveCustomTheme = useCallback(
    async (theme, existingFileName = null) => {
      const fileName =
        existingFileName || uniqueFileName(slugify(theme.name), customThemes);
      await window.terma?.themes.save(fileName, themeToJson(theme));
      await refresh();
      return `custom/${fileName}`;
    },
    [customThemes, refresh]
  );

  const deleteTheme = useCallback(
    async (theme) => {
      if (theme.builtin || !theme.fileName) return;
      await window.terma?.themes.delete(theme.fileName);
      await refresh();
    },
    [refresh]
  );

  /** Exporte un thème (intégré ou perso) en `.termatheme` partageable. */
  const exportTheme = useCallback(async (theme) => {
    await window.terma?.themes.export(`${slugify(theme.name)}.termatheme`, themeToJson(theme));
  }, []);

  const openThemesFolder = useCallback(() => {
    window.terma?.themes.openFolder();
  }, []);

  return {
    themes,
    customThemes,
    activeTheme,
    termTheme,
    refresh,
    importTheme,
    saveCustomTheme,
    deleteTheme,
    exportTheme,
    openThemesFolder,
  };
}

function uniqueFileName(slug, existing) {
  const taken = new Set(existing.map((t) => t.fileName));
  let name = `${slug}.termatheme`;
  let i = 2;
  while (taken.has(name)) {
    name = `${slug}-${i}.termatheme`;
    i += 1;
  }
  return name;
}
