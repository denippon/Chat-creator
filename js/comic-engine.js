/* ============================================================================
   ComicEngine — panel composition, speech balloons, tails, panel breaks.

   This is the part of Comic Chat that mattered: an expert system decides who
   is in the panel, where they stand, where each balloon goes, and when the
   panel is full. Reading order is enforced by placing the first speaker
   leftmost, then stacking later balloons down and to the right.
   ========================================================================== */
(function (root) {
  'use strict';

  var CA = root.ComicAvatar;

  var CFG = {
    PW: 400, PH: 320,          // panel size (drawing units)
    FLOOR: 302,                // characters stand here
    CH_SCALE: 0.82,            // character scale inside a panel
    ZONE: 132,                 // balloons must fit above this y
    MAXB: 3,                   // balloons per panel
    MAXCAST: 3,
    FAMILY: "'Comic Sans MS','Comic Neue','Segoe Print','Chalkboard SE',sans-serif",
    FSIZE: 15, LH: 19, PAD: 9, MAXW: 152, MINW: 54, EMSZ: 22,
    INK: '#141414', PAPER: '#fffdf3'
  };

  CFG.FONT = '600 ' + CFG.FSIZE + 'px ' + CFG.FAMILY;

  var mc = document.createElement('canvas').getContext('2d');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------- text measurement */

  function tokenWidth(t) {
    if (t.t === 'e') return CFG.EMSZ + 3;
    mc.font = CFG.FONT;
    return mc.measureText(t.s).width;
  }

  /* Greedy wrap over tokens. Returns {w,h,lines:[{items,w}]} */
  function wrap(tokens, maxW) {
    maxW = maxW || CFG.MAXW;
    mc.font = CFG.FONT;
    var spaceW = mc.measureText(' ').width;
    var lines = [], cur = [], curW = 0;

    function flush() { if (cur.length) { lines.push({ items: cur, w: curW }); cur = []; curW = 0; } }

    tokens.forEach(function (t) {
      var w = tokenWidth(t);
      // hard-break a single token that can never fit
      if (w > maxW && t.t === 'w') {
        flush();
        var s = t.s, buf = '';
        for (var i = 0; i < s.length; i++) {
          if (mc.measureText(buf + s[i]).width > maxW && buf) {
            lines.push({ items: [{ t: 'w', s: buf }], w: mc.measureText(buf).width });
            buf = '';
          }
          buf += s[i];
        }
        if (buf) { cur = [{ t: 'w', s: buf }]; curW = mc.measureText(buf).width; }
        return;
      }
      var add = curW ? spaceW + w : w;
      if (curW + add > maxW && cur.length) flush();
      curW += curW ? spaceW + w : w;
      cur.push(t);
    });
    flush();
    if (!lines.length) lines.push({ items: [{ t: 'w', s: '…' }], w: 12 });

    var w = Math.max(CFG.MINW, Math.max.apply(null, lines.map(function (l) { return l.w; })));
    return { w: w, h: lines.length * CFG.LH, lines: lines };
  }

  /* --------------------------------------------------------- balloon shapes */

  function roundRect(x, y, w, h, r) {
    return 'M' + (x + r) + ',' + y + ' h' + (w - 2 * r) + ' a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
           ' v' + (h - 2 * r) + ' a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r + ' h' + (-(w - 2 * r)) +
           ' a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + (-r) + ' v' + (-(h - 2 * r)) +
           ' a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) + ' Z';
  }

  function cloud(x, y, w, h) {
    // bumps around the perimeter, spaced evenly
    var out = [], step = 17, cx = x + w / 2, cy = y + h / 2;
    var rx = w / 2, ry = h / 2;
    var n = Math.max(10, Math.round((w + h) / step));
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry;
      var r = 8 + (i % 3) * 1.6;
      out.push('<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + r + '"/>');
    }
    out.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8"/>');
    return out.join('');
  }

  function burst(x, y, w, h) {
    var pts = [], cx = x + w / 2, cy = y + h / 2;
    var n = Math.max(14, Math.round((w + h) / 11)) * 2;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var k = (i % 2) ? 1 : 1.26;
      pts.push(((cx + Math.cos(a) * (w / 2) * k)).toFixed(1) + ',' + ((cy + Math.sin(a) * (h / 2) * k)).toFixed(1));
    }
    return 'M' + pts.join(' L') + ' Z';
  }

  function tail(b, hx, hy) {
    // triangle from the balloon edge nearest the head, toward the head
    var bx = Math.min(Math.max(hx, b.x + 12), b.x + b.w - 12);
    var by = b.y + b.h;
    var side = hx < b.x + b.w / 2 ? 1 : -1;
    var tipX = hx + side * 3, tipY = Math.max(by + 6, hy - 6);
    return 'M' + (bx - 9) + ',' + (by - 3) + ' L' + (bx + 9) + ',' + (by - 3) + ' L' + tipX + ',' + tipY + ' Z';
  }

  function thoughtTail(b, hx, hy) {
    var bx = Math.min(Math.max(hx, b.x + 14), b.x + b.w - 14);
    var by = b.y + b.h;
    var out = '';
    for (var i = 1; i <= 3; i++) {
      var t = i / 4;
      out += '<circle cx="' + (bx + (hx - bx) * t).toFixed(1) + '" cy="' + (by + (hy - by) * t * 0.8).toFixed(1) +
             '" r="' + (5.5 - i * 1.2).toFixed(1) + '" fill="#fff" stroke="' + CFG.INK + '" stroke-width="2"/>';
    }
    return out;
  }

  /* ------------------------------------------------------------ panel model */

  function newPanel() {
    return { cast: [], balloons: [], born: Date.now(), closed: false, id: 'p' + Math.random().toString(36).slice(2, 9) };
  }

  function castX(n, i) {
    if (n <= 1) return [200][i];
    if (n === 2) return [96, 304][i];
    return [68, 200, 332][i];
  }

  /* Can `msg` join this panel? If yes, mutate and return true. */
  function tryAdd(panel, msg) {
    if (panel.closed) return false;
    if (panel.balloons.length >= CFG.MAXB) return false;

    var known = panel.cast.some(function (c) { return c.user === msg.user; });
    if (!known && panel.cast.length >= CFG.MAXCAST) return false;

    // scene break: a long pause starts a fresh panel
    if (panel.balloons.length && Date.now() - panel.last > (CFG.IDLE || 25000)) return false;

    var cast = known ? panel.cast.slice() : panel.cast.concat([{ user: msg.user, login: msg.login, spec: msg.spec, color: msg.color }]);
    var balloons = panel.balloons.concat([msg]);
    var laid = layout(cast, balloons);
    if (!laid) return false;                      // ran out of vertical room

    if (!known) panel.cast.push({ user: msg.user, login: msg.login, spec: msg.spec, color: msg.color });
    panel.balloons.push(msg);
    panel.laid = laid;
    panel.last = Date.now();
    return true;
  }

  /* Place characters + balloons. Returns null if the balloons don't fit. */
  function layout(cast, balloons) {
    // 1. cast order = order of first speech, left to right (reading order)
    var order = [];
    balloons.forEach(function (b) { if (order.indexOf(b.user) < 0) order.push(b.user); });
    cast.forEach(function (c) { if (order.indexOf(c.user) < 0) order.push(c.user); });
    var seats = order.map(function (u) {
      return cast.filter(function (c) { return c.user === u; })[0];
    }).filter(Boolean);

    var n = seats.length;
    var pos = {};
    seats.forEach(function (c, i) {
      var x = castX(n, i);
      pos[c.user] = { x: x, flip: n > 1 && x > 200, spec: c.spec, color: c.color, name: c.user };
    });

    // 2. balloons: above the speaker, pushed down past anything they overlap
    var placed = [];
    for (var i = 0; i < balloons.length; i++) {
      var b = balloons[i];
      var m = b.metrics || (b.metrics = wrap(b.tokens, CFG.MAXW));
      var w = m.w + CFG.PAD * 2, h = m.h + CFG.PAD * 2;
      var sx = pos[b.user] ? pos[b.user].x : 200;
      var x = Math.min(Math.max(sx - w / 2, 8), CFG.PW - 8 - w);
      var y = 10;
      for (var j = 0; j < placed.length; j++) {
        var p = placed[j];
        if (x < p.x + p.w + 7 && p.x < x + w + 7) y = Math.max(y, p.y + p.h + 9);
      }
      if (y + h > CFG.ZONE + (b.kind === 'shout' ? 4 : 0)) return null;
      placed.push({ x: x, y: y, w: w, h: h, m: m, msg: b });
    }
    return { seats: seats, pos: pos, balloons: placed };
  }

  /* ---------------------------------------------------------------- render */

  function renderChar(p) {
    var s = CFG.CH_SCALE * 1;
    var tx = p.x - (CA.W * s) / 2, ty = CFG.FLOOR - CA.H * s;
    var body = CA.draw(p.spec, p.emotion || 'neutral', { flip: p.flip });
    var label = '<text x="' + p.x + '" y="' + (CFG.FLOOR + 13) + '" text-anchor="middle" ' +
      'font-family="Verdana,Geneva,sans-serif" font-size="11" font-weight="700" ' +
      'fill="' + (p.color || '#333') + '" stroke="#fffdf3" stroke-width="3" paint-order="stroke">' +
      esc(p.name) + '</text>';
    return '<g transform="translate(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ') scale(' + s + ')">' + body + '</g>' + label;
  }

  function renderBalloon(b, pos) {
    var m = b.m, msg = b.msg, kind = msg.kind || 'speech';
    var head = pos[msg.user];
    var hx = head ? head.x : 200;
    var hy = CFG.FLOOR - CA.H * CFG.CH_SCALE + 12 * CFG.CH_SCALE;
    var out = '';

    if (kind === 'thought') {
      out += '<g fill="#fff" stroke="' + CFG.INK + '" stroke-width="2.4">' + cloud(b.x, b.y, b.w, b.h) + '</g>';
      out += '<g fill="#fff" stroke="none">' + cloud(b.x + 2, b.y + 2, b.w - 4, b.h - 4) + '</g>';
      out += thoughtTail(b, hx, hy);
    } else if (kind === 'shout') {
      out += '<path d="' + burst(b.x, b.y, b.w, b.h) + '" fill="#fff" stroke="' + CFG.INK + '" stroke-width="2.6"/>';
      out += '<path d="' + tail(b, hx, hy) + '" fill="#fff" stroke="' + CFG.INK + '" stroke-width="2.6"/>';
      out += '<path d="' + tail(b, hx, hy) + '" fill="#fff" stroke="none"/>';
    } else if (kind === 'whisper') {
      out += '<path d="' + tail(b, hx, hy) + '" fill="#fff" stroke="' + CFG.INK + '" stroke-width="2" stroke-dasharray="5 4"/>';
      out += '<path d="' + roundRect(b.x, b.y, b.w, b.h, 11) + '" fill="#fff" stroke="' + CFG.INK + '" stroke-width="2" stroke-dasharray="5 4"/>';
      out += '<path d="' + tail(b, hx, hy) + '" fill="#fff" stroke="none"/>';
    } else {
      out += '<path d="' + tail(b, hx, hy) + '" fill="#fff" stroke="' + CFG.INK + '" stroke-width="2.6" stroke-linejoin="round"/>';
      out += '<path d="' + roundRect(b.x, b.y, b.w, b.h, 12) + '" fill="#fff" stroke="' + CFG.INK + '" stroke-width="2.6"/>';
      out += '<path d="' + tail(b, hx, hy) + '" fill="#fff" stroke="none"/>';
    }

    // text
    var ty = b.y + CFG.PAD;
    mc.font = CFG.FONT;
    var spaceW = mc.measureText(' ').width;
    out += '<g font-family="' + CFG.FAMILY + '" font-size="' + CFG.FSIZE + '" font-weight="600" fill="' + CFG.INK + '">';
    m.lines.forEach(function (ln, li) {
      var x = b.x + b.w / 2 - ln.w / 2;
      var base = ty + li * CFG.LH + CFG.FSIZE - 1;
      ln.items.forEach(function (t) {
        if (t.t === 'e') {
          out += '<image href="' + esc(t.url) + '" x="' + x.toFixed(1) + '" y="' + (base - CFG.EMSZ + 4).toFixed(1) +
                 '" width="' + CFG.EMSZ + '" height="' + CFG.EMSZ + '" preserveAspectRatio="xMidYMid meet"/>';
          x += CFG.EMSZ + 3 + spaceW;
        } else {
          out += '<text x="' + x.toFixed(1) + '" y="' + base.toFixed(1) + '" xml:space="preserve">' + esc(t.s) + '</text>';
          x += mc.measureText(t.s).width + spaceW;
        }
      });
    });
    out += '</g>';
    return out;
  }

  function render(panel, opts) {
    opts = opts || {};
    var laid = panel.laid;
    if (!laid) return '';
    var out = '';

    // paper
    out += '<rect x="0" y="0" width="' + CFG.PW + '" height="' + CFG.PH + '" fill="' + (opts.paper || CFG.PAPER) + '"/>';
    out += '<rect x="0" y="' + (CFG.FLOOR - 118) + '" width="' + CFG.PW + '" height="' + (CFG.PH - CFG.FLOOR + 118) + '" fill="rgba(0,0,0,.045)"/>';
    out += '<line x1="0" y1="' + (CFG.FLOOR - 118) + '" x2="' + CFG.PW + '" y2="' + (CFG.FLOOR - 118) + '" stroke="' + CFG.INK + '" stroke-width="1.6" opacity=".35"/>';

    // characters, back to front
    laid.seats.forEach(function (c) {
      var p = laid.pos[c.user];
      var last = null;
      for (var i = panel.balloons.length - 1; i >= 0; i--) {
        if (panel.balloons[i].user === c.user) { last = panel.balloons[i]; break; }
      }
      p.emotion = last ? last.emotion : 'neutral';
      out += renderChar(p);
    });

    // balloons on top
    laid.balloons.forEach(function (b) { out += renderBalloon(b, laid.pos); });

    // frame
    out += '<rect x="1.5" y="1.5" width="' + (CFG.PW - 3) + '" height="' + (CFG.PH - 3) + '" fill="none" stroke="' + CFG.INK + '" stroke-width="3"/>';

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + CFG.PW + ' ' + CFG.PH + '" width="100%" height="100%">' + out + '</svg>';
  }

  root.ComicEngine = {
    CFG: CFG, newPanel: newPanel, tryAdd: tryAdd, layout: layout, render: render, wrap: wrap
  };
})(window);
