# Timeskein

**Manual-first, local-first work inventory system.**

A desktop application for quickly tracking work items with refs (URLs, files, issue keys) using a global hotkey palette, without any background monitoring.

## Project Structure

```
timeskein/
├── apps/
│   ├── agent/         # Rust backend with SQLite, Local API
│   └── desktop/       # Tauri desktop app (React + Tailwind)
├── packages/
│   ├── contracts/     # Shared TypeScript types/DTOs
│   └── mock-server/   # Mock API for development
└── docs/              # Project documentation
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Rust (latest stable)

### Development

```bash
# Install dependencies
pnpm install

# Build contracts package
pnpm --filter @timeskein/contracts build

# Start mock server (for UI development)
pnpm mock-server

# In another terminal, start desktop app
cd apps/desktop
pnpm dev
```

### Building

```bash
# Build agent
cd apps/agent
cargo build --release

# Build desktop app
cd apps/desktop
pnpm build
```

## Architecture

- **Agent**: Rust service with SQLite database, exposes Local API on localhost
- **Desktop**: Tauri app with React frontend, global hotkey palette
- **Local API**: JSON-RPC style API for UI ↔ Agent communication

## Key Features (MVP)

- Manual work item management (CRUD)
- Refs: URLs, file paths, issue keys
- Global hotkey overlay palette
- System tray integration
- Denylist for privacy protection

## License

MIT
