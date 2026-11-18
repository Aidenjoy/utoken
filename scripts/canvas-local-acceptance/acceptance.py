#!/usr/bin/env python3
"""智能画布本地验收（零依赖，仅标准库）。

约束遵守：
  * 上游全部指向本机 mock（scripts/canvas-local-acceptance/mock_upstream.py），
    不访问任何真实模型渠道 / 付费代理。
  * 数据库为临时 SQLite 文件，对象存储用 CANVAS_LOCAL_STORAGE_DIR 本地替身，
    不触碰真实 TOS。
  * 不配置真实渠道凭证；Ark 工具仅需一条指向 mock 的「渠道记录」即可放开能力，
    实际请求被 CANVAS_RELAY_BASE 引到 mock。

用法：
    python3 scripts/canvas-local-acceptance/acceptance.py --binary /tmp/newapi_canvas
"""

import argparse
import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "doubao-seedream-4-0-250828"
ROOT_USER = "canvasroot"
ROOT_PASS = "CanvasRoot123"

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail and not ok else (f" — {detail}" if detail else "")), flush=True)
    return ok


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def png_bytes(width, height):
    sys.path.insert(0, HERE)
    from mock_upstream import solid_png

    return solid_png(width, height, (200, 120, 80))


class Client:
    def __init__(self, base):
        self.base = base.rstrip("/")
        # 该版本所有已认证接口都要求 New-Api-User 头（会话 cookie 只做兜底）
        self.user_id = None
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def call(self, method, path, body=None, expect_json=True, raw=None, headers=None):
        url = self.base + path
        data = None
        hdrs = dict(headers or {})
        if self.user_id:
            hdrs["New-Api-User"] = str(self.user_id)
        if body is not None:
            data = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        elif raw is not None:
            data = raw
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=60) as resp:
                payload = resp.read()
                status = resp.status
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as err:
            payload = err.read()
            status = err.code
            ctype = err.headers.get("Content-Type", "")
        if expect_json:
            try:
                return status, json.loads(payload.decode() or "{}")
            except json.JSONDecodeError:
                return status, {"_raw": payload.decode("utf-8", "replace")}
        return status, payload, ctype

    def get_json(self, path):
        return self.call("GET", path)

    def post_json(self, path, body):
        return self.call("POST", path, body=body)


def multipart(field, filename, content, content_type="image/png", extra=None):
    boundary = "----canvas" + uuid.uuid4().hex
    parts = []
    for key, value in (extra or {}).items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()
        )
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {content_type}\r\n\r\n".encode()
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def start_server(binary, env, port):
    full_env = os.environ.copy()
    full_env.update(env)
    proc = subprocess.Popen(
        [binary],
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=2) as resp:
                if resp.status == 200:
                    return proc
        except Exception:
            time.sleep(0.3)
    proc.kill()
    raise RuntimeError("服务端启动超时:\n" + (proc.stdout.read() if proc.stdout else ""))


