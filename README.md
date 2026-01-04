# frida-ui

A modern, lightweight, web-based user interface for [Frida](https://frida.re/), designed for **Android application penetration testing**. It allows you to interact with devices, processes, and scripts directly from your browser.

![](https://raw.githubusercontent.com/adityatelange/frida-ui/refs/heads/main/assets/dashboard.png)

## Quick Start

```sh
uv tool install frida-ui # Install
frida-ui               # Start server
```

Open your browser and navigate to: `http://localhost:8000`

## Features

### 📱 Device Management

- **Auto-discovery**: Automatically detects connected USB and local devices.
- **Remote Devices**: Easily add and manage remote Frida servers (e.g., `192.168.1.x:27042`).
- **Device Info**: View detailed system parameters (OS, Arch, API Level) for selected devices.

### 🚀 Process & App Control

- **Application List**: View installed applications and running processes.
- **Search**: Real-time filtering of applications by name or identifier.
- **Session Management**:
  - **Attach**: Connect to running processes.
  - **Spawn**: Launch installed applications.
  - **Spawn & Run**: Launch an app and immediately inject a script (early instrumentation).
  - **Kill/Detach**: Terminate processes or gracefully disconnect.

### 💻 Scripting & Instrumentation

- **Script Editor**: Built-in editor for writing Frida scripts.
- **File Loading**: Load scripts from local files or drag-and-drop `.js` files into the editor.
- **CodeShare Integration**:
  - Import scripts directly from [Frida CodeShare](https://codeshare.frida.re/).
  - Create a "Queue" of CodeShare scripts to inject sequentially.

### 📊 Console & Logging

- **Real-time Output**: View `console.log`, `send()`, and error messages from your scripts.
- **Log History**: Persistent logs per application session.
- **Export**: Download console logs as `.txt` files for analysis.

### 🎨 UI/UX

- **Dark Theme**: Clean, consistent dark mode interface.
- **Persistence**: Remembers your selected device, application, and window sizes.
- **Responsive**: Adjustable panes for sidebar, editor, and console.

## Getting Started

### Prerequisites

- Python 3.7+
- [uv](https://docs.astral.sh/uv/) (recommended) / [pipx](https://pipxproject.github.io/pipx/) / `pip`.

### Installation

#### Option 1: Install from PyPI (Recommended)

```bash
uv tool install frida-ui
```

You can also customize the Frida version:

```bash
uv tool install frida-ui --with frida==16.7.19
```

#### Option 2: Install from Source

1. Clone the repository:

```bash
git clone https://github.com/adityatelange/frida-ui.git
cd frida-ui
```

2. Install using uv:

```bash
uv tool install .
```

You can customize the Frida version:

```bash
uv tool install . --with frida==16.7.19
```

> [!IMPORTANT]
> The Frida version you install must match the `frida-server` version on your Android device to ensure compatibility.

### Running

Start the server:

```bash
frida-ui
```

Or with custom options:

```bash
frida-ui --host 127.0.0.1 --port 8000 --reload
```

- `--host`: Specify the host (default: 127.0.0.1)
- `--port`: Specify the port (default: 8000)
- `--reload`: Enable auto-reload for development

Open **http://localhost:8000** in your browser.

## Android Device Setup

Before using `frida-ui`, you must have `frida-server` running on your Android device. The version of `frida-server` must match the Frida version you installed in the previous step.

### Option 1: USB Connection

If you have ADB installed and want to connect via USB:

1. **Download frida-server**:
   Visit [Frida releases](https://github.com/frida/frida/releases) and download the `frida-server` binary for Android matching your device's architecture/abi (e.g., `frida-server-x.x.x-android-arm64.xz`).

2. **Extract and Push to Device**:

   ```bash
   unxz frida-server-x.x.x-android-arm64.xz
   mv frida-server-x.x.x-android-arm64 frida-server
   adb push frida-server /data/local/tmp/
   ```

3. **Run frida-server**:

   ```bash
   adb shell "chmod 755 /data/local/tmp/frida-server"
   adb shell "/data/local/tmp/frida-server -D"
   ```

4. **Verify Connection**:
   Ensure your device is connected via USB and visible via `adb devices`. `frida-ui` will automatically detect it when running.

### Option 2: Remote Connection (Network)

Alternatively, you can run `frida-server` with a network listener and connect remotely:

1. **Download and run frida-server on your Android device** (using any method - ADB, custom script, etc.):

   ```bash
   ./frida-server -l 0.0.0.0:27042 -D
   ```

2. **Add Remote Device in frida-ui**:
   In the frida-ui interface, add a remote device with the IP address and port where frida-server is listening (e.g., `192.168.1.x:27042`).

   > No ADB installation is required for this method.

## Usage Guide

1. **Select a Device**: Choose a device from the dropdown in the top header.
2. **Select an App**: Click on an application in the sidebar.
3. **Write/Load Script**:
   - Type JS in the editor.
   - Or drag & drop a file.
   - Or add scripts URL from CodeShare.
4. **Action**:
   - Click **Attach** to inject into a running process.
   - Click **Spawn** to start the app.
   - Click **Spawn & Run** to start the app with your script injected immediately.
5. **Monitor**: Watch the console for output.

## Notes

> [!NOTE]
> This tool is an independent project and is **not part of the official Frida toolset** and is **not sponsored by the Frida project**. It is a third-party user interface built to interact with Frida's core functionality.

> [!WARNING]
> This tool allows executing arbitrary JavaScript in target processes. Only expose frida-ui to trusted networks and users. Executing untrusted scripts can compromise your system and data. The web server runs locally by default but exposes powerful instrumentation capabilities.
