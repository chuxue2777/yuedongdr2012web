# 乐动达人 2013 · 网页版

2013 年 iOS 版《乐动达人》的浏览器移植版。美术、谱面、音乐全部来自原版 IPA，
引擎用 JS 按 cocos2d 的 API 形状重写，纯静态站点，不需要后端。

打开就能玩：点「歌曲列表」→ 选歌 → 点「GO」。

---

## 部署到 GitHub Pages（两种方式，任选一种）

### 方式一：网页上传（不用装任何工具，最省事）

1. 打开 <https://github.com/new>，仓库名随便填（比如 `lddr`），选 **Public**，点 Create repository
2. 在新仓库页面点 **uploading an existing file**
3. 把这个文件夹里的**全部内容**拖进去（`index.html`、`css`、`js`、`assets`、`.nojekyll`）
   - 拖拽要包含子文件夹，浏览器会自动保留目录结构
   - `.nojekyll` 是隐藏文件，如果拖不进去可以忽略——它只是让 Pages 跳过 Jekyll 处理，不加一般也能跑
4. 点 **Commit changes** 等上传完成（33MB，耐心等一会儿）
5. 进仓库 **Settings** → 左侧 **Pages**
6. **Source** 选 `Deploy from a branch`，**Branch** 选 `main` + `/ (root)`，点 **Save**
7. 等 1~2 分钟，页面顶部会出现网址：`https://你的用户名.github.io/仓库名/`
8. 把这个网址发给朋友即可

### 方式二：命令行（熟悉 git 的话更快）

```bash
cd 本文件夹
git init
git add .
git commit -m "乐动达人 2013 网页版"
git branch -M main
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

推完去 **Settings → Pages** 选 `main` / `root` 保存，同上。

---

## 注意事项

- **用 https 打开最稳**（GitHub Pages 默认就是）。本地双击 `index.html` 现在也能跑
  （各曲包的 `config.lua` 已内联进 `js/lua_src.js`，不再依赖 XHR，绕开了 `file://`
  的跨域限制）；如果本地双击时画面异常，改用静态服务器：
  `python -m http.server 8130` → 访问 `http://127.0.0.1:8130/`
- **首次进入要点一下屏幕**：iOS / Android 禁止网页自动播放音频，点过任意按钮后才会出声
- **建议横屏？不用**。整个游戏是竖屏 320×480 设计，画布自动等比缩放居中
- **流量提示**：整站 34MB，其中 8 首歌的 mp3 约 20MB。第一次打开建议用 WiFi

---

## 支持

- 手机浏览器：Safari（iOS 12+）、Chrome / 微信内置浏览器（Android 7+）
- 桌面浏览器：Chrome / Edge / Firefox 最新版
- 触屏操作：点按判定，按住是长条音符

---

## 技术说明

引擎结构、哪些素材是原版哪些是重建、评级规则反推过程等，见 `README.dev.md`。
