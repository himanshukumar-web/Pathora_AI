# Pathora_AI

**Pathora AI** is an AI-powered assistive vision and obstacle awareness web prototype designed to aid visually impaired individuals by detecting objects, potential hazards, and providing real-time voice alerts.

> [!WARNING]
> **Safety Advisory**: Pathora AI is an experimental assistive prototype and is **NOT** a certified safety device or a replacement for a white cane or guide dog. Never rely solely on camera predictions for road crossings or hazard avoidance.

---

## Features

- **Live Object Detection**: Powered by Google MediaPipe Tasks Vision (`EfficientDet-Lite0`, Apache-2.0). Runs 100% locally in the browser with WebGL/GPU acceleration.
- **Bilingual Voice Alerts**: Real-time spoken announcements in **English** and **Hindi (हिन्दी)** with alert deduplication and obstacle prioritization.
- **Accessible Design**: High-contrast dark theme, large touch targets, keyboard navigation, and screen-reader announcements (`aria-live`).
- **Zero API Keys Required**: Completely free and open-source inference running on client hardware.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **AI / Computer Vision**: `@mediapipe/tasks-vision`
- **Speech**: Web Speech API (`SpeechSynthesis`)
- **Styling**: Accessible Vanilla CSS

---

## Getting Started

### 1. Prerequisites
- Node.js (v18+)
- npm or yarn

### 2. Installation
```bash
npm install
```

### 3. Run Locally
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## License

- Code: MIT License
- AI Model (`EfficientDet-Lite0`): Apache License 2.0
