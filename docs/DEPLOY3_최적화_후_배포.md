# D-3 실행 절차 — 최적화분 커밋 → Railway 배포

> 2026-08-10 작성. **Railway 쪽 절차 자체는 `DEPLOY2_D2_실행.md` 가 정본이다.**
> 이 문서는 그 앞에 붙는 두 가지만 다룬다 — ① 이번 최적화로 무엇이 바뀌었나 ② 무엇을 지우고 무엇을 커밋하나.

---

## 0. 요약

| | 이전 | 이후 |
|---|---|---|
| `public/assets` | 1.1GB | **83MB** |
| PNG 장수 | 2,405 | 1,537 |
| 건물 원본 | 1254×1254 | 320×320 |

렉의 원인은 **장식 렌더 루프가 아니라 원본 스프라이트 다운스케일**이었다. `atlas.js` 가
1254×1254 원본 `Image` 를 그대로 돌려주고 `world.js` 가 그것을 41~83px 로 그리고 있었다.
매 프레임 157만 픽셀을 60px 로 줄이는 일을 초당 60번 되풀이한 셈이다.
지형·타일은 이미 16/32/64 오프스크린 캔버스를 거치고 있어서 멀쩡했고(그래서 스모크는
`<16ms` 였다), **건물·노드·울타리·장식만 그 캐시를 건너뛰고 있었다.**

---

## 1. 코드에서 바뀐 것

### `public/js/atlas.js` — `scaled()` 축소본 캐시 신설

한 번만 줄여 오프스크린 캔버스에 담고 그 뒤로는 재사용한다.

- 줌이 16·24·32 사이를 **보간**하므로 폭·높이를 **8px 격자로 올림**해 캐시가 흔들리지 않게 했다.
- 캔버스 **320개 상한 + 가장 오래된 것부터 버림**.
- 원본이 표시 크기의 1.25배 이하면 그냥 원본을 돌려준다 — 확대는 건드리지 않는다.
- 아직 안 실린 그림(`complete === false`)은 굽지 않는다. 빈 캔버스가 캐시에 박히는 것을 막는다.
- 2d 문맥이 없는 곳(jsdom 하니스)에서는 원본을 그대로 돌려준다.
- `dropScaled(img)` — 에셋이 새로 실리면 **그 그림의 축소본만** 버린다(전량 폐기는 줌마다 재구축을 부른다).

### `public/js/world.js` — 10곳에 적용

건물·미리보기 건물·노드·울타리, 그리고 **`drawBiomeDressing` · `drawForestProps` 의
장식·소품·랜드마크**까지. 원래 후보로 지목됐던 「청크 베이킹」은 하지 않았다 —
같은 효과를 훨씬 작은 변경으로 얻는다.

### `tools/shrink-assets.mjs` — 신설

```bash
node tools/shrink-assets.mjs --dry     # 계산만
node tools/shrink-assets.mjs           # 적용 (원본은 _to_delete/original-size/ 로)
node tools/shrink-assets.mjs --max 320 # 목표 최대 변
```

**시트는 정수 배수로만 줄인다.** 코드가 `naturalWidth` 를 4·5·6·8·16 으로 나눠 프레임을
집기 때문이다(`atlas.js:1794`·`1888`·`359-360`, `world.js:1779`, `action-sprites.js:66-67`).
원본이 그 수로 나누어떨어지지 않는 것도 있어 이미 소수점 자리를 쓰고 있는데,
정확히 1/k 로 줄이면 **그 비율이 그대로 보존**되어 프레임 경계가 어긋나지 않는다.
임의 크기(예: 무조건 320px)로 줄이면 시트가 미세하게 밀린다.

- wolf `sheet.png` → 1254/6 = **209px**
- temple `guardian-sheet.png` → /4 = **256×320**
- 배수를 못 찾은 9장(autotile 3 · characters 6)은 **원본 유지**

---

## 2. 지운 것 (전부 `_to_delete/` 로 옮겼다 — 되돌릴 수 있다)

| 무엇 | 장수 | 용량 | 근거 |
|---|---|---|---|
| `assets/assistant-made/` | 859 | 569MB | 원본과 **바이트 단위 동일**, 코드 참조 0건 |
| `*source*` | 127 | 164MB | 런타임·tools 참조 0건 (`guardian-sheet.png` 이 정본, `-source-v1` 은 작업 원본) |
| 미사용 컨셉아트 | 3 | 3MB | `temple/concepts/*`, `player/.../female-fixed-v7.png` |
| 원본 크기 PNG | 550 | 460MB | `shrink-assets.mjs` 가 옮김 |
| `_xfer/` · `tmp*.png` | 12 | 129MB | 작업 중 흘린 미리보기·옮김용 |

`_to_delete/` 는 `.gitignore` 에 있으므로 저장소에는 애초에 올라가지 않는다.

---

## 3. 지금 해야 할 일 — 순서대로

### 3-1. 체감부터 확인한다 (이게 먼저다)

```
npm start   →   브라우저 Ctrl+F5   →   F12 콘솔
GM.world.resetStats();      // 그리고 30초쯤 실제로 논다
GM.world.frameStats()
```

`workP95` 가 **16.7ms 아래**면 끝이다. 청크 베이킹·LOD·품질 단계는 필요 없다.
아직 무겁다면 그때 `drawBiomeDressing` 청크 베이킹을 꺼내면 된다.

