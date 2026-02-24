# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev mode — run TypeScript directly (no build step needed)
npx tsx src/cli.ts

# Build to dist/
npm run build

# Type check only
npm run type-check
```

No test framework is configured. There are no lint scripts.

## Architecture

OpenSwarm is a CLI that connects multiple LLM agents into a group chat via `@mention` orchestration. It is a pure Node.js ESM project with only 2 runtime dependencies (`chalk`, `ora`).

### Agent Modes

Agents can operate in two modes, configured per-agent in `swarm.config.json`:

1. **Workspace mode** (`workspace` field): Points to an OpenClaw workspace directory. OpenSwarm spawns an `openclaw gateway run` process for each such agent, waits for its HTTP health check, then connects to it at `http://localhost:{auto-assigned-port}/v1`. Auth and model come from the workspace's `openclaw.json`.

2. **Direct API mode** (`url` field): Points to any OpenAI-compatible endpoint directly. System prompts are auto-generated if not specified. API keys come from environment variables.

### Core Data Flow

```
cli.ts (REPL) → Orchestrator → OpenClawConnection (per agent)
                     ↓
              Renderer (terminal output)
              SessionManager (disk persistence)
```

### Key Source Files

- **`src/cli.ts`** — Entry point. Handles subcommands (`init`, `up`, `down`), loads config, manages the readline REPL, and wires `Orchestrator` → `Renderer` → `SessionManager`.
- **`src/orchestrator.ts`** — Core `@mention` engine. Sends user messages to the master agent, detects `@name` patterns in responses, routes them to target agents in parallel (recursively), collects results, sends them back to master for synthesis. Enforces `maxMentionDepth` (default 3) and a global cap of 20 mentions per message.
- **`src/connection.ts`** — `OpenClawConnection`: HTTP client for a single agent. Streams SSE responses, maintains per-agent conversation history for multi-turn context, tracks tool calls from streaming deltas.
- **`src/config.ts`** — Loads and validates `swarm.config.json`. Auto-assigns ports to workspace agents (starting at `19001`). Auto-generates system prompts for url-mode agents without one. Reads `SOUL.md` from workspace agents for display context.
- **`src/spawn.ts`** — `SpawnManager`: Spawns `openclaw gateway run` subprocesses for workspace agents. Provisions auth by copying `~/.openclaw/agents/main/agent/auth-profiles.json` into each workspace. Polls `/v1/chat/completions` to detect readiness. Saves PIDs to `~/.openswarm/pids.json` for `openswarm down`.
- **`src/session.ts`** — `SessionManager`: Persists conversations to `~/.openswarm/sessions/{id}.json`. Atomic writes (temp file + rename). Saves on milestone events only (`user_message`, `done`, `end`).
- **`src/init.ts`** — Interactive wizard. Scaffolds `agents/{name}/openclaw.json`, `agents/{name}/workspace/SOUL.md`, `agents/{name}/workspace/AGENTS.md`, and `swarm.config.json`.
- **`src/types.ts`** — All shared TypeScript types. `OrchestratorEvent` is the union type used to communicate between `Orchestrator`, `Renderer`, and `SessionManager`.

### `@mention` Orchestration Details

The orchestrator uses a regex built from all agent names (`@(agent1|agent2|...)\b`). When master responds with `@researcher do X @coder do Y`, both are extracted and processed in parallel via `Promise.all`. Results come back as `[Thread] @researcher replied: ...` and are sent back to master for synthesis. This recurses up to `maxMentionDepth` levels, with a per-branch visited set to prevent cycles.

### Graceful Shutdown (Windows-specific)

The shutdown path in `cli.ts` avoids calling `process.exit()` directly. Instead it closes readline, destroys stdin (removes the libuv handle), and sets `process.exitCode`. This prevents `UV_HANDLE_CLOSING` assertion failures on Windows.

### Config Schema (`swarm.config.json`)

```json
{
  "agents": {
    "<name>": {
      "workspace": "./agents/<name>",   // OR "url": "https://..."
      "label": "Display Name",
      "color": "indigo",                // indigo|green|amber|cyan|purple|red|blue|pink
      "model": "gemini-2.5-flash",      // Direct API only
      "token": "...",                    // Direct API only (auto-filled from .env)
      "systemPrompt": "..."             // Direct API only (auto-generated if omitted)
    }
  },
  "master": "<name>",
  "maxMentionDepth": 3,
  "timeout": 120000,
  "sessionPrefix": "openswarm"
}
```

Each workspace agent directory must contain `openclaw.json` with a `gateway` section. The `init` wizard creates this automatically.
