'use strict';

/**
 * Génère les icônes de l'application à partir de build/icon.svg :
 *   - build/icon.png  (512×512, utilisé par BrowserWindow en dev)
 *   - build/icon.ico  (16→256 px, utilisé par electron-builder pour l'exe
 *     et l'installateur NSIS)
 *
 * Le SVG est rasterisé par Chromium lui-même (fenêtre offscreen + canvas),
 * ce qui évite toute dépendance native de type sharp/resvg. Chaque taille
 * est rendue vectoriellement — pas de downscale flou.
 *
 * Usage : npm run icons   (lance `electron scripts/generate-icons.js`)
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const SVG_PATH = path.join(BUILD_DIR, 'icon.svg');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Assemble un .ico contenant des PNG (format supporté depuis Vista).
 * @param {{ size: number, buf: Buffer }[]} pngs
 */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 = 256 px
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // plans de couleur
    e.writeUInt16LE(32, 6); // bits/pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(SVG_PATH, 'utf8');

    const win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    });
    await win.loadURL('data:text/html,<title>icons</title>');

    /** @type {Record<string, string>} taille -> data URL PNG */
    const dataUrls = await win.webContents.executeJavaScript(`
      (async () => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,'
          + encodeURIComponent(${JSON.stringify(svg)});
        await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; });
        const out = {};
        for (const size of ${JSON.stringify(SIZES)}) {
          const c = document.createElement('canvas');
          c.width = size;
          c.height = size;
          c.getContext('2d').drawImage(img, 0, 0, size, size);
          out[size] = c.toDataURL('image/png');
        }
        return out;
      })()
    `);

    const pngs = Object.fromEntries(
      Object.entries(dataUrls).map(([size, url]) => [
        size,
        Buffer.from(url.split(',')[1], 'base64'),
      ])
    );

    fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), pngs['512']);
    fs.writeFileSync(
      path.join(BUILD_DIR, 'icon.ico'),
      buildIco(ICO_SIZES.map((size) => ({ size, buf: pngs[size] })))
    );

    console.log('OK : build/icon.png (512px) + build/icon.ico (16-256px)');
    app.exit(0);
  } catch (err) {
    console.error('Échec de génération des icônes :', err);
    app.exit(1);
  }
});
