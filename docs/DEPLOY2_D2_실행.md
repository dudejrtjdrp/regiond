# D-2 실행 절차 — Railway 배포 + 검증 5단

D-1(`48281fc`)이 코드 쪽을 다 끝내 놓았다. 여기서는 **버튼을 누르는 순서**와 **막혔을 때 볼 곳**만 적는다.
끝나면 `https://dudejrtjdrp.github.io/regiond/` 가 살아 있는 서버에 붙는다.

> 준비물: GitHub 계정(저장소 `dudejrtjdrp/regiond`) · Railway 계정 · 카드 없이 되는 일회성 $5 크레딧
> 걸리는 시간: 손이 빠르면 40분, 처음이면 2시간.

---

## 0. 미리 알아 둘 것 두 가지

**① 방은 프로세스 안에 산다 — 서버는 한 대만 띄운다.**
월드가 메모리에 있고 스냅샷으로만 디스크에 앉는다. 복제본을 둘 이상 두면 같은 방이 두 군데서
따로 돌아 세이브가 서로를 덮는다. `railway.json` 의 `numReplicas: 1` 이 그 뜻이고, **올리지 말 것.**

**② 디스크가 없으면 세이브가 날아간다.**
Railway 컨테이너는 재배포마다 새로 만들어진다. **볼륨을 붙이고 `SAVES_DIR` 을 그 안으로** 보내야
방이 남는다(§2-2). 이걸 빼먹으면 검증 5단이 그 자리에서 잡아낸다.

---

## 1. Railway — 프로젝트 만들기

1. https://railway.app → **New Project** → **Deploy from GitHub repo** → `dudejrtjdrp/regiond`
2. 첫 빌드가 자동으로 돈다. `railway.json` 이 이미 저장소에 있어서 따로 설정할 게 없다:
   - 빌드 `npm ci --omit=dev` (jsdom·socket.io-client 는 검사용이라 서버엔 안 올린다)
   - 실행 `node server/index.js`
   - 헬스체크 `/api/health` — 200 이 떠야 배포가 초록불이 된다
   - Node 판은 `package.json` 의 `engines: >=22` 를 보고 알아서 고른다
3. 빌드가 `npm ci` 에서 멎으면 `package-lock.json` 이 어긋난 것이다 —
   로컬에서 `npm install` 한 번 돌려 락파일을 커밋하거나, `railway.json` 의 buildCommand 를
   `npm install --omit=dev` 로 바꾼다.

---

## 2. 붙일 것 둘 — 볼륨과 환경 변수

### 2-1. 볼륨 (이게 없으면 방이 안 남는다)

서비스 → **Settings → Volumes → New Volume**
- Mount path: **`/data`**
- 크기: 기본(5GB)이면 넉넉하다. 세이브 하나가 1.6MB 급이라 방 3,000개까지 버틴다.

### 2-2. 환경 변수

서비스 → **Variables**

| 이름 | 값 | 왜 |
|---|---|---|
| `SAVES_DIR` | `/data/saves` | **필수.** 볼륨 안에 세이브를 둔다. 없으면 재배포마다 세계가 사라진다 |
| `NODE_ENV` | `production` | 개발 뒷문(`/api/debug/*`)을 잠근다. 개발 패널도 스스로 접는다 |
| `GALLAEMALLAE_ORIGINS` | (선택) `https://내도메인` | Pages 말고 다른 주소에서도 부를 때. 쉼표로 여러 개 |
| `GALLAEMALLAE_METER` | (선택) `0` | 전송량 한 줄 로그를 끈다. **당분간은 켜 두는 게 이득이다**(§5) |
| `ANTHROPIC_API_KEY` | (선택) | 표현 계층을 템플릿 대신 Claude 로. 없으면 템플릿으로 돈다 |

`PORT` 는 **넣지 않는다** — Railway 가 꽂아 주는 값을 서버가 그대로 읽는다.
`HOST` 도 기본값 `0.0.0.0` 이라 손댈 필요가 없다(다른 값을 넣으면 헬스체크가 실패한다).

---

## 3. 주소를 알아내고, 클라에 그 한 줄을 적는다

1. 서비스 → **Settings → Networking → Generate Domain**
   → `https://<무언가>.up.railway.app` 이 나온다. 이게 **서버 주소**다.
2. 브라우저로 `https://<그주소>/api/health` 를 열어 `{"ok":true,...}` 가 보이는지 눈으로 확인.
3. `public/index.html` 의 **GM.SERVER 한 줄**을 그 주소로 고친다:

```js
return 'https://tojigame-production.up.railway.app';      // ★ D-2 에서 확정하면 이 줄만 고친다
```

4. 커밋 → push. `public/**` 이 바뀌었으므로 **Pages 워크플로가 저절로 돈다**.

> ★ 저장소 **Settings → Pages → Source** 를 `GitHub Actions` 로 한 번은 바꿔 둬야 한다(아직 안 했다면).
> Actions 탭에서 `Deploy client to GitHub Pages` 가 초록불인지 보고 넘어간다.

---

## 4. 검증 — 손이 아니라 명령으로

```bash
npm run check:deploy -- --server https://<서버주소> --pages https://dudejrtjdrp.github.io/regiond/
```
(`--` 를 빼먹으면 인자가 npm 에게 먹힌다.)

이 한 줄이 DEPLOY2 §4-5 의 다섯 단을 실제로 두드린다:

