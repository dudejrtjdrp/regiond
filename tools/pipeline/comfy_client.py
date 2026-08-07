#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ComfyUI HTTP + WebSocket 클라이언트 (2026-08 기준 현행 API).

엔드포인트 (출처: https://docs.comfy.org/development/comfyui-server/api-examples,
ComfyUI/script_examples/websockets_api_example.py)
  POST /prompt                {"prompt": <API포맷 워크플로우>, "client_id": "<uuid>"} → {"prompt_id": ...}
  GET  /history/{prompt_id}   → {"<prompt_id>": {"outputs": {"<node>": {"images": [{filename, subfolder, type}]}}}}
  GET  /view?filename=&subfolder=&type=  → PNG 바이트
  WS   /ws?clientId=<uuid>    → {"type":"executing","data":{"node":null,"prompt_id":...}} 이면 완료
  GET  /system_stats          → 접속·VRAM 확인
  GET  /object_info/<class>   → 설치된 체크포인트/LoRA 목록 확인

「왜」 폴링 대신 websocket을 쓰는 이유: 1024px SDXL 4장이면 수 분이라 진행률을 사람에게 보여줘야 한다.
"""

from __future__ import annotations

import json
import time
import uuid
from urllib.parse import urlencode, urlparse

import requests
import websocket


class ComfyError(RuntimeError):
    """사용자에게 그대로 보여줄 한국어 오류."""


CONNECT_HINT = (
    "ComfyUI가 응답하지 않습니다 — 실행 여부와 포트 8188을 확인하세요.\n"
    "점검 순서:\n"
    "  1. ComfyUI portable 폴더의 run_nvidia_gpu.bat 를 실행했는지\n"
    "  2. 브라우저에서 해당 주소가 열리는지\n"
    "  3. tools/pipeline/config.json 의 comfyUrl 이 실제 포트와 같은지\n"
    "  4. 방화벽/백신이 로컬 포트를 막고 있지 않은지"
)


class ComfyClient:
    """ComfyUI 한 대와 대화하는 얇은 클라이언트."""

    def __init__(self, base_url: str, timeout: int = 600, connect_timeout: int = 5):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.connect_timeout = connect_timeout
        self.client_id = str(uuid.uuid4())
        self._ws: websocket.WebSocket | None = None

    # ------------------------------------------------------------ 접속 확인

    def system_stats(self) -> dict:
        """접속 확인 겸 VRAM 조회. 실패하면 한국어 안내로 바꿔 던진다."""
        try:
            res = requests.get(f"{self.base}/system_stats", timeout=self.connect_timeout)
            res.raise_for_status()
            return res.json()
        except requests.RequestException as err:
            raise ComfyError(f"{CONNECT_HINT}\n원인: {err}") from err

    def available(self, class_type: str, input_name: str) -> list[str]:
        """/object_info로 설치된 모델 목록을 읽어 워크플로우의 파일명을 사전 검증한다."""
        try:
            res = requests.get(f"{self.base}/object_info/{class_type}", timeout=self.connect_timeout)
            res.raise_for_status()
            spec = res.json()[class_type]["input"]["required"][input_name][0]
            return list(spec)
        except (requests.RequestException, KeyError, IndexError, TypeError):
            return []

    # ------------------------------------------------------------ 큐잉/대기

    def queue(self, workflow: dict) -> str:
        """워크플로우를 큐에 넣고 prompt_id를 돌려준다."""
        payload = {"prompt": workflow, "client_id": self.client_id}
        try:
            res = requests.post(f"{self.base}/prompt", json=payload, timeout=self.connect_timeout * 4)
        except requests.RequestException as err:
            raise ComfyError(f"{CONNECT_HINT}\n원인: {err}") from err
        if res.status_code != 200:
            raise ComfyError(_queue_error(res))
        return res.json()["prompt_id"]

    def connect_ws(self) -> None:
        """진행 이벤트를 받을 websocket을 연다. 실패해도 폴링으로 대체할 수 있게 표시만 한다."""
        url = _ws_url(self.base, self.client_id)
        try:
            self._ws = websocket.WebSocket()
            self._ws.connect(url, timeout=self.connect_timeout)
        except Exception as err:  # noqa: BLE001 — websocket 예외 종류가 버전마다 다르다
            self._ws = None
            raise ComfyError(f"ComfyUI websocket 연결에 실패했습니다 ({url})\n원인: {err}") from err

    def wait(self, prompt_id: str, on_progress=None) -> None:
        """해당 prompt가 끝날 때까지 기다린다. 타임아웃은 한국어로 알린다."""
        if self._ws is None:
            self.connect_ws()
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            if self._pump(prompt_id, on_progress):
                return
        raise ComfyError(
            f"생성이 {self.timeout}초 안에 끝나지 않았습니다 (prompt_id={prompt_id}) — "
            "ComfyUI 콘솔에서 진행 상황과 VRAM 부족(OOM) 여부를 확인하세요."
        )

    def _pump(self, prompt_id: str, on_progress) -> bool:
        """메시지 한 건을 처리하고 '완료됐는지'를 돌려준다."""
        message = self._recv()
        if message is None:
            return self._history_says_done(prompt_id)
        return _handle_event(message, prompt_id, on_progress)

    def _recv(self) -> dict | None:
        try:
            self._ws.settimeout(5)
            raw = self._ws.recv()
        except websocket.WebSocketTimeoutException:
            return None
        except Exception as err:  # noqa: BLE001
            raise ComfyError(f"ComfyUI websocket이 끊겼습니다 — ComfyUI 콘솔의 오류를 확인하세요.\n원인: {err}") from err
        if isinstance(raw, bytes):
            return None  # 「왜」 바이너리 프레임은 미리보기 이미지라 무시한다.
        return json.loads(raw)

    def _history_says_done(self, prompt_id: str) -> bool:
        """websocket 침묵이 길어져도 /history에 결과가 있으면 완료로 본다(이벤트 유실 대비)."""
        return bool(self.history(prompt_id).get("outputs"))

    # ------------------------------------------------------------ 결과 회수

    def history(self, prompt_id: str) -> dict:
        try:
            res = requests.get(f"{self.base}/history/{prompt_id}", timeout=self.connect_timeout * 2)
            res.raise_for_status()
            return res.json().get(prompt_id, {})
        except requests.RequestException as err:
            raise ComfyError(f"실행 이력을 읽지 못했습니다 (prompt_id={prompt_id})\n원인: {err}") from err

    def images(self, prompt_id: str) -> list[bytes]:
        """SaveImage 노드가 남긴 PNG를 순서대로 내려받는다."""
        outputs = self.history(prompt_id).get("outputs", {})
        refs = [ref for node in outputs.values() for ref in node.get("images", [])]
        if not refs:
            raise ComfyError(
                f"결과 이미지를 찾지 못했습니다 (prompt_id={prompt_id}) — "
                "워크플로우에 SaveImage 노드가 있는지, ComfyUI 콘솔에 오류가 없는지 확인하세요."
            )
        return [self.view(ref) for ref in refs if ref.get("type") != "temp"]

    def view(self, ref: dict) -> bytes:
        query = urlencode({"filename": ref["filename"], "subfolder": ref.get("subfolder", ""),
                           "type": ref.get("type", "output")})
        try:
            res = requests.get(f"{self.base}/view?{query}", timeout=self.connect_timeout * 6)
            res.raise_for_status()
            return res.content
        except requests.RequestException as err:
            raise ComfyError(f"이미지를 내려받지 못했습니다 ({ref.get('filename')})\n원인: {err}") from err

    def close(self) -> None:
        if self._ws is not None:
            self._ws.close()
            self._ws = None


# ------------------------------------------------------------------ 순수 함수

def _ws_url(base: str, client_id: str) -> str:
    parsed = urlparse(base)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return f"{scheme}://{parsed.netloc}/ws?clientId={client_id}"


def _handle_event(message: dict, prompt_id: str, on_progress) -> bool:
    """'executing' 이벤트의 node가 null이면 그 prompt는 끝난 것이다(공식 예제와 동일)."""
    kind = message.get("type")
    data = message.get("data", {})
    if kind == "execution_error" and data.get("prompt_id") == prompt_id:
        raise ComfyError(_execution_error(data))
    if kind == "progress" and on_progress:
        on_progress(data.get("value", 0), data.get("max", 0))
    return kind == "executing" and data.get("node") is None and data.get("prompt_id") == prompt_id


def _queue_error(res) -> str:
    """/prompt 400 응답의 node_errors를 사람이 읽을 수 있게 편다."""
    body = _safe_json(res)
    lines = [f"ComfyUI가 워크플로우를 거절했습니다 (HTTP {res.status_code}).",
             f"메시지: {body.get('error', {}).get('message', res.text[:300])}"]
    for node_id, err in (body.get("node_errors") or {}).items():
        lines.append(f"  - 노드 {node_id}: {_node_error_text(err)}")
    lines.append("모델 파일명(checkpoint/lora/vae)이 config.json과 실제 설치본이 같은지 확인하세요.")
    return "\n".join(lines)


def _node_error_text(err: dict) -> str:
    errors = err.get("errors") or []
    return "; ".join(f"{e.get('message')} ({e.get('details')})" for e in errors) or json.dumps(err, ensure_ascii=False)


def _execution_error(data: dict) -> str:
    return (f"ComfyUI 실행 중 오류 — 노드 {data.get('node_id')} ({data.get('node_type')}): "
            f"{data.get('exception_message')}\nComfyUI 콘솔의 전체 트레이스를 확인하세요.")


def _safe_json(res) -> dict:
    try:
        return res.json()
    except ValueError:
        return {}
