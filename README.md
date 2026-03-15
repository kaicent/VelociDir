<img src="https://github.com/kaicent/VelociDir/blob/main/src-tauri/icons/128x128@2x.png?raw=true" width="300">

# VelociDir
 
> [!WARNING]
> **VelociDir is under heavy development.** It operates with full system permissions to manage your files. Use with caution. Current builds are only tested on **Windows**.
 
**VelociDir** is a high-performance, premium multi-pane file explorer built for power users. Engineered with the speed of **Rust** and the fluidity of **React**, it offers a browser-like experience for your local filesystem with advanced window management and rich media integration.

## Why VelociDir?

While traditional file explorers are clunky and limited, VelociDir is designed for speed and professional workflows:

- **Fluid Multi-Pane Layout**: Side-by-side terminal-inspired file exploration. Add, resize, and manage multiple explorer panes within a single tab.
- **Turbo-Charged Previews**: Native, high-fidelity media previews (Images, Video, SVG) with optimized performance that doesn't slow down your system.
- **Power-User Context Actions**: Elevated execution (Run as Admin), path copying, and integrated terminal launching (PowerShell) exactly where you need it.
- **Modern UX**: A premium glassmorphism design system with smooth animations, responsive scaling, and high-DPI support.
- **Real-Time Filtering**: Instant search and highlighting within specific folders to find what you need in milliseconds.

## Download
 
 You can download the latest standalone executable for Windows from the [Releases](https://github.com/kaicent/VelociDir/releases) page.
 
 1. Go to the [Latest Release](https://github.com/kaicent/VelociDir/releases/latest).
 2. Under **Assets**, download the `.exe` or `.msi` file.
 3. Run the installer or standalone file to start VelociDir.
 
 ## Development Setup

- **Backend**: [Tauri v2](https://tauri.app/) (Rust)
- **Frontend**: [React](https://reactjs.org/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

## Getting Started

### Prerequisites for Development

- [Rust & Cargo](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (Version 22.12+ recommended)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/kaicent/VelociDir
    cd velocidir
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Run in Development Mode**:
    ```bash
    npm run tauri dev
    ```

4.  **Build for Production**:
    ```bash
    npm run tauri build
    ```

## License

This project is licensed under the [MIT License](LICENSE).

---
*Built with speed and aesthetics in mind.*
