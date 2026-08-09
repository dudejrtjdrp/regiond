/* crewpanel.js — ★ §17-11 동료(봇) 상호작용 패널.
   피드백: "일부 NPC(동료 봇)가 가만히 있으며 상호작용과 지시가 되지 않음" + "이름·모양새 커스텀이 필요함".
   지도에서 동료를 누르면 이 패널이 열린다(input.js crewAt): 초상·자리·지금 하는 일·기력을 보여 주고,
   [이곳으로 보낸다](지도 클릭 한 번 = 지시), [지시 해제], [이름·모양새 바꾸기]를 준다.
   값은 전부 서버가 정본이다 — companions 뷰(state)와 avatars 채널을 읽을 뿐, 화면은 셈을 하지 않는다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  /* world.js CREW_DOING 과 같은 낱말을 쓴다 — 이름표와 패널이 다른 말을 하면 안 된다 */
  var DOING = {
    node: '캐는 중', site: '짓는 중', creature: '싸우는 중', enemy: '싸우는 중',
    haul: '나르는 중', rest: '쉬는 중', flee: '물러나는 중', down: '쓰러짐',
    idle: '쉬는 중', move: '지시받은 곳으로 가는 중', hold: '지시 대기',
    patrol: '오가는 중'   /* ★ Sprint 2 — 크레딧이 차기를 기다리며 일터와 곳간을 오간다 */
  };

  /** companions 뷰(정본) + avatars 채널(원본 좌표·이름) 폴백으로 이 동료의 지금을 모은다 */
  function crewOf(id) {
    var c = S.companionById(id);
    var av = null;
    var list = S.S.avatars || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) av = list[i];
    if (!c && !av) return null;
    c = c || {};
    av = av || {};
    return {
      id: id,
      name: c.name || av.name || '동료',
      roleName: c.roleName || av.roleName || null,
      state: (c.down || av.down) ? 'down' : (c.state || av.state || 'idle'),
      hp: c.hp != null ? c.hp : (av.hp || 0),
      maxHp: c.maxHp || av.maxHp || 0,
      role: c.role || av.role || String(id || '').replace(/^bot~/, ''),
      appearance: c.appearance || av.appearance || S.defaultAppearance(),
      order: c.order || null,
      color: c.color || av.color || '#8fe3b4'
    };
  }

  function nameMax() {
    var cfg = S.appearanceCfg();
    return (cfg && cfg.nameMaxLength) || 16;
  }

  function open(id) {
    var c = crewOf(id);
    if (!c) { U.toast('그 동료를 찾지 못했습니다.', 'warn'); return null; }

    var body = U.el('div', 'crew-panel');

    /* ── 머리: 초상 + 이름 + 자리 + 지금 하는 일 ── */
    var head = U.el('div', 'cp-head');
    head.style.display = 'flex';
    head.style.gap = '10px';
    head.style.alignItems = 'center';
    head.appendChild(rolePortrait(c, 64));
    var col = U.el('div', 'cp-col');
    var nm = U.el('b', 'cp-name', c.name);
    nm.style.color = c.color;
    nm.style.display = 'block';
    col.appendChild(nm);
    col.appendChild(U.el('span', 'cp-role',
      (c.roleName || '함께 일하는 이') + ' · ' + (DOING[c.state] || c.state)));
    head.appendChild(col);
    body.appendChild(head);

    /* ── 기력 ── */
    var g = U.makeGauge({ height: 14, color: '#6a994e' });
    var ratio = c.maxHp > 0 ? c.hp / c.maxHp : 0;
    g.setValue(ratio, '기력 ' + U.fmt(c.hp, 0) + ' / ' + U.fmt(c.maxHp, 0),
      c.name + '의 기력', '0이 되면 잠시 쓰러졌다가 모닥불 곁에서 다시 일어납니다.');
    body.appendChild(g);

    body.appendChild(U.el('p', 'hint', c.order
      ? '지금 지시: (' + Math.round(c.order.x) + ', ' + Math.round(c.order.y) + ') 자리로 가서 기다립니다.'
      : '지시가 없으면 스스로 일감을 찾아다닙니다. 자리를 찍어 보내면 그곳을 지킵니다.'));

    /* ── 지시 단추 ── */
    var row = U.el('div', 'se-actions');
    var go = U.btn('이곳으로 보낸다', 'btn-small btn-primary', function () {
      U.closeTopModal();
      S.setPlacing({ kind: 'crewMove', companionId: id });
      U.toast('지도를 눌러 자리를 고르세요.', 'good', 3600);
    });
    go.setAttribute('data-crew-move', id);
    row.appendChild(go);
    if (c.order) {
      var release = U.btn('지시 해제', 'btn-small', function () {
        GM.net.send('commandCompanion', { companionId: id, order: null }, function (res) {
          if (!res || !res.ok) {
            U.toast((res && res.error && res.error.message) || '지금은 걷을 수 없습니다.', 'warn');
            return;
          }
          U.toast('지시를 걷었습니다 — 다시 스스로 움직입니다.', 'good', 2800);
          U.closeTopModal();
          open(id);
        });
      });
      release.setAttribute('data-crew-release', id);
      row.appendChild(release);
    }
    body.appendChild(row);

    /* ── 이름·모양새 바꾸기 (접이식) ── */
    var widget = null;
    var nameInput = null;
    var edit = U.el('div', 'cp-edit');
    edit.hidden = true;
    var editBtn = U.btn('이름·모양새 바꾸기', 'btn-small', function () {
      edit.hidden = !edit.hidden;
      if (!edit.hidden && !widget) buildEdit();
    });
    editBtn.setAttribute('data-crew-edit', id);
    body.appendChild(editBtn);
    body.appendChild(edit);

    function buildEdit() {
      var nameRow = U.el('div', 'cp-edit-name');
      nameRow.style.display = 'flex';
      nameRow.style.gap = '8px';
      nameRow.style.alignItems = 'center';
      nameRow.style.margin = '8px 0';
      nameRow.appendChild(U.el('span', 'cc-label', '이름'));
      nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.id = 'crew-name-input';
      nameInput.maxLength = nameMax();
      nameInput.value = c.name;
      nameInput.autocomplete = 'off';
      nameRow.appendChild(nameInput);
      edit.appendChild(nameRow);

      var host = U.el('div');
      edit.appendChild(host);
      widget = GM.charcreate.mount(host, c.appearance, null);

      var save = U.btn('바꾼다', 'btn-primary', function () {
        var name = (nameInput.value || '').trim();
        if (!name) { U.toast('이름을 적어 주세요.', 'warn'); return; }
        GM.net.send('customizeCompanion', { companionId: id, name: name, appearance: widget.get() }, function (res) {
          if (!res || !res.ok) {
            U.toast((res && res.error && res.error.message) || '바꾸지 못했습니다.', 'warn');
            return;
          }
          U.toast('동료의 이름과 모습을 바꿨습니다.', 'good', 2800);
          GM.sfx.play('unlock');
          U.closeTopModal();
          open(id);
        });
      });
      save.id = 'crew-customize-save';
      edit.appendChild(save);
    }

    /* ── 발치 ── */
    var foot = U.el('div');
    foot.appendChild(U.btn('닫는다', 'btn-ghost', function () { U.closeTopModal(); }));

    return U.openModal({
      title: '동료 — ' + c.name, body: body, footer: foot, width: '620px',
      key: 'crew', icon: GM.icons.img('person', 22),
      onClose: function () { if (widget) widget.destroy(); }
    });
  }

  /* ★ §17-19(D-5) — 동료를 누르면 먼저 **한마디**가 오고, 수치판은 그다음이다.
     「왜」 창을 하나 더 끼우나 — 여태 동료를 누르면 곧장 기력 막대와 단추가 떴다.
     그건 사람이 아니라 장비를 여는 손맛이다. 지금 하는 일에 맞춰 한마디를 건네면
     같은 정보라도 「함께 일하는 사람」이 된다. 말은 화면의 몫이라 서버는 한 줄도 바뀌지 않는다. */
  var HELLO = {
    idle:  ['오늘은 무슨 일을 할까요.', '부르셨습니까. 손이 남습니다.'],
    node:  ['보시다시피 캐는 중입니다. 곧 한 짐 채웁니다.', '이 자리는 아직 남았습니다.'],
    site:  ['짓고 있습니다. 손이 하나 더 붙으면 빨라집니다.', '기둥은 세웠으니 지붕만 얹으면 됩니다.'],
    haul:  ['나르는 중입니다. 곳간까지 금방입니다.'],
    rest:  ['잠깐 숨을 돌립니다. 곧 다시 나갑니다.'],
    hold:  ['말씀하신 자리를 지키고 있습니다.'],
    move:  ['가는 중입니다. 도착하면 그 자리를 지키겠습니다.'],
    enemy: ['지금은 붙는 중입니다! 뒤를 봐 주십시오.'],
    creature: ['짐승이 붙었습니다. 조심하십시오.'],
    down:  ['…조금만, 조금만 쉬면 일어납니다.'],
    patrol: ['한 바퀴 돌며 숨을 고릅니다. 곧 다시 손을 씁니다.']
  };

  /** 그 사람의 지금에 맞는 한마디 — 같은 사람은 늘 같은 말투다(이름으로 고른다) */
  function helloLine(c) {
    var pool = HELLO[c.state] || HELLO.idle;
    return c.name + ': ' + pool[U.hash(c.name) % pool.length];
  }

  function greet(id) {
    var c = crewOf(id);
    if (!c) { U.toast('그 동료를 찾지 못했습니다.', 'warn'); return null; }
    if (!GM.dialogue) return open(id);
    return GM.dialogue.open({
      speaker: c.name, portraitKey: 'crew:' + c.role, lines: [helloLine(c)],
      choices: [{ label: '무엇을 하는지 본다', act: function () { open(id); } },
                { label: '그냥 지나친다' }]
    });
  }

  function rolePortrait(c, size) {
    var role = String((c && c.role) || '').replace(/^bot~/, '');
    var officer = { farm: 1, factory: 1, build: 1, defense: 1, trade: 1, saint: 1 };
    if (officer[role] && GM.icons && GM.icons.portraitImg) return GM.icons.portraitImg(role, size, 'crew');
    return GM.atlas.avatarImg(c.appearance, size);
  }

  /* ══════════ ★ §19-F3(F07-9) 주민 꾸미기 ══════════
     「왜」 같은 파일에 두는가 — 동료 봇과 주민은 화면에서 다른 것이지만, 사람의 이름과 옷을
     고르는 손짓은 하나여야 한다. 창의 모양도 규격(레이어 인덱스)도 그대로 쓰고, 다르게 가는 것은
     보내는 명령(customizeResident)과 값(소액 금화)뿐이다. 값은 서버가 다시 재고 거절할 수 있다. */
  function openResident(id) {
    var v = S.residentById(id);
    if (!v) { U.toast('그 사람을 찾지 못했습니다.', 'warn'); return null; }
    var look = v.appearance || S.defaultAppearance();
    var body = U.el('div', 'crew-panel');

    var head = U.el('div', 'cp-head');
    head.style.display = 'flex';
    head.style.gap = '10px';
    head.style.alignItems = 'center';
    head.appendChild(GM.atlas.avatarImg(look, 64));
    head.appendChild(U.el('b', 'cp-name', v.name));
    body.appendChild(head);
    body.appendChild(U.el('p', 'hint', '옷감과 품삯이 조금 듭니다. 바꾼 이름과 모습은 함께 하는 모두에게 그대로 보입니다.'));

    var nameRow = U.el('div', 'cp-edit-name');
    nameRow.style.display = 'flex';
    nameRow.style.gap = '8px';
    nameRow.style.alignItems = 'center';
    nameRow.appendChild(U.el('span', 'cc-label', '이름'));
    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'resident-name-input';
    input.maxLength = nameMax();
    input.value = v.name;
    input.autocomplete = 'off';
    nameRow.appendChild(input);
    body.appendChild(nameRow);

    var host = U.el('div');
    body.appendChild(host);
    var widget = GM.charcreate.mount(host, look, null);

    var foot = U.el('div');
    foot.appendChild(U.btn('물러난다', 'btn-ghost', function () { U.closeTopModal(); }));
    var save = U.btn('바꾼다', 'btn-primary', function () {
      sendResident(id, (input.value || '').trim(), widget.get());
    });
    save.id = 'resident-customize-save';
    foot.appendChild(save);

    return U.openModal({
      title: '주민 — ' + v.name, body: body, footer: foot, width: '620px',
      key: 'resident:' + id, icon: GM.icons.img('person', 22),
      onClose: function () { if (widget) widget.destroy(); }
    });
  }

  function sendResident(id, name, appearance) {
    if (!name) { U.toast('이름을 적어 주세요.', 'warn'); return; }
    GM.net.send('customizeResident', { residentId: id, name: name, appearance: appearance }, function (res) {
      if (!res || !res.ok) {
        U.toast((res && res.error && res.error.message) || '바꾸지 못했습니다.', 'warn', 3200);
        return;
      }
      U.toast('이름과 모습을 바꿨습니다.', 'good', 2800);
      GM.sfx.play('unlock');
      U.closeTopModal();
    });
  }

  GM.crewpanel = { open: open, greet: greet, openResident: openResident };
})(window);
