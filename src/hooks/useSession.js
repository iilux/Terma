import { useCallback, useRef } from 'react';
import { serializeNode } from './paneTree.js';

const SCHEMA_VERSION = 2;

/**
 * Persistance de session (Phase 3, étendue aux split panes).
 *
 * Limite technique assumée : un process shell ne peut pas être « gelé ». On
 * sauvegarde donc seulement l'état restituable de chaque panneau :
 *   - le répertoire courant (cwd, obtenu via OSC 7)
 *   - le scrollback (buffer texte affiché, sérialisé par xterm-addon-serialize)
 *   - l'historique de commandes de la session (best-effort)
 * plus, par onglet, le titre et la géométrie des divisions.
 * Au lancement, on relance un shell propre dans le bon cwd et on réinjecte le
 * scrollback, précédé d'un discret « — session restaurée — ».
 *
 * Schéma v2 : `tabs[].layout` est un arbre (leaf/split). Les sessions v1
 * (un terminal par onglet) sont migrées au chargement (voir App).
 *
 * @param {React.MutableRefObject<Map<string, {serialize:()=>string, getHistory:()=>string[]}>>} handlesRef
 */
export function useSession(handlesRef) {
  const timerRef = useRef(null);

  const getPaneState = useCallback(
    (paneId) => {
      const handle = handlesRef.current.get(paneId);
      return handle
        ? { scrollback: handle.serialize(), history: handle.getHistory() }
        : {};
    },
    [handlesRef]
  );

  /** Un onglet → JSON (aussi utilisé pour l'export .termasession). */
  const buildTabPayload = useCallback(
    (tab) => ({
      title: tab.title,
      customTitle: !!tab.customTitle,
      layout: serializeNode(tab.layout, getPaneState),
    }),
    [getPaneState]
  );

  const buildPayload = useCallback(
    (tabs, activeId, settings) => {
      return {
        version: SCHEMA_VERSION,
        savedAt: Date.now(),
        activeId,
        settings,
        tabs: tabs.map((tab) => ({ id: tab.id, ...buildTabPayload(tab) })),
      };
    },
    [buildTabPayload]
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

  /** Exporte un onglet en fichier .termasession (boîte de dialogue OS). */
  const exportTab = useCallback(
    (tab) => {
      if (!window.terma) return Promise.resolve(false);
      const payload = {
        format: 'terma-session',
        version: SCHEMA_VERSION,
        savedAt: Date.now(),
        tab: buildTabPayload(tab),
      };
      return window.terma.session.exportTab(payload, `${tab.title || 'session'}.termasession`);
    },
    [buildTabPayload]
  );

  /** Ouvre un fichier .termasession. Renvoie le JSON brut (à valider). */
  const importTab = useCallback(() => {
    if (!window.terma) return Promise.resolve(null);
    return window.terma.session.importTab();
  }, []);

  return { save, saveDebounced, load, clear, exportTab, importTab };
}
