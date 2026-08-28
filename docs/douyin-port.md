# 大狗嚼 · 抖音小游戏移植说明

本文记录网页版 → 抖音小游戏的移植方案、关键差异与上线前清单。

## 1. 平台差异与移植策略

| 网页版实现 | 抖音小游戏实现 |
|---|---|
| DOM + CSS 布局/动画（约 45 个元素、7 组 keyframes） | 单主画布分层绘制，keyframes 参数照抄为代码补间 |
| Pointer Events + `setPointerCapture` + DOM 事件拦截 | `tt.onTouchStart/Move/End/Cancel` 多指路由 + 手动 z 序命中测试（弹窗 > 面板 > 顶栏 > 八度带 > 舞台） |
| Web Audio：`AudioContext` + `decodeAudioData` + `playbackRate` 变调 + 振荡器合成 BGM | 抖音 WebAudio 风格 AudioContext（`audio-backend.js` 依次探测 `createWebAudioContext` 等入口）；振荡器不可用时回退到 `assets/audio/bgm-loop.wav` 预渲染循环（`tools/prerender-bgm.html` 生成，尾部回卷叠加消除接缝） |
| `atob` 解码 base64 音频 | 手写 base64 → ArrayBuffer（`src/utils.js`） |
| CSS `drop-shadow` / `hue-rotate` 渐红 | 加载期烘焙投影进离屏画布；变色贴图构建期生成（`assets/img/tint/`），运行时透明度插值 |
| B 站 toy-sdk：云存储、视频解锁、跳转 | 全部移除；设置/解锁状态存 `tt.setStorageSync`（键名沿用 `dagou_*_v1`） |
| `ResizeObserver` / `matchMedia` | `tt.onWindowResize` + `tt.getSystemInfoSync`；`prefers-reduced-motion` 不适用 |

## 2. 与原版的刻意差异

- **角色全解锁**（MVP 决策）：叮咚鸡音效、哈基米帝皇皮肤直接可用；B 站视频解锁流程、确认弹窗、开发者视频卡、作者主页按钮移除，设置页保留「原作 · MarkCup」文字署名。
- **游戏名**：开始页标题为「大狗嚼」（跟随应用图标），网页版为「大狗Tap」。
- **设置保存**：本地即时保存，状态文案为「设置已自动保存到本机」。
- **NEW 红点**逻辑保留（首次打开设置后消除）。

## 3. 包体

| 部分 | 体积 | 说明 |
|---|---|---|
| 主包 | ≈3.2MB（限 4MB） | `assets/img` 2.1MB（8 张 512² 调色板 PNG + 变色贴图 + 帝皇小图标）+ `src` 1.1MB（主要是 919KB base64 音频包）+ `assets/audio/bgm-loop.wav` 1.3MB |
| 分包 `packages/emperor` | 2.0MB（≤4MB） | 帝皇 108 帧无损 webp 图集，选中帝皇皮肤时 `tt.loadSubpackage` 懒加载；加载失败自动回退原皮 |

帝皇图集实测结论：像素画内容用有损 webp（2.17MB）与调色板 PNG（4.7MB）都比无损 webp（2.0MB）更大，故保留无损 webp 并放入分包。若真机出现 webp 解码失败，游戏会自动回退到静态立绘（原版同款降级），无需发版处理。

## 4. 测试情况

- `node tools/verify-douyin.mjs`：base64 解码、网格构建（普通 3×4 / 钢琴 3×8）、线段跨格补全、变调表与网页版一致、钢琴音阶、配置完整性。
- Chrome + `platform/tt.browser.js` 模拟层完整 E2E：开始流程、点击发声（12 采样解码 + 4 条 WSOLA 延音纹理构建成功）、特效、角色切换、帝皇分包加载、钢琴模式、八度切换带、长按延音变红、村民连击、设置持久化（localStorage 键与线上一致）。
- 视觉验收：7 张关键截图通过评审（含红点透明度 bug 的发现与修复）。

真机预览请在抖音开发者工具中编译（本仓库目录直接导入），重点验证：
1. WebAudio 入口探测结果（`audio-backend.js` 的能力探测在控制台无日志，可在 `tryLoadBgmLoop` 前打印 `caps`）；
2. 帝皇分包在真机的 `tt.loadSubpackage` 与 webp 解码；
3. 多指同时按键的触控响应。

## 5. 上线前清单（平台侧，代码之外）

- [ ] 抖音开放平台「完善信息」：上传 `design/icon-512.png` 应用图标、名称、类目等
- [ ] 接入平台「必接能力」（实名认证/防沉迷等，见小游戏管理后台「必接能力一览」，未接入会被审核驳回）
- [ ] 小游戏备案 / 资质（涉及内购需版号，纯广告变现按平台要求提供资质）
- [ ] 如需变现：接 `tt.createRewardedVideoAd` 激励视频（可替代已移除的"看视频解锁"玩法）
- [ ] 真机过一遍第 4 节的验证项
- [ ] `project.config.json` 的 `appid` 确认为最终上架 AppID（当前预填 `ttf5ad83106bcaa54702`）

## 6. 已知限制

- 字体使用系统默认（`sans-serif`/`serif`），网页版的 PingFang SC/Noto Serif SC 字重在部分安卓机会有差异。
- 特效中约 12% 的元素使用点缀色（珊瑚/青/蓝），与原版 `ACCENTS` 设计一致。
- `backdrop-filter` 毛玻璃（原版八度带/解锁弹窗）以半透明纯色近似。
- 键盘弹奏（QWERTY 钢琴键）未移植——手机端无键盘场景。
