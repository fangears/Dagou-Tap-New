'use strict';
/* ============================================================
 * 浏览器预览页：极简 CommonJS 加载器 + canvas 舞台
 * ==========================================================*/
(function () {
  const MODULES = [
    'src/config.js',
    'src/utils.js',
    'src/state.js',
    'src/storage.js',
    'src/music.js',
    'src/audio-data.js',
    'src/audio-backend.js',
    'src/synth.js',
    'src/audio-engine.js',
    'src/assets.js',
    'src/grid.js',
    'src/visuals.js',
    'src/ui.js',
    'src/game.js',
    'src/main.js',
  ];

  const registry = new Map();

  function resolvePath(path, fromDir) {
    if (!path.startsWith('./')) return path;
    return normalize(fromDir + path.slice(2));
  }

  function normalize(path) {
    const parts = path.split('/');
    const out = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out.join('/');
  }

  function requireModule(path, fromDir) {
    const full = resolvePath(path, fromDir);
    const entry = registry.get(full);
    if (!entry) throw new Error('module not found: ' + full);
    if (entry.module) return entry.module.exports;
    const module = { exports: {} };
    entry.module = module;
    const dir = full.includes('/') ? full.slice(0, full.lastIndexOf('/') + 1) : '';
    const boundRequire = (p) => requireModule(p, dir);
    entry.factory(boundRequire, module, module.exports);
    return module.exports;
  }

  async function boot() {
    for (const path of MODULES) {
      const response = await fetch('../' + path);
      if (!response.ok) throw new Error('加载失败: ' + path);
      const text = await response.text();
      const factory = new Function(
        'require',
        'module',
        'exports',
        '__dirname',
        `${text}\n//# sourceURL=${path}`
      );
      registry.set(path, { factory, module: null });
    }
    requireModule('./src/main.js', '');
    window.__gameBooted = true;
    window.dispatchEvent(new Event('__game-booted'));
    const el = document.getElementById('boot-status');
    if (el) el.textContent = '';
  }

  boot().catch((error) => {
    window.__gameBootError = String(error && error.stack ? error.stack : error);
    console.error('[preview] 启动失败', error);
    const el = document.getElementById('boot-status');
    if (el) el.textContent = '启动失败: ' + error.message;
  });
})();
