// Project state management - tracks projects, worktrees, and panes in YAML
// State file location: ~/.config/oak-tui/projects.yaml

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import yaml from "js-yaml";
import { createDebugLogger } from "./debug-utils";

const DEBUG = process.argv.includes("--debug");
const debug = createDebugLogger(DEBUG);

// Config directory (user-facing config)
const CONFIG_DIR = join(homedir(), ".config", "oak-tui");
const STATE_FILE = join(CONFIG_DIR, "projects.yaml");
const CONFIG_FILE = join(CONFIG_DIR, "config.yaml");

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a tmux pane associated with a worktree
 */
export interface PaneState {
  paneId: string; // tmux pane ID (e.g., "%5")
  windowId: string; // tmux window ID (e.g., "@1")
  sessionName: string; // tmux session name (e.g., "oak-bg" or current session)
  currentPath: string; // Current working directory of the pane
  currentCommand: string; // Currently running command (e.g., "zsh", "node", "vim")
  createdAt: number; // Timestamp when pane was first tracked
  isBackground: boolean; // Whether pane is in oak-bg session
}

/**
 * Represents a git worktree within a project
 */
export interface WorktreeState {
  path: string; // Absolute path to worktree root
  branch: string; // Git branch name
  panes: PaneState[]; // List of panes open for this worktree
}

/**
 * Beads configuration for a project
 */
export interface BeadsConfig {
  enabled: boolean; // Whether project uses beads
  path?: string; // Relative path to .beads folder from project root (if not at root)
}

/**
 * Represents a project (git repository)
 */
export interface ProjectState {
  path: string; // Absolute path to main git root
  name: string; // Display name (usually basename of path)
  lastAccessed: number; // Timestamp of last access
  beads: BeadsConfig; // Beads configuration
  worktrees: Record<string, WorktreeState>; // Keyed by worktree path
}

/**
 * Root state structure
 */
export interface OakProjectsState {
  version: number; // Schema version for migrations
  projects: Record<string, ProjectState>; // Keyed by project path (main git root)
}

// ============================================================================
// Type Guards
// ============================================================================

function isPaneState(value: unknown): value is PaneState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // currentCommand is optional for backward compatibility with old state files
  return (
    typeof v.paneId === "string" &&
    typeof v.windowId === "string" &&
    typeof v.sessionName === "string" &&
    typeof v.currentPath === "string" &&
    typeof v.createdAt === "number" &&
    typeof v.isBackground === "boolean" &&
    (v.currentCommand === undefined || typeof v.currentCommand === "string")
  );
}

function isWorktreeState(value: unknown): value is WorktreeState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === "string" &&
    typeof v.branch === "string" &&
    Array.isArray(v.panes) &&
    v.panes.every(isPaneState)
  );
}

function isBeadsConfig(value: unknown): value is BeadsConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === "boolean" &&
    (v.path === undefined || typeof v.path === "string")
  );
}

function isProjectState(value: unknown): value is ProjectState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.path !== "string" ||
    typeof v.name !== "string" ||
    typeof v.lastAccessed !== "number" ||
    !isBeadsConfig(v.beads) ||
    typeof v.worktrees !== "object" ||
    v.worktrees === null
  ) {
    return false;
  }
  // Validate all worktrees
  for (const wt of Object.values(v.worktrees as Record<string, unknown>)) {
    if (!isWorktreeState(wt)) return false;
  }
  return true;
}

function isOakProjectsState(value: unknown): value is OakProjectsState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "number" || typeof v.projects !== "object" || v.projects === null) {
    return false;
  }
  // Validate all projects
  for (const proj of Object.values(v.projects as Record<string, unknown>)) {
    if (!isProjectState(proj)) return false;
  }
  return true;
}

// ============================================================================
// State Management
// ============================================================================

const CURRENT_VERSION = 1;

/**
 * Create empty state
 */
function createEmptyState(): OakProjectsState {
  return {
    version: CURRENT_VERSION,
    projects: {},
  };
}

/**
 * Load state from YAML file
 */
export function loadProjectsState(): OakProjectsState {
  try {
    if (!existsSync(STATE_FILE)) {
      debug("No projects state file found, returning empty state");
      return createEmptyState();
    }

    const fileContents = readFileSync(STATE_FILE, "utf-8");
    const parsed = yaml.load(fileContents);

    if (!isOakProjectsState(parsed)) {
      debug("Invalid state file format, returning empty state");
      return createEmptyState();
    }

    debug(`Loaded state with ${Object.keys(parsed.projects).length} projects`);
    return parsed;
  } catch (err) {
    debug("Error loading projects state:", err);
    return createEmptyState();
  }
}

