/* ============================================================================
   ComicAvatar — parametric SVG cartoon characters
   Part of Comic Chat JS. No dependencies. Classic script (works from file://).

   A character is described by a small JSON "spec". Given a spec + an emotion,
   this module returns SVG markup for a 120x200 character standing on y=200.

   Public API:
     ComicAvatar.OPT              part option lists (for the creator UI)
     ComicAvatar.EMOTIONS         list of emotion names
     ComicAvatar.PAL              suggested palettes
     ComicAvatar.normalize(spec)  fill in / clamp a spec
     ComicAvatar.fromSeed(name)   deterministic auto-avatar for a username
     ComicAvatar.draw(spec, emotion, opts) -> SVG <g> markup string
     ComicAvatar.card(spec, emotion, size) -> full <svg> string (previews)
     ComicAvatar.encode(spec) -> "CC1-xxxx" share code
     ComicAvatar.decode(code) -> spec | null
   ========================================================================== */
(function (root) {
  'use strict';

  var W = 120, H = 200;
  var HCX = 60, HCY = 46;          // head centre
  var SHOULDER = [34, 96];         // left shoulder (right is mirrored)
  var INK = '#141414';

  /* ---------------------------------------------------------------- options */

  var OPT = {
    head:       ['round', 'oval', 'square', 'tall', 'pear'],
    hair:       ['bald', 'buzz', 'short', 'spiky', 'long', 'curly', 'mohawk', 'bun', 'bob', 'ponytail'],
    eyes:       ['dot', 'round', 'anime', 'sharp', 'sleepy', 'shades'],
    brows:      ['none', 'flat', 'angled', 'thick', 'curved'],
    nose:       ['none', 'button', 'pointy', 'wide', 'hook'],
    facialHair: ['none', 'stubble', 'moustache', 'goatee', 'beard'],
    body:       ['tee', 'hoodie', 'suit', 'tank', 'jacket', 'robe', 'dress'],
    legs:       ['pants', 'shorts', 'skirt'],
    accessory:  ['none', 'headphones', 'cap', 'glasses', 'earrings', 'crown', 'halo', 'bandana']
  };

  var PAL = {
    skin:  ['#ffe0c4', '#f6d5b8', '#f0c39a', '#e0a878', '#c78a5c', '#a2653c', '#6f4426', '#4a2c17', '#b5e0c0', '#cbb8f0'],
    hair:  ['#1b1410', '#3a2a1a', '#6b4423', '#a9702f', '#d9a441', '#e8dcc0', '#b0b0b0', '#8b1e1e', '#2b4a7a', '#3f7a4a', '#7a3f7a', '#f05a9b', '#20c4c4'],
    cloth: ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#16a085', '#d35400', '#2c3e50', '#7f8c8d', '#e84393', '#1a1a1a', '#ecf0f1', '#00b894', '#0984e3', '#fdcb6e']
  };

  /* --------------------------------------------------------------- emotions */
  /* This is the "expert system" output vocabulary: what a character can do.
     Comic Chat's original wheel had ~12 of these; we carry 18. */

  var EMO = {
    neutral:  { mouth: 'line',  arms: ['down', 'down'] },
    talk:     { mouth: 'talk',  arms: ['down', 'out'] },
    happy:    { eyes: 'happy',  mouth: 'smile',  brows: 'up',     arms: ['down', 'out'],   tilt: -2 },
    laugh:    { eyes: 'closed', mouth: 'laugh',  brows: 'up',     arms: ['hips', 'up'],    tilt: -6, hop: 4 },
    sad:      { eyes: 'sad',    mouth: 'frown',  brows: 'sad',    arms: ['down', 'down'],  tilt: 6,  droop: 5 },
    angry:    { eyes: 'angry',  mouth: 'gnash',  brows: 'angry',  arms: ['hips', 'hips'] },
    shout:    { eyes: 'angry',  mouth: 'shout',  brows: 'angry',  arms: ['out', 'up'],     tilt: -3, grow: 1.06 },
    shocked:  { eyes: 'wide',   mouth: 'o',      brows: 'up',     arms: ['up', 'up'] },
    scared:   { eyes: 'wide',   mouth: 'wavy',   brows: 'sad',    arms: ['up', 'up'],      tilt: 4 },
    bored:    { eyes: 'bored',  mouth: 'flat',   brows: 'flat',   arms: ['cross', 'cross'], tilt: 3, droop: 3 },
    coy:      { eyes: 'closed', mouth: 'smirk',  brows: 'curved', arms: ['down', 'hips'],  tilt: -8 },
    sassy:    { eyes: 'sharp',  mouth: 'smirk',  brows: 'angled', arms: ['hips', 'out'],   tilt: -4 },
    wave:     { eyes: 'happy',  mouth: 'smile',  brows: 'up',     arms: ['down', 'wave'],  tilt: -3 },
    point:    { mouth: 'talk',  brows: 'up',     arms: ['down', 'point'] },
    think:    { eyes: 'look',   mouth: 'flat',   brows: 'flat',   arms: ['hold', 'chin'],  tilt: -4 },
    question: { mouth: 'talk',  brows: 'up',     arms: ['shrug', 'shrug'], tilt: 3 },
    love:     { eyes: 'hearts', mouth: 'smile',  brows: 'up',     arms: ['down', 'out'],   tilt: -3 },
    cool:     { mouth: 'smirk', brows: 'flat',   arms: ['down', 'point'], shades: true }
  };
  var EMOTIONS = Object.keys(EMO);

  /* Arm poses, given in LEFT-arm coordinates: [shoulder, elbow, hand].
     The right arm is the same list mirrored across x = 60. */
  var ARM = {
    down:  [[34, 96], [28, 122], [30, 148]],
    out:   [[34, 96], [16, 114], [4, 134]],
    up:    [[34, 96], [18, 108], [12, 70]],
    wave:  [[34, 96], [16, 106], [10, 62]],
    point: [[34, 96], [18, 112], [-2, 100]],
    hips:  [[34, 96], [12, 118], [38, 126]],
    cross: [[34, 96], [20, 126], [74, 114]],
    chin:  [[34, 96], [22, 120], [52, 74]],
    shrug: [[34, 96], [14, 108], [7, 121]],
    hold:  [[34, 96], [24, 120], [46, 132]]
  };

  /* ------------------------------------------------------------- primitives */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pick(list, i) { return list[((i % list.length) + list.length) % list.length]; }
  function idx(list, v) { var i = list.indexOf(v); return i < 0 ? 0 : i; }

  function line(pts, stroke, w, cap) {
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join(' ');
    return '<path d="' + d + '" fill="none" stroke="' + (stroke || INK) + '" stroke-width="' + (w || 3) +
           '" stroke-linecap="' + (cap || 'round') + '" stroke-linejoin="round"/>';
  }
  function path(d, fill, w) {
    return '<path d="' + d + '" fill="' + (fill || 'none') + '" stroke="' + INK +
           '" stroke-width="' + (w == null ? 2.4 : w) + '" stroke-linejoin="round" stroke-linecap="round"/>';
  }
  function circ(x, y, r, fill, w) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (fill || 'none') +
           '" stroke="' + INK + '" stroke-width="' + (w == null ? 2.4 : w) + '"/>';
  }
  function dot(x, y, r, fill) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (fill || INK) + '"/>';
  }
  function mirror(pts) { return pts.map(function (p) { return [120 - p[0], p[1]]; }); }

  /* ------------------------------------------------------------------ heads */

  function headPath(shape) {
    switch (shape) {
      case 'oval':   return 'M60,13 C78,13 87,27 87,46 C87,67 76,80 60,80 C44,80 33,67 33,46 C33,27 42,13 60,13 Z';
      case 'square': return 'M34,22 Q34,13 44,13 L76,13 Q86,13 86,22 L86,68 Q86,79 76,79 L44,79 Q34,79 34,68 Z';
      case 'tall':   return 'M37,26 Q37,9 60,9 Q83,9 83,26 L83,64 Q83,80 60,80 Q37,80 37,64 Z';
      case 'pear':   return 'M60,12 C74,12 82,24 82,38 C82,52 88,60 88,68 Q88,81 60,81 Q32,81 32,68 C32,60 38,52 38,38 C38,24 46,12 60,12 Z';
      default:       return 'M60,12 C78,12 90,26 90,46 C90,66 78,80 60,80 C42,80 30,66 30,46 C30,26 42,12 60,12 Z';
    }
  }
  /* rough half-width of the head at eye height, per shape */
  function headHalf(shape) {
    return { oval: 26, square: 26, tall: 23, pear: 22 }[shape] || 30;
  }

  /* ------------------------------------------------------------------- hair */

  function hairBack(style, c) {
    switch (style) {
      case 'long':     return path('M28,34 Q26,96 34,104 L40,60 Z', c) + path('M92,34 Q94,96 86,104 L80,60 Z', c);
      case 'bob':      return path('M28,38 Q28,74 36,80 L44,58 Z', c) + path('M92,38 Q92,74 84,80 L76,58 Z', c);
      case 'ponytail': return path('M88,32 Q106,44 100,74 Q96,86 88,84 Q98,60 82,42 Z', c);
      case 'bun':      return circ(60, 6, 12, c);
      case 'curly':    return circ(31, 30, 10, c) + circ(89, 30, 10, c) + circ(35, 48, 9, c) + circ(85, 48, 9, c);
      default:         return '';
    }
  }

  function hairFront(style, c) {
    switch (style) {
      case 'bald':  return '';
      case 'buzz':  return path('M32,42 Q34,15 60,14 Q86,15 88,42 Q76,28 60,28 Q44,28 32,42 Z', c);
      case 'short': return path('M31,44 Q31,12 60,11 Q89,12 89,44 Q84,26 60,26 Q46,26 40,36 Q34,40 31,44 Z', c);
      case 'spiky': return path('M30,44 L36,20 L42,36 L48,14 L56,34 L62,10 L70,33 L78,15 L84,36 L90,22 L90,44 Q76,26 60,26 Q44,26 30,44 Z', c);
      case 'mohawk':return path('M50,40 Q52,10 60,0 Q68,10 70,40 Q60,32 50,40 Z', c);
      case 'curly': return path('M30,42 Q30,14 60,12 Q90,14 90,42 Q86,24 76,30 Q68,18 60,28 Q50,18 44,30 Q34,24 30,42 Z', c);
      case 'long':  return path('M28,46 Q26,10 60,10 Q94,10 92,46 Q88,24 66,24 Q52,24 44,32 Q32,32 28,46 Z', c);
      case 'bob':   return path('M28,46 Q28,11 60,11 Q92,11 92,46 Q88,26 60,26 Q34,26 28,46 Z', c);
      case 'bun':   return path('M31,44 Q31,12 60,11 Q89,12 89,44 Q84,24 60,24 Q36,24 31,44 Z', c);
      case 'ponytail': return path('M31,44 Q31,12 60,11 Q89,12 89,44 Q84,24 60,24 Q40,24 31,44 Z', c);
      default:      return '';
    }
  }

  /* ------------------------------------------------------------------- eyes */

  function eye(x, y, style, side) {
    var s = side || 1; // 1 = character's left eye (viewer's left)
    switch (style) {
      case 'dot':    return dot(x, y, 3.4);
      case 'round':  return circ(x, y, 5.2, '#fff', 2) + dot(x + s * 0.8, y + 0.6, 2.4);
      case 'anime':  return '<ellipse cx="' + x + '" cy="' + y + '" rx="4.8" ry="6.4" fill="#fff" stroke="' + INK + '" stroke-width="2"/>' +
                            dot(x, y + 1, 3.1) + dot(x - 1.6, y - 1.8, 1.2, '#fff');
      case 'sharp':  return path('M' + (x - 5.5) + ',' + (y + 1) + ' Q' + x + ',' + (y - 5) + ' ' + (x + 5.5) + ',' + (y + 1) + ' Q' + x + ',' + (y + 3) + ' ' + (x - 5.5) + ',' + (y + 1) + ' Z', '#fff', 2) + dot(x, y - 0.5, 2.2);
      case 'sleepy': return circ(x, y, 4.4, '#fff', 2) + dot(x, y + 1.4, 2.2) + line([[x - 5, y - 2], [x + 5, y - 3]], INK, 2.2);
      case 'happy':  return line([[x - 5.5, y + 2.5], [x - 2, y - 3.5], [x + 2, y - 3.5], [x + 5.5, y + 2.5]], INK, 2.6);
      case 'closed': return path('M' + (x - 5.5) + ',' + (y - 1) + ' Q' + x + ',' + (y + 4) + ' ' + (x + 5.5) + ',' + (y - 1), null, 2.6);
      case 'angry':  return circ(x, y + 1, 4, '#fff', 2) + dot(x, y + 1.5, 2.3) +
                            line([[x - s * 6, y - 5], [x + s * 5, y - 1]], INK, 3);
      case 'sad':    return circ(x, y + 1, 4, '#fff', 2) + dot(x, y + 2, 2.2) +
                            line([[x - s * 6, y - 2], [x + s * 5, y - 5]], INK, 2.6);
      case 'wide':   return circ(x, y, 6.4, '#fff', 2.2) + dot(x, y, 2.2);
      case 'bored':  return circ(x, y, 4.4, '#fff', 2) + dot(x, y + 2, 2.2) + line([[x - 5, y - 1.5], [x + 5, y - 1.5]], INK, 2.6);
      case 'look':   return circ(x, y, 4.6, '#fff', 2) + dot(x - 1.4, y - 1.8, 2.2);
      case 'hearts': return path('M' + x + ',' + (y + 5) + ' C' + (x - 8) + ',' + (y - 1) + ' ' + (x - 5) + ',' + (y - 7) + ' ' + x + ',' + (y - 2) +
                                 ' C' + (x + 5) + ',' + (y - 7) + ' ' + (x + 8) + ',' + (y - 1) + ' ' + x + ',' + (y + 5) + ' Z', '#e8365d', 1.6);
      case 'x':      return line([[x - 4.5, y - 4.5], [x + 4.5, y + 4.5]], INK, 2.6) + line([[x + 4.5, y - 4.5], [x - 4.5, y + 4.5]], INK, 2.6);
      default:       return dot(x, y, 3.4);
    }
  }

  function shades(hw) {
    var l = 60 - hw * 0.66, r = 60 + hw * 0.66;
    return '<path d="M' + (l - 8) + ',38 h' + (hw * 1.32 + 16) + ' v6 q0,10 -10,10 h-6 q-8,0 -9,-9 h-6 q-1,9 -9,9 h-6 q-10,0 -10,-10 Z" fill="#1b1b1b" stroke="' + INK + '" stroke-width="2"/>' +
           '<path d="M' + (l - 4) + ',42 l6,8" stroke="#fff" stroke-width="1.6" opacity=".55"/>';
  }

  /* ------------------------------------------------------------------ brows */

  function brow(x, y, style, side) {
    var s = side || 1;
    switch (style) {
      case 'none':   return '';
      case 'up':     return path('M' + (x - 5) + ',' + (y - 2) + ' Q' + x + ',' + (y - 8) + ' ' + (x + 5) + ',' + (y - 2), null, 2.4);
      case 'angry':  return line([[x - s * 6, y - 5], [x + s * 5.5, y + 1]], INK, 3);
      case 'sad':    return line([[x - s * 6, y + 1], [x + s * 5.5, y - 5]], INK, 2.6);
      case 'angled': return line([[x - s * 6, y - 4], [x + s * 5.5, y]], INK, 2.6);
      case 'curved': return path('M' + (x - 5) + ',' + y + ' Q' + x + ',' + (y - 5) + ' ' + (x + 5) + ',' + y, null, 2.2);
      case 'thick':  return line([[x - 6, y - 1], [x + 6, y - 1]], INK, 4.4);
      case 'flat':   return line([[x - 5.5, y - 1], [x + 5.5, y - 1]], INK, 2.4);
      default:       return line([[x - 5.5, y - 1], [x + 5.5, y - 1]], INK, 2.4);
    }
  }

  /* ------------------------------------------------------------------- nose */

  function nose(style, skin) {
    switch (style) {
      case 'none':   return '';
      case 'button': return circ(60, 55, 3.4, skin, 2);
      case 'pointy': return path('M60,46 L64,57 L56,57', null, 2.2);
      case 'wide':   return path('M54,52 Q60,60 66,52', null, 2.4);
      case 'hook':   return path('M59,45 Q66,52 63,58 Q60,60 56,57', null, 2.2);
      default:       return '';
    }
  }

  /* ------------------------------------------------------------ facial hair */

  function facial(style, c) {
    switch (style) {
      case 'stubble':   return '<path d="M40,58 Q60,84 80,58 Q78,76 60,78 Q42,76 40,58 Z" fill="' + c + '" opacity=".28"/>';
      case 'moustache': return path('M48,60 Q54,55 60,60 Q66,55 72,60 Q66,66 60,62 Q54,66 48,60 Z', c, 1.8);
      case 'goatee':    return path('M52,68 Q60,64 68,68 Q66,84 60,86 Q54,84 52,68 Z', c, 2) +
                                path('M48,60 Q54,56 60,60 Q66,56 72,60 Q66,65 60,62 Q54,65 48,60 Z', c, 1.8);
      case 'beard':     return path('M38,52 Q40,86 60,90 Q80,86 82,52 Q78,74 60,74 Q42,74 38,52 Z', c, 2.2);
      default:          return '';
    }
  }

  /* -------------------------------------------------------------- accessory */

  function accessory(style, spec, hw) {
    var a = spec.palette.accent;
    switch (style) {
      case 'headphones': return path('M28,44 Q28,8 60,8 Q92,8 92,44', null, 4) +
                                '<rect x="20" y="36" width="16" height="24" rx="7" fill="' + a + '" stroke="' + INK + '" stroke-width="2.4"/>' +
                                '<rect x="84" y="36" width="16" height="24" rx="7" fill="' + a + '" stroke="' + INK + '" stroke-width="2.4"/>';
      case 'cap':        return path('M30,32 Q30,8 60,8 Q90,8 90,32 Z', a, 2.4) + path('M30,32 Q10,33 6,40 Q34,42 90,32 Z', a, 2.4);
      case 'glasses':    return circ(60 - hw * 0.62, 44, 8, 'none', 2.4) + circ(60 + hw * 0.62, 44, 8, 'none', 2.4) +
                                line([[60 - hw * 0.62 + 8, 44], [60 + hw * 0.62 - 8, 44]], INK, 2);
      case 'earrings':   return dot(60 - hw - 1, 54, 3.2, a) + dot(60 + hw + 1, 54, 3.2, a);
      case 'crown':      return path('M36,22 L36,4 L48,14 L60,0 L72,14 L84,4 L84,22 Z', '#f1c40f', 2.4);
      case 'halo':       return '<ellipse cx="60" cy="4" rx="18" ry="5" fill="none" stroke="#f1c40f" stroke-width="3.2"/>';
      case 'bandana':    return path('M31,32 Q60,20 89,32 L89,42 Q60,34 31,42 Z', a, 2.4) + path('M89,36 L102,30 L100,44 Z', a, 2.2);
      default:           return '';
    }
  }

  /* ------------------------------------------------------------------ mouth */

  function mouth(style) {
    switch (style) {
      case 'line':  return line([[51, 66], [69, 66]], INK, 2.6);
      case 'flat':  return line([[52, 68], [68, 68]], INK, 2.4);
      case 'talk':  return path('M52,64 Q60,60 68,64 Q64,74 60,74 Q56,74 52,64 Z', '#40222a', 2.2);
      case 'smile': return path('M48,62 Q60,75 72,62', null, 2.8);
      case 'grin':  return path('M47,62 Q60,77 73,62 Z', '#fff', 2.4) + line([[47, 62], [73, 62]], INK, 2.2);
      case 'laugh': return path('M46,61 Q60,58 74,61 Q69,84 60,84 Q51,84 46,61 Z', '#40222a', 2.4) +
                           path('M48.5,63 Q60,60.5 71.5,63 Q60,68 48.5,63 Z', '#fff', 1.4);
      case 'frown': return path('M49,73 Q60,60 71,73', null, 2.8);
      case 'gnash': return path('M48,62 L72,62 L72,72 L48,72 Z', '#fff', 2.2) +
                           line([[48, 67], [54, 62], [60, 67], [66, 62], [72, 67]], INK, 1.8) +
                           line([[48, 67], [54, 72], [60, 67], [66, 72], [72, 67]], INK, 1.8);
      case 'shout': return '<ellipse cx="60" cy="70" rx="11" ry="13" fill="#40222a" stroke="' + INK + '" stroke-width="2.4"/>' +
                           path('M50,64 Q60,60 70,64 Q60,68 50,64 Z', '#fff', 1.2);
      case 'o':     return circ(60, 68, 6.5, '#40222a', 2.4);
      case 'wavy':  return path('M48,68 q6,-6 12,0 q6,6 12,0', null, 2.6);
      case 'smirk': return path('M50,69 Q60,71 72,60', null, 2.8);
      default:      return line([[51, 66], [69, 66]], INK, 2.6);
    }
  }

  /* ------------------------------------------------------------------ bodies */

  function body(spec, e) {
    var p = spec.palette, s = spec.parts.body, out = '';
    var droop = e.droop || 0;

    if (s === 'hoodie') out += path('M40,84 Q60,104 80,84 Q86,74 60,74 Q34,74 40,84 Z', p.top, 2.4); // hood behind
    // neck
    out += path('M52,72 L52,88 L68,88 L68,72 Z', p.skin, 2.4);

    switch (s) {
      case 'tank':
        out += path('M40,96 Q60,90 80,96 L84,152 Q60,158 36,152 Z', p.top, 2.6);
        out += line([[50, 92], [46, 108]], INK, 2.2) + line([[70, 92], [74, 108]], INK, 2.2);
        break;
      case 'suit':
        out += path('M36,98 Q60,86 84,98 L88,154 Q60,160 32,154 Z', p.top, 2.6);
        out += path('M60,88 L48,100 L54,128 L60,96 L66,128 L72,100 Z', '#fff', 2);
        out += path('M60,96 L56,102 L60,124 L64,102 Z', p.accent, 1.6);
        break;
      case 'robe':
        out += path('M38,96 Q60,88 82,96 L94,196 Q60,204 26,196 Z', p.top, 2.6);
        out += line([[60, 92], [60, 190]], INK, 2);
        break;
      case 'dress':
        out += path('M42,96 Q60,88 78,96 L74,132 L92,190 Q60,198 28,190 L46,132 Z', p.top, 2.6);
        break;
      case 'jacket':
        out += path('M36,98 Q60,88 84,98 L86,154 Q60,160 34,154 Z', p.top, 2.6);
        out += path('M52,90 L52,152 M68,90 L68,152', p.accent, 2.2);
        out += path('M60,90 L60,152', 'none', 2);
        break;
      case 'hoodie':
        out += path('M36,98 Q60,88 84,98 L86,156 Q60,162 34,156 Z', p.top, 2.6);
        out += path('M44,124 Q60,132 76,124 L74,144 Q60,150 46,144 Z', 'none', 2.2);
        out += line([[54, 92], [56, 112]], INK, 2) + line([[66, 92], [64, 112]], INK, 2);
        break;
      default: // tee
        out += path('M36,98 Q60,88 84,98 L86,154 Q60,160 34,154 Z', p.top, 2.6);
        out += path('M50,90 Q60,98 70,90', null, 2.2);
    }

    // legs
    if (s !== 'robe' && s !== 'dress') {
      var lg = spec.parts.legs || 'pants';
      var hem = lg === 'shorts' ? 168 : 190;
      if (lg === 'skirt') {
        out += path('M38,150 Q60,144 82,150 L90,178 Q60,186 30,178 Z', p.bottom, 2.6);
        out += path('M44,178 L44,190 M76,178 L76,190', p.skin, 2.4);
        out += path('M40,190 Q40,198 52,198 L52,190 Z', p.accent, 2.2) + path('M80,190 Q80,198 68,198 L68,190 Z', p.accent, 2.2);
      } else {
        out += path('M38,150 L42,' + hem + ' L54,' + hem + ' L57,150 Z', p.bottom, 2.6);
        out += path('M82,150 L78,' + hem + ' L66,' + hem + ' L63,150 Z', p.bottom, 2.6);
        if (lg === 'shorts') {
          out += path('M44,168 L46,190 M74,168 L72,190', p.skin, 2.4);
          out += line([[44, 168], [46, 190]], p.skin, 8) + line([[76, 168], [74, 190]], p.skin, 8);
        }
        out += path('M40,190 Q38,199 52,199 L54,190 Z', p.accent, 2.2);
        out += path('M80,190 Q82,199 68,199 L66,190 Z', p.accent, 2.2);
      }
    } else {
      out += path('M42,194 Q40,200 52,200 L54,194 Z', p.accent, 2.2);
      out += path('M78,194 Q80,200 68,200 L66,194 Z', p.accent, 2.2);
    }
    return '<g transform="translate(0,' + droop + ')">' + out + '</g>';
  }

  function arms(spec, e) {
    var p = spec.palette;
    var sleeve = spec.parts.body === 'tank' ? p.skin : p.top;
    var poseL = ARM[e.arms[0]] || ARM.down;
    var poseR = mirror(ARM[e.arms[1]] || ARM.down);
    function one(pts) {
      var hand = pts[2];
      return line(pts, INK, 8.5) + line(pts, sleeve, 5) +
             circ(hand[0], hand[1], 5, p.skin, 2.2);
    }
    return '<g transform="translate(0,' + (e.droop || 0) + ')">' + one(poseL) + one(poseR) + '</g>';
  }

  /* ------------------------------------------------------------------ head */

  function headGroup(spec, e) {
    var p = spec.parts, pal = spec.palette;
    var hw = headHalf(p.head);
    var ex = hw * 0.62;
    var eL = 60 - ex, eR = 60 + ex;
    var useShades = (p.eyes === 'shades') || e.shades;
    var eStyle = e.eyes || (useShades ? 'round' : p.eyes);
    if (eStyle === 'shades') eStyle = 'round';

    var out = '';
    out += hairBack(p.hair, pal.hair);
    out += path(headPath(p.head), pal.skin, 2.6);
    out += hairFront(p.hair, pal.hair);
    out += facial(p.facialHair, pal.hair);

    out += brow(eL, 32, e.brows || p.brows, 1);
    out += brow(eR, 32, e.brows || p.brows, -1);
    out += eye(eL, 44, eStyle, 1);
    out += eye(eR, 44, eStyle, -1);
    if (useShades) out += shades(hw);
    out += nose(p.nose, pal.skin);
    out += mouth(e.mouth || 'line');
    out += accessory(p.accessory, spec, hw);

    var tilt = e.tilt || 0;
    var hop = e.hop || 0;
    return '<g transform="rotate(' + tilt + ' 60 78) translate(0,' + ((e.droop || 0) - hop) + ')">' + out + '</g>';
  }

  /* ------------------------------------------------------------------ draw */

  function draw(spec, emotion, opts) {
    spec = normalize(spec);
    opts = opts || {};
    var e = EMO[emotion] || EMO.neutral;
    e = Object.assign({ arms: ['down', 'down'] }, e);

    var inner = body(spec, e) + arms(spec, e) + headGroup(spec, e);
    var g = '';
    var grow = e.grow || 1;
    var sc = (spec.scale || 1) * grow;
    var t = [];
    if (opts.flip) t.push('translate(120,0) scale(-1,1)');
    if (sc !== 1) t.push('translate(60,200) scale(' + sc + ') translate(-60,-200)');
    g = '<g' + (t.length ? ' transform="' + t.join(' ') + '"' : '') + '>' + inner + '</g>';
    return g;
  }

  function card(spec, emotion, size) {
    size = size || 200;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H +
           '" width="' + (size * W / H) + '" height="' + size + '">' + draw(spec, emotion) + '</svg>';
  }

  /* -------------------------------------------------------------- normalize */

  var HEXRE = /^#[0-9a-f]{6}$/i;
  function color(v, fb) { return HEXRE.test(v || '') ? v.toLowerCase() : fb; }

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
    Object.keys(OPT).forEach(function (k) {
      out.parts[k] = OPT[k].indexOf(p[k]) >= 0 ? p[k] : OPT[k][0];
    });
    return out;
  }

  /* ------------------------------------------------------- deterministic gen */

  function hash32(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  /* Comic Chat auto-assigned a character to anyone chatting from a plain text
     client. Same idea: stable, name-derived, no storage needed. */
  function fromSeed(name, chatColor) {
    var n = String(name || 'anon').toLowerCase();
    var r = rng(hash32(n) || 1);
    function p(list) { return list[Math.floor(r() * list.length)]; }
    var spec = {
      id: n.replace(/[^a-z0-9_]/g, ''),
      name: name,
      scale: 0.9 + r() * 0.22,
      parts: {
        head: p(OPT.head), hair: p(OPT.hair), eyes: p(OPT.eyes), brows: p(OPT.brows),
        nose: p(OPT.nose),
        facialHair: r() < 0.68 ? 'none' : p(OPT.facialHair),
        body: p(OPT.body), legs: p(OPT.legs),
        accessory: r() < 0.6 ? 'none' : p(OPT.accessory)
      },
      palette: {
        skin: p(PAL.skin), hair: p(PAL.hair),
        top: color(chatColor, p(PAL.cloth)),   // borrow their Twitch name colour
        bottom: p(PAL.cloth), accent: p(PAL.cloth)
      }
    };
    return normalize(spec);
  }

  /* ------------------------------------------------------------ share codes */
  /* Compact so a viewer can paste one into a channel-point redeem message. */

  var FIELDS = ['head', 'hair', 'eyes', 'brows', 'nose', 'facialHair', 'body', 'legs', 'accessory'];

  function b64u(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function ub64u(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
  }

  function encode(spec) {
    spec = normalize(spec);
    var parts = FIELDS.map(function (f) { return idx(OPT[f], spec.parts[f]).toString(36); }).join('');
    var cols = ['skin', 'hair', 'top', 'bottom', 'accent'].map(function (k) { return spec.palette[k].slice(1); }).join('');
    var sc = Math.round(spec.scale * 100).toString(36);
    return 'CC1-' + b64u([parts, cols, sc, spec.name].join('~'));
  }

  function decode(code) {
    try {
      code = String(code || '').trim();
      var m = code.match(/CC1-([A-Za-z0-9\-_]+)/);
      if (!m) return null;
      var bits = ub64u(m[1]).split('~');
      if (bits.length < 4) return null;
      var parts = {}, ps = bits[0];
      FIELDS.forEach(function (f, i) { parts[f] = pick(OPT[f], parseInt(ps[i], 36) || 0); });
      var c = bits[1], pal = {};
      ['skin', 'hair', 'top', 'bottom', 'accent'].forEach(function (k, i) { pal[k] = '#' + c.substr(i * 6, 6); });
      return normalize({
        name: bits.slice(3).join('~'),
        scale: (parseInt(bits[2], 36) || 100) / 100,
        parts: parts, palette: pal
      });
    } catch (err) { return null; }
  }

  root.ComicAvatar = {
    W: W, H: H, OPT: OPT, PAL: PAL, EMOTIONS: EMOTIONS, EMO: EMO,
    normalize: normalize, fromSeed: fromSeed, draw: draw, card: card,
    encode: encode, decode: decode, esc: esc, hash32: hash32
  };
})(typeof window !== 'undefined' ? window : this);
