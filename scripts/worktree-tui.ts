#!/usr/bin/env bun
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { basename } from "node:path";
import type { TabId } from "./lib/types";
import {
  checkExistingInstance,
  createSocketServer,
} from "./lib/socket-manager";
import {
  loadRecentProjects,
  saveRecentProject,
  getGitRoot,
  buildProjectNodes,
} from "./lib/project-manager";
import {
  readDirectoryEntries,
  loadNodeChildren,
  ensureChildrenLoaded,
} from "./components/file-tree";
import {
  createUIComponents,
  renderProjects,
  renderFiles,
  renderThemes,
  clearContent,
  updateUIColors,
} from "./lib/ui-renderer";
import {
  initThemes,
  currentTheme,
  setTheme,
  availableThemes,
} from "./lib/theme-manager";
import { initTmuxManager, setDebugFn } from "./lib/tmux-manager";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";

// Debug logging - must be defined before setDebugFn
const DEBUG = process.argv.includes("--debug");
const CHECK_ONLY = process.argv.includes("--check-only");
const DEBUG_LOG_PATH = `${homedir()}/.local/share/git-worktree-manager/debug.log`;

function debug(...args: unknown[]): void {
  if (!DEBUG) return;
  const timestamp = new Date().toLocaleTimeString();
  const message = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`);
}

// Initialize theme system
initThemes();

// Set up debug function for tmux manager
setDebugFn((...args: unknown[]) => {
  debug("tmux:", ...args);
});

// Initialize tmux manager (load background panes)
initTmuxManager();

// Crash recovery
process.on("uncaughtException", (error) => {
  console.error("\n\n❌ Crash detected:", error.message);
  console.error("\nPress 'r' to reload, or Ctrl+C to exit");
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
    process.stdin.on("data", (key) => {
      if (key.toString() === "r") {
        console.clear();
        process.exit(42); // Special exit code for reload
      }
    });
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("\n\n❌ Unhandled rejection:", reason);
  console.error("\nPress 'r' to reload, or Ctrl+C to exit");
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
    process.stdin.on("data", (key) => {
      if (key.toString() === "r") {
        console.clear();
        process.exit(42);
      }
    });
  }
});

async function main() {
  const startDir = process.cwd();
  debug("=== TUI Starting ===");
  debug("Start directory:", startDir);
  debug("Debug mode:", DEBUG);
  debug("Check only mode:", CHECK_ONLY);

  // Check if another instance is already running
  const instanceStatus = await checkExistingInstance();
  if (instanceStatus === "connected") {
    debug("Found existing instance running, exiting with message");
    console.error(
      "Another Git Worktree Manager is already running in a different tmux pane.",
    );
    console.error("To open it here instead, kill the existing instance first.");
    process.exit(100);
  }

  // If --check-only flag, just exit successfully (no existing instance)
  if (CHECK_ONLY) {
    debug("Check only mode, no existing instance found, exiting");
    process.exit(0);
  }

  debug("No existing instance, starting new TUI");

  // Initialize state
  let currentDir = startDir;
  let gitRoot = getGitRoot(startDir) || startDir;
  debug("Git root:", gitRoot);
  let recentProjects = loadRecentProjects();
  let projectNodes = buildProjectNodes(recentProjects, gitRoot);
  debug("Project nodes:", projectNodes.length);
  let fileTree = readDirectoryEntries(gitRoot, 0, true);
  debug("File tree entries:", fileTree.length);

  saveRecentProject(gitRoot);

  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  debug("Renderer created");

  let activeTab: TabId = "projects";
  let renderCounter = 0;
  let searchQuery = "";
  let expandedPaths = new Set<string>();

  // Initialize top-level folders as expanded
  for (const node of fileTree) {
    if (node.isDirectory) {
      expandedPaths.add(node.path);
      node.children = loadNodeChildren(node, true);
    }
  }
  debug("Top-level folders expanded:", expandedPaths.size);

  // Create UI components
  const ui = createUIComponents(renderer);

  // Create tabs
  const TABS: { id: TabId; label: string }[] = [
    { id: "projects", label: "Projects" },
    { id: "files", label: "Files" },
    { id: "themes", label: "Themes" },
  ];

  TABS.forEach((tab, i) => {
    const tabBox = new BoxRenderable(renderer, {
      id: `tab-${tab.id}`,
      paddingLeft: 1,
      paddingRight: 1,
    });
    const tabText = new TextRenderable(renderer, {
      id: `tab-text-${tab.id}`,
      content: tab.label,
      fg:
        activeTab === tab.id
          ? currentTheme().colors.primary
          : currentTheme().colors.textMuted,
      bold: activeTab === tab.id,
    });
    tabBox.add(tabText);
    tabBox.onMouse = (event) => {
      if (event.type === "down") {
        event.stopPropagation();
        activeTab = tab.id;
        updateContent();
      }
    };
    ui.tabBar.add(tabBox);
  });

  // Update title
  ui.titleText.content = `🌳 Oak`;

  // Reload function
  function reloadWithDir(newDir: string) {
    debug("=== Reloading with new directory ===");
    debug("New directory:", newDir);
    currentDir = newDir;
    gitRoot = getGitRoot(newDir) || newDir;
    debug("New git root:", gitRoot);
    recentProjects = loadRecentProjects();
    fileTree = readDirectoryEntries(gitRoot, 0, true);
    searchQuery = "";
    expandedPaths = new Set<string>();

    saveRecentProject(gitRoot);
    recentProjects = loadRecentProjects();
    projectNodes = buildProjectNodes(recentProjects, gitRoot);
    debug("Project nodes reloaded:", projectNodes.length);

    // Re-expand top-level folders
    for (const node of fileTree) {
      if (node.isDirectory) {
        expandedPaths.add(node.path);
        node.children = loadNodeChildren(node, true);
      }
    }

    ui.titleText.content = `🌳 Oak`;
    debug("Title updated, calling updateContent()");
    updateContent();
    debug("Reload complete");
  }

  // Start socket server
  createSocketServer(reloadWithDir);

  // Add UI to renderer
  renderer.root.add(ui.root);
  debug("UI added to renderer");

  // Update content function
  function updateContent() {
    // Hide search box by default
    ui.searchBox.visible = false;
    ui.searchBox.height = 0;
    ui.searchBox.paddingTop = 0;

    // Clear existing content
    clearContent(ui.contentScroll);
    renderCounter++;

    // Update tab colors
    TABS.forEach((tab) => {
      const tabText = ui.tabBar
        .getChildren()
        .find((c) => c.id === `tab-${tab.id}`)
        ?.getChildren()[0];
      if (tabText) {
        (tabText as TextRenderable).fg =
          activeTab === tab.id ? "#fab283" : "#808080";
        (tabText as TextRenderable).bold = activeTab === tab.id;
      }
    });

    if (activeTab === "projects") {
      renderProjects(
        renderer,
        ui.contentScroll,
        projectNodes,
        renderCounter,
        updateContent,
      );
    } else if (activeTab === "files") {
      // Show search box
      ui.searchBox.visible = true;
      ui.searchBox.height = "auto";
      ui.searchBox.paddingTop = 1;
      ui.searchInput.content = searchQuery;
      ui.searchPlaceholder.visible = searchQuery.length === 0;

      renderFiles(
        renderer,
        ui.contentScroll,
        fileTree,
        searchQuery,
        expandedPaths,
        renderCounter,
        (path: string) => {
          if (expandedPaths.has(path)) {
            expandedPaths.delete(path);
          } else {
            expandedPaths.add(path);
            ensureChildrenLoaded(fileTree, path, true);
          }
          setTimeout(() => updateContent(), 0);
        },
      );
    } else if (activeTab === "themes") {
      renderThemes(
        renderer,
        ui.contentScroll,
        availableThemes(),
        currentTheme().name,
        renderCounter,
        (themeName: string) => {
          setTheme(themeName);
          updateUIColors(ui);
          setTimeout(() => updateContent(), 0);
        },
      );
    }
  }

  // Keyboard handler
  renderer.keyInput.on("keypress", (key) => {
    const keyName = key.name;
    debug(`Key pressed: ${keyName}`);

    if (keyName === "r") {
      // Reload the TUI
      reloadWithDir(currentDir);
    } else if (keyName === "tab") {
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + 1) % TABS.length;
      activeTab = TABS[nextIndex].id;
      updateContent();
    } else if (keyName === "escape") {
      if (searchQuery) {
        searchQuery = "";
        updateContent();
      }
    } else if (activeTab === "files" && keyName === "/") {
      // Toggle search mode (not implemented yet)
    } else if (activeTab === "files" && searchQuery !== undefined) {
      // Handle search input
      if (keyName === "backspace") {
        searchQuery = searchQuery.slice(0, -1);
        updateContent();
      } else if (keyName.length === 1) {
        searchQuery += keyName;
        updateContent();
      }
    }
  });

  // Initial render
  updateContent();
  debug("Initial render complete");

  // Keep the process alive - wait indefinitely
  await new Promise(() => {});
}

async function runWithCrashRecovery() {
  try {
    await main();
  } catch (error) {
    console.error("\n\n❌ Fatal error:", error);
    console.error("\nPress 'r' to reload, or Ctrl+C to exit");
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      process.stdin.on("data", (key) => {
        if (key.toString() === "r") {
          console.clear();
          process.exit(42);
        }
      });
    }
  }
}

runWithCrashRecovery();
