#!/usr/bin/env node
// Copia la web de EduCentro (../) a ./www y le inyecta ajustes móviles
// sin tocar el index.html original. Sin dependencias externas.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..');
const DEST = path.resolve(__dirname, '..', 'www');
const THEME = '#1e3a8a';
const EXCLUDE = new Set(['docs', 'propuestas', 'tests', 'mobile', 'node_modules', '.git']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE.has(e.name) || e.name.startsWith('.')) continue;
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
for (const d of ['css', 'js', 'assets']) {
  const p = path.join(SRC, d);
  if (fs.existsSync(p)) copyDir(p, path.join(DEST, d));
}

// index.html con inyección móvil
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const head = `
<!-- EduCentro mobile (inyectado por sync-web.js) -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${THEME}">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="manifest.webmanifest">
<style id="mobile-safe-area">
  html { -webkit-text-size-adjust: 100%; }
  body { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);
         padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
         overscroll-behavior-y: none; -webkit-tap-highlight-color: transparent; }
</style>
`;
html = html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i, '');
html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, head + '</head>') : head + html;

// Botón atrás de Android + StatusBar (solo si corre dentro de Capacitor). Va en un archivo externo: la CSP prohíbe scripts inline.
const script = `(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  try { if (P.StatusBar) { P.StatusBar.setStyle({ style: 'DARK' }); P.StatusBar.setBackgroundColor({ color: '${THEME}' }); } } catch (e) {}
  if (P.App && P.App.addListener) {
    P.App.addListener('backButton', function () {
      // Con hash-router: retrocede en el historial; si no hay, sale de la app.
      if (window.history.length > 1 && location.hash && location.hash !== '#/' && location.hash !== '#') window.history.back();
      else P.App.exitApp();
    });
  }
})();
`;
fs.writeFileSync(path.join(DEST, 'native.js'), script);
const tag = '\n<script src="native.js"></script>\n';
html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tag + '</body>') : html + tag;
fs.writeFileSync(path.join(DEST, 'index.html'), html);

fs.writeFileSync(path.join(DEST, 'manifest.webmanifest'), JSON.stringify({
  name: 'EduCentro', short_name: 'EduCentro', start_url: './index.html',
  display: 'standalone', orientation: 'any', background_color: '#ffffff', theme_color: THEME,
  icons: []
}, null, 2));

console.log('www/ lista en ' + DEST + '. Siguiente: npx cap sync android');
