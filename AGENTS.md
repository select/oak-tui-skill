# AGENTS.md - Oak TUI Skill

Guidelines for AI coding agents working in this repository.

## Project Overview

Oak TUI Skill is a terminal UI for managing git worktrees, built with Bun and @opentui/core.
It runs in a tmux pane and provides a visual interface for navigating projects and worktrees.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Launch TUI in tmux pane (normal mode)
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh

# Launch TUI in dev mode with hot reload
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --dev

# Launch TUI in dev mode with debug logging
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --dev --debug

# Kill existing TUI instance
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --kill

# Check if TUI is already running
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --check-only

# View debug logs
tail -f ~/.local/share/git-worktree-manager/debug.log
```

### No Tests Currently

This project does not have a test suite. When adding tests, use Bun's built-in test runner:

```bash
bun test                    # Run all tests
bun test path/to/file.test.ts  # Run single test file
```

## Project Structure

```
scripts/
├── worktree-tui.ts          # Main entry point, keyboard handling, state management
├── lib/
│   ├── types.ts             # Type definitions (Worktree, ProjectNode, FileTreeNode)
│   ├── ui-renderer.ts       # UI components using @opentui/core
│   ├── project-manager.ts   # Git worktree operations, recent projects storage
│   ├── socket-manager.ts    # Single-instance enforcement via Unix socket
│   └── tmux-manager.ts      # Tmux pane/session management
└── components/
    └── file-tree.ts         # File tree component with lazy loading and search
```

## Code Style Guidelines

### Imports

Order imports as follows:

1. External packages (`@opentui/core`)
2. Node.js built-ins with `node:` prefix (`node:path`, `node:fs`, `node:os`)
3. Local modules (relative paths)

```typescript
// Good
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import type { ProjectNode } from "./types";

// Bad - missing node: prefix
import { execSync } from "child_process";
```

### Type Definitions

- Define interfaces in `scripts/lib/types.ts` for shared types
- Use `type` for unions and simple aliases, `interface` for object shapes
- Export types explicitly, use `import type` when importing only types

```typescript
// types.ts
export interface Worktree {
  path: string;
  branch: string;
  commit: string;
  isPrunable: boolean;
}

export type TabId = "projects" | "files";

// Importing
import type { Worktree, TabId } from "./types";
```

### Naming Conventions

- **Files**: kebab-case (`ui-renderer.ts`, `socket-manager.ts`)
- **Functions**: camelCase, verb-first (`getWorktrees`, `loadRecentProjects`, `renderFiles`)
- **Interfaces/Types**: PascalCase (`ProjectNode`, `UIComponents`, `FileTreeNode`)
- **Constants**: SCREAMING_SNAKE_CASE for sets/maps (`IGNORED_DIRS`, `FILE_ICONS`)
- **Component IDs**: kebab-case strings (`"content-box"`, `"tab-bar"`)

### OpenTUI Renderables

Import renderables directly from `@opentui/core`, NOT as renderer properties:

```typescript
// Good
import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
} from "@opentui/core";
const box = new BoxRenderable(renderer, { id: "my-box" });

// Bad - renderables are not properties of renderer
const box = new renderer.BoxRenderable(renderer, { id: "my-box" });
```

Use specific mouse handlers instead of generic `onMouse`:

```typescript
// Good
new BoxRenderable(renderer, {
  onMouseDown: () => handleClick(),
});

