import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';

// Thème terminal par défaut (sera rendu dynamique en Phase 4).
const DEFAULT_TERMINAL_THEME = {
  background: '#0d0d0d',
  foreground: '#e0e0e0',
  cursor: '#e6e6e6',
  cursorAccent: '#0d0d0d',
  selectionBackground: '#2a3f5f',
  black: '#1a1a1a',
  red: '#ff5f56',
  green: '#5af78e',
  yellow: '#f3f99d',
  blue: '#57c7ff',
  magenta: '#ff6ac1',
  cyan: '#9aedfe',
  white: '#c7c7c7',
  brightBlack: '#686868',
  brightRed: '#ff6e67',
  brightGreen: '#5af78e',
  brightYellow: '#f3f99d',
  brightBlue: '#57c7ff',
  brightMagenta: '#ff6ac1',
  brightCyan: '#9aedfe',
  brightWhite: '#ffffff',
};

const RESTORE_BANNER = '\x1b[90m\x1b[3m— session restaurée —\x1b[0m\r\n\r\n';

/**
 * Un onglet = un xterm.js relié à un pty (dans le main) via IPC.
 * Le composant reste monté même quand l'onglet est inactif (on masque en CSS)
 * pour préserver le buffer et éviter tout re-rendu coûteux.
 */
export default function TerminalView({
  id,
  active,
  initialCwd,
  restore,
  settings,
  onCwd,
  onExit,
  onContextMenu,
  registerHandle,
  unregisterHandle,
}) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const isActiveRef = useRef(active);

  // callbacks toujours à jour pour l'effet de montage (qui ne tourne qu'une fois)
  const cbRef = useRef({});
  cbRef.current = { onCwd, onExit, onContextMenu, registerHandle, unregisterHandle };

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
      theme: DEFAULT_TERMINAL_THEME,
      macOptionIsMeta: false,
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);
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
        window.terma?.pty.resize(id, term.cols, term.rows);
      } catch (err) {
        /* ignore */
      }
    };

    // fit initial si visible (sinon on fit au moment de l'activation)
    fitOnly();

    // Réinjection du scrollback restauré AVANT le démarrage du nouveau shell
    if (restore && restore.scrollback) {
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
    const offData = window.terma?.pty.onData((msg) => {
      if (msg.id === id) term.write(msg.data);
    });
    const offCwd = window.terma?.pty.onCwd((msg) => {
      if (msg.id === id) cbRef.current.onCwd?.(id, msg.cwd);
    });
    const offExit = window.terma?.pty.onExit((msg) => {
      if (msg.id === id) {
        term.write('\r\n\x1b[90m[processus terminé]\x1b[0m\r\n');
        cbRef.current.onExit?.(id, msg.exitCode);
      }
    });

    // Saisie clavier -> pty (+ suivi best-effort de l'historique)
    term.onData((data) => {
      window.terma?.pty.write(id, data);
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
          if (t) window.terma?.pty.write(id, t);
        });
        return false;
      }
      // Raccourcis gérés par le handler global (App) : on empêche juste xterm
      // de transmettre la touche au pty (l'event continue de bubbler vers window).
      if (ctrl && !shift && k === 't') return false;
      if (ctrl && shift && k === 'w') return false;
      if (ctrl && k === 'tab') return false;
      if (ctrl && !shift && /^[1-9]$/.test(k)) return false;
      if (ctrl && shift && k === 'f') return false;
      return true;
    });

    // Menu contextuel custom (pas de menu OS)
    const onCtx = (e) => {
      e.preventDefault();
      cbRef.current.onContextMenu?.({ x: e.clientX, y: e.clientY, id });
    };
    containerRef.current.addEventListener('contextmenu', onCtx);

    // Resize automatique
    const ro = new ResizeObserver(() => {
      if (isActiveRef.current) fitAndResize();
    });
    ro.observe(containerRef.current);

    // Démarrage du shell dans le bon cwd
    window.terma?.pty.create({
      id,
      cwd: initialCwd || undefined,
      cols: term.cols,
      rows: term.rows,
    });

    // Expose les opérations de cet onglet à l'App (persistance + menus + raccourcis)
    cbRef.current.registerHandle?.(id, {
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
          if (t) window.terma?.pty.write(id, t);
        }),
      selectAll: () => term.selectAll(),
      clear: () => term.clear(),
      focus: () => term.focus(),
      fit: fitAndResize,
    });

    if (isActiveRef.current) {
      requestAnimationFrame(() => {
        fitAndResize();
        term.focus();
      });
    }

    /* ------------------------------ nettoyage ----------------------------- */
    return () => {
      ro.disconnect();
      containerRef.current?.removeEventListener('contextmenu', onCtx);
      offData?.();
      offCwd?.();
      offExit?.();
      cbRef.current.unregisterHandle?.(id);
      window.terma?.pty.kill(id);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // montage unique : les deps stables (id) ne changent pas pour un onglet donné
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------- activation : fit + focus visible ------------------ */
  useEffect(() => {
    isActiveRef.current = active;
    if (active && termRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          window.terma?.pty.resize(id, termRef.current.cols, termRef.current.rows);
        } catch (err) {
          /* ignore */
        }
        termRef.current?.focus();
      });
    }
  }, [active, id]);

  return (
    <div
      className={'terminal-pane' + (active ? ' active' : '')}
      ref={containerRef}
    />
  );
}
