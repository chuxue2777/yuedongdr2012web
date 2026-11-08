/* =============================================================================
 * scenes_menu.js —— 标题 / 曲目列表 / 结算
 *
 * 评定与徽章规则由结算页 19 条成就文案（hz0001~hz0019）与 12 个等级字母
 * （musiclevel000~011 = F E E+ D D+ C C+ B B+ A A+ ∞）反推，见 cc.Grade。
 *
 * 注意：本文件所有 draw() 走 canvas 原生坐标（原点左上、y 向下），
 *      触摸回调给的是 cocos 逻辑坐标（原点左下、y 向上），统一用 cy = H - y 换算。
 * ========================================================================== */
(function () {
  'use strict';
  var W = 320, H = 480;

  /* --------------------------------------------------------- 结算页实测常量
   * 全部来自官方 0480 实机截图（640×960，裁掉 176px 状态栏后 = 320×480 逻辑 @2x）。
   * 测量方法：_tmatch.py 做高通归一化互相关（压掉背景低频渐变），
   *           _panel.py 逐列扫面板上下轮廓，配合 _m0480b.py 的颜色网格采样。
   */

  /* 大评级徽章 musiclevelNNN 的目标矩形：50×58 素材像素 × 逻辑 1.226
   * → 61.3×71.0。位置由模板匹配给出（ncc 0.920，scan 2.30~2.50 步长 0.05）。 */
  var BADGE_BOX = { x: 226.0, y: 210.5, w: 61.3, h: 71.0 };

  /* 面板渐变停止点（逻辑 y）：官方同一 y 上横跨全宽颜色一致 → 纯垂直渐变 */
  var PANEL_TOP = 187, PANEL_BOT = 322;

  /* ------------------------------------------------------------- 小工具 */
  function makeLayer(init) {
    function L() { cc.Layer.call(this); if (init) init.call(this); }
    L.prototype = Object.create(cc.Layer.prototype);
    L.prototype.constructor = L;
    return new L();
  }

  function drawFrame(ctx, atlas, name, cx, cy, s, alpha) {
    var f = cc.SpriteFrameCache.get(atlas, name);
    if (!f) return false;
    var img = cc.TextureCache.get(f.png);
    if (!img || !img.complete || !img.naturalWidth) return false;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(img, f.x, f.y, f.w, f.h,
      cx - f.ow * s / 2 + f.left * s, cy - f.oh * s / 2 + f.top * s, f.w * s, f.h * s);
    ctx.restore();
    return true;
  }
  function drawFrameBox(ctx, atlas, name, x, y, w, h, alpha) {
    var f = cc.SpriteFrameCache.get(atlas, name);
    if (!f) return false;
    var img = cc.TextureCache.get(f.png);
    if (!img || !img.complete || !img.naturalWidth) return false;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(img, f.x, f.y, f.w, f.h, x, y, w, h);
    ctx.restore();
    return true;
  }
  cc.drawFrame = drawFrame;
  cc.drawFrameBox = drawFrameBox;

  /** 画图集帧的**子矩形**（素材内部再裁一块出来用）。
   *  用途：官方胶囊的两端不是独立素材 —— 圆孔+销钉在 start_left.png 的右端、
   *  ❯❯ 两片鳍在 start_right.png 的左端，都是整张图的一角，
   *  所以必须能按源坐标裁着画，不能整帧缩放（整帧缩放会把中段也一起带出来）。 */
  function drawFrameSub(ctx, atlas, name, sx, sy, sw, sh, dx, dy, dw, dh, alpha) {
    var f = cc.SpriteFrameCache.get(atlas, name);
    if (!f) return false;
    var img = cc.TextureCache.get(f.png);
    if (!img || !img.complete || !img.naturalWidth) return false;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(img, f.x + sx, f.y + sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }
  cc.drawFrameSub = drawFrameSub;

  /** 官方「三叶销钉」pz0011.png —— 就是 0467 两个按钮圆孔里那个三叶风扇。
   *
   *  ★ 这张图在图集里是当**发光叠加层**用的：整张 alpha 最高只有 97（≈38%），
   *    直接贴上去在深色圆孔里几乎看不见（试过 0.95 alpha，等于没有）。
   *    官方是叠了两三层才亮起来的，所以这里用 'lighter' 叠 3 次 ——
   *    alpha 累积到 1-(1-0.38)^3 ≈ 0.76，正好是 0467 里那种「暗孔里透出的青光」，
   *    而且像素仍然全部来自官方素材，没有自己画。 */
  function pinwheel(ctx, cx, cy, d) {
    var f = cc.SpriteFrameCache.get('title', 'pz0011.png');
    if (!f) return;
    var img = cc.TextureCache.get(f.png);
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    for (var i = 0; i < 2; i++) {
      ctx.drawImage(img, f.x, f.y, f.w, f.h, cx - d / 2, cy - d / 2, d, d);
    }
    ctx.restore();
  }

  /** 标题页按钮上的「圆孔 + 三叶销钉」，位置按 0467 实测（环心 x=65，外径 44）。
   *
   *  ★ 必须**圆形裁切**再贴：start_left 的孔段 crop 出来是矩形 89×86，
   *    四个角带着 start_left 自己的胶囊边缘和底色，直接矩形贴上去会在按钮上
   *    留下一块比周围亮一档的方形补丁（看着像贴了张纸）。
   *    裁成圆之后只剩圆环和孔，跟按钮融在一起。
   *  mirror=true 时整块水平镜像（下载列表的孔在右边）。 */
  function socket(ctx, cx, cy) {
    var f = cc.SpriteFrameCache.get('title', 'start_left.png');
    if (!f) return;
    var img = cc.TextureCache.get(f.png);
    if (!img || !img.complete || !img.naturalWidth) return;
    var R = 23;                                  // 裁切半径（略大于环外径，留住外发光）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    /* 源孔段：start_left 的 x 137..226（89）、整高 86，孔心约在 (183, 43)。
     * 目标：以 (cx,cy) 为孔心、直径 52 → 源 86 缩到 52。 */
    var d = 44;
    ctx.drawImage(img, f.x + 137, f.y, 89, 86, cx - d / 2, cy - d / 2, d, d);
    ctx.restore();
    /* 孔底压一层深色：官方 0467 的孔是「暗球 + 青色三叶」，不是一块亮青饼。
     * 不加这层，pz0011 叠 3 次以后会糊成一颗发亮的实心球，跟官方对不上。 */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 15.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,18,30,0.86)';
    ctx.fill();
    ctx.restore();
    pinwheel(ctx, cx, cy, 26);
  }

  function txt(ctx, s, x, y, size, color, align, bold, shadow) {
    ctx.save();
    ctx.font = (bold ? 'bold ' : '') + size + 'px system-ui,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    if (shadow) { ctx.shadowColor = shadow; ctx.shadowBlur = 8; }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    ctx.restore();
  }
  function textW(ctx, s, size, bold) {
    ctx.save();
    ctx.font = (bold ? 'bold ' : '') + size + 'px system-ui,"PingFang SC",sans-serif';
    var w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  }
  function btn(ctx, x, y, w, h, text, color) {
    ctx.save();
    ctx.fillStyle = color;
    cc._roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,230,255,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px system-ui,"PingFang SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    ctx.restore();
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  /* 原版歌曲行：music_left + music_mid + music_right 三片拼一条。
   * 结构（按原始图看）：左段平板 → 右端发光圆环（封面位）→ 中段填充 → 右段平板收尾。
   * 三段原始高度不同（124 / 99 / 119），必须按**同一缩放比**拼，否则接口对不齐。 */
  var ROW_PARTS = null;
  function rowParts() {
    if (ROW_PARTS) return ROW_PARTS;
    var a = cc.SpriteFrameCache.get('list', 'music_left.png');
    var b = cc.SpriteFrameCache.get('list', 'music_mid.png');
    var c = cc.SpriteFrameCache.get('list', 'music_right.png');
    if (!a || !b || !c) return null;
    ROW_PARTS = { l: a, m: b, r: c, total: a.ow + b.ow + c.ow, h: Math.max(a.oh, b.oh, c.oh) };
    return ROW_PARTS;
  }

  /** 在 (x,y,w,h) 里画一条原版行背景。
   *  拼接规则：music_left / music_right 按**行高**等比缩放（保持圆环与箭头形状），
   *  music_mid 横向拉伸填满中间剩余宽度 —— 原版就是这么用这三片的。 */
  function drawRowBg(ctx, x, y, w, h, alpha) {
    var p = rowParts();
    if (!p) { ctx.fillStyle = 'rgba(60,34,8,0.9)'; ctx.fillRect(x, y, w, h); return; }

    var s = h / p.h;                      // 按行高定缩放比
    var lw = p.l.ow * s, rw = p.r.ow * s;
    var mw = Math.max(4, w - lw - rw);    // 中段吃掉剩余宽度

    function blit(f, dx, dy, dw, dh) {
      var img = cc.TextureCache.get(f.png);
      if (!img || !img.complete || !img.naturalWidth) return;
      ctx.save();
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
      ctx.restore();
    }
    blit(p.l, x, y + (h - p.l.oh * s) / 2, lw, p.l.oh * s);
    blit(p.m, x + lw, y + (h - p.m.oh * s) / 2, mw, p.m.oh * s);
    blit(p.r, x + lw + mw, y + (h - p.r.oh * s) / 2, rw, p.r.oh * s);
  }

  /* ------------------------------------------------------------- 评定规则 */
  var GRADES = ['F', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', '∞'];
  cc.GRADES = GRADES;

  cc.Grade = {
    compute: function (res, lv) {
      var acc = res.acc, pr = res.perfectRate, total = res.total || 1;
      var perfect = res.stats.PERFECT;

      if (res.failed || acc < 60) {
        var mr = res.missRate;
        var badge = mr > 9 ? 18 : mr > 7 ? 17 : mr > 5 ? 16 : 15;   // 失误超过 9/7/5/3%
        var g = acc >= 50 ? 3 : acc >= 40 ? 2 : acc >= 30 ? 1 : 0;
        return { grade: g, badge: badge, gradeName: GRADES[g] };
      }
      if (pr >= 100) return { grade: 11, badge: 0, gradeName: GRADES[11] };              // 全中
      if (total - perfect === 1) return { grade: 10, badge: 1, gradeName: GRADES[10] };  // 差一个全中
      if (acc >= 99.999) return { grade: 10, badge: 2, gradeName: GRADES[10] };          // 正确率 100%

      var base = lv >= 9 ? 3 : lv >= 5 ? 6 : 9;    // Lv9+ / Lv5-8 / Lv1-4 三档
      if (acc >= 97) return { grade: 9, badge: base, gradeName: GRADES[9] };
      if (acc >= 93.5) return { grade: 8, badge: base + 1, gradeName: GRADES[8] };
      if (acc >= 90) return { grade: 7, badge: base + 2, gradeName: GRADES[7] };
      if (acc >= 80) return { grade: 6, badge: 12, gradeName: GRADES[6] };
      if (acc >= 70) return { grade: 5, badge: 13, gradeName: GRADES[5] };
      return { grade: 4, badge: 14, gradeName: GRADES[4] };
    }
  };

  /* ============================================================== 标题场景
   * 版式来自官方实机截图 0467（640×1136 = 320×568 逻辑 @2x）。
   *
   * ★★ 关键发现（决定了整个实现方式）：
   *   `start_bg.png` **就是官方标题页的背景层**（320×480），一张图里已经包含
   *   顶部深蓝条、中间大图窗的青色发光圆角边框、"乐动达人" logo + 白色下划线
   *   + 右侧星芒。它的**大图窗内部和下半屏是透明的**（alpha=0），
   *   所以正确顺序是：
   *       ① 铺暗底 → ② 在窗口内画 adDefaultPic（官方动漫图）→ ③ 盖 start_bg
   *       → ④ 再画「级别」条 / 两条按钮 / 底部 4 个圆形图标。
   *   （之前是反的：先盖 start_bg 再往窗口上糊图，还把 logo 盖掉了。）
   *
   * ★ 0467 与 start_bg 的关系（算过：88.5 + 480 = 568.5）：
   *   iPhone5（568 高）上是「顶部插一条 88.5 高的『升级版下载』广告条，
   *   其下原样放 start_bg 的 480 内容」。我们只有 480 高，所以是**无广告条版**，
   *   「级别」那一行压在最上面的深蓝条里（0~30）—— 这正是那条深蓝条的作用。
   *
   * ★ 素材全部官方，不程序化重画：
   *   start_bg.png        320×480  背景层（含窗口边框 + logo）
   *   adDefaultPic.png    320×260  大图窗内容（红蓝双马尾 + "乐动达人 2012"水印）
   *   level.png            28×17   「级别」二字（青色）
   *   flashlight.png       21×21   黄色闪电（经验值图标）
   *   progress_1.png      286×3    级别条下面那道细青线
   *   slots_3/4.png       320×50   按钮后面的四道拱形装饰弧
   *   start_button_0.png  320×66   「歌曲列表」整条按钮（文字已烘焙在图里）
   *   start_button_1.png  320×66   「下载列表」整条按钮
   *   menu_button_0001~4   50×50   底部 4 图标：徽章 / 排行榜 / 微博 / 完整版
   */
  var T_WIN = { x: 18, y: 41, w: 284, h: 198, r: 7 };   // 大图窗内框（start_bg 实测）
  var T_BTN = { h: 66, y1: 284, y2: 351 };              // 两条按钮的图片顶边
  var T_ICON = { y: 421, d: 44, cx: [42, 120, 199, 277] };
  var T_LABELS = ['徽　章', '排行榜', '微　博', '完整版'];

  cc.SceneTitle = function () {
    var scene = new cc.Scene();
    var layer = makeLayer(function () { this.isCustomDraw = true; this.t = 0; });

    layer.draw = function (ctx) {
      var t = this.t;

      /* ① 底：官方标题页的底色是近黑的深海军蓝，窗口外面还带一点冷光 */
      ctx.fillStyle = '#01050a';
      ctx.fillRect(0, 0, W, H);
      var rg = ctx.createRadialGradient(W / 2, 130, 20, W / 2, 130, 250);
      rg.addColorStop(0, 'rgba(24,80,140,0.30)');
      rg.addColorStop(1, 'rgba(1,5,10,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);

      /* ② 大图窗内容：adDefaultPic 320×260 **按原尺寸**摆进窗口再裁。
       *    ★ 一开始我按窗口宽度（284）等比放大了 1.13 倍，结果两个角色的头
       *      比官方大一圈、窗口只露出脸。官方是**原尺寸居中裁切**：
       *      320 宽的图放进 284 宽的窗口 → 左右各裁 18，纵向只裁一点。
       *    往上偏 8：官方 0467 里头顶几乎是贴窗口上沿的。 */
      ctx.save();
      ctx.beginPath();
      cc._roundRect(ctx, T_WIN.x, T_WIN.y, T_WIN.w, T_WIN.h, T_WIN.r);
      ctx.clip();
      var ws = 0.8875;                       // 官方窗口内容比例（284/320）
      drawFrameBox(ctx, 'title', 'adDefaultPic.png',
        T_WIN.x, T_WIN.y - 6, 320 * ws, 260 * ws, 1);
      ctx.restore();

      /* ③ 盖背景层（窗口边框 + logo 都在这一张里） */
      drawFrameBox(ctx, 'title', 'start_bg.png', 0, 0, W, H);

      /* ④ 级别条。0467 实测（物理 → 逻辑）：level.png x 24..80 / y 4..38 以外的部分
       *    全是文字排版，这里按 0467 的实际字位摆。 */
      drawFrameBox(ctx, 'title', 'level.png', 12, 5, 28, 17);
      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = 'bold 15px "Helvetica Neue",Helvetica,Arial,sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('1', 47, 14);
      ctx.font = 'bold 11px "Helvetica Neue",Helvetica,Arial,sans-serif';
      ctx.fillStyle = 'rgba(232,252,255,0.92)';
      ctx.fillText('(0/50)', 63, 15);
      drawFrameBox(ctx, 'title', 'flashlight.png', 196, 4, 21, 21);
      ctx.font = 'bold 15px "Helvetica Neue",Helvetica,Arial,sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('0', 224, 14);
      ctx.restore();
      drawFrameBox(ctx, 'title', 'progress_1.png', 17, 31, 286, 3, 0.9);

      /* ⑤ 两条全宽胶囊按钮 —— 直接用官方整条素材。
       *
       *    ★ 位置/宽度不是猜的：start_button_0 里「歌曲列表」白字中心在
       *      x=171.0，0467 实测官方白字 bbox 是 125.5~220.0 → 中心 172.75，
       *      差 1.75；start_button_1 的「下载列表」字中心 138.5，官方 138.75。
       *      → 两张素材就是「320 宽 1:1 铺满」的尺寸，不用缩放也不用位移。
       *
       *    ★ 但 start_button_0/1 里**没有圆孔球**，而 0467 上两只按钮各有一个：
       *      歌曲列表在左、下载列表在右（一左一右对称）。图集里有现成的：
       *      start_left.png 的**右端**就是「圆孔 + 销钉」（226×86，孔在 x≈138~226）。
       *      用 drawFrameSub 按源坐标裁出来贴上去，孔里的三叶球用 pz0011。 */
      /* ★ 改成和死亡页/暂停页**同一套**胶囊按钮（cc._drawBlueBar）：
       *   0467 实测两条按钮 top=296 / 366、条高 50 → 中心 321 / 391。
       *   之前贴的是 start_button_0/1 那两张「扁条 + 烘死文字」素材，
       *   再叠 socket 圆孔，观感和官方那种玻璃胶囊差一截。 */
      cc._drawBlueBar(ctx, 321, '歌曲列表', 'left');
      cc._drawBlueBar(ctx, 391, '下载列表', 'right');

      /* ⑥ 底部 4 个圆形图标。★ 素材里**已经烘焙了名称**（徽章/排行榜/微博/
       *    完整版，青色小字在图标下方），所以这里绝对不能再自己 fillText，
       *    否则会重影成两行。 */
      for (var i = 0; i < 4; i++) {
        var cx = T_ICON.cx[i];
        var cd = T_ICON.d;
        drawFrameBox(ctx, 'title', 'menu_button_000' + (i + 1) + '.png',
          cx - cd / 2, T_ICON.y, cd, cd);
      }
    };

    layer.update = function (dt) { this.t += dt; };
    layer.onTouchBegan = function () { cc.Director.replaceScene(cc.SceneList()); return true; };
    layer.onKeyDown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') { cc.Director.replaceScene(cc.SceneList()); return true; }
      return false;
    };
    scene.addChild(layer, 0);
    return scene;
  };

  /* ============================================================ 歌曲列表页
   * 版式 100% 来自实机截图 0468（640×960 = 320×480 逻辑画面 @2x）。
   *
   * ★★ 唯一换算规则：逻辑坐标 = 截图像素 / 2。**只除一次**。
   *
   * 所有可见图形一律从 list 图集直铺，不程序化重画（重画必成重影）：
   *   musicback_up.png    320×204 像素   整块大卡（标题条+放射纹+波浪底边）
   *   moremusic.png       147×21  像素   「更多歌曲请下载...」黄字
   *   musicbedge011~018   37×37   像素   行右徽章（∞ / 70 / 60 / 4 个头像）
   *   musiclistlevel000~011 9~17×9~14   难度等级字（F,E,E+,D,D+,C,C+,B,B+,A,A+,∞）
   *   levelstar000/001/002 19×16  像素   难度斜纹三态（亮 / 半 / 暗）
   *   NumLevel001~010     37×12   像素   「LV.n」
   *   music_left/mid/right               选中行橙金胶囊三段
   *   bedge_bg_0/1.png    120×40  像素   大卡右侧深色横槽
   *   musiclevel000~011   74×74   像素   大卡难度大字
   *
   * 实测关键 Y（逻辑，= py/2）：
   *   0~204      大卡（左侧满高 195，右侧波浪收到 183）
   *   219~234    「更多歌曲请下载...」
   *   252.5~255  列表顶部青线
   *   264~274.5  第 1 行曲名（中心 269.2）→ 行距 46.8
   *   406.5~408.5 第 2 行底青线
   *   458~460    页码条上沿青线；圆心 468.5
   */
  var HEAD_Y = 0;
  var HEAD_H = 16;          // 标题条高（py 0~32）
  var CARD_H = 204;         // musicback_up 1:1 铺 320×204 逻辑
  var CARD_BOT = 195;       // 大卡左侧视觉底边（py 390）
  var MORE_Y = 219;         // 「更多歌曲请下载...」矩形顶（py 438）
  var MORE_H = 15;          // 高（py 438~468）
  var LIST_TOP = 252.5;     // 列表裁剪区顶（py 505）
  /* ★ 行距 = 51（0468 实测）：可见曲名中心 Y≈269（第1行）、373（第3行）、
   *   423（第4行），第2行被选中带盖住 → (373-269)/2 = 52、(423-373) = 50。
   *   （踩过的坑：把「歌手/时长」那一行误当成下一行曲名，算成了 46.5。） */
  var ROW_H = 51;
  var ROW_NAME_DY = 16.5;   // 行顶 → 曲名中心
  var ROW_SUB_DY = 35;      // 行顶 → 歌手/时长中心
  var BADGE_Y = 25;         // 行顶 → 徽章中心 y
  var PAGE_TOP = 458.0;     // 页码条上沿（py 916）
  var PAGE_CY = 468.5;      // 页码圆心 Y（py 937）
  /* 0468 实测：10 个圆铺满整宽。第 3 个圆心 x=80 逻辑（px 160），
   * 满分 10 个 → x0=16、间距 32（16..304）。之前 9/14 挤在左边一小坨。 */
  var PAGE_X0 = 16;         // 第 1 个圆点圆心 x
  var PAGE_DX = 32;         // 圆点间距

  /* 0468 实测：原版配置表里的显示时长（字符串），与音频真实时长不同。
   * 只用于 UI 显示，不参与谱面/判定计时，所以不改 songs.js 的数据。
   * 依据：大卡「02:18」(与 starhead.png 右下自带黄标一致)、
   *       列表 1/3/4 行「01:40」「02:49」「02:41」。 */
  var SHOW_TIME = {
    '120001': '01:40', '120002': '02:18',
    '120003': '02:49', '120004': '02:41'
  };
  function showTime(s) { return SHOW_TIME[s.id] || s.time; }

  /* 难度等级表：index = 0..11 → F,E,E+,D,D+,C,C+,B,B+,A,A+,∞
   * 截图里 LV.1 亮 2 格、LV.4 亮 3 格、LV.5 亮 4 格 → lit = min(6, 1+floor(lv/2)) */
  var LV_NAME = ['F', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', '∞'];
  function lvFrame(lv) {
    var i = Math.max(0, Math.min(11, (lv | 0)));
    return 'musiclistlevel' + (i < 10 ? '00' : '0') + i + '.png';
  }
  function lvFrameBig(lv) {
    var i = Math.max(0, Math.min(11, (lv | 0)));
    return 'musiclevel' + (i < 10 ? '00' : '0') + i + '.png';
  }
  function lvLit(lv) {
    return Math.max(1, Math.min(6, 1 + Math.floor((lv | 0) / 2)));
  }

  /* 行右徽章：0468 放大实测，原版是**程序化绘制**的，不是图集帧：
   *   蓝色发光圆环 + 中心白色双环 ∞ + 徽章左侧一列 3 个青色小方格。
   *   musicbedge 系列是紫色评级章，用在结算页（之前误用，已撤销）。
   *   绘制函数 drawRowBadge() 定义在 cc.SceneList 内部（见 drawRow 上方）。 */

  function moreTop() { return MORE_Y; }
  function viewTopOf() { return LIST_TOP; }
  function viewBotOf() { return PAGE_TOP; }

  cc.SceneList = function () {
    var scene = new cc.Scene();
    scene.mode = cc.Store.get('mode', '3');
    scene.sel = 1;                 // 原版 0468 初始选中「狂想曲」（列表第 2 行）
    scene.scroll = 0;
    scene.scrollTo = 0;
    scene._drag = null;

    function listH() { return SONGS.length * ROW_H; }
    function maxScroll() {
      return Math.max(0, listH() - (viewBotOf() - viewTopOf()));
    }

    var layer = makeLayer(function () { this.isCustomDraw = true; this.t = 0; });

    /* ---------------------------------------------------- 图集帧直铺工具
     * blitF：按帧原始像素尺寸铺（= 逻辑尺寸，因为原版美术就是 @1x 尺寸）
     * blitR：按目标矩形铺（自己负责等比/拉伸） */
    function frame(name, atlas) {
      return cc.SpriteFrameCache.get(atlas || 'list', name);
    }
    function blitF(ctx, name, dx, dy, atlas, alpha) {
      var f = frame(name, atlas);
      if (!f) return false;
      var img = cc.TextureCache.get(f.png);
      if (!img || !img.complete || !img.naturalWidth) return false;
      ctx.save();
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
      ctx.restore();
      return true;
    }
    function blitR(ctx, name, dx, dy, dw, dh, atlas, alpha) {
      var f = frame(name, atlas);
      if (!f) return false;
      var img = cc.TextureCache.get(f.png);
      if (!img || !img.complete || !img.naturalWidth) return false;
      ctx.save();
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
      ctx.restore();
      return true;
    }
    /* 按帧居中铺：cx/cy 是目标中心，用帧原始尺寸 */
    function blitC(ctx, name, cx, cy) {
      var f = frame(name);
      if (!f) return false;
      return blitF(ctx, name, cx - f.w / 2, cy - f.h / 2);
    }

    /* ------------------------------------------------------- 大卡底图
     * musicback_up.png 是 320×204 **像素**，原版 1:1 铺满 320 宽 → 320×204 逻辑。
     * 验证：图集里底边波浪在 x=0..160 处 y=194、x=208+ 处 y=183，
     *      与 0468 截图实测（Y 195 / 183）逐点吻合，说明就是 1:1。 */
    function drawHead(ctx) {
      blitF(ctx, 'musicback_up.png', 0, 0);
      /* 返回按钮：MenuReturn.png 50×25 像素，右贴边（px 566 → x 283） */
      blitF(ctx, 'MenuReturn.png', W - 37, 4);
    }

    /* ------------------------------------------------ 选中大卡动态内容
     * 全部逻辑坐标（= 0468 像素 / 2）。
     *   左封面    x 13~108、Y 22~175（左边圆角 20，白描边）
     *   两个大∞   中心 (165.5, 71.5) 与 (165.5, 131.5)，49.5×22.5
     *   两行横槽  左端 x 206 / 203，Y 40 / 100（高 40，右端溢出）
     *   时长黄标  x 78~150、Y 155~172
     *   LV.n+格   Y 161~175，LV 图 x 146，六格 x 208 起、间距 19
     *   n/N       x 310 右对齐、Y 190
     */
    /* 槽内三张圆形缩略图。官方是「照片 + 35% 白玻璃（玻璃在 bedge_bg 里）」，
     * 所以这里只画照片，白玻璃由随后盖上的 bedge_bg_0/1 提供。
     * 圆盘中心（相对槽左端，从 bedge_bg 里逐列量出来）：21.5 / 57 / 92.5，直径 29。 */
    var THUMB_DX = [21.5, 57.0, 92.5];
    function thumbDiscs(ctx, img, baseX, baseY, row) {
      if (!img || !img.complete || !img.naturalWidth) return;
      var iw = img.naturalWidth, ih = img.naturalHeight, r = 14.5;
      /* ★ 取景要**放大**：官方 0468 里那三个圆是暖色调的视频帧**特写**
       *   （人物面部），而我一开始按 0.86 倍整张封面缩进去，结果每个圆里
       *   都是「萧敬腾」三个小字 + 整张半身像，缩小后糊成一片灰。
       *   改成取 0.5 倍边长的方形（脸部区域），再补一层暖色 multiply 染色，
       *   才接近官方那种"橙色小人像"的观感。 */
      var sw = Math.min(iw, ih) * 0.5;
      for (var i = 0; i < 3; i++) {
        var cx = baseX + THUMB_DX[i], cy = baseY + 20;
        var sx = (iw - sw) * (0.06 + i * 0.44);
        var sy = (ih - sw) * (row ? 0.30 : 0.02);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sw, cx - r, cy - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = '#ffcf9a';
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
      }
    }

    function drawCard(ctx, song, idx) {
      /* ---- 左封面：0468 实测框 x 13~125、Y 35~175（112×140 逻辑）----
       * ★ starhead.png(120×150) 原图**自带**圆角白框、左侧歌手标签、
       *   右下「02:18」黄标。原版就是把整张图按 ~0.93 缩放贴上去，
       *   不裁切、不放大、也不另画白框。之前用 cover 放大裁切导致人像
       *   被撑满、标签只剩半个字，程序白框又和源图白框叠成重影。 */
      var cx = 13, cyT = 35, cw = 112, chh = 140;
      var url = 'assets/songs/' + song.id + '/starhead.png';
      var cover = cc.TextureCache.addImage(url);
      if (cover && cover.complete && cover.naturalWidth) {
        ctx.drawImage(cover, 0, 0, cover.naturalWidth, cover.naturalHeight,
          cx, cyT, cw, chh);
      } else {
        /* 未就绪：深色占位 + 默认头像（loadstarhead.png 40×40） */
        var dflt = cc.TextureCache.addImage('assets/songs/' + song.id + '/loadstarhead.png');
        ctx.fillStyle = '#1b1b22';
        ctx.fillRect(cx, cyT, cw, chh);
        if (dflt && dflt.complete && dflt.naturalWidth) {
          ctx.globalAlpha = 0.5;
          ctx.drawImage(dflt, cx + cw / 2 - 20, cyT + chh / 2 - 20, 40, 40);
          ctx.globalAlpha = 1;
        }
      }

      /* ---- 两个大 ∞（青色，带深色描边）----
       * 原版是纯符号（不是徽章），用音乐bedge011 的「∞」不是它 —— 这里用
       * 字体画并加多重描边模拟原版：内层亮青、外层深蓝、带右下投影。 */
      drawInf(ctx, 165.5, 71.5);
      drawInf(ctx, 165.5, 131.5);

      /* ---- 时长黄标：0468 实测 X 83~129、Y 155~172，黑色数字 ---- */
      ctx.save();
      ctx.fillStyle = '#ffd633';
      cc._roundRect(ctx, 83, 155, 46, 17, 4);
      ctx.fill();
      ctx.restore();
      txt(ctx, showTime(song), 106, 163.5, 11, '#2b1a00', 'center', true);

      /* ---- 右侧两行横槽 bedge_bg（120×40 像素 → 120×40 逻辑）
       * 实测 0468：槽 1 左端 X=206、槽 2 左端 X=203，右端都超出 320 屏边。
       *
       * ★ 槽里的三个圆盘不是纯装饰：bedge_bg_0/1.png 里那三个圆是
       *   **35% 白玻璃**（实测 rgba(255,255,255,88)），官方是把
       *   「曲包预览缩略图」画在它**下面**，再被这层白玻璃蒙一层雾 ——
       *   0468 放大看就是三张发灰的照片。
       *   之前我只画了槽、没画底图，那三个圆直接透出红橙放射纹，
       *   于是变成三个暗红色实心圆，跟官方完全不像。
       *   这里用本曲封面 starhead.png 的三个不同裁位当缩略图（同一张官方图，
       *   不自己生造内容），叠在槽下面。 */
      thumbDiscs(ctx, cover, 206, 40, 0);
      blitF(ctx, 'bedge_bg_0.png', 206, 40);
      thumbDiscs(ctx, cover, 203, 100, 1);
      blitF(ctx, 'bedge_bg_1.png', 203, 100);

      /* ---- LV.n + 六格难度（Y 161~175）
       * 0468 实测：大卡的「LV.3」是**黑色粗体文字**（x 171~220），不是
       * NumLevel 图（那是白底蓝字，用在大卡以外的地方）。六格 x 220 起。 */
      var lv = song.lv || 1;
      ctx.save();
      ctx.font = 'bold 17px system-ui,"PingFang SC",Arial,sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000000';
      ctx.shadowColor = 'rgba(255,240,180,0.45)';
      ctx.shadowBlur = 2;
      ctx.fillText('LV.' + lv, 164, 167);
      ctx.restore();
      var lit = lvLit(lv);
      for (var s2 = 0; s2 < 6; s2++) {
        blitR(ctx, s2 < lit ? 'levelstar000.png' : 'levelstar002.png',
          220 + s2 * 19, 161, 17, 14);
      }

      /* ---- 右下 n/N（x 310 右对齐、Y 190） ---- */
      txt(ctx, (idx + 1) + '/' + SONGS.length, 310, 190, 12,
        '#ffffff', 'right', true, 'rgba(0,0,0,0.85)');
    }

    /* 画一个「∞」：用**双纽线参数方程**采样成闭合路径再粗描边。
     * 0468 实测轮廓（逻辑）：外框 x 141~190（宽 49）、Y 61~83（高 22），
     *   左环内孔 x 145.5~161、右环 x 169.5~185.5，孔径约 15.5×12。
     *   x = A·cos t/(1+sin²t),  y = B·sin t·cos t/(1+sin²t)
     *   A=24.5（总宽 49），B=22（描边后总高约 22），线宽 7.2。
     * 之前用两个独立椭圆环会画成「8」字/两个圆点，参数方程才是真 ∞。 */
    function drawInf(ctx, cx, cy) {
      /* 0468 实测外接 49.5×22.5：lemniscate 的 x 峰值 = A，y 峰值 = 0.348B，
       * 再加上描边半宽 → A + lw/2 = 24.75、0.348B + lw/2 = 11.25。
       * 之前 A=24.5/lw=7.2 外接 56 宽，比官方大一圈，而且洞被挤没了。 */
      var A = 21.7, B = 23.6, lw = 6.0;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      function path() {
        ctx.beginPath();
        for (var i = 0; i <= 72; i++) {
          var t = i / 72 * Math.PI * 2;
          var s = Math.sin(t), c = Math.cos(t), d = 1 + s * s;
          var x = cx + A * c / d;
          var y = cy + B * s * c / d;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      /* 1) 投影 */
      ctx.save();
      ctx.translate(0, 2.4);
      ctx.lineWidth = lw + 3.0;
      ctx.strokeStyle = 'rgba(96,26,8,0.5)';
      path(); ctx.stroke();
      ctx.restore();
      /* 2) 外层深蓝 */
      ctx.lineWidth = lw + 2.2;
      ctx.strokeStyle = '#0b3f70';
      path(); ctx.stroke();
      /* 3) 中层青 */
      ctx.lineWidth = lw + 0.9;
      ctx.strokeStyle = '#3fd6ee';
      path(); ctx.stroke();
      /* 4) 内层亮青渐变 */
      var g = ctx.createLinearGradient(cx, cy - 12, cx, cy + 12);
      g.addColorStop(0, '#f0feff');
      g.addColorStop(0.38, '#8df6ff');
      g.addColorStop(1, '#0fa2c8');
      ctx.lineWidth = lw;
      ctx.strokeStyle = g;
      path(); ctx.stroke();
      ctx.restore();
    }

    /* ------------------------------------------------------- 行右徽章
     * 0468 逐像素实测（逻辑坐标）：
     *   蓝环外框 x 233~261 / 281~309 → 中心 247 / 295，半径 14
     *   方格列   x 222~228 / 270~276 → 中心 225 / 273（= 蓝环 -22）
     *   蓝环中心 Y ≈ 282（= 行顶 + 27.5），方格列 Y 277~295
     *   环内深青半透明；环线上半亮蓝、下半暗青，带外发光
     *   中心是**两个白色细圆环**相切（眼镜状 ∞），不是连笔符号
     * 原版不是图集帧（musicbedge 是结算页紫色评级章），按实测重绘。
     */
    function drawRowBadge(ctx, cx, cy) {
      ctx.save();
      /* 左侧一列 3 个青色小方格（青边 + 深色内芯） */
      var sx = cx - 25.5, sy = cy - 9;
      for (var k = 0; k < 3; k++) {
        var yy = sy + k * 6.4;
        ctx.fillStyle = 'rgba(3,26,32,0.85)';
        ctx.fillRect(sx, yy, 7, 5.4);
        ctx.strokeStyle = '#2ad9c0';
        ctx.lineWidth = 1.1;
        ctx.strokeRect(sx + 0.5, yy + 0.5, 6, 4.4);
      }
      /* 环内深青底 */
      ctx.beginPath();
      ctx.arc(cx, cy, 13.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(4,38,54,0.55)';
      ctx.fill();
      /* 蓝色发光环：外晕 + 上亮下暗渐变 */
      ctx.shadowColor = 'rgba(30,170,255,0.95)';
      ctx.shadowBlur = 7;
      var rg = ctx.createLinearGradient(cx, cy - 15, cx, cy + 15);
      rg.addColorStop(0, '#49d8ff');
      rg.addColorStop(0.55, '#1b9fe0');
      rg.addColorStop(1, '#0d6b8c');
      ctx.strokeStyle = rg;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx, cy, 13.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      /* 中心白色双环 ∞（深色内芯 + 白色粗描边） */
      ctx.lineWidth = 2.1;
      ctx.strokeStyle = '#e8f6f8';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 2;
      for (var j = -1; j <= 1; j += 2) {
        ctx.beginPath();
        ctx.arc(cx + j * 5.2, cy - 0.4, 4.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6,20,26,0.9)';
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ------------------------------------------------------- 普通列表行
     * 实测（逻辑）：
     *   曲名   青色粗体 x 19.5 起，中心 Y = 行顶 + 16.5，字号 13
     *   歌手   x 19.5，时长 x 58，中心 Y = 行顶 + 35，字号 11
     *   LV.n   **纯白粗体文字** x 164、Y 行顶+16.5（不是 NumLevel 图）
     *   难度格 0468 实测在 LV 文字**正下方**：x 138 起、间距 12.5、Y 行顶+26
     *   徽章1/2 中心 x 247 / 295，Y 行顶+27.5
     */
    function drawRow(ctx, s, i, y) {
      var cy = y + BADGE_Y + 2.5;          // 0468 实测蓝环中心 = 行顶 + 27.5
      txt(ctx, s.name, 19.5, y + ROW_NAME_DY, 13, '#5fe0ff', 'left', true, 'rgba(0,0,0,0.9)');
      txt(ctx, s.singer || '', 19.5, y + ROW_SUB_DY, 11, '#ffffff', 'left', false, 'rgba(0,0,0,0.9)');
      txt(ctx, showTime(s), 58, y + ROW_SUB_DY, 11, '#ffffff', 'left', false, 'rgba(0,0,0,0.9)');

      /* LV.n：0468 实测是纯白粗体文字（白、带极淡阴影），不是贴图 */
      var lv = s.lv || 1;
      ctx.save();
      ctx.font = 'bold 14px system-ui,"PingFang SC",Arial,sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 3;
      ctx.fillText('LV.' + lv, 164, y + ROW_NAME_DY);
      ctx.restore();
      /* 六格斜纹：0468 实测在 LV 文字正下方（x 138 起、间距 12.5、Y 行顶+26），
       * 不是 LV 右侧。首格亮、其余暗，由 levelstar000/002 表现。 */
      var lit = lvLit(lv);
      for (var s2 = 0; s2 < 6; s2++) {
        blitR(ctx, s2 < lit ? 'levelstar000.png' : 'levelstar002.png',
          138 + s2 * 12.5, y + 25, 11, 11);
      }
      /* 两个徽章（程序化绘制，实测中心 247 / 295） */
      drawRowBadge(ctx, 247, cy);
      drawRowBadge(ctx, 295, cy);
    }

    /* ------------------------------------------------- 选中行橙金胶囊
     * 0468 实测：整条 Y 281~375（高约 94 的软光晕，主体 292~366）。
     * 三段原版美术：
     *   music_left  267×124 px  右端有金圆环（圆环中心靠右）
     *   music_mid   320×99  px  纯横向长条（左右可拉伸）
     *   music_right 241×119 px  左端是**向左的箭头**
     * 拼法：left 贴屏幕左（负偏移让圆环落到 X≈100），mid 接在其后横向拉伸，
     *       right 贴屏幕右（负偏移让箭头落到 X≈285）。
     * 三段按各自 oh 等比缩放到同一「主体高度」49（对应 Y 297~346 的亮带）。
     */
    /* 0468 实测（x=280 纵剖）：亮金上沿 290~302、内腔 304~336（接近纯黑）、
     * 下沿 338~349 → 整条 290~349、高 59、中心 319.5。
     * 之前 49 高 + 中心 330.5，整条偏下偏扁，内腔还发亮。 */
    var SEL_BODY = 58;
    function drawSelBand(ctx, s, y) {
      var L = frame('music_left.png'), M = frame('music_mid.png'), R = frame('music_right.png');
      if (!L || !M || !R) return;
      var cy = y + BADGE_Y - 11;               // 选中带中心（0468：319.5）
      function bl(f, dx, dy, dw, dh) {
        var img = cc.TextureCache.get(f.png);
        if (!img || !img.complete || !img.naturalWidth) return;
        ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
      }
      /* 各段按**自身 oh** 缩放，使可见主体落到 SEL_BODY 高 */
      var sl = SEL_BODY / L.oh, sm = SEL_BODY / M.oh, sr = SEL_BODY / R.oh;
      var lw = L.ow * sl, lh = L.oh * sl;
      var mw = M.ow * sm, mh = M.oh * sm;
      var rw = R.ow * sr, rh = R.oh * sr;

      var lx = -100;                           // 让 music_left 自带小圆环完全出屏
      var rx = W - 78;                         // right 左端（箭头落 X≈285）
      var mx = lx + lw;                        // mid 紧接 left
      var mwUse = rx - mx;

      /* ★ music_mid 帧中间是**全透明**的（实测 alpha=0），原版在它下面
       * 垫了一层橙金横条；不垫就透出页面黑底，整条发黑。 */
      var bg = ctx.createLinearGradient(0, cy - SEL_BODY / 2, 0, cy + SEL_BODY / 2);
      bg.addColorStop(0.00, 'rgba(255,214,140,0.98)');
      bg.addColorStop(0.06, 'rgba(224,150,30,0.98)');
      bg.addColorStop(0.20, 'rgba(96,58,6,0.98)');
      bg.addColorStop(0.42, 'rgba(40,25,1,0.98)');
      bg.addColorStop(0.68, 'rgba(30,19,0,0.98)');
      bg.addColorStop(0.88, 'rgba(78,46,2,0.98)');
      bg.addColorStop(1.00, 'rgba(196,128,20,0.98)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, cy - SEL_BODY / 2, W, SEL_BODY);

      bl(L, lx, cy - lh / 2, lw, lh);
      bl(M, mx, cy - mh / 2, mwUse, mh);
      bl(R, rx, cy - rh / 2, rw, rh);

      /* ---- 左端金色圆盘：0468 实测中心 (38, 326.5)、外径约 66（逻辑）----
       * 原版 = 深棕底 + 一圈淡金扇形 + 中心深棕圆 + 内圈细金线 + 亮金细外环。
       * pz_0010.png 是半透明淡金扇形环（中心全透明），用 source-over 叠即可；
       * 之前用 lighter 会把扇形烧成亮橙，与原版淡金不符。 */
      var dx = 38, dy = cy - 3.5;
      ctx.save();
      /* 深棕底 */
      ctx.beginPath();
      ctx.arc(dx, dy, 25, 0, Math.PI * 2);
      ctx.fillStyle = '#4a2200';
      ctx.fill();
      /* 4 个淡金扇形（0468 实测：径向 13~24、每段约 78°、间隔 12°）
       * pz_0010 是半透明淡黄扇形环，直接 source-over 叠在深底上会看不见，
       * 先用实心扇形保证形状对比，再用原版帧低强度 lighter 补一层柔光。 */
      ctx.fillStyle = '#eec47a';
      for (var k = 0; k < 4; k++) {
        var a0 = -Math.PI / 2 + k * Math.PI / 2 + 0.42;
        var a1 = a0 + Math.PI / 2 - 0.26;
        ctx.beginPath();
        ctx.arc(dx, dy, 24, a0, a1);
        ctx.arc(dx, dy, 13, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      var fz = frame('pz_0010.png');
      if (fz) {
        var zi = cc.TextureCache.get(fz.png);
        if (zi && zi.complete && zi.naturalWidth) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.20;
          ctx.drawImage(zi, fz.x, fz.y, fz.w, fz.h, dx - 30, dy - 29, 60, 58);
          ctx.restore();
        }
      }
      /* 中心深棕圆 + 内圈细金线 */
      ctx.beginPath();
      ctx.arc(dx, dy, 13.5, 0, Math.PI * 2);
      ctx.fillStyle = '#3a1800';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dx, dy, 20, 0, Math.PI * 2);
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(255,205,100,0.85)';
      ctx.stroke();
      /* 亮金细外环 */
      ctx.beginPath();
      ctx.arc(dx, dy, 31, 0, Math.PI * 2);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#ffe08a';
      ctx.shadowColor = 'rgba(255,190,40,0.95)';
      ctx.shadowBlur = 7;
      ctx.stroke();
      ctx.restore();

      /* 曲名：白粗体 + 黑描边，实测 px 184 → x 92 */
      ctx.save();
      ctx.font = 'bold 19px system-ui,"PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.strokeText(s.name, 92, cy + 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.name, 92, cy + 1);
      ctx.restore();
      /* GO：白色斜体粗体，实测 px 452 → x 226 */
      ctx.save();
      ctx.font = 'italic 900 26px "Arial Black",system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.strokeText('GO', 226, cy + 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('GO', 226, cy + 1);
      ctx.restore();
    }

    layer.draw = function (ctx) {
      /* ★ 坐标系：cc.Director 渲染前已 setTransform(k,0,0,k,0,0)，
       *   这里直接用 320×480 逻辑坐标画，不要再套任何 transform。 */
      ctx.save();

      /* 原版底 = 纯黑 */
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      /* 1) 大卡底图（含标题条 + 放射纹 + 波浪黑边），1:1 原样铺 */
      drawHead(ctx);

      /* 2) 选中大卡上的动态内容 */
      var cur = SONGS[scene.sel] || SONGS[0];
      if (cur) drawCard(ctx, cur, scene.sel);

      /* 3) 「更多歌曲请下载...」黄字 */
      blitR(ctx, 'moremusic.png', 86.5, MORE_Y, 113.5, MORE_H);

      /* 4) 列表（裁剪区 LIST_TOP ~ PAGE_TOP） */
      var vt = viewTopOf(), vb = viewBotOf();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, vt, W, vb - vt);
      ctx.clip();

      /* 顶部青线（musiclist_bg 305×7 像素，从 x=7 起） */
      blitF(ctx, 'musiclist_bg.png', 7, LIST_TOP);

      var y0 = vt + 2 - scene.scroll;
      for (var i = 0; i < SONGS.length; i++) {
        var y = y0 + i * ROW_H;
        if (y > vb + ROW_H || y + ROW_H < vt - ROW_H) continue;
        if (i === scene.sel) continue;         // 选中行由 drawSelBand 整条覆盖
        drawRow(ctx, SONGS[i], i, y);
      }
      /* 选中带叠在行上 */
      var ys = y0 + scene.sel * ROW_H;
      if (ys < vb + ROW_H && ys + ROW_H > vt - ROW_H) {
        drawSelBand(ctx, SONGS[scene.sel], ys);
      }
      ctx.restore();

      /* 5) 底部页码：上沿青线 + 10 个圆点 */
      blitF(ctx, 'musiclist_bg.png', 7, PAGE_TOP);
      for (var p = 0; p < 10; p++) {
        var px = PAGE_X0 + p * PAGE_DX;
        /* 0468 实测：右下角「2/8」且第 **2** 个圆点蓝色高亮 → 页码 = sel+1 */
        var on = (p === scene.sel % 10);
        ctx.beginPath();
        ctx.arc(px, PAGE_CY, 7.2, 0, Math.PI * 2);
        if (on) {
          ctx.save();
          ctx.shadowColor = 'rgba(70,215,255,0.95)';
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#20c2f5';
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = '#0a2c3d';
          ctx.fill();
          ctx.strokeStyle = 'rgba(48,132,170,0.55)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        txt(ctx, String(p + 1), px, PAGE_CY + 0.4, (p === 9 ? 7.6 : 8.8),
          on ? '#ffffff' : 'rgba(120,196,225,0.9)', 'center', true);
      }

      ctx.restore();
    };

    layer.update = function (dt) {
      this.t += dt;
      scene.scroll += (scene.scrollTo - scene.scroll) * Math.min(1, dt * 14);
    };

    function rowAt(cy) {
      var vt = viewTopOf(), vb = viewBotOf();
      if (cy < vt || cy > vb) return null;
      var idx = Math.floor((cy - (vt + 2) + scene.scroll) / ROW_H + 0.5);
      if (idx < 0 || idx >= SONGS.length) return null;
      return idx;
    }

    layer.onTouchBegan = function (x, y) {
      var cy = H - y;
      /* 页码区：只吃点击，不拖动。右半区切换 3 键/4 键（网页版兜底，不画文字） */
      if (cy > PAGE_TOP) {
        if (x > W - 60) {
          scene.mode = scene.mode === '3' ? '4' : '3';
          cc.Store.set('mode', scene.mode);
        }
        return true;
      }
      /* 标题条：右侧 40px 是返回按钮 */
      if (cy < HEAD_Y + HEAD_H + 12) {
        if (x > W - 40) { cc.Director.replaceScene(cc.SceneTitle()); return true; }
        return true;
      }
      /* 大卡区：点一下直接进游戏 */
      if (cy > HEAD_H && cy < CARD_BOT) {
        cc.Director.replaceScene(cc.SceneLoading(SONGS[scene.sel], scene.mode));
        return true;
      }
      scene._drag = { cy: cy, startScroll: scene.scroll, moved: 0 };
      return true;
    };
    layer.onTouchMoved = function (x, y) {
      if (!scene._drag) return;
      var cy = H - y;
      var dy = cy - scene._drag.cy;
      scene._drag.moved = Math.max(scene._drag.moved, Math.abs(dy));
      scene.scrollTo = cc.clamp(scene._drag.startScroll - dy, 0, maxScroll());
      scene.scroll = scene.scrollTo;
    };
    layer.onTouchEnded = function (x, y) {
      var d = scene._drag;
      scene._drag = null;
      if (!d || d.moved > 8) return;
      var idx = rowAt(H - y);
      if (idx === null) return;
      if (idx === scene.sel) {
        cc.Director.replaceScene(cc.SceneLoading(SONGS[idx], scene.mode));
      } else {
        scene.sel = idx;                 // 第一次点选中并显示大卡，再点一次进入
      }
    };
    layer.onKeyDown = function (e) {
      if (e.key === 'Escape') { cc.Director.replaceScene(cc.SceneTitle()); return true; }
      return false;
    };

    scene.addChild(layer, 0);
    scene.update = function () {
      var m = maxScroll();
      if (scene.scrollTo > m) scene.scrollTo = m;
      if (scene.scroll > m) scene.scroll = m;
    };
    return scene;
  };

  function SonGS_count() { return SONGS.length; }

  /* ========================================================== 歌曲设置页 */
  /* 版式来自截图 0469。**注意这张是全屏 320×568**（640×1136 @2x，无状态栏
   * 黑边），不是演奏页的 320×480 —— 2013 版在 iPhone5 上菜单/设置撑满屏幕，
   * 进入演奏才切回 480。所以这里用 SH=568 单独算坐标。
   *
   * 按 0469 竖扫分段（逻辑 y，原点左下）：
   *   568~500  升级版下载 banner（黑底 + 蓝边 + 白色立体字 + PK 小图标）
   *   500~484  「歌曲设置」标题栏（红黑斜纹底 + 白描边宋体字 + 右侧白箭头）
   *   484~290  信息卡：左封面(120x160)、右 ∞ / LV.3 六个难度块 / 四条统计
   *   290~252  「排行榜」红金横幅
   *   240~208  「3 键」「4 键」两个圆角橙按钮
   *   100~56   左侧大圆环 + PLAY 金色胶囊
   *   18~0     底部黑边 */
  var SH = 568;

  cc.SceneSettings = function (song, mode) {
    var scene = new cc.Scene();
    scene.mode = mode || '3';

    var layer = makeLayer(function () {
      this.isCustomDraw = true;      // 必须置位，否则 cc 不会调 draw()
      this.t = 0;
    });

    /* ---- 命中区（逻辑坐标，原点左下） ---- */
    var HOT = {
      back: { x: 268, y: 492, w: 44, h: 26 },
      mode3: { x: 48, y: 224, w: 128, h: 42 },
      mode4: { x: 216, y: 224, w: 128, h: 42 },
      play: { x: 160, y: 78, w: 240, h: 56 },
      rank: { x: 160, y: 271, w: 250, h: 34 }
    };

    layer.draw = function (ctx) {
      try {
        layer._drawSettings(ctx, song, scene, HOT);
      } catch (err) {
        document.title = 'DRAW_ERR: ' + (err && err.message ? err.message : err);
        if (window.console) console.error('[SceneSettings.draw]', err);
      }
    };

    layer._drawSettings = function (ctx, song, scene, HOT) {
      /* ===============================================================
       * 版式来源：截图 0469（320×568 @2x 全屏）。
       *
       * 【最重要的发现】IPA 图集里有 settingsScene_bg.png（320×480），
       * 它本身就是**原版设置页的上半部分完整美术**：
       *     canvas y 0~32    「歌曲设置」标题 + 红黑斜纹黑带
       *     canvas y 32~250  橙红放射纹底 + 右侧四条统计标签条（含彩色文字）
       *     canvas y 250~480 纯黑
       * 之前用 canvas 程序化重画这些元素，结果和底图叠成重影 —— 全是白费。
       * 正确做法：**底图原样铺，只往上叠动态内容**（封面、∞、难度、数值、
       * 排行榜、3/4 键、PLAY）。下半部分（排行榜及以下）底图没有，自己画。
       *
       * 【坐标系】本函数用 canvas 坐标（原点左上、y 向下），因为底图贴图
       * 天然就是 canvas 坐标。文字统一走 t()，它内部换算到画布像素。
       *
       * 【基准】底图 320×480 = 原版 568 高的上 480/568。所以：
       *     原版 y(568基准, 向下)  →  这里 canvas y = y * 480/568
       * 记 KY = 480/568 ≈ 0.845。
       * =============================================================== */
      var KY = H / SH;                    // 480/568
      var i, k = cc._drawK || 1;

      /* 文字助手：x、y 用 canvas 坐标（原点左上），y 已含缩放。
       * size 传的是 568 基准字号，内部自动乘 KY。 */
      function t(str, x, y, size, color, align, bold, shadow) {
        ctx.save();
        ctx.setTransform(k, 0, 0, k, 0, 0);
        txt(ctx, str, x, y, Math.max(8, size * KY), color, align, bold, shadow);
        ctx.restore();
      }

      /* ---------- 1) 底图（原样铺 320×480） ---------- */
      var bg = cc.TextureCache.addImage('assets/atlas/settings.png');
      if (bg && bg.complete && bg.naturalWidth) {
        var f = window.ATLAS_2013.settings.frames['settingsScene_bg.png'];
        ctx.drawImage(bg, f[0], f[1], f[2], f[3], 0, 0, W, H);
      }

      /* ---------- 2) 上半部动态内容 ---------- */

      /* 2a) 封面：0469 里是斜切平行四边形（左上削角、右下削角），白边框。
       *     底图有效区只到 canvas y=250，所以封面必须收在 250 以内：
       *     y 118~250、x 8~104（146×132 的竖图，与原版比例一致）。 */
      var pvX = 8, pvW = 96, pvT = 118, pvH = 132;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pvX + 4, pvT);
      ctx.lineTo(pvX + pvW, pvT);
      ctx.lineTo(pvX + pvW, pvT + pvH - 9);
      ctx.lineTo(pvX + 4, pvT + pvH);
      ctx.closePath();
      ctx.save();
      ctx.clip();
      var cover = cc.TextureCache.addImage('assets/songs/' + song.id + '/1_3.png');
      if (cover && cover.complete && cover.naturalWidth) {
        var sc = Math.max((pvW + 4) / cover.naturalWidth, pvH / cover.naturalHeight);
        ctx.drawImage(cover,
          pvX + 4 + ((pvW + 4) - cover.naturalWidth * sc) / 2,
          pvT + (pvH - cover.naturalHeight * sc) / 2,
          cover.naturalWidth * sc, cover.naturalHeight * sc);
      } else {
        ctx.fillStyle = '#2a2a34';
        ctx.fillRect(pvX, pvT, pvW + 4, pvH);
      }
      ctx.restore();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // 六边形姓名牌（压在封面左侧中部）
      drawHexBadge(ctx, pvX + 22, pvT + 82, 18, song.artist || song.name, k);

      // 时长黄胶囊（封面右下角，压在封面边框上）
      ctx.save();
      ctx.beginPath();
      cc._roundRect(ctx, pvX + 44, pvT + pvH - 20, 52, 17, 8.5);
      ctx.fillStyle = 'rgba(255,225,60,0.98)';
      ctx.fill();
      ctx.restore();
      t(showTime(song), pvX + 70, pvT + pvH - 11, 14, '#20140a', 'center', true);

      /* 2b) ∞（0469 y 402 中心，x 296）→ canvas (148, 340) 附近。
       *     实际相对封面顶部偏下：canvas y ≈ 340 - ... 用底图统计条对齐：
       *     统计条首行 canvas 121，∞ 应在其上方约 40px → canvas y ≈ 88？不对。
       *     按 0469 量：∞ 中心 568 基准 y=402（向下）→ canvas y = 402*0.845 = 340。
       *     而统计条 568 基准 y ≈ 143~241 → canvas 121~204。∞ 在统计条**上方**，
       *     所以 568 基准 ∞ 应在 y < 143。重新按 0469 量：∞ 中心在 568 画面
       *     的 y≈316（向下）→ canvas 267。但底图统计条在 canvas 121~204，
       *     说明底图只画到 568 画面的 y≈241 处。
       *     → 结论：底图的 320×480 对应 568 画面的 **y 0~480**（不是等比），
       *       即底图是「iPhone4 版本的原图」，不是缩小的 iPhone5 版。
       *       所以 canvas 坐标 = 底图实际坐标，568 基准值 × (480/568) 仅用于
       *       下半部自绘部分。上半部一律直接量底图坐标。 */
      var inx = 150, iny = 82;
      ctx.save();
      ctx.strokeStyle = '#35c8f0';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(53,200,240,0.95)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(inx - 13, iny, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(inx + 13, iny, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      /* 2c) 三张人头缩略图横条（0469 里 ∞ 右侧那条黑底长胶囊）
       *     底图没有，自己画。canvas y 约 96~140，x 232~320。 */
      ctx.save();
      ctx.beginPath();
      cc._roundRect(ctx, 252, 62, W - 252 - 6, 40, 20);
      ctx.fillStyle = 'rgba(24,10,10,0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,120,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      for (i = 0; i < 3; i++) {
        var hx = 270 + i * 21;
        ctx.save();
        ctx.beginPath();
        ctx.arc(hx, 82, 13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100,45,32,0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,180,140,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      // 右端蓝色三角
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W - 26, 75);
      ctx.lineTo(W - 12, 82);
      ctx.lineTo(W - 26, 89);
      ctx.closePath();
      ctx.fillStyle = '#37c6ff';
      ctx.fill();
      ctx.restore();

      /* 2d) LV.3 + 六个菱形（0469 里在统计条顶部左侧）→ canvas y ≈ 113 */
      t('LV.' + (song.level || 3), 196, 104, 15, '#ffffff', 'left', true, 'rgba(0,0,0,0.85)');
      var lvOn = song.level || 3;
      for (i = 0; i < 6; i++) {
        var dxx = 240 + i * 21;
        ctx.save();
        ctx.translate(dxx, 104);
        ctx.beginPath();
        ctx.moveTo(-9, 0); ctx.lineTo(0, -7); ctx.lineTo(9, 0); ctx.lineTo(0, 7);
        ctx.closePath();
        ctx.fillStyle = i < lvOn ? '#3fd0ff' : 'rgba(20,50,80,0.9)';
        if (i < lvOn) { ctx.shadowColor = 'rgba(63,208,255,0.9)'; ctx.shadowBlur = 8; }
        ctx.fill();
        ctx.restore();
      }

      /* 2e) 四条统计的数值（底图已画好「最高成绩：」等标签，
       *     这里只补右侧的 -- 数值）。底图统计条 canvas y：
       *     121~139、139~156、156~173、173~190 左右，
       *     实测四条起始 y = 121、148、175、202？按扫描结果取 4 条中心：
       *     130、157、184、211 —— 但扫描只到 204，所以是 130/150/170/190 更合理。 */
      var rowY = [130, 151, 172, 193];
      for (i = 0; i < 4; i++) {
        t('--', 300, rowY[i], 13, 'rgba(150,220,255,0.9)', 'left', true);
      }

      /* ---------- 3) 下半部自绘（底图 250 以下是纯黑） ----------
       * 这一段按 568 基准用 canvas y = 250 起算，等比排下去：
       *   排行榜  568 y 200~246  →  canvas 250~296（承接黑区）
       *   3/4 键  568 y  96~178  →  canvas 296~378
       *   PLAY    568 y   8~92   →  canvas 378~455
       */

      /* ---------- 3) 下半部（底图 250 以下是纯黑，全部用图集贴图拼） ----------
       * 原版下半部三块全是图集素材，直接取用最还原：
       *   排行榜  sort_menu_1.png   320×56
       *   3/4 键  keybutton_bg_0/1  169×98（贴图自带「3 键」「4 键」文字）
       *   PLAY    set_button_mid.png 320×99 横幅 + key_play.png PLAY 字模
       */

      /* 3a) 排行榜横幅
       * 底图 settingsScene_bg 只画到 canvas y=250（250 以下是纯黑），
       * 所以下半部从 250 起排：排行榜 250~306、3/4 键 310~390、PLAY 392~480。 */
      var smF = window.ATLAS_2013.settings.frames['sort_menu_1.png'];
      var smImg = cc.TextureCache.addImage('assets/atlas/settings.png');
      var rkT = 250;
      if (smImg && smImg.complete && smImg.naturalWidth) {
        ctx.drawImage(smImg, smF[0], smF[1], smF[2], smF[3], 0, rkT, W, 56);
      }

      /* 3b)「3 键」/「4 键」（贴图已含文字，不再叠加） */
      var kbImg = cc.TextureCache.addImage('assets/atlas/settings.png');
      function kb(name, cx, cy, w, h) {
        var f = window.ATLAS_2013.settings.frames[name];
        if (!f || !kbImg || !kbImg.complete || !kbImg.naturalWidth) return;
        ctx.drawImage(kbImg, f[0], f[1], f[2], f[3], cx - w / 2, cy - h / 2, w, h);
      }
      kb('keybutton_bg_0.png', 78, 352, 138, 80);
      kb('keybutton_bg_1.png', 244, 352, 138, 80);

      /* 3c) 底部横幅 + PLAY */
      var bnF = window.ATLAS_2013.settings.frames['set_button_mid.png'];
      var bnImg = cc.TextureCache.addImage('assets/atlas/settings.png');
      var bnT = 396;
      if (bnImg && bnImg.complete && bnImg.naturalWidth) {
        ctx.drawImage(bnImg, bnF[0], bnF[1], bnF[2], bnF[3], 0, bnT, W, 99);
      }
      var plF = window.ATLAS_2013.settings.frames['key_play.png'];
      /* key_play.png：裁切框 95×23，原框 320×110，偏移 (12.5, -1.5)。
       * 原框 320×110 与「set_button_mid」原框同宽，说明它按**原框**尺寸
       * 对齐到横幅上；只有中间 95×23 有字形，其余透明。
       * 所以这里按原框 320×110 铺，内容位置由 drawFrame 的 left/top 换算：
       *   left = (320-95)/2 + 12.5 …… 但该图集偏移是相对原框中心的,
       * 直接用 cc.drawFrame 铺整框最稳。 */
      if (plF && bnImg && bnImg.complete && bnImg.naturalWidth) {
        // 先把 95×23 字形按「原框 320×110」→「横幅 320×99」同比例绘制
        var scl = 99 / 110;
        var dw = plF[2] * scl, dh = plF[3] * scl;
        var dcx = W / 2 + (plF[6] || 0) * scl;
        var dcy = bnT + 99 / 2 - (plF[7] || 0) * scl;
        ctx.drawImage(bnImg, plF[0], plF[1], plF[2], plF[3],
          dcx - dw / 2, dcy - dh / 2, dw, dh);
      }
    };


    /* ---- 触摸 ---- */
    layer.onTouchBegan = function (x, y) {
      function inside(r) {
        return x > r.x - r.w / 2 && x < r.x + r.w / 2 &&
          y > r.y - r.h / 2 && y < r.y + r.h / 2;
      }
      if (inside(HOT.back)) { cc.Director.replaceScene(cc.SceneList()); return true; }
      if (inside(HOT.mode3)) { scene.mode = '3'; return true; }
      if (inside(HOT.mode4)) { scene.mode = '4'; return true; }
      if (inside(HOT.rank)) { return true; }
      if (inside(HOT.play)) {
        cc.Director.replaceScene(cc.SceneLoading(song, scene.mode));
        return true;
      }
      return true;
    };
    layer.onKeyDown = function (e) {
      if (e.key === 'Escape') { cc.Director.replaceScene(cc.SceneList()); return true; }
      if (e.key === 'Enter' || e.key === ' ') {
        cc.Director.replaceScene(cc.SceneLoading(song, scene.mode)); return true;
      }
      return false;
    };

    scene.addChild(layer, 0);
    scene.song = song;
    return scene;
  };

  /* 六边形姓名牌（0469 封面上那个「萧敬腾」牌子） */
  /* 六边形姓名牌。
   * 注意：设置页在 draw() 里做了纵向翻转（逻辑坐标 y 向上），所以这里的
   * 文字要再翻一次回来，否则会上下颠倒。 */
  /* 六边形姓名牌。cx/cy/r 都是 **canvas 坐标**（原点左上、y 向下）。
   * k 是 cc 的绘制缩放（cc._drawK），文字要用它恢复 canvas 矩阵。 */
  function drawHexBadge(ctx, cx, cy, r, name, k) {
    ctx.save();
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 3;
      var px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 1.08;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,60,70,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    var s = String(name || '');
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    txt(ctx, s.slice(0, 2), cx, cy - r * 0.26, 10, '#3a3a44', 'center', true);
    txt(ctx, s.slice(2, 4), cx, cy + r * 0.34, 10, '#3a3a44', 'center', true);
    ctx.restore();
  }

  /* 「3 键」/「4 键」按钮。
   * 0469 原版这两个是**图集贴图** keybutton_bg_0.png（未选）/ keybutton_bg_1.png
   * （选中），尺寸 170×100 原框、169×98 裁切。直接用贴图最还原。
   * r 是 canvas 坐标（r.x/r.y 为按钮中心）。 */
  function drawKeyButton(ctx, r, label, on, k) {
    var w = r.w, h = r.h;
    var x = r.x - w / 2, y = r.y - h / 2;
    var name = on ? 'keybutton_bg_1.png' : 'keybutton_bg_0.png';
    var f = window.ATLAS_2013.settings.frames[name];
    var img = cc.TextureCache.addImage('assets/atlas/settings.png');
    var ok = false;
    if (f && img && img.complete && img.naturalWidth) {
      ctx.save();
      if (on) { ctx.shadowColor = 'rgba(255,190,60,0.9)'; ctx.shadowBlur = 14; }
      ctx.drawImage(img, f[0], f[1], f[2], f[3], x, y, w, h);
      ctx.restore();
      ok = true;
    }
    if (!ok) {
      ctx.save();
      ctx.beginPath();
      cc._roundRect(ctx, x, y, w, h, 10);
      ctx.fillStyle = on ? '#f08210' : '#8a3c04';
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    txt(ctx, label, r.x, r.y + 1, 22, '#ffffff', 'center', true,
      'rgba(110,40,0,0.95)');
    ctx.restore();
  }

  /* 白色返回箭头（0469 标题栏右侧那个） */
  function drawBackArrow(ctx, cx, cy, s) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.6, cy - s * 0.75);
    ctx.lineTo(cx - s * 0.55, cy);
    ctx.lineTo(cx + s * 0.6, cy + s * 0.75);
    ctx.stroke();
    ctx.restore();
  }

  /* 星芒（banner 角的闪光） */
  function drawSpark(ctx, cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx - r * 0.6, cy - r * 0.6); ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
    ctx.moveTo(cx + r * 0.6, cy - r * 0.6); ctx.lineTo(cx - r * 0.6, cy + r * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  /* ================================================================ 结算 */
  cc.SceneResult = function (song, mode, res, snap) {
    var scene = new cc.Scene();
    var g = cc.Grade.compute(res, song.lv);
    /* 联调出口：?grade=3 可强制等级，用于把某一级（如官方 0480 的 D）拉出来
     * 逐像素对位；不带该参数时完全不影响正常结算。 */
    var _fg = /[?&]grade=(\d{1,2})/.exec(location.search);
    if (_fg) {
      var _gi = Math.max(0, Math.min(11, Number(_fg[1])));
      g = { grade: _gi, badge: g.badge, gradeName: GRADES[_gi] };
    }

    var key = 'best.' + song.id + '.' + mode;
    var old = cc.Store.get(key, null);
    if (!res.failed && res.acc > 0 &&
        (!old || g.grade > old.grade || (g.grade === old.grade && res.acc > old.acc))) {
      cc.Store.set(key, { grade: g.grade, acc: res.acc, score: res.score });
      scene.newRecord = true;
    }
    var badges = cc.Store.get('badges', {});
    if (!badges[g.badge]) { badges[g.badge] = true; cc.Store.set('badges', badges); }

    /* 官方按钮素材（bar_left / bar_right / gear）在 scene_game.js 里预加载，
     * 直接打开 ?scene=result 时这里要自己触发一次。 */
    if (cc.GUI) cc.GUI.preload();
    var snapImg = null;
    if (snap) {
      snapImg = new Image();
      snapImg.src = snap;
    }

    var layer = makeLayer(function () { this.isCustomDraw = true; this.t = 0; });
    layer.draw = function (ctx) {
      var t = this.t;
      var ease = Math.min(1, t * 3.2);

      /* ================= 官方 0480 结算页版式 =================
       * 自上而下：
       *   ① 背景 = **游戏画面的最后一眼**（歌手照 + HUD 都在，原版就是这么做的）
       *   ② 「经验值：3」/「得到闪光：11」白字黑描边，左对齐 x=14
       *   ③ 斜向彩色面板（黄绿 → 洋红），上下各一条波浪边
       *   ④ 面板内四行数据：黑色胶囊底 + 青白字 + 右侧红色「新纪录」
       *   ⑤ 右侧大评级徽章（青蓝玻璃方块 + 白色字母）、右下 GD NEW 圆章
       *   ⑥ 底部两条官方蓝色胶囊：分享 / 返回
       * 坐标都是 320×480 逻辑单位。 */
      if (snapImg && snapImg.complete && snapImg.naturalWidth) {
        ctx.drawImage(snapImg, 0, 0, W, H);
      } else {
        drawFrameBox(ctx, 'result', 'bedge_bg.png', 0, 0, W, H);
      }

      /* ★★ 整页压暗 —— 之前**整层漏掉了**，这是「结算页不像」的最大原因。
       *
       *   官方 0480 的背景是重度压暗过的游戏画面（歌手照只剩个暗轮廓，
       *   判定盘几乎全黑）。逐横带量平均亮度（_dark.py，物理坐标）：
       *     y   0-120 顶部       REF 43.2  | 本页未压暗 ~105
       *     y 120-240 歌手照     REF 37.9  | 本页未压暗 ~105
       *     y 240-345 经验值条   REF 32.6  | 本页未压暗 ~104
       *     y 345-374 面板上沿   REF 22.1  | 本页未压暗 ~138
       *   即背景只剩原画面 ~30% 亮度。少了这层黑，面板/胶囊/白字全糊在亮底上，
       *   跟官方并排一眼就能看出「不像」。
       */
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      ctx.fillRect(0, 0, W, H);

      /* 再叠一层「顶部更黑」的渐变。整页 0.68 是照官方**平均亮度**定的，
       * 但官方那张背景本身是深色演唱会照，我的快照是白底海报 ——
       * 同样压 0.68，官方剩暗轮廓，我的白字还是很跳。
       *
       * ★ 前 44 逻辑（顶部 HUD 条：分数胶囊 + 暂停按钮）要**手下留情**：
       *   官方结算页的分数条是亮的（白描边 + 白字），跟暗背景强对比；
       *   一刀切压暗会把 HUD 一起打成灰，等于把「游戏画面最后一眼」也抹了。 */
      var topDark = ctx.createLinearGradient(0, 0, 0, 200);
      topDark.addColorStop(0.00, 'rgba(0,0,0,0.30)');   // y 0~48 HUD 条：保留
      topDark.addColorStop(0.24, 'rgba(0,0,0,0.32)');
      topDark.addColorStop(0.34, 'rgba(0,0,0,0.86)');   // y 68 起：重压
      topDark.addColorStop(0.60, 'rgba(0,0,0,0.74)');
      topDark.addColorStop(1.00, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = topDark;
      ctx.fillRect(0, 0, W, 200);

      /* 「经验值 / 得到闪光」那一条再压一层：官方 y 240~345 比上下都更暗
       * （32.6 vs 顶部 43.2），是一条独立的重色带。 */
      var bandG = ctx.createLinearGradient(0, 118, 0, 178);
      bandG.addColorStop(0, 'rgba(0,0,0,0)');
      bandG.addColorStop(0.18, 'rgba(0,0,0,0.30)');
      bandG.addColorStop(0.82, 'rgba(0,0,0,0.30)');
      bandG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bandG;
      ctx.fillRect(0, 118, W, 60);

      /* 面板上沿的收口阴影：官方 y 345~374（逻辑 172.5~187）平均亮度只有 22.1，
       * 比再往上的 32.6 还暗一截 —— 那是面板顶边压出来的一道黑。不加这条，
       * 面板顶上会直接接在灰色背景上，缺了纵深。
       * 官方面板下方（y 650 处）也是纯黑 (3,3,0)，所以这里顺带把面板下端也压黑。 */
      var topShade = ctx.createLinearGradient(0, 300, 0, 376);
      topShade.addColorStop(0, 'rgba(0,0,0,0)');
      topShade.addColorStop(0.72, 'rgba(0,0,0,0.42)');
      topShade.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = topShade;
      ctx.fillRect(0, 300, W, 76);

      // ② 经验值 / 闪光
      /* ② 经验值 / 得到闪光
       * 官方 0480 实测（物理 bbox → 逻辑）：
       *   「经验值：3」 x 31~238 / y 317~344 → 逻辑 x 15.5 起、中心 y 165.2
       *   「得到闪光：11」x 31~149 / y 359~386 → 逻辑 x 15.5 起、中心 y 186.2
       *   字高 27 物理 = 13.5 逻辑 → 字号 14。之前写成 y=150/170 偏上 15。 */
      ctx.save();
      ctx.font = 'bold 14px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.strokeText('经验值：' + (g.badge + 1), 15.5, 165);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('经验值：' + (g.badge + 1), 15.5, 165);
      ctx.strokeText('得到闪光：' + (g.grade + 3), 15.5, 186);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('得到闪光：' + (g.grade + 3), 15.5, 186);
      // 「经验值」那行右边那条渐隐横线（原版装饰，官方 x 115~315 / y 165 左右）
      var ln = ctx.createLinearGradient(115, 0, W - 4, 0);
      ln.addColorStop(0, 'rgba(255,255,255,0.52)');
      ln.addColorStop(1, 'rgba(255,255,255,0.08)');
      ctx.fillStyle = ln;
      ctx.fillRect(115, 165, W - 119, 1);
      ctx.restore();

      /* ③ 彩色面板：上下波浪边 + **垂直 青→黄 渐变** + 徽章后的青色同心圆
       *
       *   配色不是凭感觉调的。对官方 0480 做颜色网格采样
       *   （_m0480b.py，x 15~615 × y 385~645 物理）后发现：
       *   同一个 y 上横跨全宽的颜色**几乎完全一致**
       *     y=465 → x60 #62cdb1 / x200 #55caab / x400 #54ccae / x580 #51caac
       *   说明是**纯垂直渐变**，不是斜向的。沿 y 的实测值（物理 → 逻辑）：
       *     202.5  #17cce8   顶：亮青
       *     232.5  #55caab
       *     262.5  #83b769
       *     292.5  #c9cc36
       *     312.5  #f1cc0e   底：纯黄
       *   之前这里写成「黄绿 → 洋红 → 紫」，方向完全跑偏了：结算页右侧
       *   那圈同心圆在官方是**青色**的，透到玻璃字母内孔里也是青色；
       *   用洋红会让 D 的内孔变成粉色，跟官方一眼就分得出。 */
      var pTop = PANEL_TOP, pBot = PANEL_BOT - (1 - ease) * 160;
      ctx.save();
      /* 入场动画整块上滑（而不是让轮廓随 ease 变形 —— 轮廓是一堆实测点，
       * 参数化会把量出来的形状搞乱）。渐变/同心圆都在同一 translate 里，
       * 所以下面一律用固定逻辑坐标。 */
      ctx.translate(0, (1 - ease) * 160);
      ctx.beginPath();
      /* 上边缘轮廓来自 _panel.py 逐列扫描（物理 → 逻辑）：
       *     x=12 → 199    x=116 → 197    x=148 → 195
       *     x=176 → 192   x=196 → 188    x=212 起 → 187 走平
       * 也就是说左上角不是从 187 起步，而是 (0,199) 缓坡到 x≈116，
       * 之后才加速爬升到 187。早先写成 (0, 196) → (96, 185) 翘得太早，
       * 结果 x<120 那段面板比官方高了 10 逻辑像素。 */
      ctx.moveTo(0, 199);
      ctx.quadraticCurveTo(W * 0.47, 200, W * 0.62, 187.5);
      ctx.quadraticCurveTo(W * 0.80, 187, W, 187);
      /* 下边缘同样是逐列量出来的：
       *     x=12 → 322   x=192~278 → 311.5   x=288 → 289   x=320 → 288
       * 右端往上翘 23 逻辑像素，形成官方那种斜条收口。 */
      ctx.lineTo(W, 288);
      ctx.quadraticCurveTo(W * 0.91, 296, W * 0.86, 311.5);
      ctx.lineTo(W * 0.60, 311.5);
      ctx.quadraticCurveTo(W * 0.28, 314, 0, 322);
      ctx.closePath();
      ctx.clip();

      var pg = ctx.createLinearGradient(0, PANEL_TOP, 0, PANEL_BOT);
      pg.addColorStop(0.00, '#0fc8e6');
      pg.addColorStop(0.34, '#55caab');
      pg.addColorStop(0.56, '#83b769');
      pg.addColorStop(0.78, '#c9cc36');
      pg.addColorStop(1.00, '#f1cc0e');
      ctx.fillStyle = pg;
      ctx.fillRect(0, PANEL_TOP - 14, W, PANEL_BOT - PANEL_TOP + 40);

      /* 徽章后的青色同心圆：官方在 x 400~615、y 440~560（物理）有一圈圈
       * 细亮青弧线，圆心与 D 徽章同心 —— 观感是「声波从徽章向外扩散」。
       * 之前画成黄色圆且圆心在 (W-62, pTop+62)，既不在徽章上、颜色也不对。 */
      var rcx = BADGE_BOX.x + BADGE_BOX.w / 2;
      var rcy = BADGE_BOX.y + BADGE_BOX.h / 2;
      /* 环间距 5 逻辑、11 圈、最外圈 75 逻辑。
       * ★ 之前间距写成 11，最外圈到 141 逻辑 —— 半径几乎盖满右半屏，
       *   结果 D 右边面板本该是黄绿，被同心圆糊成一片青，跟官方差很远。
       *   官方最外圈实测约 150 物理 = 75 逻辑，只围绕徽章一小圈。 */
      for (var ri = 11; ri >= 1; ri--) {
        ctx.beginPath();
        ctx.arc(rcx, rcy, 20 + ri * 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200,255,252,' + (0.13 - ri * 0.006).toFixed(3) + ')';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // 面板上沿那道亮青色高光（官方 y=385 整条 #03ccfc）
      var eg = ctx.createLinearGradient(0, PANEL_TOP - 6, 0, PANEL_TOP + 15);
      eg.addColorStop(0, 'rgba(40,215,255,0)');
      eg.addColorStop(0.45, 'rgba(60,225,255,0.62)');
      eg.addColorStop(1, 'rgba(40,215,255,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(0, PANEL_TOP - 6, W, 21);
      // 叠加一层斜向亮带，做出原版那种「玻璃反光」
      var sh = ctx.createLinearGradient(0, PANEL_TOP, W * 0.6, PANEL_BOT);
      sh.addColorStop(0, 'rgba(255,255,255,0.16)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, PANEL_TOP - 14, W, PANEL_BOT - PANEL_TOP + 40);
      ctx.restore();

      /* ④ 四行数据
       * 官方 0480 实测（物理 → 逻辑）：胶囊行顶 424/486/548/610，行高 42
       * → 逻辑行中心 222.3 / 253.3 / 284.3 / 315.3，**步长 31**、行高 21。
       * 胶囊横向 14~212（宽 198）；「分数：」标签从 x=20 起、值从 x=78 起、
       * 「新纪录」从 x=150 起 —— 三段分开摆，值变长时不会压到「新纪录」。 */
      var rows = [
        ['分数：', String(res.score)],
        ['最大连击数：', String(res.combo)],
        ['失误数：', String(res.stats.MISS + res.stats.GOOD)],
        ['正确率：', res.acc.toFixed(1) + '%']
      ];
      var ry0 = 222.3;
      for (var i = 0; i < rows.length; i++) {
        if (t * 8 < i + 1) break;
        var y = ry0 + i * 31;
        // 黑色胶囊底（右侧留出徽章位，不压到字母）
        /* 官方胶囊是**纯黑不透明**：在 x=200 物理处逐行取样，胶囊内部一律
         * #000000 —— 之前用 rgba(0,0,0,0.86) 会透出 14% 面板底色，
         * 表现为胶囊发青、跟面板糊在一起。 */
        cc._roundRect(ctx, 14, y - 10.5, 198, 21, 10.5);
        ctx.fillStyle = '#000000';
        ctx.fill();
        // 标签 + 值 + 新纪录（三段分开摆，避免数值变长时压到「新纪录」）
        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = 'bold 12px "PingFang SC","Microsoft YaHei",sans-serif';
        /* 官方实测（取文字中心最亮像素）：标签 #3cecff、新纪录 #fd3200 */
        ctx.fillStyle = '#3cecff';
        ctx.fillText(rows[i][0], 20, y + 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(rows[i][1], 78, y + 0.5);
        if (scene.newRecord) {
          ctx.font = 'bold 11px "PingFang SC","Microsoft YaHei",sans-serif';
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText('新纪录', 150, y + 0.5);
          ctx.fillStyle = '#fd3200';
          ctx.fillText('新纪录', 150, y + 0.5);
        }
        ctx.restore();
      }

      /* ⑤ 大评级徽章 —— **官方图集素材 musiclevelNNN，按实测矩形 1:1 贴**：
       *
       *   素材：list.png 的 musiclevel000~011.png，索引与 GRADES 对齐
       *        （3='D'、9='A'、11='∞'）。这是蓝色玻璃的斜切方块，
       *        中间挖空成字母轮廓 —— 与官方 0480 右侧那颗「D」完全同源。
       *
       *   尺寸不是猜的：把 musiclevel003（D，内容 50×58 素材像素）拿去跟
       *    官方 0480 做高通归一化互相关扫描（scale 1.6~2.6 步长 0.05），
       *    峰值 scale=2.45、ncc=0.920 —— 2.45 是**物理**倍率，画布 k=2，
       *    所以逻辑倍率 = 2.45/2 = 1.225。逐个 scale 的 ncc：
       *      2.30→0.777  2.35→0.835  2.40→0.890  2.45→0.920  2.50→0.861
       *    → 内容目标矩形 50*1.225 × 58*1.225 = 61.3 × 71.05 逻辑。
       *
       *   注意 **不要** 用 drawFrame(...) 的 s 参数来缩放：它内部是
       *     cx - f.ow*s/2 + f.left*s，而 ow(74)/left(-6) 是**未裁剪框**的
       *    几何，s≠1 时框心会跟着漂，等于一边缩放一边位移，很难对准。
       *     这里改用 drawFrameBox 直接给目标矩形，位置无歧义。 */
      var gf = 'musiclevel' + pad(g.grade, 3) + '.png';
      if (!cc.SpriteFrameCache.has('list', gf)) gf = 'musiclevel009.png';
      /* ★ 12 个字母的素材尺寸**并不一样**（裁切宽高从 atlas 读）：
       *     009(A) 58×58   003(D) 50×58   011(∞) 57×**34**   010(73) 68×61 …
       *   ∞ 只有 34 高（符号本身是扁的），如果一律塞进 61.3×71 的框里会被
       *   纵向拉长变形。所以统一用「以 D 的 50 宽为基准」的比例 1.226 缩放，
       *   再在同一个框里居中 —— 这样每个字母都保持官方原比例。 */
      var bf = cc.SpriteFrameCache.get('list', gf);
      var BS = BADGE_BOX.w / 50;                    // 官方逻辑倍率 1.226
      var bPop = 0.86 + 0.14 * Math.min(1, t * 4);  // 入场轻微放大
      var bw = (bf ? bf.w : 50) * BS * bPop;
      var bh = (bf ? bf.h : 58) * BS * bPop;
      drawFrameBox(ctx, 'list', gf,
        BADGE_BOX.x + (BADGE_BOX.w - bw) / 2,
        BADGE_BOX.y + (BADGE_BOX.h - bh) / 2, bw, bh,
        Math.min(1, t * 3));

      /* 右下角 GD NEW 小圆章
       * 官方 0480 实测：绿圆 x 281~311 / y 293.5~313.5（逻辑，直径 30）→ 圆心
       * (296, 303.5)；下方的「NEW」是**橙色 #ea5831**（在 y≈322.5、x≈290 取样），
       * 不是白色。之前位置写成 (W-44, pBot-12) = (276, 310)，整体偏左 20。 */
      ctx.save();
      var nx = 296, ny = 303.5;
      ctx.beginPath();
      ctx.arc(nx, ny, 15, 0, Math.PI * 2);
      var ng = ctx.createRadialGradient(nx, ny - 5, 2, nx, ny, 15);
      ng.addColorStop(0, '#f2ffe8');
      ng.addColorStop(0.55, '#5fd23c');
      ng.addColorStop(1, '#1e8f1e');
      ctx.fillStyle = ng;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,80,20,0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.font = 'bold 11px "Helvetica Neue",Helvetica,Arial,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(10,60,10,0.85)';
      ctx.strokeText('GD', nx, ny - 3);
      ctx.fillStyle = '#eaffdc';
      ctx.fillText('GD', nx, ny - 3);
      ctx.font = 'bold 11px "Helvetica Neue",Helvetica,Arial,sans-serif';
      ctx.strokeStyle = 'rgba(70,10,0,0.92)';
      ctx.lineWidth = 3;
      ctx.strokeText('NEW', nx - 5, ny + 18);
      ctx.fillStyle = '#ea5831';
      ctx.fillText('NEW', nx - 5, ny + 18);
      ctx.restore();

      /* 面板以下的整片区域压成近黑：官方 y=650（面板正下方）实测 (3,3,0)，
       * 判定盘只剩极淡的轮廓，全靠两条胶囊的青色撑起亮度。
       * 不加这层，判定盘的白色大圆会直接顶在面板下面，整页就「不黑」。
       * ★ 起点必须是 326 而不是 316：第四行胶囊中心 315.3、高 21 →
       *   纵向 304.8~325.8，官方面板底边（中间段）只有 311.5，
       *   也就是说第四行胶囊**故意悬空露在面板外面半截**。
       *   起点写成 316 会把这半截压黑，看起来像「正确率那行被切了」。 */
      var botShade = ctx.createLinearGradient(0, 326, 0, 404);
      botShade.addColorStop(0, 'rgba(0,0,0,0.66)');
      botShade.addColorStop(1, 'rgba(0,0,0,0.90)');
      ctx.fillStyle = botShade;
      ctx.fillRect(0, 326, W, H - 326);

      /* ⑥ 底部两条官方蓝色胶囊
       * 官方 0480 实测（_m0480b.py 的「宽青色行」扫描）：
       *   分享 青色区 y 680~693 / 765~780 物理 → 胶囊 343~386 逻辑，中心 364.5
       *   返回 青色区 y 818~833 / 906~920 物理 → 胶囊 413~456 逻辑，中心 434.75
       * 两条间距 **70.25** 逻辑（不是暂停页那种 50！之前写成 352/402 整体偏上）。 */
      if (ease >= 1) {
        if (cc._drawBlueBar) {
          /* 第 5 个参数 'green' = 结算页用的是青绿染色版（见 drawBlueBar 里的
           * hue-rotate 说明），暂停页不传，保持 title.png 素材本来的蓝色。 */
          cc._drawBlueBar(ctx, 364.5, '分　享', 'left', 'green');
          cc._drawBlueBar(ctx, 434.75, '返　回', 'right', 'green');
        }
      }
    };
    layer.update = function (dt) { this.t += dt; };
    layer.onTouchBegan = function (x, y) {
      var cy = H - y;
      if (this.t < 0.35) return true;
      if (cy > 343 && cy < 386) {          // 分享：原版只是把成绩复制到剪贴板
        try {
          navigator.clipboard && navigator.clipboard.writeText(
            song.name + ' ' + res.score + '分 ' + g.gradeName + ' ' + res.acc.toFixed(1) + '%');
        } catch (e) { }
        return true;
      }
      if (cy > 413 && cy < 456) { cc.Director.replaceScene(cc.SceneList()); return true; }
      return true;
    };
    layer.onKeyDown = function (e) {
      if (e.key === 'Escape') { cc.Director.replaceScene(cc.SceneList()); return true; }
      if (e.key === 'Enter' || e.key === ' ') { cc.Director.replaceScene(cc.SceneLoading(song, mode)); return true; }
      return false;
    };
    scene.addChild(layer, 0);
    scene.result = res;
    scene.gradeInfo = g;
    window.__LAST_RESULT__ = {
      grade: g.gradeName, gradeIdx: g.grade, badge: g.badge,
      score: res.score, acc: res.acc, combo: res.combo, stats: res.stats
    };
    return scene;
  };
  /* ------------------------------------------------------------- 加载页
   * ★ 全部用官方素材，一行都不自己画：
   *   loading 图集里就是原版进曲前的 loading 场景
   *     ld_loadingScene_bg.png  320×480  整屏底图（含乐动达人 logo）
   *     ld_progress_bg.png      320×52   进度条空轨
   *     ld_progress_shell.png   320×52   进度条满格（齿条 + 青光边框）
   *   背景 422 以下是纯黑，进度条就压在那一段：y = 480 − 52 = 428。
   *   进度用「把 shell 裁到 p 宽」实现 —— 原版就是一格一格填满的齿条。
   */
  cc.SceneLoading = function (song, mode) {
    var scene = new cc.Scene();
    var layer = makeLayer(function () { this.isCustomDraw = true; });
    layer.t = 0;
    layer.done = false;
    layer.song = song;

    var LD_Y = H - 52;          // 进度条顶边
    var HOLD = 1.15;            // 至少亮这么久再进游戏

    layer.draw = function (ctx) {
      var p = Math.min(1, this.t / HOLD);

      /* ① 官方整屏底图（320×480，连 logo 都是烘死的） */
      cc.drawFrameBox(ctx, 'loading', 'ld_loadingScene_bg.png', 0, 0, W, H, 1);

      /* ② 进度条
       *   ld_progress_bg     = 空槽（纯黑 + 斜纹）
       *   ld_progress_shell  = **遮罩**：不透明黑竖条当格子的分隔，
       *                        低透明度的缝里透出后面的填充色
       *   所以正确的叠法是「底色 → 填充 → 遮罩」，不能拿 shell 当进度用。
       *   胶囊内腔（素材 320×52 实测）：x 45~275、y 10~33。 */
      var CX0 = 45, CX1 = 275, CY0 = LD_Y + 10, CY1 = LD_Y + 33;
      cc.drawFrameBox(ctx, 'loading', 'ld_progress_bg.png', 0, LD_Y, W, 52, 1);

      if (p > 0.004) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(CX0, CY0, (CX1 - CX0) * p, CY1 - CY0);
        ctx.clip();
        var fg = ctx.createLinearGradient(0, CY0, 0, CY1);
        fg.addColorStop(0.00, 'rgba(150,240,255,0.95)');
        fg.addColorStop(0.45, 'rgba(56,196,240,0.95)');
        fg.addColorStop(1.00, 'rgba(12,116,172,0.95)');
        ctx.fillStyle = fg;
        ctx.fillRect(CX0, CY0, CX1 - CX0, CY1 - CY0);
        ctx.restore();
      }

      /* ③ 官方遮罩 + 边框压在最上面 */
      cc.drawFrameBox(ctx, 'loading', 'ld_progress_shell.png', 0, LD_Y, W, 52, 1);
    };

    layer.update = function (dt) {
      if (/(^|[?&])freeze=1/.test(location.search)) { this.t = HOLD * 0.62; return; }
      this.t += dt;
      if (!this.done && this.t >= HOLD + 0.25) {
        this.done = true;
        cc.Director.replaceScene(cc.SceneGame(song, mode));
      }
    };

    scene.addChild(layer, 0);
    return scene;
  };

})();
