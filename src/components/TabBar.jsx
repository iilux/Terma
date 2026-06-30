import React, { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Tab from './Tab.jsx';

/**
 * Barre d'onglets façon Chrome : liste scrollable + bouton « + ».
 * Gère le réordonnancement par drag & drop (réordonne en direct au survol).
 */
export default function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNewTab,
  onMoveTab,
  onTabContextMenu,
}) {
  const [dragId, setDragId] = useState(null);
  const dragIdRef = useRef(null);

  const handleDragStart = (e, id) => {
    dragIdRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch (err) {
      /* certains environnements exigent setData */
    }
  };

  const handleDragOver = (e, overId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const current = dragIdRef.current;
    if (current && current !== overId) {
      onMoveTab(current, overId);
    }
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDragId(null);
  };

  return (
    <div className="tabbar no-drag">
      <div className="tabs">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            dragging={tab.id === dragId}
            onActivate={onActivate}
            onClose={onClose}
            onContextMenu={onTabContextMenu}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={(e) => e.preventDefault()}
          />
        ))}
      </div>
      <button
        className="tab-add"
        title="Nouvel onglet (Ctrl+T)"
        aria-label="Nouvel onglet"
        onClick={() => onNewTab()}
      >
        <Plus size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
