/* =============================================================================
 * cocos2d_lua.js —— 让原版 config.lua 原封不动跑起来的 cocos2d 绑定
 *
 * 一个曲包的 config.lua 里搭的是**演奏背景层**：InitBackLayer 建图，
 * PlayBg1 / PlayBg2 是两套状态（普通 / 特殊），backLayerCommonState /
 * backlayerSpecialState 由原生代码在连击到达阈值时切换，move_tick /
 * shuaicong_tick 之类的函数走 CCScheduler 每 0.01 秒调一次。
 *
 * 这里实现的是 cocos2d-iPhone 1.x 的那套 action / node 语义：
 *   node 坐标原点左下、y 向上；anchor(0,0)=左下、(0,1)=左上；
 *   action 在 runAction 那一刻快照起始值。
 * ========================================================================== */
(function (global) {
  'use strict';
  var cc = global.cc;
  var W = 320, H = 480;

  function Y(y) { return H - y; }

  /* ------------------------------------------------------------- Lua 节点 */
  function Node(img, rect) {
    this.img = img || null;
    this.rect = rect || { x: 0, y: 0, w: img ? img.naturalWidth : 0, h: img ? img.naturalHeight : 0 };
    this.x = 0; this.y = 0;
    this.ax = 0.5; this.ay = 0.5;
    this.sx = 1; this.sy = 1;
    this.rot = 0;
    this.opacity = 255;
    this.visible = true;
    this.flipX = false;
    this.flipY = false;
    this.children = [];
    this.actions = [];
  }
  Node.prototype.addChild = function (c) { this.children.push(c); };
  Node.prototype.removeAllChildren = function () { this.children.length = 0; };
  Node.prototype.tickActions = function (dt) {
    for (var i = 0; i < this.actions.length; i++) {
      if (this.actions[i].step(this, dt)) { this.actions.splice(i, 1); i--; }
    }
    for (var j = 0; j < this.children.length; j++) this.children[j].tickActions(dt);
  };
  Node.prototype.draw = function (ctx) {
    if (this.visible === false || this.opacity <= 0) return;
    var w = this.rect.w, h = this.rect.h;
    if (this.img && w > 0 && h > 0 && this.img.complete && this.img.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = this.opacity / 255;
      ctx.translate(this.x, Y(this.y));
      if (this.rot) ctx.rotate(-this.rot * Math.PI / 180);
      if (this.sx !== 1 || this.sy !== 1) ctx.scale(this.sx, this.sy);
      if (this.flipX || this.flipY) ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
      ctx.drawImage(this.img, this.rect.x, this.rect.y, w, h,
        -this.ax * w, -(1 - this.ay) * h, w, h);
      ctx.restore();
    }
    for (var i = 0; i < this.children.length; i++) this.children[i].draw(ctx);
  };

  /* --------------------------------------------------------------- Actions */
  function timed(dur, onStart, onStep) {
    return {
      _t: 0, _started: false, _from: null,
      step: function (node, dt) {
        if (!this._started) { this._started = true; if (onStart) this._from = onStart(node); }
        this._t += dt;
        var p = dur <= 0 ? 1 : Math.min(1, this._t / dur);
        if (onStep) onStep(node, p, this._from);
        return p >= 1;
      },
      reset: function () { this._t = 0; this._started = false; this._from = null; }
    };
  }

  function A() { }
  A.moveTo = function (d, p) {
    return timed(d, function (n) { return { x: n.x, y: n.y }; }, function (n, k, f) {
      n.x = f.x + (p.x - f.x) * k; n.y = f.y + (p.y - f.y) * k;
    });
  };
  A.moveBy = function (d, p) {
    return timed(d, function (n) { return { x: n.x, y: n.y }; }, function (n, k, f) {
      n.x = f.x + p.x * k; n.y = f.y + p.y * k;
    });
  };
  A.rotateBy = function (d, deg) {
    return timed(d, function (n) { return n.rot; }, function (n, k, f) { n.rot = f + deg * k; });
  };
  A.scaleTo = function (d, s) {
    return timed(d, function (n) { return { sx: n.sx, sy: n.sy }; }, function (n, k, f) {
      n.sx = f.sx + (s - f.sx) * k; n.sy = f.sy + (s - f.sy) * k;
    });
  };
  A.fadeIn = function (d) {
    return timed(d, function (n) { return n.opacity; }, function (n, k, f) { n.opacity = f + (255 - f) * k; });
  };
  A.fadeOut = function (d) {
    return timed(d, function (n) { return n.opacity; }, function (n, k, f) { n.opacity = f + (0 - f) * k; });
  };
  A.fadeTo = function (d, to) {
    return timed(d, function (n) { return n.opacity; }, function (n, k, f) { n.opacity = f + (to - f) * k; });
  };
  A.delay = function (d) { return timed(d); };
  A.place = function (p) {
    return {
      _done: false,
      step: function (n) { if (!this._done) { n.x = p.x; n.y = p.y; this._done = true; } return true; }
    };
  };
  A.hide = function () { return { step: function (n) { n.visible = false; return true; } }; };
  A.show = function () { return { step: function (n) { n.visible = true; return true; } }; };
  A.callName = function (name) {
    return { step: function () { cc.Lua.call(name, []); return true; } };
  };
  A.sequence = function (a, b) {
    return {
      _i: 0, _t: 0,
      step: function (n, dt) {
        this._t += dt;
        var local = this._t;
        while (this._i === 0) {
          if (a.step(n, local)) { this._i = 1; this._t = 0; local = 0; break; }
          return false;
        }
        return b.step(n, this._t);
      }
    };
  };
  A.spawn = function (a, b) {
    return {
      _da: false, _db: false,
      step: function (n, dt) {
        var da = this._da || (this._da = true, false) || a.step(n, dt);
        if (a.step) { }
        return false;
      }
    };
  };
  // 上面的 spawn 写歪了，重新给一个干净的实现
  A.spawn = function (a, b) {
    var da = false, db = false;
    return {
      step: function (n, dt) {
        if (!da) da = a.step(n, dt);
        if (!db) db = b.step(n, dt);
        return da && db;
      }
    };
  };
  A.repeatForever = function (a) {
    return {
      step: function (n, dt) {
        var done = a.step(n, dt);
        if (done) { if (a.reset) a.reset(); return false; }
        return false;
      }
    };
  };

  /* ------------------------------------------------------------ 绑定对象 */
  function makePoint(x, y) { return { x: x, y: y }; }

  function buildCocos2d(filepath, onReady) {
    var g = {};

    function sizeOf(node) { return { width: node.rect.w, height: node.rect.h }; }

    function texObject(img) {
      return {
        __img: img,
        getContentSize: function () { return { width: img.naturalWidth, height: img.naturalHeight }; }
      };
    }

    function spriteFromImage(img, rect) {
      var n = new Node(img, rect);
      n.setPosition = function (p) { n.x = p.x; n.y = p.y; };
      n.getPosition = function () { return makePoint(n.x, n.y); };
      n.setAnchorPoint = function (p) { n.ax = p.x; n.ay = p.y; };
      n.setScale = function (s) { n.sx = s; n.sy = s; };
      n.setRotation = function (r) { n.rot = r; };
      n.setOpacity = function (o) { n.opacity = o; };
      n.setFlipX = function (b) { n.flipX = !!b; };
      n.setFlipY = function (b) { n.flipY = !!b; };
      n.isFlipX = function () { return n.flipX; };
      n.isFlipY = function () { return n.flipY; };
      n.setIsVisible = function (v) { n.visible = !!v; };
      n.isVisible = function () { return n.visible; };
      n.getContentSize = function () { return sizeOf(n); };
      n.runAction = function (a) { if (a) { if (a.reset) a.reset(); n.actions.push(a); } };
      n.stopAllActions = function () { n.actions.length = 0; };
      n.addChild = function (c) { n.children.push(c); };
      n.removeAllChildrenWithCleanup = function () { n.children.length = 0; };
      n.removeFromParentAndCleanup = function () { n.__removed = true; };
      return n;
    }

    var root = new Node(null, { x: 0, y: 0, w: 0, h: 0 });
    root.visible = true;

    // cocos2d.*
    var coco = {};

    coco.CCPoint = makePoint;
    coco.CCRectMake = function (x, y, w, h) { return { x: x, y: y, width: w, height: h, w: w, h: h }; };

    coco.CCLayer = {
      node: function () {
        var n = new Node(null, { x: 0, y: 0, w: 0, h: 0 });
        n.addChild = function (c) {
          if (c && c.__removed) return;
          root.children.push(c);
        };
        n.removeAllChildrenWithCleanup = function () { root.children.length = 0; };
        n.removeFromParentAndCleanup = function () { root.children.length = 0; };
        n.setPosition = function () { };
        n.setIsVisible = function () { };
        return n;
      }
    };

    coco.CCTextureCache = {
      sharedTextureCache: function () {
        return {
          addImage: function (path) {
            var img = cc.TextureCache.addImage(path);
            if (img && img.complete && img.naturalWidth) {
              // 已预载好，同步可用
            }
            return texObject(img);
          },
          removeTexture: function () { }
        };
      }
    };

    coco.CCSprite = {
      spriteWithFile: function (path) {
        var img = cc.TextureCache.addImage(path);
        return spriteFromImage(img, null);
      },
      spriteWithTexture: function (tex, rect) {
        return spriteFromImage(tex.__img, {
          x: rect.x, y: rect.y, w: Math.round(rect.width), h: Math.round(rect.height)
        });
      }
    };

    coco.CCScheduler = {
      sharedScheduler: function () {
        return {
          scheduleScriptFunc: function (name, interval) {
            scheduled.push({ name: name, interval: interval || 0.016, acc: 0 });
          },
          unscheduleScriptFunc: function (name) {
            for (var i = scheduled.length - 1; i >= 0; i--) if (scheduled[i].name === name) scheduled.splice(i, 1);
          }
        };
      }
    };

    coco.CCSequence = { actionOneTwo: function (a, b) { return A.sequence(a, b); } };
    coco.CCSpawn = { actionOneTwo: function (a, b) { return A.spawn(a, b); } };
    coco.CCRepeatForever = { actionWithAction: function (a) { return A.repeatForever(a); } };
    coco.CCMoveTo = {
      actionWithDuration: function (d, p) { return A.moveTo(d, p); },
      actionWithDurationXYZ: function (d, p) { return A.moveTo(d, p); }
    };
    coco.CCMoveBy = { actionWithDuration: function (d, p) { return A.moveBy(d, p); } };
    coco.CCRotateBy = { actionWithDuration: function (d, deg) { return A.rotateBy(d, deg); } };
    coco.CCRotateTo = { actionWithDuration: function (d, deg) { return A.rotateBy(d, deg); } };
    coco.CCScaleTo = { actionWithDuration: function (d, s) { return A.scaleTo(d, s); } };
    coco.CCFadeIn = { actionWithDuration: function (d) { return A.fadeIn(d); } };
    coco.CCFadeOut = { actionWithDuration: function (d) { return A.fadeOut(d); } };
    coco.CCFadeTo = { actionWithDuration: function (d, o) { return A.fadeTo(d, o); } };
    coco.CCDelayTime = { actionWithDuration: function (d) { return A.delay(d); } };
    coco.CCPlace = { actionWithPosition: function (p) { return A.place(p); } };
    coco.CCHide = { action: function () { return A.hide(); } };
    coco.CCShow = { action: function () { return A.show(); } };
    coco.CCCallFunc = { actionWithScriptFuncName: function (n) { return A.callName(n); } };

    var scheduled = [];
    var mainScene = { addChild: function (c) { if (c && c.__removed) return; root.children.push(c); } };
    var GS = { getMainScene: function () { return mainScene; } };

    return {
      globals: {
        cocos2d: coco,
        GameScene: GS,
        collectgarbage: function () { }
      },
      root: root,
      scheduled: scheduled,
      tick: function (dt) {
        /* ?still 用于和原版截图逐像素比对：背景 Lua 层**停止滚动**
         * （scroll_y 等由 scheduled 回调驱动），但**入场动作要照常跑完**。
         *
         * 这一点很关键：config.lua 末尾的 action141→action151→…→action171
         * 是一条 0.1s+0.1s+0.1s 的串行链，把 1_4~1_7（曲名/英文标题四行字）
         * 从屏幕外 x=320 滑到 x=160。之前连 tickActions 一起冻住，
         * 结果这四行字永远停在 x=320（屏外），画面上就「没有标题」。
         *
         * 所以这里只跳过 scheduled（滚动），动作链继续推进。 */
        if (cc._luaStill) {
          /* 静帧下**停止滚动**（scheduled 是 scroll_y 驱动），
           * 但**入场动作必须跑完** —— config.lua 末尾的
           * action141→151→161→171 会把 1_4~1_7（曲名/英文标题四行）
           * 从屏外 x=320 滑到 x=160。一起冻住的话标题永远在屏外，
           * 画面上就是「没有 JAM WILD DREAMS 那三行」。 */
          root.tickActions(dt);
          return;
        }
        for (var i = 0; i < scheduled.length; i++) {
          var s = scheduled[i];
          s.acc += dt;
          var guard = 0;
          while (s.acc >= s.interval && guard++ < 8) {
            s.acc -= s.interval;
            cc.Lua.call(s.name, [dt]);
          }
        }
        root.tickActions(dt);
      },
      draw: function (ctx) { root.draw(ctx); }
    };
  }

  /* ------------------------------------------------------- 背景层宿主 Layer */
  cc.LuaBackLayer = function (filepath, luaSrc) {
    var layer = new cc.Layer();
    function L() { cc.Layer.call(this); this.isCustomDraw = true; }
    L.prototype = Object.create(cc.Layer.prototype);
    L.prototype.constructor = L;
    var self = new L();

    self.ready = false;
    self.state = 'none';
    self.binding = null;

    // 从 Lua 源码里把用到的 png 抠出来预载，保证 addImage 时尺寸同步可读
    var urls = [];
    var re = /"([^"]*\.png)"/g, m;
    while ((m = re.exec(luaSrc))) {
      var u = filepath + m[1].replace(/^.*\//, '/');
      if (urls.indexOf(u) < 0) urls.push(u);
    }

    cc.TextureCache.preload(urls, null, function () {
      cc.Lua.reset();
      var b = buildCocos2d(filepath);
      self.binding = b;
      try {
        cc.Lua.run(luaSrc, b.globals);
        if (cc.Lua.has('InitBackLayer')) cc.Lua.call('InitBackLayer', [filepath]);
      } catch (e) {
        console.error('[LuaBackLayer] 执行 config.lua 失败:', e);
        self.error = e;
      }
      self.ready = true;
      if (self._pendingState) { self.setState(self._pendingState); self._pendingState = null; }
    });

    self.setState = function (state) {
      if (!self.ready) { self._pendingState = state; return; }
      if (self.state === state) return;
      self.state = state;
      try {
        if (state === 'special') {
          if (cc.Lua.has('backlayerSpecialState')) cc.Lua.call('backlayerSpecialState', []);
        } else {
          if (cc.Lua.has('backLayerCommonState')) cc.Lua.call('backLayerCommonState', []);
        }
      } catch (e) { console.error('[LuaBackLayer] 切换状态失败:', e); }
    };

    self.update = function (dt) {
      if (!self.ready || !self.binding) return;
      if (dt > 0.1) dt = 0.1;
      try { self.binding.tick(dt); } catch (e) { /* 单帧异常不打断游戏 */ }
    };

    self.draw = function (ctx) {
      if (!self.ready || !self.binding) return;
      self.binding.draw(ctx);
    };

    self.dispose = function () {
      try { if (cc.Lua.has('releaseBackLayer')) cc.Lua.call('releaseBackLayer', []); } catch (e) { }
    };

    return self;
  };

})(window);
