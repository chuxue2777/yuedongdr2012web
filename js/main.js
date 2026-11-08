/* =============================================================================
 * main.js —— 装配：注册图集 → 预载图片 → 进标题场景
 * ========================================================================== */
(function () {
  'use strict';

  window.SONGS = window.SONGS_2013 || [];

  var canvas = document.getElementById('game');
  var loading = document.getElementById('loading');
  var pbar = document.getElementById('pbar');
  var ltip = document.getElementById('ltip');

  /* ★ 预载层不用再算缩放：背景图在 CSS 里 center/cover 铺满，
   *   进度条贴屏幕底部按屏宽等比（见 style.css 的 #loading 段）。
   *   以前这里用 transform: translate(-50%,-50%) scale(cover) 缩放整块 320×480，
   *   在 9:19.5 的手机上会把底部进度条整个裁出屏幕 —— 已废弃。 */

  // 截图/嵌入式使用：立刻隐藏载入层
  if (location.search.indexOf('still') >= 0) loading.style.display = 'none';

  /* 调试：?hold=nn 让载入层停在进度 nn%（不消失），用来核对官方 loading 版式。
   * 例：index.html?hold=100 → 进度条满格、页面不跳转。 */
  var _hold = /[?&]hold=(\d+)/.exec(location.search);
  var HOLD_P = _hold ? Math.min(100, +_hold[1]) : -1;

  cc.Director.init(canvas);

  // 注册所有图集
  var atlases = window.ATLAS_2013 || {};
  var urls = [];
  for (var name in atlases) {
    cc.SpriteFrameCache.addAtlas(name, atlases[name]);
    urls.push(atlases[name].png);
  }
  // 去重
  urls = urls.filter(function (u, i) { return urls.indexOf(u) === i; });

  // 调试：无头环境 rAF 不稳，用定时器泵推进定步长模拟
  (function () {
    var m = /[?&]step=(\d+)/.exec(location.search);
    if (!m) return;
    var step = Number(m[1]);
    setInterval(function () {
      var g = window.__GAME__;
      if (g) g.update(step / 1000);
    }, 0);
  })();

  // 调试：自动演奏时把实时成绩写进 title，方便无头环境读取
  if (/(^|[?&])auto=1/.test(location.search)) {
    setInterval(function () {
      var g = window.__GAME__;
      if (!g) return;
      document.title = 'AUTO t=' + Math.round(g._now || 0)
        + ' sc=' + g.score + ' cb=' + g.combo
        + ' P' + g.stats.PERFECT + ' G' + g.stats.GREAT + ' g' + g.stats.GOOD + ' M' + g.stats.MISS
        + ' life=' + Math.round(g.life) + ' n=' + g.total + ' idx=' + g.idxHead;
    }, 400);
  }

  var t0 = performance.now();
  cc.TextureCache.preload(urls, function (p) {
    /* 胶囊内腔宽 230 / 320 = 71.875%（素材实测 x 45~274），用百分比适配任意屏宽 */
    var pp = HOLD_P >= 0 ? HOLD_P / 100 : p;
    pbar.style.width = (71.875 * pp).toFixed(2) + '%';
    ltip.textContent = '正在载入原版美术… ' + Math.round(pp * 100) + '%';
  }, function () {
    if (HOLD_P >= 0) {                     // 调试停留，不跳场景
      pbar.style.width = (71.875 * HOLD_P / 100).toFixed(2) + '%';
      ltip.textContent = '载入完成';
      return;
    }
    ltip.textContent = '载入完成';
    pbar.style.width = '71.875%';
    // 至少留 250ms 让进度条走完，避免闪一下
    var wait = Math.max(0, 250 - (performance.now() - t0));
    setTimeout(function () {
      loading.classList.add('hide');
      // 便于调试/分享直达某个场景
      var q = new URLSearchParams(location.search);
      var sc = q.get('scene');
      if (sc === 'list') {
        cc.Director.runScene(cc.SceneList());
      } else if (sc === 'settings') {
        var sid = q.get('id') || (window.SONGS[0] && window.SONGS[0].id);
        var ssong = window.SONGS.filter(function (s) { return s.id === sid; })[0] || window.SONGS[0];
        try {
          cc.Director.runScene(cc.SceneSettings(ssong, q.get('mode') === '4' ? '4' : '3'));
        } catch (err) {
          document.title = 'SETTINGS_ERR: ' + (err && err.message ? err.message : err);
          console.error('[SceneSettings]', err);
        }
      } else if (sc === 'game') {
        var id = q.get('id') || (window.SONGS[0] && window.SONGS[0].id);
        var mode = q.get('mode') === '4' ? '4' : '3';
        var song = window.SONGS.filter(function (s) { return s.id === id; })[0] || window.SONGS[0];
        cc.Director.runScene(cc.SceneGame(song, mode));
      } else if (sc === 'loading') {
        var lid = q.get('id') || (window.SONGS[0] && window.SONGS[0].id);
        var lsong = window.SONGS.filter(function (x) { return x.id === lid; })[0] || window.SONGS[0];
        cc.Director.runScene(cc.SceneLoading(lsong, '3'));
      } else if (sc === 'result') {
        var song2 = window.SONGS[Number(q.get('i') || 4)];
        cc.Director.runScene(cc.SceneResult(song2, q.get('mode') === '4' ? '4' : '3', {
          score: 428600, combo: 271, total: 466,
          stats: { PERFECT: 401, GREAT: 42, GOOD: 12, MISS: 11 },
          acc: 97.6, perfectRate: 86.1, missRate: 2.3, failed: false
        }));
      } else {
        cc.Director.runScene(cc.SceneTitle());
      }
      window.__READY__ = true;
    }, wait);
  });
})();
