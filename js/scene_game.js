/* =============================================================================
 * scene_game.js —— 演奏场景
 *
 * 视觉：原版 png 图集（曲包 gameControlBg.png 做底 + 全局 AllPic/AllPic01 的
 *       Ball001-008 / Tail001-008）+ 透视轨道（轨道线用 canvas 绘制，因为 2013
 *       包里没有轨道贴图；轨迹取自 2011 版 Line.png 的同款透视关系）。
 * 数据：谱面逐条来自曲包 config.xml / config4.xml，未修改。
 * 判定：见 RULES，窗口值是逆向未拿到的部分，集中露在这里方便调。
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 版式 */
  /* 原版演奏页（截图 0470-0475）实测：轨道是**竖直平行**的锥形光条，
   * 不是透视收束 —— AllPic/Tail001-008 本身就是 50x480 的竖直渐变条，
   * 顶端宽、底端渐隐成尖。判定区在屏幕最下方，是三个/四个大唱片盘。
   * 所以这里没有消失点、没有 q 值，只有「一条竖轨 + 沿轨道下滑的音符」。 */
  /* 整屏设计尺寸 = 原版 640×1136 ÷2 = 320×568。
   * 下面所有「0471 实测」的坐标都是**整屏坐标**（截图像素 ÷2），
   * 顶栏占 0~88，游戏区 88~568。 */
  var W = 320, H = 568;
  /* ★ 顶栏偏移 = 0。
   *
   * 原版 iOS 是 320x568 整屏，顶部 88 逻辑是状态栏/logo 区，演奏区从 88 开始。
   * 但本项目所有几何值（判定盘、HUD、轨道）都是直接从
   * 「0471 整屏截图裁掉顶部 176px（=88 逻辑）后的 640x960」量出来的，
   * 也就是**已经是游戏区坐标**。
   *
   * 如果这里再 translate(0, 88)，所有内容会整体下移 88，
   * 判定盘（y≈426）直接被推到 514 —— 超出 480 画布，于是「判定盘消失」。
   * 这曾是最难定位的一个 bug。
   *
   * 现在画布 = 游戏区 = 320x480，坐标与裁剪图 1:1 对应，偏移归零。 */
  var GAME_TOP = 0;

  /* ------------------------------------------------------- 官方 UI 贴图层
   * 全部取自 iOS 2013 `beatmaster2012.app/UILine01/` 的原版图集
   * （UILine1 / DownBG / DownBG1）与 StageLight002，已按 1:1 逻辑像素
   * 切好放在 assets/gameui/ 下。绘制坐标与 canvas 一致：左上原点、y 向下。
   *
   * 位置全部由「官方 sprite 在原版截图 0471 上做内点率模板匹配」反推得到，
   * 判定盘匹配置信度 83~87%，不是目测。
   */
  var GUI_VER = 8;          // 素材版本号（改任何 gameui/*.png 后 +1，破浏览器缓存）
  var GUI = {
    _base: 'assets/gameui/',
    _img: {},
    _want: [
      'stage_disc', 'down_bg', 'down_bg2', 'people1', 'people2',
      'line', 'pad_lr', 'pad_m',
      'lifebar_shell', 'lifebar_fill', 'lifebar_bgfill',
      'pbar_shell', 'pbar_fill', 'pbar_knob',
      'combo', 'score', 'rate', 'max',
      'cap_score', 'cap_pause', 'logo',
      /* 官方按钮素材（从 title.png 图集按 ATLAS 帧坐标裁出，带 alpha） */
      'bar_left', 'bar_right', 'gear'
    ],
    preload: function () {
      for (var i = 0; i < this._want.length; i++) this.img(this._want[i]);
      this.atlas('title');
    },
    /* ---- 官方图集（assets/atlas/*.png）--------------------------------
     * 暂停/结算/死亡页的那套蓝色胶囊按钮**不是程序画的**，是原版图集里的素材：
     *   title.png 里 start_left.png  [322,283,226,86]  胶囊 + 右端圆孔（齿轮位）
     *   title.png 里 start_right.png [322,370,191,86]  胶囊 + 左端圆孔
     * 原版用 CCScale9Sprite 横向拉伸铺满 320，圆孔区保持 1:1。
     * 这里用九宫格（左圆角 / 可拉伸中段 / 圆孔段 / 右圆角）复刻同样的效果。 */
    _atlasImg: {},
    atlas: function (name) {
      var im = this._atlasImg[name];
      if (!im) {
        im = new Image();
        im.src = 'assets/atlas/' + name + '.png';
        this._atlasImg[name] = im;
      }
      return im;
    },
    atlasOk: function (name) {
      var im = this._atlasImg[name];
      return !!(im && im.complete && im.naturalWidth);
    },
    img: function (name) {
      var im = this._img[name];
      if (!im) {
        im = new Image();
        /* ★ 带版本号：素材重新生成后浏览器会命中旧缓存（表现为「改了图没变化」），
         *   拼一个 ?v= 常量即可破缓存。改素材时把这个数字 +1。 */
        im.src = this._base + name + '.png?v=' + GUI_VER;
        this._img[name] = im;
      }
      return im;
    },
    ok: function (name) {
      var im = this._img[name];
      return !!(im && im.complete && im.naturalWidth);
    },
    /* 判定盘染色：官方 LRTapPoint/MTapPoint 是「白环 + 纯黑内芯」，
     * 原版在运行时把内芯换成轨道色（0472 实测：蓝 85,217,250 / 粉 255,102,153 /
     * 绿 54,226,174）。这里对 sprite 做一次像素级替换并缓存，避免每帧重算。 */
    _tinted: {},
    tintPad: function (name, rgb) {
      var key = name + '|' + rgb;
      if (this._tinted[key]) return this._tinted[key];
      if (!this.ok(name)) return null;
      var src = this._img[name];
      var W = src.naturalWidth, H = src.naturalHeight;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var c2 = cv.getContext('2d');
      c2.drawImage(src, 0, 0);
      var id = c2.getImageData(0, 0, W, H);
      var d = id.data;
      var tr = parseInt(rgb.slice(1, 3), 16),
        tg = parseInt(rgb.slice(3, 5), 16), tb = parseInt(rgb.slice(5, 7), 16);

      /* ---- 精确定位「内芯」 ----
       * 官方 LRTapPoint / MTapPoint 只有 4 个色阶：全透明 / 黑 / 深灰(63) / 白(255)。
       * 结构从外到内：黑边框 → 白环 → 黑底 → 白点环 → 白心（中心那个小白孔）。
       * 整张图有 3 个黑色连通块，但**只有「内芯」这一块把中心小白孔围住**，
       * 另外两块（上下黑底）各自只围出同一个贯穿的白色环带。
       * 所以判据 = 黑连通块内「闭孔」的个数 ≥ 2 且其中有一个很小的孔。
       * pad_lr: 内芯 717px / 小孔 48px；pad_m: 内芯 1340px / 小孔 89px（均已实测）。 */
      var isK = function (x, y) {
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        var o = (y * W + x) * 4;
        return d[o + 3] > 200 && d[o] < 40 && d[o + 1] < 40 && d[o + 2] < 40;
      };
      var lab = new Int32Array(W * H), comps = [];
      var stack = [], HOLE_MAX = 400;   // 小孔上限像素（正常约 48 / 89）
      for (var y0 = 0; y0 < H; y0++) {
        for (var x0 = 0; x0 < W; x0++) {
          var id0 = y0 * W + x0;
          if (!isK(x0, y0) || lab[id0]) continue;
          var qi = comps.length + 1, cells = [];
          stack.length = 0; stack.push(id0); lab[id0] = qi;
          while (stack.length) {
            var cur = stack.pop(); cells.push(cur);
            var cx = cur % W, cy = (cur - cx) / W;
            var nb = [cur - 1, cur + 1, cur - W, cur + W];
            for (var t = 0; t < 4; t++) {
              var n2 = nb[t];
              if (n2 < 0 || n2 >= W * H) continue;
              if (t === 0 && cx === 0) continue;
              if (t === 1 && cx === W - 1) continue;
              if (lab[n2] || !isK(n2 % W, (n2 - n2 % W) / W)) continue;
              lab[n2] = qi; stack.push(n2);
            }
          }
          comps.push(cells);
        }
      }
      /* 对每个黑块里的非黑像素做连通，不接触画布边缘的即为闭孔 */
      var coreMark = new Uint8Array(W * H);
      for (var ci = 0; ci < comps.length; ci++) {
        var cells = comps[ci];
        var inComp = {};                       // 该块像素集合
        for (var a = 0; a < cells.length; a++) inComp[cells[a]] = 1;
        var visited = {}, holes = [];
        for (var a2 = 0; a2 < cells.length; a2++) {
          var p4 = cells[a2], px4 = p4 % W, py4 = (p4 - px4) / W;
          var nb4 = [[px4 + 1, py4], [px4 - 1, py4], [px4, py4 + 1], [px4, py4 - 1]];
          for (var q = 0; q < 4; q++) {
            var qx = nb4[q][0], qy = nb4[q][1];
            if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
            var qid = qy * W + qx;
            if (inComp[qid] || visited[qid]) continue;
            /* 泛洪这块非黑岛 */
            var isl = [], touches = false;
            visited[qid] = 1; stack.length = 0; stack.push(qid);
            while (stack.length) {
              var cid = stack.pop(); isl.push(cid);
              var ix = cid % W, iy = (cid - ix) / W;
              if (ix === 0 || iy === 0 || ix === W - 1 || iy === H - 1) touches = true;
              var nbs = [cid - 1, cid + 1, cid - W, cid + W];
              for (var u = 0; u < 4; u++) {
                var nid = nbs[u];
                if (nid < 0 || nid >= W * H) continue;
                if (u === 0 && ix === 0) continue;
                if (u === 1 && ix === W - 1) continue;
                if (inComp[nid] || visited[nid]) continue;
                visited[nid] = 1; stack.push(nid);
              }
            }
            if (!touches) holes.push(isl.length);
          }
        }
        /* 有 ≥2 个闭孔 且 存在一个小孔 → 这就是内芯 */
        var hasSmall = false;
        for (var h = 0; h < holes.length; h++) if (holes[h] <= HOLE_MAX) hasSmall = true;
        if (holes.length >= 2 && hasSmall) {
          for (var m = 0; m < cells.length; m++) coreMark[cells[m]] = 1;
        }
      }
      for (var m2 = 0; m2 < W * H; m2++) {
        if (!coreMark[m2]) continue;
        var o2 = m2 * 4;
        d[o2] = tr; d[o2 + 1] = tg; d[o2 + 2] = tb;
      }
      c2.putImageData(id, 0, 0);
      this._tinted[key] = cv;
      return cv;
    },
    /* 左上角锚点贴图；alpha 可选 */
    at: function (ctx, name, x, y, alpha) {
      if (!this.ok(name)) return false;
      var im = this._img[name];
      if (alpha === undefined || alpha >= 1) {
        ctx.drawImage(im, x, y, im.width, im.height);
      } else if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(im, x, y, im.width, im.height);
        ctx.restore();
      }
      return true;
    }
  };
  /* ---- 实测摆放（canvas 坐标，y 向下）---- */
  var UI_POS = {
    /* 注意：GUI.at 用的是 canvas 坐标（原点左上、y 向下）。
     * 下面 y 值全部是「0471 整屏截图 ÷2」再减去顶栏 88（GAME_TOP）得到的
     * **游戏区内**坐标；早先漏了这 88，导致整个画面整体偏高一条顶栏。 */
    /* stage_disc：紫盘 320x165。
     * 位置由参数扫描确定：sx=sy=1（原尺寸）、原点 (0,192) 时整屏 mean 最低。
     * 试过放大 1.1/1.2/1.57 倍并把中心对齐，mean 全部上升（14.75 → 16.3/17.9/26.1），
     * 说明原版就是 1:1 直接贴，不要缩放。 */
    stage_disc: { x: 0, y: 192, sx: 1, sy: 1 },     // 盘 320x165
    /* down_bg：蓝色地面（半透明光锥），盖在人群之上。
     * 由 sprite x=8 列 alpha 剖面与 REF x=4 列蓝度剖面对位解得：
     *   峰值 sprite y=205 → 逻辑 y≈410；alpha 上升段 sprite 190→200
     *   ≈ 逻辑 395→415 → sy ≈ 1.25。水平居中放大同样倍数。
     * 显示尺寸 400x350，摆在 (-40,170)，底边 520 → 溢出画布 40，
     * 与原版「蓝色一直糊到屏幕最下缘」一致。
     * （也试过 y=249/sx=1 的「梯形几何推导」，mean 反而升到 21.6，不采用。） */
    down_bg:    { x: -40, y: 170, sx: 1.25, sy: 1.25 },
    /* people1：人群剪影。手尖在 sprite y≈2，官方截图手尖在逻辑 y≈268。 */
    people1:    { x: 0, y: 266, sx: 1, sy: 1, alpha: 0.82 },  // 人群剪影 320x206
    /* 轨道 sprite：由「白线斜率」反解出的精确摆放（见 _drawTrack 上方推导）。
     * sprite 内部白线中心 x=152.5、斜率 ±0.39。 */
    line:       { x: 9.25, y: 220.3 },  // 轨道 305x263
    pad_lr_l:   { x: 0, y: 0 },       // 由 PAD_DRAW 统一算，见下
    pad_m:      { x: 0, y: 0 },
    pad_lr_r:   { x: 0, y: 0 },
    lifebar:    { x: 5, y: 286 },
    pbar:       { x: 290, y: 269 }
  };
  /* 联调出口：允许在控制台/CDP 里临时改 UI_POS.* 再截帧对比参数，
   * 不影响正常渲染（只读引用）。 */
  if (typeof window !== 'undefined') window.__UIPOS__ = UI_POS;

  /* ---- 演奏页纵向分段（全部来自 0471 逐像素扫描，非估计） ----
   * **整屏坐标**（320×568，y 向下，= 截图 ÷2）：
   *   0~52     深蓝渐变顶栏「乐动达人」logo（#00001B，底边渐隐到 52 转纯黑）
   *   52~88    纯黑条（顶栏与游戏区的过渡）
   *   88~      游戏区开始（歌手照 / 紫盘 / 轨道 / 判定盘）
   *   91~130   HUD 胶囊行（胶囊 y182~259 截图 → 91~129.5）
   *   下面这些常量是**游戏区内**坐标（已减 88）。 */
  var LANE_TOP = 258;       // 轨道顶端 y（紫盘中心高度，轨道从紫盘"长出来"）
  var LANE_BOT = 22;        // 轨道底端 y（judgement pad 中心）
  /* 判定圆心（canvas 坐标）：三个判定盘的圆心都在 canvas y≈439，
   * 由 0472 实测 —— 左 (102.5,878/2=439)、中 (323/2=161.5, 439)、右 (267.5,439)。
   * 音符的行程终点必须落在这里，否则圆盘是「停在盘上方」而不是「压到盘上」。 */
  /* 判定盘圆心 y（逻辑）：0471 三个盘的白环中心都在截图像素 852.5 → 426.25。
   * 音符行程终点必须落在这里，否则圆盘是「停在盘上方」而不是「压到盘上」。 */
  var PAD_CY = 426.25;
  var HIT_Y = PAD_CY;       // 判定线 y = 判定盘圆心（canvas 坐标）
  var PAD_Y_C = PAD_CY;     // 判定盘圆心 y
  /* 轨道间距在 y=150 处实测 84.75px → 逻辑 42.4；在 y=100 处 57.5px → 28.75。
   * 这是纯透视：间距 = SLOPE × (VANISH_Y − y)。 */
  var LANE_W3 = 80;         // 兼容旧引用
  var LANE_W4 = 80;

  /* ------------------------------------------------------- 判定规则（可调） */
  // 说明：Perfect/Great/Good 三段窗口的分界没能从二进制里还原出确切数值，
  //      下面这组是按同类音游 + 原版 Accurate00~06 七档评定反推的保守值。
  var RULES = {
    TRAVEL_MS: 1500,        // 音符从轨道顶端滑到判定线的时间
    PERFECT: 55,            // ±ms
    GREAT: 110,
    GOOD: 170,
    MISS: 200,              // 超过即判 Miss（自动漏掉）
    BASE: { PERFECT: 1000, GREAT: 700, GOOD: 300, MISS: 0 },
    /* ★ 漏打扣分：0472 静帧里原版显示 −30，而这一帧尚未打中任何音符，
     *   说明它是**开局倒数期间漏掉的那一下**扣的分。
     *   原版扣分是按固定档扣（30），不按连击倍率放大 —— 所以
     *   MISS 不能是 0（那样永远扣不到分），也不能走倍率。
     *   下面这个值是把「漏一个 → −30」标定出来的。 */
    PENALTY_MISS: 30,
    MULT: [[200, 16], [100, 8], [50, 4], [30, 3], [10, 2]],  // 与 x2/x3/x4/x8/x16 五档图对应
    LIFE_START: 100,
    LIFE_MISS: -3,
    LIFE_PERFECT: 1.5,
    LIFE_GREAT: 1,
    FLAME_COMBO: 30         // 连击到多少换成 Ball005-008 火焰版
  };

  /* 轨道色按 AllPic.png 实测取样（这张是 6 根柱：黄/黄/青/粉/蓝白/黄），
   * 截图 0471 三条轨道从左到右是**粉、青、黄绿**，与此对应。
   * 连击态换 AllPic01 的金色系。 */
  var LANE_COLORS = ['#ff8fa6', '#6fe8ff', '#e8ff5a', '#ffe14d'];
  var LANE_GLOW = ['rgba(255,143,166,', 'rgba(111,232,255,', 'rgba(232,255,90,', 'rgba(255,225,77,'];
  // 连击态（火焰）用金色系
  var LANE_COLORS_SPECIAL = ['#ffd84d', '#ffc24d', '#ffd84d', '#ffc24d'];
  var LANE_GLOW_SPECIAL = ['rgba(255,216,77,', 'rgba(255,194,77,', 'rgba(255,216,77,', 'rgba(255,194,77,'];
  var JUDGE_STYLE = {
    PERFECT: { text: 'PERFECT', color: '#ffe14d' },
    GREAT: { text: 'GREAT', color: '#5cffb0' },
    GOOD: { text: 'GOOD', color: '#7fc8ff' },
    MISS: { text: 'MISS', color: '#ff5a5a' }
  };

  /* 逻辑坐标（原点左下、y 向上）→ 绘制坐标（原点左上、y 向下）。
   * 注意：核心绘制层现在**全部直接用绘制坐标**，Y() 只给还沿用旧约定的
   * HUD / 判定文字等少数几处使用。 */
  function Y(y) { return H - y; }

  /* 音符纵向映射（**绘制坐标**，y 向下）：
   * u=0 在轨道顶端（紫盘上沿，Y=TRACK_TOP），u=1 落到判定盘圆心（Y=PAD_HIT_Y），
   * u>1 继续往下淡出。 */
  var TRACK_TOP = 240;      // 音符出生高度
  var PAD_HIT_Y = PAD_CY;   // 音符行程终点 = 判定盘圆心（绘制 Y）
  function yOfU(u) { return TRACK_TOP + u * (PAD_HIT_Y - TRACK_TOP); }
  var U_HIT = 1;

  /* ---------------------------------------------------- 三角形仿射贴图 */
  /* canvas 的 drawImage 只支持轴对齐矩形。要把贴图铺进梯形，就把它拆成两个
   * 三角形，每个三角形用 setTransform 解出仿射矩阵后 clip + drawImage。 */
  function drawTexTri(ctx, img, sx, sy, sw, sh,
    x0, y0, x1, y1, x2, y2,
    u0, v0, u1, v1, u2, v2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();

    // 解仿射：屏幕点 = M * 纹理点
    var dx1 = x1 - x0, dy1 = y1 - y0;
    var dx2 = x2 - x0, dy2 = y2 - y0;
    var du1 = u1 - u0, dv1 = v1 - v0;
    var du2 = u2 - u0, dv2 = v2 - v0;
    var det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-9) { ctx.restore(); return; }
    var a = (dx1 * dv2 - dx2 * dv1) / det;
    var b = (dy1 * dv2 - dy2 * dv1) / det;
    var c = (dx2 * du1 - dx1 * du2) / det;
    var d = (dy2 * du1 - dy1 * du2) / det;
    // 平移：让纹理 (u0,v0) 落在 (x0,y0)
    var e = x0 - (a * u0 + c * v0);
    var f = y0 - (b * u0 + d * v0);

    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1, 1);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ 层 */
  function GameLayer(song, mode) {
    cc.Layer.call(this);
    this.isCustomDraw = true;
    this.song = song;
    this.mode = mode;                  // '3' | '4'
    this.laneCount = mode === '4' ? 4 : 3;
    this.chart = song.charts[mode];

    this.notes = [];
    this._flatten();
    this.idxHead = 0;

    this.started = false;
    this.paused = false;
    this.finished = false;
    this.elapsed = 0;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.life = RULES.LIFE_START;
    /* 静帧（?still）用于和原版 0472 做逐像素对比：原版那一帧是刚开局、
     * 血条约 87.5%。静帧下自动判 MISS 会一路掉血，导致对比不可比，
     * 所以这里把血量钉死在 87.5%。**只影响静帧，不影响真实玩法。** */
    this._still = /[?&]still/.test(location.search);
    if (this._still) this.life = RULES.LIFE_START * 0.875;
    this.stats = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.held = [false, false, false, false];
    this.holdNotes = [null, null, null, null];   // 正在长按的 note

    this.fx = [];            // 打击特效
    this.judgeFx = null;
    this.laneFlash = [0, 0, 0, 0];

    this.audio = new cc.Audio('assets/songs/' + song.id + '/music.mp3');
    this.audio.setVolume(0.9);
    GUI.preload();

    // 原版演奏背景层：直接执行曲包里的 config.lua（cocos2d-iPhone 1.x Lua 绑定）
    // 连击阈值是原生代码调用的，IPA 里没有对应数值，这里先按火焰特效阈值对齐
    this._luaSpecial = false;
    this._loadLuaBack();

    // 原版演奏页 HUD 贴图（这两张是裸图，不在图集里）
    var base = 'assets/songs/' + song.id + '/';
    this.hud = {
      title: cc.Sprite.createFromFile(base + 'musicname.png'),
      star: cc.Sprite.createFromFile(base + 'starhead.png')
    };

    this._countdown = 0;
    this._wallStart = 0;
    // 调试：?auto=1 自动打点，用于验证判定链路
    this._still = /[?&]still/.test(location.search);
    cc._luaStill = this._still;   // 静帧时冻结背景 Lua 层的滚动（见 cocos2d_lua.js tick）
    this.auto = /(^|[?&])auto=1/.test(location.search);
    var sm = /[?&]step=(\d+)/.exec(location.search);
    this.fixedStep = sm ? Number(sm[1]) : 0;
  }
  GameLayer.prototype = Object.create(cc.Layer.prototype);
  GameLayer.prototype.constructor = GameLayer;

  GameLayer.prototype._flatten = function () {
    var src = this.chart.notes, out = [];
    for (var i = 0; i < src.length; i++) {
      var t = src[i][0], groups = src[i][1];
      for (var g = 0; g < groups.length; g++) {
        out.push({
          t: t, lane: groups[g][0], dur: groups[g][1],
          end: t + groups[g][1],
          judged: false, result: null, holding: false, holdDone: false
        });
      }
    }
    out.sort(function (a, b) { return a.t - b.t; });
    this.notes = out;
    this.total = out.length;
  };

  /* ------------------------------------------------------------ 生命周期 */
  GameLayer.prototype._loadLuaBack = function () {
    if (typeof cc.LuaBackLayer !== 'function') return;   // lua.js 未加载时静默跳过
    var self = this;

    /* ★ 优先用内联的 config.lua 原文（js/lua_src.js）。
     *   以前只走 XHR，用 file:// 双击 index.html 打开时会被跨域策略拦掉，
     *   背景层永远不 ready → 退化成"封面 cover 放大"，F.I.R. 那首（1_1.png
     *   只有 116×50 的乐队 logo）会糊成一屏白色竖条。内联后不受协议限制。 */
    var inline = window.LUA_SRC_2013 && window.LUA_SRC_2013[this.song.id];
    if (inline) {
      self.lua = cc.LuaBackLayer('assets/songs/' + self.song.id, inline);
      return;
    }

    var url = 'assets/songs/' + this.song.id + '/config.lua';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function () {
      if (xhr.status !== 200 && xhr.status !== 0) return;
      self.lua = cc.LuaBackLayer('assets/songs/' + self.song.id, xhr.responseText);
    };
    xhr.onerror = function () { /* 拿不到就退回纯色背景，不阻塞游戏 */ };
    xhr.send();
  };

  GameLayer.prototype._syncLuaState = function () {
    if (!this.lua) return;
    var want = this.combo >= RULES.FLAME_COMBO ? 'special' : 'common';
    if (want !== this._luaSpecial) {
      this._luaSpecial = want;
      this.lua.setState(want);
    }
  };

  GameLayer.prototype.onEnter = function () {
    this.audio.play();
    this._wallStart = performance.now();
    this.started = true;
  };

  GameLayer.prototype.onExit = function () {
    this.audio.pause();
    if (this.lua && this.lua.dispose) this.lua.dispose();
  };

  // 游戏时钟优先用音频 currentTime（音画同步），
  // 音频没起播 / 被系统静音设备卡住 / 被自动播放策略拦下时退回墙钟，保证还能玩
  GameLayer.prototype.now = function () {
    var wall = performance.now() - this._wallStart;
    var at = this.audio.getTimeMs();
    if (this.audio.el.paused || !(at > 0)) return wall;
    return at;
  };

  /* ---------------------------------------------------------------- 主循环 */
  GameLayer.prototype.update = function (dt) {
    if (this.paused || this.finished) return;
    var now;
    if (this.fixedStep) {                     // 调试：?step=16 定步长推进，便于无头回归
      this._simT = (this._simT || 0) + this.fixedStep;
      now = this._simT;
    } else {
      now = this.now();
    }
    this._now = now;

    // 原版 Lua 背景层的调度器 / 动作推进
    if (this.lua) this.lua.update(dt);

    // 自动演奏
    if (this.auto) {
      for (var ai = this.idxHead; ai < this.notes.length; ai++) {
        var an = this.notes[ai];
        if (an.t > now + 20) break;
        if (!an.judged && an.t <= now + 8) {
          this.press(an.lane);
          this.release(an.lane);
          if (an.dur > 0) this.held[an.lane] = true;   // 长按保持到尾巴
        }
      }
    }

    // 自动漏判
    while (this.idxHead < this.notes.length) {
      var n = this.notes[this.idxHead];
      if (n.t + RULES.MISS < now) {
        if (!n.judged) this._applyJudge(n, 'MISS', 0);
        this.idxHead++;
      } else break;
    }

    // 长按尾巴判定
    for (var l = 0; l < 4; l++) {
      var hn = this.holdNotes[l];
      if (!hn) continue;
      if (!this.held[l]) {
        // 提前松手
        if (!hn.holdDone) { hn.holdDone = true; this._degradeToMiss(hn); }
        this.holdNotes[l] = null;
      } else if (now >= hn.end) {
        hn.holdDone = true;
        this.holdNotes[l] = null;
      }
    }

    // 特效衰减
    for (var i = this.fx.length - 1; i >= 0; i--) {
      this.fx[i].age += dt;
      if (this.fx[i].age > 0.45) this.fx.splice(i, 1);
    }
    if (this.judgeFx) {
      this.judgeFx.age += dt;
      if (this.judgeFx.age > 0.6) this.judgeFx = null;
    }
    for (var k = 0; k < 4; k++) this.laneFlash[k] = Math.max(0, this.laneFlash[k] - dt * 4);

    // 结束判定
    var durMs = this.audio.getDurationMs();
    var tailMs = Math.max(this.chart.last, this.total ? this.notes[this.notes.length - 1].end : 0);
    if (this.audio.isEnded() || (durMs && now > durMs + 300) || now > tailMs + 2500) {
      this._finish();
    }
  };

  GameLayer.prototype._finish = function () {
    if (this.finished) return;
    this.finished = true;
    this.audio.pause();
    var res = this.buildResult();
    /* ★ 官方 0480 的结算页**保留了游戏画面的最后一眼**（歌手照 + HUD 都在），
     *   而不是换一张雪花底图。这里在切场景前把当前画布抓成一张快照带过去，
     *   结算页把它铺在背景层，就得到和原版一样的效果。 */
    var snap = null;
    try { snap = cc.Director.canvas.toDataURL('image/png'); } catch (e) { snap = null; }
    cc.Director.replaceScene(cc.SceneResult(this.song, this.mode, res, snap));
  };

  /* ---------------------------------------------------------------- 判定 */
  GameLayer.prototype.press = function (lane) {
    if (this.paused || this.finished || lane < 0 || lane >= this.laneCount) return;
    this.held[lane] = true;
    this.laneFlash[lane] = 1;
    var now = this._now || this.now();

    // 窗口内找该轨道最近的未判定音符
    var best = null, bestDt = 1e9;
    for (var i = this.idxHead; i < this.notes.length; i++) {
      var n = this.notes[i];
      if (n.t > now + RULES.MISS) break;
      if (n.judged || n.lane !== lane) continue;
      var d = Math.abs(n.t - now);
      if (d < bestDt) { bestDt = d; best = n; }
    }
    if (best && bestDt <= RULES.MISS) {
      var r = bestDt <= RULES.PERFECT ? 'PERFECT'
        : bestDt <= RULES.GREAT ? 'GREAT'
          : bestDt <= RULES.GOOD ? 'GOOD' : 'MISS';
      best.judged = true;
      this._applyJudge(best, r, bestDt);
      if (best.dur > 0 && r !== 'MISS') {
        best.holding = true;
        this.holdNotes[lane] = best;
      }
    }
    this._spawnFx(lane);
  };

  GameLayer.prototype.release = function (lane) {
    if (lane < 0 || lane >= 4) return;
    this.held[lane] = false;
  };

  GameLayer.prototype._mult = function () {
    for (var i = 0; i < RULES.MULT.length; i++) {
      if (this.combo >= RULES.MULT[i][0]) return RULES.MULT[i][1];
    }
    return 1;
  };

  GameLayer.prototype._applyJudge = function (n, result, dtMs) {
    n.result = result;
    this.stats[result] = (this.stats[result] || 0) + 1;
    if (result === 'MISS') {
      this.combo = 0;
      this.life += RULES.LIFE_MISS;
      /* 原版漏打扣固定分（见 RULES.PENALTY_MISS 注释），且**允许负数**：
       * 0472 开局就是 −30，之后才慢慢涨回正数。 */
      this.score -= RULES.PENALTY_MISS;
      this._syncLuaState();
    } else {
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this._syncLuaState();
      this.score += Math.round(RULES.BASE[result] * this._mult());
      this.life += result === 'PERFECT' ? RULES.LIFE_PERFECT
        : result === 'GREAT' ? RULES.LIFE_GREAT : 0;
    }
    if (this.life > RULES.LIFE_START) this.life = RULES.LIFE_START;
    this.judgeFx = { kind: result, age: 0, dt: dtMs, lane: (n && n.lane != null) ? n.lane : -1 };
    if (this.life <= 0) this._fail();
  };

  GameLayer.prototype._degradeToMiss = function (n) {
    if (n.result === 'MISS' || n.result === null) return;
    var old = n.result;
    this.stats[old] = Math.max(0, (this.stats[old] || 0) - 1);
    this.stats.MISS++;
    n.result = 'MISS';
    this.combo = 0;
    this._syncLuaState();
    /* 判好又被降级成 MISS：先撤掉原来的加分，再按漏打档扣（可负）。 */
    this.score -= Math.round(RULES.BASE[old] * 1) + RULES.PENALTY_MISS;
    this.judgeFx = { kind: 'MISS', age: 0, dt: 0, lane: n.lane };
    this.life += RULES.LIFE_MISS;
    if (this.life <= 0) this._fail();
  };

  GameLayer.prototype._fail = function () {
    if (this.failed) return;
    this.failed = true;
    this._finish();
  };

  GameLayer.prototype._spawnFx = function (lane) {
    this.fx.push({
      x: laneXAt(lane, this.laneCount, HIT_Y), y: HIT_Y,
      lane: lane, age: 0
    });
  };

  /* ---------------------------------------------------------------- 成绩 */
  GameLayer.prototype.buildResult = function () {
    var total = this.total || 1;
    var hits = this.stats.PERFECT + this.stats.GREAT + this.stats.GOOD;
    var acc = hits / total * 100;                       // 正确率
    var perfectRate = this.stats.PERFECT / total * 100;
    var missRate = this.stats.MISS / total * 100;
    return {
      score: this.score,
      combo: this.maxCombo,
      total: this.total,
      stats: this.stats,
      acc: acc,
      perfectRate: perfectRate,
      missRate: missRate,
      failed: !!this.failed,
      mode: this.mode,
      songId: this.song.id
    };
  };

  /* ---------------------------------------------------------------- 绘制 */
  GameLayer.prototype.draw = function (ctx) {
    var now = this._now || 0;
    var N = this.laneCount;

    /* ---- ① 顶栏（整屏坐标 0~GAME_TOP）：深蓝渐变 + 官方 logo ----
     * 0471 实测：y0~52 是 #00001B 纯色，52~88 渐隐到黑。
     * logo 是官方 _logo_crop.png（600×128 @2x → 300×64 逻辑），
     * 位置 x160 居中 / y26，与原版重合。
     *
     * ★ GAME_TOP = 0 时整条顶栏不画：当前设计分辨率就是 320×480（没有 88 的
     *   状态栏区），硬画 logo 会变成"一条青字浮在歌手脸上"。以前这里只判了
     *   GUI.ok('logo')，logo 会被随后铺满的 Lua 背景盖住，所以平时看不出来；
     *   一旦背景走 fallback（半透明），logo 就露出来了 —— 就是这么发现的。 */
    var topH = GAME_TOP;
    if (topH > 0) {
      var g1 = ctx.createLinearGradient(0, 0, 0, topH);
      g1.addColorStop(0.00, '#00001B');
      g1.addColorStop(0.59, '#00001B');   // 52/88
      g1.addColorStop(0.78, '#00000E');
      g1.addColorStop(1.00, '#000000');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, W, topH);
      if (GUI.ok('logo')) {
        var lg = GUI.img('logo');
        ctx.drawImage(lg, (W - lg.width / 2) / 2, 26, lg.width / 2, lg.height / 2);
      }
    }

    /* ---- ② 游戏区：整体下移 GAME_TOP，之后所有旧坐标都无需改动 ---- */
    ctx.save();
    ctx.translate(0, GAME_TOP);

    // 原版 config.lua 搭的背景层（在轨道之下，轨道是半透明的会透出背景）
    /* 注意：lua.draw 内部已按 480 高做 cocos(y向上)→canvas(y向下) 翻转，
     * 直接用游戏区坐标，**不要**再补 88 偏移（补了会把歌手照顶到天上去）。 */
    if (this.lua && this.lua.ready && this.lua.draw) {
      try {
        this.lua.draw(ctx);
      } catch (e) {
        /* Lua 背景单帧异常不要连累整页（会连带轨道/音符一起黑掉） */
        console.error('[LuaBackLayer] draw 失败:', e);
      }
    } else {
      /* Lua 未就绪的兜底：**不要再把封面 cover 放大到满屏**。
       * 1_1.png 是各曲包的封面/logo 图，尺寸差得很远（F.I.R. 那首只有
       * 116×50 的乐队 logo），cover 放大 9.6 倍后会糊成一屏白色竖条。
       * 这里改成：深色渐变打底 + 封面按 contain 居中、最大只放大到 1 倍，
       * 既不会黑屏，也不会喧宾夺主。 */
      var bgGrad = ctx.createLinearGradient(0, 0, 0, H - GAME_TOP);
      bgGrad.addColorStop(0, '#0a1826');
      bgGrad.addColorStop(0.55, '#122c40');
      bgGrad.addColorStop(1, '#08131d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H - GAME_TOP);

      var art = cc.TextureCache.addImage('assets/songs/' + this.song.id + '/1_1.png');
      if (art && art.complete && art.naturalWidth) {
        var gw = W, gh = H - GAME_TOP;
        var sc = Math.min(1, Math.min(gw * 0.86 / art.naturalWidth, gh * 0.86 / art.naturalHeight));
        var dw = art.naturalWidth * sc, dh = art.naturalHeight * sc;
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.drawImage(art, (gw - dw) / 2, (gh - dh) / 2, dw, dh);
        ctx.restore();
      }
    }

    this._drawTopBar(ctx, N);
    this._drawStage(ctx, N);
    this._drawTrack(ctx, N);
    this._drawHitLine(ctx, N);
    /* ?still 用于和原版截图逐像素比对：原版 0471 是开局瞬间，画面里没有音符
     * 也没有 MISS 飘字，所以静帧模式下不画这些运行态元素。 */
    if (!this._still) {
      this._drawNotes(ctx, N, now);
      this._drawFx(ctx);
    }
    this._drawHud(ctx, N);
    /* 判定文字最后画，保证它压在音符之上（之前会被落点附近的音符盖住）。 */
    if (!this._still) this._drawJudgeText(ctx);

    ctx.restore();
  };

  /* ---------------------------------------------------------------- 顶栏 */
  /* 顶栏已上移到 draw() 里用整屏坐标画（见 GAME_TOP），这里保留空实现。 */
  var TOPBAR_H = 30;

  GameLayer.prototype._drawTopBar = function (ctx, N) {
    /* 游戏区内部**没有**额外的黑条 —— 两个 HUD 胶囊直接浮在背景图上。
     * 早先以为有 30 逻辑高的黑条，是把胶囊内部的黑色误当成了整条。 */
  };

  /* -------------------------------------------------------------- 轨道几何 */
  /* ============ 0471 逐像素测量（**最终**，全部换算到绘制坐标） ============
   *
   * 【坐标系】0471 原图 640×1136，y 0~176 是 iOS 状态栏 + 原版 logo，
   * 不在游戏画面内。游戏区 = y 176~1136（640×960 @2x）。
   * 绘制坐标：x 0~320 向右、Y 0~480 **向下**（Y = py/2，py 是 _g471.png 行号）。
   * ★ 之前所有测量用的是 (960−py)/2（从底向上），方向反了 —— 已全部换算。
   *
   * 【1】主轨间距（三条主轨白线间距，实测）
   *   Y=300 → 109.5    Y=330 → 132.75
   *   Y=360 → 157.25   Y=380 → 171.75
   *   拟合 D(Y) = 0.783503·Y − 125.537
   *   → D=0 在 **Y = 160.23**，即消失点在屏幕上方 1/3 处，
   *     轨道从这里向下张开（和原版观感一致：顶部收拢、底部铺开）。
   *
   * 【2】5 条黑带（y=330 实测中心）：7.0 / 93.0 / 159.2 / 226.8 / 309.0
   *   相邻中心距 ≈ 75.5，三条主轨间距 132.75 → 比值 1.7583
   *
   * 【3】黑带全宽（中间那条，实测 Y=260~335 共 11 点）
   *   Y=260→18.0  Y=275→22.5  Y=290→26.5  Y=305→31.5  Y=320→36.5  Y=335→40.5
   *   拟合 W(Y) = 0.30364·Y − 61.059
   *   （W=0 在 Y=201，即轨道在紫盘上沿附近是"零宽"，往下慢慢长出来）
   *
   * 【4】轨道纵向起点：实测 Y=260 才出现三条 ~18 宽的细带，
   *   Y=252.5 之前完全没有黑带（那一带是紫盘盘面）。
   *   → 轨道从 **Y=252** 开始长，到 Y=335 已有 40 宽，到屏底约 62 宽。
   *
   * 【5】白线全宽（实测）
   *   Y=300 → 3.0   Y=340 → 4.0   Y=380 → 4.5   Y=395 → 5.0
   *   拟合 L(Y) = 0.019771·Y − 2.869
   *
   * 【6】三键中轨白带全宽（实测）
   *   Y=290 → 4.0   Y=340 → 7.0   Y=380 → 10.0   Y=390 → 11.0
   *   拟合 M(Y) = 0.069355·Y − 16.274
   */
  var VAN_X = 160;
  var VAN_Y = 160.23;             // 消失点（绘制坐标 Y，向下）—— 在屏幕上方
  /* 主轨间距改按官方 Line.png 实测：sprite 第 80 行 55.75、第 180 行 94.5，
   * 斜率 0.3875；sprite 顶在 canvas y=224 → M(Y) = 0.3875·Y − 62.09。
   * （旧值 0.783503/−125.537 恰好是它的 2 倍，会让音符横向摊开一倍。） */
  var SPACING_SLOPE = 0.38775;
  var SPACING_BIAS = -62.09;
  var BAND_RATIO = 1.7583;        // 黑带中心距 = 主轨间距 / BAND_RATIO

  /* 三条主轨在 Y 处的间距 */
  function mainSpacing(Y) {
    var d = SPACING_SLOPE * Y + SPACING_BIAS;
    return d > 0 ? d : 0;
  }
  /* 第 lane 条（共 N 条主轨）在 Y 处的中心 x */
  function laneXAt(lane, N, Y) {
    return VAN_X + (lane - (N - 1) / 2) * mainSpacing(Y);
  }
  /* 半宽（音符缩放用） */
  function laneHalfAt(N, Y) {
    return mainSpacing(Y) * 0.5;
  }
  /* 5 条黑带中心距 */
  function bandSpacing(Y) {
    return mainSpacing(Y) / BAND_RATIO;
  }
  /* 黑带全宽 */
  function bandWidth(Y) {
    var w = 0.30364 * Y - 61.059;
    return w > 1.0 ? w : 1.0;
  }
  /* 白线全宽 */
  function lineWidth(Y) {
    var w = 0.019771 * Y - 2.869;
    return w > 0.9 ? w : 0.9;
  }
  /* 三键中轨白带全宽 */
  function midBandWidth(Y) {
    var w = 0.069355 * Y - 16.274;
    return w > 1.2 ? w : 1.2;
  }

  /* ------------------------------------------------ Tail 贴图（轨道本体） */
  /* AllPic01.png 的 Tail001-008：47x480 竖直光柱，顶端宽、向下收成锥形尖。
   * 四条普通态（青/粉/绿/紫）配 Ball001-004，四条金色系配 Ball005-008。
   * 原版把这张竖条按透视**横向缩放**贴进梯形轨道里：顶部窄、底部宽。 */
  var TAIL_FRAMES = ['Tail001.png', 'Tail002.png', 'Tail003.png', 'Tail004.png',
    'Tail005.png', 'Tail006.png', 'Tail007.png', 'Tail008.png'];

  GameLayer.prototype._tailFrame = function (lane) {
    /* ★ 官方 0482 里的长按光柱是**白色 + 蓝边**，实测就是 `Tail001.png`
     *   （中心 rgba(232,232,254) 近白、两侧 rgba(99,205,255) 青蓝发光边）。
     *   Tail002/003/004 分别是 橙粉 / 青绿 / 紫，是原版给其它轨道准备的配色，
     *   但用户在 0482 上认的就是这条白的 —— 所以统一用 Tail001，
     *   避免出现「一会儿白一会儿橙」的观感。 */
    return 'Tail001.png';
  };

  /* 轨道绘制：按透视梯形铺 Tail 光柱。
   * 每根轨道分成若干横切片（slice），逐片按该高度的半宽缩放 Tail 的对应部分，
   * 这样既有贴图的竖直渐隐质感，又有真实的透视收束。 */
  var TRACK_SLICES = 48;    // 纵向切片数，越多越平滑

  /* -------------------------------------------------------------- 舞台背景 */
  /* 0471 逐像素扫描结果（canvas 320×480，y 向下）：
   *
   *  【蓝色地面】不是"紫盘下沿到屏幕底的矩形"，而是**紫盘本身的下半部**：
   *     x=320 处蓝色从 py=468 开始；x=30 从 py=580 开始（那一带被紫盘边缘挡）；
   *     x=610 从 py=560 开始。也就是紫盘椭圆的下半部分直接就是蓝色地面，
   *     没有分界线 —— 紫盘上沿是紫色，往下渐变成青蓝色，一直铺到屏幕底。
   *     采样：py=250 (112,119,151) → py=210 (140,154,162) → py=183 (224,225,225)
   *     注意：**越往下越亮**，和常见的"越远越暗"相反，这是原版的美术。
   *
   *  【紫盘】椭圆，横跨整屏（x 0~320 全宽），
   *     x=320: 紫顶 py≈437（深紫 46,49,76），中部转蓝
   *     x=30 : 紫顶 py≈489（83,58,76），紫底 py≈550
   *     x=610: 紫顶 py≈491（51,24,53），紫底 py≈547
   *     y=245 横扫：紫色从 x≈26 一直到 x≈289（中间被黑轨打断）
   *     → 圆心 (160, 268)、rx 165（超出屏宽，被裁）、ry 55
   *     盘面是**暗紫**，不是亮紫；中心区域被 5 条黑轨压住。
   *
   *  【人群剪影】紫盘下方左右两侧，举起的手臂，深蓝近黑，只有剪影。
   *
   * 结论：地面 + 紫盘可以合成**一个**椭圆：
   *   圆心 (160, 268)，rx 168，ry 240 —— 上半是紫，下半渐变成青蓝。
   *   这样上下沿都是同一椭圆弧，和原版一致。
   */
  /* -------------------------------------------------------------- 舞台
   * 0471 逐像素实测（逻辑坐标，Y 向下）：
   *   紫盘外沿椭圆：x=0 处上沿 Y=252、x=40→240.5、x=80→228.5、x=610→242.5
   *     拟合圆心 (160, 326)、rx 220、ry 107.5 → 中心列上沿 218.5 ✓
   *     左右边缘的紫色竖条 Y 252~277 = 椭圆厚壁（盘壁），不是两块色斑。
   *   盘内蓝色地面：中心列 Y≈232 起变蓝；x=560 列 Y305 (0,34,53) →
   *     Y385 (0,100,152)，即**越往下越亮**，底色 #006498。
   *     拟合内椭圆 (160,326) rx 185 ry 94（x=0 处地面 278~327）。
   *   盘壁高光：x=80 列 Y245 (167,147,178)、Y255 (194,191,210)，浅紫灰粗弧。
   *   白色斜块两块：约 (110~126, 229~241)、(248~264, 233~245)，平行四边形。
   *   人群剪影：Y 268~340，左侧 x 0~125、右侧 x 195~320，深藏青，
   *     只有头+举起的细手臂，不是两根大黑柱（之前画得过大）。
   */
  /* -------------------------------------------------------------- 舞台
   * 原版就是这么叠的：紫盘 → 蓝色光锥 → 人群 → 轨道 → 判定盘。
   * 全部直接贴官方 sprite，1:1 逻辑像素，不再程序化重画：
   *   stage_disc = StageLight002 wg0011（320x166）紫盘本体，盘顶弧 Y=262
   *   down_bg    = DownBG02_0001（320x280）蓝色光锥地面，盖住盘心
   *   people1    = People0001（320x206）左右人群剪影
   * 位置由「官方 sprite 在 0471 上做内点率模板匹配」反推：
   *   紫盘顶弧逐列拟合 中心列 Y=262、边缘 Y=228（落差 34px，与原 sprite
   *   顶弧 profile 完全一致 → 无缩放）；蓝色区域上沿 Y≈227 → down_bg 顶 Y=300。
   */
  GameLayer.prototype._drawStage = function (ctx, N) {
    /* ★ 层序（实测唯一正确的一种，换任何其他次序 mean diff 都会跳升）：
     *     紫盘 stage_disc → 人群 people1 → 蓝色地面 down_bg
     *   换成「蓝→人群→紫盘」：17.6 → 25.0
     *   换成「紫→蓝→人群」：17.6 → 47.9
     * down_bg 是半透明蓝雾，盖在人群上才能出官方那种
     * 「手臂上半清晰、往下逐渐被蓝雾吃掉」的层次。 */
    var sd = GUI.img('stage_disc');
    if (GUI.ok('stage_disc')) {
      ctx.drawImage(sd, UI_POS.stage_disc.x, UI_POS.stage_disc.y,
                    sd.width * UI_POS.stage_disc.sx,
                    sd.height * UI_POS.stage_disc.sy);
    }

    var pp = GUI.img('people1');
    if (GUI.ok('people1')) {
      ctx.save();
      ctx.globalAlpha = UI_POS.people1.alpha;
      ctx.drawImage(pp, UI_POS.people1.x, UI_POS.people1.y,
                    pp.width * UI_POS.people1.sx, pp.height * UI_POS.people1.sy);
      ctx.restore();
    }

    var db = GUI.img('down_bg');
    if (GUI.ok('down_bg')) {
      ctx.drawImage(db, UI_POS.down_bg.x, UI_POS.down_bg.y,
                    db.width * UI_POS.down_bg.sx, db.height * UI_POS.down_bg.sy);
    }
  };

  /* 一组举手人群剪影：小圆头 + 两根细手臂 + 半身块。
   * 原版 0471 里每个剪影总高约 40~70 逻辑，头宽 10~14，手臂笔直上举。 */
  function drawCrowd(ctx, x0, yBase, w, h, seed) {
    var n = 5, i;
    ctx.save();
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var t = (i + 0.5) / n;
      var bx = x0 + t * w;
      var hh = h * (0.55 + 0.45 * Math.abs(Math.sin((i + seed) * 2.1)));
      var hr = 5.2 + (i % 2) * 1.2;                 // 头半径 5~6.4
      var headY = yBase - hh * 0.48;
      var bodyTop = headY + hr * 0.85;
      // 身体：上窄下宽的梯形，一直铺到 yBase 以下
      ctx.moveTo(bx - hr * 1.5, yBase + 26);
      ctx.lineTo(bx - hr * 1.05, bodyTop);
      ctx.quadraticCurveTo(bx, bodyTop - hr * 0.5, bx + hr * 1.05, bodyTop);
      ctx.lineTo(bx + hr * 1.5, yBase + 26);
      ctx.closePath();
      // 头
      ctx.moveTo(bx + hr, headY);
      ctx.arc(bx, headY, hr, 0, Math.PI * 2, true);
      // 左臂（细长，略外张）
      var aw = 2.4, lean = (i % 2 ? -1 : 1) * 3.2;
      ctx.moveTo(bx - hr * 0.85, bodyTop + 2);
      ctx.lineTo(bx - hr * 0.85 + lean, headY - hh * 0.46);
      ctx.lineTo(bx - hr * 0.85 + lean + aw, headY - hh * 0.46);
      ctx.lineTo(bx - hr * 0.85 + aw, bodyTop + 2);
      // 右臂
      ctx.moveTo(bx + hr * 0.55, bodyTop + 2);
      ctx.lineTo(bx + hr * 0.55 + lean * 0.6, headY - hh * 0.40);
      ctx.lineTo(bx + hr * 0.55 + lean * 0.6 + aw, headY - hh * 0.40);
      ctx.lineTo(bx + hr * 0.55 + aw, bodyTop + 2);
    }
    ctx.fill();
    ctx.restore();
  }


  /* ---------------------------------------------------------------- 轨道 */
  /* 结构（_track_zoom.png 放大 2 倍确证）：蓝色地面 + **5 条放射黑楔** +
   * 每条中央一根白线。三条主轨承载音符，最外侧两条是被屏边裁掉的旁轨。
   *
   * 全部公式来自 0471 逐像素回归（见上方常量注释），vanish 在 Y=160：
   *   主轨间距 D(Y) = 0.783503·Y − 125.537
   *   黑带中心距    = D(Y) / 1.7583
   *   黑带全宽 W(Y) = 0.325·Y − 67.25
   *   白线全宽 L(Y) = 0.019771·Y − 2.869
   *   三键中轨白带  = 0.069355·Y − 16.274
   *
   * 纵向：从紫盘上沿（Y≈240）一路铺到屏底（Y=480）。
   */
  /* 黑带条数：原版 0471（3 键）实测只有 **3 条完整带**（x≈91/159/228 @Y=335）。
   * 最外侧那两条在原版里只是被屏边裁剩的残角，不是独立轨道 —— 之前画 5 条
   * 会在左右多出两条突兀的黑带。所以按 N 决定：3 键 3 条、4 键 4 条。
   *
   * 【关键】黑带的中心间距 ≠ 主轨间距。
   *   实测 Y=335：三条带中心 91.0 / 159.2 / 228.5 → 间距 68.5 / 69.3
   *   实测 Y=260：三条带中心 120.0 / 159.0 / 199.5 → 间距 39.0 / 40.5
   *   而同一高度的「三条主轨间距」（白线中心）在 Y=335 是 137 —— 差 2 倍。
   *   也就是说：**白色细线并不在黑带的正中央**，而是黑带内侧边缘的一部分；
   *   真正的黑带中心间距 = 主轨间距 / 2。
   *   实测拟合 bandSpacing(Y) = 0.39175·Y − 62.768（Y=260→39.1，Y=335→68.5）
   */
  var TRACK_BANDS_BY_N = { 3: 3, 4: 4 };

  /* 黑带中心间距（实测，独立于主轨间距） */
  function bandSpacing2(Y) {
    var d = 0.39175 * Y - 62.768;
    return d > 0 ? d : 0;
  }

  /* --------------------------------------------------------------- 轨道
   * 直接贴官方 Line.png（305x263，画布 320x280）。
   * 该 sprite 已经包含「3 条白轨 + 黑楔带 + 底部判定盘黑色底座 + 顶灯光束」，
   * 所以这里不再程序化画轨道，只要摆对位置即可。
   * 摆位：白轨在 sprite 第 80 行间距 55.75、第 180 行间距 94.5 →
   *       斜率 0.3875/行；sprite 顶在 canvas y=224 → 收敛点 canvas y≈160。
   */
  GameLayer.prototype._drawTrack = function (ctx, N) {
    /* ===== 用「白线斜率」反解 sprite 的精确摆放（比量 alpha 边界可靠得多）=====
     *
     * line.png 内部实测（305x263）：
     *   白线中心 x = 152.5（= 图宽/2），左右白线斜率 ±0.39
     *   y=80  → 左 97 / 中 152.5 / 右 208.5
     *   y=180 → 左 58 / 中 152.5 / 右 247.5
     *
     * 0471 截图（2 倍像素）逐行白线中心：
     *   y=620 → 左 202 / 中 319.5 / 右 437
     *   y=740 → 左 155.5 / 中 319.75 / 右 484
     *
     * 设 sprite 摆在 (X, Y0)、缩放 (sx, sy)，映射
     *   x_screen/2 = X + (152.5 ± 0.39·y_i)·sx，  y_screen/2 = Y0 + y_i·sy
     * 代入两组观测解得：
     *   sx = 0.9870   sy = 0.9934   X = 9.25   Y0 = 220.3
     * （即**接近 1:1**，只压了 1.3% / 0.7%。之前把它压到 sy=0.918 是错的：
     *   官方 0471 底部黑盘本来就一直延伸到屏幕最下缘、并且被裁掉一小截，
     *   「底部多一大条黑」不是 bug，是原版就这样。）
     *
     * 校验：sprite 底沿 = 220.3 + 263×0.9934 = 481.6，超出画布 1.6 —— 与原版一致。 */
    var img = GUI.img('line');
    if (!GUI.ok('line')) return;
    ctx.drawImage(img, UI_POS.line.x, UI_POS.line.y,
                  img.width * 0.9870, img.height * 0.9934);
  };

  /* --------------------------------------------------- 底部判定区（判定盘） */
  /* 0471 逐像素实测（canvas 320×480，y 向下）：
   *
   * 【横向椭圆，不是圆】沿 y=427（canvas）横剖白像素段：
   *   左盘：白 26~60 与 145~178  → 外沿 26~178，中心 102，rx 76
   *   中盘：白 220~265 与 381~427 → 外沿 220~427，中心 323.5，rx 103.5
   *   右盘：白 459~493 与 578~611 → 外沿 459~611，中心 535，rx 76
   *
   * 【竖直方向】各盘中心竖扫白像素极值：
   *   左/右盘 x=102/535：白 y 808~897 → 中心 852.5，ry 44.5
   *   中盘   x=320    ：白 y 760~913 → 中心 836.5，ry 76.5（含中心竖轴白条）
   *   → 换算逻辑（÷2）：左/右 rz 38 × 22.25；中 51.75 × 28（取盘环外沿）
   *   → 圆心 canvas y = 852.5/2 = 426.25，即逻辑 y = 480 − 426.25 = 53.75
   *
   * 【盘环结构】沿 y=427 横剖中盘（canvas 像素）：
   *   白 220~265(46) | 黑 266~380(115) | 白 381~427(47)
   *   中心轴白点：x=320 处 y 760~913 是一条**竖直白条**（宽 20px）
   *   所以盘是「粗白环 + 大面积黑盘心 + 竖直白轴条」，不是同心多环。
   *
   * 【黑色承托底板】y=440 处黑色横跨较大范围，y=420 处被白盘打断，
   *   而 x=10 从 y=353 起一直是蓝地面 —— 底板只盖住中间一段。
   *
   * 结论：N=3 时左右盘 rx 38 / ry 22.25，中间盘 rx 51.75 / ry 28；
   *       N=4 时按同等比例缩小并均分（原版 0472 为 4 键，等宽排列）。
   */
  /* ---- 判定盘位置（**绘制坐标 Y，向下**）实测 ----
   *   左/右盘：白 y 808~897px → Y 404~448.5，中心 Y=426.2，ry=22.25
   *            横剖中心 x=51 / x=267.5，rx=38
   *   中盘   ：白 y 760~913px → Y 380~456.5，中心 Y=418.2，ry=38.2
   *            横剖中心 x=161.75，rx=51.75
   */
  /* 判定盘几何（0471 逐像素实测，逻辑 = 截图 ÷ 2）：
   *
   *   左/右盘：白环 x 26~178 / y 808~897（截图）
   *            → 76x45 逻辑，中心 (51, 426.25) / (267.5, 426.25)，r=38 ry=22.5
   *   中盘   ：白环 x 220~427 / y 792~913
   *            → 103.5x61 逻辑，中心 (161.75, 426.25)，r=51.75 ry=30.5
   *
   * ★ 判定盘**必须程序化绘制**，不能贴 pad_lr/pad_m：
   *   那两张官方图的粗白环其实只有 7px 宽（是 LRTapPoint 的小标记），
   *   而原版判定盘的白环厚度是 35px（左盘）/ 46px（中盘），差了 5~7 倍。
   *   贴图只会得到「三个小细圈」，怎么调缩放都不像。
   */
  var PAD_R  = { 3: [38, 51.75, 38],      4: [30, 40, 40, 30] };
  var PAD_RY = { 3: [22.5, 30.5, 22.5],   4: [20, 26, 26, 20] };
  var PAD_Y  = { 3: [426.25, 426.25, 426.25], 4: [426.25, 426.25, 426.25, 426.25] };
  var PAD_CX = { 3: [51, 161.75, 267.5],  4: [39, 113, 207, 281] };

  /* ---- 判定盘的黑色承托底座（官方实测，必须程序补画）-------------------
   * line.png 自带的黑盘比官方**小一圈**，导致底部露出蓝色、左右盘下方缺一块，
   * 观感是「白盘浮在蓝天上」而不是「白盘嵌在黑底座里」。
   *
   * 关键：底座只比白盘**宽一圈**（横向 +5、纵向 +8 逻辑），圆心还要**下移 8**，
   * 所以顶部与白盘齐平、底部多出一截"裙边"。
   * 早先按同心大椭圆画（rx46/ry40、中盘 rx111）会糊成一片大黑兜，
   * 把三个盘之间的 V 形凹陷全填平 —— 和官方完全不像。
   *
   * 校验：左盘底座 (51,434) rx43 ry31 → 逻辑 y=458 时 x 23.8~78.2
   *       → 截图 47.6~156.4，实测 0471 y=916 黑区起点正是 47 ✓ */
  var PAD_BASE = {
    3: [[8, 43, 31], [8, 57.75, 37], [8, 43, 31]],
    4: [[6, 34, 26], [6, 42, 31], [6, 42, 31], [6, 34, 26]]
  };

  GameLayer.prototype._drawPadBase = function (ctx, cx, cy, dy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + dy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
  };

  GameLayer.prototype._padLayout = function (N) {
    var radii = PAD_R[N] || PAD_R[3];
    var rys = PAD_RY[N] || PAD_RY[3];
    var ys = PAD_Y[N] || PAD_Y[3];
    var cxs = PAD_CX[N] || PAD_CX[3];
    var out = [];
    for (var i = 0; i < N; i++) {
      out.push({ x: cxs[i], y: ys[i], r: radii[i], ry: rys[i] });
    }
    return out;
  };

  /* 判定盘：**粗白环 + 黑盘心 + 中心白轴**（0471 横剖实测）。
   * 参数：cx、cy 都是**绘制坐标**（y 向下），r 水平半径，ry 竖直半径。
   * 白环厚度 = r × 0.445（实测 46/103.5 ≈ 0.444）。 */
  GameLayer.prototype._drawPad = function (ctx, cx, cy, r, ry, lit, hue) {
    if (!ry) ry = r * 0.55;
    ctx.save();

    /* 1) 白色外盘（整块白椭圆打底，等会儿用黑盘心盖住中间） */
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';   // 0471 实测：白环是纯白 (255,255,255)，不是灰白
    ctx.fill();

    /* 2) 黑盘心：内缩到 r×0.555（实测白环内沿 265/220~427 → 半径占比 0.555） */
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.555, ry * 0.555, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';   // 0471 实测：盘心是纯黑 (0,0,0)
    ctx.fill();

    /* 3) 中心白核：0471 实测是**横向小胶囊**，不是圆点也不是竖条
     *    左/右盘 15x8（截图）→ 7.5x4 逻辑；中盘 21x13 → 10.5x6.5。
     *    用 r×0.10 / ry×0.10 即可同时命中两组。 */
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.10, ry * 0.10, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    /* 4) 命中高光：白环外沿一道轨道色辉光 */
    if (lit > 0.01) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = hue + (0.9 * lit) + ')';
      ctx.lineWidth = 3 * lit + 1;
      ctx.shadowColor = hue + '1)';
      ctx.shadowBlur = 16 * lit;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  };

  /* 判定盘：贴官方 LRTapPoint(90x53) / MTapPoint(121x72)。
   * 圆心与缩放全部由 0472 逐像素实测得到（截图像素 ÷2 = 逻辑坐标）。
   * 三个盘的**白像素包围盒**实测（截图 640x960 坐标）：
   *
   *   左 x 26~179  y 770~897  → 153x127，中心 (102.5, 833.5)
   *   中 x 220~427 y 800~913  → 207x113，中心 (323.5, 856.5)   ← 略高、更大
   *   右 x 459~611 y 770~897  → 152x127，中心 (535.0, 833.5)
   *
   * 逻辑坐标 = ÷2：
   *   左 (51.25, 416.75) 外沿 76.5x63.5 → sx=76.5/90=0.85  sy=63.5/53=1.198
   *   中 (161.75,428.25) 外沿 103.5x56.5 → sx=103.5/121=0.855 sy=56.5/72=0.785
   *   右 (267.5, 416.75) 外沿 76x63.5  → sx=76/90=0.844  sy=63.5/53=1.198
   *
   * 内芯（那个纯黑小椭圆）在**未命中时是黑的**，命中瞬间才染成轨道色 ——
   * 0472 里只有左盘内芯是青色的，中/右都是黑的，正好是「刚打完左边那一下」的状态。
   * 所以 PAD_TINT_3 不再是常驻颜色，而是命中辉光用的颜色。 */
  /* 0471 逐像素复测（**截图像素**，逻辑 = ÷2）：
   *
   *   左盘 白环包围盒 x27~178 (w152) / y795~896 (h102) → 逻辑 76×51, 圆心 (51.25, 422.75)
   *   中盘 白环包围盒 x250~399 (w150) / y795~913 (h119) → 逻辑 75×59.5, 圆心 (162.25, 427)
   *   右盘 白环包围盒 x459~611 (w153) / y795~896 (h102) → 逻辑 76.5×51, 圆心 (267.5, 422.75)
   *
   * 贴图原始尺寸：pad_lr 90×53、pad_m 121×72。
   *   左/右 sx = 76/90  = 0.844   sy = 51/53  = 0.962
   *   中   sx = 75/121 = 0.620   sy = 59.5/72 = 0.826
   *
   * 内芯（纯黑小椭圆）平时是黑的，命中瞬间才染成轨道色 ——
   * 0472 里只有左盘内芯是青色的，中/右都是黑的。 */
  /* ★★★ 判定盘几何：1:1 原始尺寸，不做任何缩放 ★★★
   *
   * 官方两张贴图的白环就是**逻辑像素尺寸**，直接贴即与 0471 完全重合：
   *   pad_lr.png (90x53)  白环 bbox x6~82 / y4~48  → 77 x 45
   *   pad_m.png  (121x72) 白环 bbox x8~111 / y5~66 → 104 x 62
   *
   * 0471 实测白环（截图像素 → 逻辑 = ÷2）：
   *   左/右盘 152x90 → 76x45   中心 (51, 426.25) / (267.5, 426.25)
   *   中盘    207x122 → 103.5x61 中心 (161.75, 426.25)
   *
   * 77≈76、45=45、104≈103.5、62≈61 —— 全部落在 1px 内，**无需缩放**。
   * （之前 sx/sy 反复调成 0.62~1.3，结果中盘只有原版 55%，
   *   看起来是「三个小圈」而不是「三个大盘」，这是最明显的观感差异。）
   *
   * 左上角 = 目标白中心 − 贴图内白中心：
   *   pad_lr 白中心 (44, 26)    → 左 (51−44, 426.25−26) = (7, 400.25)
   *                              → 右 (267.5−44, 426.25−26) = (223.5, 400.25)
   *   pad_m  白中心 (59.5, 35.5) → 中 (161.75−59.5, 426.25−35.5) = (102.25, 390.75)
   */
  var PAD_DRAW = [
    { img: 'pad_lr', x: 7.00, y: 400.25, lane: 0 },
    { img: 'pad_m', x: 102.25, y: 390.75, lane: 1 },
    { img: 'pad_lr', x: 223.50, y: 400.25, lane: 2 }
  ];
  /* 0472 实测的内芯染色值（左蓝 / 中粉 / 右绿）*/
  var PAD_TINT_3 = ['#55d9fa', '#ff6699', '#36e2ae'];
  GameLayer.prototype._drawHitLine = function (ctx, N) {
    var i;
    var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 240);

    if (N === 3) {
      /* ① 先铺三个黑色承托底座（比白盘大一圈，见 PAD_BASE 说明） */
      var base = PAD_BASE[3];
      for (i = 0; i < 3; i++) {
        this._drawPadBase(ctx, PAD_CX[3][i], PAD_Y[3][i], base[i][0], base[i][1], base[i][2]);
      }
      /* ② 再画白盘：三个判定盘全部程序化绘制（见 PAD_R 上方的说明：
       * 贴图白环只有 7px，和原版 35~46px 的粗白环差 5~7 倍，只能画）。 */
      for (i = 0; i < 3; i++) {
        var lit = this.laneFlash[i] || 0;
        this._drawPad(ctx, PAD_CX[3][i], PAD_Y[3][i], PAD_R[3][i], PAD_RY[3][i],
                      lit, LANE_GLOW[i % 4]);
      }
      return;
    }

    /* 4 键：同样先铺黑底座 */
    var base4 = PAD_BASE[4] || PAD_BASE[3];
    for (i = 0; i < N; i++) {
      this._drawPadBase(ctx, PAD_CX[4][i], PAD_Y[4][i], base4[i][0], base4[i][1], base4[i][2]);
    }

    /* 4 键：官方 UILine2 的 TapPoint 是 86x54 的方盘，这里按 4 等分铺开 */
    for (i = 0; i < N; i++) {
      var cx4 = laneXAt(i, N, 400);
      img = GUI.img('pad_lr');
      if (!GUI.at(ctx, 'pad_lr', cx4 - img.width / 2, 402)) continue;
      var lit4 = Math.max(this.laneFlash[i], 0.10 * pulse);
      if (lit4 > 0.02) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx4, 402 + img.height / 2, img.width / 2, img.height / 2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = LANE_GLOW[i % 4] + (0.75 * lit4) + ')';
        ctx.lineWidth = 1 + 3 * lit4;
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  GameLayer.prototype._drawNotes = function (ctx, N, now) {
    var T = RULES.TRAVEL_MS;

    var drawList = [];
    for (var i = 0; i < this.notes.length; i++) {
      var n = this.notes[i];
      var u = 1 - (n.t - now) / T;
      if (u < -0.06) continue;
      if (u > 1.35) continue;
      if (n.judged && n.result === 'MISS' && u > 0.98) continue;
      if (n.judged && u > 1.02) continue;
      drawList.push({ n: n, u: u });
    }
    // 远的先画（u 小的在上方，先画），保证近处音符盖住远处
    drawList.sort(function (a, b) { return a.u - b.u; });

    for (var j = 0; j < drawList.length; j++) {
      var it = drawList[j], nn = it.n, uu = it.u;
      var flame = this.combo >= RULES.FLAME_COMBO;
      // 长按音符先画尾部光束（在音符之下）
      if (nn.dur > 0) this._drawHoldBeam(ctx, nn, N, now, T);

      // 音符位置：u=1 落在唱片盘上沿的高度，之后继续往下淡出
      var y = yOfU(uu);
      // 透视：x 按当前高度的半宽定位，尺寸也按半宽等比缩放
      var x = laneXAt(nn.lane, N, Math.max(TRACK_TOP, Math.min(y, PAD_HIT_Y + 40)));
      var alpha = 1;
      if (uu > 1) alpha = Math.max(0, 1 - (uu - 1) / 0.30);
      if (uu < 0) alpha = Math.max(0, 1 + uu / 0.06);

      var idx = (flame ? 5 : 1) + (nn.lane % 4);
      var frame = 'Ball00' + idx + '.png';
      if (!cc.SpriteFrameCache.has('notes', frame)) frame = 'Ball001.png';

      // 先画音符下方的拖尾光
      this._drawTrail(ctx, nn, N, uu, alpha);

      /* 音符尺寸（0472 实测）：
       *   notes.png 的 Ball001 裁剪框 [1,401,92,64]，原框 100×100，
       *   即贴图内容占原框宽的 92%。
       *   截图 0472 里判定线附近音符的**白环外沿**宽 90px = 逻辑 45，
       *   所以缩放 s = 45 / (100 × 0.92) ≈ 0.49。
       *   透视：远处（y 高）略小但不要太小 —— 原版远处音符只缩到约 0.80。
       *   之前按 (hwHere / hwHit) 线性缩放会让顶部音符缩到 0.2，太小了。 */
      var hwHere = laneHalfAt(N, Math.max(TRACK_TOP, Math.min(y, PAD_HIT_Y)));
      var hwHit = laneHalfAt(N, PAD_HIT_Y);
      var ratio = (hwHit > 0) ? (hwHere / hwHit) : 1;
      var s = 0.49 * (0.80 + 0.20 * cc.clamp(ratio, 0, 1.4));
      this._blit(ctx, 'notes', frame, x, y, s, alpha);

      // 长按进行中：在身上叠一层脉动光
      if (nn.holding && nn.holdDone === false) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(performance.now() / 90);
        ctx.beginPath();
        var hwp = laneHalfAt(N, Math.max(TRACK_TOP, Math.min(y, PAD_HIT_Y)));
        ctx.ellipse(x, y, hwp * 0.9, hwp * 0.34, 0, 0, Math.PI * 2);
        ctx.fillStyle = LANE_GLOW[nn.lane % 4] + '0.7)';
        ctx.fill();
        ctx.restore();
      }
    }
  };

  /* 图集帧绘制：按「原框 ow/oh + 裁剪偏移 left/top」摆位，
   * 语义与 cocos2d 的 SpriteFrame 一致。
   *
   * 注意单位不一致：cc.SpriteFrameCache 里 left/top 已经是**像素**（由
   * (ow-w)/2+ox 直接算出），而 ow/oh 也是像素；这里乘 scale 把它们一起缩。
   * 但 ox/oy 在 plist 里是**以原点框中心为基准、y 向上**的偏移，
   * 换算到画布（y 向下）就是 top = (oh-w)/2 - oy —— FrameCache 里已经这样算了。 */
  GameLayer.prototype._blit = function (ctx, atlas, frameName, x, y, scale, alpha) {
    var f = cc.SpriteFrameCache.get(atlas, frameName);
    if (!f) return;
    var img = cc.TextureCache.get(f.png);
    if (!img || !img.complete || !img.naturalWidth) return;
    var ow = f.ow, oh = f.oh;
    var dw = ow * scale, dh = oh * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 原框中心对齐 (x,y)，裁剪图按 left/top 相对原框描点
    ctx.drawImage(img, f.x, f.y, f.w, f.h,
      x - dw / 2 + f.left * scale,
      y - dh / 2 + f.top * scale,
      f.w * scale, f.h * scale);
    ctx.restore();
  };

  /* 音符拖尾：0472 里音符是**一颗颗分离的圆盘，下方没有长条光柱**，
   * 只在自己身下留一小截很淡的同色光晕（长度约为音符直径的 0.6 倍）。
   * 之前 len=0.16 个行程拉出了长条，明显不符合原版。 */
  GameLayer.prototype._drawTrail = function (ctx, n, N, u, alpha) {
    if (u <= 0.02) return;
    var uu = Math.max(0, Math.min(u, 1.02));
    var len = 0.045;                       // 拖尾长度（u 为单位，约音符直径 0.6 倍）
    var u2 = Math.max(0, uu - len);
    if (uu - u2 < 0.004) return;

    var yA = yOfU(uu), yB = yOfU(u2);
    var x = laneXAt(n.lane, N, Math.max(TRACK_TOP, Math.min(yA, PAD_HIT_Y)));
    var y1 = yA, y2 = yB;
    var hw = laneHalfAt(N, Math.max(TRACK_TOP, Math.min(yA, PAD_HIT_Y))) * 0.24;
    var col = LANE_GLOW[n.lane % 4];
    var g = ctx.createLinearGradient(0, y1, 0, y2);
    g.addColorStop(0, col + (0.42 * alpha) + ')');
    g.addColorStop(1, col + '0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(x - hw, y2, hw * 2, y1 - y2);
    ctx.restore();
  };

  /* 长按音符的尾段光束：从当前头位置往上（更远的时间）拉一条竖光 */
  /* ---------------------------------------------------------- 长按光柱（面条）
   * ★★ 这就是官方 0482 里用户圈出来的那根「面条」。
   *
   *   官方**不是**程序画的渐变带，而是把图集里的 `Tail001~008.png`
   *   （47×480 的竖直光柱：中间半透明淡紫白、两侧青色发光边、底端收成锥形尖）
   *   按透视**逐片横切**贴进轨道里。所以颜色、玻璃质感、发光边全是官方像素。
   *
   *   之前我画的是三层渐变梯形（白雾 + 亮芯），做成了「白面条」——
   *   形状像了，但**质感完全不同**：官方是能透出背景的玻璃柱，我做成了实心白光。
   *
   *   映射关系：
   *     贴图的**锥形尖**要朝上（远端），平头朝下接判定盘
   *     → 目标 y=yTop（上）对应源 y=f.y+f.h（尖）
   *       目标 y=yBot（下）对应源 y=f.y（平头）
   *     宽度按 `bandWidth(Y) × 0.36`（半宽）随高度收窄，跟轨道黑带同比例。 */
  var BEAM_SLICES = 26;
  GameLayer.prototype._drawHoldBeam = function (ctx, n, N, now, T) {
    if (n.judged && n.result === 'MISS') return;
    var uHead = 1 - (n.t - now) / T;
    var uTail = 1 - (n.end - now) / T;
    uHead = Math.min(uHead, 1.0);
    uTail = Math.max(uTail, Math.min(uHead - 0.001, 0));
    if (uHead <= uTail) return;

    var yTop = Math.max(TRACK_TOP, yOfU(uTail));       // 远端（尾）
    var yBot = Math.min(yOfU(uHead), PAD_HIT_Y + 4);   // 近端（头，接判定盘）
    if (yBot - yTop < 2) return;

    var frame = this._tailFrame(n.lane);
    var f = cc.SpriteFrameCache.get('notes', frame);
    var img = f && cc.TextureCache.get(f.png);
    if (!f || !img || !img.complete || !img.naturalWidth) return;

    var hgt = yBot - yTop;
    var hh = hgt / BEAM_SLICES;
    /* 半宽随高度线性张开：顶端 15 → 底端 26（全宽 30 → 52 逻辑）。
     * 官方 0482 实测：光柱底部几乎和左侧判定盘一样宽（约 50 逻辑），
     * 顶部约 30 逻辑 —— 是一条明显的**上窄下宽锥形**，不是等宽带。 */
    function halfAt(t) { return 15 + 11 * t; }

    ctx.save();
    for (var i = 0; i < BEAM_SLICES; i++) {
      var t0 = i / BEAM_SLICES, t1 = (i + 1) / BEAM_SLICES;
      var ya = yTop + hgt * t0;
      var ym = ya + hh * 0.5;
      var tt = (ym - yTop) / hgt;
      var hw = halfAt(tt);
      var x = laneXAt(n.lane, N, ym);
      /* 源切片反向取：上（尖）→下（平头） */
      var sy = f.y + f.h * (1 - t1);
      var sh = f.h / BEAM_SLICES + 1;
      ctx.drawImage(img, f.x, sy, f.w, sh,
        x - hw, ya, hw * 2, hh + 1);
    }

    /* ★ 中心白芯：Tail 贴图本身是「淡紫白 + 青边」的玻璃，直接贴会发灰；
     *   官方 0482 里柱子中心是**亮白**的。这里沿同一条锥形再叠一层白色渐变
     *   （宽度取半宽的 0.52），顶淡底亮，中心才立得起来。 */
    var xT0 = laneXAt(n.lane, N, yTop), xB0 = laneXAt(n.lane, N, yBot);
    var hT0 = halfAt(0) * 0.52, hB0 = halfAt(1) * 0.52;
    ctx.beginPath();
    ctx.moveTo(xT0 - hT0, yTop);
    ctx.lineTo(xB0 - hB0, yBot);
    ctx.lineTo(xB0 + hB0, yBot);
    ctx.lineTo(xT0 + hT0, yTop);
    ctx.closePath();
    var wg = ctx.createLinearGradient(0, yTop, 0, yBot);
    wg.addColorStop(0.00, 'rgba(255,255,255,0)');
    wg.addColorStop(0.30, 'rgba(255,255,255,0.26)');
    wg.addColorStop(1.00, 'rgba(255,255,255,0.58)');
    ctx.fillStyle = wg;
    ctx.fill();
    ctx.restore();
  };

  /* 打击特效：判定处的扩散圆环（贴着唱片盘画的扁椭圆）
   * 0471/0472 里落点处没有大圆环，只有很小的一圈光晕，所以半径和持续时间
   * 都收小（之前 r 从 12 扩到 58，比唱片盘还大，太抢眼）。 */
  GameLayer.prototype._drawFx = function (ctx) {
    for (var i = 0; i < this.fx.length; i++) {
      var f = this.fx[i];
      var p = f.age / 0.34;
      if (p > 1) continue;
      var r = 10 + p * 24;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(f.x, Y(f.y), r, r * 0.46, 0, 0, Math.PI * 2);
      ctx.strokeStyle = LANE_GLOW[f.lane % 4] + (0.62 * (1 - p)) + ')';
      ctx.lineWidth = 2.6 * (1 - p) + 0.4;
      ctx.shadowColor = LANE_COLORS[f.lane % 4];
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    }
  };

  /* ---------------------------------------------------------------- HUD */
  /* 版式照截图 0471/0472 量：
   *   左上  (10,~424)  分数胶囊：黑底 + 白描边 + 左白圆(内有黑点) + 右侧白箭头
   *   右上  (~250,424) 暂停胶囊：同款壳，中间是 ‖
   *   左侧  (12,~150)  红色血条：白胶囊外壳 + 内嵌红色刻度块
   *   右侧  (300,~150) 蓝色竖条：白胶囊外壳 + 内嵌蓝色进度
   * 注意逻辑坐标 y 向上，所以「屏幕顶部」= y 接近 480。 */
  /* 截图 0471：胶囊中心距游戏区顶约 50 逻辑单位（黑条 30 + 再下 20），
   * 即逻辑 y ≈ 430。左胶囊 x 12~120，右胶囊 x 200~308。 */
  /* 0471 实测：胶囊中心 Y=22（绘制坐标 y **向下**）、高 29、宽 126；
   * 左胶囊 x 10~136、右胶囊 x 184~310，紧贴上沿。
   * ★ 这里必须用「向下」坐标：draw() 的 transform 是单位阵，Y(y)=H-y 只是
   *   给旧代码做向上→向下换算用的，直接写 canvas 值才是对的。 */
  var HUD_Y = 22;
  var HUD_CAP_W = 126, HUD_CAP_H = 30;
  /* 右上暂停胶囊的实际矩形（必须与 _drawHud 里 GUI.at(ctx,'cap_pause',236.5,-0.25)
   * 保持一致，否则命中区和看见的按钮对不上）。cap_pause.png 是 76x39。 */
  var PAUSE_BTN = { x: 236.5, w: 76 };

  // 胶囊外壳：黑底 + 白边 + 左端白圆(黑点) + 右端白箭头
  function drawCapsule(ctx, x, y, w, h, withArrow) {
    var cy = Y(y);
    var r = h / 2;
    ctx.save();
    // 黑影
    ctx.beginPath();
    cc._roundRect(ctx, x, cy - r, w, h, r);
    ctx.fillStyle = '#0a0a0e';
    ctx.fill();
    // 白描边（原版是粗白边）
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // 左端白圆
    var lr = h * 0.40;
    ctx.beginPath();
    ctx.arc(x + r * 0.92, cy, lr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.92, cy, lr * 0.40, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0e';
    ctx.fill();
    // 右端白箭头 〉
    if (withArrow) {
      var ax = x + w - r * 1.0, ah = h * 0.26;
      ctx.beginPath();
      ctx.moveTo(ax - ah * 0.3, cy - ah);
      ctx.lineTo(ax + ah * 0.5, cy);
      ctx.lineTo(ax - ah * 0.3, cy + ah);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
    return { cx: x + w / 2, cy: cy };
  }

  /* ================= 官方 HUD 双槽的精确几何 =================
   *
   * 单位铁律（反复踩坑的点，写死在这里）：
   *   cocos 渲染时 ctx.setTransform(k,0,0,k,0,0)，k = cssK × dpr（本环境 = 2）。
   *   所以 ctx.drawImage 的参数一律是**逻辑单位**，截图里量到的是它的 2 倍。
   *   → 换算只有一条：逻辑 = 截图 / 2。
   *
   * 血量槽 lifebar_shell (40x91)，逐像素实测：
   *   - 上半部 y0~15 是**血槽头部**（圆头 + 圆形指示环）
   *   - 血条腔体 y16~56：左侧白柱 x3~6，右侧白柱随高度外扩（透视），
   *     中间是**黑色底槽**
   *   - 下半部 y57~90 是**装饰圆盘**（大圆环，不是血槽的一部分）
   *   - 腔体内没有横档；原版截图里的横纹是**填充色带本身的横向条纹**
   *
   * lifebar_fill (26x40) 与 lifebar_bgfill (26x40) 形状完全一致（梯形，
   *   逐行 x0 到 x(17..25)），分别对应「有血」和「掉血后残留暗底」，
   *   所以两者都直接 1:1 贴在腔体上，不做任何缩放。
   *
   * 0472 实测（逻辑 = 截图/2）：
   *   外壳左上 (6.5, 285.5)；腔体顶 = 285.5+16 = 301.5，底 = 301.5+40 = 341.5
   *   品红条顶 y≈306 / 底 341 → 血量约 87.5%（满血顶到 301.5）
   */
  var LIFE = {
    x: 6.5, y: 285.5,          // lifebar_shell 左上角（逻辑）
    cx: 3, cy: 16,             // 腔体（= fill 图左上角）在外壳内的偏移
    cw: 26, ch: 40,            // 腔体尺寸 = fill 贴图原尺寸，1:1
    band: 2,                   // 条纹：亮 3 行 + 暗 2 行（截图 5px / 2 = 2.5 逻辑）
    period: 4,
    lightH: 3,
    mainRGB: [255, 0, 101],    // 满血品红（0472 实测 (255,0,101)）
    darkRGB: [96, 6, 40],      // 暗带（品红压暗 38%）
    bgRGB:   [54, 8, 26],      // 掉血底（暗红，原版截图 y603~611 那一带）
    glow: [255, 120, 180]      // 满血时的高光边缘
  };

  /* 歌曲进度槽 pbar_shell (30x122)，逐像素实测：
   *   - y1~22  圆形旋钮（白环 + 透明芯）
   *   - y24~111 长圆柱：白柱 x4~7，内腔 x9~22（白色高光柱），
   *             右白柱 x23~26 随高度外扩（透视）
   *   - y112~120 底部圆头
   *   - **壳本身没有透明缝**：原版那条青色是画在壳的**内腔**里的
   *     （截图青色 x607~615 = 逻辑 x303.5~307.5，正好落在 x9~22 内腔中）
   *   → 所以必须「先画青色、再压壳」，否则青色会盖住旋钮。
   *
   * pbar_fill (9x82)：青色实体只在 x2~5 / y2~78，即 4x77 逻辑像素。
   *   原版青色实测 9x150（截图）= 4.5x75 逻辑，与 4x77 基本一致 → 1:1 贴。
   *
   * 0472 实测（**截图像素**，务必 ÷2 才是逻辑）：
   *   壳  x591~630 (w40) / y545~767 (h223)
   *   青  x607~615 (w9)  / y600~749 (h150)
   * → 逻辑：壳 w20 / h111.5，青 w4.5 / h75。
   *   sx = 20/30 = 0.667（横向要压，30px 贴图铺不进 20 逻辑宽）
   *   sy = 111.5/122 = 0.914（纵向几乎 1:1）
   *   ★ 壳是**非等比缩放**：横向压扁 2/3、纵向基本不变，
   *     所以上面的旋钮看起来会变成竖椭圆 —— 这正是 0472 的实际形状。
   */
  var PBAR = {
    x: 295.5, y: 272.5,
    sx: 0.667, sy: 0.914,
    innerCx: 15.5,             // 壳内腔中心（sprite 像素坐标）
    fillTop: 297, fillBot: 377 // 青色条上下沿（逻辑，0472 实测 300~375 再放宽 2px 让壳咬住）
  };

  GameLayer.prototype._drawHud = function (ctx, N) {
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    /* 静帧（?still）只用来和原版 0472 做逐像素对比：
     * 原版那一帧是刚开局、血条约 87.5%、分数 −30（开局漏了一下的扣分）。
     * 静帧里自动判 MISS 会一路扣血扣分，导致对比不可比，所以每帧钉住。
     * **只影响静帧显示，不改动真实玩法数值。** */
    if (this._still) {
      /* 0471 实测：腔内品红顶在逻辑 y302.5，腔体顶 301.5、高 40
       * → 血量 ≈ (301.5+40-302.5)/40 = 0.975，几乎满血。 */
      this.life = RULES.LIFE_START * 0.975;
      this.score = 0;   // 0471 是开局瞬间，分数为 0（-30 出现在漏掉第一下之后）
    }

    /* ---- 左上：分数胶囊（贴官方 score.png，131x40） ----
     * 0471 实测：左胶囊白描边上沿在截图 y5~9 → 逻辑 2.5~4.5，
     *   而 cap_score.png 自身白边在贴图 y2~4 → 贴图 y 应放 0.5。 */
    GUI.at(ctx, 'cap_score', 6.5, -0.25);
    /* 0471 实测数字包围盒：纯白像素 x91~107 / y36~59（截图），
     * → 逻辑 x45.5~53.5、y18~29.5（宽 8、高 11.5）。
     * 笔画很细（约 1 逻辑），用 bold 会明显偏粗偏宽 —— 实测 bold17px 宽 9.5，
     * 比官方的 8 宽了近 20%，所以去掉 bold 用 16px regular。 */
    ctx.font = '16px "Helvetica Neue",Helvetica,Arial,sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.score), 45.5, 25);

    /* ---- 右上：暂停胶囊（贴官方 Pause000，76x39） ----
     * 0471 实测：右胶囊画布 x478~620 y5~85 → 逻辑 (239,2.5) 尺寸 71x40。 */
    GUI.at(ctx, 'cap_pause', 236.5, -0.25);

    /* ---- 左侧：血量槽（贴官方 LifeBar_Mask + LifeBar） ----
     *
     * 官方两张图的几何关系（**同一坐标系，都是贴图单位**，直接叠放即可）：
     *   lifebar_shell (40x91)：内腔是 y16~56 的黑色梯形，
     *       逐行实测宽度 x3~25(y16) → x3~33(y56)，即上窄下宽的透视腔。
     *   lifebar_fill  (26x40)：逐行实测宽度 x0~17(y0) → x0~25(y39)，
     *       和上面的梯形完全同斜率 —— 所以填充直接贴在 (x=3, y=16)、
     *       尺寸 26x40 就严丝合缝，**不能**再自己算偏移。
     *   血条是**从下往上**长的：缺多少就从顶部裁掉多少。
     *
     * 0472 实测：内腔顶 = 外壳顶 + 16*2 = 602（截图像素），底 = 682；
     *   品红实测 y612~683 → 底对齐 682 ✓，说明这帧血量约 87.5%。
     * 外壳位置由 0472 白描边反推：x 11~89 / y 574~754（截图）→ 逻辑 (5.5, 287)，尺寸 1:1。 */
    var life = cc.clamp(this.life / RULES.LIFE_START, 0, 1);
    var fx = LIFE.x + LIFE.cx, fy = LIFE.y + LIFE.cy;   // 腔体左上角

    /* ① 先铺「掉血底」—— 官方 lifebar_bgfill 是纯白，原版掉血段是暗红，
     *    同样用 source-atop 刷色，保住它自带的梯形 alpha。 */
    if (GUI.ok('lifebar_bgfill')) {
      var bgf = GUI.img('lifebar_bgfill');
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(bgf, fx, fy, LIFE.cw, LIFE.ch);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgb(' + LIFE.bgRGB.join(',') + ')';
      ctx.fillRect(fx, fy, LIFE.cw, LIFE.ch);
      ctx.restore();
    }

    /* ② 再画「有血」部分：从腔体底部往上长，条纹是填充色本身的分层。
     *    注意 lifebar_fill / lifebar_bgfill 两张图都是**纯白**，
     *    原版的品红/青色是运行时染的色，所以这里必须自己上色：
     *    先把贴图当遮罩铺成白色，再用 source-atop 刷品红。 */
    if (GUI.ok('lifebar_fill') && life > 0.004) {
      var fillImg = GUI.img('lifebar_fill');
      var fh = LIFE.ch, visible = fh * life;
      var topY = fy + fh - visible;              // 血量顶（逻辑 y）

      /* ②-a 裁剪到「腔体 ∩ 有血区间」 */
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, topY, LIFE.cw, visible);
      ctx.clip();

      /* ②-b 底层实色（满血色），用贴图 alpha 做梯形遮罩 */
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(fillImg, fx, fy, LIFE.cw, LIFE.ch);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgb(' + LIFE.mainRGB.join(',') + ')';
      ctx.fillRect(fx, topY, LIFE.cw, visible);
      ctx.restore();

      /* ②-c 横向暗带：同样用 source-atop，避免破坏梯形轮廓 */
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      for (var by = fy + fh - LIFE.lightH; by > topY; by -= LIFE.period) {
        ctx.fillStyle = 'rgb(' + LIFE.darkRGB.join(',') + ')';
        ctx.fillRect(fx, by - (LIFE.period - LIFE.lightH), LIFE.cw,
                     LIFE.period - LIFE.lightH + 0.4);
      }
      ctx.restore();
      ctx.restore();

      /* ③ 血量高时，顶边加一道亮线（原版 0472 顶部那条更亮的品红） */
      if (life > 0.6) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (life - 0.6) / 0.4) * 0.9;
        ctx.fillStyle = 'rgb(' + LIFE.glow.join(',') + ')';
        ctx.fillRect(fx + 1.5, topY + 0.5, LIFE.cw - 4, 1);
        ctx.restore();
      }
    }

    /* ④ 最后压外壳：白柱、圆头、下部装饰盘全部来自官方 shell，1:1 贴。 */
    GUI.at(ctx, 'lifebar_shell', LIFE.x, LIFE.y);

    /* ---- 右侧：歌曲进度槽（贴官方 PBarBg + PBar） ----
     *
     * 官方 pbar_shell 是 30x122 的「圆旋钮 + 小窗 + 长圆柱」一体壳。
     * pbar_fill 是 9x82，青色只在 x2~5 / y2~78。
     *
     * 0472 实测（**截图像素**）：壳 x591~630 (w40) / y545~767 (h223)，
     * 青色 x607~615 (w9) / y600~749 (h150)。
     *
     * ★ 关键单位换算：canvas 的变换是 k = cssK×dpr（本环境 cssK=1, dpr=2），
     *   所以 ctx.drawImage 的参数是**逻辑单位**，截图里看到的是 2 倍像素。
     *   逻辑目标：壳 w20 / h111.5，青色 w4.5 / h74.5。
     *   sx = 20/30 = 0.667，sy = 111.5/122 = 0.914
     *   csx = 4.5/4 = 1.125，csy = 74.5/77 = 0.968
     *   （之前误把截图值当逻辑值，导致整条大了一倍还溢出屏幕。） */
    var PB = PBAR;
    var psh = GUI.img('pbar_shell');
    if (GUI.ok('pbar_shell')) {
      /* 先压壳（壳的内腔是一条纯白高光柱），再把青色画在柱子上。
       * 顺序不能颠倒：青色若先画会被白柱完全盖掉（实测过，条子消失）。
       * 青色宽度取柱宽（逻辑 4.5，壳内腔 x9~22 → 13*0.667 ≈ 8.7 宽，
       * 但原版青条只有 9 截图 = 4.5 逻辑，所以是柱中间的一段）。 */
      ctx.drawImage(psh, PB.x, PB.y, psh.width * PB.sx, psh.height * PB.sy);
      if (GUI.ok('pbar_fill')) {
        var cb = GUI.img('pbar_fill');
        var fw = 6.5, fh = PB.fillBot - PB.fillTop;
        var fcx = PB.x + PB.innerCx * PB.sx + 1.2;   // 内腔中心（逻辑），实测偏右 1.2
        var fx0 = fcx - fw / 2, fy0 = PB.fillTop;
        /* 原版青条是**胶囊形**（两端半圆收口）。壳的圆头在两端把它盖住一半，
         * 这里补上圆角，避免出现直切的方块端。 */
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(fx0, fy0, fw, fh, fw / 2);
        } else {
          ctx.moveTo(fx0 + fw / 2, fy0);
          ctx.arcTo(fx0 + fw, fy0, fx0 + fw, fy0 + fh, fw / 2);
          ctx.arcTo(fx0 + fw, fy0 + fh, fx0, fy0 + fh, fw / 2);
          ctx.arcTo(fx0, fy0 + fh, fx0, fy0, fw / 2);
          ctx.arcTo(fx0, fy0, fx0 + fw, fy0, fw / 2);
          ctx.closePath();
        }
        ctx.clip();
        ctx.drawImage(cb, fx0, fy0, fw, fh);
        ctx.restore();
      }
    }

    /* ---- 连击数字：贴在轨道中上部 ---- */
    /* 0471/0472 里没有可见的连击数字（这两帧 combo 都低于显示阈值或恰好
     * 不在画面里），所以位置按同类音游惯例放在轨道上方正中、不遮背景字。
     * 之前放在 Y(392)，压在歌手照的脸上；现在下移到轨道消失点上方。 */
    if (this.combo >= 2) {
      var pop = 1;
      if (this.judgeFx) pop = 1 + Math.max(0, 0.22 - this.judgeFx.age) * 1.4;
      ctx.save();
      ctx.translate(W / 2, Y(272));
      ctx.scale(pop, pop);
      ctx.font = 'bold 30px "Helvetica Neue",Helvetica,Arial,sans-serif';
      ctx.fillStyle = this.combo >= RULES.FLAME_COMBO ? '#ffd83d' : '#ffffff';
      ctx.shadowColor = this.combo >= RULES.FLAME_COMBO ? '#ff8a00' : 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 12;
      ctx.fillText(String(this.combo), 0, 0);
      ctx.shadowBlur = 0;
      ctx.font = 'bold 10px "Helvetica Neue",Helvetica,Arial,sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText('COMBO', 0, 17);
      var m = this._mult();
      if (m > 1) {
        ctx.font = 'bold 14px "Helvetica Neue",Helvetica,Arial,sans-serif';
        ctx.fillStyle = '#ffcf3d';
        ctx.fillText('x' + m, 0, -20);
      }
      ctx.restore();
    }

    /* ---- 判定文字移到 _drawJudgeText 里单独画（要压在音符之上） ---- */
  };

  /* 判定文字：固定画在屏幕水平正中、唱片段上方的位置，向上飘并淡出。
   * 原版判定字是居中上飘的，与轨道位置无关。 */
  GameLayer.prototype._drawJudgeText = function (ctx) {
    if (!this.judgeFx) return;
    var st = JUDGE_STYLE[this.judgeFx.kind];
    if (!st) return;
    var age = this.judgeFx.age;
    var a = Math.max(0, 1 - age / 0.55);
    if (a <= 0) return;
    // 出现时先放大再回落，同时向上飘
    var popS = age < 0.10 ? (0.72 + (age / 0.10) * 0.42)
      : (1.14 - Math.min(0.14, (age - 0.10) * 0.7));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = a;
    ctx.translate(W / 2, Y(96) - age * 20);
    ctx.scale(popS, popS);
    ctx.font = 'bold 20px "Helvetica Neue",Helvetica,Arial,sans-serif';
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.strokeText(st.text, 0, 0);
    ctx.fillStyle = st.color;
    ctx.shadowColor = st.color;
    ctx.shadowBlur = 12;
    ctx.fillText(st.text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
  };

  /* -------------------------------------------------------------- 输入 */
  /* 平行轨道的命中判定：x 落在哪条轨道上就是哪条，y 限制在轨道区内。
   * 原版判定区一直延伸到屏幕最底部（唱片盘就在 y 0~110），所以整个下半屏
   * 都可点；上半屏留给暂停/返回。 */
  GameLayer.prototype.laneAt = function (x, y) {
    /* onTouchBegan/onTouchMoved 传进来的是**逻辑坐标**（原点左下、y 向上），
     * 而轨道几何用的是绘制坐标（原点左上、y 向下）→ 先换算。
     *
     * ★ 这里踩了一个致命坑（表现为「点左右判定盘完全没反应，只有中间能打」）：
     *   曾经写成 `yc = Math.min(H - y, LANE_TOP)` 把 Y 钳在 258，
     *   于是 mainSpacing 永远算出 0.38775×258−62.09 = 37.95。
     *   但判定盘在 y≈426，该处真实间距是 103.1 —— 钳过之后：
     *     点左盘 x=51  → lane = round((51−160)/37.95 + 1) = −2 → 判无效
     *     点右盘 x=267 → lane = round((267−160)/37.95 + 1) =  4 → 判无效（N=3）
     *   只有中间那条勉强命中，玩家感受就是「点了没反应、打不到」。
     *
     * 正确做法：**不要钳 Y**，直接用点击点的实际绘制 Y 去算间距。
     * 透视本身已经保证了上半屏自动失效：Y<160.2 时 d≤0，直接返回 −1。
     *
     * ★★ 第二个坑（同一症状的第二个原因）：换算常量必须是**画布高度 480**，
     *    不能是文件顶部那个 `H`。本文件第 21 行写的是 `var H = 568`，
     *    那是 640×1136 整屏 ÷2 得到的「整屏高」，比真实画布多 88（顶部状态栏+logo）。
     *    用它做 y 翻转 → 点判定盘那次点击的 y_canvas 会被算到 500 多，
     *    mainSpacing(500+) 直接 >0 但间距偏大，lane 反解仍然错位。
     *    cc.WIN.height 才是画布的权威高度（=480），这里必须用它。 */
    var yc = cc.WIN.height - y;           // 绘制坐标（0=屏幕顶，480=屏幕底）
    if (yc < 0) return -1;
    var N = this.laneCount;
    var d = mainSpacing(yc);              // 该高度上的主轨间距
    if (d <= 0.5) return -1;              // 消失点以上，不判定
    /* 第 lane 条主轨中心 x = VAN_X + (lane − (N−1)/2) · d
     * 反解：lane = round((x − VAN_X)/d + (N−1)/2) */
    var lane = Math.round((x - VAN_X) / d + (N - 1) / 2);
    if (lane < 0 || lane >= N) return -1;
    /* ★ 再加一道「横向必须在判定盘覆盖范围内」的闸。
     *   只看 lane 反解会有一个副作用：Math.round 在 |Δ|<0.5 时仍会吸附，
     *   于是点在屏幕最左边的空白（x=10）也会被判成 lane 0 ——
     *   原版那里是不响应的。这里用最外侧白盘的实际外缘当边界。 */
    var cx0 = PAD_CX[N] ? PAD_CX[N][0] : PAD_CX[3][0];
    var r0 = PAD_R[N] ? PAD_R[N][0] : PAD_R[3][0];
    var cxE = PAD_CX[N] ? PAD_CX[N][N - 1] : PAD_CX[3][2];
    var rE = PAD_R[N] ? PAD_R[N][N - 1] : PAD_R[3][2];
    if (x < cx0 - r0 || x > cxE + rE) return -1;
    return lane;
  };

  GameLayer.prototype.onTouchBegan = function (x, y) {
    if (this.paused || this.finished) return false;
    if (this._pauseHit(x, y)) { this.scene.togglePause(); return true; }
    var lane = this.laneAt(x, y);
    if (lane < 0) return false;
    this.press(lane);
    return true;
  };
  GameLayer.prototype.onTouchEnded = function () {
    for (var i = 0; i < 4; i++) this.release(i);
  };
  // 右上暂停胶囊的命中区
  GameLayer.prototype._pauseHit = function (x, y) {
    /* ★ y 传进来是**逻辑坐标（原点左下、y 向上）**，而 HUD_Y 是绘制坐标
     *   （原点左上、y 向下）。必须先把 y 翻过来，否则命中区会跑到屏幕最底部，
     *   点右上角暂停按钮永远没反应 —— 「按暂停没反应」的第一个原因。
     * ★ 第二个原因：翻转用的高度必须是画布高 480（cc.WIN.height），
     *   不是本文件顶部那个 H=568（那是整屏 1136÷2，多含 88 状态栏）。
     *   用 568 会把 y_canvas 算成 110，永远落在 [7,37] 之外 → 恒 false。 */
    var yc = cc.WIN.height - y;
    var px = PAUSE_BTN.x, pw = PAUSE_BTN.w;
    return x >= px && x <= px + pw &&
      yc >= HUD_Y - HUD_CAP_H / 2 && yc <= HUD_Y + HUD_CAP_H / 2;
  };

  var KEYMAP = {
    'a': 0, 's': 1, 'd': 2, 'f': 3,
    '1': 0, '2': 1, '3': 2, '4': 3,
    'arrowleft': 0, 'arrowdown': 1, 'arrowup': 2, 'arrowright': 3
  };

  GameLayer.prototype.onKeyDown = function (e) {
    if (this.paused || this.finished) return false;
    var k = e.key.toLowerCase();
    if (k === 'escape') { this.scene.togglePause(); return true; }
    var lane = KEYMAP[k];
    if (lane === undefined || lane >= this.laneCount) return false;
    if (!this.held[lane]) this.press(lane);
    return true;
  };
  GameLayer.prototype.onKeyUp = function (e) {
    var k = e.key.toLowerCase();
    var lane = KEYMAP[k];
    if (lane === undefined) return false;
    this.release(lane);
    return true;
  };

  /* ------------------------------------------------------------ 暂停层 */
  /* ------------------------------------------------------- 蓝色发光胶囊按钮
   * 几何全部来自官方 0475（死亡页）/ 0467（标题页）实机截图逐像素测量：
   *   截图 640×1136，减顶部 176 状态栏再 ÷2 = 本画布坐标。
   *
   *   · 条高 h = 50，相邻两条中心间距 70（两板之间露出 20 的缝）
   *   · 齿轮在左：板 x 0~240、齿轮心 x=82、文字心 x=174
   *   · 齿轮在右：板 x 80~320、齿轮心 x=238、文字心 x=146
   *   · 齿环外径 ≈ 59，上下都凸出板外
   *   · 板外侧还有一段「导轨插槽」尾巴，一直伸到屏幕外
   *
   * 配色（0475 纵向剖面，黑底合成后实测）：
   *   板内 顶 (0,93,143) → 中 (0,66,94) → 底 (0,95,145)
   *   边线 (37,145,220)，外发光 (0,33,52)
   *
   * ★ 早先是用 bar_left / bar_right 素材做九宫格拉满 320：
   *   孔位被算到 x=19（齿轮直接被屏幕切掉一半），而且素材那层 80% 半透
   *   横向一拉就成了一条亮蓝塑料带，跟官方的深藏青玻璃管完全是两回事。
   *   素材只保留**齿轮**（pz0011，那圈齿形太复杂，程序画不出来），
   *   板体改成程序绘制 —— 反而和官方 1:1 对得上。 */
  var BAR_H = 50;
  var BAR_PLATE_W = 240;        // 板宽（从齿轮所在那一侧屏边算起）
  var BAR_HOLE_X = 82;          // 齿轮心距同侧屏边
  var BAR_GEAR_D = 59;          // 齿环外径
  var BAR_TEXT_X = 174;         // 文字心（齿轮在左时）；镜像时 = 146

  function barSkin(tint) {
    if (tint === 'green') {
      return {
        stops: [[0, 'rgba(0,150,170,1)'], [0.07, 'rgba(0,116,132,1)'],
          [0.24, 'rgba(0,90,102,1)'], [0.55, 'rgba(0,76,86,1)'],
          [0.86, 'rgba(0,90,102,1)'], [1, 'rgba(0,128,146,1)']],
        line: 'rgba(96,240,236,0.95)', glow: 'rgba(80,240,232,0.85)'
      };
    }
    return {
      stops: [[0, 'rgba(0,150,215,1)'], [0.07, 'rgba(0,105,158,1)'],
        [0.24, 'rgba(0,80,120,1)'], [0.55, 'rgba(0,66,94,1)'],
        [0.86, 'rgba(0,78,112,1)'], [1, 'rgba(0,120,175,1)']],
      line: 'rgba(74,196,255,0.95)', glow: 'rgba(60,190,255,0.85)'
    };
  }

  function drawBlueBar(ctx, cy, label, gearSide, tint, opt) {
    opt = opt || {};
    var h = opt.h || BAR_H;
    var yT = cy - h / 2, yB = yT + h;
    var holeLeft = (gearSide === 'left');
    var sk = barSkin(tint);
    var nw = W;   // 画布宽 320

    /* 板占哪一段、齿轮在哪、文字在哪（齿轮在右时整体镜像） */
    var bx0 = holeLeft ? 0 : (nw - BAR_PLATE_W);
    var bx1 = holeLeft ? BAR_PLATE_W : nw;
    /* 贴屏幕边那一侧再往外沿 3px：不然圆角会在屏边上啃出一个缺口，
     * 官方那侧是**平头压出画面**的 */
    var ex0 = holeLeft ? -3 : bx0;
    var ex1 = holeLeft ? bx1 : nw + 3;
    var holeX = holeLeft ? BAR_HOLE_X : (nw - BAR_HOLE_X);
    var tx = holeLeft ? BAR_TEXT_X : (nw - BAR_TEXT_X);
    /* 齿轮直径：素材版固定 50（之前那一版就是这个大小，用户认可） */
    var gd = opt.gearD || 50;

    /* 调用方可能残留 alpha / 混合模式（结算页有大量半透明叠加），
     * 按钮必须按原样满不透明画，否则整条会发浅、透出底色。 */
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* ① 导轨线：只在板外侧那段「插槽尾巴」里出现（板自己有描边，
     *    画到板下面只会把板边推得过亮 —— 之前整条亮得像荧光棒就是这原因） */
    var tailX0 = holeLeft ? bx1 : 0;
    var tailX1 = holeLeft ? nw : bx0;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = sk.glow;
    ctx.shadowBlur = 4;
    ctx.fillStyle = sk.line;
    ctx.fillRect(tailX0, yT + 0.6, tailX1 - tailX0, 1.3);
    ctx.fillRect(tailX0, yB - 1.9, tailX1 - tailX0, 1.3);
    ctx.restore();

    /* ② 尾巴：板外侧的插槽（贴板端最亮，往外迅速变暗）+ 两根伸出的卡爪 */
    if (tailX1 > tailX0) {
      var tg = ctx.createLinearGradient(tailX0, 0, tailX1, 0);
      tg.addColorStop(0.00, 'rgba(0,108,170,0.85)');
      tg.addColorStop(0.18, 'rgba(0,66,104,0.80)');
      tg.addColorStop(0.55, 'rgba(0,34,54,0.75)');
      tg.addColorStop(1.00, 'rgba(0,26,42,0.75)');
      if (!holeLeft) {   /* 齿轮在右时尾巴在左边，方向反过来 */
        tg = ctx.createLinearGradient(tailX1, 0, tailX0, 0);
        tg.addColorStop(0.00, 'rgba(0,108,170,0.85)');
        tg.addColorStop(0.18, 'rgba(0,66,104,0.80)');
        tg.addColorStop(0.55, 'rgba(0,34,54,0.75)');
        tg.addColorStop(1.00, 'rgba(0,26,42,0.75)');
      }
      ctx.fillStyle = tg;
      ctx.fillRect(tailX0, yT + 1.6, tailX1 - tailX0, h - 3.2);

      /* ★ 卡爪（官方尾巴上有两根小横条）先不画：
       *   在 320 宽下它只有 20×6 逻辑，画出来像浮在暗槽里一个「≡」图标，
       *   比不画更出戏。尾巴本身靠渐变 + 上下导轨线已经读得出来了。 */
    }

    /* ③ 板体：圆角矩形 + 上下亮、中间暗的玻璃管渐变 */
    var r = Math.min(11, h * 0.22);
    roundRect(ctx, ex0, yT, ex1 - ex0, h, r);
    var g = ctx.createLinearGradient(0, yT, 0, yB);
    for (var i = 0; i < sk.stops.length; i++) {
      g.addColorStop(sk.stops[i][0], sk.stops[i][1]);
    }
    ctx.fillStyle = g;
    ctx.fill();
    /* 板内还有一层横向渐变：越远离齿轮一侧越亮（官方 0475 实测
     * x=0 → (0,93,143)，x=224 → (37,129,183)），叠一层提亮即可 */
    ctx.save();
    ctx.clip();
    var hg = ctx.createLinearGradient(holeLeft ? bx0 : bx1, 0, holeLeft ? bx1 : bx0, 0);
    hg.addColorStop(0, 'rgba(0,0,0,0)');
    hg.addColorStop(0.45, 'rgba(255,255,255,0.012)');
    hg.addColorStop(1, 'rgba(150,215,255,0.10)');
    ctx.fillStyle = hg;
    ctx.fillRect(ex0, yT, ex1 - ex0, h);
    ctx.restore();

    /* ④ 板边：2px 亮青描边 + 外发光 */
    ctx.save();
    roundRect(ctx, ex0 + 0.9, yT + 0.9, ex1 - ex0 - 1.8, h - 1.8, r);
    ctx.strokeStyle = sk.line;
    ctx.lineWidth = 1.7;
    ctx.shadowColor = sk.glow;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();

    /* ⑤ 齿轮：官方 pz0011（外圆环 + 内圈齿 + 中心点），上下都凸出板外 */
    /* ★ 齿轮用原始素材 assets/gameui/gear.png（四段弧 + 细圆环那枚）：
     *   程序画的那版齿盘（drawGearPod）留着备用，但观感上还是素材更像原版，
     *   用户明确要求改回这一版。 */
    var gear = GUI.img('gear');
    if (GUI.ok('gear')) {
      ctx.save();
      ctx.drawImage(gear, holeX - gd / 2, cy - gd / 2, gd, gd);
      ctx.restore();
    } else {
      drawGearPod(ctx, holeX, cy, gd / 2);
    }

    /* ⑥ 文字：斜体粗黑，白色 + 深蓝描边 + 冷光。官方文字心偏下 ~4 */
    ctx.save();
    ctx.font = 'italic 900 24px "Arial Black",system-ui,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(2,16,34,0.95)';
    ctx.strokeText(label, tx, cy + 3);
    var wg = ctx.createLinearGradient(0, cy - 12, 0, cy + 12);
    wg.addColorStop(0, '#ffffff');
    wg.addColorStop(0.55, '#eaf7ff');
    wg.addColorStop(1, '#b9dcf2');
    ctx.fillStyle = wg;
    ctx.shadowColor = 'rgba(120,220,255,0.85)';
    ctx.shadowBlur = 8;
    ctx.fillText(label, tx, cy + 3);
    ctx.restore();

    ctx.restore();          // 函数开头那次 save（alpha / 混合模式）
  }

  /* 官方那枚圆盘齿轮（pz0011 在 0475 上放大后的结构）：
   *   最外一圈亮青环 → 一圈深藏青齿盘 → 6 个齿形缺口 → 内圆盘 → 中心小孔
   * ★ 项目里 assets/gameui/gear.png 是「加载圈」（4 段弧 + 细圆环），
   *   不是官方按钮上那枚齿盘，贴上去完全不像，所以这里改程序画。 */
  function drawGearPod(ctx, cx, cy, R) {
    var TAU = Math.PI * 2;
    ctx.save();
    ctx.globalAlpha = 1;

    /* ① 底盘（深藏青）：先铺一层整圆，后面所有亮件都挖在这上面 */
    var g0 = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R);
    g0.addColorStop(0.00, '#02101a');
    g0.addColorStop(0.50, '#051c30');
    g0.addColorStop(0.85, '#0a2c4a');
    g0.addColorStop(1.00, '#03121e');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.96, 0, TAU);
    ctx.fillStyle = g0;
    ctx.fill();

    /* ② 六个齿：0.46R~0.72R 的六段扇环，齿间留 0.13 rad 缺口
     *    ★ 之前是「先画一整圈亮环、再用深色方块切缺口」——
     *      切出来的是六根黑辐条，跟官方的齿盘完全不是一回事。 */
    var cg = ctx.createLinearGradient(cx - R * 0.7, cy - R * 0.7, cx + R * 0.7, cy + R * 0.7);
    cg.addColorStop(0.00, '#8ce6ff');
    cg.addColorStop(0.42, '#45bff0');
    cg.addColorStop(1.00, '#1d7cb8');
    ctx.save();
    ctx.shadowColor = 'rgba(70,180,240,0.55)';
    ctx.shadowBlur = 4;
    for (var i = 0; i < 6; i++) {
      var a0 = i * TAU / 6 + 0.12;
      var a1 = (i + 1) * TAU / 6 - 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.72, a0, a1);
      ctx.arc(cx, cy, R * 0.46, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = cg;
      ctx.fill();
    }
    ctx.restore();

    /* ③ 内盘：把齿的内侧压成一块暗圆，再补一圈细线 */
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.47, 0, TAU);
    var g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.47);
    g1.addColorStop(0.00, '#01080e');
    g1.addColorStop(0.72, '#031524');
    g1.addColorStop(1.00, '#062238');
    ctx.fillStyle = g1;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.47, 0, TAU);
    ctx.strokeStyle = 'rgba(62,152,208,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.085, 0, TAU);
    ctx.fillStyle = '#01070c';
    ctx.fill();

    /* ④ 最外一道亮环（官方那颗齿轮的轮廓线，很细但很亮） */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.945, 0, TAU);
    ctx.lineWidth = Math.max(1.3, R * 0.075);
    ctx.strokeStyle = 'rgba(126,222,255,0.92)';
    ctx.shadowColor = 'rgba(90,200,255,0.85)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  /* 蓝色圆环齿轮：外圈亮环 + 内圈深蓝盘 + 中间一圈齿 */
  function drawGear(ctx, cx, cy, R) {
    ctx.save();
    // 外发光圆盘
    ctx.shadowColor = 'rgba(70,200,255,0.95)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    var g1 = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    g1.addColorStop(0, '#0a2c48');
    g1.addColorStop(0.7, '#0d4a78');
    g1.addColorStop(1, '#3fc8ff');
    ctx.fillStyle = g1;
    ctx.fill();
    // 外环
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#8ee6ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // 内环
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,225,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 齿：8 根短粗线
    ctx.strokeStyle = '#9ae8ff';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.30, cy + Math.sin(a) * R * 0.30);
      ctx.lineTo(cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56);
      ctx.stroke();
    }
    // 中心孔
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.10, 0, Math.PI * 2);
    ctx.fillStyle = '#3fc8ff';
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------ 暂停层
   * 0469/0473：背景是**去色 + 压暗**的演奏画面（不是纯黑蒙层），
   * 上方三条蓝色胶囊：返回歌曲 / 重新开始 / 退出，齿轮左右交替。
   */
  function PauseLayer() {
    cc.Layer.call(this);
    this.isCustomDraw = true;
    this.active = false;
    this.t = 0;
  }
  PauseLayer.prototype = Object.create(cc.Layer.prototype);
  PauseLayer.prototype.update = function (dt) { this.t += dt; };

  /* 三条胶囊的中心 y（**canvas 坐标**，原点左上）。
   * 0473 实测（640×1136 截图，减 88px 状态栏黑边后 ÷2）：
   *   段 y 696~800 → canvas 260~312  返回歌曲
   *   段 y 792~896 → canvas 308~360  重新开始
   *   段 y 888~992 → canvas 356~408  退出
   * 每条高 52，中心分别在 286 / 334 / 382。
   * 但这三个值让按钮挤在画面下半部；0469 的实际观感是三条居中偏下，
   * 这里取 246/300/354 让其均匀铺在画面中下段（步长 54）。 */
  var PAUSE_ROWS = [
    { cy: 291.5, label: '返回歌曲', gear: 'left', act: 'resume' },
    { cy: 341.5, label: '重新开始', gear: 'right', act: 'restart' },
    { cy: 391.5, label: '退　出', gear: 'left', act: 'quit' }
  ];

  PauseLayer.prototype.draw = function (ctx) {
    if (!this.active) return;

    /* 1) 背景去色压暗：先把当前画布快照，用 'saturation' 合成模式抽掉颜色。
     *    canvas 没有直接「去色」API，用 globalCompositeOperation='saturation'
     *    叠一层灰色即可把饱和度拉平。 */
    ctx.save();
    /* 官方 0479 的暂停背景压得比这里重得多：歌手照只剩灰暗轮廓，
     * 判定盘几乎看不出。0.55 太浅 —— 叠在亮背景上时，胶囊素材自带的
     * 20% 透光会把后面的画面透出来，整条胶囊发浅、像半透明塑料片。
     * 加到 0.72 之后胶囊内部才落到官方那种 (0,67,94) 的深蓝。 */
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    /* 2) 顶部「乐动达人」logo 区保留（原版这一条不被压暗）。
     *    这里只在顶部补一层深蓝底，logo 由 _drawTopBar 已画过，被压暗后
     *    重新提亮一次。 */
    ctx.save();
    ctx.fillStyle = 'rgba(10,20,60,0.55)';
    ctx.fillRect(0, 0, W, 16);
    ctx.restore();

    /* 3) 三条蓝色胶囊 */
    for (var i = 0; i < PAUSE_ROWS.length; i++) {
      drawBlueBar(ctx, PAUSE_ROWS[i].cy, PAUSE_ROWS[i].label, PAUSE_ROWS[i].gear);
    }
  };

  PauseLayer.prototype.onTouchBegan = function (x, y) {
    if (!this.active) return false;
    /* onTouchBegan 的 y 是**逻辑坐标**（原点左下、y 向上），
     * PAUSE_ROWS 里存的是 canvas 坐标（原点左上），必须换算。
     * ★ 换算高度用 cc.WIN.height（=480），不是文件顶部的 H（=568，整屏 1136÷2）。
     *   用 568 会把每一条的命中区整体上推 88，三条按钮全部点不中。 */
    var cyCanvas = cc.WIN.height - y;
    for (var i = 0; i < PAUSE_ROWS.length; i++) {
      var cy = PAUSE_ROWS[i].cy;
      if (cyCanvas > cy - 28 && cyCanvas < cy + 28) {
        var act = PAUSE_ROWS[i].act;
        if (act === 'restart') this.scene.restart();
        else if (act === 'quit') this.scene.quit();
        else this.scene.resume();
        return true;
      }
    }
    return true;
  };
  PauseLayer.prototype.onKeyDown = function (e) {
    if (!this.active) return false;
    if (e.key === 'Escape') { this.scene.resume(); return true; }
    return false;
  };


  /* ------------------------------------------------------------ 结束层
   * 截图 0475：纯黑底 + 顶部保留乐动达人 logo，中间红色倾斜立体字
   * 「GAME OVER」，下方一道青色横线 + 上下翻转的暗红倒影；
   * 底下两条蓝色胶囊：重新开始（齿轮在左）/ 退出（齿轮在右）。
   */
  /* 0475 实测（640×1136，减 176 状态栏后 ÷2）：
   *   GAME OVER 红字 bbox  x 31~289、y 158.5~186（基线 186，字高 27.5）
   *   青色横线 y = 189，1.5 厚
   *   倒影 y 187~225，暗红 (33,7,5) 一路淡出
   *   按钮：条1 中心 366、条2 中心 436（条高 50、间距 70）
   */
  var OVER_ROWS = [
    { cy: 366, label: '重新开始', gear: 'left', act: 'restart' },
    { cy: 436, label: '退　出', gear: 'right', act: 'quit' }
  ];

  function OverLayer() {
    cc.Layer.call(this);
    this.isCustomDraw = true;
    this.active = false;
  }
  OverLayer.prototype = Object.create(cc.Layer.prototype);

  /* 把 GAME OVER 画到 (0,0) = 基线中点，横向压到 GO_W 宽 */
  var GO_W = 258, GO_H = 27.5;
  function paintGameOver(ctx, fill, stroke) {
    ctx.save();
    ctx.font = '900 40px "Arial Black",Impact,"Arial Bold",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    var w0 = ctx.measureText('GAME OVER').width || 240;
    ctx.scale(GO_W / w0, 1);

    if (stroke) {
      ctx.lineWidth = stroke.w;
      ctx.strokeStyle = stroke.c;
      ctx.strokeText('GAME OVER', 0, 0);
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillText('GAME OVER', 0, 0);
    }
    ctx.restore();
  }

  OverLayer.prototype.draw = function (ctx) {
    if (!this.active) return;

    // 1) 纯黑底（原版就是全黑，不是半透明蒙层）
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    /* 2) GAME OVER 主字
     *    官方是**方头重黑体 + 3D 倒角 + 两道横向高光带**：
     *      外描边 深栗 #4a0602（约 5px）
     *      字面   顶 #ff9c84 → 高光带 #ff8a6a → #e02a12 → #b81006
     *              → 第二道高光 #d63a20 → 底 #5a0400
     *    ★ 之前用 system-ui 渲染，Windows 上落到 Segoe UI，字是圆的；
     *      官方那种方肩是 Arial Black，而且还要横向压到 258 才等宽。 */
    ctx.save();
    ctx.translate(W / 2, 186);
    ctx.transform(1, 0, -0.045, 1, 0, 0);     // 官方约 2.5° 右倾

    /* 投影：往右下 2px 的暗红，让字从黑底上立起来 */
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(1.6, 2.2);
    paintGameOver(ctx, '#2a0201', null);
    ctx.restore();

    paintGameOver(ctx, null, { w: 9, c: '#4a0602' });

    var gg = ctx.createLinearGradient(0, -GO_H, 0, 0);
    gg.addColorStop(0.00, '#ffb3a0');
    gg.addColorStop(0.10, '#ff8f74');
    gg.addColorStop(0.20, '#ff6a4a');   // 第一道高光带
    gg.addColorStop(0.30, '#e02a12');
    gg.addColorStop(0.46, '#b81006');
    gg.addColorStop(0.50, '#c91d0c');
    gg.addColorStop(0.58, '#8f0a02');   // 第二条暗带
    gg.addColorStop(0.66, '#cf3418');   // 第二道高光带
    gg.addColorStop(0.80, '#a81006');
    gg.addColorStop(1.00, '#5a0400');
    paintGameOver(ctx, gg, null);

    /* 字顶那条细白线（官方在字的上沿有一道 1px 高光） */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.rect(-160, -GO_H, 320, 1.2);
    ctx.clip();
    paintGameOver(ctx, '#ffe6dc', null);
    ctx.restore();

    ctx.restore();

    // 3) 青色横线（y=189）
    ctx.save();
    var lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0.00, 'rgba(30,170,200,0)');
    lg.addColorStop(0.10, 'rgba(56,210,236,0.85)');
    lg.addColorStop(0.90, 'rgba(56,210,236,0.85)');
    lg.addColorStop(1.00, 'rgba(30,170,200,0)');
    ctx.fillStyle = lg;
    ctx.shadowColor = 'rgba(40,205,235,0.9)';
    ctx.shadowBlur = 7;
    ctx.fillRect(0, 188.6, W, 1.6);
    ctx.restore();

    // 4) 倒影：上下翻转 + 纵向拉长 1.3 倍 + 向下淡出（官方倒影比字本身还高）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 191, W, 40);
    ctx.clip();
    ctx.translate(W / 2, 191);
    ctx.transform(1, 0, -0.045, -1.32, 0, 0);
    var rg = ctx.createLinearGradient(0, 0, 0, GO_H);
    rg.addColorStop(0.00, 'rgba(126,26,14,0.50)');
    rg.addColorStop(0.50, 'rgba(72,12,6,0.32)');
    rg.addColorStop(1.00, 'rgba(30,4,1,0.03)');
    paintGameOver(ctx, rg, null);
    ctx.restore();

    // 5) 两条蓝色胶囊
    for (var i = 0; i < OVER_ROWS.length; i++) {
      drawBlueBar(ctx, OVER_ROWS[i].cy, OVER_ROWS[i].label, OVER_ROWS[i].gear);
    }
  };

  OverLayer.prototype.onTouchBegan = function (x, y) {
    if (!this.active) return false;
    var cyCanvas = cc.WIN.height - y;   // 同 PauseLayer：必须用画布高 480，不是 H=568
    for (var i = 0; i < OVER_ROWS.length; i++) {
      var cy = OVER_ROWS[i].cy;
      if (cyCanvas > cy - 28 && cyCanvas < cy + 28) {
        if (OVER_ROWS[i].act === 'restart') this.scene.restart();
        else this.scene.quit();
        return true;
      }
    }
    return true;
  };
  OverLayer.prototype.onKeyDown = function (e) {
    if (!this.active) return false;
    if (e.key === 'Escape') { this.scene.quit(); return true; }
    if (e.key === 'Enter' || e.key === ' ') { this.scene.restart(); return true; }
    return false;
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  cc._roundRect = roundRect;

  /* ------------------------------------------------------------- Scene */
  cc.SceneGame = function (song, mode) {
    var scene = new cc.Scene();
    scene.song = song;
    scene.mode = mode;

    /* 演奏页底：**只用 config.lua 搭的背景层**。
     * gameControlBg.png（320x480，歌曲封面卡：歌手照 + 斜黑条曲名 + 时长）
     * 是进曲前的「歌曲信息卡」（截图 0470），不是演奏中的底图 ——
     * 截图 0471/0472 里演奏画面完全没有这张卡的任何元素。
     * 所以演奏场景不挂 scene.bg，背景完全交给 LuaBackLayer。 */

    var game = new GameLayer(song, mode);
    window.__GAME__ = game;
    game.zOrder = 10;
    scene.addChild(game, 10);
    scene.game = game;
    /* ★ 各层都要能反向找到场景：GameLayer.onTouchBegan 里点暂停要 `this.scene.togglePause()`，
     *   PauseLayer 的按钮要 `this.scene.resume/restart/quit`，OverLayer 同理。
     *   之前这三个 layer 都没挂 .scene → 任何按钮都会 `Cannot read properties of
     *   undefined (reading 'togglePause')` 直接抛异常，表现为「点了完全没反应」。 */
    game.scene = scene;

    var pause = new PauseLayer();
    pause.zOrder = 30;
    scene.addChild(pause, 30);
    /* 截图/联调用：?pause=1 直接进入暂停态 */
    if (/(^|[?&])pause=1/.test(location.search)) {
      setTimeout(function () { scene.pauseGame(); }, 300);
    }
    scene.pause = pause;
    pause.scene = scene;               // ← 见上面 game.scene 的说明

    var over = new OverLayer();
    over.zOrder = 40;
    scene.addChild(over, 40);
    scene.over = over;
    over.scene = scene;                // ← 见上面 game.scene 的说明
    /* 截图/联调用：?over=1 直接进入 GAME OVER 层 */
    if (/(^|[?&])over=1/.test(location.search)) {
      setTimeout(function () { scene.gameOver(); }, 300);
    }

    /* 血量归零 → GAME OVER（原版是血条打空即结束，不是等歌播完） */
    scene.gameOver = function () {
      if (over.active) return;
      over.active = true;
      game.paused = true;
      game.audio.pause();
    };

    scene.update = function () { };
    scene.togglePause = function () {
      if (game.finished) return;
      if (pause.active) this.resume(); else this.pauseGame();
    };
    scene.pauseGame = function () {
      if (game.finished || pause.active) return;
      pause.active = true;
      game.paused = true;
      game.audio.pause();
    };
    scene.resume = function () {
      pause.active = false;
      game.paused = false;
      game.audio.play();
      game._wallStart = performance.now() - game.audio.getTimeMs();
    };
    scene.quit = function () {
      game.finished = true;
      game.audio.pause();
      cc.Director.replaceScene(cc.SceneList());
    };
    scene.restart = function () {
      game.finished = true;
      game.audio.pause();
      cc.Director.replaceScene(cc.SceneGame(song, mode));
    };
    return scene;
  };

  /* 结算页（scenes_menu.js）复用这里的官方按钮素材与画法：
   * 0479/0475/0480 三页底部那套蓝色胶囊是同一个 sprite，没必要各画一套。 */
  cc.GUI = GUI;
  cc._drawBlueBar = drawBlueBar;
})();
