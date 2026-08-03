/* social.js — 멀티: 초대 코드 · 접속자 명부 · 한 줄 대화(말풍선 + 기록).
   ★ 서버가 이미 새니타이즈한 문자열이 온다 — 다시 이스케이프하지 않는다(이중 표시 방지). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var panel = null, logEl = null, rosterEl = null, inputEl = null;
  var bubbles = {};          // avatarId → {text, until}
  var open = true;

  function init() {
    panel = U.qs('#social-panel');
    if (!panel) return;
    render();
    S.on('chat', function (m) { pushBubble(m); paintLog(); });
    S.on('chatHistory', paintLog);
    S.on('state', paintRoster);
    S.on('avatars', paintRoster);
  }

  function render() {
    U.clear(panel);
    panel.hidden = false;

    var head = U.el('div', 'sp-head');
    head.appendChild(GM.icons.img('chat', 18));
    head.appendChild(U.el('span', 'sp-t', '함께 다스리는 이들'));
    var codeBtn = U.btn('초대 코드', 'btn-sm', copyCode);
    codeBtn.id = 'invite-copy';
    U.tipSet(codeBtn, '왕국 문장 번호를 복사합니다', '이 번호를 건네면 같은 나라에 함께 들어옵니다.');
    head.appendChild(codeBtn);
    var fold = U.btn('▾', 'btn-sm btn-ghost', toggle);
    fold.id = 'social-fold';
    head.appendChild(fold);
    panel.appendChild(head);

    rosterEl = U.el('div', 'sp-roster');
    rosterEl.id = 'roster';
    panel.appendChild(rosterEl);

    logEl = U.el('div', 'sp-log');
    logEl.id = 'chat-log';
    panel.appendChild(logEl);

    var form = U.el('form', 'sp-form');
    form.id = 'chat-form';
    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.id = 'chat-input';
    inputEl.maxLength = chatMax();
    inputEl.placeholder = '한 줄 건네기 (Enter)';
    inputEl.autocomplete = 'off';
    form.appendChild(inputEl);
    var send = U.btn('보냄', 'btn-sm btn-primary');
    send.type = 'submit';
    send.id = 'chat-send';
    form.appendChild(send);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { inputEl.blur(); e.stopPropagation(); }
    });
    panel.appendChild(form);

    paintRoster();
    paintLog();
  }

  function chatMax() {
    var w = S.worldCfg();
    return (w && w.chat && w.chat.maxLength) || 160;
  }

  function submit() {
    if (!inputEl) return;
    var text = inputEl.value.trim();
    if (!text) return;
    GM.net.send('chat', { text: text });
    inputEl.value = '';
    GM.sfx.play('page');
  }

  function focusInput() {
    if (!inputEl) return;
    try { inputEl.focus(); } catch (e) {}
  }

  function toggle() {
    open = !open;
    if (rosterEl) rosterEl.hidden = !open;
    if (logEl) logEl.hidden = !open;
    var f = U.qs('#social-fold');
    if (f) f.textContent = open ? '▾' : '▸';
  }

  function copyCode() {
    var id = S.S.gameId || '';
    if (!id) { U.toast('아직 왕국 문장이 없습니다.', 'warn'); return; }
    var done = function () { U.toast('초대 코드를 옮겨 담았습니다: ' + id, 'good', 4200); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(id).then(done, function () { U.toast('초대 코드: ' + id, 'good', 6000); });
        return;
      }
    } catch (e) {}
    U.toast('초대 코드: ' + id, 'good', 6000);
  }

  function paintRoster() {
    if (!rosterEl) return;
    var list = S.members();
    U.clear(rosterEl);
    if (!list.length) { rosterEl.appendChild(U.el('div', 'sp-empty', '아직 그대뿐입니다.')); return; }
    list.forEach(function (m) {
      var row = U.el('div', 'sp-member' + (m.online ? '' : ' away'));
      row.setAttribute('data-avatar', m.avatarId || m.name);
      row.appendChild(GM.atlas.avatarImg(m.appearance, 26));
      var col = U.el('div', 'sm-col');
      col.appendChild(U.el('span', 'sm-n', m.name));
      col.appendChild(U.el('span', 'sm-r', m.role ? S.roleMeta(m.role).name : '자리 미정'));
      row.appendChild(col);
      var dot = U.el('span', 'sm-dot');
      row.appendChild(dot);
      U.tipSet(row, m.name + (m.online ? ' — 함께 있습니다' : ' — 자리를 비웠습니다'),
        m.role ? S.roleMeta(m.role).name + '의 자리를 맡고 있습니다.' : '아직 자리를 고르지 않았습니다.');
      rosterEl.appendChild(row);
    });
  }

  function paintLog() {
    if (!logEl) return;
    var list = S.S.chat || [];
    U.clear(logEl);
    if (!list.length) { logEl.appendChild(U.el('div', 'sp-empty', '조용합니다.')); return; }
    list.slice(-40).forEach(function (m) {
      var row = U.el('div', 'sp-line');
      var who = U.el('span', 'sl-who', (m.from && m.from.name) || '군주');
      who.style.color = (m.from && m.from.avatarId) === S.S.avatarId ? '#f6cf7a' : '#a8c8ff';
      row.appendChild(who);
      var txt = U.el('span', 'sl-t');
      txt.textContent = decodeEntities(m.text || '');
      row.appendChild(txt);
      logEl.appendChild(row);
    });
    try { logEl.scrollTop = logEl.scrollHeight; } catch (e) {}
  }

  /* 서버가 &lt; 로 보낸 것을 텍스트 노드에 넣을 때만 되돌린다 (innerHTML 을 쓰지 않으므로 안전) */
  function decodeEntities(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function pushBubble(m) {
    if (!m || !m.from) return;
    bubbles[m.from.avatarId] = { text: decodeEntities(m.text || '').slice(0, 24), until: Date.now() + 5200 };
    GM.sfx.play('tap');
  }

  function bubbleFor(avatarId) {
    var b = bubbles[avatarId];
    if (!b) return null;
    if (Date.now() > b.until) { delete bubbles[avatarId]; return null; }
    return b.text;
  }

  GM.social = {
    init: init, render: render, focusInput: focusInput, toggle: toggle,
    bubbleFor: bubbleFor, copyCode: copyCode, paintRoster: paintRoster, paintLog: paintLog
  };
})(window);
