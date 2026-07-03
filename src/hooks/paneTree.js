/**
 * Arbre de panneaux d'un onglet (split panes).
 *
 * Un onglet contient un arbre binaire :
 *   - feuille  : { type:'leaf', paneId, cwd, restore }        → un terminal
 *   - division : { type:'split', id, dir:'row'|'col', ratio, a, b }
 *
 * `dir:'row'` = deux panneaux côte à côte (division verticale),
 * `dir:'col'` = deux panneaux superposés (division horizontale).
 * Toutes les fonctions sont pures : elles renvoient un nouvel arbre.
 */

export function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'n-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeLeaf(init = {}) {
  return {
    type: 'leaf',
    paneId: init.paneId || newId(),
    cwd: init.cwd || null,
    // données de restauration consommées une seule fois au montage du terminal
    restore: init.restore || null,
  };
}

/** Toutes les feuilles de l'arbre, dans l'ordre de lecture. */
export function leavesOf(node) {
  if (!node) return [];
  if (node.type === 'leaf') return [node];
  return [...leavesOf(node.a), ...leavesOf(node.b)];
}

export function findLeaf(node, paneId) {
  return leavesOf(node).find((l) => l.paneId === paneId) || null;
}

/**
 * Remplace la feuille `paneId` par une division contenant la feuille existante
 * et un nouveau terminal (qui hérite du cwd, donc démarre dans le même dossier).
 * @returns {{ node: object, newPaneId: string|null }}
 */
export function splitLeaf(node, paneId, dir) {
  if (!node) return { node, newPaneId: null };
  if (node.type === 'leaf') {
    if (node.paneId !== paneId) return { node, newPaneId: null };
    const fresh = makeLeaf({ cwd: node.cwd });
    return {
      node: { type: 'split', id: newId(), dir, ratio: 0.5, a: node, b: fresh },
      newPaneId: fresh.paneId,
    };
  }
  const ra = splitLeaf(node.a, paneId, dir);
  if (ra.newPaneId) return { node: { ...node, a: ra.node }, newPaneId: ra.newPaneId };
  const rb = splitLeaf(node.b, paneId, dir);
  if (rb.newPaneId) return { node: { ...node, b: rb.node }, newPaneId: rb.newPaneId };
  return { node, newPaneId: null };
}

/**
 * Supprime la feuille `paneId`. La division parente est remplacée par le
 * panneau frère (qui récupère tout l'espace). Renvoie null si l'arbre est vide.
 */
export function removeLeaf(node, paneId) {
  if (!node) return null;
  if (node.type === 'leaf') return node.paneId === paneId ? null : node;
  const a = removeLeaf(node.a, paneId);
  const b = removeLeaf(node.b, paneId);
  if (a === node.a && b === node.b) return node;
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}

/** Applique un patch à la feuille `paneId` (ex: { cwd }). */
export function updateLeaf(node, paneId, patch) {
  if (!node) return node;
  if (node.type === 'leaf') {
    return node.paneId === paneId ? { ...node, ...patch } : node;
  }
  const a = updateLeaf(node.a, paneId, patch);
  const b = updateLeaf(node.b, paneId, patch);
  if (a === node.a && b === node.b) return node;
  return { ...node, a, b };
}

/** Change le ratio (0..1) de la division `splitId`. */
export function setSplitRatio(node, splitId, ratio) {
  if (!node || node.type === 'leaf') return node;
  if (node.id === splitId) return { ...node, ratio };
  const a = setSplitRatio(node.a, splitId, ratio);
  const b = setSplitRatio(node.b, splitId, ratio);
  if (a === node.a && b === node.b) return node;
  return { ...node, a, b };
}

/**
 * Calcule la géométrie de l'arbre en fractions (0..1) du conteneur.
 * Renvoie les rectangles des feuilles + la position des poignées de
 * redimensionnement (une par division), pour un rendu À PLAT : les terminaux
 * ne sont jamais re-parentés dans le DOM quand on divise/ferme un panneau,
 * ce qui préserve leurs buffers et leurs process.
 */
export function computeLayout(node) {
  const leaves = [];
  const dividers = [];
  const walk = (n, x, y, w, h) => {
    if (n.type === 'leaf') {
      leaves.push({ paneId: n.paneId, x, y, w, h });
      return;
    }
    if (n.dir === 'row') {
      const aw = w * n.ratio;
      walk(n.a, x, y, aw, h);
      walk(n.b, x + aw, y, w - aw, h);
      // poignée verticale sur la frontière ; `range` sert à convertir la
      // position souris en ratio lors du drag
      dividers.push({ id: n.id, dir: 'v', x: x + aw, y, length: h, range: { from: x, size: w } });
    } else {
      const ah = h * n.ratio;
      walk(n.a, x, y, w, ah);
      walk(n.b, x, y + ah, w, h - ah);
      dividers.push({ id: n.id, dir: 'h', x, y: y + ah, length: w, range: { from: y, size: h } });
    }
  };
  if (node) walk(node, 0, 0, 1, 1);
  return { leaves, dividers };
}

/* ------------------------- sérialisation session ------------------------- */

/**
 * Arbre → JSON de session. `getPaneState(paneId)` fournit le scrollback et
 * l'historique du terminal vivant (ou des valeurs vides s'il n'existe plus).
 */
export function serializeNode(node, getPaneState) {
  if (!node) return null;
  if (node.type === 'leaf') {
    const state = getPaneState(node.paneId) || {};
    return {
      type: 'leaf',
      cwd: node.cwd || null,
      scrollback: state.scrollback || '',
      history: Array.isArray(state.history) ? state.history : [],
    };
  }
  return {
    type: 'split',
    dir: node.dir === 'col' ? 'col' : 'row',
    ratio: clampRatio(node.ratio),
    a: serializeNode(node.a, getPaneState),
    b: serializeNode(node.b, getPaneState),
  };
}

/**
 * JSON de session → arbre vivant. Les paneIds sont TOUJOURS régénérés
 * (un même fichier peut être importé plusieurs fois).
 */
export function deserializeNode(saved) {
  if (!saved || typeof saved !== 'object') return null;
  if (saved.type === 'split' && saved.a && saved.b) {
    const a = deserializeNode(saved.a);
    const b = deserializeNode(saved.b);
    if (!a) return b;
    if (!b) return a;
    return {
      type: 'split',
      id: newId(),
      dir: saved.dir === 'col' ? 'col' : 'row',
      ratio: clampRatio(saved.ratio),
      a,
      b,
    };
  }
  if (saved.type === 'leaf' || saved.cwd !== undefined || saved.scrollback !== undefined) {
    return makeLeaf({
      cwd: typeof saved.cwd === 'string' ? saved.cwd : null,
      restore: {
        scrollback: typeof saved.scrollback === 'string' ? saved.scrollback : '',
        history: Array.isArray(saved.history) ? saved.history : [],
      },
    });
  }
  return null;
}

function clampRatio(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.88, Math.max(0.12, n));
}
