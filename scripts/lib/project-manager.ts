// Project and git worktree management

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import type { Worktree, ProjectNode } from "./types";
import { hasBackgroundPane } from "./tmux-manager";
import { DATA_DIR } from "./constants";
import { debug, setDebugFn } from "./debug-utils";
import { isRecord } from "./type-guards";

export { debug, setDebugFn };

const RECENT_PROJECTS_FILE = join(DATA_DIR, "recent-projects.json");

interface RecentProject {
  path: string;
  lastAccessed: number;
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === "string" && typeof value.lastAccessed === "number"
  );
}

function isRecentProjectArray(value: unknown): value is RecentProject[] {
  return Array.isArray(value) && value.every(isRecentProject);
}

/**
 * Get git worktrees for a given git root directory
 */
export function getWorktrees(gitRoot: string): Worktree[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"], // Suppress stderr
    });

    const worktrees: Worktree[] = [];
    const lines = output.trim().split("\n");
    let current: Partial<Worktree> = {};

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        current.path = line.substring("worktree ".length);
      } else if (line.startsWith("branch ")) {
        current.branch = line
          .substring("branch ".length)
          .replace("refs/heads/", "");
      } else if (line.startsWith("HEAD ")) {
        current.commit = line.substring("HEAD ".length).substring(0, 7);
      } else if (line.startsWith("prunable ")) {
        current.isPrunable = true;
      } else if (line === "") {
        if (current.path !== undefined) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? "detached",
            commit: current.commit ?? "unknown",
            isPrunable: current.isPrunable ?? false,
          });
        }
        current = {};
      }
    }

    // Handle last worktree if no trailing newline
    if (current.path !== undefined) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? "detached",
        commit: current.commit ?? "unknown",
        isPrunable: current.isPrunable ?? false,
      });
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Get the git root directory for a given path
 */
export function getGitRoot(dir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"], // Suppress stderr
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the main repository path (resolves worktrees to main repo)
 * If the path is a worktree, returns the main repo path.
 * If the path is already the main repo, returns it unchanged.
 */
export function getMainRepoPath(dir: string): string | null {
  try {
    // First check if this is a git repo at all
    const gitRoot = getGitRoot(dir);
    if (gitRoot === null || gitRoot === "") {
      return null;
    }

    // Get the first worktree from the list (always the main repo)
    const output = execSync("git worktree list --porcelain", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"], // Suppress stderr
    });

    const lines = output.trim().split("\n");
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        return line.substring("worktree ".length);
      }
    }

    // Fallback to git root if worktree list fails
    return gitRoot;
  } catch {
    return null;
  }
}

/**
 * Load recent projects from disk
 */
export function loadRecentProjects(): RecentProject[] {
  try {
    if (existsSync(RECENT_PROJECTS_FILE)) {
      const data: unknown = JSON.parse(
        readFileSync(RECENT_PROJECTS_FILE, "utf-8"),
      );
      if (isRecentProjectArray(data)) {
        return data;
      }
    }
  } catch {}
  return [];
}

/**
 * Save a project to recent projects list
 * Automatically resolves worktrees to their main repo path to avoid duplicates
 */
export function saveRecentProject(projectPath: string): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // Resolve worktrees to main repo path, or use the original path if not a git repo
    const mainRepoPath = getMainRepoPath(projectPath) ?? projectPath;
    if (mainRepoPath === null || mainRepoPath === "") {
      debug("Invalid project path:", projectPath);
      return;
    }

    const projects = loadRecentProjects();
    const existing = projects.find(
      (p: Readonly<RecentProject>) => p.path === mainRepoPath,
    );

    if (existing) {
      existing.lastAccessed = Date.now();
    } else {
      projects.push({ path: mainRepoPath, lastAccessed: Date.now() });
    }

    // Keep only last 20 projects
    projects.sort(
      (a: Readonly<RecentProject>, b: Readonly<RecentProject>) =>
        b.lastAccessed - a.lastAccessed,
    );
    const trimmed = projects.slice(0, 20);

    writeFileSync(RECENT_PROJECTS_FILE, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    debug("Error saving recent project:", err);
  }
}

/**
 * Remove a project from the recent projects list
 */
export function removeRecentProject(projectPath: string): boolean {
  try {
    const projects = loadRecentProjects();
    const initialLength = projects.length;
    const filtered = projects.filter(
      (p: Readonly<RecentProject>) => p.path !== projectPath,
    );

    if (filtered.length === initialLength) {
      // Project was not found
      return false;
    }

    writeFileSync(RECENT_PROJECTS_FILE, JSON.stringify(filtered, null, 2));
    return true;
  } catch (err) {
    debug("Error removing recent project:", err);
    return false;
  }
}

/**
 * Deduplicate recent projects by resolving worktrees to main repos
 * Keeps the most recently accessed entry for each unique main repo
 */
export function deduplicateRecentProjects(): number {
  try {
    const projects = loadRecentProjects();
    const mainRepoMap = new Map<string, RecentProject>();

    // Resolve each project to its main repo and keep the most recent
    for (const project of projects) {
      // For git repos, resolve to main repo; for non-git dirs, keep as-is
      const mainRepoPath = getMainRepoPath(project.path) ?? project.path;

      // Skip if path doesn't exist anymore
      if (!existsSync(mainRepoPath)) {
        debug(`Skipping non-existent path: ${mainRepoPath}`);
        continue;
      }

      const existing = mainRepoMap.get(mainRepoPath);
      if (!existing || project.lastAccessed > existing.lastAccessed) {
        mainRepoMap.set(mainRepoPath, {
          path: mainRepoPath,
          lastAccessed: project.lastAccessed,
        });
      }
    }

    // Convert back to array and sort by last accessed
    const deduplicated = Array.from(mainRepoMap.values()).sort(
      (a, b) => b.lastAccessed - a.lastAccessed,
    );

    const removedCount = projects.length - deduplicated.length;
    if (removedCount > 0) {
      writeFileSync(
        RECENT_PROJECTS_FILE,
        JSON.stringify(deduplicated, null, 2),
      );
      debug(`Deduplicated ${removedCount} project entries`);
    }

    return removedCount;
  } catch (err) {
    debug("Error deduplicating recent projects:", err);
    return 0;
  }
}

/**
 * Build hierarchical project nodes from recent projects
 */
export function buildProjectNodes(
  recentProjects: readonly Readonly<RecentProject>[],
  currentGitRoot: string | null,
): ProjectNode[] {
  const nodes: ProjectNode[] = [];

  for (const project of recentProjects) {
    const worktrees = getWorktrees(project.path);
    const isActive = project.path === currentGitRoot;

    // Check if any worktree has a background pane
    const hasAnyPane = worktrees.some((wt) => hasBackgroundPane(wt.path));

    nodes.push({
      path: project.path,
      name: basename(project.path),
      worktrees,
      isExpanded: isActive || hasAnyPane, // Auto-expand if active OR has panes
      isActive,
    });
  }

  return nodes;
}

/**
 * Ensure data directory exists
 */
export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Get data directory path
 */
export function getDataDir(): string {
  return DATA_DIR;
}
