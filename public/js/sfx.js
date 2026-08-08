/* sfx.js — WebAudio 8비트 효과음. 파일 없이 사각파/삼각파로만 만든다.
   기본 켬 · 볼륨 낮게 · 음소거 토글 제공. 브라우저 정책상 첫 사용자 조작 후에 소리가 난다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};

  var ctx = null, master = null, muted = false, ready = false;
  /* ★ GDD3 §14-2 — VOL 은 이제 '가장 크게 했을 때'의 세기이고, 실제 세기는 vol(0~1) 배수가 정한다.
     설정 패널의 소리 눈금이 이 값을 옮기고 localStorage 에 적어 둔다. 0 으로 내리면 음소거와 같다. */
  var VOL = 0.055;
  var DEFAULT_VOL = 0.7;
  var vol = DEFAULT_VOL;

  try { muted = localStorage.getItem('gm.muted') === '1'; } catch (e) {}
  try {
    var stored = parseFloat(localStorage.getItem('gm.volume'));
    if (isFinite(stored) && stored >= 0 && stored <= 1) vol = stored;
  } catch (e2) {}

  function level() { return muted ? 0 : VOL * vol; }

  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = level();
      master.connect(ctx.destination);
      ready = true;
    } catch (e) { ctx = null; }
    return ctx;
  }

  /* 단음 — {f: 시작 주파수, f2: 끝 주파수, d: 길이(초), type, v: 세기, delay} */
  function tone(o) {
    var c = ensure();
    if (!c || muted) return;
    try {
      if (c.state === 'suspended') c.resume();
      var t0 = c.currentTime + (o.delay || 0);
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f, t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.d);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.v === undefined ? 1 : o.v), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.d);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + o.d + 0.02);
    } catch (e) {}
  }

  /* 짧은 잡음 — 주사위·타격감 */
  function noise(dur, v) {
    var c = ensure();
    if (!c || muted) return;
    try {
      if (c.state === 'suspended') c.resume();
      var n = Math.floor(c.sampleRate * dur);
      var buf = c.createBuffer(1, Math.max(1, n), c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = c.createBufferSource(); src.buffer = buf;
      var g = c.createGain(); g.gain.value = v === undefined ? 0.5 : v;
      src.connect(g); g.connect(master);
      src.start();
    } catch (e) {}
  }

  var BANK = {
    click:   function () { tone({ f: 620, f2: 460, d: 0.05, v: 0.5 }); },
    tap:     function () { tone({ f: 880, f2: 760, d: 0.035, v: 0.32 }); },
    open:    function () { tone({ f: 400, f2: 720, d: 0.10, v: 0.42, type: 'triangle' }); },
    close:   function () { tone({ f: 620, f2: 340, d: 0.09, v: 0.34, type: 'triangle' }); },
    gain:    function () { tone({ f: 780, d: 0.06, v: 0.4 }); tone({ f: 1180, d: 0.09, v: 0.34, delay: 0.055 }); },
    coin:    function () { tone({ f: 1040, d: 0.05, v: 0.36 }); tone({ f: 1560, d: 0.10, v: 0.3, delay: 0.05 }); },
    warn:    function () { tone({ f: 330, d: 0.11, v: 0.5, type: 'sawtooth' }); tone({ f: 250, d: 0.16, v: 0.45, type: 'sawtooth', delay: 0.13 }); },
    bad:     function () { tone({ f: 220, f2: 110, d: 0.32, v: 0.5, type: 'sawtooth' }); },
    fanfare: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone({ f: f, d: 0.16, v: 0.36, delay: i * 0.095, type: 'square' });
      });
      tone({ f: 1568, d: 0.34, v: 0.3, delay: 0.4, type: 'triangle' });
    },
    unlock:  function () {
      [392, 523, 659].forEach(function (f, i) { tone({ f: f, d: 0.13, v: 0.34, delay: i * 0.08 }); });
    },
    dice:    function () { for (var i = 0; i < 5; i++) setTimeout(function () { noise(0.05, 0.34); }, i * 70); },
    build:   function () { noise(0.09, 0.4); tone({ f: 180, f2: 90, d: 0.14, v: 0.4, type: 'square' }); },
    page:    function () { noise(0.05, 0.22); },
    /* ── 월드 조작 ── */
    shot:    function () { tone({ f: 900, f2: 420, d: 0.06, v: 0.3, type: 'square' }); },
    hit:     function () { noise(0.05, 0.42); tone({ f: 200, f2: 120, d: 0.1, v: 0.4, type: 'sawtooth' }); },
    deny:    function () { tone({ f: 180, f2: 120, d: 0.13, v: 0.42, type: 'square' }); },

    /* ══ ★ 스윙 3겹 (GDD3 §8) ══
       ① 타격 — 도구가 대상에 닿는 소리 (대상마다 다르다)
       ② 획득 — 자원이 들어오는 소리 (스윙마다 짧게)
       ③ 완료 — 한 주기를 끝냈을 때 (나무가 넘어가는 소리) */
    chop:    function () { noise(0.075, 0.55); tone({ f: 250, f2: 130, d: 0.09, v: 0.44, type: 'square' }); },
    mine:    function () { noise(0.055, 0.5);  tone({ f: 520, f2: 240, d: 0.06, v: 0.36, type: 'square' });
                           tone({ f: 1200, d: 0.03, v: 0.2, delay: 0.02 }); },
    dig:     function () { noise(0.1, 0.34);   tone({ f: 170, f2: 110, d: 0.11, v: 0.3, type: 'triangle' }); },
    hammer:  function () { noise(0.05, 0.42);  tone({ f: 340, f2: 200, d: 0.08, v: 0.4, type: 'square' }); },
    pickup:  function () { tone({ f: 980, d: 0.035, v: 0.22 }); tone({ f: 1320, d: 0.05, v: 0.18, delay: 0.03 }); },
    timber:  function () {                                  /* 나무가 넘어간다 */
      noise(0.24, 0.34);
      tone({ f: 300, f2: 90, d: 0.34, v: 0.4, type: 'triangle' });
      tone({ f: 150, f2: 70, d: 0.22, v: 0.34, type: 'square', delay: 0.16 });
    },
    crumble: function () { noise(0.2, 0.4); tone({ f: 220, f2: 80, d: 0.26, v: 0.36, type: 'square' }); },
    harvest: function () {
      [784, 988, 1175].forEach(function (f, i) { tone({ f: f, d: 0.09, v: 0.3, delay: i * 0.05 }); });
    },
    levelup: function () {
      [523, 659, 880, 1047].forEach(function (f, i) { tone({ f: f, d: 0.12, v: 0.32, delay: i * 0.06, type: 'square' }); });
      tone({ f: 1319, d: 0.26, v: 0.26, delay: 0.26, type: 'triangle' });
    },
    /* ══ 성장 ══ */
    tierup:  function () {
      [392, 523, 659, 784, 1047].forEach(function (f, i) {
        tone({ f: f, d: 0.2, v: 0.36, delay: i * 0.11, type: 'square' });
      });
      tone({ f: 1568, d: 0.5, v: 0.3, delay: 0.6, type: 'triangle' });
      tone({ f: 784, d: 0.5, v: 0.24, delay: 0.6, type: 'triangle' });
    },
    stake:   function () { noise(0.06, 0.5); tone({ f: 200, f2: 120, d: 0.1, v: 0.4, type: 'square' }); },
    arrive:  function () {
      tone({ f: 587, d: 0.11, v: 0.3, type: 'triangle' });
      tone({ f: 784, d: 0.16, v: 0.28, delay: 0.1, type: 'triangle' });
    },
    wheel:   function () { noise(0.5, 0.13); tone({ f: 110, f2: 90, d: 0.5, v: 0.16, type: 'triangle' }); },
    /* ══ 전투 ══ */
    alarm:   function () {
      [660, 520, 660, 520].forEach(function (f, i) {
        tone({ f: f, d: 0.16, v: 0.42, delay: i * 0.18, type: 'sawtooth' });
      });
    },
    slash:   function () { noise(0.045, 0.4); tone({ f: 1400, f2: 500, d: 0.07, v: 0.3, type: 'sawtooth' }); },
    kill:    function () { noise(0.09, 0.46); tone({ f: 260, f2: 90, d: 0.16, v: 0.38, type: 'square' }); },
    fenceBreak: function () { noise(0.16, 0.5); tone({ f: 190, f2: 80, d: 0.2, v: 0.42, type: 'square' }); },
    hurt:    function () { tone({ f: 300, f2: 150, d: 0.14, v: 0.4, type: 'sawtooth' }); noise(0.06, 0.3); },

    /* ══ ★ §20-R2 유물 획득 3종 (유물기획 §20-7) ══
       「왜」 등급마다 다른 소리인가 — 같은 소리로는 「대박이다」가 오지 않는다. 셋 다 파일 없이
       위의 tone/noise 로만 짓는다(외부 오디오 에셋 없음). 급이 오를수록 화성이 두꺼워진다:
       ① 레어 = 3음 아르페지오(도-미-솔) ② 유니크 = 장3화음 스웰(동시에 울려 부풀린다)
       ③ 레전더리 = 5음 팡파레 + 저음 드론. */
    relicRare: function () {
      [523, 659, 784].forEach(function (f, i) {
        tone({ f: f, d: 0.17, v: 0.3, delay: i * 0.075, type: 'triangle' });
      });
      tone({ f: 1047, d: 0.3, v: 0.22, delay: 0.23, type: 'triangle' });
    },
    relicUnique: function () {
      /* 합창풍 스웰 — 세 음을 한꺼번에 길게 깔고, 옥타브 위를 늦게 얹어 부푸는 결을 만든다 */
      [392, 494, 587].forEach(function (f) { tone({ f: f, d: 0.85, v: 0.19, type: 'triangle' }); });
      [784, 988].forEach(function (f, i) { tone({ f: f, d: 0.7, v: 0.13, delay: 0.3 + i * 0.09, type: 'triangle' }); });
    },
    relicLegend: function () {
      [523, 659, 784, 1047, 1319].forEach(function (f, i) {
        tone({ f: f, d: 0.22, v: 0.34, delay: i * 0.11, type: 'square' });
      });
      tone({ f: 1568, d: 0.8, v: 0.26, delay: 0.62, type: 'triangle' });
      tone({ f: 131, d: 1.5, v: 0.2, delay: 0.02, type: 'triangle' });      /* 저음 드론 */
      tone({ f: 196, d: 1.3, v: 0.15, delay: 0.02, type: 'triangle' });
    }
  };

  function play(name) {
    if (muted || vol <= 0) return;
    var f = BANK[name];
    if (f) { ensure(); try { f(); } catch (e) {} }
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('gm.muted', muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = level();
    return muted;
  }
  function toggle() { setMuted(!muted); if (!muted) play('tap'); return muted; }
  function isMuted() { return muted || vol <= 0; }

  /* ★ GDD3 §14-2 — 설정 패널의 소리 눈금(0~1). 0 으로 내리면 음소거와 같다. */
  function getVolume() { return muted ? 0 : vol; }
  function defaultVolume() { return DEFAULT_VOL; }
  function setVolume(v) {
    var n = Math.max(0, Math.min(1, Number(v)));
    if (!isFinite(n)) n = DEFAULT_VOL;
    vol = n;
    try { localStorage.setItem('gm.volume', String(n)); } catch (e) {}
    if (n > 0 && muted) setMuted(false);
    if (master) master.gain.value = level();
    return n;
  }

  /* 클릭 가능한 곳은 전부 "만지는 맛"이 나야 한다 — 버튼 클릭에 기본 효과음 */
  function init() {
    document.addEventListener('pointerdown', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('button, .notice, .role-card, .seat, .minister') : null;
      if (!t || t.disabled) return;
      play(t.classList && t.classList.contains('btn-primary') ? 'click' : 'tap');
    }, true);
  }

  GM.sfx = { play: play, toggle: toggle, setMuted: setMuted, isMuted: isMuted, init: init,
             getVolume: getVolume, setVolume: setVolume, defaultVolume: defaultVolume,
             isReady: function () { return ready; } };
})(window);
