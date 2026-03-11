# GIREI — Sovereign Intelligence

A minimalist, transparent chat interface for local LLMs, designed for elite productivity and absolute privacy. Inspired by Apple’s design language and built for the modern developer.

<img width="1504" height="1325" alt="GIREI Interface" src="https://github.com/user-attachments/assets/bea35de6-8d53-4ed7-81e5-e0564ce3fe22" />

## Philosophy: Sovereign Intelligence

GIREI is built on the belief that **Intelligence should be Sovereign**. In a world of centralized, data-harvesting AI, GIREI provides a localized alternative that respects your intellectual property and operates with zero latency. It is not just a tool; it is a private reasoning engine that lives where you build.

## Key Features

- **Minimalist Glassmorphism**: A sleek, transparent UI built with Electron that stays out of your way until summoned with `Option + Space`.
- **Local-First Inference**: Powered by **Deepseek R1** via Ollama. No data ever leaves your machine.
- **Context Injection (RAG-lite)**: Seamlessly attach local files to your chat context for project-aware assistance.
- **Deep Technical Support**: Native **LaTeX** rendering for mathematics and high-fidelity code highlighting via Highlight.js.
- **Resource Intelligence**: Real-time monitoring of system memory and Ollama VRAM usage to ensure optimal machine performance.

## Architecture

GIREI leverages a multi-process architecture for stability and performance:

1. **Frontend (Electron)**: Handles the premium glassmorphic UI and high-frequency streaming over IPC.
2. **Backend (FastAPI)**: A lightweight Python transition layer that orchestrates model interactions, file system access, and system telemetry.
3. **Inference Engine (Ollama)**: Manages local model deployment and high-performance inference.

## Installation

### Prerequisites

- **Node.js** (v18+)
- **Python** (3.11+)
- **Ollama**: [Download here](https://ollama.com/)

### Setup

1. **Clone & Install Node Dependencies**
   ```bash
   git clone https://github.com/Abdul03Rafay/GIREI.git
   cd GIREI
   npm install
   ```

2. **Setup Python Environment**
   ```bash
   pip3 install -r backend/requirements.txt
   # Or manually: pip3 install fastapi uvicorn requests psutil
   ```

3. **Deploy the Model**
   ```bash
   ollama pull deepseek-r1:7b
   ```

## Usage

- **Launch**: Run `npm start` to initialize both the Electron frontend and the FastAPI backend.
- **Toggle Home**: `Option + Space` (Command Palette style).
- **New Line**: `Cmd + Enter`.
- **Context Handling**: Use the built-in file attachment logic to feed project files directly to the model.

## License

ISC — Built with passion for the sovereign builder.
