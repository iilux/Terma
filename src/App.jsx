import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Copy,
  ClipboardPaste,
  TextSelect,
  Eraser,
  XCircle,
  X,
  Palette,
  Search,
  Settings,
  Download,
  Upload,
  Pencil,
  Columns2,
  Rows2,
  SquareStack,
} from 'lucide-react';

import TitleBar from './components/TitleBar.jsx';
import TabBar from './components/TabBar.jsx';
import PaneArea from './components/PaneArea.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import SettingsPopover from './components/SettingsPopover.jsx';
import ThemesPanel from './components/ThemesPanel.jsx';
import SearchBar from './components/SearchBar.jsx';
import { useTabs, newId } from './hooks/useTabs.js';
import { useSession } from './hooks/useSession.js';
import { deserializeNode, leavesOf, makeLeaf, findLeaf } from './hooks/paneTree.js';
import { useThemes } from './themes/useThemes.js';
import { normalizeTheme } from './themes/themeHost.js';
import { DEFAULT_THEME } from './themes/builtins.js';
import { platform, isMod, shortcut } from './platform.js';

const DEFAULT_SETTINGS = {
  restoreSession: true,
  // fermer la fenêtre replie Terma dans la barre système (shells toujours vivants)
  keepInBackground: true,
  themeId: DEFAULT_THEME.id,
  fontFamily:
    "'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Menlo', 'Monaco', 'Courier New', monospace",
  fontSize: 14,
  cursorStyle: 'bar',
  cursorBlink: true,
  backgroundImage: null, // chemin de l'image de fond (optionnelle)
  backgroundBlur: 8, // flou en px (0 = net)
  // Intégrations optionnelles : TOUJOURS désactivées par défaut (opt-in).
  integrations: {
    discordRpc: { enabled: false, showTabName: false },
  },
};

/** Dernier segment d'un chemin (pour le titre d'onglet). */
function baseName(p) {
  if (!p) return null;
  const cleaned = p.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last || cleaned || null;
}

/** Onglet vivant depuis une sauvegarde (session.json v1/v2 ou .termasession). */
function tabFromSaved(saved, version) {
  const layout =
    version >= 2
      ? deserializeNode(saved.layout)
      : deserializeNode({
          type: 'leaf',
          cwd: saved.cwd,
          scrollback: saved.scrollback,
          history: saved.history,
        });
  const finalLayout = layout || makeLeaf({});
  return {
    id: newId(),
    title: saved.title || 'Terminal',
    customTitle: !!saved.customTitle,
    layout: finalLayout,
    activePaneId: leavesOf(finalLayout)[0].paneId,
  };
}

