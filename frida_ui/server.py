# This code is part of Frida-UI (https://github.com/adityatelange/frida-ui)

import argparse
import os
from typing import List

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from frida_ui.modules.frida_manager import FridaError, FridaManager
from frida_ui.modules.codeshare import fetch_codeshare_script

app = FastAPI(title="frida-ui")
# static files live next to this module in "static/"
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

frida_mgr = None
try:
    frida_mgr = FridaManager()
except Exception as e:
    # Frida is required — abort startup so the server doesn't run without Frida available
    exit(f"Fatal error: could not initialize FridaManager: {e}")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/devices")
def devices():
    return frida_mgr.list_devices()


class AddRemoteDeviceRequest(BaseModel):
    host: str
    port: int = 27042


@app.post("/api/devices/remote")
def add_remote_device(req: AddRemoteDeviceRequest):
    """Add a remote Frida server to the device list."""
    try:
        device_info = frida_mgr.add_remote_device(req.host, req.port)
        return device_info
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/devices/remote/{device_id}")
def remove_remote_device(device_id: str):
    """Remove a remote device from tracking."""
    success = frida_mgr.remove_remote_device(device_id)
    if not success:
        raise HTTPException(status_code=404, detail="Remote device not found")
    return {"ok": True}


@app.get("/api/devices/{device_id}/processes")
def processes(device_id: str):
    try:
        return frida_mgr.list_processes(device_id)
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/devices/{device_id}/apps")
def apps(device_id: str):
    try:
        return frida_mgr.list_applications(device_id)
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


class AttachRequest(BaseModel):
    device_id: str
    target: str  # pid or process name


@app.post("/api/attach")
def attach(req: AttachRequest):
    try:
        sid, pid = frida_mgr.attach(req.device_id, req.target)
        return {"session_id": sid, "pid": pid}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


class SpawnRequest(BaseModel):
    device_id: str
    identifier: str


@app.post("/api/spawn")
def spawn(req: SpawnRequest):
    """Spawn an installed app on the device and attach to it."""
    try:
        sid, pid = frida_mgr.spawn_and_attach(req.device_id, req.identifier)
        return {"session_id": sid, "pid": pid}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


class SpawnAndRunRequest(BaseModel):
    device_id: str
    identifier: str
    script: str
    codeshare_uris: List[str] = []


@app.post("/api/spawn_and_run")
def spawn_and_run(req: SpawnAndRunRequest):
    """Spawn, attach, load script (including optional CodeShare queue), and resume."""
    try:
        # If Codeshare URIs are provided, fetch them and compose final payload
        final_script = req.script or ""
        if req.codeshare_uris:
            parts = []
            for uri in req.codeshare_uris:
                source = fetch_codeshare_script(uri)
                if not source:
                    raise FridaError(
                        f"Script source not found on codeshare for uri: {uri}"
                    )
                parts.append(source)

            if final_script.strip():
                parts.append(final_script)

            # concat code fragments into a single JS payload
            final_script = "\n\n".join(parts)

        sid, pid, script_id = frida_mgr.spawn_and_run_with_payload(
            req.device_id, req.identifier, final_script
        )
        return {"session_id": sid, "pid": pid, "script_id": script_id}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/session/{session_id}/alive")
def session_alive(session_id: str):
    """Return whether the session's process is still running."""
    try:
        alive = frida_mgr.is_session_alive(session_id)
        return {"alive": alive}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


class ScriptRequest(BaseModel):
    session_id: str
    script: str


@app.post("/api/script")
def create_script(req: ScriptRequest):
    try:
        script_id = frida_mgr.create_script(req.session_id, req.script)
        return {"script_id": script_id}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


class CodeShareRequest(BaseModel):
    session_id: str
    uri: str  # owner/slug or full /api/project/... url


@app.post("/api/codeshare/load")
def load_codeshare(req: CodeShareRequest):
    """Load a script from codeshare.frida.re and create it for the given session."""
    try:
        source = fetch_codeshare_script(req.uri)
        if not source:
            raise FridaError("Script source not found on codeshare for uri: " + req.uri)
        script_id = frida_mgr.create_script(req.session_id, source)
        return {"script_id": script_id}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/scripts/{script_id}/messages")
def script_messages(script_id: str, clear: bool = False):
    msgs = frida_mgr.list_script_messages(script_id, clear=clear)
    return msgs


class DetachRequest(BaseModel):
    session_id: str


@app.post("/api/detach")
def detach(req: DetachRequest):
    try:
        frida_mgr.detach(req.session_id)
        return {"ok": True}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


class KillRequest(BaseModel):
    device_id: str
    pid: int


@app.post("/api/kill")
def kill(req: KillRequest):
    """Terminate a process on the device."""
    try:
        frida_mgr.kill_process(req.device_id, req.pid)
        return {"ok": True}
    except FridaError as e:
        raise HTTPException(status_code=400, detail=str(e))


def main():
    parser = argparse.ArgumentParser(
        description="frida-ui: Web UI to run frida scripts"
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument(
        "--port", default=8000, type=int, help="Port to listen on (default: 8000)"
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload on code changes (development)",
    )
    args = parser.parse_args()

    print(
        f"[+] Starting frida-ui on http://{args.host}:{args.port} {'with reload' if args.reload else ''}"
    )
    print(f"[+] Using Frida version: {frida_mgr.version}")
    print("[+] Press CTRL+C to stop the server")

    log_level = "debug" if args.reload else "info"
    uvicorn.run(
        "frida_ui.server:app",
        host=args.host,
        port=args.port,
        log_level=log_level,
        reload=args.reload,
        access_log=args.reload,
    )


if __name__ == "__main__":
    main()
