import React, { useEffect, useRef, useState } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

/**
 * Barre de recherche du terminal (Ctrl+Shift+F), flottante en haut à droite.
 * Enter = suivant, Shift+Enter = précédent, Échap = fermer.
 */
export default function SearchBar({ onFindNext, onFindPrevious, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const queryRef = useRef('');
  queryRef.current = query;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const next = () => {
    if (queryRef.current) onFindNext(queryRef.current);
  };
  const prev = () => {
    if (queryRef.current) onFindPrevious(queryRef.current);
  };

  return (
    <div className="search-bar" onMouseDown={(e) => e.stopPropagation()}>
      <Search size={13} strokeWidth={1.5} className="search-icon" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Rechercher…"
        value={query}
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) onFindNext(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && e.shiftKey) prev();
          else if (e.key === 'Enter') next();
          else if (e.key === 'Escape') onClose();
        }}
      />
      <button className="icon-btn small" title="Précédent (Shift+Entrée)" onClick={prev}>
        <ChevronUp size={13} strokeWidth={1.5} />
      </button>
      <button className="icon-btn small" title="Suivant (Entrée)" onClick={next}>
        <ChevronDown size={13} strokeWidth={1.5} />
      </button>
      <button className="icon-btn small" title="Fermer (Échap)" onClick={onClose}>
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}
