/* ============================================================================
   ComicAvatar — PNG asset compositor (v3)

   Characters are stacks of PNG files from /assets, described by
   assets/manifest.json. Layers are composited onto a canvas, recoloured by
   hue, and handed back as a single image — so a character costs one image no
   matter how many parts it has.

   RECOLOURING. PNGs have no text to find-and-replace, so recolouring works on
   pixels instead. Paint anything recolourable in one of five chroma-key
   colours; at render time every pixel whose HUE matches one of them is
   repainted in the viewer's colour, keeping its own light and dark shading.
   Anything you paint in a colour that isn't near those five hues is left
   exactly as you drew it.

     skin #ff00ff   hair #00ff00   top #0000ff   bottom #ffff00   accent #00ffff

   Public API:
     ComicAvatar.load(manifestUrl)   -> Promise, resolve before drawing
     ComicAvatar.ready               -> boolean
     ComicAvatar.slots()             -> visible slots, in picker order
     ComicAvatar.options(slotId)     -> [{id, file, back}]
     ComicAvatar.normalize(spec)
     ComicAvatar.fromSeed(name, col) -> deterministic character for a username
     ComicAvatar.draw(spec, emotion, opts) -> SVG <g> markup
     ComicAvatar.card(spec, emotion, size) -> standalone <svg>
     ComicAvatar.png(spec, emotion)  -> data URL of the composed character
     ComicAvatar.thumb(slot, id, spec) -> cropped <svg> for pickers
     ComicAvatar.encode(spec) / decode(code)  -> "CC2-…" share code
   ========================================================================== */
