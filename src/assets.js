'use strict';
/* ============================================================
 * 资源加载：图片（含投影烘焙与变色贴图）、帝皇图集（分包懒加载）
 * canvas 无 filter，drop-shadow / hue-rotate 全部构建期或加载期烘焙。
 * ==========================================================*/
const config = require('./config.js');

const imageCache = new Map();     // path -> Promise<image>
const characterCache = new Map(); // sfxId -> baked set

function createOffscreenCanvas(w, h) {
  const canvas = tt.createCanvas();
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function loadImage(path) {
  if (imageCache.has(path)) return imageCache.get(path);
  const promise = new Promise((resolve, reject) => {
    const image = tt.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => {
      imageCache.delete(path);
      reject(new Error(`图片加载失败: ${path}`));
    };
    image.src = path;
  });
  imageCache.set(path, promise);
  return promise;
}

/* 把 drop-shadow(0 offsetY blur rgba(...)) 烘焙进离屏画布 */
function bakeShadow(image, offsetY, blur, color) {
  const pad = Math.ceil(blur * 1.5 + offsetY + 8);
  const w = image.width + pad * 2;
  const h = image.height + pad * 2;
  const canvas = createOffscreenCanvas(w, h);
  const g = canvas.getContext('2d');
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.shadowOffsetY = offsetY;
  g.drawImage(image, pad, pad);
  return { canvas, pad };
}

/* 加载一套角色立绘并烘焙：闭/开嘴原图 + 长按渐变红贴图 +（村民）受击红闪贴图 */
async function loadCharacterImages(sfxId) {
  if (characterCache.has(sfxId)) return characterCache.get(sfxId);
  const set = config.CHARACTER_IMAGE_SETS[sfxId] ?? config.CHARACTER_IMAGE_SETS.dagou;

  const [closeImg, openImg] = await Promise.all([
    loadImage(set.close),
    loadImage(set.open),
  ]);

  const shadowColor = 'rgba(135, 131, 126, .4)';
  const baked = {
    close: bakeShadow(closeImg, 18, 40, shadowColor),
    open: bakeShadow(openImg, 18, 40, shadowColor),
    closeTint: null,
    openTint: null,
    flashClose: null,
    flashOpen: null,
  };

  const tintPrefix = config.TINT_DIR;
  const [closeTintImg, openTintImg] = await Promise.all([
    loadImage(tintPrefix + set.close.split('/').pop()).catch(() => null),
    loadImage(tintPrefix + set.open.split('/').pop()).catch(() => null),
  ]);
  if (closeTintImg && openTintImg) {
    // 变色贴图不再重复烘焙投影：绘制时按同一偏移画阴影层即可
    baked.closeTint = { canvas: closeTintImg, pad: 0 };
    baked.openTint = { canvas: openTintImg, pad: 0 };
  }

  if (sfxId === 'villager') {
    const [flashCloseImg, flashOpenImg] = await Promise.all([
      loadImage(tintPrefix + 'flash_' + set.close.split('/').pop()).catch(() => null),
      loadImage(tintPrefix + 'flash_' + set.open.split('/').pop()).catch(() => null),
    ]);
    if (flashCloseImg && flashOpenImg) {
      baked.flashClose = { canvas: flashCloseImg, pad: 0 };
      baked.flashOpen = { canvas: flashOpenImg, pad: 0 };
    }
  }

  characterCache.set(sfxId, baked);
  return baked;
}

/* 帝皇图集：存放在独立分包，按需加载；浏览器环境直接读路径 */
function loadSubpackage(name) {
  return new Promise((resolve, reject) => {
    if (typeof tt === 'undefined' || typeof tt.loadSubpackage !== 'function') {
      resolve();
      return;
    }
    tt.loadSubpackage({
      name,
      success: resolve,
      fail: (res) => reject(new Error(`分包加载失败: ${name} ${res?.errMsg ?? ''}`)),
    });
  });
}

async function loadEmperorAtlas() {
  await loadSubpackage('emperor');
  return loadImage(config.HAJIMI_ATLAS_PATH);
}

function getImage(path) {
  return imageCache.get(path) ?? null;
}

module.exports = {
  loadImage, loadCharacterImages, loadEmperorAtlas,
  bakeShadow, createOffscreenCanvas, getImage,
};
