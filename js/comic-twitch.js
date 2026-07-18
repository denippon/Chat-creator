/* ============================================================================
   ComicTwitch — anonymous Twitch IRC + the gesture expert system.

   Comic Chat picked a character's expression from punctuation, capitalisation
   and a keyword dictionary, and picked the balloon shape from the sentence.
   Same rules here, retrained on how Twitch chat actually talks.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------- expert system */

  var EMOTE_MOOD = {
    // Twitch globals + the FrankerZ-tier classics
    lul: 'laugh', kekw: 'laugh', omegalul: 'laugh', kek: 'laugh', icant: 'laugh',
    pogchamp: 'shocked', poggers: 'shocked', pogu: 'shocked', pog: 'shocked', widepeepohappy: 'happy',
    ez: 'cool', pepega: 'laugh', monkas: 'scared', sadge: 'sad', pepehands: 'sad',
    biblethump: 'sad', notlikethis: 'sad', feelsbadman: 'sad', copium: 'sad',
    feelsgoodman: 'happy', pepelaugh: 'laugh', '4head': 'laugh', kappa: 'coy',
    kappapride: 'coy', residentsleeper: 'bored', bruh: 'bored', catjam: 'happy',
    pepeD: 'happy', vibe: 'happy', hypers: 'shout', pogslide: 'shocked',
    dansgame: 'angry', wutface: 'shocked', kreygasm: 'love',
    heyguys: 'wave', vohiyo: 'wave', peepohey: 'wave',
    thinking: 'think', gigachad: 'cool', pepesad: 'sad',
    prayge: 'love', peepolove: 'love'
  };

  var WORD_MOOD = [
    [/^(hi|hii+|hey+|hallo|moin|servus|yo|sup|hei|こんにちは|よろしく|おは\w*|heyguys|hewwo|guten\s?(tag|abend|morgen))\b/i, 'wave'],
    [/\b(bye|tschü+ss|cya|gn8|gute\s?nacht|またね|おつ\w*|o7)\b/i, 'wave'],
    [/\b(lol|lmao|rofl|haha+|hehe+|xd+|kek|草|www+|jaja)\b/i, 'laugh'],
    [/\b(wow|omg|what|wtf|whoa|krass|nani|えっ|holy|no way|wait what)\b/i, 'shocked'],
    [/\b(sad|rip|f\b|oof|schade|traurig|sorry|sry|damn|nooo+)\b/i, 'sad'],
    [/\b(love|<3|❤|danke|thanks|thx|ty\b|dankeschön|nice|awesome|geil|gg|pog)\b/i, 'love'],
    [/\b(angry|mad|rage|hate|nervt|scheiße|stop|nein+)\b/i, 'angry'],
    [/\b(hmm+|think|maybe|vielleicht|denke|guess|idk|maybe|dunno)\b/i, 'think'],
    [/\b(look|schau|there|dort|that one|this one|behind you|da\b)\b/i, 'point'],
    [/\b(scared|afraid|angst|help|hilfe|creepy|gruselig)\b/i, 'scared'],
    [/\b(boring|bored|langweilig|meh|zzz|anyway)\b/i, 'bored'],
    [/\b(cool|based|chad|obviously|ez|easy|klar)\b/i, 'cool'],
    [/\b(nice try|sure|totally|ironie|clearly|riiight)\b/i, 'sassy']
  ];

  var FACES = [
    [/(:\)|:-\)|=\)|\(:|:3|\^\^|:D|:-D|xD|=D)/i, 'happy'],
    [/(:\(|:-\(|=\(|:'\(|;_;|T_T|:c)/i, 'sad'],
    [/(;\)|;-\)|;3)/, 'coy'],
    [/(:P|:-P|:p|xP|:b)/, 'coy'],
    [/(:O|:-O|:o|O_O|o_O|😮)/, 'shocked'],
    [/(>:\(|>_<|-_-|:\/|:\\)/, 'angry'],
    [/(<3|♥|❤|😍)/, 'love'],
    [/(8\)|B\)|😎)/, 'cool']
  ];

  /* Decide expression + balloon shape for one message. */
  function classify(text, emoteNames) {
    var t = text.trim();
    var letters = t.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
    var caps = letters.length >= 4 && letters === letters.toUpperCase();
    var bangs = (t.match(/!/g) || []).length;
    var kind = 'speech', emotion = null;

    // balloon shape first
    if (/^\(\(.*\)\)$/.test(t) || /^\/w\b/i.test(t) || /^\*.*\*$/.test(t)) kind = 'whisper';
    else if (/^\(.*\)$/.test(t) || /^(hmm+|thinking|i wonder)/i.test(t)) kind = 'thought';
    else if (caps || bangs >= 2) kind = 'shout';

    // emotes win — they're the clearest intent signal in Twitch chat
    for (var i = 0; i < (emoteNames || []).length; i++) {
      var m = EMOTE_MOOD[String(emoteNames[i]).toLowerCase()];
      if (m) { emotion = m; break; }
    }
    if (!emotion) {
      for (var f = 0; f < FACES.length; f++) if (FACES[f][0].test(t)) { emotion = FACES[f][1]; break; }
    }
    if (!emotion) {
      for (var w = 0; w < WORD_MOOD.length; w++) if (WORD_MOOD[w][0].test(t)) { emotion = WORD_MOOD[w][1]; break; }
    }
    if (!emotion && kind === 'shout') emotion = bangs >= 2 && /\?/.test(t) ? 'shocked' : 'shout';
    if (!emotion && /\?\s*$/.test(t)) emotion = 'question';
    if (!emotion && kind === 'thought') emotion = 'think';
    if (!emotion) emotion = t.length > 60 ? 'talk' : (Math.random() < 0.25 ? 'talk' : 'neutral');

    if (kind === 'shout' && emotion === 'neutral') emotion = 'shout';
    return { emotion: emotion, kind: kind };
  }

  /* ---------------------------------------------------------- tokenizing */

  function emoteURL(id) {
    return 'https://static-cdn.jtvnw.net/emoticons/v2/' + id + '/default/dark/2.0';
  }

  /* Twitch emote ranges are code-point indexed, so walk code points. */
  function tokenize(text, emotesTag) {
    var chars = Array.from(text);
    var marks = {};
    var names = [];
    if (emotesTag) {
      emotesTag.split('/').forEach(function (grp) {
        var bits = grp.split(':');
        if (bits.length < 2) return;
        var id = bits[0];
        bits[1].split(',').forEach(function (r) {
          var se = r.split('-'), a = +se[0], b = +se[1];
          if (isNaN(a) || isNaN(b)) return;
          marks[a] = { end: b, id: id };
          names.push(chars.slice(a, b + 1).join(''));
        });
      });
    }

    var tokens = [], buf = '';
    function flushWords() {
      buf.split(/\s+/).forEach(function (w) { if (w) tokens.push({ t: 'w', s: w }); });
      buf = '';
    }
    for (var i = 0; i < chars.length; i++) {
      if (marks[i]) {
        flushWords();
        tokens.push({ t: 'e', url: emoteURL(marks[i].id), s: chars.slice(i, marks[i].end + 1).join('') });
        i = marks[i].end;
      } else buf += chars[i];
    }
    flushWords();

    // pick up plain-text emote names too (7TV/BTTV users type them as words)
    tokens.forEach(function (t) { if (t.t === 'w') names.push(t.s); });
    return { tokens: tokens, emoteNames: names };
  }

  /* ------------------------------------------------------------- IRC line */

  function parseLine(line) {
    var out = { tags: {}, prefix: '', cmd: '', params: [] };
    var i = 0;
    if (line[0] === '@') {
      var sp = line.indexOf(' ');
      line.slice(1, sp).split(';').forEach(function (kv) {
        var e = kv.indexOf('=');
        var k = e < 0 ? kv : kv.slice(0, e);
        var v = e < 0 ? '' : kv.slice(e + 1);
        out.tags[k] = v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\').replace(/\\r|\\n/g, '');
      });
      line = line.slice(sp + 1);
    }
    if (line[0] === ':') {
      var sp2 = line.indexOf(' ');
      out.prefix = line.slice(1, sp2);
      line = line.slice(sp2 + 1);
    }
    var trail = line.indexOf(' :');
    var head = trail < 0 ? line : line.slice(0, trail);
    var parts = head.split(' ').filter(Boolean);
    out.cmd = (parts.shift() || '').toUpperCase();
    out.params = parts;
    if (trail >= 0) out.params.push(line.slice(trail + 2));
    return out;
  }

  /* ---------------------------------------------------------- connection */

  function Chat(opts) {
    this.channel = String(opts.channel || '').toLowerCase().replace(/^#/, '');
    this.onMessage = opts.onMessage || function () {};
    this.onClear = opts.onClear || function () {};
    this.onStatus = opts.onStatus || function () {};
    this.ws = null;
    this.tries = 0;
    this.dead = false;
  }

  Chat.prototype.connect = function () {
    var self = this;
    if (this.dead || !this.channel) return;
    this.onStatus('connecting');
    var ws = this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    ws.onopen = function () {
      self.tries = 0;
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 80000)));
      ws.send('JOIN #' + self.channel);
      self.onStatus('connected');
    };
    ws.onmessage = function (ev) {
      ev.data.split('\r\n').forEach(function (raw) {
        if (!raw) return;
        var m = parseLine(raw);
        if (m.cmd === 'PING') { ws.send('PONG :' + (m.params[0] || 'tmi.twitch.tv')); return; }
        if (m.cmd === 'PRIVMSG') self.handle(m);
        if (m.cmd === 'CLEARCHAT' && m.params[1]) self.onClear(m.params[1].toLowerCase());
        if (m.cmd === 'CLEARMSG' && m.tags.login) self.onClear(m.tags.login.toLowerCase());
        if (m.cmd === 'NOTICE') self.onStatus('notice: ' + m.params[1]);
      });
    };
    ws.onclose = function () {
      self.onStatus('disconnected');
      if (self.dead) return;
      var wait = Math.min(30000, 1000 * Math.pow(2, self.tries++));
      setTimeout(function () { self.connect(); }, wait);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  };

  Chat.prototype.handle = function (m) {
    var text = m.params[1] || '';
    var user = (m.tags['display-name'] || (m.prefix.split('!')[0] || '')).trim();
    var login = (m.prefix.split('!')[0] || '').toLowerCase();
    var action = false;
    var am = text.match(/^\u0001ACTION (.*)\u0001$/);
    if (am) { text = am[1]; action = true; }
    if (!text.trim()) return;

    var tk = tokenize(text, m.tags.emotes);
    var cls = classify(text, tk.emoteNames);
    if (action) cls.kind = 'thought';

    this.onMessage({
      user: user || login,
      login: login,
      color: m.tags.color || '',
      badges: m.tags.badges || '',
      text: text,
      tokens: tk.tokens,
      emotion: cls.emotion,
      kind: cls.kind,
      ts: Date.now()
    });
  };

  Chat.prototype.close = function () { this.dead = true; try { this.ws.close(); } catch (e) {} };

  root.ComicTwitch = {
    Chat: Chat, classify: classify, tokenize: tokenize, parseLine: parseLine, EMOTE_MOOD: EMOTE_MOOD
  };
})(window);
