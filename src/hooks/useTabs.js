import { useCallback, useState } from 'react';
import {
  newId,
  makeLeaf,
  leavesOf,
  splitLeaf,
  removeLeaf,
  updateLeaf,
  setSplitRatio,
} from './paneTree.js';

export { newId };

function makeTab(init = {}) {
  const layout = init.layout || makeLeaf({ cwd: init.cwd, restore: init.restore });
  return {
    id: init.id || newId(),
    title: init.title || 'Terminal',
    // true si l'utilisateur a renommé l'onglet : le titre n'est plus écrasé
    // par le dossier courant
    customTitle: !!init.customTitle,
    layout,
    activePaneId: leavesOf(layout)[0]?.paneId || null,
  };
}

/**
 * Gère la liste des onglets, l'onglet actif, et toutes les opérations
 * (création / fermeture / réordonnancement / navigation / division).
 * Chaque onglet contient un arbre de panneaux (paneTree.js) ; chaque feuille
 * correspond à une session pty isolée (créée dans TerminalView).
 */
export function useTabs() {
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const openTab = useCallback((init = {}) => {
    const tab = makeTab(init);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    return tab.id;
  }, []);

  const closeTab = useCallback((id) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);

      setActiveId((curActive) => {
        if (curActive !== id) return curActive;
        if (next.length === 0) return null;
        // activer l'onglet voisin (précédent de préférence)
        const neighbor = next[Math.min(idx, next.length - 1)];
        return neighbor.id;
      });

      return next;
    });
  }, []);

  /** Titre automatique (dossier courant) — ignoré si renommage manuel. */
  const setAutoTitle = useCallback((id, title) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id && !t.customTitle && t.title !== title ? { ...t, title } : t
      )
    );
  }, []);

  /** Renommage manuel. Un nom vide rétablit le titre automatique. */
  const renameTab = useCallback((id, rawTitle) => {
    const title = String(rawTitle || '').trim();
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (!title) return { ...t, customTitle: false };
        return { ...t, title, customTitle: true };
      })
    );
  }, []);

  /* ------------------------------ panneaux ------------------------------- */

  /** Divise le panneau `paneId` ('row' = à droite, 'col' = en bas). */
  const splitPane = useCallback((tabId, paneId, dir) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const { node, newPaneId } = splitLeaf(t.layout, paneId, dir);
        if (!newPaneId) return t;
        return { ...t, layout: node, activePaneId: newPaneId };
      })
    );
  }, []);

  /**
   * Ferme un panneau. Si c'était le dernier de l'onglet, ferme l'onglet.
   * Le pty associé est tué par le démontage du TerminalView correspondant.
   */
  const closePane = useCallback(
    (tabId, paneId) => {
      let tabBecameEmpty = false;
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          const layout = removeLeaf(t.layout, paneId);
          if (!layout) {
            tabBecameEmpty = true;
            return t; // l'onglet sera fermé juste après
          }
          const leaves = leavesOf(layout);
          const activePaneId =
            t.activePaneId === paneId || !leaves.some((l) => l.paneId === t.activePaneId)
              ? leaves[0].paneId
              : t.activePaneId;
          return { ...t, layout, activePaneId };
        })
      );
      if (tabBecameEmpty) closeTab(tabId);
    },
    [closeTab]
  );

  const setActivePane = useCallback((tabId, paneId) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId && t.activePaneId !== paneId ? { ...t, activePaneId: paneId } : t
      )
    );
  }, []);

  const setPaneCwd = useCallback((tabId, paneId, cwd) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, layout: updateLeaf(t.layout, paneId, { cwd }) } : t
      )
    );
  }, []);

  const setPaneRatio = useCallback((tabId, splitId, ratio) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, layout: setSplitRatio(t.layout, splitId, ratio) } : t
      )
    );
  }, []);

  /* ----------------------------- navigation ------------------------------ */

  /** Déplace l'onglet `dragId` à la position de `overId` (drag & drop). */
  const moveTab = useCallback((dragId, overId) => {
    if (dragId === overId) return;
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === dragId);
      const to = prev.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const goToIndex = useCallback((index) => {
    setTabs((prev) => {
      const target = index >= 0 && index < prev.length ? prev[index] : null;
      if (target) setActiveId(target.id);
      return prev;
    });
  }, []);

  const cycle = useCallback((dir) => {
    setTabs((prev) => {
      if (prev.length === 0) return prev;
      setActiveId((cur) => {
        const i = prev.findIndex((t) => t.id === cur);
        const ni = (i + dir + prev.length) % prev.length;
        return prev[ni].id;
      });
      return prev;
    });
  }, []);

  return {
    tabs,
    activeId,
    setActiveId,
    setTabs,
    openTab,
    closeTab,
    setAutoTitle,
    renameTab,
    splitPane,
    closePane,
    setActivePane,
    setPaneCwd,
    setPaneRatio,
    moveTab,
    goToIndex,
    nextTab: () => cycle(1),
    prevTab: () => cycle(-1),
  };
}
