# idleview-control

A companion web interface for controlling the Idleview ambient display application. Access from any device (mobile, tablet, or computer) on your local network to configure settings.

## Overview

This web app communicates with the Idleview desktop application via HTTP API to read and modify settings stored in:
- **Windows**: `%APPDATA%\idleview\settings.json`
- **macOS**: `~/Library/Application Support/idleview/settings.json`
- **Linux**: `~/.config/idleview/settings.json`
