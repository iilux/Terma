import { useCallback, useState } from 'react';

/** Génère un id unique pour un onglet/pty. */
export function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'tab-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeTab(init = {}) {
  return {
    id: init.id || newId(),
    title: init.title || 'Terminal',
    cwd: init.cwd || null,
    // données de restauration consommées une seule fois au montage de TerminalView
    restore: init.restore || null,
  };
}

/**
 * Gère la liste des onglets, l'onglet actif, et toutes les opérations
 * (création / fermeture / réordonnancement / navigation).
 * Chaque onglet correspond à une session pty isolée (créée dans TerminalView).
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

  const setTitle = useCallback((id, title) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id && t.title !== title ? { ...t, title } : t))
    );
  }, []);

  const setCwd = useCallback((id, cwd) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, cwd } : t)));
  }, []);

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

  const goToIndex = useCallback(
    (index) => {
      setTabs((prev) => {
        const target = index >= 0 && index < prev.length ? prev[index] : null;
        if (target) setActiveId(target.id);
        return prev;
      });
    },
    []
  );

  const cycle = useCallback(
    (dir) => {
      setTabs((prev) => {
        if (prev.length === 0) return prev;
        setActiveId((cur) => {
          const i = prev.findIndex((t) => t.id === cur);
          const ni = (i + dir + prev.length) % prev.length;
          return prev[ni].id;
        });
        return prev;
      });
    },
    []
  );

  return {
    tabs,
    activeId,
    setActiveId,
    setTabs,
    openTab,
    closeTab,
    setTitle,
    setCwd,
    moveTab,
    goToIndex,
    nextTab: () => cycle(1),
    prevTab: () => cycle(-1),
  };
}
