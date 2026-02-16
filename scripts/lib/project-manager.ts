// Project and git worktree management

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { Worktree, ProjectNode } from "./types";

const DATA_DIR = join(homedir(), ".local", "share", "git-worktree-manager");
const RECENT_PROJECTS_FILE = join(DATA_DIR, "recent-projects.json");

interface RecentProject {
  path: string;
  lastAccessed: number;
}

export function debug(...args: unknown[]): void {
  // Will be injected by main app
}

export function setDebugFn(fn: (...args: unknown[]) => void): void {
  Object.assign(debug, fn);
}

/**
 * Get git worktrees for a given git root directory
 */
export function getWorktrees(gitRoot: string): Worktree[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: gitRoot,
      encoding: "utf-8",
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
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch || "detached",
            commit: current.commit || "unknown",
            isPrunable: current.isPrunable || false,
          });
        }
        current = {};
      }
    }

    // Handle last worktree if no trailing newline
    if (current.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch || "detached",
        commit: current.commit || "unknown",
        isPrunable: current.isPrunable || false,
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
    }).trim();
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
      return JSON.parse(readFileSync(RECENT_PROJECTS_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

/**
 * Save a project to recent projects list
 */
export function saveRecentProject(projectPath: string): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    const projects = loadRecentProjects();
    const existing = projects.find((p) => p.path === projectPath);

    if (existing) {
      existing.lastAccessed = Date.now();
    } else {
      projects.push({ path: projectPath, lastAccessed: Date.now() });
    }

    // Keep only last 20 projects
    projects.sort((a, b) => b.lastAccessed - a.lastAccessed);
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
    const filtered = projects.filter((p) => p.path !== projectPath);

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
 * Build hierarchical project nodes from recent projects
 */
export function buildProjectNodes(
  recentProjects: RecentProject[],
  currentGitRoot: string | null,
): ProjectNode[] {
  const nodes: ProjectNode[] = [];

  for (const project of recentProjects) {
    const worktrees = getWorktrees(project.path);
    const isActive = project.path === currentGitRoot;

    nodes.push({
      path: project.path,
      name: basename(project.path),
      worktrees,
      isExpanded: isActive, // Auto-expand active project
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
