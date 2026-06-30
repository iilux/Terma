import { useCallback, useRef } from 'react';

const SCHEMA_VERSION = 1;

/**
 * Persistance de session (Phase 3).
 *
 * Limite technique assumée : un process shell ne peut pas être « gelé ». On
 * sauvegarde donc seulement l'état restituable de chaque onglet :
 *   - le répertoire courant (cwd, obtenu via OSC 7)
 *   - le titre
 *   - le scrollback (buffer texte affiché, sérialisé par xterm-addon-serialize)
 *   - l'historique de commandes de la session (best-effort)
 * Au lancement, on relance un shell propre dans le bon cwd et on réinjecte le
 * scrollback, précédé d'un discret « — session restaurée — ».
 *
 * @param {React.MutableRefObject<Map<string, {serialize:()=>string, getHistory:()=>string[]}>>} handlesRef
 */
export function useSession(handlesRef) {
  const timerRef = useRef(null);

  const buildPayload = useCallback(
    (tabs, activeId, settings) => {
      return {
        version: SCHEMA_VERSION,
        savedAt: Date.now(),
        activeId,
        settings,
        tabs: tabs.map((tab) => {
          const handle = handlesRef.current.get(tab.id);
          return {
            id: tab.id,
            title: tab.title,
            cwd: tab.cwd || null,
            scrollback: handle ? handle.serialize() : '',
            history: handle ? handle.getHistory() : [],
          };
        }),
      };
    },
    [handlesRef]
  );

  const save = useCallback(
    (tabs, activeId, settings) => {
      if (!window.terma) return Promise.resolve(false);
      try {
        const payload = buildPayload(tabs, activeId, settings);
        return window.terma.session.save(payload);
      } catch (err) {
        console.error('[session] build/save error:', err);
        return Promise.resolve(false);
      }
    },
    [buildPayload]
  );

  const saveDebounced = useCallback(
    (tabs, activeId, settings, delay = 600) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        save(tabs, activeId, settings);
      }, delay);
    },
    [save]
  );

  const load = useCallback(() => {
    if (!window.terma) return Promise.resolve(null);
    return window.terma.session.load();
  }, []);

  const clear = useCallback(() => {
    if (!window.terma) return Promise.resolve(false);
    return window.terma.session.clear();
  }, []);

  return { save, saveDebounced, load, clear };
}
