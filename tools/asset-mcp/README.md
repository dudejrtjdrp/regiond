# toji-assets MCP 서버

갈래말래(Toji) 에셋 파이프라인을 Claude Code에서 바로 부르기 위한 MCP 서버다.
Node 22 ESM · **외부 의존성 0** (stdio 위에서 JSON-RPC 2.0을 직접 구현).

## 등록

프로젝트 루트에 `.mcp.json`이 이미 들어 있어 **Claude Code가 자동으로 인식**한다.

```json
{ "mcpServers": { "toji-assets": { "command": "node", "args": ["tools/asset-mcp/server.mjs"] } } }
```

- 프로젝트 루트에서 `claude`를 실행하면 첫 기동 때 "이 프로젝트의 MCP 서버를 신뢰하시겠습니까?"가 뜬다 → 승인.
- 자동 인식이 안 되면 수동 등록: `claude mcp add toji-assets -- node tools/asset-mcp/server.mjs`
- 확인: Claude Code 안에서 `/mcp` → `toji-assets`가 connected 상태여야 한다.
- 직접 확인하고 싶으면 프로젝트 루트에서:
  `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node tools/asset-mcp/server.mjs`

작업 디렉토리는 서버가 **자기 파일 위치 기준으로 프로젝트 루트를 계산**하므로(`tools/asset-mcp/`의 두 단계 위),
Claude Code를 어디서 띄우든 `python tools/pipeline/*.py`가 올바른 위치에서 실행된다.

## 도구 5종

| 도구 | 인자 | 하는 일 |
|---|---|---|
| `generate_asset` | `id, name, desc, category` (필수) / `grade, candidates, size, workflow` | `tools/pipeline/generate.py`를 실행하고, 출력 요약 + manifest 등록 결과 + 생성 파일 경로 + QA 결과를 돌려준다. 타임아웃 10분 |
| `list_assets` | `category?` | `public/assets/manifest.json`을 읽어 개수·QA 집계·`id \| 이름 \| 등급 \| QA` 목록 |
| `qa_asset` | `id` | `tools/pipeline/qa.py --id <id>` 단독 실행 결과 |
| `apply_size_overrides` | `json` | 박물관이 내보낸 `size-overrides.json`을 manifest의 `scale/offsetX/offsetY`에 반영(임시파일 후 rename = 원자적 쓰기). 없는 id는 경고로 보고 |
| `comfy_status` | 없음 | `config.json`의 `comfyUrl`로 `GET /system_stats` → 버전·Python·VRAM 요약 |

사용 예 (Claude Code 대화에서):

- "고블린 전사 에셋 만들어줘" → `generate_asset {id:"monster/goblin_warrior", name:"고블린 전사", desc:"small hunched goblin warrior, rusty sword, leather scraps", category:"monster", grade:"common", candidates:4}`
- 박물관에서 사이즈를 조정한 뒤 "JSON 내보내기"로 복사한 내용을 그대로 붙여넣기 → `apply_size_overrides`

`generate_asset`은 파이썬이 0이 아닌 코드로 끝나면 실패로 처리하고, 그때도 stdout/stderr 꼬리를 함께 보여준다.

## 문제 해결

| 증상 | 원인·조치 |
|---|---|
| `/mcp`에 안 보임 / failed | 프로젝트 루트에서 Claude Code를 실행했는지, `.mcp.json` 신뢰 프롬프트를 승인했는지 확인. `node --version`이 22 이상이어야 한다 |
| "Python을 실행하지 못했습니다" | `python`이 PATH에 없고 `py -3`도 없다. Python 3.10+ 설치 시 "Add to PATH" 체크. 서버는 `python` → 실패 시 `py -3` 순으로 자동 재시도한다 |
| "ComfyUI가 응답하지 않습니다" | ComfyUI portable(`run_nvidia_gpu.bat`)이 떠 있는지, 브라우저에서 `http://127.0.0.1:8188`이 열리는지, `tools/pipeline/config.json`의 `comfyUrl` 포트가 맞는지 확인 |
| "manifest.json을(를) 읽지 못했습니다" | 아직 등록된 에셋이 없다. `generate_asset`을 한 번 돌리거나 `public/assets/manifest.json` 스켈레톤을 만든다 |
| "시간 초과로 프로세스를 강제 종료했습니다" | 후보 장수를 줄이거나(`candidates`) ComfyUI 큐를 비운다. 상한은 10분 |
| 한글이 깨져 보임 | 서버가 하위 파이썬에 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`을 넣어준다. 그래도 깨지면 파이썬 쪽에서 파일을 UTF-8로 열고 있는지 확인 |
| 서버가 이상하다 | 진단 로그는 전부 **stderr**로 나간다(stdout은 JSON-RPC 전용). Claude Code의 MCP 로그에서 `[toji-assets]` 줄을 확인 |

## 설계 메모

- 프로토콜: `initialize`(요청한 protocolVersion 에코, 없으면 `2024-11-05`) · `ping` · `tools/list` · `tools/call`. id 없는 메시지(`notifications/*`)는 무시하고, 모르는 메서드는 `-32601`, 깨진 JSON은 `-32700`으로 답한다.
- 깨진 입력·도구 실패로 프로세스가 죽지 않는다. 도구 오류는 JSON-RPC 에러가 아니라 `isError: true`인 텍스트 결과로 돌려주어 Claude가 내용을 읽고 다음 행동을 정할 수 있게 한다.
- 모든 에러 문구는 한국어이며, 원인과 다음 조치를 함께 적는다.
