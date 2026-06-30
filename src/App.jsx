import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Copy,
  ClipboardPaste,
  TextSelect,
  Eraser,
  XCircle,
  X,
} from 'lucide-react';

import TitleBar from './components/TitleBar.jsx';
import TabBar from './components/TabBar.jsx';
import TerminalView from './components/TerminalView.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import SettingsPopover from './components/SettingsPopover.jsx';
import { useTabs, newId } from './hooks/useTabs.js';
import { useSession } from './hooks/useSession.js';

const DEFAULT_SETTINGS = {
  restoreSession: true,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace",
  fontSize: 14,
  cursorStyle: 'bar',
  cursorBlink: true,
};

/** Dernier segment d'un chemin (pour le titre d'onglet). */
function baseName(p) {
  if (!p) return null;
  const cleaned = p.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last || cleaned || null;
}

export default function App() {
  const {
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
    nextTab,
    prevTab,
  } = useTabs();

  const handlesRef = useRef(new Map());
  const { save, saveDebounced, load, clear } = useSession(handlesRef);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isMaximized, setIsMaximized] = useState(false);
  const [booted, setBooted] = useState(false);
  const [menu, setMenu] = useState(null); // { kind:'terminal'|'tab', x, y, targetId }
  const [settingsOpen, setSettingsOpen] = useState(false);

  // refs « toujours à jour » pour les handlers globaux et beforeunload
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const settingsRef = useRef(settings);
  tabsRef.current = tabs;
  activeIdRef.current = activeId;
  settingsRef.current = settings;

  const registerHandle = useCallback((id, h) => {
    handlesRef.current.set(id, h);
  }, []);
  const unregisterHandle = useCallback((id) => {
    handlesRef.current.delete(id);
  }, []);

  /* ----------------------------- démarrage ------------------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // état maximisé initial
      try {
        const max = await window.terma?.window.isMaximized();
        if (!cancelled) setIsMaximized(!!max);
      } catch (err) {
        /* ignore */
      }

      const saved = await load();
      if (cancelled) return;

      const mergedSettings = { ...DEFAULT_SETTINGS, ...(saved?.settings || {}) };
      setSettings(mergedSettings);

      const canRestore =
        saved && Array.isArray(saved.tabs) && saved.tabs.length > 0 && mergedSettings.restoreSession;

      if (canRestore) {
        const restored = saved.tabs.map((t) => ({
          id: t.id || newId(),
          title: t.title || 'Terminal',
          cwd: t.cwd || null,
          restore: {
            scrollback: t.scrollback || '',
            history: Array.isArray(t.history) ? t.history : [],
          },
        }));
        setTabs(restored);
        const activeExists = restored.some((t) => t.id === saved.activeId);
        setActiveId(activeExists ? saved.activeId : restored[0].id);
      } else {
        openTab();
      }

      setBooted(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----------------------- suivi de l'état maximisé ----------------------- */
  useEffect(() => {
    const off = window.terma?.window.onMaximizeChange((m) => setIsMaximized(!!m));
    return () => off?.();
  }, []);

  /* --------------------- toujours au moins un onglet ---------------------- */
  useEffect(() => {
    if (booted && tabs.length === 0) openTab();
  }, [booted, tabs.length, openTab]);

  /* ----------------------- sauvegarde automatique ------------------------- */
  // déclenchée par les changements d'onglets / actif / réglages
  useEffect(() => {
    if (!booted) return;
    saveDebounced(tabs, activeId, settings);
  }, [booted, tabs, activeId, settings, saveDebounced]);

  // filet de sécurité : autosave périodique + à la fermeture
  useEffect(() => {
    if (!booted) return;
    const interval = setInterval(() => {
      save(tabsRef.current, activeIdRef.current, settingsRef.current);
    }, 15000);
    const onBeforeUnload = () => {
      save(tabsRef.current, activeIdRef.current, settingsRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [booted, save]);

  /* -------------------------- raccourcis clavier -------------------------- */
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();

      if (!e.shiftKey && k === 't') {
        e.preventDefault();
        openTab();
      } else if (e.shiftKey && k === 'w') {
        e.preventDefault();
        if (activeIdRef.current) closeTab(activeIdRef.current);
      } else if (k === 'tab') {
        e.preventDefault();
        if (e.shiftKey) prevTab();
        else nextTab();
      } else if (!e.shiftKey && /^[1-9]$/.test(k)) {
        e.preventDefault();
        const n = parseInt(k, 10);
        if (n === 9) goToIndex(tabsRef.current.length - 1);
        else goToIndex(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTab, closeTab, nextTab, prevTab, goToIndex]);

  /* ------------------------------ handlers -------------------------------- */
  const handleCwd = useCallback(
    (id, cwd) => {
      setCwd(id, cwd);
      const name = baseName(cwd);
      if (name) setTitle(id, name);
    },
    [setCwd, setTitle]
  );

  const handleNewTab = useCallback(() => openTab(), [openTab]);

  const closeOthers = useCallback(
    (id) => {
      setTabs((prev) => prev.filter((t) => t.id === id));
      setActiveId(id);
    },
    [setTabs, setActiveId]
  );

  const openTerminalMenu = useCallback(({ x, y, id }) => {
    setMenu({ kind: 'terminal', x, y, targetId: id });
  }, []);

  const openTabMenu = useCallback((e, id) => {
    setMenu({ kind: 'tab', x: e.clientX, y: e.clientY, targetId: id });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleClearSession = useCallback(async () => {
    await clear();
    setSettingsOpen(false);
  }, [clear]);

  /* --------------------------- items de menu ------------------------------ */
  const menuItems = (() => {
    if (!menu) return [];
    if (menu.kind === 'terminal') {
      const h = handlesRef.current.get(menu.targetId);
      return [
        {
          label: 'Copier',
          shortcut: 'Ctrl+Shift+C',
          icon: <Copy size={14} strokeWidth={1.5} />,
          onClick: () => h?.copy(),
        },
        {
          label: 'Coller',
          shortcut: 'Ctrl+Shift+V',
          icon: <ClipboardPaste size={14} strokeWidth={1.5} />,
          onClick: () => h?.paste(),
        },
        { separator: true },
        {
          label: 'Tout sélectionner',
          icon: <TextSelect size={14} strokeWidth={1.5} />,
          onClick: () => h?.selectAll(),
        },
        {
          label: 'Effacer le terminal',
          icon: <Eraser size={14} strokeWidth={1.5} />,
          onClick: () => h?.clear(),
        },
        { separator: true },
        {
          label: 'Nouvel onglet',
          shortcut: 'Ctrl+T',
          icon: <Plus size={14} strokeWidth={1.5} />,
          onClick: () => openTab(),
        },
      ];
    }
    // menu d'onglet
    return [
      {
        label: 'Nouvel onglet',
        shortcut: 'Ctrl+T',
        icon: <Plus size={14} strokeWidth={1.5} />,
        onClick: () => openTab(),
      },
      { separator: true },
      {
        label: "Fermer l'onglet",
        shortcut: 'Ctrl+Shift+W',
        icon: <X size={14} strokeWidth={1.5} />,
        onClick: () => closeTab(menu.targetId),
      },
      {
        label: 'Fermer les autres',
        icon: <XCircle size={14} strokeWidth={1.5} />,
        disabled: tabs.length < 2,
        onClick: () => closeOthers(menu.targetId),
      },
    ];
  })();

  const termSettings = {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
  };

  return (
    <div className="app">
      <TitleBar
        isMaximized={isMaximized}
        onMinimize={() => window.terma?.window.minimize()}
        onToggleMaximize={() => window.terma?.window.toggleMaximize()}
        onClose={() => window.terma?.window.close()}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onActivate={setActiveId}
          onClose={closeTab}
          onNewTab={handleNewTab}
          onMoveTab={moveTab}
          onTabContextMenu={openTabMenu}
        />
      </TitleBar>

      <div className="terminal-stack">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            id={tab.id}
            active={tab.id === activeId}
            initialCwd={tab.cwd}
            restore={tab.restore}
            settings={termSettings}
            onCwd={handleCwd}
            onContextMenu={openTerminalMenu}
            registerHandle={registerHandle}
            unregisterHandle={unregisterHandle}
          />
        ))}
        {tabs.length === 0 && <div className="empty-stack" />}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}

      {settingsOpen && (
        <SettingsPopover
          settings={settings}
          onChange={setSettings}
          onClearSession={handleClearSession}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