> **눈으로도 한 번 본다** — 건물·나무가 뭉개지지 않았는지, 특히 **동물·적·수호자 애니메이션의
> 프레임이 밀리지 않았는지**. 시트를 정수 배수로만 줄인 이유가 이것이라, 여기가 틀어졌으면
> `_to_delete/original-size/` 에서 해당 파일만 되돌리면 된다.

### 3-2. 커밋 (반드시 PC에서 직접)

Claude 세션의 마운트는 `.git/objects` 의 unlink 를 막아 `git add` 가 중간에 실패한다.
**윈도우에서 직접** 실행한다:

```bash
cd C:\Users\dudej\Desktop\Develop\Game\Toji

git add public/js/atlas.js public/js/world.js public/assets tools/shrink-assets.mjs .gitignore
git status                      # 553 M · 3 D · 새 파일 1 인지 눈으로 확인

git commit -m "perf(렌더·에셋): 원본 스프라이트 축소본 캐시 + 배포 에셋 1.1GB→83MB

- atlas.js scaled(): 1254px 원본을 매 프레임 60px 로 줄이던 것을 한 번만 굽고 재사용.
  줌 보간 때문에 8px 격자로 올림, 320장 상한. 건물·노드·울타리·장식 10곳 적용.
- 중복(assistant-made 859장·바이트 동일)·작업원본(source 127장) 제거.
- tools/shrink-assets.mjs 신설: 단일 그림은 320px, 시트는 정수 배수로만 축소
  (naturalWidth 를 4·5·6·8·16 으로 나눠 프레임을 집으므로 비율이 보존돼야 한다).

원본은 _to_delete/original-size/ 에 남겨 두었다."

git push
```

`public/**` 이 바뀌었으므로 **Pages 워크플로가 저절로 돈다**(`.github/workflows/pages.yml`).
Actions 탭에서 `Deploy client to GitHub Pages` 가 초록불인지 본다.

### 3-3. 디스크 비우기

`_to_delete/` 가 **2.8GB** 다. 3-1 확인이 끝났으면 윈도우 탐색기에서 통째로 지운다.
(Claude 쪽 마운트는 삭제 권한이 없어 옮기기만 했다.)

> **지우기 전에 3-1 을 반드시 먼저 한다.** 여기에 원본 550장이 들어 있다.

### 3-4. Railway 배포

여기서부터는 **`DEPLOY2_D2_실행.md` 를 그대로 따른다.** 요약만 적으면:

1. Railway → New Project → Deploy from GitHub repo → `dudejrtjdrp/regiond`
2. **볼륨** `/data` 를 붙이고 **`SAVES_DIR=/data/saves`** — 이게 없으면 재배포마다 세계가 사라진다
3. `NODE_ENV=production` · `PORT` 는 **넣지 않는다** · `HOST` 도 건드리지 않는다
4. Generate Domain → 나온 주소를 `public/index.html` 의 `GM.SERVER` 한 줄에 적고 push
5. 검증:
   ```bash
   npm run check:deploy -- --server https://<서버주소> --pages https://dudejrtjdrp.github.io/regiond/
   ```
6. 볼륨의 진짜 증명 — Railway 에서 **Restart** 시킨 뒤 `--resume check_...` 로 다시 두드린다

---

## 4. 남겨 둔 판단

### `.git` 1.5GB — 그대로 둔다

GitHub 공식 권장 상한은 **on-disk 10GB** 다(`.git` 기준). 1.5GB 는 한참 아래다.
히스토리를 다시 쓰면(`filter-repo`) 클론은 가벼워지지만 **공개 전환 직후에 force push** 를
해야 하고, `인수인계-배치5.md` 등이 참조하는 커밋 해시(`abc4b45` 등)가 전부 끊긴다.
잼 제출을 앞두고 치를 값이 아니다.

심사위원은 저장소를 클론하지 않고 Pages 링크로 논다. 클론 무게는 지금 문제가 아니다.

### 남은 9장의 시트

`autotile/*_47blob.png` 3장(1448×1086) · `characters/*/sheet.png` 6장(1370×1148).
두 변의 최대공약수가 2뿐이라 320px 이하로 떨어지는 정수 배수가 없다. 합쳐 18MB —
83MB 중 22% 다. 더 줄이려면 격자 규격을 먼저 확인하고 그 배수에 맞춰 다시 그려야 한다.
**지금 건드릴 만한 이득이 아니다.**

---

## 5. 막혔을 때

`DEPLOY2_D2_실행.md` §6 의 표가 Railway 쪽을 덮는다. 이번 배치에서 새로 생길 수 있는 것만:

| 증상 | 십중팔구 |
|---|---|
| 동물·적 애니메이션 프레임이 어긋난다 | 시트가 정수 배수로 안 줄었다 → `_to_delete/original-size/` 에서 그 파일만 되돌린다 |
| 건물이 너무 뭉개져 보인다 | `--max 320` 을 480 으로 올려 다시 돌린다(원본은 백업에 있다) |
| 에셋룸(`museum.html`)이 흐리다 | 의도한 맞바꿈이다. 진열용 원본이 필요하면 그 폴더만 백업에서 되돌린다 |
| 줌할 때 순간 끊긴다 | 축소본을 새로 굽는 중이다. 잦으면 `SCALED_MAX`(현재 320)를 올린다 |
