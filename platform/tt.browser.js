'use strict';
/* ============================================================
 * 浏览器端 tt.* 模拟层 —— 仅用于本机 Chrome 预览与自动化测试，
 * 不参与小游戏上传（project.config.json 已排除 platform 目录）。
 * ==========================================================*/
(function () {
  if (typeof window === 'undefined') return;

  let mainCanvas = null;
  const handlers = { start: [], move: [], end: [], cancel: [] };
  const resizeCallbacks = [];

  function notifyResize() {
    for (const cb of resizeCallbacks) setTimeout(cb, 0);
  }

  function touchFromEvent(e) {
    return {
      identifier: e.pointerId ?? 0,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }

  function makeResponse(e) {
    const touch = touchFromEvent(e);
    return { changedTouches: [touch], touches: [touch] };
  }

  const tt = {
    createCanvas() {
      if (!mainCanvas) {
        mainCanvas = document.getElementById('game-canvas');
        if (!mainCanvas) {
          mainCanvas = document.createElement('canvas');
          document.body.appendChild(mainCanvas);
        }
        mainCanvas.style.width = '100vw';
        mainCanvas.style.height = '100vh';
        mainCanvas.style.display = 'block';
        mainCanvas.style.touchAction = 'none';
        bindTouch(mainCanvas);
        bindResizeWatch(mainCanvas);
        return mainCanvas;
      }
      return document.createElement('canvas');
    },

    createImage() {
      const img = new Image();
      // 小游戏内图片路径是包内绝对路径（assets/...、packages/...），
      // 浏览器预览时页面在 /preview/ 下，需要回退到项目根。
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(img, 'src', {
        set(value) {
          const resolved = /^(https?:|blob:|data:|\/)/.test(value) ? value : '../' + value;
          desc.set.call(img, resolved);
        },
        get() {
          return desc.get.call(img);
        },
      });
      return img;
    },

    getSystemInfoSync() {
      return {
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
      };
    },

    onTouchStart(cb) { handlers.start.push(cb); },
    onTouchMove(cb) { handlers.move.push(cb); },
    onTouchEnd(cb) { handlers.end.push(cb); },
    onTouchCancel(cb) { handlers.cancel.push(cb); },

    onWindowResize(cb) {
      resizeCallbacks.push(cb);
    },

    getStorageSync(key) {
      try {
        return window.localStorage.getItem(String(key)) ?? '';
      } catch (_) {
        return '';
      }
    },
    setStorageSync(key, value) {
      try {
        window.localStorage.setItem(String(key), String(value));
      } catch (_) { /* 忽略 */ }
    },

    loadSubpackage(options) {
      // 浏览器直接按路径加载，分包概念不存在
      if (options && typeof options.success === 'function') {
        setTimeout(options.success, 0);
      }
    },

    // WebAudio 入口（audio-backend 会优先探测）
    createWebAudioContext() {
      return new (window.AudioContext || window.webkitAudioContext)();
    },

    triggerGC() { /* 浏览器无需 */ },
  };

  function emit(list, res) {
    for (const cb of list) cb(res);
  }

  /* 面板/窗口尺寸变化都通知游戏（部分嵌入浏览器不派发 window.resize） */
  function bindResizeWatch(canvas) {
    window.addEventListener('resize', notifyResize);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(notifyResize).observe(canvas);
    }
  }

  function bindTouch(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      emit(handlers.start, makeResponse(e));
    });
    canvas.addEventListener('pointermove', (e) => {
      emit(handlers.move, makeResponse(e));
    });
    canvas.addEventListener('pointerup', (e) => {
      emit(handlers.end, makeResponse(e));
    });
    canvas.addEventListener('pointercancel', (e) => {
      emit(handlers.cancel, makeResponse(e));
    });
  }

  window.tt = tt;
})();
