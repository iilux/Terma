import React from 'react';
import { Download, X } from 'lucide-react';

/**
 * Bannière « une mise à jour est disponible ».
 *
 * Contrairement au toast (qui s'efface au bout de 4 s), elle reste jusqu'à ce
 * que l'utilisateur agisse : le téléchargement se fait dans le navigateur, il
 * ne faut pas que l'information disparaisse pendant qu'il regarde ailleurs.
 */
export default function UpdateBanner({ version, onDownload, onDismiss }) {
  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">
        Terma <strong>{version}</strong> est disponible
      </span>
      <button className="update-banner-action" onClick={onDownload}>
        <Download size={13} strokeWidth={1.5} />
        Télécharger
      </button>
      <button
        className="icon-btn small"
        onClick={onDismiss}
        aria-label="Plus tard"
        title="Plus tard"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}