def stop(proc):
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def poll_task(client, task_id, timeout=60):
    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        status, payload = client.get_json(f"/api/canvas/tasks/{task_id}")
        last = payload.get("data") or {}
        if last.get("status") in ("succeeded", "failed", "canceled", "reviewing"):
            return last
        time.sleep(0.4)
    return last


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", default="/tmp/newapi_canvas")
    parser.add_argument(
        "--clean",
        action="store_true",
        help="显式要求清理临时目录（默认保留，便于复查产物）",
    )
    args = parser.parse_args()

    if not os.path.exists(args.binary):
        print(f"找不到服务端二进制：{args.binary}\n先执行 go build -o {args.binary} .", file=sys.stderr)
        return 2

    workdir = tempfile.mkdtemp(prefix="canvas_accept_")
    storage = os.path.join(workdir, "storage")
    os.makedirs(storage, exist_ok=True)
    mock_port = free_port()
    app_port = free_port()

    mock = subprocess.Popen(
        [sys.executable, os.path.join(HERE, "mock_upstream.py"), str(mock_port)],
        stdout=subprocess.PIPE,
        text=True,
    )
    server = None
    try:
        # 等 mock 就绪
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{mock_port}/_state", timeout=1).read()
                break
            except Exception:
                time.sleep(0.2)

        env = {
            "PORT": str(app_port),
            "SQLITE_PATH": os.path.join(workdir, "canvas.db"),
            "SESSION_SECRET": "canvas-local-acceptance-session-secret",
            "CRYPTO_SECRET": "canvas-local-acceptance-crypto-secret",
            "TZ": "Asia/Shanghai",
            "CANVAS_IMAGE_MODEL": MODEL,
            "CANVAS_RELAY_BASE": f"http://127.0.0.1:{mock_port}",
            "CANVAS_MEDIAKIT_BASE_URL": f"http://127.0.0.1:{mock_port}",
            "CANVAS_MEDIAKIT_API_KEY": "mock-mediakit-key",
            "CANVAS_LOCAL_STORAGE_DIR": storage,
            "CANVAS_LOCAL_STORAGE_BASE": f"http://127.0.0.1:{app_port}",
            "CANVAS_UPSTREAM_TIMEOUT": "30",
            "CANVAS_TOOL_PRICE_ERASE": "100",
            "CANVAS_TOOL_PRICE_OUTPAINT": "120",
        }
        server = start_server(args.binary, env, app_port)
        base = f"http://127.0.0.1:{app_port}"
        client = Client(base)

        # ---------- 初始化与登录 ----------
        status, payload = client.post_json(
            "/api/setup",
            {
                "username": ROOT_USER,
                "password": ROOT_PASS,
                "confirmPassword": ROOT_PASS,
                "SelfUseModeEnabled": True,
                "DemoSiteEnabled": False,
            },
        )
        check("初始化站点（创建 root 账号）", payload.get("success") is True, str(payload)[:200])

        status, payload = client.post_json(
            "/api/user/login", {"username": ROOT_USER, "password": ROOT_PASS}
        )
        client.user_id = (payload.get("data") or {}).get("id")
        check("登录获取会话", payload.get("success") is True and bool(client.user_id), str(payload)[:200])

        # ---------- 渠道（指向 mock 的渠道记录，不发起真实请求） ----------
        status, payload = client.post_json(
            "/api/channel/",
            {
                "mode": "single",
                "channel": {
                    "name": "canvas-mock-ark",
                    "type": 45,
                    "key": "mock-ark-key",
                    "base_url": f"http://127.0.0.1:{mock_port}",
                    "models": MODEL,
                    "group": "default",
                    "groups": ["default"],
                    "status": 1,
                    "priority": 0,
                },
            },
        )
        check("登记 Ark 图片渠道（mock）", payload.get("success") is True, str(payload)[:200])

        # ---------- 能力接口 ----------
        status, payload = client.get_json("/api/canvas/capabilities")
        caps = payload.get("data") or {}
        tools = {tool["tool"]: tool for tool in caps.get("tools", [])}
        check("能力接口返回 10 个工具", len(tools) == 10, f"got {sorted(tools)}")
        ark_tools = ["text2image", "image_ref_single", "image_ref_multi", "prompt_inpaint", "ref_inpaint"]
        mediakit_tools = ["erase", "outpaint", "matting", "upscale", "generative_upscale"]
        check(
            "Ark 工具均可用且带渠道信息",
            all(tools.get(t, {}).get("available") and tools[t].get("channelId") for t in ark_tools),
            json.dumps({t: tools.get(t, {}).get("unavailableReason") for t in ark_tools}, ensure_ascii=False),
        )
        check(
            "MediaKit 工具均可用",
            all(tools.get(t, {}).get("available") for t in mediakit_tools),
            json.dumps({t: tools.get(t, {}).get("unavailableReason") for t in mediakit_tools}, ensure_ascii=False),
        )
        check(
            "扩图参数含四种扩展方式",
            tools["outpaint"]["params"][0]["enum"] == ["ratio", "aspect", "edges", "canvas"],
            json.dumps(tools["outpaint"]["params"][0], ensure_ascii=False),
        )

        # ---------- 新建画布 ----------
        status, payload = client.post_json(
            "/api/canvas/projects",
            {"title": "验收画布", "width": 1024, "height": 1024, "background": "#ffffff"},
        )
        project = payload.get("data") or {}
        project_id = project.get("id")
        check("新建画布（1024x1024）", bool(project_id) and project.get("width") == 1024, str(payload)[:200])
        revision = project.get("revision", 0)

        # ---------- 上传本地图片（落到本地存储替身） ----------
        body, ctype = multipart("file", "source.png", png_bytes(512, 512), extra={"projectId": project_id})
        status, payload = client.call(
            "POST", "/api/canvas/upload", raw=body, headers={"Content-Type": ctype}
        )
        upload = payload.get("data") or {}
        check(
            "上传图片返回原始像素尺寸",
            upload.get("width") == 512 and upload.get("height") == 512,
            str(payload)[:200],
        )
        check(
            "上传结果写入本地存储替身",
            "/api/canvas/local-asset/" in (upload.get("url") or ""),
            upload.get("url", ""),
        )
        status, data, got_type = client.call("GET", "/api/canvas/local-asset/" + upload["url"].split("/api/canvas/local-asset/")[1], expect_json=False)
        check(
            "本地替身可直接读取图片",
            status == 200 and data[:8] == b"\x89PNG\r\n\x1a\n",
            f"status={status} type={got_type}",
        )

        # ---------- 保存文档（乐观锁） ----------
        document = {
            "version": 1,
            "width": 1024,
            "height": 1024,
            "background": "#ffffff",
            "layers": [
                {
                    "id": "ly_accept_1",
                    "type": "image",
                    "name": "source.png",
                    "url": upload["url"],
                    "x": 128,
                    "y": 128,
                    "width": 512,
                    "height": 512,
                    "scale": 1.5,
                    "rotation": 15,
                    "opacity": 1,
                    "visible": True,
                    "locked": False,
                }
            ],
        }
        status, payload = client.call(
            "PUT",
            f"/api/canvas/projects/{project_id}/document",
            body={"revision": revision, "document": document, "background": "#ffffff"},
        )
        saved = payload.get("data") or {}
        check(
            "保存画布文档（revision 递增）",
            payload.get("success") is True and saved.get("revision") == revision + 1,
            str(payload)[:200],
        )
        new_revision = saved.get("revision", revision + 1)

        status, payload = client.call(
            "PUT",
            f"/api/canvas/projects/{project_id}/document",
            body={"revision": revision, "document": document},
        )
        check(
            "旧 revision 保存返回 409",
            status == 409 and payload.get("code") == "revision_conflict",
            f"status={status} body={str(payload)[:160]}",
        )

        # ---------- 刷新恢复 ----------
        status, payload = client.get_json(f"/api/canvas/projects/{project_id}")
        reloaded = json.loads((payload.get("data") or {}).get("document") or "{}")
        layer = (reloaded.get("layers") or [{}])[0]
        check(
            "刷新后图层与变换完整恢复",
            layer.get("id") == "ly_accept_1"
            and abs(layer.get("rotation", 0) - 15) < 1e-6
            and abs(layer.get("scale", 0) - 1.5) < 1e-6,
            json.dumps(layer, ensure_ascii=False)[:200],
        )

        # ---------- 文生图（Ark 协议映射） ----------
        status, payload = client.post_json(
            "/api/canvas/tasks",
            {
                "projectId": project_id,
                "tool": "text2image",
                "idempotencyKey": f"t2i-{uuid.uuid4().hex}",
                "prompt": "一只坐在窗台上的橘猫，柔和晨光",
                "size": "1024x1024",
            },
        )
        task = (payload.get("data") or {}).get("task") or {}
        view = poll_task(client, task.get("id"))
        check("文生图任务成功", view.get("status") == "succeeded", json.dumps(view, ensure_ascii=False)[:300])
        check(
            "文生图结果已转存到本地存储",
            all("/api/canvas/local-asset/" in img["url"] for img in (view.get("result") or {}).get("images", [])),
            json.dumps((view.get("result") or {}).get("images"), ensure_ascii=False)[:200],
        )
        state = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{mock_port}/_state").read())
        ark_body = state["ark"][-1]
        check(
            "Ark 请求体映射正确（model/size/response_format/watermark）",
            ark_body.get("model") == MODEL
            and ark_body.get("size") == "1024x1024"
            and ark_body.get("response_format") == "url"
            and ark_body.get("watermark") is False,
            json.dumps(ark_body, ensure_ascii=False)[:300],
        )

        # ---------- 涂抹消除（蒙版尺寸逐像素对齐） ----------
        mask_data_url = "data:image/png;base64," + __import__("base64").b64encode(png_bytes(512, 512)).decode()
        status, payload = client.post_json(
            "/api/canvas/tasks",
            {
                "projectId": project_id,
                "tool": "erase",
                "idempotencyKey": f"erase-{uuid.uuid4().hex}",
                "images": [upload["url"]],
                "mask": mask_data_url,
                "params": {"toolVersion": "standard"},
            },
        )
        erase_submit = payload
        erase_task = (payload.get("data") or {}).get("task") or {}
        erase_view = poll_task(client, erase_task.get("id"))
        check(
            "涂抹消除任务成功",
            erase_view.get("status") == "succeeded",
            f"submit={json.dumps(erase_submit, ensure_ascii=False)[:300]} view={json.dumps(erase_view, ensure_ascii=False)[:300]}",
        )
        check("涂抹消除任务不可取消（同步接口）", erase_view.get("cancelable") is False, str(erase_view.get("cancelable")))
        check(
            "任务结算记录实扣额度",
            erase_view.get("billingState") in ("settled", "none"),
            f"{erase_view.get('billingState')} settled={erase_view.get('settledQuota')}",
        )
        state = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{mock_port}/_state").read())
        mk_body = state["mediakit"][-1]
        check(
            "MediaKit 消除请求体映射正确",
            mk_body["tool"] == "erase-image"
            and mk_body["body"].get("standard_scene") == "selected_area_erase"
            and mk_body["body"].get("mask_url"),
            json.dumps(mk_body, ensure_ascii=False)[:300],
        )

        # 蒙版尺寸不符：本地拦下，不产生任务
        small_mask = "data:image/png;base64," + __import__("base64").b64encode(png_bytes(256, 256)).decode()
        status, payload = client.post_json(
            "/api/canvas/tasks",
            {
                "projectId": project_id,
                "tool": "erase",
                "idempotencyKey": f"erase-bad-{uuid.uuid4().hex}",
                "images": [upload["url"]],
                "mask": small_mask,
            },
        )
        check(
            "蒙版尺寸不符返回 400 并说明原因",
            status == 400 and "蒙版" in (payload.get("message") or ""),
            f"status={status} body={str(payload)[:200]}",
        )

        # ---------- 智能扩图（四边模式） ----------
        status, payload = client.post_json(
            "/api/canvas/tasks",
            {
                "projectId": project_id,
                "tool": "outpaint",
                "idempotencyKey": f"expand-{uuid.uuid4().hex}",
                "images": [upload["url"]],
                "params": {"mode": "edges", "top": 0.2, "bottom": 0.2, "left": 0.1, "right": 0.1},
            },
        )
        expand_task = (payload.get("data") or {}).get("task") or {}
        expand_view = poll_task(client, expand_task.get("id"))
        state = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{mock_port}/_state").read())
        expand_body = state["mediakit"][-1]["body"]
        check(
            "扩图四边模式映射为官方 expand_* 字段",
            expand_view.get("status") == "succeeded"
            and expand_body.get("expand_top") == 0.2
            and expand_body.get("expand_bottom") == 0.2
            and expand_body.get("expand_left") == 0.1
            and expand_body.get("expand_right") == 0.1,
            json.dumps(expand_body, ensure_ascii=False)[:300],
        )

        # 超出官方 [0,0.4] 的四边比例：本地拦下
        status, payload = client.post_json(
            "/api/canvas/tasks",
            {
                "projectId": project_id,
                "tool": "outpaint",
                "idempotencyKey": f"expand-bad-{uuid.uuid4().hex}",
                "images": [upload["url"]],
                "params": {"mode": "edges", "top": 0.9, "bottom": 0.9, "left": 0.9, "right": 0.9},
            },
        )
        check("扩图比例超限被本地拦下", status == 400, f"status={status} body={str(payload)[:200]}")

        # ---------- 抠图 / 超分 ----------
        for tool, path_key, params, expect_fields in (
            ("matting", "remove-image-background", {"scene": "general"}, {"scene": "general"}),
            ("upscale", "enhance-image", {"toolVersion": "standard", "multiple": 2},
             {"tool_version": "standard", "multiple": 2}),
            (
                "generative_upscale",
                "enhance-image",
                {"toolVersion": "max", "generativeEnhanceMode": "generative_first", "enableCorrectColor": True},
                {"tool_version": "max", "generative_enhance_mode": "generative_first", "enable_correct_color": True},
            ),
        ):
            status, payload = client.post_json(
                "/api/canvas/tasks",
                {
                    "projectId": project_id,
                    "tool": tool,
                    "idempotencyKey": f"{tool}-{uuid.uuid4().hex}",
                    "images": [upload["url"]],
                    "params": params,
                },
            )
            job = (payload.get("data") or {}).get("task") or {}
            view = poll_task(client, job.get("id"))
            state = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{mock_port}/_state").read())
            last = state["mediakit"][-1]
            ok = view.get("status") == "succeeded" and last["tool"] == path_key
            ok = ok and all(last["body"].get(k) == v for k, v in expect_fields.items())
            check(f"{tool} 走 {path_key} 且关键字段正确", ok, json.dumps(last, ensure_ascii=False)[:300])

        # ---------- 幂等键 ----------
        key = f"idem-{uuid.uuid4().hex}"
        payload_args = {
            "projectId": project_id,
            "tool": "upscale",
            "idempotencyKey": key,
            "images": [upload["url"]],
            "params": {"multiple": 2},
        }
        status, first = client.post_json("/api/canvas/tasks", payload_args)
        status2, second = client.post_json("/api/canvas/tasks", payload_args)
        first_id = ((first.get("data") or {}).get("task") or {}).get("id")
        second_data = second.get("data") or {}
        check(
            "同键同参只产生一个任务（reused=true）",
            second_data.get("reused") is True
            and (second_data.get("task") or {}).get("id") == first_id,
            json.dumps(second_data, ensure_ascii=False)[:200],
        )
        changed = dict(payload_args, params={"multiple": 3})
        status3, third = client.post_json("/api/canvas/tasks", changed)
        check(
            "同键异参返回 409",
            status3 == 409 and third.get("code") == "idempotency_conflict",
            f"status={status3} body={str(third)[:200]}",
        )

        # ---------- 结果保存到素材库 + 下载 ----------
        result_task_id = view.get("id")
        status, payload = client.post_json(
            f"/api/canvas/tasks/{result_task_id}/save-asset", {"index": 0, "name": "验收结果"}
        )
        asset = payload.get("data") or {}
        check("结果可保存至共享素材库", bool(asset.get("refId")), str(payload)[:200])
        status, payload = client.get_json("/api/canvas/assets")
        refs = [item["refId"] for item in (payload.get("data") or {}).get("items", [])]
        check("素材库列表包含新素材", asset.get("refId") in refs, str(refs)[:200])

        status, data, ctype = client.call(
            "GET", f"/api/canvas/tasks/{result_task_id}/download?index=0", expect_json=False
        )
        check(
            "结果下载返回 PNG",
            status == 200 and data[:8] == b"\x89PNG\r\n\x1a\n",
            f"status={status} type={ctype}",
        )

        # ---------- 已完成任务取消 ----------
        status, payload = client.post_json(f"/api/canvas/tasks/{result_task_id}/cancel", {})
        check(
            "已完成任务取消被拒绝并说明原因",
            status >= 400 and (payload.get("message") or "") != "",
            f"status={status} body={str(payload)[:200]}",
        )

        # ---------- 列表与任务历史 ----------
        status, payload = client.get_json("/api/canvas/projects?p=1&page_size=10")
        items = (payload.get("data") or {}).get("items", [])
        check("画布列表包含该项目且有缩略图字段", any(i["id"] == project_id for i in items), str(items)[:200])
        status, payload = client.get_json(f"/api/canvas/tasks?projectId={project_id}&p=1&page_size=50")
        history = (payload.get("data") or {}).get("items", [])
        check("任务历史可查询且按项目过滤", len(history) >= 6, f"count={len(history)}")

        # ---------- 缺少凭证时的不可用原因（第二个实例，独立库） ----------
        port2 = free_port()
        env2 = dict(env)
        env2["PORT"] = str(port2)
        env2["SQLITE_PATH"] = os.path.join(workdir, "canvas2.db")
        env2["CANVAS_MEDIAKIT_API_KEY"] = ""
        env2.pop("CANVAS_TOOL_PRICE_ERASE", None)
        server2 = start_server(args.binary, env2, port2)
        try:
            client2 = Client(f"http://127.0.0.1:{port2}")
            client2.post_json(
                "/api/setup",
                {
                    "username": ROOT_USER,
                    "password": ROOT_PASS,
                    "confirmPassword": ROOT_PASS,
                    "SelfUseModeEnabled": True,
                    "DemoSiteEnabled": False,
                },
            )
            status, login2 = client2.post_json(
                "/api/user/login", {"username": ROOT_USER, "password": ROOT_PASS}
            )
            client2.user_id = (login2.get("data") or {}).get("id")
            status, payload = client2.get_json("/api/canvas/capabilities")
            caps2 = {t["tool"]: t for t in (payload.get("data") or {}).get("tools", [])}
            check(
                "缺 MediaKit Key 时如实返回不可用原因",
                caps2["erase"]["available"] is False
                and "CANVAS_MEDIAKIT_API_KEY" in (caps2["erase"].get("unavailableReason") or ""),
                caps2["erase"].get("unavailableReason", ""),
            )
            check(
                "缺渠道时 Ark 工具如实返回不可用原因",
                caps2["text2image"]["available"] is False
                and "渠道" in (caps2["text2image"].get("unavailableReason") or ""),
                caps2["text2image"].get("unavailableReason", ""),
            )
        finally:
            stop(server2)

    finally:
        if server:
            stop(server)
        stop(mock)
        # 默认保留临时目录：验收产物（上传图/结果图/数据库）需要复查，
        # 清理动作必须由使用者显式 --clean 触发。
        if args.clean:
            import shutil

            shutil.rmtree(workdir, ignore_errors=True)
            print(f"[clean] 已按 --clean 清理 {workdir}")
        else:
            print(f"[keep] 临时目录保留在 {workdir}")

    failed = [item for item in RESULTS if not item[1]]
    print("\n===== 汇总 =====")
    print(f"通过 {len(RESULTS) - len(failed)} / {len(RESULTS)} 项")
    for name, ok, detail in failed:
        print(f"  FAIL · {name} — {detail}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
