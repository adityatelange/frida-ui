# frida-ui

A modern, web-based user interface for [Frida](https://frida.re/), allowing you to interact with devices, processes, and scripts directly from your browser.

![](https://raw.githubusercontent.com/adityatelange/frida-ui/refs/heads/main/assets/dashboard.png)

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

## Quick Start

### Prerequisites

- Python 3.7+
- [uv](https://docs.astral.sh/uv/) (recommended)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/adityatelange/frida-ui.git
cd frida-ui
```

2. Install frida-ui using uv:

```bash
uv tool install .
```

> To customize the Frida version used by frida-ui, pass the desired version to uv when installing. For example:
>
> ```bash
> uv tool install . --with frida==16.7.19
> ```

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

## Security Warning

> [!NOTE]
> This tool allows executing arbitrary JavaScript in target processes. Only expose frida-ui to trusted networks and users. Executing untrusted scripts can compromise your system and data. The web server runs locally by default but exposes powerful instrumentation capabilities.