(function (root) {
  'use strict';

  var W = 120, H = 200;         // art units, the coordinate system everything uses
  var SS = 3;                   // source pixels per art unit (assets are 360x600)
  var M = null;
  var BASE = 'assets/';
  var IMG = {};                 // file -> HTMLImageElement
  var RENDER = {};              // cache key -> data URL
  var ready = false;

  var TOKENS = { skin: '#ff00ff', hair: '#00ff00', top: '#0000ff', bottom: '#ffff00', accent: '#00ffff' };
  var TOL = 18, MINSAT = 0.25;
  var ORDER = ['skin', 'hair', 'top', 'bottom', 'accent'];

  /* ------------------------------------------------------------- utilities */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hash32(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  var HEXRE = /^#[0-9a-f]{6}$/i;
  function color(v, fb) { return HEXRE.test(v || '') ? v.toLowerCase() : fb; }

  /* ------------------------------------------------------- colour space */

  function hex2rgb(h) {
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var l = (mx + mn) / 2, s = 0, h = 0;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (!s) { var v = Math.round(l * 255); return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
            Math.round(hue2rgb(p, q, h) * 255),
            Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
  }
  function hueDist(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  /* --------------------------------------------------------------- canvas */

  function makeCanvas(w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
    }
    if (root.createCanvas) return root.createCanvas(w, h);   // node-canvas, for tests
    return null;
  }

  /* Repaint every pixel whose hue sits near a token hue. Lightness is carried
     across, so shading and anti-aliased edges survive. */
  function recolour(data, pal) {
    var tok = (M && M.palette && M.palette.tokens) || TOKENS;
    var tol = (M && M.palette && M.palette.hueTolerance) || TOL;
    var minSat = (M && M.palette && M.palette.minSaturation) || MINSAT;

    var keys = [], target = [];
    ORDER.forEach(function (k) {
      if (!tok[k] || !pal[k]) return;
      var t = hex2rgb(tok[k]), p = hex2rgb(pal[k]);
      keys.push(rgb2hsl(t[0], t[1], t[2])[0]);
      target.push(rgb2hsl(p[0], p[1], p[2]));
    });
    if (!keys.length) return;

    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      var hsl = rgb2hsl(data[i], data[i + 1], data[i + 2]);
      if (hsl[1] < minSat) continue;                 // greys, whites, ink: leave alone
      var best = -1, bd = 1e9;
      for (var k = 0; k < keys.length; k++) {
        var d = hueDist(hsl[0], keys[k]);
        if (d < bd) { bd = d; best = k; }
      }
      if (bd > tol) continue;                        // a colour you chose on purpose
      var t = target[best];
      var lp = hsl[2], lo;
      lo = lp <= 0.5 ? t[2] * (lp / 0.5) : t[2] + (1 - t[2]) * ((lp - 0.5) / 0.5);
      var rgb = hsl2rgb(t[0], t[1], Math.max(0, Math.min(1, lo)));
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2];
    }
  }

  /* ---------------------------------------------------------------- loading */

  function loadImage(file) {
    var url = BASE + file;
    return new Promise(function (res) {
      if (typeof Image === 'undefined' && root.loadImage) {   // node-canvas, for tests
        root.loadImage(url).then(function (im) { IMG[file] = im; res(); },
                                 function () { res(); });
        return;
      }
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { IMG[file] = im; res(); };
      im.onerror = function () { res(); };                    // missing art = empty layer
      im.src = url;
    });
  }

  function load(manifestUrl) {
    manifestUrl = manifestUrl || 'assets/manifest.json';
    BASE = manifestUrl.replace(/[^/]*$/, '');
    return fetch(manifestUrl, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('manifest ' + r.status); return r.json(); })
      .then(function (j) {
        M = j;
        if (M.canvas && M.canvas.ss) SS = M.canvas.ss;
        var files = [];
        Object.keys(M.assets).forEach(function (slot) {
          M.assets[slot].forEach(function (a) {
            if (a.file) files.push(a.file);
            if (a.back) files.push(a.back);
          });
        });
        return Promise.all(files.map(loadImage));
      })
      .then(function () {
        // a canvas that can't be read means recolouring is impossible
        var c = makeCanvas(2, 2);
        if (!c) throw new Error('no canvas available');
        ready = true;
        return M;
      });
  }

  /* ------------------------------------------------------------ slot helpers */

  function slots() {
    if (!M) return [];
    return M.slots.filter(function (s) { return !s.hidden && !s.mirrors; })
                  .filter(function (s) { return (M.assets[s.id] || []).length; });
  }
  function slotDef(id) {
    if (!M) return null;
    for (var i = 0; i < M.slots.length; i++) if (M.slots[i].id === id) return M.slots[i];
    return null;
  }
  function options(slotId) { return (M && M.assets[slotId]) || []; }
  function assetById(slotId, id) {
    var list = options(slotId);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }
  function swatches(key) {
    return (M && M.palette && M.palette.swatches && M.palette.swatches[key]) || ['#888888'];
  }

  /* -------------------------------------------------------------- normalize */

  function defaults() {
    var d = {};
    slots().forEach(function (s) {
      var list = options(s.id);
      if (!list.length) return;
      var hasNone = list.some(function (a) { return a.id === 'none'; });
      d[s.id] = (s.optional && hasNone) ? 'none' : list[0].id;
    });
    return d;
  }

  function normalize(spec) {
    spec = spec || {};
    var p = spec.parts || {}, pal = spec.palette || {};
    var out = {
      id: String(spec.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25),
      name: String(spec.name || spec.id || 'Anon').slice(0, 25),
      scale: Math.min(1.25, Math.max(0.8, +spec.scale || 1)),
      parts: {},
      palette: {
        skin:   color(pal.skin, '#f6d5b8'),
        hair:   color(pal.hair, '#3a2a1a'),
        top:    color(pal.top, '#2980b9'),
        bottom: color(pal.bottom, '#2c3e50'),
        accent: color(pal.accent, '#c0392b')
      }
    };
    if (!M) { out.parts = JSON.parse(JSON.stringify(p)); return out; }
    var d = defaults();
    Object.keys(d).forEach(function (slot) {
      var want = p[slot];
      out.parts[slot] = options(slot).some(function (a) { return a.id === want; }) ? want : d[slot];
    });
    return out;
  }

  /* ------------------------------------------------------------- expressions */

  function resolveExpression(name) {
    if (!M) return { file: null, pose: {} };
    var ex = M.expressions || {};
    var key = String(name || 'neutral');
    if (ex.alias && ex.alias[key]) key = ex.alias[key];
    var list = M.assets.expression || [];
    var hit = list.filter(function (a) { return a.id === key; })[0];
    if (!hit) { hit = list.filter(function (a) { return a.id === 'neutral'; })[0] || list[0]; key = hit ? hit.id : key; }
    return { id: hit ? hit.id : null, file: hit ? hit.file : null, pose: (ex.pose && ex.pose[key]) || {} };
  }

  /* --------------------------------------------------------------- compose */

  /* Which files, in which order, make up this character. */
  function layerFiles(spec, emotion) {
    var useExpr = emotion !== '__base';
    var expr = useExpr ? resolveExpression(emotion) : { file: null };
    if (!expr.file) useExpr = false;

    var behind = [], body = [];
    M.slots.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (s) {
      if (useExpr && (s.expressive || s.id === 'brows')) {
        if (s.id === 'eyes') body.push(expr.file);   // the expression sits where the eyes were
        return;
      }
      if (s.mirrors) {
        var src = assetById(s.mirrors, spec.parts[s.mirrors]);
        if (src && src.file) body.push(src.file);
        return;
      }
      var a = assetById(s.id, spec.parts[s.id]);
      if (!a) return;
      if (s.backLayer) { if (a.back) behind.push(a.back); return; }
      if (a.file) body.push(a.file);
    });
    return behind.concat(body);
  }

  /* Composite + recolour once, then cache. Pose and flip are applied later as
     cheap SVG transforms, so they stay out of the cache key. */
  function png(spec, emotion, ss) {
    spec = normalize(spec);
    if (!ready) return '';
    ss = ss || SS;
    var files = layerFiles(spec, emotion);
    var key = files.join('|') + '#' + ORDER.map(function (k) { return spec.palette[k]; }).join('') + '@' + ss;
    if (RENDER[key]) return RENDER[key];

    var cw = Math.round(W * ss), ch = Math.round(H * ss);
    var cv = makeCanvas(cw, ch);
    var g = cv.getContext('2d');
    g.clearRect(0, 0, cw, ch);
    files.forEach(function (f) {
      var im = IMG[f];
      if (im) g.drawImage(im, 0, 0, cw, ch);
    });

    try {
      var id = g.getImageData(0, 0, cw, ch);
      recolour(id.data, spec.palette);
      g.putImageData(id, 0, 0);
    } catch (e) {
      // tainted canvas: serve the art in its raw chroma-key colours rather than nothing
      console.warn('[comic-avatar] cannot read the canvas, colours will not apply:', e.message);
    }
    var url = cv.toDataURL('image/png');
    RENDER[key] = url;
    return url;
  }

  /* -------------------------------------------------------------------- draw */

  function draw(spec, emotion, opts) {
    opts = opts || {};
    spec = normalize(spec);
    if (!ready) return '';
    var url = png(spec, emotion, opts.ss);
    if (!url) return '';
    var pose = (emotion !== '__base' ? resolveExpression(emotion).pose : {}) || {};

    var t = [];
    if (opts.flip) t.push('translate(' + W + ',0) scale(-1,1)');
    var sc = (spec.scale || 1) * (pose.grow || 1);
    if (sc !== 1) t.push('translate(60,200) scale(' + sc.toFixed(4) + ') translate(-60,-200)');
    if (pose.tilt) t.push('rotate(' + pose.tilt + ' 60 172)');
    if (pose.droop || pose.hop) t.push('translate(0,' + ((pose.droop || 0) - (pose.hop || 0)) + ')');

    return '<g' + (t.length ? ' transform="' + t.join(' ') + '"' : '') + '>' +
           '<image href="' + url + '" x="0" y="0" width="' + W + '" height="' + H +
           '" preserveAspectRatio="xMidYMid meet"/></g>';
  }

  function card(spec, emotion, size) {
    size = size || 200;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H +
           '" width="' + Math.round(size * W / H) + '" height="' + size + '">' +
           draw(spec, emotion) + '</svg>';
  }

  function thumb(slotId, assetId, spec, size) {
    var s = slotDef(slotId);
    var box = (s && s.thumb) || [0, 0, W, H];
    var probe = normalize(spec);
    probe.parts[slotId] = assetId;
    var faceSlot = (slotId === 'eyes' || slotId === 'mouth' || slotId === 'brows');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + box.join(' ') +
           '" width="100%" height="' + (size || 62) + '" preserveAspectRatio="xMidYMid meet">' +
           draw(probe, faceSlot ? '__base' : 'neutral', { ss: 1.5 }) + '</svg>';
  }

  /* ---------------------------------------------------------- auto character */

  function fromSeed(name, chatColor) {
    var n = String(name || 'anon').toLowerCase();
    var spec = normalize({ id: n.replace(/[^a-z0-9_]/g, ''), name: name });
    if (!ready) return spec;
    var r = rng(hash32(n));
    function p(list) { return list[Math.floor(r() * list.length)]; }

    slots().forEach(function (s) {
      var list = options(s.id);
      if (!list.length) return;
      if (s.optional && r() < 0.55 && list.some(function (a) { return a.id === 'none'; })) {
        spec.parts[s.id] = 'none'; return;
      }
      spec.parts[s.id] = p(list).id;
    });
    spec.scale = 0.9 + r() * 0.22;
    spec.palette = {
      skin: p(swatches('skin')), hair: p(swatches('hair')),
      top: color(chatColor, p(swatches('top'))),      // borrow their Twitch name colour
      bottom: p(swatches('bottom')), accent: p(swatches('accent'))
    };
    return normalize(spec);
  }

  /* -------------------------------------------------------------- share code */

  function b64u(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function ub64u(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }
  function encode(spec) {
    spec = normalize(spec);
    var parts = Object.keys(spec.parts).sort().map(function (k) { return k + ':' + spec.parts[k]; }).join(',');
    var cols = ORDER.map(function (k) { return spec.palette[k].slice(1); }).join('');
    return 'CC2-' + b64u([parts, cols, Math.round(spec.scale * 100), spec.name].join('~'));
  }
  function decode(code) {
    try {
      var m = String(code || '').trim().match(/CC2-([A-Za-z0-9\-_]+)/);
      if (!m) return null;
      var bits = ub64u(m[1]).split('~');
      if (bits.length < 4) return null;
      var parts = {};
      bits[0].split(',').forEach(function (kv) {
        var i = kv.indexOf(':');
        if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
      });
      var c = bits[1], pal = {};
      ORDER.forEach(function (k, i) { pal[k] = '#' + c.substr(i * 6, 6); });
      return normalize({ name: bits.slice(3).join('~'), scale: (+bits[2] || 100) / 100, parts: parts, palette: pal });
    } catch (e) { return null; }
  }

  root.ComicAvatar = {
    W: W, H: H,
    get M() { return M; },
    get ready() { return ready; },
    get EMOTIONS() { return (M && M.expressions && M.expressions.order) || ['neutral']; },
    load: load, slots: slots, slotDef: slotDef, options: options, swatches: swatches,
    normalize: normalize, defaults: defaults, fromSeed: fromSeed,
    draw: draw, card: card, png: png, thumb: thumb,
    encode: encode, decode: decode, esc: esc, hash32: hash32
  };
})(typeof window !== 'undefined' ? window : this);
