# Timeskein Makefile
# Common development commands

.PHONY: install build-contracts mock-server dev agent-build desktop-build clean help

# Default target
help:
	@echo "Timeskein development commands:"
	@echo ""
	@echo "  make install        - Install all dependencies"
	@echo "  make build-contracts - Build contracts package"
	@echo "  make mock-server    - Start mock API server (port 3456)"
	@echo "  make dev            - Start frontend dev server (port 5173)"
	@echo "  make dev-all        - Start mock-server and frontend (requires tmux or run separately)"
	@echo ""
	@echo "Native build (requires Rust + MSVC):"
	@echo "  make agent-build    - Build Rust agent"
	@echo "  make desktop-build  - Build Tauri desktop app"
	@echo ""
	@echo "  make clean          - Clean build artifacts"

# Install dependencies
install:
	CI=true pnpm install

# Build contracts package
build-contracts:
	pnpm --filter @timeskein/contracts build

# Start mock server
mock-server: build-contracts
	pnpm mock-server

# Start frontend dev server
dev:
	cd apps/desktop && pnpm dev

# Quick start: just run dev (assumes mock-server running in another terminal)
start: dev

# Build Rust agent (requires MSVC on Windows)
agent-build:
	cd apps/agent && cargo build --release

# Build Tauri desktop app
desktop-build:
	cd apps/desktop && pnpm tauri build

# Clean build artifacts
clean:
	rm -rf apps/agent/target
	rm -rf apps/desktop/dist
	rm -rf apps/desktop/src-tauri/target
	rm -rf packages/contracts/dist
	rm -rf node_modules
	rm -rf apps/desktop/node_modules
	rm -rf packages/contracts/node_modules
	rm -rf packages/mock-server/node_modules

# Full setup for first-time users
setup: install build-contracts
	@echo ""
	@echo "Setup complete! To start development:"
	@echo "  Terminal 1: make mock-server"
	@echo "  Terminal 2: make dev"
	@echo ""
	@echo "Then open http://localhost:5173 in browser"
