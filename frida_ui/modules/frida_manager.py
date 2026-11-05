# This code is part of Frida-UI (https://github.com/adityatelange/frida-ui)

import json
import re
import textwrap
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import frida

try:
    import frida_tools
except ImportError:
    frida_tools = None


class FridaError(RuntimeError):
    pass


ANDROID_USER_RE = re.compile(r"^u(\d+)_")


def _android_user(process) -> Optional[int]:
    """Android user ID from a process owner such as u10_a123, else None."""
    match = ANDROID_USER_RE.match(process.parameters.get("user") or "")
    return int(match.group(1)) if match else None


def _app_row(
    identifier: str,
    name: str,
    pid: Optional[int] = None,
    android_user: Optional[int] = None,
) -> dict:
    """Build an app list entry; `key` stays unique when a package runs under several users."""
    return {
        "key": f"{identifier}@u{android_user}" if android_user else identifier,
        "identifier": identifier,
        "name": f"{name} (u{android_user})" if android_user else name,
        "pid": pid,
        "android_user": android_user,
    }


def _profile_app_rows(procs, installed: List[dict]) -> List[dict]:
    """Rows for processes of non-primary Android users (e.g. work profiles).

    enumerate_applications() only covers the primary user, so these would otherwise be hidden.
    """
    labels = {a["identifier"]: a["name"] for a in installed}
    rows = {}
    # main process names have no ":" suffix; visit them first so they own the row's pid
    for p in sorted(procs, key=lambda p: ":" in p.name):
        user = _android_user(p)
        base_name = p.name.split(":")[0]
        package = next(iter(p.parameters.get("applications") or []), base_name)
        if user and "." in package:
            row = _app_row(package, labels.get(package, base_name), p.pid, user)
            rows.setdefault(row["key"], row)
    return sorted(rows.values(), key=lambda r: r["name"].lower())


def _spawn_app(d, identifier: str, android_user: Optional[int] = None) -> int:
    """Spawn by identifier; Frida's `uid` option takes the Android user ID."""
    if android_user:
        return d.spawn([identifier], uid=android_user)
    try:
        return d.spawn([identifier])
    except TypeError:
        return d.spawn(identifier)


BRIDGE_NAMES = {"java", "objc", "swift"}


def _bridge_reply(message: dict) -> Optional[dict]:
    """Answer a lazy-bridge request from the injected loader, else None.

    Frida 17+ no longer bundles the Java/ObjC/Swift bridges in GumJS; like the
    frida-tools REPL, we serve the prebuilt bridges shipped inside frida-tools.
    """
    payload = message.get("payload") if message.get("type") == "send" else None
    if not isinstance(payload, dict) or payload.get("type") != "frida:load-bridge":
        return None
    name = str(payload.get("name", "")).lower()
    reply = {"type": "frida:bridge-loaded", "filename": f"{name}.js"}
    try:
        if name not in BRIDGE_NAMES or frida_tools is None:
            raise FileNotFoundError("frida-tools is not installed (pip install frida-tools)")
        bridge = Path(frida_tools.__file__).parent / "bridges" / reply["filename"]
        reply["source"] = bridge.read_text(encoding="utf-8")
    except Exception as e:
        # the script blocks until a reply arrives, so always answer; surface the failure in-script
        reply["source"] = f"throw new Error({json.dumps(f'Failed to load {name} bridge: {e}')});"
    return reply


