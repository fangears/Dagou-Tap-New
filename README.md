# 大狗嚼（抖音小游戏版）

> 本分支 `douyin-game` 是「大狗Tap」网页版（`main` 分支，原生 JS + DOM/CSS）向**抖音小游戏**（纯 canvas + `tt.*` API，无 DOM/CSS）的完整移植，玩法与视觉 1:1 还原。

## 目录结构

```
game.js / game.json / project.config.json   小游戏工程入口与配置
src/                                        游戏源码（CommonJS 模块）
  config.js        常量（节奏/音高表/调色板/存储键）
  state.js         可变游戏状态
  utils.js         工具（base64 解码/缓动/路径/字距排版）
  storage.js       tt 同步存储封装
  music.js         八度与钢琴音阶
  audio-data.js    base64 音频包（12 个 wav 样本）
  audio-backend.js AudioContext 创建与能力探测
  synth.js         鼓组/贝斯/和弦实时合成
  audio-engine.js  采样/WSOLA 延音/voice 状态机/量化队列/调度器
  assets.js        图片加载、投影烘焙、帝皇图集分包懒加载
  grid.js          分区网格数学（含滑动跨格补全）
  visuals.js       全屏特效引擎/角色渲染/受击/连击/署名
  ui.js            顶栏/开始页/设置面板/八度带/Toast（canvas 自绘）
  game.js          触摸路由/主循环/装配
  main.js          入口
assets/img            压缩后的图片（512² 调色板 PNG + 变色贴图）
assets/audio          预渲染 BGM loop（合成器不可用时的兜底）
packages/emperor      帝皇图集分包（2MB 无损 webp，懒加载）
platform/tt.browser.js 浏览器预览用 tt.* 模拟层（不参与打包）
preview/              本机 Chrome 预览页 + 静态服务器
tools/                资产处理与校验脚本
docs/douyin-port.md   移植说明与上线清单
Image/ audio/ index.html main.js   网页版原文件（保留历史，打包已排除）
```

## 本地开发

```bash
# 浏览器预览（无需抖音开发者工具）
node preview/server.mjs 8642
# 打开 http://127.0.0.1:8642/preview/index.html

# 逻辑单测
node tools/verify-douyin.mjs

# 重新生成压缩资产（需要 npm i sharp，在 tools/ 下）
node tools/process-assets.mjs
```

## 打开小游戏工程

用「抖音开发者工具」导入本目录（`douyin-game` 分支检出目录），AppID 已预填 `ttf5ad83106bcaa54702`，可在 `project.config.json` 中更换。上线前清单见 `docs/douyin-port.md`。

## 署名

原作：[MarkCup（哔哩哔哩）](https://space.bilibili.com/357762853)，游戏内设置页保留原作署名。
