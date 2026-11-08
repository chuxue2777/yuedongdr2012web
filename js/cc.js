/* =============================================================================
 * cc.js —— cocos2d-x 风格微型运行时（Canvas2D 后端）
 *
 * 为什么是"风格"而不是直接编译：cocos2d-x 1.0.x 没有 Web 后端（Emscripten 到 3.x
 * 才有），所以游戏逻辑按 cocos2d 的 API 形状重写一遍，资源、坐标、锚点、锚点
 * 约定、场景栈全部沿用 cocos2d 语义，将来若拿到 .xcodeproj 可以逐函数翻回 C++。
 *
 * 坐标：逻辑坐标 320x480，**原点左下、y 向上**（与 cocos2d 一致），
 *      内部转 canvas 时统一做 y 翻转，业务代码不需要关心。
 * ========================================================================== */
(function (global) {
  'use strict';

  var cc = global.cc = {};
  cc.VERSION = 'lddr-2013/1.0';

  /* ---------------------------------------------------------------- 基础类型 */
  function Point(x, y) { this.x = x || 0; this.y = y || 0; }
  function Size(w, h) { this.width = w || 0; this.height = h || 0; }
  cc.Point = Point;
  cc.Size = Size;

  /* 设计尺寸 = 原版 iPhone 3.5" 视网膜屏 640×1136 ÷2 = **320×568**。
   * 早先写成 320×480 是把「0471 里 y176 以下的游戏区」当成了整屏，
   * 结果顶部的深蓝 logo 栏整块丢失，跟原版差 88 逻辑单位。 */
  /* ★ 设计分辨率 = 320x480。
   *
   * 原版 iOS 是 320x568（iPhone5 全屏），其中顶部 88 逻辑高是系统状态栏 /
   * 非游戏区域，实际演奏画面就是 320x480 —— 参照截图 0471/0472 裁掉顶部
   * 176 像素（=88 逻辑）后正好 640x960（=320x480@2x）。
   *
   * 这里如果写成 568，而场景又按 480 绘制，k 会被算成 480/568=0.845，
   * 整个画面缩一圈、四周露出底色（之前一直是这个症状）。
   * 所以必须与场景的 W/H 保持一致。 */
  cc.WIN = new Size(320, 480);
  cc.WIN_GAME_Y = 88;   // 游戏区顶部在整屏中的偏移（顶栏高 88）

  /* ------------------------------------------------------------------- 纹理 */
  var TextureCache = cc.TextureCache = {
    _images: {},
    addImage: function (url) {
      var self = this;
      if (this._images[url]) return this._images[url];
      var img = new Image();
      img.src = url;
      this._images[url] = img;
      return img;
    },
    get: function (url) { return this._images[url]; },
    /* 已就绪判定：只在 draw 里用来决定「画图 / 退化占位」，不阻塞 */
    ready: function (url) {
      var img = this._images[url];
      return !!(img && img.complete && img.naturalWidth);
    },
    preload: function (urls, onProgress, onDone) {
      var total = urls.length, loaded = 0, self = this;
      if (!total) { onDone && onDone(); return; }
      urls.forEach(function (u) {
        var img = self.addImage(u);
        if (img.complete) { tick(); }
        else {
          img.onload = img.onerror = tick;
        }
      });
      function tick() {
        loaded++;
        onProgress && onProgress(loaded / total);
        if (loaded >= total) onDone && onDone();
      }
    }
  };

  /* ------------------------------------------------------------ SpriteFrame */
  // ATLAS_2013 = { atlasName: { png: url, frames: { name: [x,y,w,h,ow,oh,ox,oy] } } }
  var FrameCache = cc.SpriteFrameCache = {
    _frames: {},
    _atlases: {},
    addAtlas: function (name, data) {
      this._atlases[name] = data;
      TextureCache.addImage(data.png);
      for (var fn in data.frames) {
        var f = data.frames[fn];
        var ow = f[4], oh = f[5], ox = f[6], oy = f[7];
        this._frames[name + '/' + fn] = {
          atlas: name, png: data.png,
          x: f[0], y: f[1], w: f[2], h: f[3],
          ow: ow, oh: oh,
          // 裁剪矩形在原图框内的左上角（cocos2d format 0 换算）
          left: (ow - f[2]) / 2 + ox,
          top: (oh - f[3]) / 2 - oy
        };
      }
    },
    get: function (atlas, fn) { return this._frames[atlas + '/' + fn]; },
    has: function (atlas, fn) { return !!this._frames[atlas + '/' + fn]; }
  };

  /* ------------------------------------------------------------------- Node */
  function Node() {
    this.position = new Point(0, 0);
    this.anchor = new Point(0, 0);
    this.scaleX = 1; this.scaleY = 1;
    this.rotation = 0;           // 角度，逆时针为正（cocos2d 约定）
    this.opacity = 255;
    this.visible = true;
    this.zOrder = 0;
    this.size = new Size(0, 0);
    this.color = null;           // 形如 'rgba(...)' 的叠加色，null = 原色
    this.children = [];
    this.parent = null;
    this.tag = -1;
    this._scheduler = null;
    this._actions = [];
  }
  cc.Node = Node;

  Node.prototype.addChild = function (child, z, tag) {
    child.parent = this;
    if (z !== undefined) child.zOrder = z;
    if (tag !== undefined) child.tag = tag;
    this.children.push(child);
    this.children.sort(function (a, b) { return a.zOrder - b.zOrder; });
    if (this._onChildAdded) this._onChildAdded(child);
    return child;
  };
  Node.prototype.removeChild = function (child, cleanup) {
    var i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
    return child;
  };
  Node.prototype.removeAllChildren = function () {
    this.children.forEach(function (c) { c.parent = null; });
    this.children.length = 0;
  };
  Node.prototype.setPosition = function (x, y) { this.position.x = x; this.position.y = y; return this; };
  Node.prototype.setAnchorPoint = function (ax, ay) { this.anchor.x = ax; this.anchor.y = ay; return this; };
  Node.prototype.setScale = function (s) { this.scaleX = this.scaleY = s; return this; };
  Node.prototype.setScaleXY = function (sx, sy) { this.scaleX = sx; this.scaleY = sy; return this; };
  Node.prototype.setRotation = function (r) { this.rotation = r; return this; };
  Node.prototype.setOpacity = function (o) { this.opacity = Math.max(0, Math.min(255, o)); return this; };
  Node.prototype.setVisible = function (v) { this.visible = v; return this; };
  Node.prototype.getPositionX = function () { return this.position.x; };
  Node.prototype.getPositionY = function () { return this.position.y; };
  Node.prototype.convertToNodeSpace = function (p) {
    return new Point(p.x - this.position.x, p.y - this.position.y);
  };

  /* ---------------------------------------------------------------- Sprite */
  function Sprite(frame) {
    Node.call(this);
    this.frame = frame || null;
    if (frame) {
      this.size.width = frame.ow;
      this.size.height = frame.oh;
      this.anchor.x = 0.5; this.anchor.y = 0.5;
    }
  }
  Sprite.prototype = Object.create(Node.prototype);
  Sprite.prototype.constructor = Sprite;
  cc.Sprite = Sprite;

  Sprite.create = function (atlas, frameName) {
    var f = FrameCache.get(atlas, frameName);
    if (!f) { console.warn('[cc] missing frame', atlas, frameName); return new Sprite(null); }
    return new Sprite(f);
  };
  // 用裸图（非图集）建 Sprite，仍走 Node 的变换
  Sprite.createFromFile = function (url) {
    var img = TextureCache.addImage(url);
    var s = new Sprite(null);
    s.rawUrl = url;
    s._rawImg = img;
    s.size.width = img.naturalWidth || 320;
    s.size.height = img.naturalHeight || 480;
    s.anchor.x = 0.5; s.anchor.y = 0.5;
    return s;
  };
  Sprite.prototype.setTextureRect = function (frame) {
    this.frame = frame;
    this.size.width = frame.ow; this.size.height = frame.oh;
    return this;
  };

  /* ------------------------------------------------------------------ Label */
  function Label(text, opt) {
    Node.call(this);
    opt = opt || {};
    this.text = text;
    this.fontSize = opt.size || 14;
    this.fontFamily = opt.font || 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    this.bold = !!opt.bold;
    this.italic = !!opt.italic;
    this.align = opt.align || 'left';       // left | center | right
    this.fill = opt.fill || '#ffffff';
    this.strokeFill = opt.stroke || null;
    this.strokeWidth = opt.strokeWidth || 0;
    this.lineHeight = opt.lineHeight || Math.round(this.fontSize * 1.3);
    this.anchor.x = 0; this.anchor.y = 0.5;
    this._measure();
  }
  Label.prototype = Object.create(Node.prototype);
  Label.prototype.constructor = Label;
  cc.Label = Label;
  Label.prototype._measure = function () {
    var lines = String(this.text).split('\n');
    this._lines = lines;
    this.size.width = 0;
    for (var i = 0; i < lines.length; i++) {
      var w = measureText(lines[i], this.fontSize, this.fontFamily, this.bold, this.italic);
      if (w > this.size.width) this.size.width = w;
    }
    this.size.height = this.lineHeight * lines.length;
    return this;
  };
  Label.prototype.setText = function (t) { this.text = t; this._measure(); return this; };

  var _mctx = null;
  function measureText(s, size, font, bold, italic) {
    if (!_mctx) {
      var cv = document.createElement('canvas');
      _mctx = cv.getContext('2d');
    }
    _mctx.font = (italic ? 'italic ' : '') + (bold ? 'bold ' : '') + size + 'px ' + font;
    return _mctx.measureText(s).width;
  }

  /* ------------------------------------------------------------------ Layer */
  function Layer() {
    Node.call(this);
    this.size = new Size(cc.WIN.width, cc.WIN.height);
  }
  Layer.prototype = Object.create(Node.prototype);
  Layer.prototype.constructor = Layer;
  cc.Layer = Layer;
  Layer.prototype.onEnter = function () { };
  Layer.prototype.onExit = function () { };
  Layer.prototype.update = function (dt) { };
  Layer.prototype.draw = function (ctx) { };          // 自定义绘制（canvas 原生坐标，y 向下）
  Layer.prototype.onTouchBegan = function (x, y) { return false; };
  Layer.prototype.onTouchMoved = function (x, y) { };
  Layer.prototype.onTouchEnded = function (x, y) { };
  Layer.prototype.onKeyDown = function (e) { };
  Layer.prototype.onKeyUp = function (e) { };

  /* ------------------------------------------------------------------ Scene */
  function Scene() {
    Node.call(this);
    this.scene = this;
  }
  Scene.prototype = Object.create(Node.prototype);
  Scene.prototype.constructor = Scene;
  cc.Scene = Scene;
  Scene.prototype.onEnter = function () { };
  Scene.prototype.onExit = function () { };
  Scene.prototype.update = function (dt) { };

  // 所有 Layer 扁平化（不含 Scene 自身），用于 update / 输入分发
  function flatten(root) {
    var out = [];
    (function walk(n) {
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c instanceof Layer) out.push(c);
        walk(c);
      }
    })(root);
    return out;
  }
  function enterAll(root) {
    var ls = flatten(root);
    for (var i = 0; i < ls.length; i++) ls[i].onEnter && ls[i].onEnter();
  }
  function exitAll(root) {
    var ls = flatten(root);
    for (var i = ls.length - 1; i >= 0; i--) ls[i].onExit && ls[i].onExit();
  }

  /* --------------------------------------------------------------- Director */
  var Director = cc.Director = {
    canvas: null, ctx: null, dpr: 1,
    _sceneStack: [],
    _running: false,
    _last: 0,
    totalTime: 0,
    deltaTime: 0,
    _scale: 1,
    _offX: 0, _offY: 0,

    init: function (canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resize();
      var self = this;
      global.addEventListener('resize', function () { self.resize(); });
      this._bindInput();
      return this;
    },

    resize: function () {
      var cv = this.canvas;
      /* ★★ 电脑浏览器上「画面被拉宽、上下被裁」的根因就在这里：
       *
       *   老代码写的是
       *       cv.style.width = '100%';  cv.style.height = '100%';
       *   然后 width/height（**位图**尺寸）按 min(cw/320, ch/480) 等比算。
       *   手机竖屏时父容器本来就是 320:480，两边一致，看不出问题；
       *   一到电脑（比如 1090×630 的窗口），CSS 盒子被拉成 1090×630（比例 1.73），
       *   位图却还是 420×630（比例 0.67）—— 420×630 的图被拉伸铺满 1090×630，
       *   于是**横向拉宽 2.6 倍、字形变胖、边缘被裁**。
       *
       *   正确做法：CSS 盒子也必须保持 320:480，等比缩放到「装得下」为止，
       *   居中显示，两侧/上下留黑边（letterbox）。这样位图与 CSS 盒子同比例，
       *   浏览器只是整数倍放大，不会变形。
       *
       *   _cssK = 实际 CSS 宽 / 设计宽(320)；渲染用 _drawK = _cssK * dpr。 */
      /* ★ 截图旁路（只在带 ?fvw=320&fvh=480 时生效，正常浏览不受影响）：
       *   无头 Chrome 的 --window-size 与真实 innerHeight 不等价（实测少 ~96px），
       *   min(aw/320, ah/480) 会算出 0.8 → 画布 256×384，截图就整体缩小并偏右，
       *   看着像"代码把画面挪走了"，其实只是量尺不准。这里直接锁死像素尺寸。 */
      var _fw = /[?&]fvw=(\d+)/.exec(location.search);
      var _fh = /[?&]fvh=(\d+)/.exec(location.search);
      if (_fw && _fh) {
        var fw = Math.max(1, +_fw[1]), fh = Math.max(1, +_fh[1]);
        cv.style.width = fw + 'px';
        cv.style.height = fh + 'px';
        cv.width = fw;
        cv.height = fh;
        /* 无头浏览器视口最小 512×384，flex 居中会把画布推出左上角，
         * 截图左上角 320×480 就变成"画面整体右移"。这里直接钉在 (0,0)。 */
        cv.style.position = 'fixed';
        cv.style.left = '0';
        cv.style.top = '0';
        this.dpr = 1;
        this._cssK = fw / cc.WIN.width;
        return;
      }
      var host = cv.parentElement || document.body;
      var aw = host.clientWidth || global.innerWidth || cc.WIN.width;
      var ah = host.clientHeight || global.innerHeight || cc.WIN.height;
      var k = Math.min(aw / cc.WIN.width, ah / cc.WIN.height);
      if (!isFinite(k) || k <= 0) k = 1;
      var cw = Math.round(cc.WIN.width * k);
      var chh = Math.round(cc.WIN.height * k);
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      cv.style.width = cw + 'px';
      cv.style.height = chh + 'px';
      cv.width = Math.max(1, Math.round(cw * dpr));
      cv.height = Math.max(1, Math.round(chh * dpr));
      this.dpr = dpr;
      this._cssK = k;
    },

    runScene: function (scene) {
      if (this._sceneStack.length) {
        var old = this._sceneStack.pop();
        exitAll(old);
        old.onExit && old.onExit();
      }
      this._sceneStack.push(scene);
      scene.onEnter && scene.onEnter();
      enterAll(scene);
      if (!this._running) this._start();
    },

    replaceScene: function (scene) {
      while (this._sceneStack.length) {
        var s = this._sceneStack.pop();
        exitAll(s);
        s.onExit && s.onExit();
      }
      this._sceneStack.push(scene);
      scene.onEnter && scene.onEnter();
      enterAll(scene);
      if (!this._running) this._start();
    },

    pushScene: function (scene) {
      var cur = this.getRunningScene();
      if (cur) { exitAll(cur); cur.onExit && cur.onExit(); }
      this._sceneStack.push(scene);
      scene.onEnter && scene.onEnter();
      enterAll(scene);
    },

    popScene: function () {
      var top = this._sceneStack.pop();
      if (top) { exitAll(top); top.onExit && top.onExit(); }
      var cur = this.getRunningScene();
      if (cur) { cur.onEnter && cur.onEnter(); enterAll(cur); }
    },

    getRunningScene: function () { return this._sceneStack[this._sceneStack.length - 1]; },

    _start: function () {
      this._running = true;
      this._last = performance.now();
      var self = this;
      (function frame(t) {
        self._tick(t);
        global.requestAnimationFrame(frame);
      })(this._last);
    },

    _tick: function (t) {
      var dt = (t - this._last) / 1000;
      if (dt > 0.1) dt = 0.1;            // 切标签页回来不跳帧
      this._last = t;
      this.deltaTime = dt;
      this.totalTime += dt;

      var scene = this.getRunningScene();
      if (!scene) return;

      // update
      scene.update && scene.update(dt);
      var layers = flatten(scene);
      for (var i = 0; i < layers.length; i++) layers[i].update(dt);
      // actions
      this._runActions(scene, dt);

      // render
      var ctx = this.ctx;
      var k = this._cssK * this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      cc._drawK = k;          // 暴露给需要自行 setTransform 的自定义绘制层
      ctx.imageSmoothingEnabled = true;

      // 背景层（Scene 自带）
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cc.WIN.width, cc.WIN.height);

      this._render(scene, ctx);
      this._docLayers = layers;
    },

    _render: function (node, ctx) {
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (c.visible === false) continue;
        // 自定义绘制层：先画自己，再画子节点（保证 z 序正确）
        if (c.isCustomDraw && c.draw) c.draw(ctx);
        else if (c instanceof Sprite) this._drawSprite(c, ctx);
        else if (c instanceof Label) this._drawLabel(c, ctx);
        this._render(c, ctx);
      }
    },

    _drawSprite: function (s, ctx) {
      if (!s.frame && !s._rawImg) return;
      var img = s.frame ? TextureCache.get(s.frame.png) : s._rawImg;
      if (!img || !img.complete || !img.naturalWidth) return;
      var ow = s.size.width, oh = s.size.height;
      var sx = s.scaleX, sy = s.scaleY;
      var px = s.position.x, py = s.position.y;
      var op = s.opacity / 255;

      ctx.save();
      ctx.globalAlpha = op;
      // 平移到锚点（cocos2d: 锚点在 px,py，y 向上）
      ctx.translate(px, cc.WIN.height - py);
      if (s.rotation) ctx.rotate(-s.rotation * Math.PI / 180);
      ctx.scale(sx, sy);

      var boxLeft = -s.anchor.x * ow;                  // canvas 左上原点相对锚点
      var boxTop = -oh * (1 - s.anchor.y);             // cocos2d 锚点 y 向上：ay=0 时整块在锚点上方
      // 注意：canvas y 向下、cocos y 向上，故 ay=0 (左下) 的框顶在相对 -oh 处
      if (s.frame) {
        var f = s.frame;
        ctx.drawImage(img,
          f.x, f.y, f.w, f.h,
          boxLeft + f.left, boxTop + f.top, f.w, f.h);
      } else {
        ctx.drawImage(img, boxLeft, boxTop, ow, oh);
      }
      if (s.color) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = s.color;
        ctx.fillRect(boxLeft, boxTop, ow, oh);
      }
      ctx.restore();
    },

    _drawLabel: function (l, ctx) {
      ctx.save();
      ctx.globalAlpha = l.opacity / 255;
      ctx.translate(l.position.x, cc.WIN.height - l.position.y);
      if (l.rotation) ctx.rotate(-l.rotation * Math.PI / 180);
      ctx.scale(l.scaleX, l.scaleY);
      ctx.font = (l.italic ? 'italic ' : '') + (l.bold ? 'bold ' : '') + l.fontSize + 'px ' + l.fontFamily;
      ctx.textBaseline = 'middle';
      ctx.textAlign = l.align === 'center' ? 'center' : (l.align === 'right' ? 'right' : 'left');
      var x0 = 0;
      for (var i = 0; i < l._lines.length; i++) {
        var ly = i * l.lineHeight + l.lineHeight / 2;
        if (l.strokeWidth) {
          ctx.lineWidth = l.strokeWidth;
          ctx.strokeStyle = l.strokeFill || '#000';
          ctx.lineJoin = 'round';
          ctx.strokeText(l._lines[i], x0, ly);
        }
        ctx.fillStyle = l.fill;
        ctx.fillText(l._lines[i], x0, ly);
      }
      ctx.restore();
    },

    /* ---------------------------------------------------------------- 输入 */
    _bindInput: function () {
      var self = this;
      var cv = this.canvas;
      var down = false;

      function toLogic(ev) {
        var r = cv.getBoundingClientRect();
        var cx = (ev.clientX - r.left) / r.width * cc.WIN.width;
        var cy = (ev.clientY - r.top) / r.height * cc.WIN.height;
        return { x: cx, y: cc.WIN.height - cy };    // 转成 y 向上
      }

      function layers() { return self._docLayers || []; }

      function began(p, ev) {
        var ls = layers();
        for (var i = ls.length - 1; i >= 0; i--) {
          if (ls[i].visible !== false && ls[i].onTouchBegan(p.x, p.y, ev)) return true;
        }
        return false;
      }

      cv.addEventListener('mousedown', function (e) {
        down = true;
        var p = toLogic(e); began(p, e);
      });
      cv.addEventListener('mousemove', function (e) {
        if (!down) return;
        var p = toLogic(e), ls = layers();
        for (var i = ls.length - 1; i >= 0; i--) ls[i].onTouchMoved && ls[i].onTouchMoved(p.x, p.y, e);
      });
      global.addEventListener('mouseup', function (e) {
        if (!down) return;
        down = false;
        var p = toLogic(e), ls = layers();
        for (var i = ls.length - 1; i >= 0; i--) ls[i].onTouchEnded && ls[i].onTouchEnded(p.x, p.y, e);
      });

      cv.addEventListener('touchstart', function (e) {
        e.preventDefault();
        for (var t = 0; t < e.changedTouches.length; t++) {
          var p = toLogic(e.changedTouches[t]); began(p, e);
        }
      }, { passive: false });
      cv.addEventListener('touchmove', function (e) {
        e.preventDefault();
        var ls = layers();
        for (var t = 0; t < e.changedTouches.length; t++) {
          var p = toLogic(e.changedTouches[t]);
          for (var i = ls.length - 1; i >= 0; i--) ls[i].onTouchMoved && ls[i].onTouchMoved(p.x, p.y, e);
        }
      }, { passive: false });
      cv.addEventListener('touchend', function (e) {
        e.preventDefault();
        var ls = layers();
        for (var t = 0; t < e.changedTouches.length; t++) {
          var p = toLogic(e.changedTouches[t]);
          for (var i = ls.length - 1; i >= 0; i--) ls[i].onTouchEnded && ls[i].onTouchEnded(p.x, p.y, e);
        }
      }, { passive: false });
      cv.addEventListener('touchcancel', function (e) {
        var ls = layers();
        for (var i = ls.length - 1; i >= 0; i--) ls[i].onTouchEnded && ls[i].onTouchEnded(0, 0, e);
      });

      global.addEventListener('keydown', function (e) {
        var ls = layers();
        for (var i = ls.length - 1; i >= 0; i--) {
          if (ls[i].onKeyDown && ls[i].onKeyDown(e) === true) { e.preventDefault(); return; }
        }
      });
      global.addEventListener('keyup', function (e) {
        var ls = layers();
        for (var i = ls.length - 1; i >= 0; i--) {
          if (ls[i].onKeyUp && ls[i].onKeyUp(e) === true) { e.preventDefault(); return; }
        }
      });
    },

    /* --------------------------------------------------------------- Action */
    runAction: function (node, action) {
      node._actions = node._actions || [];
      action.time = 0;
      node._actions.push(action);
      return action;
    },
    _runActions: function (node, dt) {
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (c._actions && c._actions.length) {
          for (var a = c._actions.length - 1; a >= 0; a--) {
            var ac = c._actions[a];
            ac.time += dt;
            var done = ac.step(c, ac.time);
            if (done) { c._actions.splice(a, 1); ac.onDone && ac.onDone(c); }
          }
        }
        this._runActions(c, dt);
      }
    }
  };

  /* 极简 action */
  cc.moveBy = function (dur, dx, dy) {
    return {
      step: function (n, t) {
        var p = Math.min(1, t / dur);
        if (!n._moveBase) n._moveBase = { x: n.position.x, y: n.position.y };
        n.setPosition(n._moveBase.x + dx * p, n._moveBase.y + dy * p);
        if (p >= 1) { n._moveBase = null; return true; }
        return false;
      }
    };
  };
  cc.fadeTo = function (dur, to) {
    return {
      step: function (n, t) {
        var p = Math.min(1, t / dur);
        if (n._fadeFrom === undefined) n._fadeFrom = n.opacity;
        n.setOpacity(n._fadeFrom + (to - n._fadeFrom) * p);
        if (p >= 1) { n._fadeFrom = undefined; return true; }
        return false;
      }
    };
  };
  cc.delay = function (dur) { return { step: function (n, t) { return t >= dur; } }; };
  cc.callFunc = function (fn) { return { step: function (n, t) { if (t > 0) { fn(n); return true; } return false; } }; };
  cc.sequence = function () {
    var acts = Array.prototype.slice.call(arguments);
    return {
      _i: 0, _t: 0,
      step: function (n, t) {
        while (this._i < acts.length) {
          var a = acts[this._i];
          var local = t - this._t;
          var done = a.step(n, local);
          if (done) { this._t = t; this._i++; }
          else return false;
        }
        return true;
      }
    };
  };

  /* ------------------------------------------------------------- 工具/缓动 */
  cc.lerp = function (a, b, t) { return a + (b - a) * t; };
  cc.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  cc.rand = function (a, b) { return a + Math.random() * (b - a); };
  cc.easeOut = function (t) { return 1 - Math.pow(1 - t, 2.2); };
  cc.easeIn = function (t) { return Math.pow(t, 2.2); };

  /* --------------------------------------------------------------- 本地存储 */
  cc.Store = {
    get: function (k, d) {
      try {
        var v = global.localStorage.getItem('lddr13.' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { global.localStorage.setItem('lddr13.' + k, JSON.stringify(v)); } catch (e) { }
    }
  };

  /* --------------------------------------------------------------- 音频 */
  // 用 <audio> + currentTime 作为**游戏时钟**，避免 rAF 抖动累积漂移
  cc.Audio = function (url) {
    var a = new Audio();
    a.src = url;
    a.preload = 'auto';
    this.el = a;
    this.url = url;
  };
  cc.Audio.prototype = {
    play: function () {
      var p = this.el.play();
      if (p && p.catch) p.catch(function () { });
      return this;
    },
    pause: function () { this.el.pause(); },
    stop: function () { this.el.pause(); try { this.el.currentTime = 0; } catch (e) { } },
    getTimeMs: function () { return this.el.currentTime * 1000; },
    getDurationMs: function () {
      var d = this.el.duration;
      return isFinite(d) ? d * 1000 : 0;
    },
    setVolume: function (v) { this.el.volume = cc.clamp(v, 0, 1); },
    isEnded: function () { return this.el.ended; }
  };

  global.cc = cc;
})(window);
