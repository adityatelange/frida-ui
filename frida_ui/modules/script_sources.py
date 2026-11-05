# This code is part of Frida-UI (https://github.com/adityatelange/frida-ui)

import os
from pathlib import Path
from typing import List, Optional

from frida_ui.modules.codeshare import fetch_codeshare_script

LOCAL_PREFIX = "local:"
# Passed via env so uvicorn's re-import (and --reload worker processes) see it
SCRIPTS_DIR_ENV = "FRIDA_UI_SCRIPTS_DIR"


def get_scripts_dir() -> Optional[Path]:
    value = os.environ.get(SCRIPTS_DIR_ENV)
    return Path(value).resolve() if value else None


def list_local_scripts() -> List[str]:
    root = get_scripts_dir()
    if not root or not root.is_dir():
        return []
    return sorted(
        p.relative_to(root).as_posix() for p in root.rglob("*.js") if p.is_file()
    )


def read_local_script(name: str) -> str:
    root = get_scripts_dir()
    if not root:
        raise ValueError("No scripts directory configured (start with --scripts-dir)")
    path = (root / name).resolve()
    if root not in path.parents or path.suffix.lower() != ".js":
        raise ValueError(f"Invalid local script path: {name}")
    if not path.is_file():
        raise FileNotFoundError(f"Local script not found: {name}")
    return path.read_text(encoding="utf-8")


def fetch_script_source(uri: str) -> str:
    """Resolve a queue entry: 'local:<relative path>' from --scripts-dir, else a CodeShare URI."""
    if uri.startswith(LOCAL_PREFIX):
        return read_local_script(uri[len(LOCAL_PREFIX):])
    return fetch_codeshare_script(uri)
