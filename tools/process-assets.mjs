// 小游戏资产处理：压缩立绘 / 重编码图集 / 生成变色贴图 / 图标
// 用法：node tools/process-assets.mjs（在仓库根目录或 tools 目录均可）
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'Image');
const OUT = path.join(root, 'assets', 'img');
const TINT = path.join(OUT, 'tint');
fs.mkdirSync(TINT, { recursive: true });

const CHARACTERS = ['dagou', 'dingdongji', 'maodie', 'villager'];
const 报告 = [];

// 1. 立绘 1024² → 512² 调色板 PNG（显示宽度约 520 物理像素，视觉无损）
for (const name of fs.readdirSync(SRC)) {
  if (!name.endsWith('_mouth.png')) continue;
  const src = path.join(SRC, name);
  const dest = path.join(OUT, name);
  const info = await sharp(src)
    .resize(512, 512, { kernel: 'lanczos3' })
    .png({ palette: true, quality: 90, effort: 9 })
    .toFile(dest);
  报告.push([path.basename(dest), info.size]);
}

// 2. 帝皇图集：像素画内容有损/调色板重编码均会变大（实测），保留原版无损 webp，
//    体积 2.0MB 超出主包预算 → 放入独立分包 packages/emperor/，选中帝皇皮肤时懒加载。
{
  fs.mkdirSync(path.join(root, 'packages', 'emperor'), { recursive: true });
  fs.copyFileSync(
    path.join(SRC, 'donghaidihuang_atlas.webp'),
    path.join(root, 'packages', 'emperor', 'donghaidihuang_atlas.webp')
  );
  const size = fs.statSync(path.join(root, 'packages', 'emperor', 'donghaidihuang_atlas.webp')).size;
  报告.push(['packages/emperor/donghaidihuang_atlas.webp (分包)', size]);
}

// 3. 帝皇小图标 webp → png（小游戏端 webp 兼容性存疑，小图标直接转 png）
{
  const info = await sharp(path.join(SRC, 'donghaidihuang_icon.webp'))
    .png()
    .toFile(path.join(OUT, 'donghaidihuang_icon.png'));
  报告.push(['donghaidihuang_icon.png', info.size]);
}

// 4. 变色贴图（canvas 无 filter，构建期烘焙）：
//    jellyRed：长按果冻 hue-rotate(-42deg)+saturate(1.7)+brightness(1.04) 的满档效果
//    villagerFlash：村民受击 sepia(.25)+saturate(1.9)+hue-rotate(316deg)+brightness(1.12) 近似
const Jelly = { hue: -42, saturation: 1.7, brightness: 1.04 };
const Flash = { hue: -44, saturation: 1.9, brightness: 1.12 };
for (const name of fs.readdirSync(OUT)) {
  if (!name.endsWith('_mouth.png')) continue;
  const src = path.join(OUT, name);
  const jelly = await sharp(src).modulate(Jelly)
    .png({ palette: true, quality: 90 }).toFile(path.join(TINT, name));
  报告.push([`tint/${path.basename(jelly.name ?? name)}`, jelly.size]);
}
for (const name of ['villager_close_mouth.png', 'villager_open_mouth.png']) {
  const src = path.join(OUT, name);
  const info = await sharp(src).modulate(Flash)
    .png({ palette: true, quality: 90 }).toFile(path.join(TINT, `flash_${name}`));
  报告.push([`tint/flash_${name}`, info.size]);
}

// 5. 应用图标：源图 → 512²（平台上「完善信息」上传用）
{
  const src = path.join(root, 'design', 'icon-source.png');
  const meta = await sharp(src).metadata();
  const info = await sharp(src)
    .resize(512, 512, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, 'design', 'icon-512.png'));
  报告.push([`design/icon-512.png (源 ${meta.width}x${meta.height})`, info.size]);
}

console.log('产出文件：');
let mainTotal = 0;
let subTotal = 0;
for (const [name, size] of 报告) {
  if (name.startsWith('packages/')) subTotal += size;
  else mainTotal += size;
  console.log(`  ${name.padEnd(46)} ${(size / 1024).toFixed(0)} KB`);
}
console.log(`主包 assets 合计：${(mainTotal / 1024).toFixed(0)} KB`);
console.log(`分包 assets 合计：${(subTotal / 1024).toFixed(0)} KB`);