/**
 * Save state to YAML file
 */
export function saveProjectsState(state: OakProjectsState): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    const yamlContent = yaml.dump(state, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });

    writeFileSync(STATE_FILE, yamlContent);
    debug(`Saved state with ${Object.keys(state.projects).length} projects`);
  } catch (err) {
    debug("Error saving projects state:", err);
  }
}

// ============================================================================
// Beads Detection
// ============================================================================

/**
 * Find .beads directory in a project, returns relative path or null
 */
export function findBeadsInProject(projectPath: string): string | null {
  const IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
    ".bun",
  ]);

  // Check root first
  if (existsSync(join(projectPath, ".beads"))) {
    return "."; // Beads at root
  }

  // BFS through subdirectories (max depth 3 to avoid deep scanning)
  const queue: Array<{ path: string; depth: number }> = [{ path: projectPath, depth: 0 }];
  const visited = new Set<string>();
  const MAX_DEPTH = 3;

  while (queue.length > 0) {
    const { path: currentPath, depth } = queue.shift()!;

    if (depth > MAX_DEPTH) continue;
    if (visited.has(currentPath)) continue;
    visited.add(currentPath);

    try {
      const { readdirSync, statSync } = require("node:fs");
      const entries = readdirSync(currentPath) as string[];

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry)) continue;

        const fullPath = join(currentPath, entry);

        try {
          const stats = statSync(fullPath);
          if (!stats.isDirectory()) continue;

          // Check if this directory contains .beads
          if (existsSync(join(fullPath, ".beads"))) {
            // Return relative path from project root
            return fullPath.replace(projectPath + "/", "").replace(projectPath, ".");
          }

          // Add to queue for further exploration
          queue.push({ path: fullPath, depth: depth + 1 });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Get git root for a path
 */
export function getGitRoot(path: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the main repository path (first worktree in git worktree list)
 */
export function getMainRepoPath(path: string): string | null {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    const lines = output.trim().split("\n");
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        return line.substring("worktree ".length);
      }
    }
    return getGitRoot(path);
  } catch {
    return null;
  }
}

/**
 * Get all worktrees for a repository
 */
export function getWorktreesForRepo(repoPath: string): Array<{ path: string; branch: string }> {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    const worktrees: Array<{ path: string; branch: string }> = [];
    const lines = output.trim().split("\n");
    let current: { path?: string; branch?: string } = {};

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        current.path = line.substring("worktree ".length);
      } else if (line.startsWith("branch ")) {
        current.branch = line.substring("branch ".length).replace("refs/heads/", "");
      } else if (line === "") {
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? "detached",
          });
        }
        current = {};
      }
    }

    // Handle last worktree if no trailing newline
    if (current.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? "detached",
      });
    }

    return worktrees;
  } catch {
    return [];
  }
}

// ============================================================================
// Tmux Operations
// ============================================================================

/**
 * Get tmux pane info
 */
export interface TmuxPaneInfo {
  paneId: string;
  windowId: string;
  sessionName: string;
  currentPath: string;
  currentCommand: string;
}

/**
 * Get all panes in a tmux session
 */
