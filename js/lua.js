/* =============================================================================
 * lua.js —— Lua 5.1 子集解释器（够跑原版 config.lua 用的那一部分）
 *
 * 为什么要有这个东西：各曲包里的 config.lua 是**没编译的原始 Lua 源码**，
 * 里面写着演奏背景每个图层的坐标、锚点、动作和状态机。与其照着抄成 JS
 * （那就是重写了），不如让原文件原封不动跑起来。
 *
 * 支持的语法 = 这 8 个 config.lua 实际用到的全部：
 *   local / 赋值 / function / if-then(-elseif-else)-end / for i=a,b[,c] do end
 *   while / do-end / return / break / 函数调用 / 方法调用 a:b() / 字段 a.b / a[k]
 *   表构造 {…} / .. / + - * / % ^ / 比较 / and or not / # / nil true false
 * 没做的：元表、协程、varargs、多返回值（只取第一个）、goto。
 * ========================================================================== */
(function (global) {
  'use strict';

  var cc = global.cc = global.cc || {};

  /* ------------------------------------------------------------------ 词法 */
  var KW = {};
  ('and break do else elseif end false for function if in local nil not or ' +
    'repeat return then true until while').split(' ').forEach(function (k) { KW[k] = 1; });

  var OPS = ['...', '..', '==', '~=', '<=', '>=',
    '+', '-', '*', '/', '%', '^', '#', '<', '>', '=',
    '(', ')', '{', '}', '[', ']', ';', ':', ',', '.'];

  function lex(src) {
    var i = 0, n = src.length, line = 1, out = [];

    function isDigit(c) { return c >= '0' && c <= '9'; }
    function isAlpha(c) { return /[A-Za-z_]/.test(c); }
    function isAlnum(c) { return /[A-Za-z0-9_]/.test(c); }

    while (i < n) {
      var c = src[i];

      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

      // 注释
      if (c === '-' && src[i + 1] === '-') {
        i += 2;
        if (src[i] === '[' && src[i + 1] === '[') {
          i += 2;
          while (i < n && !(src[i] === ']' && src[i + 1] === ']')) { if (src[i] === '\n') line++; i++; }
          i += 2;
        } else {
          while (i < n && src[i] !== '\n') i++;
        }
        continue;
      }

      // 长字符串
      if (c === '[' && src[i + 1] === '[') {
        i += 2;
        var s0 = '';
        while (i < n && !(src[i] === ']' && src[i + 1] === ']')) {
          if (src[i] === '\n') line++;
          s0 += src[i++];
        }
        i += 2;
        out.push({ t: 'str', v: s0, line: line });
        continue;
      }

      // 字符串
      if (c === '"' || c === "'") {
        var q = c, s = '';
        i++;
        while (i < n && src[i] !== q) {
          if (src[i] === '\\') {
            i++;
            var e = src[i];
            if (e === 'n') s += '\n';
            else if (e === 't') s += '\t';
            else if (e === 'r') s += '\r';
            else if (e === '\n') { s += '\n'; line++; }
            else s += e;
            i++;
          } else {
            if (src[i] === '\n') line++;
            s += src[i++];
          }
        }
        i++;
        out.push({ t: 'str', v: s, line: line });
        continue;
      }

      // 数字
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
        var st = i;
        while (i < n && /[0-9a-fA-FxX.]/.test(src[i])) i++;
        var txt = src.slice(st, i);
        out.push({ t: 'num', v: parseFloat(txt), line: line });
        continue;
      }

      // 名字 / 关键字
      if (isAlpha(c)) {
        var st2 = i;
        while (i < n && isAlnum(src[i])) i++;
        var w = src.slice(st2, i);
        out.push({ t: KW[w] ? 'kw' : 'name', v: w, line: line });
        continue;
      }

      // 运算符
      var matched = null;
      for (var k = 0; k < OPS.length; k++) {
        if (src.substr(i, OPS[k].length) === OPS[k]) { matched = OPS[k]; break; }
      }
      if (!matched) throw new Error('lua lex: 无法识别的字符 ' + JSON.stringify(c) + ' 第 ' + line + ' 行');
      i += matched.length;
      out.push({ t: 'op', v: matched, line: line });
    }

    out.push({ t: 'eof', v: null, line: line });
    return out;
  }

  /* ------------------------------------------------------------------ 语法 */
  function parse(toks) {
    var p = 0;

    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function isOp(v) { var t = toks[p]; return t.t === 'op' && t.v === v; }
    function isKw(v) { var t = toks[p]; return t.t === 'kw' && t.v === v; }
    function acceptOp(v) { if (isOp(v)) { p++; return true; } return false; }
    function acceptKw(v) { if (isKw(v)) { p++; return true; } return false; }
    function expectOp(v) {
      if (!isOp(v)) throw new Error('lua parse: 期望 "' + v + '"，得到 "' + peek().v + '" 第 ' + peek().line + ' 行');
      p++;
    }
    function expectKw(v) {
      if (!isKw(v)) throw new Error('lua parse: 期望 "' + v + '"，得到 "' + peek().v + '" 第 ' + peek().line + ' 行');
      p++;
    }
    function expectName() {
      var t = peek();
      if (t.t !== 'name') throw new Error('lua parse: 期望名字，得到 "' + t.v + '" 第 ' + t.line + ' 行');
      p++;
      return t.v;
    }

    /* ---- 表达式，优先级爬升 ---- */
    var BIN = {
      'or': [1, 1], 'and': [2, 2],
      '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
      '..': [5, 4],        // 右结合
      '+': [6, 6], '-': [6, 6],
      '*': [7, 7], '/': [7, 7], '%': [7, 7],
      '^': [10, 9]         // 右结合
    };
    var UNARY = 8;

    function expr(limit) {
      var e = unary();
      for (;;) {
        var t = peek();
        var op = t.t === 'op' || t.t === 'kw' ? t.v : null;
        var prec = op && BIN[op];
        if (!prec || prec[0] <= (limit || 0)) break;
        p++;
        var rhs = expr(prec[1]);
        e = { t: 'Bin', op: op, l: e, r: rhs };
      }
      return e;
    }

    function unary() {
      var t = peek();
      if (t.t === 'op' && (t.v === '-' || t.v === '#')) {
        p++;
        return { t: 'Un', op: t.v, e: expr(UNARY) };
      }
      if (t.t === 'kw' && t.v === 'not') {
        p++;
        return { t: 'Un', op: 'not', e: expr(UNARY) };
      }
      return primary();
    }

    function primary() {
      var e = simple();
      for (;;) {
        if (isOp('.')) {
          p++;
          var nm = expectName();
          e = { t: 'Index', obj: e, key: { t: 'Str', v: nm } };
        } else if (isOp('[')) {
          p++;
          var k = expr(0);
          expectOp(']');
          e = { t: 'Index', obj: e, key: k };
        } else if (isOp(':')) {
          p++;
          var ln = peek().line;
          var m = expectName();
          var args = callArgs();
          e = { t: 'Method', obj: e, name: m, args: args, line: ln };
        } else if (isOp('(')) {
          var ln2 = peek().line;
          var args2 = callArgs();
          e = { t: 'Call', fn: e, args: args2, line: ln2 };
        } else if (peek().t === 'str') {
          var ln3 = peek().line;
          var s = next().v;
          e = { t: 'Call', fn: e, args: [{ t: 'Str', v: s }], line: ln3 };
        } else break;
      }
      return e;
    }

    function callArgs() {
      expectOp('(');
      var a = [];
      if (!isOp(')')) {
        a.push(expr(0));
        while (acceptOp(',')) a.push(expr(0));
      }
      expectOp(')');
      return a;
    }

    function simple() {
      var t = peek();
      if (t.t === 'num') { p++; return { t: 'Num', v: t.v }; }
      if (t.t === 'str') { p++; return { t: 'Str', v: t.v }; }
      if (t.t === 'kw') {
        if (t.v === 'nil') { p++; return { t: 'Nil' }; }
        if (t.v === 'true') { p++; return { t: 'True' }; }
        if (t.v === 'false') { p++; return { t: 'False' }; }
        if (t.v === 'function') { p++; return funcBody(); }
      }
      if (t.t === 'op' && t.v === '{') return tableCtor();
      if (t.t === 'op' && t.v === '(') {
        p++;
        var e = expr(0);
        expectOp(')');
        return e;
      }
      if (t.t === 'name') { p++; return { t: 'Name', v: t.v }; }
      throw new Error('lua parse: 意外的记号 "' + t.v + '" 第 ' + t.line + ' 行');
    }

    function funcBody() {
      expectOp('(');
      var params = [];
      if (!isOp(')')) {
        params.push(expectName());
        while (acceptOp(',')) params.push(expectName());
      }
      expectOp(')');
      var body = block();
      expectKw('end');
      return { t: 'FuncExpr', params: params, body: body };
    }

    function tableCtor() {
      expectOp('{');
      var items = [];
      while (!isOp('}')) {
        if (isOp('[')) {
          p++;
          var k = expr(0);
          expectOp(']');
          expectOp('=');
          items.push({ k: k, v: expr(0) });
        } else if (peek().t === 'name' && toks[p + 1].t === 'op' && toks[p + 1].v === '=') {
          var nm = next().v;
          p++; // =
          items.push({ k: { t: 'Str', v: nm }, v: expr(0) });
        } else {
          items.push({ k: null, v: expr(0) });   // 数组项
        }
        if (!acceptOp(',') && !acceptOp(';')) break;
      }
      expectOp('}');
      return { t: 'Table', items: items };
    }

    /* ---- 语句 ---- */
    function block() {
      var body = [];
      while (!(isKw('end') || isKw('else') || isKw('elseif') || peek().t === 'eof')) {
        body.push(stat());
        acceptOp(';');
      }
      return { t: 'Block', body: body };
    }

    function stat() {
      var t = peek();

      if (t.t === 'kw') {
        if (t.v === 'local') {
          p++;
          if (isKw('function')) {
            p++;
            var fn = expectName();
            var f = funcBody();
            return { t: 'LocalFunc', name: fn, func: f };
          }
          var names = [expectName()];
          while (acceptOp(',')) names.push(expectName());
          var exprs = [];
          if (acceptOp('=')) { exprs.push(expr(0)); while (acceptOp(',')) exprs.push(expr(0)); }
          return { t: 'Local', names: names, exprs: exprs };
        }
        if (t.v === 'function') {
          p++;
          // 支持 a.b.c:m 形式
          var target = { t: 'Name', v: expectName() };
          while (isOp('.')) { p++; target = { t: 'Index', obj: target, key: { t: 'Str', v: expectName() } }; }
          var isMethod = false;
          if (isOp(':')) { p++; target = { t: 'Index', obj: target, key: { t: 'Str', v: expectName() } }; isMethod = true; }
          var body = funcBody();
          if (isMethod) body.params.unshift('self');
          return { t: 'Func', target: target, func: body };
        }
        if (t.v === 'if') {
          p++;
          var branches = [];
          var cond = expr(0);
          expectKw('then');
          branches.push({ cond: cond, body: block() });
          var els = null;
          for (;;) {
            if (isKw('elseif')) {
              p++;
              var c2 = expr(0);
              expectKw('then');
              branches.push({ cond: c2, body: block() });
            } else if (isKw('else')) {
              p++;
              els = block();
            } else break;
          }
          expectKw('end');
          return { t: 'If', branches: branches, els: els };
        }
        if (t.v === 'for') {
          p++;
          var v = expectName();
          expectOp('=');
          var from = expr(0);
          expectOp(',');
          var to = expr(0);
          var step = null;
          if (acceptOp(',')) step = expr(0);
          expectKw('do');
          var b = block();
          expectKw('end');
          return { t: 'For', name: v, from: from, to: to, step: step, body: b };
        }
        if (t.v === 'while') {
          p++;
          var wc = expr(0);
          expectKw('do');
          var wb = block();
          expectKw('end');
          return { t: 'While', cond: wc, body: wb };
        }
        if (t.v === 'do') {
          p++;
          var db = block();
          expectKw('end');
          return { t: 'Do', body: db };
        }
        if (t.v === 'return') {
          p++;
          var ex = [];
          if (!(isKw('end') || isKw('else') || isKw('elseif') || peek().t === 'eof' || isOp(';'))) {
            ex.push(expr(0));
            while (acceptOp(',')) ex.push(expr(0));
          }
          return { t: 'Return', exprs: ex };
        }
        if (t.v === 'break') { p++; return { t: 'Break' }; }
      }

      // 表达式语句（赋值或函数调用）
      var e = primary();
      if (isOp('=') || isOp(',')) {
        var targets = [e];
        while (acceptOp(',')) targets.push(primary());
        expectOp('=');
        var vals = [expr(0)];
        while (acceptOp(',')) vals.push(expr(0));
        return { t: 'Assign', targets: targets, exprs: vals };
      }
      return { t: 'CallStmt', call: e };
    }

    var chunk = block();
    if (peek().t !== 'eof') throw new Error('lua parse: 多余内容 "' + peek().v + '" 第 ' + peek().line + ' 行');
    return chunk;
  }

  /* ------------------------------------------------------------------ 表 */
  function Table() { this.arr = []; this.map = Object.create(null); }
  Table.prototype.get = function (k) {
    if (typeof k === 'number') return this.arr[k - 1];
    return this.map[k];
  };
  Table.prototype.set = function (k, v) {
    if (typeof k === 'number' && k >= 1 && k === Math.floor(k)) {
      if (k > 100000) { this.map[k] = v; return; }
      this.arr[k - 1] = v;
    } else {
      this.map[k] = v;
    }
  };
  Table.prototype.len = function () {
    var n = this.arr.length;
    while (n > 0 && this.arr[n - 1] === undefined) n--;
    return n;
  };

  /* ------------------------------------------------------------------ 环境 */
  function Env(parent) { this.vars = Object.create(null); this.parent = parent; }
  Env.prototype.find = function (name) {
    var e = this;
    while (e) {
      if (name in e.vars) return e;
      e = e.parent;
    }
    return null;
  };
  Env.prototype.get = function (name) {
    var e = this.find(name);
    if (e) return e.vars[name];
    return GLOBALS[name];          // 作用域链里没有 → 落到全局表
  };
  Env.prototype.set = function (name, v) {
    var e = this.find(name);
    if (e) { e.vars[name] = v; return; }
    GLOBALS[name] = v;
  };
  var GLOBALS = Object.create(null);

  /* ---------------------------------------------------------------- 控制流 */
  var BREAK = { __break: true };
  function Return(vals) { this.vals = vals; }

  /* ---------------------------------------------------------------- 求值 */
  function Interp() { this.globals = GLOBALS; this.callHook = null; }

  function truthy(v) { return !(v === undefined || v === null || v === false); }

  function getIdx(obj, key) {
    if (obj instanceof Table) return obj.get(key);
    if (obj === undefined || obj === null) return undefined;
    if (typeof obj === 'string') return undefined;
    return obj[key];
  }
  function setIdx(obj, key, v) {
    if (obj instanceof Table) { obj.set(key, v); return; }
    obj[key] = v;
  }

  function Interp_eval(node, env) { return evalNode(node, env); }

  /** 把表达式节点还原成 "a.b.c" 形式，报错时能看出是哪个名字没找到 */
  function describeFn(node) {
    if (!node) return '?';
    if (node.t === 'Name') return node.v;
    if (node.t === 'Index') {
      var base = describeFn(node.obj);
      var key = node.key.t === 'Str' ? node.key.v : '[...]';
      return base + '.' + key;
    }
    if (node.t === 'Method') return describeFn(node.obj) + ':' + node.name;
    if (node.t === 'Call') return describeFn(node.fn) + '()';
    return '(' + node.t + ')';
  }

  function callValue(fn, args, self) {
    if (fn === undefined || fn === null) throw new Error('lua: 调用了一个 nil');
    if (typeof fn === 'function') return fn.apply(self === undefined ? null : self, args);
    if (fn && fn.__luaFn) {
      var f = fn;
      var newEnv = new Env(f.env);
      for (var i = 0; i < f.params.length; i++) newEnv.vars[f.params[i]] = args[i];
      if (self !== undefined) newEnv.vars['self'] = self;
      try {
        execBlock(f.body, newEnv);
      } catch (e) {
        if (e instanceof Return) return e.vals.length ? e.vals[0] : undefined;
        throw e;
      }
      return undefined;
    }
    throw new Error('lua: 不是可调用对象');
  }

  function evalNode(node, env) {
    switch (node.t) {
      case 'Nil': return undefined;
      case 'True': return true;
      case 'False': return false;
      case 'Num': case 'Str': return node.v;
      case 'Name': return env.get(node.v);

      case 'Index': return getIdx(evalNode(node.obj, env), evalNode(node.key, env));

      case 'FuncExpr': {
        var f = { __luaFn: true, params: node.params, body: node.body, env: env };
        return f;
      }

      case 'Table': {
        var tbl = new Table(), ai = 1;
        for (var i = 0; i < node.items.length; i++) {
          var it = node.items[i];
          var v = evalNode(it.v, env);
          if (it.k) tbl.set(evalNode(it.k, env), v);
          else tbl.set(ai++, v);
        }
        return tbl;
      }

      case 'Call': {
        var fn = evalNode(node.fn, env);
        var args = [];
        for (var j = 0; j < node.args.length; j++) args.push(evalNode(node.args[j], env));
        if (fn === undefined || fn === null) {
          throw new Error('lua: 调用了 nil ' + describeFn(node.fn) + ' (第 ' + node.line + ' 行)');
        }
        return callValue(fn, args, undefined);
      }

      case 'Method': {
        var obj = evalNode(node.obj, env);
        var m = getIdx(obj, node.name);
        var a2 = [];
        for (var q = 0; q < node.args.length; q++) a2.push(evalNode(node.args[q], env));
        if (m === undefined || m === null) {
          throw new Error('lua: ' + describeFn(node.obj) + ' 没有方法 ' + node.name + ' (第 ' + node.line + ' 行)');
        }
        return callValue(m, a2, obj);
      }

      case 'Un': {
        if (node.op === '-') return -evalNode(node.e, env);
        if (node.op === 'not') return !truthy(evalNode(node.e, env));
        if (node.op === '#') {
          var tv = evalNode(node.e, env);
          if (tv instanceof Table) return tv.len();
          if (typeof tv === 'string') return tv.length;
          if (Array.isArray(tv)) return tv.length;
          return 0;
        }
        break;
      }

      case 'Bin': {
        var op = node.op;
        if (op === 'and') { var l = evalNode(node.l, env); return truthy(l) ? evalNode(node.r, env) : l; }
        if (op === 'or') { var l2 = evalNode(node.l, env); return truthy(l2) ? l2 : evalNode(node.r, env); }
        var a = evalNode(node.l, env), b = evalNode(node.r, env);
        switch (op) {
          case '..': return luaToStr(a) + luaToStr(b);
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return a / b;
          case '%': return a % b;
          case '^': return Math.pow(a, b);
          case '==': return a === b;
          case '~=': return a !== b;
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          case '>=': return a >= b;
        }
        break;
      }
    }
    throw new Error('lua: 未知节点 ' + node.t);
  }

  function luaToStr(v) {
    if (v === undefined || v === null) return 'nil';
    if (v === true) return 'true';
    if (v === false) return 'false';
    return String(v);
  }

  function execBlock(block, env) {
    for (var i = 0; i < block.body.length; i++) {
      execStat(block.body[i], env);
    }
  }

  function execStat(s, env) {
    switch (s.t) {
      case 'Local': {
        var vals = [];
        for (var i = 0; i < s.exprs.length; i++) vals.push(evalNode(s.exprs[i], env));
        for (var j = 0; j < s.names.length; j++) env.vars[s.names[j]] = vals[j];
        return;
      }
      case 'LocalFunc': {
        var f = { __luaFn: true, params: s.func.params, body: s.func.body, env: env };
        env.vars[s.name] = f;
        return;
      }
      case 'Func': {
        var fn = { __luaFn: true, params: s.func.params, body: s.func.body, env: env };
        assignTo(s.target, env, fn);
        return;
      }
      case 'Assign': {
        var vs = [];
        for (var k = 0; k < s.exprs.length; k++) vs.push(evalNode(s.exprs[k], env));
        for (var m = 0; m < s.targets.length; m++) assignTo(s.targets[m], env, vs[m]);
        return;
      }
      case 'CallStmt': evalNode(s.call, env); return;
      case 'If': {
        for (var b = 0; b < s.branches.length; b++) {
          if (truthy(evalNode(s.branches[b].cond, env))) { execBlock(s.branches[b].body, new Env(env)); return; }
        }
        if (s.els) execBlock(s.els, new Env(env));
        return;
      }
      case 'For': {
        var from = evalNode(s.from, env), to = evalNode(s.to, env);
        var step = s.step ? evalNode(s.step, env) : 1;
        for (var v = from; step > 0 ? v <= to : v >= to; v += step) {
          var e2 = new Env(env);
          e2.vars[s.name] = v;
          try { execBlock(s.body, e2); }
          catch (x) { if (x === BREAK) break; throw x; }
        }
        return;
      }
      case 'While': {
        var guard = 0;
        while (truthy(evalNode(s.cond, env))) {
          try { execBlock(s.body, new Env(env)); }
          catch (x) { if (x === BREAK) break; throw x; }
          if (++guard > 1e6) throw new Error('lua: while 疑似死循环');
        }
        return;
      }
      case 'Do': execBlock(s.body, new Env(env)); return;
      case 'Return': {
        var rv = [];
        for (var r = 0; r < s.exprs.length; r++) rv.push(evalNode(s.exprs[r], env));
        throw new Return(rv);
      }
      case 'Break': throw BREAK;
    }
    throw new Error('lua: 未知语句 ' + s.t);
  }

  function assignTo(target, env, v) {
    if (target.t === 'Name') { env.set(target.v, v); return; }
    if (target.t === 'Index') {
      var obj = evalNode(target.obj, env);
      setIdx(obj, evalNode(target.key, env), v);
      return;
    }
    throw new Error('lua: 不能赋值的左值');
  }

  /* ------------------------------------------------------------------ 对外 */
  var Lua = cc.Lua = {
    Table: Table,
    GLOBALS: GLOBALS,
    lex: lex,
    parse: parse,

    /** 编译并执行一段 Lua 源码。globals 会写进共享全局表 */
    run: function (src, extraGlobals) {
      if (extraGlobals) for (var k in extraGlobals) GLOBALS[k] = extraGlobals[k];
      var ast = parse(lex(src));
      var env = new Env(null);
      try { execBlock(ast, env); }
      catch (e) { if (!(e instanceof Return)) throw e; }
      return GLOBALS;
    },

    /** 调用全局函数，供调度器用 */
    call: function (name, args) {
      var fn = GLOBALS[name];
      if (typeof fn !== 'function' && !(fn && fn.__luaFn)) return undefined;
      return callValue(fn, args || [], undefined);
    },

    has: function (name) { return GLOBALS[name] !== undefined; },

    set: function (name, v) { GLOBALS[name] = v; },

    reset: function () {
      for (var k in GLOBALS) delete GLOBALS[k];
    }
  };

  return Lua;
})(window);
