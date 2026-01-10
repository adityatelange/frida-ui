# This code is part of Frida-UI (https://github.com/adityatelange/frida-ui)

import json
import textwrap
import threading
import uuid
from typing import Any, Dict, List

import frida


class FridaError(RuntimeError):
    pass


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
                        "icon": json.dumps(list(d.icon["image"])) if d.icon else None,
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
        Each entry is a dict: {identifier, name, pid} where pid is set when the
        app is currently running.
        """
        d = self.get_device_by_id(device_id)
        apps: List[dict] = []

        # prefer a proper applications enumeration when available
        try:
            installed = d.enumerate_applications()
            for a in installed:
                apps.append(
                    {
                        "identifier": getattr(
                            a, "identifier", getattr(a, "name", None) or str(a)
                        ),
                        "name": getattr(
                            a, "name", getattr(a, "identifier", None) or str(a)
                        ),
                        "pid": None,
                    }
                )
        except Exception:
            # if enumerate_applications isn't available, we'll build a best-effort list
            apps = []

        # attach running pid information where possible
        try:
            procs = d.enumerate_processes()
            for p in procs:
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
                for p in procs:
                    # heuristic: package-like names or capitalized names often represent apps
                    if "." in p.name or (p.name and p.name[0].isupper()):
                        apps.append(
                            {"identifier": p.name, "name": p.name, "pid": p.pid}
                        )
        except Exception:
            # ignore process enumeration errors
            pass

        # deduplicate by identifier
        seen = {}
        for a in apps:
            if a["identifier"] not in seen:
                seen[a["identifier"]] = a
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

    def spawn_and_attach(self, device_id: str, identifier: str):
        """Spawn an installed application by identifier and attach to it.

        Returns a tuple (session_id, pid).
        """
        d = self.get_device_by_id(device_id)
        try:
            try:
                pid = d.spawn([identifier])
            except TypeError:
                pid = d.spawn(identifier)

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

    def spawn_and_run(self, device_id: str, identifier: str, script_source: str):
        """Spawn, attach, load script, and THEN resume.

        This ensures the script is running from the very beginning of the process.
        """
        d = self.get_device_by_id(device_id)
        try:
            try:
                pid = d.spawn([identifier])
            except TypeError:
                pid = d.spawn(identifier)

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
        self, device_id: str, identifier: str, final_script: str
    ):
        """Spawn, attach, inject the provided final_script (assumed to be valid JS), then resume."""
        d = self.get_device_by_id(device_id)
        try:
            try:
                pid = d.spawn([identifier])
            except TypeError:
                pid = d.spawn(identifier)

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
                function forward(level, args) {
                    try { send({ __console: { level: level, payload: args.map(function (a) { try { return (typeof a === 'object') ? safe_serialize(a) : String(a); } catch (e) { return String(a); } }) } }); } catch (e) { }
                }
                // Replace console methods and DO NOT call the originals to avoid printing to stdout.
                console.log = function () { forward('log', Array.prototype.slice.call(arguments)); };
                console.error = function () { forward('error', Array.prototype.slice.call(arguments)); };
                console.warn = function () { forward('warn', Array.prototype.slice.call(arguments)); };
                console.info = function () { forward('info', Array.prototype.slice.call(arguments)); };
            })();
            """
        ).strip()
        wrapped_source = console_forwarder + "\n" + script_source
        script = session.create_script(wrapped_source)
        script_id = str(uuid.uuid4())
        self.message_queues[script_id] = []

        def on_message(message, data):
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
