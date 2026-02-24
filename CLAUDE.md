# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev mode — run TypeScript directly (no build step needed)
npx tsx src/cli.ts

# Init wizard — discovers running OpenClaw gateways and writes swarm.config.json
npx tsx src/cli.ts init

# Build to dist/
npm run build

# Type check only
npm run type-check
```

No test framework is configured. There are no lint scripts.

## Architecture

OpenSwarm is a CLI that connects multiple LLM agents into a group chat via `@mention` orchestration. It is a pure Node.js ESM project with only 2 runtime dependencies (`chalk`, `ora`).

**OpenSwarm does NOT manage OpenClaw processes.** Users run their own OpenClaw gateways; OpenSwarm discovers them and connects them into a swarm. The `up`/`down` subcommands are deprecated.

### Agent Modes

Agents in `swarm.config.json` can be configured via:

1. **Port mode** (`port` field): Connects to `http://localhost:{port}/v1`. This is the primary mode — `openswarm init` discovers running OpenClaw gateways and auto-populates ports.
2. **URL mode** (`url` field): Points to any OpenAI-compatible endpoint directly.

Token is auto-read from `~/.openclaw/openclaw.json` at startup; can be overridden per-agent.

### Agent Self-Consciousness

Every agent gets a rich system prompt at connection time with its identity, endpoint, model, and full team roster. Every delegated inter-agent message is prepended with a `[SWARM CONTEXT]` block containing sender/receiver info, models, endpoints, team roster, and depth.

### Core Data Flow

```
cli.ts (REPL) → Orchestrator → OpenClawConnection (per agent)
                     ↓
              Renderer (terminal output)
              SessionManager (disk persistence)
```

### Key Source Files

- **`src/cli.ts`** — Entry point. Handles subcommands (`init`), loads config, manages the readline REPL, and wires `Orchestrator` → `Renderer` → `SessionManager`. Uses single-readline + line-event promise queue pattern for MSYS/Git Bash compatibility.
- **`src/orchestrator.ts`** — Core `@mention` engine. Sends user messages to the master agent, detects `@name` patterns in responses, routes them to target agents in parallel (recursively), collects results, sends them back to master for synthesis. Prepends `[SWARM CONTEXT]` blocks to delegated messages. Enforces `maxMentionDepth` (default 3) and a global cap of 20 mentions per message.
- **`src/connection.ts`** — `OpenClawConnection`: HTTP client for a single agent. Streams SSE responses, maintains per-agent conversation history for multi-turn context, tracks tool calls from streaming deltas. Injects system prompt into history for all agents.
- **`src/config.ts`** — Loads and validates `swarm.config.json`. Auto-reads global token from `~/.openclaw/openclaw.json`. Builds rich swarm-identity system prompts for every agent with team roster, endpoints, and models.
- **`src/discover.ts`** — Gateway discovery. Reads `~/.openclaw/openclaw.json` for primary port/token/model, parses today's OpenClaw log for additional gateways, health-checks each candidate port.
- **`src/session.ts`** — `SessionManager`: Persists conversations to `~/.openswarm/sessions/{id}.json`. Atomic writes. Saves on milestone events only.
- **`src/init.ts`** — Discovery wizard. Calls `discoverGateways()`, presents numbered selection menus for assigning agents to discovered gateways, writes `swarm.config.json`.
- **`src/spawn.ts`** — **DEPRECATED.** Retained for reference but not imported by cli.ts.
- **`src/types.ts`** — All shared TypeScript types. `OrchestratorEvent` is the union type used between `Orchestrator`, `Renderer`, and `SessionManager`.

### `@mention` Orchestration Details

The orchestrator uses a regex built from all agent names (`@(agent1|agent2|...)\b`). When master responds with `@researcher do X @coder do Y`, both are extracted and processed in parallel via `Promise.all`. Results come back as `[Thread] @researcher replied: ...` and are sent back to master for synthesis. This recurses up to `maxMentionDepth` levels, with a per-branch visited set to prevent cycles.

### Graceful Shutdown (Windows-specific)

The shutdown path in `cli.ts` avoids calling `process.exit()` directly. Instead it closes readline, destroys stdin (removes the libuv handle), and sets `process.exitCode`. This prevents `UV_HANDLE_CLOSING` assertion failures on Windows.

### REPL (MSYS/Git Bash)

In MSYS/Git Bash, stdin is a pipe (`FILE_TYPE_PIPE`), not a TTY. Creating/closing readline per question corrupts stdin state (nodejs/node#21771, #5620). The fix: create ONE readline interface, use the `line` event + a promise queue, `terminal: false`, never close mid-session.

### Config Schema (`swarm.config.json`)

```json
{
  "agents": {
    "<name>": {
      "port": 18789,                   // OR "url": "https://..."
      "label": "Display Name",
      "color": "indigo",               // indigo|green|amber|cyan|purple|red|blue|pink
      "model": "anthropic/claude-sonnet-4-5",
      "token": "...",                   // Optional override (auto-read from ~/.openclaw)
      "systemPrompt": "..."            // Optional override (auto-generated if omitted)
    }
  },
  "master": "<name>",
  "maxMentionDepth": 3,
  "timeout": 120000,
  "sessionPrefix": "openswarm"
}
```
