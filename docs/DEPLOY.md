# 배포 안내 — 갈래말래를 인터넷에 올리기 (Render 무료)

이 문서는 **깃허브도 배포도 처음 해 보는 사람** 기준으로 썼다.
회색 상자 안의 명령은 **그대로 복사해서 붙여 넣으면** 된다 (⌐ 표시가 있는 곳만 자기 값으로 바꾼다).

끝나면 `https://이름.onrender.com` 같은 주소가 하나 생기고, 그 주소를 아는 사람은 누구나
브라우저로 들어와 같이 놀 수 있다. **돈은 들지 않는다.**

전체 소요: **15~20분** (그중 절반은 Render 가 알아서 하는 걸 기다리는 시간)

---

## 0. 준비물

| 필요한 것 | 확인 방법 |
|---|---|
| **Git** | PowerShell 에서 `git --version` → 버전이 나오면 OK. 없으면 <https://git-scm.com/download/win> 에서 설치(전부 [Next]) |
| **GitHub 계정** | <https://github.com> 에서 무료 가입 |
| **Render 계정** | 3단계에서 만든다. GitHub 계정으로 바로 로그인할 수 있다 |

> 코드는 이미 **커밋까지 끝나 있다.** 1·2단계는 "내 컴퓨터에 있는 그 커밋을 깃허브로 밀어 올리는" 일이다.

**PowerShell 여는 법**: 시작 버튼 → `powershell` 입력 → [Windows PowerShell] 실행.
아래 명령들은 전부 **프로젝트 폴더 안에서** 실행한다. 먼저 이 한 줄로 폴더에 들어간다.

```powershell
cd C:\Users\dudej\Desktop\Develop\Game\Toji
```

---

## 1. 깃허브에 빈 저장소 만들기

1. <https://github.com/new> 로 간다 (로그인 필요).
2. **Repository name** 칸에 `gallaemallae` 를 넣는다. (다른 이름도 상관없다)
3. **Public**(누구나 코드 열람 가능) 또는 **Private**(나만) 중 아무거나 고른다.
   → Render 무료 플랜은 둘 다 배포할 수 있다.
4. 아래 세 개는 **체크하지 않는다** (이미 우리 쪽에 파일이 있어서 충돌한다):
   - ☐ Add a README file
   - ☐ Add .gitignore
   - ☐ Choose a license
5. 초록색 **[Create repository]** 버튼을 누른다.

그러면 "…or push an existing repository from the command line" 이라는 안내가 있는 화면이 나온다.
거기 적힌 주소(`https://github.com/…/gallaemallae.git`)를 다음 단계에서 쓴다.

---

## 2. 코드 밀어 올리기 (push)

PowerShell 에 아래를 **한 줄씩** 붙여 넣는다.

```powershell
cd C:\Users\dudej\Desktop\Develop\Game\Toji
git remote add origin https://github.com/⌐내아이디/gallaemallae.git
git branch -M main
git push -u origin main
```

- `⌐내아이디` 는 자기 깃허브 아이디로 바꾼다. (1단계 화면에 나온 주소를 그대로 복사해 붙이는 게 가장 안전하다)
- 처음 push 할 때 **로그인 창**이 뜬다 → [Sign in with your browser] 를 눌러 브라우저에서 승인하면 끝난다.

성공하면 마지막 줄에 `branch 'main' set up to track 'origin/main'` 비슷한 말이 나온다.
깃허브 저장소 페이지를 새로고침하면 파일들이 올라와 있다.

<details>
<summary>⚠ 이미 remote 가 있다고 나오면 (<code>remote origin already exists</code>)</summary>

```powershell
git remote set-url origin https://github.com/⌐내아이디/gallaemallae.git
git push -u origin main
```
</details>

<details>
<summary>⚠ <code>rejected … fetch first</code> 라고 거절당하면</summary>

1단계에서 README 체크를 실수로 켠 경우다. 저장소를 지우고 다시 만드는 게 가장 깔끔하고,
그게 싫으면 아래 한 줄(깃허브 쪽 내용을 우리 것으로 덮어쓴다):

```powershell
git push -u origin main --force
```
</details>

---

## 3. Render 에 올리기

1. <https://render.com> → 우측 상단 **[Get Started]** / **[Sign In]**.
2. **[GitHub]** 으로 가입·로그인한다.
3. 처음이라면 Render 가 "어느 저장소를 볼 수 있게 할까?" 하고 묻는다
   → **[Only select repositories]** 에서 방금 만든 `gallaemallae` 를 고르고 **[Install]**.
