/* ui.js — 공용 위젯: 픽셀 프레임 · 게이지 · 토스트 · 2단 툴팁 · 숫자 juice · 모달 · 코치마크
   원칙: 기본 표시는 아이콘 + 게이지 + 상태 문구. 정확한 수치는 호버 툴팁 2단계에서만 나온다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};

  /* ── DOM ─────────────────────────────────────────────── */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + (cls || ''), label);
    b.type = 'button';
    if (onClick) b.onclick = onClick;
    return b;
  }
  function frag() { return document.createDocumentFragment(); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── 수치 포맷 ───────────────────────────────────────── */
  function fmt(n, digits) {
    if (n === undefined || n === null || isNaN(n)) return '—';
    var d = digits === undefined ? (Math.abs(n) >= 100 ? 0 : 1) : digits;
    var v = Number(n).toFixed(d);
    if (d > 0) v = v.replace(/\.?0+$/, '');
    var parts = v.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function fixed(n, d) {
    if (n === undefined || n === null || isNaN(n)) return '—';
    var parts = Number(n).toFixed(d === undefined ? 2 : d).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function pct(x, digits) {
    if (x === undefined || x === null || isNaN(x)) return '—';
    return fmt(x * 100, digits === undefined ? 0 : digits) + '%';
  }
  function signed(x, digits) {
    if (x === undefined || x === null || isNaN(x)) return '';
    return (x > 0 ? '+' : '') + fmt(x, digits);
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function josa(word, withB, withoutB) {
    /* 받침 유무로 조사 고르기 — "곡물이/석재가" 같은 어색함 방지 */
    var s = String(word || '');
    var c = s.charCodeAt(s.length - 1);
    if (c < 0xac00 || c > 0xd7a3) return withB;
    return ((c - 0xac00) % 28) ? withB : withoutB;
  }

  function hash(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rngFrom(seed) {
    var s = hash(seed) || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  /* ── 색 ──────────────────────────────────────────────── */
  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgb2hex(a) {
    return '#' + a.map(function (v) { var s = Math.round(clamp(v, 0, 255)).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
  }
  function mix(c1, c2, t) {
    var a = hex2rgb(c1), b = hex2rgb(c2);
    return rgb2hex([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
  }
  function shade(c, t) { return mix(c, t < 0 ? '#000000' : '#ffffff', Math.abs(t)); }
  function rgba(hex, a) {
    var c = hex2rgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  /* 0(위험) → 1(안전). 색맹 대비로 상태 문구를 반드시 병기한다. */
  function riskColor(v) {
    v = clamp(v, 0, 1);
    if (v < 0.5) return mix('#bc4749', '#d99b2b', v / 0.5);
    return mix('#d99b2b', '#6a994e', (v - 0.5) / 0.5);
  }

  /* ── 토스트 ──────────────────────────────────────────── */
  function toast(msg, kind, ms) {
    var root = qs('#toasts');
    if (!root) return;
    var t = el('div', 'toast ' + (kind || ''), msg);
    root.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, ms || 3600);
  }

  /* ── 툴팁 — ★ GDD3 §15-B-1 「즉시 툴팁」 ──────────────────
   *
   * 무엇이 문제였나: 옛 코드는 요약(data-tip)만 곧바로 띄우고 **설명(data-tip2)은 800ms 를
   * 기다리게** 했다. 그런데 배치대 카드는 이름을 요약에, "무엇을 하는 건물인가"를 설명에 담는다 —
   * 즉 정작 알고 싶은 한 줄이 지연 뒤에 있었고, 그동안 자리에는 「잠깐 두면 자세히 보입니다」라는
   * 안내만 떴다. 그것이 "설명이 늦게 뜬다"의 정체다.
   *
   * 새 규칙: **요약과 설명은 호버하는 순간 함께** 뜬다. 지연은 `data-tip3`(보조 상세)에만 남는다 —
   * 「이 값이 어떻게 계산되나」처럼 없어도 되는 곁가지다. 아무도 지연을 겪지 않고,
   * 곁가지를 알고 싶은 사람만 잠깐 더 머문다.
   */
  var TIP_DEEP_MS = 550;
  var tipEl = null, tipTimer = null, tipHold = null, tipTarget = null;
  function tipSet(node, summary, detail, aside) {
    if (!node) return node;
    if (summary) node.setAttribute('data-tip', summary); else node.removeAttribute('data-tip');
    if (detail) node.setAttribute('data-tip2', detail); else node.removeAttribute('data-tip2');
    if (aside) node.setAttribute('data-tip3', aside); else node.removeAttribute('data-tip3');
    return node;
  }
  function tipShow(node, x, y, withAside) {
    tipEl = tipEl || qs('#tooltip');
    if (!tipEl || !node) return;
    var summary = node.getAttribute('data-tip');
    if (!summary) return;
    clear(tipEl);
    tipEl.appendChild(el('span', null, summary));
    /* 설명은 지연 없이 함께 — 이것이 §15-B-1 의 전부다 */
    var d = node.getAttribute('data-tip2');
    if (d) tipEl.appendChild(el('span', 'tt-more', d));
    var a = node.getAttribute('data-tip3');
    if (a && withAside) tipEl.appendChild(el('span', 'tt-aside', a));
    tipEl.hidden = false;
    var r = tipEl.getBoundingClientRect();
    var left = clamp(x + 16, 6, Math.max(8, innerWidth - r.width - 6));
    var top = y - r.height - 14;
    if (top < 6) top = y + 22;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  function tipHide() { if (tipEl) tipEl.hidden = true; tipTarget = null; clearTimeout(tipHold); }

  var tipDeep = null, lastX = 0, lastY = 0;
  function initTooltips() {
    tipEl = qs('#tooltip');
    document.addEventListener('mousemove', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      lastX = e.clientX; lastY = e.clientY;
      if (!t) { tipDeep = null; tipHide(); return; }
      if (t !== tipTarget) {
        tipTarget = t;
        tipDeep = null;
        clearTimeout(tipHold);
        /* 보조 상세(data-tip3)만 잠깐 머물면 펼친다 — 요약·설명은 이미 떠 있다 */
        if (t.getAttribute('data-tip3')) {
          tipHold = setTimeout(function () {
            if (tipTarget !== t) return;
            tipDeep = t;
            tipShow(t, lastX, lastY, true);
          }, TIP_DEEP_MS);
        }
      }
      tipShow(t, e.clientX, e.clientY, tipDeep === t);
    });
    /* 터치·클릭 기기: 누르면 요약+자세히를 한 번에 */
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!t) return;
      tipShow(t, e.clientX, e.clientY, true);
      clearTimeout(tipTimer);
      tipTimer = setTimeout(tipHide, 4600);
    });
    document.addEventListener('scroll', tipHide, true);
    window.addEventListener('blur', tipHide);
  }

  /* ── 숫자 트윈 + 증감 플로팅 ─────────────────────────── */
  function tweenNum(node, to, opts) {
    opts = opts || {};
    var from = parseFloat(node.getAttribute('data-v'));
    if (isNaN(from)) from = to;
    node.setAttribute('data-v', to);
    var dur = opts.dur || 520;
    var f = opts.fmt || function (v) { return fmt(v, opts.digits); };
    if (from === to) { node.textContent = f(to); return; }

    var d = to - from, t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    function frame(t) {
      var p = clamp((t - t0) / dur, 0, 1);
      var e = 1 - Math.pow(1 - p, 3);
      node.textContent = f(from + d * e);
      if (p < 1) requestAnimationFrame(frame);
      else node.textContent = f(to);
    }
    requestAnimationFrame(frame);

    node.classList.remove('up', 'down');
    void node.offsetWidth;
    node.classList.add(d > 0 ? 'up' : 'down');
    if (opts.delta !== false && Math.abs(d) > 0.0001) floatDelta(node, d, opts.digits);
  }

  function floatDelta(node, d, digits) {
    var host = node.parentNode;
    if (!host) return;
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    var s = el('span', 'delta ' + (d > 0 ? 'up' : 'down'), signed(d, digits));
    s.style.right = '4px'; s.style.top = '0';
    host.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 1150);
  }

  /* 획득 반짝임 */
  function sparkle(host, color) {
    if (!host) return;
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    var s = el('span', 'sparkle', '✦');
    s.style.color = color || '#e8a33d';
    s.style.left = '50%'; s.style.top = '10%'; s.style.fontSize = '18px';
    host.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 760);
  }

  /* ── 게이지 ──────────────────────────────────────────── */
  function makeGauge(opts) {
    opts = opts || {};
    var box = el('div', 'gauge');
    var fill = el('div', 'gauge-fill');
    var ticks = el('div', 'gauge-ticks decor');
    var lab = el('div', 'gauge-label');
    box.appendChild(fill); box.appendChild(ticks); box.appendChild(lab);
    if (opts.height) box.style.height = opts.height + 'px';
    var last = null;
    box.setValue = function (v01, label, summary, detail) {
      v01 = clamp(v01, 0, 1);
      fill.style.width = (v01 * 100) + '%';
      fill.style.backgroundColor = opts.color || riskColor(v01);
      lab.textContent = label || '';
      tipSet(box, summary, detail);
      if (last !== null && Math.abs(last - v01) > 0.02) {
        box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
      }
      last = v01;
    };
    return box;
  }

  /* ── 패널 헬퍼 ───────────────────────────────────────── */
  function paper(titleText) {
    var p = el('div', 'panel-paper');
    if (titleText) p.appendChild(el('h3', 'sec-title', titleText));
    return p;
  }
  function section(titleText) {
    var w = el('div');
    if (titleText) w.appendChild(el('h3', 'sec-title', titleText));
    return w;
  }
  function row(cls) { return el('div', 'row-item ' + (cls || '')); }
  function pips(cur, max) {
    var w = el('span', 'pips');
    for (var i = 1; i <= max; i++) w.appendChild(el('i', 'pip' + (i <= cur ? ' on' : '')));
    return w;
  }

  /* ── 모달 ────────────────────────────────────────────── */
  var modalStack = [];
  function openModal(opts) {
    var root = qs('#modal-root');
    var back = el('div', 'modal-back');
    var box = el('div', 'modal');
    if (opts.width) box.style.maxWidth = opts.width;

    var head = el('div', 'modal-head');
    var title = el('div', 'modal-title');
    if (opts.icon) { var im = opts.icon; im.className = (im.className || '') + ' ic'; title.appendChild(im); }
    title.appendChild(el('span', null, opts.title || ''));
    head.appendChild(title);
    if (opts.closable !== false) {
      var x = el('button', 'x-btn', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', '닫기');
      x.onclick = function () { closeModal(back); };
      head.appendChild(x);
    }
    var body = el('div', 'modal-body');
    if (opts.body) body.appendChild(opts.body);

    box.appendChild(head); box.appendChild(body);
    if (opts.footer) { var f = el('div', 'modal-foot'); f.appendChild(opts.footer); box.appendChild(f); }
    back.appendChild(box);
    root.appendChild(back);
    if (opts.closable !== false) {
      back.addEventListener('click', function (e) { if (e.target === back) closeModal(back); });
    }
    back.__onClose = opts.onClose;
    back.__body = body;
    back.__key = opts.key || null;
    modalStack.push(back);
    if (GM.sfx) GM.sfx.play('open');
    return back;
  }
  function closeModal(back) {
    back = back || modalStack[modalStack.length - 1];
    if (!back || !back.parentNode) return;
    back.parentNode.removeChild(back);
    var i = modalStack.indexOf(back); if (i >= 0) modalStack.splice(i, 1);
    if (GM.sfx) GM.sfx.play('close');
    if (back.__onClose) try { back.__onClose(); } catch (e) {}
  }
  function closeTopModal() { closeModal(); }
  function modalOpen(key) {
    for (var i = 0; i < modalStack.length; i++) if (modalStack[i].__key === key) return modalStack[i];
    return null;
  }
  function anyModalOpen() { return modalStack.length > 0; }

  function confirmBox(title, msg, onYes, yesLabel) {
    var body = el('div');
    body.appendChild(el('p', null, msg));
    var foot = el('div');
    var no = btn('아니오', 'btn-ghost');
    var yes = btn(yesLabel || '그리하라', 'btn-primary');
    foot.appendChild(no); foot.appendChild(yes);
    var m = openModal({ title: title, body: body, footer: foot, width: '460px' });
    no.onclick = function () { closeModal(m); };
    yes.onclick = function () { closeModal(m); if (onYes) onYes(); };
    return m;
  }

  /* ── 캔버스 도트 헬퍼 ────────────────────────────────── */
  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function sprite(ctx, rows, pal, x, y, s) {
    for (var r = 0; r < rows.length; r++) {
      var line = rows[r];
      for (var c = 0; c < line.length; c++) {
        var ch = line[c];
        if (ch === '.' || ch === ' ') continue;
        var col = pal[ch];
        if (!col) continue;
        px(ctx, x + c * s, y + r * s, s, s, col);
      }
    }
  }
  function fitCanvas(cv, logicalW, logicalH) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.round(logicalW * dpr), h = Math.round(logicalH * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    return ctx;
  }

  /* ── 배너 ────────────────────────────────────────────
     화면 위쪽에 잠깐 떴다 사라지는 알림 카드. 레벨업·티어업·주민 도착처럼
     "지금 이걸 봐야 한다"는 순간에만 쓴다. 겹치면 줄을 선다. */
  var bannerQueue = [], bannerBusy = false;
  function banner(opts) {
    bannerQueue.push(opts || {});
    if (bannerQueue.length > 4) bannerQueue.splice(0, bannerQueue.length - 4);
    pumpBanner();
  }
  function pumpBanner() {
    if (bannerBusy) return;
    var root = qs('#banner-root');
    if (!root) { bannerQueue.length = 0; return; }
    var o = bannerQueue.shift();
    if (!o) return;
    bannerBusy = true;
    var card = el('div', 'banner banner-' + (o.kind || 'info'));
    if (o.icon && GM.icons) card.appendChild(GM.icons.img(o.icon, 30));
    var col = el('div', 'bn-col');
    col.appendChild(el('span', 'bn-t', o.title || ''));
    if (o.sub) col.appendChild(el('span', 'bn-s', o.sub));
    card.appendChild(col);
    root.appendChild(card);
    void card.offsetWidth;
    card.classList.add('in');
    var life = o.ms || 2600;
    setTimeout(function () {
      card.classList.remove('in');
      card.classList.add('out');
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        bannerBusy = false;
        pumpBanner();
      }, 420);
    }, life);
  }
  function bannerClear() {
    bannerQueue.length = 0;
    bannerBusy = false;
    clear(qs('#banner-root'));
  }

  /* ── 코치마크 ────────────────────────────────────────── */
  var coachQueue = [], coachIdx = 0;
  function coach(steps, onDone) {
    coachQueue = (steps || []).filter(function (s) { return !!qs(s.sel); });
    coachIdx = 0;
    if (!coachQueue.length) { if (onDone) onDone(); return; }
    showCoach(onDone);
  }
  function showCoach(onDone) {
    var root = qs('#coach-root');
    clear(root);
    if (coachIdx >= coachQueue.length) { if (onDone) onDone(); return; }
    var step = coachQueue[coachIdx];
    var target = qs(step.sel);
    if (!target) { coachIdx++; showCoach(onDone); return; }

    var back = el('div', 'coach-back');
    root.appendChild(back);

    var r = target.getBoundingClientRect();
    var pad = 8;
    var hole = el('div', 'coach-hole decor');
    hole.style.left = Math.max(0, r.left - pad) + 'px';
    hole.style.top = Math.max(0, r.top - pad) + 'px';
    hole.style.width = Math.max(24, r.width + pad * 2) + 'px';
    hole.style.height = Math.max(24, r.height + pad * 2) + 'px';
    root.appendChild(hole);

    var card = el('div', 'coach-card');
    card.appendChild(el('span', 'cc-step', (coachIdx + 1) + ' / ' + coachQueue.length));
    card.appendChild(el('span', 'cc-t', step.title));
    card.appendChild(el('p', null, step.text));
    var acts = el('div', 'cc-acts');
    var skip = btn('건너뛰기', 'btn-sm btn-ghost', function () { clear(root); if (onDone) onDone(); });
    var next = btn(coachIdx === coachQueue.length - 1 ? '알겠다' : '다음', 'btn-sm btn-primary', function () {
      coachIdx++; showCoach(onDone);
    });
    acts.appendChild(skip); acts.appendChild(next);
    card.appendChild(acts);
    root.appendChild(card);

    var cw = 320, ch = card.getBoundingClientRect().height || 150;
    var left = clamp(r.left, 12, Math.max(12, innerWidth - cw - 12));
    var top = r.bottom + 16;
    if (top + ch > innerHeight - 12) top = Math.max(12, r.top - ch - 16);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    back.onclick = function () { coachIdx++; showCoach(onDone); };
  }
  function coachClear() { clear(qs('#coach-root')); }

  /* ★ 한 줄 코치마크 — 화면을 막지 않는다.
     GDD3 §8: "모든 신기능은 등장 시 1줄 코치마크". 필요한 순간에 하나씩만 뜬다. */
  var hintTimer = null;
  function hintAt(sel, text, ms) {
    var root = qs('#coach-root');
    if (!root) return null;
    var target = typeof sel === 'string' ? qs(sel) : sel;
    clear(root);
    var card = el('div', 'coach-one');
    card.appendChild(el('span', 'co-dot decor'));
    card.appendChild(el('span', 'co-t', text));
    root.appendChild(card);
    var w = card.getBoundingClientRect().width || 260;
    if (target && target.getBoundingClientRect) {
      var r = target.getBoundingClientRect();
      var left = clamp(r.left + r.width / 2 - w / 2, 12, Math.max(12, innerWidth - w - 12));
      var top = r.bottom + 12;
      if (top + 60 > innerHeight - 12) top = Math.max(12, r.top - 62);
      card.style.left = left + 'px';
      card.style.top = top + 'px';
      card.classList.add('anchored');
    } else {
      card.style.left = Math.round((innerWidth - w) / 2) + 'px';
      card.style.top = '96px';
    }
    void card.offsetWidth;
    card.classList.add('in');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      card.classList.remove('in');
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 400);
    }, ms || 5200);
    card.onclick = function () { clearTimeout(hintTimer); if (card.parentNode) card.parentNode.removeChild(card); };
    return card;
  }

  GM.ui = {
    qs: qs, qsa: qsa, el: el, btn: btn, frag: frag, clear: clear, esc: esc,
    fmt: fmt, fixed: fixed, pct: pct, signed: signed, clamp: clamp, lerp: lerp, josa: josa,
    hash: hash, rngFrom: rngFrom, mix: mix, shade: shade, rgba: rgba, riskColor: riskColor,
    toast: toast, initTooltips: initTooltips, tipSet: tipSet, tipHide: tipHide,
    tweenNum: tweenNum, floatDelta: floatDelta, sparkle: sparkle, makeGauge: makeGauge,
    paper: paper, section: section, row: row, pips: pips,
    openModal: openModal, closeModal: closeModal, closeTopModal: closeTopModal,
    modalOpen: modalOpen, anyModalOpen: anyModalOpen, confirmBox: confirmBox,
    px: px, sprite: sprite, fitCanvas: fitCanvas,
    coach: coach, coachClear: coachClear, hintAt: hintAt,
    banner: banner, bannerClear: bannerClear
  };
})(window);