export function getTmuxPanesInSession(sessionName: string): TmuxPaneInfo[] {
  try {
    // First check if session exists
    execSync(`tmux has-session -t ${sessionName}`, { encoding: "utf-8", stdio: "pipe" });
    
    // Use -s flag to list all panes in the session (not -a which lists all sessions)
    const output = execSync(
      `tmux list-panes -s -t ${sessionName} -F '#{pane_id}|#{window_id}|#{session_name}|#{pane_current_path}|#{pane_current_command}'`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();

    if (!output) return [];

    return output.split("\n").map((line) => {
      const [paneId, windowId, session, currentPath, currentCommand] = line.split("|");
      return { paneId, windowId, sessionName: session, currentPath, currentCommand: currentCommand ?? "zsh" };
    });
  } catch {
    return [];
  }
}

/**
 * Get all panes in the current tmux session (excluding oak-tui pane)
 */
export function getCurrentSessionPanes(excludePaneId?: string): TmuxPaneInfo[] {
  try {
    const output = execSync(
      "tmux list-panes -F '#{pane_id}|#{window_id}|#{session_name}|#{pane_current_path}|#{pane_current_command}'",
      { encoding: "utf-8" }
    ).trim();

    if (!output) return [];

    return output
      .split("\n")
      .map((line) => {
        const [paneId, windowId, sessionName, currentPath, currentCommand] = line.split("|");
        return { paneId, windowId, sessionName, currentPath, currentCommand: currentCommand ?? "zsh" };
      })
      .filter((p) => p.paneId !== excludePaneId);
  } catch {
    return [];
  }
}

/**
 * Get all panes in the oak-bg session
 */
export function getBackgroundSessionPanes(): TmuxPaneInfo[] {
  return getTmuxPanesInSession("oak-bg");
}

/**
 * Check if a pane exists
 */
export function paneExists(paneId: string): boolean {
  try {
    const panes = execSync("tmux list-panes -a -F '#{pane_id}'", {
      encoding: "utf-8",
    })
      .trim()
      .split("\n");
    return panes.includes(paneId);
  } catch {
    return false;
  }
}

// ============================================================================
// State Sync Operations
// ============================================================================

/**
 * Find which worktree a path belongs to (exact match or subdirectory)
 */
function findWorktreeForPath(
  worktrees: Record<string, WorktreeState>,
  path: string
): string | null {
  // Try exact match first
  if (worktrees[path]) {
    return path;
  }

  // Try to find parent worktree
  for (const wtPath of Object.keys(worktrees)) {
    const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
    const normalizedPath = path.endsWith("/") ? path : path + "/";
    if (normalizedPath.startsWith(normalizedWt)) {
      return wtPath;
    }
  }

  return null;
}

/**
 * Sync pane state for a project - scan tmux and update pane tracking
 */
export function syncProjectPanes(
  state: OakProjectsState,
  projectPath: string,
  oakPaneId?: string
): boolean {
  const project = state.projects[projectPath];
  if (!project) {
    debug(`syncProjectPanes: project not found: ${projectPath}`);
    return false;
  }

  let changed = false;

  // Get all panes from current session and oak-bg
  const currentPanes = getCurrentSessionPanes(oakPaneId);
  const bgPanes = getBackgroundSessionPanes();
  // Filter out oak pane from background panes too (in case it was moved there)
  const filteredBgPanes = oakPaneId ? bgPanes.filter((p) => p.paneId !== oakPaneId) : bgPanes;
  const allPanes = [...currentPanes, ...filteredBgPanes];

  debug(`syncProjectPanes: found ${allPanes.length} total panes`);

  // Remove oak pane from tracking if it exists (should never be tracked)
  if (oakPaneId) {
    for (const wtPath of Object.keys(project.worktrees)) {
      const wt = project.worktrees[wtPath];
      const beforeLen = wt.panes.length;
      wt.panes = wt.panes.filter((p) => p.paneId !== oakPaneId);
      if (wt.panes.length !== beforeLen) {
        debug(`Removed oak pane ${oakPaneId} from tracking in ${wtPath}`);
        changed = true;
      }
    }
  }

  // First, remove stale panes from all worktrees
  for (const wtPath of Object.keys(project.worktrees)) {
    const wt = project.worktrees[wtPath];
    const validPanes = wt.panes.filter((p) => {
      const exists = paneExists(p.paneId);
      if (!exists) {
        debug(`Removing stale pane ${p.paneId} from ${wtPath}`);
        changed = true;
      }
      return exists;
    });
    if (validPanes.length !== wt.panes.length) {
      wt.panes = validPanes;
    }
  }

  // Then, add/update panes that belong to this project
  for (const paneInfo of allPanes) {
    const panePath = paneInfo.currentPath;

    // Check if this pane's path is within this project
    const paneGitRoot = getMainRepoPath(panePath);
    if (paneGitRoot !== projectPath) {
      continue; // Pane is not in this project
    }

    // Find which worktree this pane belongs to
    const wtPath = findWorktreeForPath(project.worktrees, panePath);
    if (!wtPath) {
      // Pane is in project but not in a tracked worktree - could be in main repo
      // Check if it's in the main repo worktree
      const mainWt = project.worktrees[projectPath];
      if (mainWt && panePath.startsWith(projectPath)) {
        // Add to main worktree
        const existingPane = mainWt.panes.find((p) => p.paneId === paneInfo.paneId);
        if (!existingPane) {
          const isBackground = paneInfo.sessionName === "oak-bg";
          mainWt.panes.push({
            paneId: paneInfo.paneId,
            windowId: paneInfo.windowId,
            sessionName: paneInfo.sessionName,
            currentPath: panePath,
            currentCommand: paneInfo.currentCommand,
            createdAt: Date.now(),
            isBackground,
          });
          debug(`Added pane ${paneInfo.paneId} to main worktree ${projectPath}`);
          changed = true;
        } else {
          // Update existing pane if path or command changed
          if (existingPane.currentPath !== panePath || existingPane.sessionName !== paneInfo.sessionName || existingPane.currentCommand !== paneInfo.currentCommand) {
            existingPane.currentPath = panePath;
            existingPane.sessionName = paneInfo.sessionName;
            existingPane.currentCommand = paneInfo.currentCommand;
            existingPane.isBackground = paneInfo.sessionName === "oak-bg";
            changed = true;
          }
        }
      }
      continue;
    }

    const wt = project.worktrees[wtPath];

    // Check if pane is already tracked
    const existingPane = wt.panes.find((p) => p.paneId === paneInfo.paneId);
    if (!existingPane) {
      // Add new pane
      const isBackground = paneInfo.sessionName === "oak-bg";
      wt.panes.push({
        paneId: paneInfo.paneId,
        windowId: paneInfo.windowId,
        sessionName: paneInfo.sessionName,
        currentPath: panePath,
        currentCommand: paneInfo.currentCommand,
        createdAt: Date.now(),
        isBackground,
      });
      debug(`Added pane ${paneInfo.paneId} to worktree ${wtPath}`);
      changed = true;
    } else {
      // Update existing pane if path, session or command changed
      if (existingPane.currentPath !== panePath || existingPane.sessionName !== paneInfo.sessionName || existingPane.currentCommand !== paneInfo.currentCommand) {
        existingPane.currentPath = panePath;
        existingPane.sessionName = paneInfo.sessionName;
        existingPane.currentCommand = paneInfo.currentCommand;
        existingPane.isBackground = paneInfo.sessionName === "oak-bg";
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Sync all projects' pane states
 */
export function syncAllProjectPanes(state: OakProjectsState, oakPaneId?: string): boolean {
  let changed = false;
  for (const projectPath of Object.keys(state.projects)) {
    if (syncProjectPanes(state, projectPath, oakPaneId)) {
      changed = true;
    }
  }
  return changed;
}

// ============================================================================
// Project Management
// ============================================================================

/**
 * Add or update a project in state
 */
export function addOrUpdateProject(state: OakProjectsState, projectPath: string): ProjectState {
  // Resolve to main repo path
  const mainPath = getMainRepoPath(projectPath) ?? projectPath;

  let project = state.projects[mainPath];

  if (!project) {
    // Create new project
    const beadsPath = findBeadsInProject(mainPath);
    project = {
      path: mainPath,
      name: basename(mainPath),
      lastAccessed: Date.now(),
      beads: {
        enabled: beadsPath !== null,
        path: beadsPath ?? undefined,
      },
      worktrees: {},
    };
    state.projects[mainPath] = project;
    debug(`Created new project: ${mainPath}`);
  } else {
    // Update last accessed
    project.lastAccessed = Date.now();
  }

  // Sync worktrees from git
  const gitWorktrees = getWorktreesForRepo(mainPath);
  for (const wt of gitWorktrees) {
    if (!project.worktrees[wt.path]) {
      project.worktrees[wt.path] = {
        path: wt.path,
        branch: wt.branch,
        panes: [],
      };
      debug(`Added worktree: ${wt.path} (${wt.branch})`);
    } else {
      // Update branch name in case it changed
      project.worktrees[wt.path].branch = wt.branch;
    }
  }

  // Remove worktrees that no longer exist in git
  const gitWorktreePaths = new Set(gitWorktrees.map((wt) => wt.path));
  for (const wtPath of Object.keys(project.worktrees)) {
    if (!gitWorktreePaths.has(wtPath)) {
      debug(`Removing deleted worktree: ${wtPath}`);
      delete project.worktrees[wtPath];
    }
  }

  return project;
}

/**
 * Remove a project from state
 */
export function removeProject(state: OakProjectsState, projectPath: string): boolean {
  if (state.projects[projectPath]) {
    delete state.projects[projectPath];
    debug(`Removed project: ${projectPath}`);
    return true;
  }
  return false;
}

/**
 * Get project by path (resolves worktree paths to main repo)
 */
export function getProject(state: OakProjectsState, path: string): ProjectState | null {
  // Try direct lookup first
  if (state.projects[path]) {
    return state.projects[path];
  }

  // Try to resolve to main repo
  const mainPath = getMainRepoPath(path);
  if (mainPath && state.projects[mainPath]) {
    return state.projects[mainPath];
  }

  return null;
}

/**
 * Check if a worktree has any panes (foreground or background)
 */
export function worktreeHasPanes(state: OakProjectsState, worktreePath: string): boolean {
  for (const project of Object.values(state.projects)) {
    const wt = project.worktrees[worktreePath];
    if (wt && wt.panes.length > 0) {
      return true;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt)) {
        const wt = project.worktrees[wtPath];
        if (wt && wt.panes.length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check if a worktree has background panes
 */
export function worktreeHasBackgroundPanes(state: OakProjectsState, worktreePath: string): boolean {
  for (const project of Object.values(state.projects)) {
    const wt = project.worktrees[worktreePath];
    if (wt && wt.panes.some((p) => p.isBackground)) {
      return true;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt)) {
        const wt = project.worktrees[wtPath];
        if (wt && wt.panes.some((p) => p.isBackground)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Get foreground pane for a worktree (if any)
 */
export function getWorktreeForegroundPane(
  state: OakProjectsState,
  worktreePath: string
): PaneState | null {
  for (const project of Object.values(state.projects)) {
    const wt = project.worktrees[worktreePath];
    if (wt) {
      const fgPane = wt.panes.find((p) => !p.isBackground);
      if (fgPane) return fgPane;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt)) {
        const wt = project.worktrees[wtPath];
        if (wt) {
          const fgPane = wt.panes.find((p) => !p.isBackground);
          if (fgPane) return fgPane;
        }
      }
    }
  }
  return null;
}

/**
 * Get background pane for a worktree (if any)
 */
export function getWorktreeBackgroundPane(
  state: OakProjectsState,
  worktreePath: string
): PaneState | null {
  for (const project of Object.values(state.projects)) {
    const wt = project.worktrees[worktreePath];
    if (wt) {
      const bgPane = wt.panes.find((p) => p.isBackground);
      if (bgPane) return bgPane;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt)) {
        const wt = project.worktrees[wtPath];
        if (wt) {
          const bgPane = wt.panes.find((p) => p.isBackground);
          if (bgPane) return bgPane;
        }
      }
    }
  }
  return null;
}

/**
 * Get all projects sorted by last accessed (most recent first)
 * @deprecated Use getProjectsInConfigOrder instead
 */
export function getProjectsSortedByAccess(state: OakProjectsState): ProjectState[] {
  return Object.values(state.projects).sort((a, b) => b.lastAccessed - a.lastAccessed);
}

/**
 * Get the order of projects from config.yaml
 * Returns an array of project paths in the order they appear in the config
 */
function getProjectOrderFromConfig(): string[] {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return [];
    }
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const config = yaml.load(content) as Record<string, unknown> | null;
    if (!config || typeof config !== "object" || !config.projects) {
      return [];
    }
    // Object.keys preserves insertion order in modern JS
    return Object.keys(config.projects as Record<string, unknown>);
  } catch {
    debug("Failed to read config.yaml for project order");
    return [];
  }
}

/**
 * Get all projects in the order specified by config.yaml
 * Projects not in config are appended at the end (sorted by lastAccessed)
 */
export function getProjectsInConfigOrder(state: OakProjectsState): ProjectState[] {
  const configOrder = getProjectOrderFromConfig();
  const result: ProjectState[] = [];
  const seen = new Set<string>();

  // First, add projects in config order
  for (const path of configOrder) {
    const project = state.projects[path];
    if (project) {
      result.push(project);
      seen.add(path);
    }
  }

  // Then, add remaining projects sorted by lastAccessed
  const remaining = Object.values(state.projects)
    .filter((p) => !seen.has(p.path))
    .sort((a, b) => b.lastAccessed - a.lastAccessed);

  return [...result, ...remaining];
}

/**
 * Get the set of worktree paths that have background panes.
 * Also returns the set of project paths that contain those worktrees.
 * Used for auto-expanding the tree to show background panes.
 */
export function getWorktreesWithBackgroundPanes(
  state: OakProjectsState,
): { projects: Set<string>; worktrees: Set<string> } {
  const projects = new Set<string>();
  const worktrees = new Set<string>();

  for (const project of Object.values(state.projects)) {
    for (const wt of Object.values(project.worktrees)) {
      const hasBgPanes = wt.panes.some((p) => p.isBackground);
      if (hasBgPanes) {
        projects.add(project.path);
        worktrees.add(wt.path);
      }
    }
  }

  return { projects, worktrees };
}

/**
 * Update pane tracking when a pane is moved to background
 */
export function markPaneAsBackground(
  state: OakProjectsState,
  paneId: string,
  currentPath: string
): void {
  // Find the pane in all projects/worktrees and update its status
  for (const project of Object.values(state.projects)) {
    for (const wt of Object.values(project.worktrees)) {
      const pane = wt.panes.find((p) => p.paneId === paneId);
      if (pane) {
        pane.isBackground = true;
        pane.currentPath = currentPath;
        pane.sessionName = "oak-bg";
        debug(`Marked pane ${paneId} as background in ${wt.path}`);
        return;
      }
    }
  }

  // Pane not found in existing tracking - it might need to be added
  // This will be handled by syncProjectPanes
  debug(`Pane ${paneId} not found in state, will be synced on next refresh`);
}

/**
 * Update pane tracking when a pane is brought to foreground
 */
export function markPaneAsForeground(
  state: OakProjectsState,
  paneId: string,
  sessionName: string
): void {
  for (const project of Object.values(state.projects)) {
    for (const wt of Object.values(project.worktrees)) {
      const pane = wt.panes.find((p) => p.paneId === paneId);
      if (pane) {
        pane.isBackground = false;
        pane.sessionName = sessionName;
        debug(`Marked pane ${paneId} as foreground in ${wt.path}`);
        return;
      }
    }
  }
}

/**
 * Remove a pane from tracking
 */
export function removePaneFromTracking(state: OakProjectsState, paneId: string): void {
  for (const project of Object.values(state.projects)) {
    for (const wt of Object.values(project.worktrees)) {
      const idx = wt.panes.findIndex((p) => p.paneId === paneId);
      if (idx !== -1) {
        wt.panes.splice(idx, 1);
        debug(`Removed pane ${paneId} from ${wt.path}`);
        return;
      }
    }
  }
}

// ============================================================================
// State Singleton for Global Access
// ============================================================================

let globalState: OakProjectsState | null = null;

/**
 * Initialize global state - call once at startup
 */
export function initProjectState(): OakProjectsState {
  globalState = loadProjectsState();
  debug(`Initialized global project state with ${Object.keys(globalState.projects).length} projects`);
  return globalState;
}

/**
 * Get global state (must be initialized first)
 */
export function getGlobalState(): OakProjectsState {
  if (!globalState) {
    globalState = loadProjectsState();
  }
  return globalState;
}

/**
 * Save global state
 */
export function saveGlobalState(): void {
  if (globalState) {
    saveProjectsState(globalState);
  }
}

/**
 * Sync global state from disk (reload)
 */
export function reloadGlobalState(): OakProjectsState {
  globalState = loadProjectsState();
  return globalState;
}

/**
 * Get the current active worktree path from the left pane
 * Queries tmux directly for real-time info
 */
export function getCurrentActiveWorktreePath(oakPaneId?: string): string | null {
  try {
    // Get the oak pane ID if not provided
    const currentOakPane = oakPaneId ?? execSync("tmux display-message -p '#{pane_id}'", {
      encoding: "utf-8",
    }).trim();

    // Get all panes in current window
    interface PaneInfo {
      id: string;
      left: number;
      top: number;
      path: string;
    }

    const output = execSync(
      "tmux list-panes -F '#{pane_id}|#{pane_left}|#{pane_top}|#{pane_current_path}'",
      { encoding: "utf-8" }
    ).trim();

    const panes: PaneInfo[] = output.split("\n").map((line) => {
      const [id, left, top, path] = line.split("|");
      return { id, left: parseInt(left), top: parseInt(top), path };
    });

    // Filter out the oak pane
    const otherPanes = panes.filter((p) => p.id !== currentOakPane);
    if (otherPanes.length === 0) return null;

    // Find the topmost-leftmost pane
    const topPanes = otherPanes.filter((p) => p.top === 0);
    if (topPanes.length > 0) {
      const sorted = [...topPanes].sort((a, b) => a.left - b.left);
      return sorted[0].path;
    }

    // Fallback to leftmost
    const sorted = [...otherPanes].sort((a, b) => a.left - b.left);
    return sorted[0].path;
  } catch {
    return null;
  }
}

/**
 * Find the project that contains a given path
 */
export function findProjectContainingPath(
  state: OakProjectsState,
  path: string
): ProjectState | null {
  // First check if path directly matches a project root
  if (state.projects[path]) {
    return state.projects[path];
  }

  // Check if path is within any project's worktrees
  for (const project of Object.values(state.projects)) {
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedPath = path.endsWith("/") ? path : path + "/";
      if (normalizedPath.startsWith(normalizedWt) || wtPath === path) {
        return project;
      }
    }
  }

  // Try to resolve git root and find project
  const mainPath = getMainRepoPath(path);
  if (mainPath && state.projects[mainPath]) {
    return state.projects[mainPath];
  }

  return null;
}

/**
 * Find the worktree that contains a given path
 */
export function findWorktreeContainingPath(
  state: OakProjectsState,
  path: string
): { project: ProjectState; worktree: WorktreeState } | null {
  for (const project of Object.values(state.projects)) {
    // Check exact match first
    if (project.worktrees[path]) {
      return { project, worktree: project.worktrees[path] };
    }

    // Check if path is within a worktree
    for (const [wtPath, wt] of Object.entries(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedPath = path.endsWith("/") ? path : path + "/";
      if (normalizedPath.startsWith(normalizedWt)) {
        return { project, worktree: wt };
      }
    }
  }

  return null;
}

// ============================================================================
// Tmux Pane Operations
// ============================================================================

/**
 * Get the current tmux session name
 */
export function getCurrentTmuxSession(): string | null {
  try {
    return execSync("tmux display-message -p '#{session_name}'", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Ensure the background session exists (detached)
 */
export function ensureBackgroundSession(): void {
  try {
    execSync("tmux has-session -t oak-bg 2>/dev/null", {
      encoding: "utf-8",
    });
  } catch {
    // Background session doesn't exist, create it detached
    execSync("tmux new-session -d -s oak-bg -x 80 -y 24");
  }
}

/**
 * Bring a background pane to foreground (swap with current left pane)
 */
export function bringPaneToForeground(
  paneId: string,
  oakPaneId: string
): { success: boolean; movedToBackgroundPaneId?: string } {
  debug(`Bringing pane ${paneId} to foreground`);

  try {
    // Get current left pane (the one to swap out)
    const currentSession = getCurrentTmuxSession();
    if (!currentSession) {
      debug("Could not get current session");
      return { success: false };
    }

    // Get all panes in current window
    const output = execSync(
      "tmux list-panes -F '#{pane_id}|#{pane_left}|#{pane_top}|#{pane_current_path}'",
      { encoding: "utf-8" }
    ).trim();

    interface PaneInfo {
      id: string;
      left: number;
      top: number;
      path: string;
    }

    const panes: PaneInfo[] = output.split("\n").map((line) => {
      const [id, left, top, path] = line.split("|");
      return { id, left: parseInt(left), top: parseInt(top), path };
    });

    // Find the leftmost pane (not oak pane)
    const otherPanes = panes.filter((p) => p.id !== oakPaneId);
    if (otherPanes.length === 0) {
      // No left pane, just move the background pane to foreground
      execSync(`tmux move-pane -h -b -t ${oakPaneId} -s ${paneId}`);
      debug("Moved pane to foreground (no existing left pane)");
      return { success: true };
    }

    const topPanes = otherPanes.filter((p) => p.top === 0);
    const sortedPanes = topPanes.length > 0
      ? [...topPanes].sort((a, b) => a.left - b.left)
      : [...otherPanes].sort((a, b) => a.left - b.left);
    const currentLeftPane = sortedPanes[0];

    if (!currentLeftPane) {
      debug("No left pane found");
      return { success: false };
    }

    // Capture oak pane width to restore after operations
    const oakPaneWidth = execSync(
      `tmux display-message -p -t ${oakPaneId} '#{pane_width}'`,
      { encoding: "utf-8" }
    ).trim();

    // Capture current left pane width for the join
    const leftPaneWidth = execSync(
      `tmux display-message -p -t ${currentLeftPane.id} '#{pane_width}'`,
      { encoding: "utf-8" }
    ).trim();

    debug(`Current left pane: ${currentLeftPane.id}, width: ${leftPaneWidth}`);

    // Ensure background session exists
    ensureBackgroundSession();

    // 1. Bring the background pane to foreground (join it to the left of oak)
    execSync(`tmux join-pane -h -b -l ${leftPaneWidth} -t ${oakPaneId} -s ${paneId}`);
    execSync("sleep 0.1");

    // 2. Move the old left pane to background
    execSync(`tmux break-pane -d -s ${currentLeftPane.id} -t oak-bg:`);
    execSync("sleep 0.1");

    // 3. Restore oak pane width
    execSync(`tmux resize-pane -t ${oakPaneId} -x ${oakPaneWidth}`);

    debug(`Swapped panes: ${paneId} to foreground, ${currentLeftPane.id} to background`);
    return { success: true, movedToBackgroundPaneId: currentLeftPane.id };
  } catch (err) {
    debug("Error bringing pane to foreground:", err);
    return { success: false };
  }
}

/**
 * Create a new pane for a worktree
 */
export function createNewPaneForWorktree(
  worktreePath: string,
  oakPaneId: string
): { success: boolean; newPaneId?: string; movedToBackgroundPaneId?: string } {
  debug(`Creating new pane for worktree: ${worktreePath}`);
  debug(`Oak pane ID: ${oakPaneId}`);

  try {
    // Get current left pane (the one to swap out)
    const output = execSync(
      "tmux list-panes -F '#{pane_id}|#{pane_left}|#{pane_top}|#{pane_current_path}'",
      { encoding: "utf-8" }
    ).trim();

    interface PaneInfo {
      id: string;
      left: number;
      top: number;
      path: string;
    }

    const panes: PaneInfo[] = output.split("\n").map((line) => {
      const [id, left, top, path] = line.split("|");
      return { id, left: parseInt(left), top: parseInt(top), path };
    });

    // Find the leftmost pane (not oak pane)
    const otherPanes = panes.filter((p) => p.id !== oakPaneId);
    debug(`Other panes (excluding ${oakPaneId}): ${otherPanes.map(p => p.id).join(", ")}`);

    if (otherPanes.length === 0) {
      // No existing left pane - just create a new one
      execSync(`tmux split-window -h -b -t ${oakPaneId} -c "${worktreePath}"`);
      execSync("sleep 0.1");

      // Get the new pane ID
      const newPaneId = execSync(
        "tmux list-panes -F '#{pane_id}|#{pane_left}' | sort -t'|' -k2 -n | head -1 | cut -d'|' -f1",
        { encoding: "utf-8" }
      ).trim();

      debug(`Created new pane: ${newPaneId}`);
      return { success: true, newPaneId };
    }

    const topPanes = otherPanes.filter((p) => p.top === 0);
    const sortedPanes = topPanes.length > 0
      ? [...topPanes].sort((a, b) => a.left - b.left)
      : [...otherPanes].sort((a, b) => a.left - b.left);
    const currentLeftPane = sortedPanes[0];

    if (!currentLeftPane) {
      debug("No left pane found");
      return { success: false };
    }

    // Capture oak pane width to restore after operations
    const oakPaneWidth = execSync(
      `tmux display-message -p -t ${oakPaneId} '#{pane_width}'`,
      { encoding: "utf-8" }
    ).trim();

    debug(`Current left pane: ${currentLeftPane.id}`);

    // Ensure background session exists
    ensureBackgroundSession();

    // 1. Create new pane by splitting the left pane
    const newPaneId = execSync(
      `tmux split-window -h -t ${currentLeftPane.id} -c "${worktreePath}" -P -F '#{pane_id}'`,
      { encoding: "utf-8" }
    ).trim();
    execSync("sleep 0.1");

    debug(`Created new pane: ${newPaneId}`);

    // 2. Move the old left pane to background
    execSync(`tmux break-pane -d -s ${currentLeftPane.id} -t oak-bg:`);
    execSync("sleep 0.1");

    // 3. Restore oak pane width
    execSync(`tmux resize-pane -t ${oakPaneId} -x ${oakPaneWidth}`);

    debug(`Created new pane ${newPaneId}, moved ${currentLeftPane.id} to background`);
    return { success: true, newPaneId, movedToBackgroundPaneId: currentLeftPane.id };
  } catch (err) {
    debug("Error creating new pane:", err);
    return { success: false };
  }
}

/**
 * Get the leftmost pane ID (for determining current active worktree)
 */
export function getLeftPaneId(oakPaneId: string): string | null {
  try {
    const output = execSync(
      "tmux list-panes -F '#{pane_id}|#{pane_left}|#{pane_top}'",
      { encoding: "utf-8" }
    ).trim();

    interface PaneInfo {
      id: string;
      left: number;
      top: number;
    }

    const panes: PaneInfo[] = output.split("\n").map((line) => {
      const [id, left, top] = line.split("|");
      return { id, left: parseInt(left), top: parseInt(top) };
    });

    // Filter out oak pane
    const otherPanes = panes.filter((p) => p.id !== oakPaneId);
    if (otherPanes.length === 0) return null;

    // Find topmost-leftmost
    const topPanes = otherPanes.filter((p) => p.top === 0);
    if (topPanes.length > 0) {
      const sorted = [...topPanes].sort((a, b) => a.left - b.left);
      return sorted[0].id;
    }

    const sorted = [...otherPanes].sort((a, b) => a.left - b.left);
    return sorted[0].id;
  } catch {
    return null;
  }
}

/**
 * Get a pane's current path
 */
export function getPanePath(paneId: string): string | null {
  try {
    return execSync(
      `tmux display-message -p -t ${paneId} '#{pane_current_path}'`,
      { encoding: "utf-8" }
    ).trim();
  } catch {
    return null;
  }
}
