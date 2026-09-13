'use strict';

const { app, net } = require('electron');

/**
 * Vérification de mise à jour — lecture seule, aucune installation.
 *
 * L'app lit un manifeste versionné sur la branche `main` du dépôt et compare
 * sa version à celle qui y est déclarée. Si une version plus récente existe,
 * le renderer affiche une bannière dont le bouton ouvre le téléchargement dans
 * le navigateur : Terma ne télécharge ni n'installe jamais rien lui-même.
 *
 * Pourquoi pas d'auto-update ? Le build macOS n'est ni signé ni notarisé
 * (electron-builder.yml → mac.identity: null), et Squirrel.Mac refuse de mettre
 * à jour une app non signée. Un auto-update ne fonctionnerait donc que sur
 * Windows, avec deux comportements différents selon l'OS.
 *
 * Pourquoi un fichier sur `main` plutôt que l'API GitHub Releases ? Pas de
 * quota (60 req/h/IP en anonyme), les URLs de téléchargement sont explicites au
 * lieu d'être devinées depuis le nom des assets, et surtout la notification ne
 * part que lorsque le fichier est commité — donc après l'upload des binaires.
 */

const MANIFEST_URL = 'https://raw.githubusercontent.com/iilux/Terma/main/latest.json';

// Allowlist : toute URL sortante finit dans shell.openExternal, elle ne peut
// donc pointer que vers les releases du dépôt. Un manifeste altéré ne peut pas
// faire ouvrir autre chose.
const RELEASES_PREFIX = 'https://github.com/iilux/Terma/releases/';

const TIMEOUT_MS = 8000;
const MAX_BODY = 64 * 1024; // le manifeste fait quelques centaines d'octets
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** '1.2.3-beta.1' → [[1, 2, 3], 'beta.1'] */
function splitVersion(version) {
  const dash = version.indexOf('-');
  const core = dash === -1 ? version : version.slice(0, dash);
  const pre = dash === -1 ? '' : version.slice(dash + 1);
  return [core.split('.').map(Number), pre];
}

/**
 * Comparaison semver réduite à ce dont on a besoin (-1 / 0 / 1).
 * Une version finale l'emporte sur ses pré-releases : 1.0.0 > 1.0.0-beta.1.
 */
function compareVersions(a, b) {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);

  for (let i = 0; i < 3; i += 1) {
    if (coreA[i] !== coreB[i]) return coreA[i] > coreB[i] ? 1 : -1;
  }

  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;

  const segA = preA.split('.');
  const segB = preB.split('.');
  for (let i = 0; i < Math.max(segA.length, segB.length); i += 1) {
    const x = segA[i];
    const y = segB[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

/**
 * Clé d'asset pour la machine courante ('darwin-arm64', 'win32-x64'…).
 *
 * Piège macOS : une app x64 lancée sous Rosetta rapporte arch === 'x64' alors
 * que la machine est Apple Silicon — on lui proposerait le DMG Intel. Electron
 * expose le cas via app.runningUnderARM64Translation.
 */
function platformKey() {
  if (process.platform === 'darwin') {
    let translated = false;
    try {
      translated = app.runningUnderARM64Translation === true;
    } catch (err) {
      /* propriété absente : on garde l'arch rapportée */
    }
    if (translated) return 'darwin-arm64';
  }
  return `${process.platform}-${process.arch}`;
}

/** Ne laisse passer que les URLs de release du dépôt (cf. RELEASES_PREFIX). */
function safeReleaseUrl(url) {
  return typeof url === 'string' && url.startsWith(RELEASES_PREFIX) ? url : null;
}

/**
 * Récupère le manifeste brut. On passe par `net` d'Electron plutôt que `https`
 * de Node : il utilise la pile réseau de Chromium et hérite donc de la config
 * proxy du système.
 */
function fetchManifest() {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: MANIFEST_URL, redirect: 'follow' });
    let body = '';
    let settled = false;

    const abort = () => {
      try {
        request.abort();
      } catch (err) {
        /* déjà terminée */
      }
    };

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      abort();
      finish(new Error('délai dépassé'));
    }, TIMEOUT_MS);

    request.setHeader('Accept', 'application/json');
    // raw.githubusercontent.com est derrière un CDN : sans ça on peut lire une
    // copie périmée de plusieurs minutes après la publication.
    request.setHeader('Cache-Control', 'no-cache');

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        abort();
        finish(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.on('data', (chunk) => {
        body += chunk.toString('utf8');
        if (body.length > MAX_BODY) {
          abort();
          finish(new Error('manifeste anormalement volumineux'));
        }
      });
      response.on('end', () => finish(null, body));
      response.on('error', (err) => finish(err));
    });
    request.on('error', (err) => finish(err));
    request.end();
  });
}

/**
 * Interroge le manifeste et compare à la version courante.
 * Ne rejette jamais : renvoie toujours un objet, quitte à valoir 'error'.
 *
 * @returns {Promise<{status:'available'|'up-to-date'|'error', currentVersion:string,
 *                    latestVersion?:string, downloadUrl?:string, releaseUrl?:string}>}
 */
async function checkForUpdate() {
  const currentVersion = app.getVersion();

  let manifest = null;
  try {
    manifest = JSON.parse(await fetchManifest());
  } catch (err) {
    // Réseau coupé, CDN en vrac, JSON illisible : on ne distingue pas, le
    // renderer n'en fait rien de différent.
    console.warn('[updater] vérification impossible :', err.message);
    return { status: 'error', currentVersion };
  }

  const latestVersion = manifest && manifest.version;
  if (typeof latestVersion !== 'string' || !VERSION_RE.test(latestVersion)) {
    console.warn('[updater] manifeste invalide (champ `version`)');
    return { status: 'error', currentVersion };
  }

  // Version locale illisible : on se tait plutôt que de notifier à tort.
  if (!VERSION_RE.test(currentVersion) || compareVersions(latestVersion, currentVersion) <= 0) {
    return { status: 'up-to-date', currentVersion, latestVersion };
  }

  const releaseUrl = safeReleaseUrl(manifest.releaseUrl);
  const downloads =
    manifest.downloads && typeof manifest.downloads === 'object' ? manifest.downloads : {};
  // Pas d'entrée pour cette plateforme (ou URL hors allowlist) : on renvoie
  // vers la page de release, l'utilisateur choisira son fichier.
  const downloadUrl = safeReleaseUrl(downloads[platformKey()]) || releaseUrl;

  if (!downloadUrl) {
    console.warn('[updater] manifeste sans URL de téléchargement exploitable');
    return { status: 'error', currentVersion, latestVersion };
  }

  return { status: 'available', currentVersion, latestVersion, downloadUrl, releaseUrl };
}

module.exports = { checkForUpdate, compareVersions };
