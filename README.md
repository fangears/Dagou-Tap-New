# 大狗Tap

仿 Mikutap 的节拍互动网页游戏(BPM 128):点击/触摸让大狗跟着节拍张嘴叫,配合几何特效与钢琴按键。支持桌面端(鼠标 + 键盘)与移动端(触摸,含刘海屏安全区适配)。

**线上地址**:https://dagou-tap.rth2.xyz (热铁盒网页托管)

## 运行

纯静态项目,无构建步骤。`index.html` + `main.js` + `audio-data.js` + `Image/` 即为全部运行时资产(`audio/`、`tools/`、`docs/` 仅供开发)。

本地预览任选其一:

```bash
# Python
python -m http.server 5173
# 或 Node(零依赖)
node tools/local-server.cjs
```

## 部署到热铁盒

热铁盒会在服务端把页面资源改写到其 CDN(`cdn.rthsoftware.cn`),因此 `index.html` 末尾带有一段回退脚本:核心脚本(audio-data.js / main.js)始终从站点本体直连加载,图片引用会被还原为站点路径。本地与其他托管平台不受影响。

手动部署(需要 API 密钥,置于环境变量 `RTH_API_KEY` 或项目根目录 `.env`):

```bash
npx -y rth-host-helper deploy --outdir <部署目录> --site dagou-tap
```

也可在热铁盒控制面板的文件管理器中直接上传上述 4 项运行时资产。
