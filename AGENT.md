# AGENT.md — Terma (terminal custom)

## Rôle
Tu es un développeur desktop expert Electron + React, spécialisé en applications terminal. Tu construis un émulateur de terminal moderne, sobre, performant et entièrement customisable par la communauté (thèmes + extensions). Chaque décision UI/UX doit respecter le style de référence : dark, minimaliste, icônes fines, aucun élément natif Windows visible.

> **Nom de l'app** : "Terma" (nom retenu).

## Stack technique
- **Electron** (app desktop → génère un .exe via electron-builder)
- **React** (UI : onglets, panneaux, paramètres)
- **xterm.js** (rendu du terminal — la lib standard, celle utilisée par VS Code)
  - addons : `xterm-addon-fit` (resize), `xterm-addon-web-links` (liens cliquables), `xterm-addon-search`
- **node-pty** (spawn des vrais shells : PowerShell, cmd, bash/WSL) — tourne dans le main process Electron
- **CSS custom** (zéro composant UI natif Windows — tout est stylisé)

## Style graphique (référence : même direction que le projet précédent)
- Fond : `#0d0d0d` / `#111111`
- Panneaux (barre d'onglets, settings, sidebar) : `#1a1a1a` avec bordure subtile `#2a2a2a`
- Icônes : fines, monochromes, style ligne (pas de couleurs vives) — SVG inline ou lucide-react
- Typographie UI : Inter ou Geist, taille petite, couleur `#aaaaaa`
- Typographie terminal : police monospace (JetBrains Mono ou Cascadia Code par défaut, surchargée par les thèmes)
- Aucune barre de titre Windows native — titlebar custom intégré à l'app
- Transitions douces, pas d'animations flashy
- Menus contextuels (clic droit terminal, clic droit onglet) et popups entièrement custom (pas les menus OS)

## Architecture des processus (important)
- **Main process Electron** : gère node-pty (spawn/kill des shells), la lecture/écriture des fichiers (sessions, thèmes, extensions), l'exécution sandboxée des extensions.
- **Renderer (React)** : affiche les onglets, instancie un `xterm.js` par onglet, communique avec le main via IPC.
- **Communication** : IPC `ipcMain` / `ipcRenderer` uniquement. Le renderer n'accède jamais directement à node-pty ni au filesystem. `contextIsolation: true`, `nodeIntegration: false`, preload script avec `contextBridge`.

## Fonctionnalités à implémenter (dans l'ordre)

### Phase 1 — Terminal de base
- [ ] Un terminal fonctionnel : xterm.js dans le renderer relié à un node-pty dans le main via IPC
- [ ] Détection du shell par défaut de l'OS (PowerShell sur Windows, fallback cmd)
- [ ] Saisie clavier, affichage couleur ANSI, resize automatique (fit addon)
- [ ] Titlebar custom (boutons fermer / minimiser / maximiser stylisés, `frame: false`)
- [ ] Copier/coller (Ctrl+Shift+C / Ctrl+Shift+V) + sélection souris

### Phase 2 — Système d'onglets (façon Chrome)
- [ ] Barre d'onglets en haut, sous la titlebar
- [ ] Bouton "+" pour ouvrir un nouvel onglet (= nouvelle session pty)
- [ ] Fermer un onglet (croix sur l'onglet + Ctrl+Shift+W) → kill le pty associé
- [ ] Onglet actif visuellement distinct, titre = nom du dossier courant ou commande en cours
- [ ] Réordonner les onglets par drag & drop
- [ ] Raccourcis : Ctrl+T (nouvel onglet), Ctrl+Tab (suivant), Ctrl+1..9 (aller à l'onglet N)
- [ ] Chaque onglet = état isolé (son propre pty, son propre buffer xterm)

### Phase 3 — Persistance de session
> Objectif : à la réouverture de l'app, retrouver les onglets tels qu'ils étaient.
> **Limite technique à respecter et documenter** : un processus shell ne peut pas être "gelé". On sauvegarde l'état restituable, pas le process vivant.
- [ ] Sauvegarder dans un fichier JSON (`app.getPath('userData')/session.json`) :
  - la liste des onglets ouverts + leur ordre + l'onglet actif
  - pour chaque onglet : le **répertoire courant** (cwd), le **titre**, le **scrollback** (buffer texte affiché, sérialisé via xterm-addon-serialize), l'**historique de commandes** de la session
- [ ] Sauvegarde automatique : à chaque changement d'onglet, fermeture d'onglet, et avant la fermeture de l'app (`before-quit`)
- [ ] Au lancement : lire `session.json`, recréer chaque onglet, relancer un pty **dans le cwd sauvegardé**, réinjecter le scrollback dans xterm
- [ ] Message discret en haut du buffer restauré : `— session restaurée —` (custom, pas un popup OS)
- [ ] Bouton "nouvelle fenêtre propre" / réglage pour désactiver la restauration si voulu

### Phase 4 — Système de thèmes (customisable communauté, import manuel)
> **Pas de téléchargement intégré dans l'app.** L'utilisateur récupère un fichier de thème ailleurs (GitHub, Discord…) et l'importe manuellement.
- [ ] Format de thème = **fichier JSON unique** (`.json`), structure documentée ci-dessous
- [ ] Dossier de thèmes local : `app.getPath('userData')/themes/` — chaque thème = un `.json`
- [ ] Bouton "Importer un thème" → ouvre le file picker OS, copie le `.json` dans le dossier themes
- [ ] Sélecteur de thème dans les paramètres (liste tous les `.json` du dossier)
- [ ] Application à chaud (hot reload) : changer de thème met à jour tous les onglets sans redémarrer
- [ ] 3-4 thèmes intégrés par défaut (un dark sobre maison, + des classiques type Dracula / Solarized Dark / Nord)
- [ ] Éditeur de thème intégré optionnel : modifier les couleurs via l'UI et exporter le `.json` (pour que la communauté en crée facilement)

#### Format d'un fichier thème (`mon-theme.json`)
```json
{
  "name": "Mon Thème",
  "author": "pseudo",
  "version": "1.0.0",
  "terminal": {
    "background": "#0d0d0d",
    "foreground": "#e0e0e0",
    "cursor": "#ffffff",
    "cursorAccent": "#0d0d0d",
    "selectionBackground": "#264f78",
    "black": "#000000",      "red": "#ff5555",
    "green": "#50fa7b",      "yellow": "#f1fa8c",
    "blue": "#bd93f9",       "magenta": "#ff79c6",
    "cyan": "#8be9fd",       "white": "#bbbbbb",
    "brightBlack": "#555555", "brightRed": "#ff6e6e",
    "brightGreen": "#69ff94", "brightYellow": "#ffffa5",
    "brightBlue": "#d6acff",  "brightMagenta": "#ff92df",
    "brightCyan": "#a4ffff",  "brightWhite": "#ffffff"
  },
  "ui": {
    "accent": "#bd93f9",
    "panelBackground": "#1a1a1a",
    "fontFamily": "JetBrains Mono",
    "fontSize": 14,
    "opacity": 1.0
  }
}
```

### Phase 5 — Système d'extensions (customisable communauté, import manuel)
> **Pas de téléchargement intégré.** L'utilisateur importe manuellement un dossier d'extension. La communauté peut en créer en suivant l'API documentée.
> ⚠️ **Sécurité prioritaire** : une extension est du code tiers. Elle doit s'exécuter dans un contexte isolé (sandbox) avec un système de permissions explicite, jamais avec un accès libre à node/fs/réseau.
- [ ] Format d'extension = **un dossier** contenant `manifest.json` + `index.js`, structure ci-dessous
- [ ] Dossier d'extensions local : `app.getPath('userData')/extensions/`
- [ ] Bouton "Importer une extension" → file picker (sélection d'un dossier), copie dans le dossier extensions
- [ ] Au lancement : charger les manifests, afficher la liste dans les paramètres (activer / désactiver / supprimer chaque extension)
- [ ] Exécution sandboxée : utiliser un `vm` context isolé (ou un worker/utilityProcess Electron), **pas** un `require` direct dans le main. Aucune extension ne touche node-pty ou le fs directement.
- [ ] Système de permissions déclaré dans le manifest (`commands`, `readTerminalOutput`, `writeTerminal`, `ui`) — l'app n'expose à l'extension que les API correspondant aux permissions accordées
- [ ] API d'extension exposée (objet `terma` injecté) :
  - `terma.registerCommand(name, callback)` — ajoute une commande custom (ex: tapée dans une palette)
  - `terma.onData(callback)` — reçoit le flux de sortie du terminal actif (si permission `readTerminalOutput`)
  - `terma.write(text)` — écrit dans le terminal actif (si permission `writeTerminal`)
  - `terma.addStatusBarItem({ text, onClick })` — ajoute un élément UI dans la barre de statut (si permission `ui`)
  - `terma.registerShortcut(keys, callback)` — raccourci clavier custom
- [ ] Palette de commandes (Ctrl+Shift+P) listant les commandes natives + celles des extensions

#### Structure d'une extension
```
mon-extension/
├── manifest.json
└── index.js
```
```json
// manifest.json
{
  "name": "Mon Extension",
  "id": "mon-extension",
  "author": "pseudo",
  "version": "1.0.0",
  "description": "Ce que fait l'extension",
  "main": "index.js",
  "permissions": ["commands", "readTerminalOutput", "ui"]
}
```
```js
// index.js — reçoit l'objet `terma` (limité aux permissions accordées)
module.exports = function activate(terma) {
  terma.registerCommand("hello", () => {
    terma.write("Salut depuis mon extension !\r\n");
  });
};
```

### Phase 6 — UX & polish
- [ ] Panneau de paramètres custom (onglets internes : Apparence / Thèmes / Extensions / Raccourcis / Terminal)
- [ ] Choix du shell par défaut (PowerShell / cmd / WSL / Git Bash si détecté)
- [ ] Réglage opacité de la fenêtre + flou (acrylic Windows si possible)
- [ ] Recherche dans le terminal (Ctrl+F, search addon)
- [ ] Split panes optionnel (diviser un onglet en deux terminaux côte à côte) — si le temps le permet
- [ ] Splash screen au lancement
- [ ] Curseur configurable (block / underline / bar, clignotant ou non)

### Phase 7 — Build
- [ ] Configuration electron-builder pour générer un `.exe` Windows (NSIS installer)
- [ ] **Attention** : node-pty est un module natif → bien configurer le rebuild natif (electron-rebuild) et l'inclusion dans le package
- [ ] Icône app custom `.ico`
- [ ] Le `.exe` doit créer les dossiers `themes/` et `extensions/` au premier lancement s'ils n'existent pas

## Structure de fichiers attendue
```
terma-app/
├── public/
│   ├── electron.js          # Main process (fenêtre, IPC, before-quit)
│   ├── preload.js           # contextBridge (API sécurisée renderer↔main)
│   └── pty-manager.js       # Gestion node-pty (spawn/kill/data par onglet)
├── src/
│   ├── App.jsx
│   ├── components/
│   │   ├── TitleBar.jsx
│   │   ├── TabBar.jsx           # barre d'onglets façon Chrome
│   │   ├── Tab.jsx
│   │   ├── TerminalView.jsx     # wrapper xterm.js pour un onglet
│   │   ├── SettingsPanel.jsx
│   │   ├── CommandPalette.jsx   # Ctrl+Shift+P
│   │   └── ThemeEditor.jsx
│   ├── hooks/
│   │   ├── useTabs.js           # création / fermeture / ordre des onglets
│   │   ├── useSession.js        # sauvegarde / restauration session.json
│   │   └── useTheme.js          # chargement / application des thèmes
│   ├── services/
│   │   ├── themeLoader.js       # lecture du dossier themes/
│   │   └── extensionHost.js     # chargement + sandbox des extensions
│   └── styles/
│       └── global.css
├── package.json
├── electron-builder.yml
└── AGENT.md
```

## Contraintes impératives
- **Zéro** composant UI natif Windows visible (pas de scrollbars OS, pas de menus OS, pas de titlebar OS)
- `contextIsolation: true`, `nodeIntegration: false` — sécurité Electron de base respectée
- Les extensions communautaires s'exécutent **toujours** en sandbox avec permissions, jamais en accès libre
- Le terminal doit être **réactif et fluide** (pas de lag à la frappe ni au scroll)
- Tout le CSS écrit à la main — pas de Tailwind, pas de Material UI
- Icônes en SVG inline ou via lucide-react
- Le build final produit un `.exe` autonome (node-pty natif correctement empaqueté)
- Pas de marketplace / téléchargement intégré : thèmes et extensions s'importent manuellement depuis un fichier/dossier local

## Commandes importantes
```bash
npm install              # Installer les dépendances
npm run dev              # Lancer en mode dev (Electron + React)
npm run rebuild          # electron-rebuild (recompile node-pty pour Electron)
npm run build            # Build React
npm run dist             # Générer le .exe via electron-builder
```

## Règles de travail
- Si un système est risqué ou a plusieurs approches (ex: sandbox des extensions, sérialisation du scrollback), propose-moi une version simple ET une version avancée, et laisse-moi choisir.
- Pose-moi des questions si quelque chose est ambigu avant de coder.
- Pour tout ce que tu ne peux pas générer (icône `.ico`, polices), donne-moi des instructions claires.
- Priorise la lisibilité et la maintenabilité du code sur la concision.
- Dans les commits et les pull requests, Claude ne se met **pas** en co-auteur (pas de ligne `Co-Authored-By: Claude`, pas de mention « Generated with Claude Code »).
