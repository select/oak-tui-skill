# Oak TUI

A terminal UI for managing git worktrees, built with [Bun](https://bun.sh) and [@opentui/core](https://github.com/opentui/opentui).

## Screenshots

<p align="center">
  <img src="./screenshots/Screenshot from 2026-02-27 13-53-55.png" alt="Board View" width="24%">
  <img src="./screenshots/Screenshot from 2026-02-27 13-54-01.png" alt="File Browser" width="24%">
  <img src="./screenshots/Screenshot from 2026-02-27 13-54-12.png" alt="Theme Selector" width="24%">
  <img src="./screenshots/Screenshot from 2026-02-27 13-54-18.png" alt="Worktree View" width="24%">
</p>

<p align="center">
  <img src="./screenshots/Screenshot from 2026-02-27 13-54-38.png" alt="Issue Detail" width="24%">
  <img src="./screenshots/Screenshot from 2026-02-27 13-54-51.png" alt="Search View" width="24%">
  <img src="./screenshots/Screenshot from 2026-02-27 13-55-02.png" alt="Delete Confirmation" width="24%">
</p>

## Highlights

- **Visual worktree management** — Navigate projects and worktrees with keyboard or mouse
- **Tmux integration** — Track panes per worktree, focus existing or spawn new terminals
- **File browser** — Explore worktree contents with fuzzy search
- **Issue tracking** — Built-in [Beads](https://github.com/steveyegge/beads) integration for local issue management
- **Themeable** — 8 built-in themes (Catppuccin, Dracula, Gruvbox, Tokyo Night, and more)
- **Single instance** — Unix socket ensures only one TUI runs at a time

## Features

### Project & Worktree Navigation

- Hierarchical view: Projects → Worktrees → Tmux Panes
- Visual indicators for active (`●`) and background (`◌`) panes
- Click to focus panes, press `n` to spawn new terminals
- Auto-expands worktrees with background activity

### Integrated Tabs

| Tab | Key | Description |
|-----|-----|-------------|
| Projects | `1` | Browse projects and worktrees |
| Board | `2` | View and manage Beads issues |
| Files | `3` | File tree with fuzzy search |
| Themes | `4` | Switch between color themes |

### Keyboard Navigation

| Key | Action | Context |
|-----|--------|---------|
| `j` / `k` | Navigate ↓/↑ | All tabs |
| `h` / `l` | Navigate ←/→ (collapse/expand) | All tabs |
| `Ctrl+←` / `Ctrl+→` | Switch tabs | All tabs |
| `Enter` | Expand/collapse or focus pane | All tabs |
| `n` | New pane for worktree | Projects only |
| `d` | Remove project | Projects only |
| `y` | Yank (copy to clipboard) | Board (issue ID), Files (file path) |
| `/` | Search | Projects, Board, Files |
| `Tab` | Cycle tabs (alternative) | All tabs |
| `q` | Quit | All tabs |

## Installation

This is an [Agent Skill](https://agentskills.io/specification) designed for AI coding agents. To install:

```bash
# Clone into your skills directory with the name 'oak-tree-skill'
git clone https://github.com/youruser/oak-tui-skill.git ~/.config/opencode/skills/oak-tree-skill

# Install dependencies
cd ~/.config/opencode/skills/oak-tree-skill
bun install
```

**Note**: The directory name must be `oak-tree-skill` (as specified in `SKILL.md`) for AI agents to discover and load this skill correctly.

## Usage

### For AI Agents

This skill is automatically activated when you mention keywords like "oak", "worktree", or "git worktree" in your conversation with an AI coding agent.

**To invoke the skill:**
```
"Show me oak" or "Open the worktree TUI" or "Launch oak"
```

The agent will:
1. Check if an instance is already running
2. Ask if you want to restart (if existing) or launch fresh
3. Open the TUI in a tmux pane on the right side of your current window

For full agent instructions, see the [SKILL.md](SKILL.md) file.

### For Manual Use

Oak TUI runs inside a tmux pane. Use the launch script directly:

```bash
# Launch TUI (creates tmux pane if needed)
~/.config/opencode/skills/oak-tree-skill/scripts/launch.sh

# Launch in dev mode with hot reload
~/.config/opencode/skills/oak-tree-skill/scripts/launch.sh --dev

# Launch with debug logging
~/.config/opencode/skills/oak-tree-skill/scripts/launch.sh --dev --debug

# Restart existing instance (fast, ~100ms)
~/.config/opencode/skills/oak-tree-skill/scripts/launch.sh --restart

# Kill existing instance
~/.config/opencode/skills/oak-tree-skill/scripts/launch.sh --kill
```

### Configuration

Configuration files are stored in `~/.config/oak-tui/`:

- `config.yaml` — Project order and settings
- `projects.yaml` — Runtime state (auto-generated)

Debug logs are written to `~/.local/share/oak-tui/debug.log` when using `--debug`.

## Project Structure

```
oak-tui-skill/
├── scripts/
│   ├── components/
│   │   ├── confirm-popup.ts    # Confirmation dialog
│   │   ├── file-tree.ts        # File browser with search
│   │   ├── issue-popup.ts      # Issue detail view
│   │   └── modal.ts            # Reusable modal system
│   ├── lib/
│   │   ├── themes/
│   │   │   ├── catppuccin.ts   # Catppuccin Mocha
│   │   │   ├── dark.ts         # Default dark theme
│   │   │   ├── dracula.ts      # Dracula
│   │   │   ├── gruvbox.ts      # Gruvbox Dark
│   │   │   ├── one-dark.ts     # Atom One Dark
│   │   │   ├── opencode.ts     # OpenCode theme
│   │   │   ├── tokyonight.ts   # Tokyo Night
│   │   │   └── index.ts        # Theme registry
│   │   ├── beads-manager.ts    # Beads issue integration
│   │   ├── clipboard-utils.ts  # System clipboard access
│   │   ├── config-manager.ts   # YAML config handling
│   │   ├── constants.ts        # App constants
│   │   ├── debug-utils.ts      # Debug logging utilities
│   │   ├── footer.ts           # Context-sensitive footer
│   │   ├── project-manager.ts  # Git worktree operations
│   │   ├── project-state.ts    # YAML state management
│   │   ├── socket-manager.ts   # Single-instance enforcement
│   │   ├── string-utils.ts     # String helpers
│   │   ├── theme-manager.ts    # Theme switching logic
│   │   ├── tmux-manager.ts     # Tmux pane/session control
│   │   ├── type-guards.ts      # Runtime type checking
│   │   ├── types.ts            # TypeScript interfaces
│   │   └── ui-renderer.ts      # UI components & rendering
│   ├── launch.sh               # Tmux launch script
│   ├── send-restart.ts         # Hot reload trigger
│   └── worktree-tui.ts         # Main entry point
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- [Bun](https://bun.sh) >= 1.0
- [tmux](https://github.com/tmux/tmux) >= 3.0
- Git with worktree support

## Development

```bash
# Run with hot reload
./scripts/launch.sh --dev

# View debug logs in another terminal
tail -f ~/.local/share/oak-tui/debug.log

# Lint code
bun lint

# Fix lint issues
bun lint:fix
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **TUI Framework**: [@opentui/core](https://github.com/opentui/opentui)
- **Search**: [Fuse.js](https://fusejs.io/) for fuzzy matching
- **Config**: [js-yaml](https://github.com/nodeca/js-yaml) for YAML parsing

## License

MIT
