import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';

const RESTORE_BANNER = '\x1b[90m\x1b[3m— session restaurée —\x1b[0m\r\n\r\n';

// Surlignage des correspondances de recherche (décorations xterm)
const SEARCH_DECORATIONS = {
  matchBackground: '#3a5f9e55',
  matchOverviewRuler: '#4d8dff',
  activeMatchBackground: '#4d8dff66',
  activeMatchColorOverviewRuler: '#4d8dff',
};

/**
 * Un panneau = un xterm.js relié à un pty (dans le main) via IPC.
 * Le composant reste monté même quand l'onglet est inactif (masqué en CSS)
 * pour préserver le buffer et éviter tout re-rendu coûteux.
 *
 * `visible` : l'onglet qui contient ce panneau est affiché.
 * `focused` : ce panneau est le panneau actif de son onglet.
 * `showFocusRing` : entoure le panneau actif (seulement si l'onglet est divisé).
 */
export default function TerminalView({
  paneId,
  visible,
  focused,
  showFocusRing,
  initialCwd,
  restore,
  settings,
  termTheme,
  onCwd,
  onExit,
  onContextMenu,
  onFocusPane,
  registerHandle,
  unregisterHandle,
}) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const isVisibleRef = useRef(visible);

  // callbacks toujours à jour pour l'effet de montage (qui ne tourne qu'une fois)
  const cbRef = useRef({});
  cbRef.current = { onCwd, onExit, onContextMenu, onFocusPane, registerHandle, unregisterHandle };

  /* --------------------------- montage (une fois) -------------------------- */
  useEffect(() => {
    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: settings.cursorBlink !== false,
      cursorStyle: settings.cursorStyle || 'bar',
      scrollback: 5000,
      allowProposedApi: true,
      allowTransparency: true, // fond xterm transparent quand une image de fond est active
      theme: termTheme,
      macOptionIsMeta: false,
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(
      new WebLinksAddon((_e, uri) => window.terma?.openExternal(uri))
    );

    termRef.current = term;
    fitRef.current = fitAddon;

    term.open(containerRef.current);

    // Renderer WebGL pour la fluidité (fallback DOM automatique si indisponible)
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (err) {
      /* fallback silencieux sur le renderer DOM */
    }

    const fitOnly = () => {
      try {
        if (containerRef.current && containerRef.current.offsetParent !== null) {
          fitAddon.fit();
        }
      } catch (err) {
        /* ignore */
      }
    };
    const fitAndResize = () => {
      fitOnly();
      try {
        window.terma?.pty.resize(paneId, term.cols, term.rows);
      } catch (err) {
        /* ignore */
      }
    };

    // fit initial si visible (sinon on fit au moment de l'activation)
    fitOnly();

    // Réinjection du scrollback restauré AVANT le démarrage du nouveau shell
    const hasRestore = !!(restore && restore.scrollback);
    if (hasRestore) {
      term.write(RESTORE_BANNER);
      term.write(restore.scrollback);
      term.write('\r\n');
    }

    // Historique de commandes (best-effort) — amorcé par la restauration
    const history = Array.isArray(restore?.history) ? restore.history.slice(-500) : [];
    let inputLine = '';
    const pushHistory = (line) => {
      if (!line) return;
      if (history[history.length - 1] !== line) history.push(line);
      if (history.length > 500) history.splice(0, history.length - 500);
    };

    /* ------------------------------ flux pty ------------------------------ */
    // Pendant le démarrage d'un shell restauré, ConPTY peut émettre ESC[3J
    // (effacement du scrollback) en peignant son état initial : on le neutralise
    // quelques secondes pour ne pas perdre le texte réinjecté.
    const restoredAt = hasRestore ? Date.now() : 0;
    const offData = window.terma?.pty.onData((msg) => {
      if (msg.id !== paneId) return;
      let data = msg.data;
      if (restoredAt && Date.now() - restoredAt < 3000 && typeof data === 'string') {
        data = data.replace(/\x1b\[3J/g, '');
      }
      term.write(data);
    });
    const offCwd = window.terma?.pty.onCwd((msg) => {
      if (msg.id === paneId) cbRef.current.onCwd?.(paneId, msg.cwd);
    });
    const offExit = window.terma?.pty.onExit((msg) => {
      if (msg.id === paneId) {
        term.write('\r\n\x1b[90m[processus terminé]\x1b[0m\r\n');
        cbRef.current.onExit?.(paneId, msg.exitCode);
      }
    });

    // Saisie clavier -> pty (+ suivi best-effort de l'historique)
    term.onData((data) => {
      window.terma?.pty.write(paneId, data);
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          pushHistory(inputLine.trim());
          inputLine = '';
        } else if (code === 0x7f || code === 0x08) {
          inputLine = inputLine.slice(0, -1);
        } else if (code === 0x1b) {
          break; // séquence d'échappement (flèches…) : on n'essaie pas de la parser
        } else if (code >= 0x20) {
          inputLine += ch;
        }
      }
    });

    // Copier/coller + neutralisation des raccourcis applicatifs côté xterm
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;
      const k = e.key.toLowerCase();

      if (ctrl && shift && k === 'c') {
        const sel = term.getSelection();
        if (sel) window.terma?.clipboard.write(sel);
        return false;
      }
      if (ctrl && shift && k === 'v') {
        window.terma?.clipboard.read().then((t) => {
          if (t) window.terma?.pty.write(paneId, t);
        });
        return false;
      }
      // Raccourcis gérés par le handler global (App) : on empêche juste xterm
      // de transmettre la touche au pty (l'event continue de bubbler vers window).
      if (ctrl && !shift && k === 't') return false;
      if (ctrl && !shift && k === 'w') return false;
      if (ctrl && shift && k === 'w') return false;
      if (ctrl && shift && k === 'd') return false;
      if (ctrl && shift && k === 'b') return false;
      if (ctrl && k === 'tab') return false;
      if (ctrl && !shift && /^[1-9]$/.test(k)) return false;
      if (ctrl && shift && k === 'f') return false;
      return true;
    });

    // Menu contextuel custom (pas de menu OS)
    const onCtx = (e) => {
      e.preventDefault();
      cbRef.current.onContextMenu?.({ x: e.clientX, y: e.clientY, paneId });
    };
    containerRef.current.addEventListener('contextmenu', onCtx);

    // Clic (ou focus clavier) dans le panneau → il devient le panneau actif
    const onFocusIn = () => cbRef.current.onFocusPane?.(paneId);
    containerRef.current.addEventListener('focusin', onFocusIn);
    containerRef.current.addEventListener('mousedown', onFocusIn);

    // Resize automatique (le slot du panneau change de taille lors des splits)
    const ro = new ResizeObserver(() => {
      if (isVisibleRef.current) fitAndResize();
    });
    ro.observe(containerRef.current);

    // Démarrage du shell dans le bon cwd. `inheritCursor` : le shell démarre
    // sous le scrollback restauré au lieu d'effacer l'écran (ConPTY répond à
    // la requête de position curseur ESC[6n, à laquelle xterm répond seul).
    window.terma?.pty.create({
      id: paneId,
      cwd: initialCwd || undefined,
      cols: term.cols,
      rows: term.rows,
      inheritCursor: hasRestore,
    });

    // Expose les opérations de ce panneau à l'App (persistance + menus + raccourcis)
    cbRef.current.registerHandle?.(paneId, {
      serialize: () => {
        try {
          return serializeAddon.serialize({ scrollback: 1000 });
        } catch (err) {
          return '';
        }
      },
      getHistory: () => history.slice(),
      copy: () => {
        const sel = term.getSelection();
        if (sel) window.terma?.clipboard.write(sel);
      },
      paste: () =>
        window.terma?.clipboard.read().then((t) => {
          if (t) window.terma?.pty.write(paneId, t);
        }),
      selectAll: () => term.selectAll(),
      clear: () => term.clear(),
      focus: () => term.focus(),
      fit: fitAndResize,
      findNext: (q) => {
        try {
          searchAddon.findNext(q, { incremental: false, decorations: SEARCH_DECORATIONS });
        } catch (err) {
          /* ignore */
        }
      },
      findPrevious: (q) => {
        try {
          searchAddon.findPrevious(q, { decorations: SEARCH_DECORATIONS });
        } catch (err) {
          /* ignore */
        }
      },
      clearSearch: () => {
        try {
          searchAddon.clearDecorations();
        } catch (err) {
          /* ignore */
        }
        term.clearSelection();
      },
    });

    if (isVisibleRef.current) {
      requestAnimationFrame(() => {
        fitAndResize();
        if (focused) term.focus();
      });
    }

    /* ------------------------------ nettoyage ----------------------------- */
    return () => {
      ro.disconnect();
      containerRef.current?.removeEventListener('contextmenu', onCtx);
      containerRef.current?.removeEventListener('focusin', onFocusIn);
      containerRef.current?.removeEventListener('mousedown', onFocusIn);
      cbRef.current.unregisterHandle?.(paneId);
      window.terma?.pty.kill(paneId);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // montage unique : les deps stables (paneId) ne changent pas pour un panneau donné
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- thème appliqué à chaud (sans redémarrage) -------------- */
  useEffect(() => {
    if (termRef.current && termTheme) {
      termRef.current.options.theme = termTheme;
    }
  }, [termTheme]);

  /* --------------------- activation : fit + focus visible ------------------ */
  useEffect(() => {
    isVisibleRef.current = visible;
    if (visible && termRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          window.terma?.pty.resize(paneId, termRef.current.cols, termRef.current.rows);
        } catch (err) {
          /* ignore */
        }
        if (focused) termRef.current?.focus();
      });
    }
  }, [visible, focused, paneId]);

  return (
    <div
      className={
        'terminal-pane' + (showFocusRing && focused ? ' focused' : '')
      }
      ref={containerRef}
    />
  );
}