// Bad - can cause crashes during re-renders
new BoxRenderable(renderer, {
  onMouse: (event) => {
    if (event.type === "down") handleClick();
  },
});
```

### Error Handling

- Use try/catch for git commands and file operations
- Empty catch blocks are acceptable for non-critical operations (e.g., cleanup)
- Log errors in debug mode using the debug logging pattern

```typescript
// Debug logging pattern
const DEBUG = process.argv.includes("--debug");
function debugLog(message: string) {
  if (!DEBUG) return;
  const timestamp = new Date().toLocaleTimeString();
  appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`);
}

// Error handling
try {
  const result = execSync("git worktree list", { encoding: "utf-8" });
} catch (error) {
  debugLog(`Git command failed: ${error}`);
  return [];
}
```

### Async Patterns

- Use `async/await` for asynchronous operations
- Main entry uses a Promise to keep the process alive:

```typescript
async function main() {
  // ... setup
  await new Promise(() => {}); // Keep process alive
}
main();
```

### UI Component Patterns

- Always provide unique `id` for renderables (use `renderCounter` for dynamic items)
- Clear content before re-rendering using `clearContent()` helper
- Use `requestRender()` after state changes

```typescript
// Unique IDs for dynamic content
const projectBox = new BoxRenderable(renderer, {
  id: `project-${renderCounter}-${index}`,
});

// Clear and re-render pattern
clearContent(contentScroll);
renderProjects(renderer, contentScroll, projectNodes, state, onUpdate);
renderer.requestRender();
```

### Data Storage

User data is stored in `~/.local/share/git-worktree-manager/`:

- `recent-projects.json` - List of recently accessed project paths
- `debug.log` - Debug output when `--debug` flag is used
- `tui.sock` - Unix socket for single-instance enforcement

## Color Scheme (OpenCode Theme)

Use these colors for consistency with OpenCode:

| Purpose             | Hex       |
| ------------------- | --------- |
| Background          | `#0a0a0a` |
| Panel/Header/Footer | `#141414` |
| Primary accent      | `#fab283` |
| Text                | `#eeeeee` |
| Text muted          | `#808080` |
| Blue (directories)  | `#5c9cf5` |
| Green (git/success) | `#7fd88f` |
| Error               | `#e06c75` |

## Common Gotchas

1. **Symlink**: This project may be symlinked from `~/.config/opencode/skills/oak-tui-skill`
2. **Single instance**: The TUI enforces single-instance via Unix socket - kill existing before restart
3. **Tmux required**: The TUI is designed to run in a tmux pane
4. **Bun runtime**: Use `bun` not `node` - the project uses Bun-specific APIs

## Debugging the TUI

**IMPORTANT**: The TUI runs in tmux, NOT in a browser. Do NOT use browser DevTools or screenshots for debugging.

### Debug Methods

1. **Debug logs** - Launch with `--debug` flag and tail the log file:

   ```bash
   ~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --dev --debug
   tail -f ~/.local/share/git-worktree-manager/debug.log
   ```

2. **Tmux capture** - Capture the current tmux pane content:

   ```bash
   # Capture visible pane content
   tmux capture-pane -t oak-tui -p

   # Capture with history (last 100 lines)
   tmux capture-pane -t oak-tui -p -S -100
   ```

3. **Send keys to TUI** - Interact with the TUI programmatically:

   ```bash
   # Send a key (e.g., 'j' to move down)
   tmux send-keys -t oak-tui j

   # Send Enter key
   tmux send-keys -t oak-tui Enter

   # Send Escape key
   tmux send-keys -t oak-tui Escape
   ```

4. **Check if TUI is running**:
   ```bash
   tmux list-panes -t oak-tui 2>/dev/null && echo "Running" || echo "Not running"
   ```

### Adding Debug Statements

Use the `debugLog()` function in code to add debug output:

```typescript
debugLog(
  `State changed: selectedIndex=${selectedIndex}, activeTab=${activeTab}`,
);
debugLog(`Issue data: ${JSON.stringify(issue, null, 2)}`);
```

# Beads Workflow Context

> **Context Recovery**: Run `bd prime` after compaction, clear, or new session
> Hooks auto-call this in Claude Code when .beads/ detected

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. git status              (check what changed)
[ ] 2. git add <files>         (stage code changes)
[ ] 3. bd sync --from-main     (pull beads updates from main)
[ ] 4. git commit -m "..."     (commit code changes)
```

**Note:** This is an ephemeral branch (no upstream). Code is merged to main locally, not pushed.

## Core Rules

- Track ALL work in beads (no TodoWrite tool, no markdown TODOs)
- Use `bd create` to create issues, not TodoWrite tool
- Git workflow: hooks auto-sync, run `bd sync` at session end
- Session management: check `bd ready` for available work

## Essential Commands

### Finding Work

- `bd ready` - Show issues ready to work (no blockers)
- `bd list --status=open` - All open issues
- `bd list --status=in_progress` - Your active work
- `bd show <id>` - Detailed issue view with dependencies

### Creating & Updating

- `bd create --title="..." --type=task|bug|feature` - New issue
- `bd update <id> --status=in_progress` - Claim work
- `bd update <id> --assignee=username` - Assign to someone
- `bd close <id>` - Mark complete
- `bd close <id1> <id2> ...` - Close multiple issues at once (more efficient)
- `bd close <id> --reason="explanation"` - Close with reason
- **Tip**: When creating multiple issues/tasks/epics, use parallel subagents for efficiency

### Dependencies & Blocking

- `bd dep add <issue> <depends-on>` - Add dependency (issue depends on depends-on)
- `bd blocked` - Show all blocked issues
- `bd show <id>` - See what's blocking/blocked by this issue

### Project Health

- `bd stats` - Project statistics (open/closed/blocked counts)

## Common Workflows

**Starting work:**

```bash
bd ready           # Find available work
bd show <id>       # Review issue details
bd update <id> --status=in_progress  # Claim it
```

**Completing work:**

```bash
bd close <id1> <id2> ...    # Close all completed issues at once
bd sync                     # Push to remote
```

**Creating dependent work:**

```bash
# Run bd create commands in parallel (use subagents for many items)
bd create --title="Implement feature X" --type=feature
bd create --title="Write tests for X" --type=task
bd dep add beads-yyy beads-xxx  # Tests depend on Feature (Feature blocks tests)
```
