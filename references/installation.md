# Oak TUI Installation & Configuration

## Configuration

### Worktree Entry Commands

You can configure commands to run automatically when entering a worktree by creating a config file at `~/.config/oak-tui/config.yaml`.

**Priority order** (highest to lowest):

1. Worktree-specific commands
2. Project-specific commands
3. Global commands

**Example config:**

```yaml
# Global commands (run for all worktrees unless overridden)
global:
  commands:
    - "echo 'Welcome to worktree!'"

# Project-specific configuration
projects:
  /home/user/projects/my-project:
    commands:
      - "source .env"
      - "npm install"

    # Worktree-specific commands (highest priority)
    worktrees:
      /home/user/projects/my-project/worktrees/feature-branch:
        commands:
          - "echo 'Feature branch worktree'"
          - "npm run dev"
```

**Notes:**

- Commands execute sequentially with a 0.1s delay between them
- Commands only run when creating a NEW pane (not when recovering an existing background pane)
- Invalid or missing config falls back to default behavior (no commands)
- Config is reloaded on each worktree switch
