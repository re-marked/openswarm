# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev mode — run TypeScript directly (no build step needed)
npx tsx src/cli.ts

# Init wizard — discovers OpenClaw agents and writes swarm.config.json
npx tsx src/cli.ts init

# Build to dist/
npm run build

# Type check only
npm run type-check
```

No test framework is configured. There are no lint scripts.

## Architecture

OpenSwarm is a CLI that connects multiple LLM agents into an async group chat via `@mention` routing. It renders a Discord-style TUI using `ink` (React for CLIs). Runtime deps: `chalk`, `ink`, `react`.

**Single-gateway model:** All agents share one OpenClaw gateway on one port (e.g. 18789). Agent routing is via the `x-openclaw-agent-id` HTTP header. Session persistence via the `user` field in request bodies.

### Core Data Flow

```
cli.ts (entry) → GroupChat (async message bus) → OpenClawConnection (per agent)
                       ↓
                  ink TUI (React components)
                  SessionManager (disk persistence)
```

### Key Source Files

- **`src/cli.ts`** — Entry point. Handles subcommands (`init`), loads config, creates `GroupChat`, launches the ink TUI, wires session persistence.
- **`src/groupchat.ts`** — `GroupChat`: async message bus. Routes user messages to agents, detects `@mentions` in responses, auto-routes to other agents, handles dynamic agent spawning. Emits `GroupChatEvent` for the TUI.
- **`src/connection.ts`** — `OpenClawConnection`: HTTP client for a single agent via the shared gateway. Routes via `x-openclaw-agent-id` header. Streams SSE responses, maintains per-agent conversation history, tracks tool calls.
- **`src/config.ts`** — Loads and validates `swarm.config.json`. New format with `gateway` section. Auto-reads token from `~/.openclaw/openclaw.json`. Builds swarm-identity system prompts.
- **`src/discover.ts`** — Gateway + agent discovery. Reads `~/.openclaw/openclaw.json` for port, token, model, and `agents.list[]`. Also supports legacy log-based port discovery.
- **`src/session.ts`** — `SessionManager`: Persists flat `ChatMessage[]` to `~/.openswarm/sessions/{id}.json`. Atomic writes.
- **`src/init.ts`** — Discovery wizard. Reads OpenClaw config, lists discovered agents, lets user assign names/colors, writes `swarm.config.json`.
- **`src/types.ts`** — All shared TypeScript types. `GroupChatEvent` is the event union for TUI rendering. `ChatMessage` is the core message type.

### TUI Components (`src/tui/`)

- **`App.tsx`** — Root: manages state, wires GroupChat events to React state.
- **`StatusBar.tsx`** — Top bar: gateway info, session ID, agent count.
- **`MessageList.tsx`** — Main area: scrollable chat messages.
- **`Message.tsx`** — Single message: colored agent name + content.
- **`AgentSidebar.tsx`** — Right panel: agent list with live activity status.
- **`InputBox.tsx`** — Bottom: text input with history, slash commands.

### `@mention` Routing

GroupChat uses a regex matching ANY `@word` pattern. When an agent responds with `@researcher do X`, the message is auto-routed to that agent. Unknown @mentions auto-spawn new agents on the gateway. Recursion limited by `maxMentionDepth` (default 3) and global cap of 20 mentions per user message.

### Agent Self-Consciousness

Every agent gets a system prompt with its identity, agent ID, model, and full team roster. Inter-agent messages are prepended with `[SWARM CONTEXT]` blocks.

### Deprecated Files (excluded from build)

- `src/orchestrator.ts` — Replaced by `src/groupchat.ts`
- `src/renderer.ts` — Replaced by ink TUI components
- `src/spawn.ts` — Was already deprecated

### Config Schema (`swarm.config.json`)

```json
{
  "gateway": {
    "port": 18789,
    "token": "auto"
  },
  "agents": {
    "<name>": {
      "agentId": "main",
      "label": "Display Name",
      "color": "indigo",
      "model": "anthropic/claude-sonnet-4-5"
    }
  },
  "master": "<name>",
  "maxMentionDepth": 3,
  "timeout": 120000,
  "sessionPrefix": "openswarm"
}
```

- `gateway.port` + `gateway.token`: single gateway connection (token `"auto"` reads from `~/.openclaw/openclaw.json`)
- `agents[name].agentId`: the OpenClaw agent ID used in `x-openclaw-agent-id` header
- All agents share the gateway — no per-agent port/url needed