4. 대시보드에서 우측 상단 **[+ New]** → **[Blueprint]** 를 고른다.
   > 이 저장소 안에는 **`render.yaml`** 이라는 설계도가 들어 있다.
   > Blueprint 로 만들면 요금제·빌드 명령·헬스체크·환경변수가 **전부 자동으로** 채워진다.
   > (메뉴에 Blueprint 가 안 보이면 **[+ New] → [Web Service]** 를 골라도 된다. 4-B 참고)
5. 저장소 목록에서 `gallaemallae` 옆 **[Connect]**.
6. **Blueprint Name** 은 아무거나(예: `gallaemallae`) → **[Apply]** / **[Create]**.
7. 몇 분 기다린다. 로그 화면이 흐르다가 상태가 **`Live`** (초록색)로 바뀌면 끝.

**4-B. Blueprint 대신 Web Service 로 직접 만들 때** — 아래만 채우면 된다.

| 칸 | 넣을 값 |
|---|---|
| Language / Runtime | `Node` |
| Branch | `main` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | **Free** |
| Health Check Path | `/api/health` |
| Environment Variables | `NODE_ENV` = `production` |

---

## 4. 잘 떴는지 확인하기

서비스 페이지 맨 위에 주소가 있다: `https://gallaemallae-xxxx.onrender.com`

1. **살아 있나** — 주소 뒤에 `/api/health` 를 붙여 들어간다.
   `{"ok":true,"protocol":"3.1", …}` 같은 글자가 보이면 서버가 살아 있는 것이다.
2. **게임이 되나** — 주소를 그대로 열면 마차 도착 오프닝 → 캐릭터 만들기 → 정착지 화면.
   나무를 몇 번 베어 목재가 오르면 서버와 화면이 제대로 이야기하고 있는 것이다.
3. **같이 놀기** — 이 주소를 친구에게 보내면 된다. 같은 정착지에 들어가려면
   화면 안의 **초대 코드(문장 번호)** 를 알려 주면 된다.

---

## 5. 무료 플랜에서 꼭 알아야 할 두 가지

### ① 15분 아무도 안 오면 잠든다

무료 서비스는 **15분간 접속이 없으면 잠긴다.** 그 뒤 첫 손님은
**깨어나기를 30초~1분쯤 기다려야** 한다(화면이 하얗게 멈춘 것처럼 보일 수 있다. 고장이 아니다).
한 번 깨어나면 그 뒤부터는 평소 속도다.

> **발표·시연 전에는 5분쯤 전에 미리 한 번 주소를 열어 두면** 깨어난 상태로 맞이할 수 있다.

### ② 서버가 다시 뜨면 세이브가 사라진다

무료 플랜은 **디스크가 휘발성**이다. 배포·재시작·슬립 복귀로 컨테이너가 새로 뜨면
`saves/` 폴더는 **빈 채로 시작한다** — 즉 진행하던 정착지가 초기화된다.
지금 배포는 **테스트·시연용**으로 보면 된다.

**진행을 남기고 싶다면** (나중에 결정해도 된다):

1. Render 대시보드 → 서비스 → **Settings → Instance Type** 을 유료(Starter)로 올린다.
2. **Disks → [Add Disk]** — Mount Path 를 `/var/data` 로 잡는다.
3. **Environment → [Add Environment Variable]** 에 `SAVES_DIR` = `/var/data/saves` 를 넣는다.
4. 저장하면 자동으로 다시 뜬다. 이때부터 세이브가 재시작을 견딘다.
   (`render.yaml` 에 주석으로 같은 내용이 적혀 있다 — 주석만 풀면 된다)

### 그 밖의 무료 플랜 성질

- 매달 인스턴스 시간 750시간이 무료다. 서비스 하나면 늘 무료 범위 안이다.
- CPU·메모리가 넉넉하지 않다. 한 정착지에 여럿이 붙는 정도는 충분하지만, 수십 명 동시 접속은 버겁다.
- 주소는 `onrender.com` 하위 도메인이다. 내 도메인을 붙이는 것도 무료 플랜에서 된다(Settings → Custom Domains).

---

## 6. 고친 내용을 다시 올리기 (업데이트)

깃허브에 push 하기만 하면 **Render 가 알아서 다시 배포한다** (`autoDeploy: true`).

```powershell
cd C:\Users\dudej\Desktop\Develop\Game\Toji
git add -A
git commit -m "무엇을 고쳤는지 한 줄로"
git push
```