| 단 | 무엇을 보나 |
|---|---|
| 1 | Pages 가 index.html·js·css·`.nojekyll` 을 내주는가 · **GM.SERVER 가 지금 서버와 같은 주소인가** |
| 2 | `/api/health`·`/api/config` 200 · **화면과 서버의 규약 판번호가 같은가** |
| 3 | CORS — 허용 출처엔 머리글이 붙고 낯선 출처엔 안 붙는가 · OPTIONS 204 |
| 4 | 소켓이 붙고 **압축이 협상되는가** · 나무를 여덟 번 베어 목재가 오르는가 |
| 5 | 소켓을 끊고 다시 붙어 **같은 정착지로 돌아오는가** · 방 목록에 남는가 |

세 번째 줄이 빨간불이면 **주소를 고치고 push 를 안 한 것**이다(제일 흔한 실수라 일부러 잡아 둔다).

### 4-1. 볼륨의 진짜 증명 — 재시작을 한 번 시킨다

위 5단은 「프로세스가 안 죽었을 때」만 본다. 디스크가 진짜 영구인지는 이렇게 가른다:

1. 위 명령 끝에 찍힌 `--resume check_...` 줄을 복사해 둔다
2. Railway → **Deployments → ⋯ → Restart** (또는 아무 커밋이나 push)
3. 복사해 둔 명령을 그대로 실행:
```bash
npm run check:deploy -- --server https://<서버주소> --resume check_...
```
「그때 벤 목재가 디스크에서 살아 돌아왔다」가 초록이면 볼륨이 붙은 것이다.
빨간불이면 **`SAVES_DIR` 이 볼륨 밖을 가리키고 있다**(§2-2).

### 4-2. 마지막은 눈으로

- `https://dudejrtjdrp.github.io/regiond/?mock=1` — **서버 없이** 화면이 도는가.
  이게 심사위원이 서버가 죽어도 보게 되는 진열창이다.
- `https://dudejrtjdrp.github.io/regiond/` — 개척을 시작해 나무를 몇 번 베고, 창을 닫았다 다시 연다.

---

## 5. 띄운 다음 이틀 — 전송량만 본다

D-1 의 계측이 소켓이 닫힐 때마다 한 줄 찍는다. Railway 의 로그 창에서 이렇게 보인다:

```
[전송] AbC123... · 42초 · 보냄 613.2KB · 받음 0.4KB (압축 전)
```

로컬 실측으로 **접속 한 번에 512~722KB**(압축 전)였다. 압축이 켜졌으니 실제 선을 타는 양은
그 1/8~1/10 이어야 한다. Railway 의 **Usage** 화면 숫자와 이 로그를 견주면
「압축만으로 충분한가, Oracle 로 옮겨야 하는가」가 그 자리에서 갈린다(DEPLOY2 §2-3 2단계).

**넘겨짚지 말 것**: 제출 기간에 접속이 몇 명일지 모른다. 접속 한 번에 60~70KB 라면 $5 크레딧으로
넘치도록 남는다. 숫자를 보고 나서 옮겨도 늦지 않다 — 주소 한 줄이면 갈아탄다.

---

## 6. 막혔을 때

| 증상 | 십중팔구 |
|---|---|
| 배포는 됐는데 헬스체크가 빨간불 | `HOST` 를 손으로 넣었다 → 지운다(기본 `0.0.0.0`) |
| Pages 화면이 흰 채로 멎는다 | 콘솔을 본다. `/api/config` 가 CORS 로 막혔으면 `GALLAEMALLAE_ORIGINS` 에 그 출처를 넣는다 |
| `socket.io` 를 못 찾는다고 뜬다 | CDN 이 막힌 망이다. D-1 이 서버 사본으로 물러서게 해 뒀으니 **서버 주소가 맞는지**부터 본다 |
| 창을 닫았다 열면 새 정착지 | 볼륨이 없거나 `SAVES_DIR` 이 볼륨 밖이다(§2-2) |
| 재배포하니 방이 다 사라졌다 | 같은 원인 |
| 방이 두 개로 갈라진다 | 복제본이 2 이상이다 → `numReplicas: 1` |
| 빌드가 `npm ci` 에서 멎는다 | 락파일 어긋남 → `npm install` 후 커밋, 또는 buildCommand 를 `npm install --omit=dev` 로 |
| 빌드가 `npm ci --omit=dev` 에서 **EBUSY rmdir node_modules/.cache** 로 멎는다 | Nixpacks 가 설치 단계에서 이미 `npm ci` 를 돌린 뒤 buildCommand 가 **두 번째** `npm ci` 를 돌려 `node_modules` 를 지우려다 잠긴 것. buildCommand 를 **`npm prune --omit=dev`** 로 바꾼다(2026-08-10 실제로 겪음) |

---

## 7. 되돌리기

Railway 는 **Deployments** 목록에서 이전 배포를 눌러 즉시 되돌린다(볼륨은 그대로 남는다).
Pages 는 `public/index.html` 의 GM.SERVER 를 옛 주소로 되돌려 push 하면 5분 안에 갈아탄다 —
심사 기간에 서버 두 곳을 띄워 두고 한쪽이 죽으면 이 한 줄로 넘기는 이중화가 이래서 가능하다.

---

## 다음: D-3~D-5 (잼 후로 미뤄도 제출은 된다)

- **D-3** `server/db.js`(`node:sqlite` 내장) + 익명 재접속 토큰
- **D-4** 증표(복구 코드) + 로비 + 사람이 부를 수 있는 초대 코드(`달빛-여우-37`)
- **D-5** 무인 방 언로드 + `listGames()` 교체 — 지금은 방 목록 하나 만들려고 스냅샷을 전부 읽는다.
  방이 쌓이기 시작하면 여기가 제일 먼저 아파온다
