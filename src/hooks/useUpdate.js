import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Vérification de mise à jour côté renderer.
 *
 * Le travail réseau est fait par le main (electron/updater.js) : ce hook ne
 * fait qu'orchestrer — quand vérifier, quoi montrer, quoi persister.
 *
 * Deux modes :
 *   - silencieux (au démarrage) : ne dérange que si une version est disponible
 *     et que l'utilisateur ne l'a pas déjà écartée. Une erreur réseau ne
 *     produit rien : personne n'a envie d'un popup parce que le wifi est coupé.
 *   - manuel (menu / bouton des Réglages) : répond toujours, y compris pour
 *     dire que tout va bien.
 *
 * `lastUpdateCheck` et `dismissedUpdate` sont persistés avec les autres
 * réglages (session.json), via patchSettings.
 */

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Le démarrage (shells, restauration de session, rendu WebGL) passe avant.
const BOOT_DELAY_MS = 4000;

export function useUpdate({ booted, settings, patchSettings, showToast }) {
  const [currentVersion, setCurrentVersion] = useState('');
  const [available, setAvailable] = useState(null); // { latestVersion, downloadUrl, releaseUrl }
  const [checking, setChecking] = useState(false);

  // Lus dans des callbacks sans les faire dépendre de chaque changement de réglage.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const availableRef = useRef(null);
  availableRef.current = available;

  /* ------------------------- version de l'app ---------------------------- */
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(window.terma?.app?.getVersion?.())
      .then((v) => {
        if (!cancelled && typeof v === 'string') setCurrentVersion(v);
      })
      .catch(() => {
        /* pont indisponible (dev hors Electron) : on n'affiche rien */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------------------- vérification ------------------------------ */
  const check = useCallback(
    async ({ silent } = {}) => {
      if (!window.terma?.updates) return;

      setChecking(true);
      let res = null;
      try {
        res = await window.terma.updates.check();
      } catch (err) {
        res = { status: 'error' };
      }
      setChecking(false);

      patchSettings({ lastUpdateCheck: Date.now() });
      if (typeof res?.currentVersion === 'string') setCurrentVersion(res.currentVersion);

      if (res?.status === 'available') {
        // « Plus tard » ne vaut que pour la version écartée : une version encore
        // plus récente re-notifie. Une vérification manuelle passe outre.
        if (!silent || settingsRef.current.dismissedUpdate !== res.latestVersion) {
          setAvailable({
            latestVersion: res.latestVersion,
            downloadUrl: res.downloadUrl,
            releaseUrl: res.releaseUrl,
          });
        }
        return;
      }

      setAvailable(null);
      if (silent) return;
      showToast(
        res?.status === 'up-to-date'
          ? 'Terma est à jour.'
          : 'Vérification impossible — connexion indisponible ?'
      );
    },
    [patchSettings, showToast]
  );

  /* ------------------- vérification au démarrage (24 h) ------------------- */
  // Dépend seulement de `booted` : les réglages sont lus via la ref, sinon
  // l'écriture de lastUpdateCheck relancerait l'effet et annulerait le timer.
  useEffect(() => {
    if (!booted) return undefined;
    const s = settingsRef.current;
    if (s.checkUpdates === false) return undefined;
    if (Date.now() - (Number(s.lastUpdateCheck) || 0) < CHECK_INTERVAL_MS) return undefined;

    const timer = setTimeout(() => check({ silent: true }), BOOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [booted, check]);

  /* ------------------------------- actions -------------------------------- */
  const download = useCallback(() => {
    const url = availableRef.current?.downloadUrl;
    // L'URL est déjà validée côté main (allowlist des releases du dépôt).
    if (url) window.terma?.openExternal(url);
  }, []);

  const dismiss = useCallback(() => {
    const version = availableRef.current?.latestVersion;
    if (version) patchSettings({ dismissedUpdate: version });
    setAvailable(null);
  }, [patchSettings]);

  return { currentVersion, available, checking, check, download, dismiss };
}
