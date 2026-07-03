import React, { useCallback, useRef } from 'react';
import TerminalView from './TerminalView.jsx';
import { computeLayout, findLeaf } from '../hooks/paneTree.js';

const MIN_RATIO = 0.12;
const MAX_RATIO = 0.88;

/**
 * Zone de terminaux d'un onglet (split panes).
 *
 * L'arbre de panneaux est rendu À PLAT : chaque terminal vit dans un « slot »
 * positionné en pourcentages, et les poignées de redimensionnement sont des
 * éléments absolus dessinés sur les frontières. Diviser ou fermer un panneau
 * ne change donc jamais la position d'un TerminalView dans l'arbre React :
 * pas de démontage, les buffers et les shells survivent.
 */
export default function PaneArea({
  tab,
  visible,
  termSettings,
  termTheme,
  onCwd,
  onContextMenu,
  onFocusPane,
  onRatioChange,
  registerHandle,
  unregisterHandle,
}) {
  const rootRef = useRef(null);
  const { leaves, dividers } = computeLayout(tab.layout);
  const showFocusRing = leaves.length > 1;

  const startDrag = useCallback(
    (e, divider) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const vertical = divider.dir === 'v';
      document.body.classList.add('pane-resizing');
      document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';

      const onMove = (ev) => {
        const pos = vertical
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
        // position absolue (fraction du conteneur) → ratio local de la division
        const ratio = (pos - divider.range.from) / divider.range.size;
        onRatioChange(tab.id, divider.id, Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.classList.remove('pane-resizing');
        document.body.style.cursor = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [tab.id, onRatioChange]
  );

  return (
    <div ref={rootRef} className={'pane-root' + (visible ? ' active' : '')}>
      {leaves.map((slot) => {
        const leaf = findLeaf(tab.layout, slot.paneId);
        return (
          <div
            key={slot.paneId}
            className="pane-slot"
            style={{
              left: pct(slot.x),
              top: pct(slot.y),
              width: pct(slot.w),
              height: pct(slot.h),
            }}
          >
            <TerminalView
              paneId={slot.paneId}
              visible={visible}
              focused={slot.paneId === tab.activePaneId}
              showFocusRing={showFocusRing}
              initialCwd={leaf?.cwd || null}
              restore={leaf?.restore || null}
              settings={termSettings}
              termTheme={termTheme}
              onCwd={onCwd}
              onContextMenu={onContextMenu}
              onFocusPane={(paneId) => onFocusPane(tab.id, paneId)}
              registerHandle={registerHandle}
              unregisterHandle={unregisterHandle}
            />
          </div>
        );
      })}

      {dividers.map((d) => (
        <div
          key={d.id}
          className={'pane-divider ' + (d.dir === 'v' ? 'vertical' : 'horizontal')}
          style={
            d.dir === 'v'
              ? { left: pct(d.x), top: pct(d.y), height: pct(d.length) }
              : { top: pct(d.y), left: pct(d.x), width: pct(d.length) }
          }
          onMouseDown={(e) => startDrag(e, d)}
        />
      ))}
    </div>
  );
}

function pct(f) {
  return `${f * 100}%`;
}