export default function App() {
  const {
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
    nextTab,
    prevTab,
  } = useTabs();

  const handlesRef = useRef(new Map());
  const { save, saveDebounced, load, clear, exportTab, importTab } = useSession(handlesRef);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isMaximized, setIsMaximized] = useState(false);
  const [booted, setBooted] = useState(false);
  const [menu, setMenu] = useState(null); // { kind:'terminal'|'tab'|'app', x, y, targetId?, paneId? }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [previewTheme, setPreviewTheme] = useState(null);
  const [toast, setToast] = useState(null);
  // data URL de l'image de fond (relue depuis son chemin à chaque lancement)
  const [bgImageUrl, setBgImageUrl] = useState(null);
  // statut des intégrations, remonté par le main ({ 'discord-rpc': 'connected', … })
  const [integrationStatus, setIntegrationStatus] = useState({});

  const {
    themes,
    activeTheme,
    termTheme,
    importTheme,
    saveCustomTheme,
    deleteTheme,
    exportTheme,
    openThemesFolder,
  } = useThemes(settings.themeId, previewTheme);

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

  const activeTab = tabs.find((t) => t.id === activeId) || null;

  /** Handle xterm du panneau actif de l'onglet actif (via refs, safe partout). */
  const activeHandle = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    return tab ? handlesRef.current.get(tab.activePaneId) : null;
  }, []);

  const showToast = useCallback((text) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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

      // image de fond : relue depuis son chemin (null si le fichier a disparu)
      if (mergedSettings.backgroundImage && window.terma?.background) {
        window.terma.background.load(mergedSettings.backgroundImage).then((url) => {
          if (!cancelled && url) setBgImageUrl(url);
        });
      }

      const canRestore =
        saved && Array.isArray(saved.tabs) && saved.tabs.length > 0 && mergedSettings.restoreSession;

      if (canRestore) {
        const version = Number(saved.version) || 1;
        const restored = saved.tabs.map((t) => tabFromSaved(t, version));
        setTabs(restored);
        // les ids sont régénérés : on retrouve l'onglet actif par son index
        const idx = saved.tabs.findIndex((t) => t.id === saved.activeId);
        setActiveId(restored[idx >= 0 ? idx : 0].id);
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

  /* ----------------------------- intégrations ----------------------------- */
  useEffect(() => {
    const off = window.terma?.integrations?.onStatus(({ id, status }) =>
      setIntegrationStatus((prev) => ({ ...prev, [id]: status }))
    );
    return () => off?.();
  }, []);

  // pousse le mode arrière-plan vers le main (qui intercepte ou non le close)
  useEffect(() => {
    if (!booted) return;
    window.terma?.app?.setBackgroundMode(settings.keepInBackground !== false);
  }, [booted, settings.keepInBackground]);

  // le main demande un instantané de session (juste avant le repli en tray)
  useEffect(() => {
    if (!booted) return;
    const off = window.terma?.session?.onSaveRequest?.(() => {
      save(tabsRef.current, activeIdRef.current, settingsRef.current);
    });
    return () => off?.();
  }, [booted, save]);

  // pousse l'état activé/config vers le main (qui active/désactive le module)
  useEffect(() => {
    if (!booted) return;
    const discord = settings.integrations?.discordRpc || {};
    window.terma?.integrations?.setState('discord-rpc', !!discord.enabled, {
      showTabName: !!discord.showTabName,
    });
  }, [booted, settings.integrations]);

  // presence : le nom de l'onglet actif (le main décide de l'afficher ou non)
  const activeTitle = activeTab?.title || null;
  useEffect(() => {
    if (!booted) return;
    window.terma?.integrations?.updatePresence({ title: activeTitle });
  }, [booted, activeTitle]);

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

  /* ------------------------------ handlers -------------------------------- */

  const handleCwd = useCallback(
    (tabId, paneId, cwd) => {
      setPaneCwd(tabId, paneId, cwd);
      // le titre suit le dossier courant du panneau actif (sauf renommage manuel)
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (tab && tab.activePaneId === paneId) {
        const name = baseName(cwd);
        if (name) setAutoTitle(tabId, name);
      }
    },
    [setPaneCwd, setAutoTitle]
  );

  const handleFocusPane = useCallback(
    (tabId, paneId) => {
      setActivePane(tabId, paneId);
      const tab = tabsRef.current.find((t) => t.id === tabId);
      const leaf = tab ? findLeaf(tab.layout, paneId) : null;
      const name = baseName(leaf?.cwd);
      if (name) setAutoTitle(tabId, name);
    },
    [setActivePane, setAutoTitle]
  );

  const handleNewTab = useCallback(() => openTab(), [openTab]);

  /** Nouvel onglet dans le même dossier que le panneau actif de `tabId`. */
  const duplicateTab = useCallback(
    (tabId) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      const leaf = tab ? findLeaf(tab.layout, tab.activePaneId) : null;
      openTab({ cwd: leaf?.cwd || null });
    },
    [openTab]
  );

  const closeOthers = useCallback(
    (id) => {
      setTabs((prev) => prev.filter((t) => t.id === id));
      setActiveId(id);
    },
    [setTabs, setActiveId]
  );

  const splitActive = useCallback(
    (dir) => {
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (tab) splitPane(tab.id, tab.activePaneId, dir);
    },
    [splitPane]
  );

  /** Ctrl+W : ferme le panneau actif (l'onglet entier s'il n'est pas divisé). */
  const closeActivePane = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (tab) closePane(tab.id, tab.activePaneId);
  }, [closePane]);

  const handleExportTab = useCallback(
    async (tabId) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;
      const ok = await exportTab(tab);
      if (ok) showToast('Session exportée.');
    },
    [exportTab, showToast]
  );

  const handleImportTab = useCallback(async () => {
    const res = await importTab();
    if (!res || res.canceled) return;
    if (res.error || res.data?.format !== 'terma-session' || !res.data.tab) {
      showToast(res?.error || 'Ce fichier n’est pas une session Terma valide.');
      return;
    }
    const tab = tabFromSaved(res.data.tab, Number(res.data.version) || 2);
    openTab({
      id: tab.id,
      title: tab.title,
      customTitle: tab.customTitle,
      layout: tab.layout,
    });
  }, [importTab, openTab, showToast]);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    const h = activeHandle();
    h?.clearSearch();
    h?.focus();
  }, [activeHandle]);

  const handlePreviewTheme = useCallback((draft) => {
    if (!draft) {
      setPreviewTheme(null);
      return;
    }
    const res = normalizeTheme(draft, {});
    setPreviewTheme(res.ok ? res.theme : null);
  }, []);

  const handleDeleteTheme = useCallback(
    async (theme) => {
      await deleteTheme(theme);
      if (settingsRef.current.themeId === theme.id) {
        setSettings((s) => ({ ...s, themeId: DEFAULT_THEME.id }));
      }
    },
    [deleteTheme]
  );

  const handleClearSession = useCallback(async () => {
    await clear();
    setSettingsOpen(false);
  }, [clear]);

  /* ------------------------- image d'arrière-plan ------------------------- */
  const handlePickBackground = useCallback(async () => {
    const res = await window.terma?.background.pick();
    if (!res || res.canceled) return;
    if (res.error || !res.dataUrl) {
      showToast(res?.error || "Impossible de charger l'image.");
      return;
    }
    setBgImageUrl(res.dataUrl);
    setSettings((s) => ({ ...s, backgroundImage: res.path }));
  }, [showToast]);

  const handleClearBackground = useCallback(() => {
    setBgImageUrl(null);
    setSettings((s) => ({ ...s, backgroundImage: null }));
  }, []);

  /* -------------------------- raccourcis clavier -------------------------- */
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();

      // Ctrl+Tab / Ctrl+Shift+Tab : cycle des onglets — Ctrl sur TOUTES les
      // plateformes (convention onglets, y compris sur mac).
      if (e.ctrlKey && k === 'tab') {
        e.preventDefault();
        if (e.shiftKey) prevTab();
        else nextTab();
        return;
      }

      // Autres raccourcis : touche de commande de la plateforme (Cmd/Ctrl)
      if (!isMod(e)) return;

      if (!e.shiftKey && k === 't') {
        e.preventDefault();
        openTab();
      } else if (!e.shiftKey && k === 'w') {
        e.preventDefault();
        closeActivePane();
      } else if (e.shiftKey && k === 'w') {
        e.preventDefault();
        if (activeIdRef.current) closeTab(activeIdRef.current);
      } else if (e.shiftKey && k === 'd') {
        e.preventDefault();
        splitActive('row');
      } else if (e.shiftKey && k === 'b') {
        e.preventDefault();
        splitActive('col');
      } else if (e.shiftKey && k === 'f') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (!e.shiftKey && /^[1-9]$/.test(k)) {
        e.preventDefault();
        const n = parseInt(k, 10);
        if (n === 9) goToIndex(tabsRef.current.length - 1);
        else goToIndex(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTab, closeTab, closeActivePane, splitActive, nextTab, prevTab, goToIndex]);

  // fermeture de la recherche : nettoyer le surlignage si on ferme via Ctrl+Shift+F
  useEffect(() => {
    if (!searchOpen) activeHandle()?.clearSearch();
  }, [searchOpen, activeHandle]);

  /* ------------------------------- menus ---------------------------------- */

  const openTerminalMenu = useCallback(({ x, y, paneId }) => {
    setMenu({ kind: 'terminal', x, y, paneId });
  }, []);

  const openTabMenu = useCallback((e, id) => {
    setMenu({ kind: 'tab', x: e.clientX, y: e.clientY, targetId: id });
  }, []);

  const openAppMenu = useCallback(({ x, y }) => {
    setMenu({ kind: 'app', x, y });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems = (() => {
    if (!menu) return [];

    if (menu.kind === 'app') {
      return [
        {
          label: 'Nouvel onglet',
          shortcut: shortcut('Ctrl+T'),
          icon: <Plus size={14} strokeWidth={1.5} />,
          onClick: () => openTab(),
        },
        {
          label: "Dupliquer l'onglet",
          icon: <SquareStack size={14} strokeWidth={1.5} />,
          disabled: !activeTab,
          onClick: () => activeTab && duplicateTab(activeTab.id),
        },
        { separator: true },
        {
          label: 'Diviser à droite',
          shortcut: shortcut('Ctrl+Shift+D'),
          icon: <Columns2 size={14} strokeWidth={1.5} />,
          onClick: () => splitActive('row'),
        },
        {
          label: 'Diviser en bas',
          shortcut: shortcut('Ctrl+Shift+B'),
          icon: <Rows2 size={14} strokeWidth={1.5} />,
          onClick: () => splitActive('col'),
        },
        { separator: true },
        {
          label: 'Rechercher',
          shortcut: shortcut('Ctrl+Shift+F'),
          icon: <Search size={14} strokeWidth={1.5} />,
          onClick: () => setSearchOpen(true),
        },
        { separator: true },
        {
          label: 'Thèmes…',
          icon: <Palette size={14} strokeWidth={1.5} />,
          onClick: () => setThemesOpen(true),
        },
        {
          label: 'Importer une session…',
          icon: <Download size={14} strokeWidth={1.5} />,
          onClick: () => handleImportTab(),
        },
        {
          label: "Exporter la session de l'onglet…",
          icon: <Upload size={14} strokeWidth={1.5} />,
          disabled: !activeTab,
          onClick: () => activeTab && handleExportTab(activeTab.id),
        },
        { separator: true },
        {
          label: 'Paramètres',
          icon: <Settings size={14} strokeWidth={1.5} />,
          onClick: () => setSettingsOpen(true),
        },
      ];
    }

    if (menu.kind === 'terminal') {
      const h = handlesRef.current.get(menu.paneId);
      const tab = tabs.find((t) => leavesOf(t.layout).some((l) => l.paneId === menu.paneId));
      const isSplit = tab ? leavesOf(tab.layout).length > 1 : false;
      return [
        {
          label: 'Copier',
          shortcut: shortcut('Ctrl+Shift+C', '⌘C'),
          icon: <Copy size={14} strokeWidth={1.5} />,
          onClick: () => h?.copy(),
        },
        {
          label: 'Coller',
          shortcut: shortcut('Ctrl+Shift+V', '⌘V'),
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
          label: 'Diviser à droite',
          shortcut: shortcut('Ctrl+Shift+D'),
          icon: <Columns2 size={14} strokeWidth={1.5} />,
          disabled: !tab,
          onClick: () => tab && splitPane(tab.id, menu.paneId, 'row'),
        },
        {
          label: 'Diviser en bas',
          shortcut: shortcut('Ctrl+Shift+B'),
          icon: <Rows2 size={14} strokeWidth={1.5} />,
          disabled: !tab,
          onClick: () => tab && splitPane(tab.id, menu.paneId, 'col'),
        },
        {
          label: isSplit ? 'Fermer le panneau' : "Fermer l'onglet",
          shortcut: shortcut('Ctrl+W'),
          icon: <X size={14} strokeWidth={1.5} />,
          disabled: !tab,
          onClick: () => tab && closePane(tab.id, menu.paneId),
        },
        { separator: true },
        {
          label: 'Rechercher',
          shortcut: shortcut('Ctrl+Shift+F'),
          icon: <Search size={14} strokeWidth={1.5} />,
          onClick: () => setSearchOpen(true),
        },
        {
          label: 'Nouvel onglet',
          shortcut: shortcut('Ctrl+T'),
          icon: <Plus size={14} strokeWidth={1.5} />,
          onClick: () => openTab(),
        },
      ];
    }

    // menu d'onglet
    return [
      {
        label: 'Nouvel onglet',
        shortcut: shortcut('Ctrl+T'),
        icon: <Plus size={14} strokeWidth={1.5} />,
        onClick: () => openTab(),
      },
      {
        label: 'Dupliquer',
        icon: <SquareStack size={14} strokeWidth={1.5} />,
        onClick: () => duplicateTab(menu.targetId),
      },
      {
        label: 'Renommer',
        icon: <Pencil size={14} strokeWidth={1.5} />,
        onClick: () => setRenamingId(menu.targetId),
      },
      { separator: true },
      {
        label: 'Exporter la session…',
        icon: <Upload size={14} strokeWidth={1.5} />,
        onClick: () => handleExportTab(menu.targetId),
      },
      { separator: true },
      {
        label: "Fermer l'onglet",
        shortcut: shortcut('Ctrl+Shift+W'),
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

  // Image active : le fond d'xterm devient transparent pour laisser voir
  // l'image (la lisibilité est assurée par le voile teinté en CSS, .has-bg).
  const hasBgImage = !!bgImageUrl;
  const effectiveTermTheme = hasBgImage
    ? { ...termTheme, background: '#00000000' }
    : termTheme;

  return (
    <div
      className={'app platform-' + platform + (hasBgImage ? ' has-bg' : '')}
      style={hasBgImage ? { '--bg-blur': `${settings.backgroundBlur || 0}px` } : undefined}
    >
      {hasBgImage && (
        <div
          className="app-bg"
          style={{ backgroundImage: `url("${bgImageUrl}")` }}
          aria-hidden="true"
        />
      )}
      <TitleBar
        isMaximized={isMaximized}
        onMinimize={() => window.terma?.window.minimize()}
        onToggleMaximize={() => window.terma?.window.toggleMaximize()}
        onClose={() => window.terma?.window.close()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAppMenu={openAppMenu}
      >
        <TabBar
          tabs={tabs}
          activeId={activeId}
          renamingId={renamingId}
          onActivate={setActiveId}
          onClose={closeTab}
          onNewTab={handleNewTab}
          onMoveTab={moveTab}
          onTabContextMenu={openTabMenu}
          onStartRename={setRenamingId}
          onCommitRename={(id, value) => {
            renameTab(id, value);
            setRenamingId(null);
          }}
          onCancelRename={() => setRenamingId(null)}
        />
      </TitleBar>

      <div className="terminal-stack">
        {tabs.map((tab) => (
          <PaneArea
            key={tab.id}
            tab={tab}
            visible={tab.id === activeId}
            termSettings={termSettings}
            termTheme={effectiveTermTheme}
            onCwd={(paneId, cwd) => handleCwd(tab.id, paneId, cwd)}
            onContextMenu={openTerminalMenu}
            onFocusPane={handleFocusPane}
            onRatioChange={setPaneRatio}
            registerHandle={registerHandle}
            unregisterHandle={unregisterHandle}
          />
        ))}
        {tabs.length === 0 && <div className="empty-stack" />}

        {searchOpen && (
          <SearchBar
            onFindNext={(q) => activeHandle()?.findNext(q)}
            onFindPrevious={(q) => activeHandle()?.findPrevious(q)}
            onClose={handleSearchClose}
          />
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}

      {settingsOpen && (
        <SettingsPopover
          settings={settings}
          integrationStatus={integrationStatus}
          onChange={setSettings}
          onClearSession={handleClearSession}
          onPickBackground={handlePickBackground}
          onClearBackground={handleClearBackground}
          onOpenThemes={() => {
            setSettingsOpen(false);
            setThemesOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {themesOpen && (
        <ThemesPanel
          themes={themes}
          activeTheme={activeTheme}
          onSelect={(id) => setSettings((s) => ({ ...s, themeId: id }))}
          onImport={importTheme}
          onDelete={handleDeleteTheme}
          onExport={exportTheme}
          onSaveCustom={saveCustomTheme}
          onOpenFolder={openThemesFolder}
          onPreview={handlePreviewTheme}
          onClose={() => {
            setPreviewTheme(null);
            setThemesOpen(false);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