class FridaManager:
    """Manages Frida devices, sessions, and scripts."""

    def __init__(self):
        self.version = frida.__version__
        self.sessions: Dict[str, Any] = {}
        self.scripts: Dict[str, Any] = {}
        self.message_queues: Dict[str, List[dict]] = {}
        self.remote_devices: Dict[str, Any] = {}
        self.lock = threading.Lock()

    def add_remote_device(self, host: str, port: int = 27042):
        """Add a remote Frida server to the device list.

        Returns the device info dict: {id, name, type, host, port}
        """
        address = f"{host}:{port}"
        try:
            dm = frida.get_device_manager()
            device = dm.add_remote_device(address)

            # Verify connection
            try:
                device.query_system_parameters()
            except Exception as e:
                dm.remove_remote_device(address)
                raise Exception(f"Connection failed: {e}")

            device_info = {
                "id": device.id,
                "name": device.name,
                "type": str(device.type),
                "host": host,
                "port": port,
                "is_remote": True,
            }
            with self.lock:
                self.remote_devices[device.id] = device_info
            return device_info
        except Exception as e:
            raise FridaError(f"Failed to add remote device at {address}: {e}")

    def remove_remote_device(self, device_id: str):
        """Remove a remote device by disconnecting from Frida device manager."""
        with self.lock:
            if device_id not in self.remote_devices:
                return False

            device_info = self.remote_devices[device_id]
            host = device_info.get("host")
            port = device_info.get("port", 27042)

            if not host:
                # can't disconnect without host info, just remove from tracking
                self.remote_devices.pop(device_id)
                return True

            try:
                address = f"{host}:{port}"
                frida.get_device_manager().remove_remote_device(address)
            except Exception as e:
                # even if removal fails, remove from tracking
                print(f"Warning: Failed to remove device from Frida manager: {e}")

            self.remote_devices.pop(device_id)
            return True

    def list_devices(self):
        """List all available Frida devices."""
        active_ids = set()
        remote_ids = set()
        with self.lock:
            for s in self.sessions.values():
                active_ids.add(s.get("device"))
            remote_ids = set(self.remote_devices.keys())

        devices = []
        for d in frida.enumerate_devices():
            params = {}
            try:
                params = d.query_system_parameters()
                devices.append(
                    {
                        "id": d.id,
                        "name": d.name,
                        "icon": list(d.icon["image"]) if d.icon else None,
                        "type": str(d.type),
                        "can_disconnect": d.id in remote_ids,
                        "parameters": params,
                    }
                )
            except Exception:
                pass

        def sort_key(d):
            # 1. Active session? (0=Yes, 1=No)
            k1 = 0 if d["id"] in active_ids else 1
            # 2. Type? (0=Remote, 1=USB, 2=Other)
            if d["type"] == "remote":
                k2 = 0
            elif d["type"] == "usb":
                k2 = 1
            else:
                k2 = 2
            return (k1, k2)

        devices.sort(key=sort_key)
        return devices

    def get_device_by_id(self, device_id: str):
        """Retrieve a Frida device by its ID."""
        for d in frida.enumerate_devices():
            if d.id == device_id:
                return d
        raise FridaError(f"Device {device_id} not found")

    def list_processes(self, device_id: str):
        """Return running processes for the device."""
        d = self.get_device_by_id(device_id)
        procs = d.enumerate_processes()
        return [{"pid": p.pid, "name": p.name} for p in procs]

    def list_applications(self, device_id: str):
        """Return installed applications for the device.

        Tries to use Device.enumerate_applications() when available (typical on mobile
        devices). Falls back to heuristics over running processes if not available.
        Each entry is a dict: {key, identifier, name, pid, android_user} where pid is
        set when the app is currently running. Processes running under other Android
        users (e.g. work profiles) are appended as extra entries.
        """
        d = self.get_device_by_id(device_id)
        apps: List[dict] = []

        # prefer a proper applications enumeration when available
        try:
            installed = d.enumerate_applications()
            for a in installed:
                apps.append(
                    _app_row(
                        getattr(
                            a, "identifier", getattr(a, "name", None) or str(a)
                        ),
                        getattr(
                            a, "name", getattr(a, "identifier", None) or str(a)
                        ),
                    )
                )
        except Exception:
            # if enumerate_applications isn't available, we'll build a best-effort list
            apps = []

        # attach running pid information where possible
        try:
            procs = d.enumerate_processes(scope="metadata")
            primary_procs = [p for p in procs if not _android_user(p)]
            for p in primary_procs:
                for app in apps:
                    if (
                        p.name == app["identifier"]
                        or p.name == app["name"]
                        or app["identifier"] in p.name
                    ):
                        app["pid"] = p.pid
                        break
            # if we didn't get installed apps, try to infer common apps from process list
            if not apps:
                for p in primary_procs:
                    # heuristic: package-like names or capitalized names often represent apps
                    if "." in p.name or (p.name and p.name[0].isupper()):
                        apps.append(_app_row(p.name, p.name, p.pid))
            apps.extend(_profile_app_rows(procs, apps))
        except Exception:
            # ignore process enumeration errors
            pass

        # deduplicate by key
        seen = {}
        for a in apps:
            if a["key"] not in seen:
                seen[a["key"]] = a
        return list(seen.values())

    def attach(self, device_id: str, target: str):
        """Attach to a process by pid or name on the specified device.
        Returns a tuple (session_id, pid).
        """
        d = self.get_device_by_id(device_id)
        try:
            # resolve pid
            pid = None
            if str(target).isdigit():
                pid = int(target)
            else:
                for p in d.enumerate_processes():
                    if p.name == target:
                        pid = p.pid
                        break
            if pid is None:
                raise FridaError(f"Process {target} not found on device {device_id}")
            session = d.attach(pid)
            session_id = str(uuid.uuid4())
            self.sessions[session_id] = {
                "device": device_id,
                "session": session,
                "pid": pid,
            }
            return session_id, pid
        except Exception as e:
            raise FridaError(f"Failed to attach to {target} (pid: {pid}): {e}")

    def spawn_and_attach(
        self, device_id: str, identifier: str, android_user: Optional[int] = None
    ):
        """Spawn an installed application by identifier and attach to it.

        Returns a tuple (session_id, pid).
        """
        d = self.get_device_by_id(device_id)
        try:
            pid = _spawn_app(d, identifier, android_user)

            # attach to the spawned pid
            session = d.attach(pid)
            session_id = str(uuid.uuid4())
            self.sessions[session_id] = {
                "device": device_id,
                "session": session,
                "pid": pid,
            }

            # resume the process so it starts running
            try:
                d.resume(pid)
            except Exception:
                pass

            return session_id, pid
        except Exception as e:
            raise FridaError(f"Failed to spawn and attach to {identifier}: {e}")

    def spawn_and_run(
        self,
        device_id: str,
        identifier: str,
        script_source: str,
        android_user: Optional[int] = None,
    ):
        """Spawn, attach, load script, and THEN resume.

        This ensures the script is running from the very beginning of the process.
        """
        d = self.get_device_by_id(device_id)
        try:
            pid = _spawn_app(d, identifier, android_user)

            session = d.attach(pid)
            session_id = str(uuid.uuid4())
            self.sessions[session_id] = {
                "device": device_id,
                "session": session,
                "pid": pid,
            }

            # create and load script BEFORE resume
            script_id = self.create_script(session_id, script_source)

            try:
                d.resume(pid)
            except Exception:
                pass

            return session_id, pid, script_id
        except Exception as e:
            raise FridaError(f"Failed to spawn and run {identifier}: {e}")

    def spawn_and_run_with_payload(
        self,
        device_id: str,
        identifier: str,
        final_script: str,
        android_user: Optional[int] = None,
    ):
        """Spawn, attach, inject the provided final_script (assumed to be valid JS), then resume."""
        d = self.get_device_by_id(device_id)
        try:
            pid = _spawn_app(d, identifier, android_user)

            session = d.attach(pid)
            session_id = str(uuid.uuid4())
            self.sessions[session_id] = {
                "device": device_id,
                "session": session,
                "pid": pid,
            }

            # inject provided final script BEFORE resume
            script_id = self.create_script(session_id, final_script)

            try:
                d.resume(pid)
            except Exception:
                pass

            return session_id, pid, script_id
        except Exception as e:
            raise FridaError(f"Failed to spawn and run {identifier}: {e}")

    def detach(self, session_id: str):
        """Detach from a session and clean up."""
        info = self.sessions.get(session_id)
        if not info:
            raise FridaError("Session not found")
        try:
            info["session"].detach()
        finally:
            with self.lock:
                self.sessions.pop(session_id, None)
        return True

    def kill_process(self, device_id: str, pid: int):
        """Kill a process on the specified device and clean up any related session state."""
        d = self.get_device_by_id(device_id)
        try:
            # frida Device objects provide a kill(pid) method
            d.kill(pid)
        except frida.ProcessNotFoundError:
            return True  # already not running
        except Exception as e:
            raise FridaError(f"Failed to kill pid {pid} on device {device_id}: {e}")

        # if we have any sessions tied to this pid, detach and remove them
        to_remove = []
        with self.lock:
            for sid, info in list(self.sessions.items()):
                if info.get("pid") == pid and info.get("device") == device_id:
                    try:
                        info.get("session").detach()
                    except Exception:
                        pass
                    to_remove.append(sid)
            for sid in to_remove:
                self.sessions.pop(sid, None)

        return True

    def create_script(self, session_id: str, script_source: str):
        """Create and load a script into the specified session.
        Returns the script_id.
        """
        info = self.sessions.get(session_id)
        if not info:
            raise FridaError("Session not found")
        session = info["session"]

        # Wrap console.log and console.error so they are forwarded via `send()` to the
        # Python message handler. This ensures `console.log(...)` output from injected
        # scripts is captured and available to the web UI.
        console_forwarder = textwrap.dedent(
            """
            // Console forwarding wrapper
            (function () {
                function safe_serialize(v) {
                    try { return JSON.stringify(v); } catch (e) { try { return String(v); } catch (e2) { return '<unserializable>'; } }
                }
                // match frida's own console: JSON only for plain objects/arrays (String() would give [object Object]),
                // String() for everything with its own toString - java/objc wrappers (calls java toString()), Error, NativePointer.
                // JSON.stringify of a java wrapper only yields '<instance: okhttp3.Request>'.
                function format_arg(a) {
                    if (typeof a === 'string') return a;
                    if (a === null || a === undefined) return String(a);
                    if (a instanceof ArrayBuffer) { try { return hexdump(a); } catch (e) { } }
                    if (typeof a === 'object') {
                        var proto = Object.getPrototypeOf(a);
                        if (Array.isArray(a) || proto === Object.prototype || proto === null) return safe_serialize(a);
                    }
                    try { return String(a); } catch (e) { return safe_serialize(a); }
                }
                function forward(level, args) {
                    try { send({ __console: { level: level, payload: args.map(format_arg) } }); } catch (e) { }
                }
                // Replace console methods and DO NOT call the originals to avoid printing to stdout.
                console.log = function () { forward('log', Array.prototype.slice.call(arguments)); };
                console.error = function () { forward('error', Array.prototype.slice.call(arguments)); };
                console.warn = function () { forward('warn', Array.prototype.slice.call(arguments)); };
                console.info = function () { forward('info', Array.prototype.slice.call(arguments)); };
            })();
            """
        ).strip()
        # Frida 17+ removed the built-in Java/ObjC/Swift globals; define lazy getters that
        # request the bridge from the host on first use (same protocol as frida-tools' REPL).
        bridge_loader = textwrap.dedent(
            """
            ['ObjC', 'Swift', 'Java'].forEach(function (name) {
                if (name in globalThis) return;
                Object.defineProperty(globalThis, name, {
                    enumerable: true,
                    configurable: true,
                    get: function () {
                        send({ type: 'frida:load-bridge', name: name });
                        var bridge;
                        recv('frida:bridge-loaded', function (message) {
                            bridge = Script.evaluate('/frida/bridges/' + message.filename,
                                '(function () { ' + [
                                    message.source,
                                    "Object.defineProperty(globalThis, '" + name + "', { value: bridge });",
                                    'return bridge;'
                                ].join('\\n') + ' })();');
                        }).wait();
                        return bridge;
                    }
                });
            });
            """
        ).strip()
        wrapped_source = "\n".join([console_forwarder, bridge_loader, script_source])
        script = session.create_script(wrapped_source)
        script_id = str(uuid.uuid4())
        self.message_queues[script_id] = []

        def on_message(message, data):
            reply = _bridge_reply(message)
            if reply:
                script.post(reply)
                return
            entry = {"message": message, "data": data}
            # store message
            with self.lock:
                self.message_queues[script_id].append(entry)

        script.on("message", on_message)
        script.load()
        self.scripts[script_id] = {"session_id": session_id, "script": script}
        return script_id

    def list_script_messages(self, script_id: str, clear: bool = False):
        """List messages received from the specified script."""
        with self.lock:
            msgs = list(self.message_queues.get(script_id, []))
            if clear:
                self.message_queues[script_id] = []
        return msgs

    def is_session_alive(self, session_id: str):
        """Check whether the session's target process still exists on the device."""
        info = self.sessions.get(session_id)
        if not info:
            return False
        device_id = info.get("device")
        pid = info.get("pid")
        if not pid:
            return False
        try:
            d = self.get_device_by_id(device_id)
            procs = d.enumerate_processes()
            for p in procs:
                if p.pid == pid:
                    return True
            return False
        except Exception:
            # we can't query device, assume alive=False
            return False
