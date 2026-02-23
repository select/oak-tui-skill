import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

interface WorktreeConfig {
  commands?: string[];
}

interface ProjectConfig {
  worktrees?: Record<string, WorktreeConfig>;
  commands?: string[];
}

interface OakConfig {
  global?: {
    commands?: string[];
  };
  projects?: Record<string, ProjectConfig>;
}

const CONFIG_PATH = join(homedir(), ".config", "oak-tui", "config.yaml");

/**
 * Load and parse the Oak TUI configuration file
 */
export function loadWorktreeConfig(): OakConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return null;
    }

    const fileContents = readFileSync(CONFIG_PATH, "utf-8");
    const config = yaml.load(fileContents);

    // Validate that config is an object
    if (typeof config !== "object" || config === null) {
      return null;
    }

    return config as OakConfig;
  } catch {
    // Invalid config - return null to use default behavior
    return null;
  }
}

/**
 * Get commands to execute when entering a worktree
 * Priority: worktree-specific > project-specific > global
 */
export function getCommandsForWorktree(
  worktreePath: string,
  projectPath: string,
): string[] {
  const config = loadWorktreeConfig();
  if (!config) {
    return [];
  }

  // Try worktree-specific commands first
  if (config.projects?.[projectPath]?.worktrees?.[worktreePath]?.commands) {
    return config.projects[projectPath].worktrees[worktreePath].commands;
  }

  // Try project-specific commands
  if (config.projects?.[projectPath]?.commands) {
    return config.projects[projectPath].commands;
  }

  // Fall back to global commands
  if (config.global?.commands) {
    return config.global.commands;
  }

  return [];
}
