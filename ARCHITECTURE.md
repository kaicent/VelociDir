# VelociDir Architecture

This document describes the technical architecture and design principles of **VelociDir**.

## Overview

VelociDir is a high-performance, multi-pane file explorer built with **Tauri v2**, **React**, and **Rust**. It follows a hybrid architecture:
- **Core Engine (Rust)**: Handles low-level filesystem operations, security validation, and performance-critical tasks.
- **UI & Interaction (React)**: Manages complex application state, window orchestration, and high-DPI rendering.

## Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | Rust + Tauri | IPC, FS Access, Terminal control |
| **Frontend** | React + TypeScript | State management, UI Components |
| **Styling** | Tailwind CSS | Design tokens, Glassmorphism UI |
| **Icons** | Lucide React | Professional iconography |
| **Build** | Vite | Modern frontend tooling |

---

## Backend Architecture (Rust)

The backend is located in `src-tauri/src/lib.rs`. It exposes a series of `tauri::command` functions that the frontend invokes over the IPC (Inter-Process Communication) bridge.

### Key Logic Modules:
- **Validation**: Every incoming path is validated via `is_valid_path` to prevent directory traversal and handle virtual paths like `root` (This PC).
- **File Transfer**: Optimized move/copy logic that handles cross-drive transfers (copy-then-delete) automatically.
- **Terminal Integration**: Platform-specific logic to spawn PowerShell (Windows) or Sh (Unix) with correct path escaping.
- **Media Previews**: Efficient partial file reading (via `BufReader`) to preview large text files without loading them entirely into memory.

---

## Frontend Architecture (React)

The frontend is a single-page application (SPA) centered around `src/App.tsx`.

### State Orchestration
VelociDir maintains a highly nested state to support its multi-tab/multi-pane layout:
```typescript
interface AppState {
  tabs: TabState[];           // List of browser-like tabs
  favorites: FileEntry[];    // User-pinned folders
  folderColors: Record<p, c> // User-defined visual labels
  expandedPaths: Record<id, p[]> // Persistent tree visibility
}
```

### Component Hierarchy
1. **`App`**: Root orchestrator for tabs and global context menus.
2. **`ExplorerPane`**: Manages a single file-list view, including search and sort controls.
3. **`TreeItem`**: A recursive component that renders the filesystem tree. It handles drag-and-drop, context menus, and keyboard navigation.
4. **`PreviewPane`**: A contextual media viewer that uses Tauri's `asset:` protocol for high-performance image/video rendering.

---

## Design Principles

### 1. Performance First
- **Lazy Loading**: Directory children are only loaded from the disk when a folder is expanded.
- **Partial Reads**: File previews are limited to the first 10KB by default.
- **Asset Protocol**: Native binary data is streamed to the UI via Tauri's internal asset protocol to avoid Base64 overhead.

### 2. Multi-Pane Productivity
The layout engine uses a dynamic `flex` system, allowing users to add infinitely many explorer containers and resize them with pixel precision.

### 3. Persistence
All application state (tabs, open paths, favorites, folder colors) is serialized and persisted to `localStorage` on every change, ensuring a seamless experience across application restarts.

### 4. Security
- **Path Sanitization**: All incoming paths are checked for malicious patterns.
- **Context Security**: Restricted IPC scope via `tauri.conf.json`.
