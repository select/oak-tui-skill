// Project state management - tracks projects, worktrees, and panes in YAML
// State file location: ~/.config/oak-tui/projects.yaml

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
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
  paneTitle?: string; // tmux pane title (e.g., "OpenCode", may be hostname/username by default)
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

/**
 * Helper to safely check if a value is a non-null object (Record-like)
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPaneState(value: unknown): value is PaneState {
  if (!isNonNullObject(value)) return false;
  // currentCommand and paneTitle are optional for backward compatibility with old state files
  return (
    typeof value.paneId === "string" &&
    typeof value.windowId === "string" &&
    typeof value.sessionName === "string" &&
    typeof value.currentPath === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.isBackground === "boolean" &&
    (value.currentCommand === undefined || typeof value.currentCommand === "string") &&
    (value.paneTitle === undefined || typeof value.paneTitle === "string")
  );
}

function isWorktreeState(value: unknown): value is WorktreeState {
  if (!isNonNullObject(value)) return false;
  return (
    typeof value.path === "string" &&
    typeof value.branch === "string" &&
    Array.isArray(value.panes) &&
    value.panes.every(isPaneState)
  );
}

function isBeadsConfig(value: unknown): value is BeadsConfig {
  if (!isNonNullObject(value)) return false;
  return (
    typeof value.enabled === "boolean" &&
    (value.path === undefined || typeof value.path === "string")
  );
}

function isProjectState(value: unknown): value is ProjectState {
  if (!isNonNullObject(value)) return false;
  if (
    typeof value.path !== "string" ||
    typeof value.name !== "string" ||
    typeof value.lastAccessed !== "number" ||
    !isBeadsConfig(value.beads) ||
    !isNonNullObject(value.worktrees)
  ) {
    return false;
  }
  // Validate all worktrees
  for (const wt of Object.values(value.worktrees)) {
    if (!isWorktreeState(wt)) return false;
  }
  return true;
}

function isOakProjectsState(value: unknown): value is OakProjectsState {
  if (!isNonNullObject(value)) return false;
  if (typeof value.version !== "number" || !isNonNullObject(value.projects)) {
    return false;
  }
  // Validate all projects
  for (const proj of Object.values(value.projects)) {
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
// Oak Configuration
// ============================================================================

/**
 * Oak TUI configuration
 */
export interface OakConfig {
  oakWidth: number; // Width of Oak pane in columns (20-40% of window)
}

/**
 * Default Oak width as percentage of window width
 */
const DEFAULT_OAK_WIDTH_PERCENT = 0.25; // 25% of window width
const MIN_OAK_WIDTH = 42; // Minimum width in columns
const MAX_OAK_WIDTH_PERCENT = 0.4; // Maximum 40% of window width

/**
 * Create default config
 */
function createDefaultConfig(): OakConfig {
  try {
    const windowWidth = parseInt(
      execSync("tmux display-message -p '#{window_width}'", {
        encoding: "utf-8",
      }).trim()
    );
    const oakWidth = Math.max(
      MIN_OAK_WIDTH,
      Math.min(
        Math.floor(windowWidth * DEFAULT_OAK_WIDTH_PERCENT),
        Math.floor(windowWidth * MAX_OAK_WIDTH_PERCENT)
      )
    );
    return { oakWidth };
  } catch {
    return { oakWidth: 53 }; // Fallback default
  }
}

/**
 * Load Oak config from YAML file
 */
export function loadOakConfig(): OakConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      debug("No config file found, creating default");
      const config = createDefaultConfig();
      saveOakConfig(config);
      return config;
    }

    const fileContents = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = yaml.load(fileContents);

    if (!isNonNullObject(parsed) || typeof parsed.oakWidth !== "number") {
      debug("Invalid config format, creating default");
      const config = createDefaultConfig();
      saveOakConfig(config);
      return config;
    }

    debug(`Loaded config: oakWidth=${parsed.oakWidth}`);
    return { oakWidth: parsed.oakWidth };
  } catch (err) {
    debug("Error loading config:", err);
    return createDefaultConfig();
  }
}

