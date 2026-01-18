# This code is part of Frida-UI (https://github.com/adityatelange/frida-ui)

import json
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from frida_ui import __version__


def fetch_codeshare_script(uri: str) -> str:
    """Fetch script source from codeshare.frida.re.

    Args:
        uri: The codeshare URI (e.g. "frida/universal-android-ssl-pinning-bypass-with-frida")

    Returns:
        The script source code.
    """
    if uri.startswith("https://") and "codeshare.frida.re" not in uri:
        raise ValueError(
            "Invalid CodeShare URI. Must be a codeshare.frida.re URL or owner/slug format."
        )

    # Clean up URI if full URL is passed
    if uri.startswith("https://codeshare.frida.re/"):
        uri = uri.replace("https://codeshare.frida.re/", "").strip("/")
        # Handle @ prefix if present
        uri = uri.lstrip("@")

    if uri.endswith("/"):
        uri = uri.rstrip("/")

    # Ensure we have a valid looking slug (owner/project)
    parts = uri.split("/")
    if len(parts) < 2:
        raise ValueError("Invalid CodeShare URI. Expected format: owner/project-slug")

    # Construct API URL /api/project/{owner}/{slug}/
    api_url = f"https://codeshare.frida.re/api/project/{uri}/"

    try:
        req = Request(api_url, headers={"User-Agent": f"frida-ui/{__version__}"})
        with urlopen(req, timeout=5) as r:
            status = getattr(r, "status", None)
            if status is not None and status != 200:
                raise RuntimeError(f"CodeShare returned HTTP {status}")
            text = r.read().decode("utf-8")
        data = json.loads(text)

        return data.get("source", "")
    except (HTTPError, URLError) as e:
        raise RuntimeError("Failed to fetch from CodeShare: {}".format(e))
    except Exception as e:
        raise RuntimeError("Failed to fetch from CodeShare: {}".format(e))