push 하고 2~4분 뒤 새 버전이 뜬다. Render 대시보드의 **Events** 칸에서 진행 상황이 보인다.
배포가 도는 동안에도 **예전 버전이 계속 서비스**되고, 새 버전이 헬스체크를 통과한 뒤에 교체된다.

> 올리기 전에 내 컴퓨터에서 한 번 확인하고 싶다면:
> ```powershell
> npm test        # 회귀 테스트
> npm start       # http://localhost:3000
> ```

---

## 7. 문제가 생겼을 때

### 로그 보는 법 (거의 모든 답이 여기 있다)

Render 대시보드 → 서비스 이름 클릭 → 왼쪽 **[Logs]**.
실시간으로 서버가 하는 말이 흐른다. 정상이면 뜰 때 이렇게 찍힌다.

```
갈래말래 v1.0.0 · 규약 v3.1 — http://localhost:10000 (bind 0.0.0.0:10000, production)
  1게임일 600s · 전투 서브틱 0.25s · 월드 256×256
  저장 /opt/render/project/src/saves · 뒷문 잠김 · 표현 템플릿 전용
```

| 증상 | 원인과 해결 |
|---|---|
| **배포가 `Build failed`** | Logs 맨 아래 빨간 줄을 본다. 대개 `npm install` 실패 — `package.json`·`package-lock.json` 이 같이 커밋됐는지 확인 |
| **`Deploy failed` / 헬스체크 실패** | 서버가 뜨자마자 죽은 것이다. Logs 에서 `Error` 줄을 찾는다. 포트를 손으로 정하지 말 것 — `PORT` 는 Render 가 준다 |
| **첫 접속이 30초 넘게 걸린다** | 정상이다(5-① 슬립). 두 번째부터 빠르다 |
| **어제 하던 정착지가 없다** | 정상이다(5-② 휘발성 디스크). 남기려면 영구 디스크를 붙인다 |
| **화면에 "서버가 낡았습니다"** | 브라우저가 옛 파일을 물고 있는 것이다. `Ctrl+Shift+R` 로 강력 새로고침 |
| **연결이 자꾸 끊긴다** | 슬립 직전이거나 회사·학교 방화벽이 웹소켓을 막는 경우다. socket.io 가 자동으로 폴링으로 갈아타니 조금 느려질 뿐 놀 수는 있다 |
| **`Ctrl+\`` 개발 패널이 안 열린다** | **의도된 동작이다.** 운영 배포에서는 `/api/debug/*` 를 잠가 두었고, 패널은 조용히 스스로 접힌다 |

### 개발 뒷문을 잠깐 열어야 한다면

시연 중 하루를 빨리 넘기거나 전투를 즉시 끝내야 할 때가 있다.
Render → **Environment** → `DEBUG_API` = `1` 을 추가하면 `/api/debug/*` 와 `Ctrl+\`` 패널이 다시 열린다.
**끝나면 반드시 지운다.** 아무나 시간을 조작할 수 있게 되기 때문이다.

### 서비스 껐다 켜기

Render → 서비스 → 우측 상단 **[Manual Deploy] → [Clear build cache & deploy]**.
껍데기부터 새로 짓는다. 원인을 모를 때 한 번쯤 눌러 볼 만하다.

---

## 8. 환경변수 정리표

| 이름 | 기본값 | 무엇을 하나 |
|---|---|---|
| `PORT` | `3000` | 서버가 열 문 번호. **Render 가 자동으로 넣어 준다 — 건드리지 않는다** |
| `HOST` | `0.0.0.0` | 바인딩 주소. 컨테이너 배포에서는 반드시 `0.0.0.0` (기본값 그대로 두면 된다) |
| `NODE_ENV` | (없음) | `production` 이면 개발 뒷문을 잠근다. `render.yaml` 이 자동으로 넣는다 |
| `DEBUG_API` | (없음) | `1` = 운영에서도 `/api/debug/*` 강제 개방, `0` = 개발에서도 차단 |
| `SAVES_DIR` | `<프로젝트>/saves` | 세이브 폴더. 영구 디스크를 붙였을 때 그 마운트 경로를 준다 |
| `ANTHROPIC_API_KEY` | (없음) | 있으면 사건 문장을 Claude 가 윤색한다. 없으면 템플릿 문장만 쓴다(게임은 똑같이 돌아간다) |

> `ANTHROPIC_API_KEY` 같은 비밀 값은 **코드에 적지 말고** Render 의 Environment 칸에만 넣는다.
> `.gitignore` 가 `.env` 를 막아 두긴 했지만, 애초에 파일로 만들지 않는 편이 안전하다.