/**
 * Save Oak config to YAML file
 */
export function saveOakConfig(config: OakConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    const yamlContent = yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });

    writeFileSync(CONFIG_FILE, yamlContent);
    debug(`Saved config: oakWidth=${config.oakWidth}`);
  } catch (err) {
    debug("Error saving config:", err);
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
      const entries = readdirSync(currentPath);

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
        if (current.path != null && current.path !== "") {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? "detached",
          });
        }
        current = {};
      }
    }

    // Handle last worktree if no trailing newline
    if (current.path != null && current.path !== "") {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? "detached",
      });
    }

    // Filter out beads internal worktrees (in .git/beads-worktrees/)
    return worktrees.filter(wt => !wt.path.includes("/.git/beads-worktrees/"));
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
  paneTitle?: string;
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
      `tmux list-panes -s -t ${sessionName} -F '#{pane_id}|#{window_id}|#{session_name}|#{pane_current_path}|#{pane_current_command}|#{pane_title}'`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();

    if (!output) return [];

    return output.split("\n").map((line) => {
      const parts = line.split("|");
      return {
        paneId: parts[0],
        windowId: parts[1],
        sessionName: parts[2],
        currentPath: parts[3],
        currentCommand: parts[4] ?? "zsh",
        paneTitle: parts[5],
      };
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
      "tmux list-panes -F '#{pane_id}|#{window_id}|#{session_name}|#{pane_current_path}|#{pane_current_command}|#{pane_title}'",
      { encoding: "utf-8" }
    ).trim();

    if (!output) return [];

    return output
      .split("\n")
      .map((line) => {
        const parts = line.split("|");
        return {
          paneId: parts[0],
          windowId: parts[1],
          sessionName: parts[2],
          currentPath: parts[3],
          currentCommand: parts[4] ?? "zsh",
          paneTitle: parts[5],
        };
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
  if (path in worktrees) {
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
  if (!(projectPath in state.projects)) {
    debug(`syncProjectPanes: project not found: ${projectPath}`);
    return false;
  }
  const project = state.projects[projectPath];

  let changed = false;

  // Get all panes from current session and oak-bg
  const currentPanes = getCurrentSessionPanes(oakPaneId);
  const bgPanes = getBackgroundSessionPanes();
  // Filter out oak pane from background panes too (in case it was moved there)
  const filteredBgPanes = oakPaneId != null && oakPaneId !== "" ? bgPanes.filter((p) => p.paneId !== oakPaneId) : bgPanes;
  const allPanes = [...currentPanes, ...filteredBgPanes];

  debug(`syncProjectPanes: found ${allPanes.length} total panes`);

  // Remove oak pane from tracking if it exists (should never be tracked)
  if (oakPaneId != null && oakPaneId !== "") {
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
    if (wtPath == null || wtPath === "") {
      // Pane is in project but not in a tracked worktree - could be in main repo
      // Check if it's in the main repo worktree
      if (projectPath in project.worktrees && panePath.startsWith(projectPath)) {
        const mainWt = project.worktrees[projectPath];
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
            paneTitle: paneInfo.paneTitle,
            createdAt: Date.now(),
            isBackground,
          });
          debug(`Added pane ${paneInfo.paneId} to main worktree ${projectPath}`);
          changed = true;
        } else {
          // Update existing pane if path or command changed
          if (existingPane.currentPath !== panePath || existingPane.sessionName !== paneInfo.sessionName || existingPane.currentCommand !== paneInfo.currentCommand || existingPane.paneTitle !== paneInfo.paneTitle) {
            existingPane.currentPath = panePath;
            existingPane.sessionName = paneInfo.sessionName;
            existingPane.currentCommand = paneInfo.currentCommand;
            existingPane.paneTitle = paneInfo.paneTitle;
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
        paneTitle: paneInfo.paneTitle,
        createdAt: Date.now(),
        isBackground,
      });
      debug(`Added pane ${paneInfo.paneId} to worktree ${wtPath}`);
      changed = true;
    } else {
      // Update existing pane if path, session, window, command or title changed
      if (
        existingPane.currentPath !== panePath ||
        existingPane.sessionName !== paneInfo.sessionName ||
        existingPane.windowId !== paneInfo.windowId ||
        existingPane.currentCommand !== paneInfo.currentCommand ||
        existingPane.paneTitle !== paneInfo.paneTitle
      ) {
        existingPane.currentPath = panePath;
        existingPane.sessionName = paneInfo.sessionName;
        existingPane.windowId = paneInfo.windowId;
        existingPane.currentCommand = paneInfo.currentCommand;
        existingPane.paneTitle = paneInfo.paneTitle;
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

  if (!(mainPath in state.projects)) {
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
    if (!(wt.path in project.worktrees)) {
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
  if (projectPath in state.projects) {
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
  if (path in state.projects) {
    return state.projects[path];
  }

  // Try to resolve to main repo
  const mainPath = getMainRepoPath(path);
  if (mainPath != null && mainPath in state.projects) {
    return state.projects[mainPath];
  }

  return null;
}

/**
 * Check if a worktree has any panes (foreground or background)
 */
export function worktreeHasPanes(state: OakProjectsState, worktreePath: string): boolean {
  for (const project of Object.values(state.projects)) {
    if (worktreePath in project.worktrees && project.worktrees[worktreePath].panes.length > 0) {
      return true;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt) && project.worktrees[wtPath].panes.length > 0) {
        return true;
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
    if (worktreePath in project.worktrees && project.worktrees[worktreePath].panes.some((p) => p.isBackground)) {
      return true;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt) && project.worktrees[wtPath].panes.some((p) => p.isBackground)) {
        return true;
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
    if (worktreePath in project.worktrees) {
      const fgPane = project.worktrees[worktreePath].panes.find((p) => !p.isBackground);
      if (fgPane) return fgPane;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt)) {
        const fgPane = project.worktrees[wtPath].panes.find((p) => !p.isBackground);
        if (fgPane) return fgPane;
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
    if (worktreePath in project.worktrees) {
      const bgPane = project.worktrees[worktreePath].panes.find((p) => p.isBackground);
      if (bgPane) return bgPane;
    }

    // Also check for subdirectory match
    for (const wtPath of Object.keys(project.worktrees)) {
      const normalizedWt = wtPath.endsWith("/") ? wtPath : wtPath + "/";
      const normalizedTarget = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
      if (normalizedTarget.startsWith(normalizedWt)) {
        const bgPane = project.worktrees[wtPath].panes.find((p) => p.isBackground);
        if (bgPane) return bgPane;
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
    const config: unknown = yaml.load(content);
    if (!isNonNullObject(config) || !("projects" in config) || !isNonNullObject(config.projects)) {
      return [];
    }
    // Object.keys preserves insertion order in modern JS
    return Object.keys(config.projects);
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
    if (path in state.projects) {
      result.push(state.projects[path]);
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
  if (path in state.projects) {
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
  if (mainPath != null && mainPath in state.projects) {
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
    if (path in project.worktrees) {
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
    if (currentSession == null || currentSession === "") {
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
    // Use topPanes if any exist (prefer top row), otherwise use all panes
    const panesToSort = topPanes.length > 0 ? topPanes : otherPanes;
    const sortedPanes = [...panesToSort].sort((a, b) => a.left - b.left);
    const currentLeftPane = sortedPanes[0];

    if (currentLeftPane === undefined) {
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

      // Return focus to Oak so user can continue navigating
      execSync(`tmux select-pane -t ${oakPaneId}`);

      debug(`Created new pane: ${newPaneId}`);
      return { success: true, newPaneId };
    }

    const topPanes = otherPanes.filter((p) => p.top === 0);
    // Use topPanes if any exist (prefer top row), otherwise use all panes
    const panesToSort = topPanes.length > 0 ? topPanes : otherPanes;
    const sortedPanes = [...panesToSort].sort((a, b) => a.left - b.left);
    const currentLeftPane = sortedPanes[0];

    if (currentLeftPane === undefined) {
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

    // 4. Return focus to Oak so user can continue navigating
    execSync(`tmux select-pane -t ${oakPaneId}`);

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

// ============================================================================
// Multi-Pane View Infrastructure
// ============================================================================

interface VisiblePaneInfo {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  path: string;
}

/**
 * Get all visible foreground panes (excluding Oak pane and background session)
 * Returns panes in the current window that are not the Oak TUI pane
 */
export function getVisibleForegroundPanes(oakPaneId: string): VisiblePaneInfo[] {
  try {
    const output = execSync(
      "tmux list-panes -F '#{pane_id}|#{pane_left}|#{pane_top}|#{pane_width}|#{pane_height}|#{pane_current_path}'",
      { encoding: "utf-8" }
    ).trim();

    const panes: VisiblePaneInfo[] = output.split("\n").map((line) => {
      const [id, left, top, width, height, path] = line.split("|");
      return {
        id,
        left: parseInt(left),
        top: parseInt(top),
        width: parseInt(width),
        height: parseInt(height),
        path,
      };
    });

    // Filter out Oak pane - remaining panes are visible foreground panes
    return panes.filter((p) => p.id !== oakPaneId);
  } catch (err) {
    debug("Error getting visible foreground panes:", err);
    return [];
  }
}

/**
 * Get workspace dimensions (excluding Oak pane)
 */
export function getWorkspaceDimensions(_oakPaneId: string): {
  width: number;
  height: number;
  oakWidth: number;
} {
  try {
    const windowWidth = parseInt(
      execSync("tmux display-message -p '#{window_width}'", {
        encoding: "utf-8",
      }).trim()
    );
    const windowHeight = parseInt(
      execSync("tmux display-message -p '#{window_height}'", {
        encoding: "utf-8",
      }).trim()
    );
    
    // Use configured Oak width instead of current pane width
    const config = loadOakConfig();
    const oakWidth = config.oakWidth;

    return {
      width: windowWidth - oakWidth,
      height: windowHeight,
      oakWidth,
    };
  } catch (err) {
    debug("Error getting workspace dimensions:", err);
    // Return reasonable defaults
    return { width: 100, height: 40, oakWidth: 53 };
  }
}

/**
 * Validate and enforce Oak pane width limits
 * 
 * Oak width should stay between 20-40% of total window width.
 * If out of bounds, resize to nearest valid value.
 * 
 * @param oakPaneId - The Oak TUI pane ID
 * @returns Success status and any adjustments made
 */
export function validateOakWidth(oakPaneId: string): { success: boolean; adjusted: boolean } {
  try {
    const windowWidth = parseInt(
      execSync("tmux display-message -p '#{window_width}'", {
        encoding: "utf-8",
      }).trim()
    );
    const oakWidth = parseInt(
      execSync(`tmux display-message -p -t ${oakPaneId} '#{pane_width}'`, {
        encoding: "utf-8",
      }).trim()
    );

    const minWidth = Math.floor(windowWidth * 0.2); // 20%
    const maxWidth = Math.floor(windowWidth * 0.4); // 40%

    if (oakWidth < minWidth) {
      debug(`Oak width ${oakWidth} below minimum ${minWidth}, adjusting...`);
      execSync(`tmux resize-pane -t ${oakPaneId} -x ${minWidth}`);
      return { success: true, adjusted: true };
    }

    if (oakWidth > maxWidth) {
      debug(`Oak width ${oakWidth} above maximum ${maxWidth}, adjusting...`);
      execSync(`tmux resize-pane -t ${oakPaneId} -x ${maxWidth}`);
      return { success: true, adjusted: true };
    }

    return { success: true, adjusted: false };
  } catch (err) {
    debug("Error validating Oak width:", err);
    return { success: false, adjusted: false };
  }
}

/**
 * Calculate pane layout for multi-pane view
 * @param numPanes - Total number of panes to display
 * @param workspaceWidth - Available workspace width (excluding Oak)
 * @param workspaceHeight - Available workspace height
 * @returns Layout information for each pane position
 */
export function calculateMultiPaneLayout(
  numPanes: number,
  workspaceWidth: number,
  workspaceHeight: number
): Array<{ position: "master" | "stack"; width: number; height: number }> {
  if (numPanes === 1) {
    // Single pane takes full workspace
    return [{ position: "master", width: workspaceWidth, height: workspaceHeight }];
  }

  if (numPanes === 2) {
    // 50/50 horizontal split
    const paneWidth = Math.floor(workspaceWidth / 2);
    return [
      { position: "master", width: paneWidth, height: workspaceHeight },
      { position: "master", width: paneWidth, height: workspaceHeight },
    ];
  }

  // 3+ panes: Master layout (50% left, 50% right with vertical stack)
  const masterWidth = Math.floor(workspaceWidth / 2);
  const stackWidth = workspaceWidth - masterWidth;
  const stackPanes = numPanes - 1; // All panes except master
  const stackPaneHeight = Math.floor(workspaceHeight / stackPanes);

  const layout: Array<{ position: "master" | "stack"; width: number; height: number }> = [
    { position: "master", width: masterWidth, height: workspaceHeight },
  ];

  // Add stack panes
  for (let i = 0; i < stackPanes; i++) {
    layout.push({
      position: "stack",
      width: stackWidth,
      height: stackPaneHeight,
    });
  }

  return layout;
}

/**
 * Send a pane to background session (reverse of bringPaneToForeground)
 * @param paneId - The pane to send to background
 * @returns Success status
 */
export function sendPaneToBackground(paneId: string): { success: boolean } {
  debug(`Sending pane ${paneId} to background`);

  try {
    // Ensure background session exists
    ensureBackgroundSession();

    // Capture current path before moving
    const currentPath = getPanePath(paneId);
    if (currentPath == null) {
      debug("Could not get pane path");
      return { success: false };
    }

    // Move pane to background session
    execSync(`tmux break-pane -d -s ${paneId} -t oak-bg:`);
    execSync("sleep 0.1");

    // Update state to mark pane as background
    const state = getGlobalState();
    markPaneAsBackground(state, paneId, currentPath);
    saveGlobalState();

    debug(`Sent pane ${paneId} to background`);
    return { success: true };
  } catch (err) {
    debug("Error sending pane to background:", err);
    return { success: false };
  }
}

/**
 * Add a pane to multi-view or remove it (toggle between foreground and background)
 * 
 * If pane is background: add to foreground with smart layout
 * - 2 panes: 50/50 horizontal split (minus Oak 30%)
 * - 3+ panes: Master layout 50% left, 50% right with vertical stack
 * - Stack height divides evenly: height / num_panes_in_stack
 * 
 * If pane is foreground: send to background
 * 
 * @param paneId - The pane to add/remove
 * @param isBackground - Whether the pane is currently in background
 * @param oakPaneId - The Oak TUI pane ID
 * @returns Success status and any additional info
 */
export function addPaneToMultiView(
  paneId: string,
  isBackground: boolean,
  oakPaneId: string
): { success: boolean; action?: "added" | "removed" } {
  debug(`addPaneToMultiView: paneId=${paneId}, isBackground=${isBackground}`);

  try {
    if (isBackground) {
      // Add to foreground: bring pane from background and apply smart layout
      const visiblePanes = getVisibleForegroundPanes(oakPaneId);
      const newPaneCount = visiblePanes.length + 1; // Including the new pane
      const workspace = getWorkspaceDimensions(oakPaneId);

      debug(`Current visible panes: ${visiblePanes.length}, new count will be: ${newPaneCount}`);

      // First, join the pane to foreground
      ensureBackgroundSession();
      
      if (newPaneCount === 1) {
        // First pane - just join it as full workspace
        execSync(`tmux join-pane -h -b -t ${oakPaneId} -s ${paneId}`);
        execSync("sleep 0.1");
      } else if (newPaneCount === 2) {
        // Second pane - create 50/50 split
        const halfWidth = Math.floor(workspace.width / 2);
        
        // Join the new pane to the left of Oak
        execSync(`tmux join-pane -h -b -t ${oakPaneId} -s ${paneId}`);
        execSync("sleep 0.1");
        
        // Resize both panes to 50% each
        const sortedPanes = visiblePanes.sort((a, b) => a.left - b.left);
        const leftPane = sortedPanes[0];
        
        if (leftPane !== undefined) {
          execSync(`tmux resize-pane -t ${leftPane.id} -x ${halfWidth}`);
          execSync(`tmux resize-pane -t ${paneId} -x ${halfWidth}`);
        }
      } else {
        // 3+ panes - master layout (50% left, 50% right with vertical stack)
        const masterWidth = Math.floor(workspace.width / 2);
        const stackWidth = workspace.width - masterWidth;
        
        debug(`Workspace dimensions: width=${workspace.width}, height=${workspace.height}, oakWidth=${workspace.oakWidth}`);
        debug(`Master layout: masterWidth=${masterWidth}, stackWidth=${stackWidth}`);
        
        // Determine which panes will be in the stack
        // Master is leftmost, rest go to stack
        const sortedPanes = visiblePanes.sort((a, b) => a.left - b.left);
        const masterPane = sortedPanes[0];
        const stackPanes = sortedPanes.slice(1);
        
        debug(`Master pane: ${masterPane?.id}, stack panes: ${stackPanes.map(p => p.id).join(", ")}`);
        
        // Join the new pane to foreground (will be added to stack)
        execSync(`tmux join-pane -h -b -t ${oakPaneId} -s ${paneId}`);
        execSync("sleep 0.1");
        
        debug(`After join, pane layout: ${execSync("tmux list-panes -F '#{pane_id}:#{pane_width}x#{pane_height}@#{pane_left}'", { encoding: "utf-8" }).trim()}`);
        
        // Apply master layout
        if (masterPane !== undefined) {
          // Stack all other panes vertically on the right
          const totalStackPanes = stackPanes.length + 1; // Including new pane
          const stackPaneHeight = Math.floor(workspace.height / totalStackPanes);
          
          // Step 1: Resize the newly added pane to correct width FIRST
          // This establishes the width for the entire vertical stack
          execSync(`tmux resize-pane -t ${paneId} -x ${stackWidth}`);
          execSync("sleep 0.05");
          
          // Step 2: Move other panes vertically onto the new pane to create stack
          for (let i = 0; i < stackPanes.length; i++) {
            const stackPane = stackPanes[i];
            if (stackPane !== undefined) {
              execSync(`tmux move-pane -v -t ${paneId} -s ${stackPane.id}`);
              execSync("sleep 0.05");
              execSync(`tmux resize-pane -t ${stackPane.id} -y ${stackPaneHeight}`);
            }
          }
          
          // Step 3: Resize the newly added pane height
          execSync(`tmux resize-pane -t ${paneId} -y ${stackPaneHeight}`);
          
          // Step 4: Resize master to 50% width (AFTER stack is created)
          execSync(`tmux resize-pane -t ${masterPane.id} -x ${masterWidth}`);
        }
      }
      
      // Restore Oak pane width
      execSync(`tmux resize-pane -t ${oakPaneId} -x ${workspace.oakWidth}`);
      
      // Validate Oak width is within acceptable bounds (20-40%)
      validateOakWidth(oakPaneId);
      
      // Return focus to Oak so user can continue navigating
      execSync(`tmux select-pane -t ${oakPaneId}`);
      
      // Update state
      const state = getGlobalState();
      const currentSession = getCurrentTmuxSession();
      if (currentSession != null && currentSession !== "") {
        markPaneAsForeground(state, paneId, currentSession);
        saveGlobalState();
      }
      
      debug(`Added pane ${paneId} to multi-view`);
      return { success: true, action: "added" };
      
    } else {
      // Remove from foreground: send to background
      
      // Edge case: Don't allow removing the last foreground pane
      const visiblePanes = getVisibleForegroundPanes(oakPaneId);
      if (visiblePanes.length <= 1) {
        debug("Cannot remove last foreground pane");
        return { success: false };
      }
      
      const result = sendPaneToBackground(paneId);
      if (result.success) {
        debug(`Removed pane ${paneId} from multi-view`);
        
        // Re-layout remaining panes
        const relayoutResult = relayoutForegroundPanes(oakPaneId);
        if (!relayoutResult.success) {
          debug("Warning: Re-layout failed after removing pane");
        }
        
        return { success: true, action: "removed" };
      }
      return { success: false };
    }
  } catch (err) {
    debug("Error in addPaneToMultiView:", err);
    return { success: false };
  }
}

/**
 * Re-layout remaining foreground panes after a pane is removed
 * 
 * Automatically adjusts the layout based on the number of remaining panes:
 * - 1 pane: single pane takes full workspace (100% - Oak 30%)
 * - 2 panes: 50/50 horizontal split
 * - 3+ panes: master layout (50% left master, 50% right vertical stack)
 * 
 * @param oakPaneId - The Oak TUI pane ID
 * @returns Success status
 */
export function relayoutForegroundPanes(oakPaneId: string): { success: boolean } {
  debug("relayoutForegroundPanes: Starting re-layout");

  try {
    const visiblePanes = getVisibleForegroundPanes(oakPaneId);
    const paneCount = visiblePanes.length;

    debug(`Re-layout: ${paneCount} visible panes`);

    // Edge case: no foreground panes (shouldn't happen, but handle gracefully)
    if (paneCount === 0) {
      debug("No foreground panes to re-layout");
      return { success: true };
    }

    const workspace = getWorkspaceDimensions(oakPaneId);

    if (paneCount === 1) {
      // Single pane - take full workspace width
      const pane = visiblePanes[0];
      if (pane !== undefined) {
        execSync(`tmux resize-pane -t ${pane.id} -x ${workspace.width}`);
        debug(`Re-layout: Single pane ${pane.id} resized to full width ${workspace.width}`);
      }
    } else if (paneCount === 2) {
      // Two panes - 50/50 horizontal split
      const halfWidth = Math.floor(workspace.width / 2);
      const sortedPanes = visiblePanes.sort((a, b) => a.left - b.left);
      
      // Check if panes are vertically stacked (same left position)
      const pane1 = sortedPanes[0];
      const pane2 = sortedPanes[1];
      
      if (pane1 !== undefined && pane2 !== undefined) {
        if (pane1.left === pane2.left) {
          // Panes are vertically stacked - need to convert to horizontal
          debug(`Re-layout: Converting vertical stack to horizontal split`);
          
          // Break pane2 into its own window, then join horizontally
          execSync(`tmux break-pane -d -s ${pane2.id}`);
          execSync("sleep 0.1");
          execSync(`tmux join-pane -h -t ${pane1.id} -s ${pane2.id}`);
          execSync("sleep 0.1");
        }
        
        // Now resize both panes to 50% width
        execSync(`tmux resize-pane -t ${pane1.id} -x ${halfWidth}`);
        execSync(`tmux resize-pane -t ${pane2.id} -x ${halfWidth}`);
        debug(`Re-layout: Panes ${pane1.id} and ${pane2.id} resized to 50% width ${halfWidth}`);
      }
    } else {
      // 3+ panes - master layout (50% left, 50% right with vertical stack)
      const masterWidth = Math.floor(workspace.width / 2);
      const stackWidth = workspace.width - masterWidth;
      const sortedPanes = visiblePanes.sort((a, b) => a.left - b.left);
      const masterPane = sortedPanes[0];
      const stackPanes = sortedPanes.slice(1);

      debug(`Re-layout: Master pane: ${masterPane?.id}, stack panes: ${stackPanes.map(p => p.id).join(", ")}`);

      // Resize master to 50% width
      if (masterPane !== undefined) {
        execSync(`tmux resize-pane -t ${masterPane.id} -x ${masterWidth}`);
        debug(`Re-layout: Master pane ${masterPane.id} resized to ${masterWidth}`);
      }

      // Re-calculate stack heights
      const stackPaneHeight = Math.floor(workspace.height / stackPanes.length);

      for (const stackPane of stackPanes) {
        execSync(`tmux resize-pane -t ${stackPane.id} -x ${stackWidth}`);
        execSync(`tmux resize-pane -t ${stackPane.id} -y ${stackPaneHeight}`);
        debug(`Re-layout: Stack pane ${stackPane.id} resized to ${stackWidth}x${stackPaneHeight}`);
      }
    }

    // Restore Oak pane width to ensure it didn't get affected
    execSync(`tmux resize-pane -t ${oakPaneId} -x ${workspace.oakWidth}`);
    debug(`Re-layout: Restored Oak pane width to ${workspace.oakWidth}`);

    // Validate Oak width is within acceptable bounds (20-40%)
    validateOakWidth(oakPaneId);

    // Return focus to Oak so user can continue navigating
    execSync(`tmux select-pane -t ${oakPaneId}`);

    return { success: true };
  } catch (err) {
    debug("Error in relayoutForegroundPanes:", err);
    return { success: false };
  }
}

/**
 * Cycle focus to the next visible foreground pane
 * 
 * Gets all visible foreground panes, finds the currently focused pane,
 * and selects the next pane in the list (wrapping around to the first).
 * 
 * @param oakPaneId - The Oak TUI pane ID (to exclude from cycling)
 * @returns Success status and the newly focused pane ID
 */
export function cycleToNextVisiblePane(oakPaneId: string): { success: boolean; focusedPaneId?: string } {
  debug("cycleToNextVisiblePane called");
  
  try {
    // Get all visible foreground panes
    const visiblePanes = getVisibleForegroundPanes(oakPaneId);
    
    if (visiblePanes.length === 0) {
      debug("No visible panes to cycle through");
      return { success: false };
    }
    
    if (visiblePanes.length === 1) {
      debug("Only one visible pane, no cycling needed");
      return { success: true, focusedPaneId: visiblePanes[0].id };
    }
    
    // Get currently focused pane
    const currentFocusedPane = execSync(
      "tmux display-message -p '#{pane_id}'",
      { encoding: "utf-8" }
    ).trim();
    
    debug(`Current focused pane: ${currentFocusedPane}`);
    
    // Sort panes by position (left-to-right, top-to-bottom)
    const sortedPanes = [...visiblePanes].sort((a, b) => {
      if (a.top !== b.top) return a.top - b.top;
      return a.left - b.left;
    });
    
    // Find current pane index
    const currentIndex = sortedPanes.findIndex((p) => p.id === currentFocusedPane);
    
    // Calculate next index (wrap around)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sortedPanes.length;
    const nextPane = sortedPanes[nextIndex];
    
    if (nextPane === undefined) {
      debug("No next pane found");
      return { success: false };
    }
    
    debug(`Cycling from ${currentFocusedPane} to ${nextPane.id}`);
    
    // Select the next pane
    execSync(`tmux select-pane -t ${nextPane.id}`);
    
    return { success: true, focusedPaneId: nextPane.id };
  } catch (err) {
    debug("Error in cycleToNextVisiblePane:", err);
    return { success: false };
  }
}

