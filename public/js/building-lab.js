/* 건물 테스트 월드 — 서버·세이브와 분리된 배치 전용 캔버스. */
(function () {
  'use strict';
  var cv = document.getElementById('lab-world'), ctx = cv.getContext('2d');
  var sel = document.getElementById('building-select'), fw = document.getElementById('foot-w'), fh = document.getElementById('foot-h');
  var scaleInput = document.getElementById('visual-scale'), scaleValue = document.getElementById('scale-value');
  var desc = document.getElementById('building-desc'), status = document.getElementById('status');
  var hqStageStrip = document.getElementById('hq-stage-strip');
  var defs = [], placed = [], selected = null, drag = null;
  var RESOURCE_FOOTPRINTS = { forest_oak:[4,4], forest_pine:[3,5], forest_birch:[4,4], forest_dead:[4,4] };
  var EXTRA_ASSETS = ['forest_oak','forest_pine','forest_birch','forest_dead','berry_bush_red','berry_bush_blue','rock_granite','rock_limestone','iron_vein','coal_vein','oil_pool','ruin_pillar','cache_crate','water_spring','field_sown','field_sprout','field_grow','field_ripe','mushroom_cluster','salt_crystal'].map(function(k){return {key:'node/'+k,name:'자원 · '+k,category:'resource',footprint:RESOURCE_FOOTPRINTS[k]||[2,2]};}).concat(['wood','stone','grain','iron_ore','coal','oil','steel','fuel','meat','hide','wool','gold','build','combat','farm','lumber','mining','trade','research','warning'].map(function(k){return {key:'ui/'+k,name:'아이콘 · '+k,category:'ui',footprint:[2,2]};})).concat(['bread','cheese','apple','dried_meat','fish','stew','healing_potion','energy_tonic','wood_plank','stone_block','iron_ingot','coal_bag','oil_flask','steel_plate','rope','leather_roll','wool_bundle','hammer_tool','pickaxe_tool','axe_tool'].map(function(k){return {key:'item/'+k,name:'아이템 · '+k,category:'item',footprint:[2,2]};}));
  /* Keep the current production additions visible even when a legacy generated
     manifest cannot be loaded. */
  EXTRA_ASSETS = EXTRA_ASSETS.concat([
    {key:'asset/building/construction_site_v2/base.png',name:'건설 비계',category:'collection',footprint:[4,4]},
    {key:'asset/building/construction_foundation_v2/base.png',name:'석조 기초 공사',category:'collection',footprint:[4,3]},
    {key:'asset/node/supply_chest_v2/base.png',name:'보급 상자',category:'collection',footprint:[2,2]},
    {key:'asset/building/barricade_v2/base.png',name:'방어 바리케이드',category:'collection',footprint:[3,2]}
  ]);
  var EXTRA_IMAGES = {};
  /* 테스트 월드에는 기존 프로젝트 PNG를 섞지 않는다. 새로 제작·승인된 키만 여기 추가한다. */
  var CREATED_BUILDING_KEYS = ['campfire','tent','hut','house','manor','well','woodpile','granary','sawmill','quarry_camp','hunter_hut','storage_crate','storage','bloomery','trading_post','market','watchpost','arrow_tower','barracks','ballista','cannon','frost_tower','flame_tower','fence','gate','shrine','consulate','monument','appraisal_post','claim_flag','lamp','banner','garden','fountain','library','workshop','academy','station','smelter','smithy','mill','ranch','mine_shaft'];
  /* 첫 화면에는 건물 전부가 들어오고, Ctrl+휠로 개별 에셋을 확대해 볼 수 있다. */
  var view = { x: 18, y: 10, tile: 14 };
  function defOf(key) { return defs.find(function (d) { return d.key === key; }); }
  function currentDef() { return defOf(sel.value); }
  function footprint(def) { var a = def && def.footprint || [1, 1]; return { w:+fw.value || a[0], h:+fh.value || a[1] }; }
  function sprite(key, tier, ruined) {
    if (key.indexOf('node/') === 0 || key.indexOf('ui/') === 0 || key.indexOf('item/') === 0 || key.indexOf('asset/') === 0) { var path=key.indexOf('asset/')===0?'assets/'+key.slice(6):key.indexOf('node/')===0?'assets/node/'+key.slice(5)+'/base.png':key.indexOf('ui/')===0?'assets/ui/generated/'+key.slice(3)+'/base.png':'assets/item/generated/'+key.slice(5)+'/base.png'; if(!EXTRA_IMAGES[key]){var im=new Image();im.src=path+'?v=remaining-assets-2';EXTRA_IMAGES[key]=im;} return EXTRA_IMAGES[key]; }
    var d = defOf(key) || {};
    if (d.hq) return (window.GM.atlas.handmadeBuilding && window.GM.atlas.handmadeBuilding(key, key === 'campfire' ? tier : 1, !!ruined)) || window.GM.atlas.hall(1, { ruined: !!ruined });
    return window.GM.atlas.building(key, tier || 1, { ruined: !!ruined });
  }
  function updateFields() { var d=currentDef(); if (!d) return; var a=d.footprint||[1,1]; fw.value=a[0]; fh.value=a[1]; scaleInput.value=d.spriteScale||1;scaleValue.textContent=Math.round((d.spriteScale||1)*100)+'%';desc.textContent=(d.purpose||d.desc||'') + (d.hq ? ' · 본부 포함' : ''); status.textContent=d.name+'을(를) 선택했습니다.'; }
  function resize() { var r=cv.getBoundingClientRect(), q=devicePixelRatio||1; cv.width=Math.round(r.width*q); cv.height=Math.round(r.height*q); ctx.setTransform(q,0,0,q,0,0); }
  function at(ev) { var r=cv.getBoundingClientRect(); return { x:(ev.clientX-r.left-view.x)/view.tile, y:(ev.clientY-r.top-view.y)/view.tile }; }
  function drawGround(w,h) { ctx.fillStyle='#55753d'; ctx.fillRect(0,0,w,h); var t=view.tile; for(var y=-1;y<h/t+2;y++) for(var x=-1;x<w/t+2;x++){ var px=view.x+x*t,py=view.y+y*t; ctx.fillStyle=(x+y)%2?'#648647':'#5d7e43';ctx.fillRect(Math.round(px),Math.round(py),Math.ceil(t),Math.ceil(t)); ctx.fillStyle='rgba(37,69,31,.17)';ctx.fillRect(Math.round(px+t*.18),Math.round(py+t*.28),Math.max(1,Math.round(t*.08)),Math.max(1,Math.round(t*.12))); } }
  function drawGrid(w,h) { var t=view.tile;ctx.strokeStyle='rgba(238,237,203,.2)';ctx.lineWidth=1;for(var x=view.x%t;x<w;x+=t){ctx.beginPath();ctx.moveTo(Math.round(x)+.5,0);ctx.lineTo(Math.round(x)+.5,h);ctx.stroke();}for(var y=view.y%t;y<h;y+=t){ctx.beginPath();ctx.moveTo(0,Math.round(y)+.5);ctx.lineTo(w,Math.round(y)+.5);ctx.stroke();} }
  function rect(item) { item.sprite=sprite(item.key,item.tier||1,item.ruined); var a=item.fp, slotW=a.w*view.tile, slotH=a.h*view.tile, w=slotW, h=slotH;var left=view.x+item.x*view.tile,top=view.y+item.y*view.tile;return { x:left, y:top, w:w,h:h, base:top+slotH }; }
  function draw() { var r=cv.getBoundingClientRect(), w=r.width,h=r.height;ctx.clearRect(0,0,w,h);drawGround(w,h);drawGrid(w,h); placed.forEach(function(item){var q=rect(item);ctx.save();ctx.globalAlpha=.23;ctx.fillStyle='#1c2516';ctx.beginPath();ctx.ellipse(q.x+q.w/2,q.base-q.w*.07,q.w*.34,q.w*.11,0,0,Math.PI*2);ctx.fill();ctx.restore();var sheet=item.key==='campfire'&&window.GM.atlas.buildingAnimation?window.GM.atlas.buildingAnimation('campfire'):null, combatSheet=/^asset\/(creature|enemy)\/.+\/sheet\.png$/.test(item.key);if(combatSheet&&item.sprite&&item.sprite.complete&&item.sprite.naturalWidth){var sw=item.sprite.naturalWidth/4,sh=item.sprite.naturalHeight/6;ctx.drawImage(item.sprite,sw,0,sw,sh,Math.round(q.x),Math.round(q.y),Math.ceil(q.w),Math.ceil(q.h));}else if(sheet&&sheet.complete&&sheet.naturalWidth&&!sheet.failed){var bw=sheet.naturalWidth/4,frame=Math.floor(Date.now()/135)%4;ctx.drawImage(sheet,frame*bw,0,bw,sheet.naturalHeight,Math.round(q.x),Math.round(q.y),Math.ceil(q.w),Math.ceil(q.h));}else ctx.drawImage(item.sprite,Math.round(q.x),Math.round(q.y),Math.ceil(q.w),Math.ceil(q.h));if(item===selected){ctx.strokeStyle='#ffd36c';ctx.lineWidth=3;ctx.strokeRect(Math.round(view.x+item.x*view.tile)+1,Math.round(view.y+item.y*view.tile)+1,Math.round(item.fp.w*view.tile)-2,Math.round(item.fp.h*view.tile)-2);}}); requestAnimationFrame(draw); }
  function selectedAt(p) { for(var i=placed.length-1;i>=0;i--){var n=placed[i];if(p.x>=n.x&&p.x<n.x+n.fp.w&&p.y>=n.y&&p.y<n.y+n.fp.h)return n;}return null; }
  function selectItem(item) { selected=item; if(!item){status.textContent='선택한 건물이 없습니다.';return;} sel.value=item.key;fw.value=item.fp.w;fh.value=item.fp.h;scaleInput.value=item.scale;scaleValue.textContent=Math.round(item.scale*100)+'%';status.textContent=item.name+' 선택됨 — 칸 수·크기를 조절할 수 있습니다.'; }
  function applyEdit() { if(!selected)return; selected.fp.w=Math.max(1,Math.min(12,+fw.value||1));selected.fp.h=Math.max(1,Math.min(12,+fh.value||1));selected.scale=+scaleInput.value||1;scaleValue.textContent=Math.round(selected.scale*100)+'%'; }
  function place(p) { var d=currentDef();if(!d)return;var f=footprint(d), item={key:d.key,name:d.name,fp:f,scale:+scaleInput.value||1,x:Math.floor(p.x),y:Math.floor(p.y),sprite:sprite(d.key,1)};placed.push(item);selectItem(item); }
  var SIZE_PENDING_KEYS = ['storage_crate','fence','gate','shrine','consulate','monument','appraisal_post','claim_flag','lamp','banner','garden','fountain','library','workshop','academy','station'];
  function hqStageDefs() { return [
    {key:'campfire',name:'모닥불',category:'hq-stage',purpose:'정착지 0단계',footprint:[2,2],hq:true,tier:1},
    {key:'hq_camp',name:'야영 본부',category:'hq-stage',purpose:'정착지 1단계',footprint:[4,4],hq:true,tier:2},
    {key:'hq_village',name:'촌락 회관',category:'hq-stage',purpose:'정착지 2단계',footprint:[5,5],hq:true,tier:3},
    {key:'hq_town',name:'마을 회관',category:'hq-stage',purpose:'정착지 3단계',footprint:[7,7],hq:true,tier:4},
    {key:'hq_city',name:'도시 관청',category:'hq-stage',purpose:'정착지 4단계',footprint:[9,9],hq:true,tier:5},
    {key:'hq_royal',name:'왕국 청사',category:'hq-stage',purpose:'정착지 5단계',footprint:[11,9],hq:true,tier:6}
  ]; }
  function renderHqStages() {
    if (!hqStageStrip) return;
    hqStageStrip.innerHTML = '';
    hqStageDefs().forEach(function (d, i) {
      var card = document.createElement('div'), image = document.createElement('img'), label = document.createElement('div');
      card.className = 'hq-stage-card';
      image.src = 'assets/building/' + d.key + '/base.png';
      image.alt = d.name;
      label.textContent = i + '단계 · ' + d.name + ' (' + d.footprint[0] + '×' + d.footprint[1] + ')';
      card.appendChild(image); card.appendChild(label); hqStageStrip.appendChild(card);
    });
  }
  var FALLBACK_DEFS={campfire:{name:'정착지 본부',category:'civic',purpose:'시작 모닥불',footprint:[2,2],hq:true},tent:{name:'천막',category:'housing',purpose:'수작업 천막',footprint:[2,2],spriteScale:2},hut:{name:'오두막',category:'housing',purpose:'수작업 오두막',footprint:[4,4]},house:{name:'가옥',category:'housing',purpose:'수작업 가옥',footprint:[6,5]},manor:{name:'저택',category:'housing',purpose:'수작업 저택',footprint:[6,7]},storage_crate:{name:'저장 상자',category:'production',footprint:[1,1]},well:{name:'우물',category:'production',footprint:[3,3]},woodpile:{name:'장작더미',category:'production',footprint:[2,2]},granary:{name:'곡창',category:'production',footprint:[4,4]},sawmill:{name:'제재소',category:'production',footprint:[4,4]},quarry_camp:{name:'채석장',category:'production',footprint:[3,2]},hunter_hut:{name:'사냥꾼 오두막',category:'production',footprint:[4,4]},smelter:{name:'제련소',category:'production',footprint:[4,4]},smithy:{name:'대장간',category:'production',footprint:[4,4]},mine_shaft:{name:'광산 갱도',category:'production',footprint:[3,3]},mill:{name:'방앗간',category:'production',footprint:[3,3]},ranch:{name:'목장',category:'production',footprint:[4,4]},appraisal_post:{name:'감정소',category:'civic',footprint:[2,2]},trading_post:{name:'교역소',category:'civic',footprint:[3,3]},market:{name:'시장',category:'civic',footprint:[3,4]},shrine:{name:'성지',category:'civic',footprint:[4,4]},library:{name:'서고',category:'research',footprint:[3,3]},workshop:{name:'공방',category:'research',footprint:[3,3]},academy:{name:'대학당',category:'research',footprint:[4,4]},watchpost:{name:'초소',category:'military',footprint:[1,1]},arrow_tower:{name:'화살탑',category:'military',footprint:[1,1]},barracks:{name:'병영',category:'military',footprint:[3,4]},ballista:{name:'발리스타',category:'military',footprint:[2,2]},cannon:{name:'대포탑',category:'military',footprint:[2,3]},frost_tower:{name:'빙결탑',category:'military',footprint:[1,1]},flame_tower:{name:'화염탑',category:'military',footprint:[2,2]},consulate:{name:'영사관',category:'civic',footprint:[4,4]},monument:{name:'기념비',category:'civic',footprint:[3,3]},claim_flag:{name:'개척 깃발',category:'civic',footprint:[1,1]},station:{name:'정거장',category:'civic',footprint:[2,2]},lamp:{name:'가로등',category:'decor',footprint:[1,1]},banner:{name:'깃발',category:'decor',footprint:[1,1]},storage:{name:'창고',category:'production',footprint:[3,3]},fence:{name:'울타리',category:'military',footprint:[1,1]},gate:{name:'문',category:'military',footprint:[1,1]},garden:{name:'정원',category:'decor',footprint:[1,1]},fountain:{name:'분수',category:'decor',footprint:[1,1]}};
  function applyDefs(data){data=(data.buildings&&data.buildings.defs)||data||{};defs=Object.keys(data).filter(function(k){return data[k]&&data[k].name&&data[k].category&&CREATED_BUILDING_KEYS.indexOf(k)>=0;}).map(function(k){var d=data[k];return {key:k,name:d.name,category:d.category,purpose:d.purpose,desc:d.desc,footprint:d.footprint,hq:d.hq,spriteScale:d.spriteScale};}).concat(hqStageDefs()).concat(EXTRA_ASSETS).sort(function(a,b){return a.category.localeCompare(b.category)||a.name.localeCompare(b.name);});sel.innerHTML='';defs.forEach(function(d){var o=document.createElement('option');o.value=d.key;o.textContent=(d.hq?'★ ':'')+d.name+' · '+d.key;sel.appendChild(o);});sel.value=defOf('campfire')?'campfire':defs[0].key;updateFields();addSamples();}
  function addSamples(){
    if(placed.length)return;
    var sample=[],hqStages=defs.filter(function(d){return d.category==='hq-stage';}),buildings=defs.filter(function(d){return d.category!=='hq-stage'&&d.category!=='resource'&&d.category!=='ui'&&d.category!=='item'&&d.category!=='collection';});
    hqStages.forEach(function(d,i){sample.push([d.key,2+i*14,2,d.tier]);});
    var pending=buildings.filter(function(d){return SIZE_PENDING_KEYS.indexOf(d.key)>=0;}),regular=buildings.filter(function(d){return SIZE_PENDING_KEYS.indexOf(d.key)<0;}),upgrades=CREATED_BUILDING_KEYS.filter(function(key){return key!=='campfire';});
    var upgradeRows=Math.ceil(upgrades.length/4),pairSpan=32;
    upgrades.forEach(function(key,i){var d=defOf(key),row=1+Math.floor(i/4)*pairSpan,col=1+(i%4)*14;if(d){sample.push([key,col,row,1]);sample.push([key,col,row+8,2]);sample.push([key,col,row+16,3]);}});
    var pendingRows=Math.ceil(pending.length/8);
    pending.forEach(function(d,i){sample.push([d.key,1+(i%8)*9,1+upgradeRows*pairSpan+Math.floor(i/8)*9,1]);});
    regular.forEach(function(d,i){sample.push([d.key,1+(i%8)*9,1+upgradeRows*pairSpan+pendingRows*9+Math.floor(i/8)*9,1]);});
    var buildingRows=Math.ceil((upgradeRows*pairSpan+pendingRows*9+Math.ceil(regular.length/8)*9)/9);
    EXTRA_ASSETS.filter(function(d){return d.category==='resource';}).forEach(function(d,i){sample.push([d.key,1+(i%10)*5,buildingRows*9+3+Math.floor(i/10)*6,1]);});
    EXTRA_ASSETS.filter(function(d){return d.category==='ui';}).forEach(function(d,i){sample.push([d.key,1+(i%10)*3,buildingRows*9+16+Math.floor(i/10)*3,1]);});
    EXTRA_ASSETS.filter(function(d){return d.category==='item';}).forEach(function(d,i){sample.push([d.key,1+(i%10)*3,buildingRows*9+23+Math.floor(i/10)*3,1]);});
    EXTRA_ASSETS.filter(function(d){return d.category==='collection';}).forEach(function(d,i){sample.push([d.key,1+(i%10)*6,buildingRows*9+31+Math.floor(i/10)*6,1]);});
    sample.forEach(function(s){var d=defOf(s[0]),tier=s[3]||1;if(d)placed.push({key:d.key,name:d.name+(tier>1?' · '+tier+'단계':''),fp:{w:d.footprint[0],h:d.footprint[1]},scale:d.spriteScale||1,x:s[1],y:s[2],tier:tier,sprite:sprite(d.key,tier)});});
    status.textContent='상단: 각 건물의 1단계·2단계·3단계 외형 · 아래: 자원·유물·생물·침공·유적·연구·UI·챕터 에셋';
  }
  function loadDefs(){fetch('/api/config').then(function(r){if(!r.ok)throw new Error('config');return r.json();}).then(applyDefs).catch(function(){fetch('../data/buildings.json').then(function(r){if(!r.ok)throw new Error('data');return r.json();}).then(applyDefs).catch(function(){applyDefs(FALLBACK_DEFS);});});}
  /* Put a fourth, dedicated destroyed-state row below each building's three tiers.
     Keeping it here means every newly registered handmade building inherits the
     same visual QA layout without duplicating the catalogue. */
  var addBaseSamples = addSamples;
  addSamples = function () {
    addBaseSamples();
    if (placed._hasRuinedSamples) return;
    placed._hasRuinedSamples = true;
    placed.filter(function (item) {
      return item.tier === 1 && CREATED_BUILDING_KEYS.indexOf(item.key) >= 0;
    }).slice().forEach(function (item) {
      placed.push({
        key: item.key, name: item.name + ' · ruined',
        fp: { w: item.fp.w, h: item.fp.h }, scale: item.scale,
        x: item.x, y: item.y + 24, tier: 1, ruined: true,
        sprite: sprite(item.key, 1, true)
      });
    });
  };
  renderHqStages();
  fetch('assets/generated-manifest.json').then(function(r){if(!r.ok)throw new Error('manifest');return r.json();}).then(function(list){EXTRA_ASSETS=EXTRA_ASSETS.concat(Array.isArray(list)?list:[]);loadDefs();}).catch(loadDefs);
  sel.addEventListener('change',function(){selected=null;scaleInput.value=1;scaleValue.textContent='100%';updateFields();});[fw,fh,scaleInput].forEach(function(n){n.addEventListener('input',applyEdit);});
  document.getElementById('remove-selected').onclick=function(){if(!selected)return;placed.splice(placed.indexOf(selected),1);selectItem(null);};document.getElementById('clear-world').onclick=function(){placed=[];selectItem(null);status.textContent='테스트 월드를 비웠습니다.';};
  cv.addEventListener('contextmenu',function(e){e.preventDefault();var item=selectedAt(at(e));if(item){placed.splice(placed.indexOf(item),1);if(item===selected)selectItem(null);}});cv.addEventListener('pointerdown',function(e){if(e.button===1){drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};cv.setPointerCapture(e.pointerId);return;}var p=at(e),item=selectedAt(p);if(item)selectItem(item);else place(p);});cv.addEventListener('pointermove',function(e){if(!drag)return;view.x=drag.vx+e.clientX-drag.x;view.y=drag.vy+e.clientY-drag.y;});cv.addEventListener('pointerup',function(){drag=null;});cv.addEventListener('wheel',function(e){e.preventDefault();if(e.ctrlKey){view.tile=Math.max(12,Math.min(86,view.tile+(e.deltaY<0?3:-3)));return;}if(e.shiftKey)view.x-=e.deltaY;else view.y-=e.deltaY;},{passive:false});
  window.addEventListener('resize',resize);resize();requestAnimationFrame(draw);
}());
