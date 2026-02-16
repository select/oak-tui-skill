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
  removeRecentProject,
  getGitRoot,
  buildProjectNodes,
} from "./lib/project-manager";
import {
  readDirectoryEntries,
  loadNodeChildren,
  ensureChildrenLoaded,
} from "./components/file-tree";
import {
  renderIssuePopup,
  type IssuePopupState,
} from "./components/issue-popup";
import {
  createUIComponents,
  renderProjects,
  renderFiles,
  renderThemes,
  renderBoard,
  clearContent,
  updateUIColors,
  getSelectableCount,
  getItemAtIndex,
  getFilesSelectableCount,
  getFileAtIndex,
  filterProjects,
  filterBoardIssues,
} from "./lib/ui-renderer";
import {
  initThemes,
  currentTheme,
  setTheme,
  availableThemes,
} from "./lib/theme-manager";
import {
  fetchAndGroupIssues,
  getTotalBoardCount,
  getIssueAtIndex,
  getNextSectionStart,
  getPrevSectionStart,
} from "./lib/beads-manager";
import type { GroupedIssues } from "./lib/types";
import { initTmuxManager, setDebugFn } from "./lib/tmux-manager";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

// UI state persistence
const DATA_DIR = join(homedir(), ".local/share/git-worktree-manager");
const UI_STATE_PATH = join(DATA_DIR, "ui-state.json");

function loadUIState(): { activeTab?: TabId } {
  try {
    if (existsSync(UI_STATE_PATH)) {
      const data = readFileSync(UI_STATE_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    debug("Error loading UI state:", err);
  }
  return {};
}

function saveUIState(state: { activeTab: TabId }): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(UI_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    debug("Error saving UI state:", err);
  }
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

  // Load saved tab or default to "projects"
  const savedState = loadUIState();
  const validTabs: TabId[] = ["projects", "board", "files", "themes"];
  let activeTab: TabId =
    savedState.activeTab && validTabs.includes(savedState.activeTab)
      ? savedState.activeTab
      : "projects";
  debug("Loaded activeTab:", activeTab);
  let renderCounter = 0;
  let searchQuery = ""; // For files view
  let searchMode = false; // Whether search input is active (files view)
  let projectsSearchQuery = ""; // For projects view
  let projectsSearchMode = false; // Whether search input is active (projects view)
  let boardSearchQuery = ""; // For board view
  let boardSearchMode = false; // Whether search input is active (board view)
  let expandedPaths = new Set<string>();
  let selectedIndex = 0; // Track keyboard selection for projects/board
  let filesSelectedIndex = 0; // Track keyboard selection for files view
  let boardIssues: GroupedIssues = {
    blocked: [],
    ready: [],
    in_progress: [],
    closed: [],
  };
  let boardRefreshInterval: ReturnType<typeof setInterval> | null = null;
  // Issue popup state
  let issuePopupState: IssuePopupState = {
    issue: null,
    scrollOffset: 0,
    visible: false,
  };

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
    { id: "board", label: "Board" },
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
        saveUIState({ activeTab });
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

  // Cursor blink interval
  let cursorVisible = true;
  setInterval(() => {
    const isSearchActive =
      (activeTab === "projects" && projectsSearchMode) ||
      (activeTab === "files" && searchMode) ||
      (activeTab === "board" && boardSearchMode);

    if (isSearchActive) {
      cursorVisible = !cursorVisible;
      ui.searchCursor.visible = cursorVisible;
      renderer.requestRender();
    }
  }, 530);

  // Add UI to renderer
  renderer.root.add(ui.root);
  debug("UI added to renderer");

  // Update content function
  function updateContent() {
    // Clear board refresh interval when switching tabs
    if (boardRefreshInterval) {
      clearInterval(boardRefreshInterval);
      boardRefreshInterval = null;
    }

    // Hide search box by default
    ui.searchBoxOuter.visible = false;

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
      // Show search box when in search mode
      if (projectsSearchMode || projectsSearchQuery) {
        ui.searchBoxOuter.visible = true;
        ui.searchInput.content = projectsSearchQuery;
        ui.searchPlaceholder.visible = projectsSearchQuery.length === 0;
        ui.searchCursor.visible = projectsSearchMode;
      }

      const filteredProjects = filterProjects(
        projectNodes,
        projectsSearchQuery,
      );
      renderProjects(
        renderer,
        ui.contentScroll,
        filteredProjects,
        renderCounter,
        updateContent,
        selectedIndex,
      );
    } else if (activeTab === "files") {
      // Show search box only when in search mode
      if (searchMode || searchQuery) {
        ui.searchBoxOuter.visible = true;
        ui.searchInput.content = searchQuery;
        ui.searchPlaceholder.visible = searchQuery.length === 0;
        ui.searchCursor.visible = searchMode;
      }

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
        filesSelectedIndex,
      );
    } else if (activeTab === "board") {
      // Show search box when in search mode
      if (boardSearchMode || boardSearchQuery) {
        ui.searchBoxOuter.visible = true;
        ui.searchInput.content = boardSearchQuery;
        ui.searchPlaceholder.visible = boardSearchQuery.length === 0;
        ui.searchCursor.visible = boardSearchMode;
      }

      // Fetch fresh issues and filter
      boardIssues = fetchAndGroupIssues();
      const filteredIssues = filterBoardIssues(boardIssues, boardSearchQuery);

      // Show popup if visible, otherwise show board
      if (issuePopupState.visible && issuePopupState.issue) {
        renderIssuePopup(
          renderer,
          ui.contentScroll,
          issuePopupState,
          currentTheme(),
          renderCounter,
        );
      } else {
        renderBoard(
          renderer,
          ui.contentScroll,
          filteredIssues,
          renderCounter,
          selectedIndex,
          (issue) => {
            debug("Selected issue:", issue.id);
          },
          (issue) => {
            // Double-click opens popup
            debug("Opening issue popup:", issue.id);
            issuePopupState.visible = true;
            issuePopupState.issue = issue;
            issuePopupState.scrollOffset = 0;
            updateContent();
          },
        );
      }

      // Set up auto-refresh every 5 seconds (skip if popup is visible)
      boardRefreshInterval = setInterval(() => {
        if (issuePopupState.visible) return; // Don't refresh while popup is open
        boardIssues = fetchAndGroupIssues();
        const refreshedFiltered = filterBoardIssues(
          boardIssues,
          boardSearchQuery,
        );
        clearContent(ui.contentScroll);
        renderCounter++;
        renderBoard(
          renderer,
          ui.contentScroll,
          refreshedFiltered,
          renderCounter,
          selectedIndex,
          (issue) => {
            debug("Selected issue:", issue.id);
          },
          (issue) => {
            // Double-click opens popup
            debug("Opening issue popup:", issue.id);
            issuePopupState.visible = true;
            issuePopupState.issue = issue;
            issuePopupState.scrollOffset = 0;
            updateContent();
          },
        );
        renderer.requestRender();
        debug(`Board auto-refreshed (render ${renderCounter})`);
      }, 5000);
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
    } else if (
      keyName === "1" ||
      keyName === "2" ||
      keyName === "3" ||
      keyName === "4"
    ) {
      // Number keys: switch to specific tab
      const tabIndex = parseInt(keyName) - 1;
      if (tabIndex >= 0 && tabIndex < TABS.length) {
        activeTab = TABS[tabIndex].id;
        saveUIState({ activeTab });
        selectedIndex = 0;
        filesSelectedIndex = 0;
        updateContent();
      }
    } else if (keyName === "tab" && key.shift) {
      // Shift+Tab: cycle tabs in reverse
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);
      const prevIndex = (currentIndex - 1 + TABS.length) % TABS.length;
      activeTab = TABS[prevIndex].id;
      saveUIState({ activeTab });
      selectedIndex = 0;
      updateContent();
    } else if (keyName === "tab") {
      // Tab: cycle tabs forward
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + 1) % TABS.length;
      activeTab = TABS[nextIndex].id;
      saveUIState({ activeTab });
      selectedIndex = 0; // Reset selection when switching tabs
      updateContent();
    } else if (keyName === "escape") {
      // Close popup if open
      if (issuePopupState.visible) {
        issuePopupState.visible = false;
        issuePopupState.issue = null;
        issuePopupState.scrollOffset = 0;
        updateContent();
        return;
      }
      // Clear all search modes and queries
      if (
        searchMode ||
        searchQuery ||
        projectsSearchMode ||
        projectsSearchQuery ||
        boardSearchMode ||
        boardSearchQuery
      ) {
        searchMode = false;
        searchQuery = "";
        projectsSearchMode = false;
        projectsSearchQuery = "";
        boardSearchMode = false;
        boardSearchQuery = "";
        selectedIndex = 0;
        filesSelectedIndex = 0;
        updateContent();
      }
    } else if (activeTab === "projects") {
      // Search mode handling
      if (projectsSearchMode) {
        if (keyName === "return") {
          projectsSearchMode = false;
          updateContent();
          return;
        } else if (keyName === "backspace") {
          projectsSearchQuery = projectsSearchQuery.slice(0, -1);
          selectedIndex = 0;
          updateContent();
          return;
        } else if (keyName.length === 1) {
          projectsSearchQuery += keyName;
          selectedIndex = 0;
          updateContent();
          return;
        }
        return;
      }

      // Filter projects by search query
      const filteredProjects = filterProjects(
        projectNodes,
        projectsSearchQuery,
      );
      // Navigation with arrow keys and vim keys
      const totalItems = getSelectableCount(filteredProjects);
      if (keyName === "/" || keyName === "slash") {
        projectsSearchMode = true;
        updateContent();
      } else if (keyName === "up" || keyName === "k") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        updateContent();
      } else if (keyName === "down" || keyName === "j") {
        selectedIndex = Math.min(totalItems - 1, selectedIndex + 1);
        updateContent();
      } else if (keyName === "left" || keyName === "h") {
        // Collapse/fold the current item
        const item = getItemAtIndex(filteredProjects, selectedIndex);
        if (item) {
          const node = filteredProjects[item.projectIndex];
          if (node.isExpanded) {
            node.isExpanded = false;
            expandedPaths.delete(node.path);
            updateContent();
          }
        }
      } else if (keyName === "right" || keyName === "l") {
        // Expand/unfold the current item
        const item = getItemAtIndex(filteredProjects, selectedIndex);
        if (item) {
          const node = filteredProjects[item.projectIndex];
          if (!node.isExpanded) {
            node.isExpanded = true;
            expandedPaths.add(node.path);
            updateContent();
          }
        }
      } else if (keyName === "space" || keyName === "return") {
        // Select/activate the current item
        const item = getItemAtIndex(filteredProjects, selectedIndex);
        if (item) {
          if (item.type === "project") {
            // Toggle project expansion
            const node = filteredProjects[item.projectIndex];
            node.isExpanded = !node.isExpanded;
            if (node.isExpanded) {
              expandedPaths.add(node.path);
            } else {
              expandedPaths.delete(node.path);
            }
            updateContent();
          } else if (
            item.type === "worktree" &&
            item.worktreeIndex !== undefined
          ) {
            // Switch to worktree
            const node = filteredProjects[item.projectIndex];
            const wt = node.worktrees[item.worktreeIndex];
            if (wt) {
              import("./lib/tmux-manager").then(({ switchToWorktree }) => {
                switchToWorktree(wt.path, node.path);
                updateContent();
              });
            }
          }
        }
      } else if (keyName === "d") {
        // Delete project from recent list (only for project headers, not worktrees)
        const item = getItemAtIndex(filteredProjects, selectedIndex);
        if (item && item.type === "project") {
          const node = filteredProjects[item.projectIndex];
          const removed = removeRecentProject(node.path);
          if (removed) {
            debug("Removed project from recent list:", node.path);
            // Reload project list
            recentProjects = loadRecentProjects();
            projectNodes = buildProjectNodes(recentProjects, gitRoot);
            // Adjust selected index if needed
            const newTotal = getSelectableCount(projectNodes);
            if (selectedIndex >= newTotal) {
              selectedIndex = Math.max(0, newTotal - 1);
            }
            updateContent();
          }
        }
      }
    } else if (activeTab === "board") {
      // Handle popup navigation first
      if (issuePopupState.visible) {
        if (keyName === "j" || keyName === "down") {
          issuePopupState.scrollOffset = Math.min(
            issuePopupState.scrollOffset + 1,
            20,
          ); // Max scroll
          updateContent();
          return;
        } else if (keyName === "k" || keyName === "up") {
          issuePopupState.scrollOffset = Math.max(
            issuePopupState.scrollOffset - 1,
            0,
          );
          updateContent();
          return;
        }
        // Escape is handled globally above
        return; // Ignore other keys when popup is open
      }

      // Board navigation with search mode
      const filteredIssues = filterBoardIssues(boardIssues, boardSearchQuery);
      const totalItems = getTotalBoardCount(filteredIssues);

      if (boardSearchMode) {
        // In search mode, handle text input
        if (keyName === "return") {
          // Exit search mode but keep filter active
          boardSearchMode = false;
          updateContent();
        } else if (keyName === "backspace") {
          boardSearchQuery = boardSearchQuery.slice(0, -1);
          selectedIndex = 0; // Reset selection when search changes
          updateContent();
        } else if (keyName.length === 1) {
          boardSearchQuery += keyName;
          selectedIndex = 0; // Reset selection when search changes
          updateContent();
        }
      } else if (keyName === "/") {
        // Enter search mode
        boardSearchMode = true;
        boardSearchQuery = "";
        selectedIndex = 0;
        updateContent();
      } else if (keyName === "up" || keyName === "k") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        updateContent();
      } else if (keyName === "down" || keyName === "j") {
        selectedIndex = Math.min(totalItems - 1, selectedIndex + 1);
        updateContent();
      } else if (keyName === "left" || keyName === "h") {
        // Jump to previous section
        selectedIndex = getPrevSectionStart(filteredIssues, selectedIndex);
        updateContent();
      } else if (keyName === "right" || keyName === "l") {
        // Jump to next section
        selectedIndex = getNextSectionStart(filteredIssues, selectedIndex);
        updateContent();
      } else if (keyName === "return" || keyName === "space") {
        const result = getIssueAtIndex(filteredIssues, selectedIndex);
        if (result) {
          debug("Activated issue:", result.issue.id);
          issuePopupState.issue = result.issue;
          issuePopupState.visible = true;
          issuePopupState.scrollOffset = 0;
          updateContent();
        }
      } else if (keyName === "y") {
        const result = getIssueAtIndex(filteredIssues, selectedIndex);
        if (result) {
          // Copy issue ID to clipboard using xclip or xsel
          const { execSync } = require("node:child_process");
          try {
            execSync(
              `echo -n "${result.issue.id}" | xclip -selection clipboard`,
              { stdio: "ignore" },
            );
            debug("Copied to clipboard:", result.issue.id);
          } catch {
            // Try xsel as fallback
            try {
              execSync(
                `echo -n "${result.issue.id}" | xsel --clipboard --input`,
                { stdio: "ignore" },
              );
              debug("Copied to clipboard (xsel):", result.issue.id);
            } catch {
              debug("Failed to copy to clipboard - xclip/xsel not available");
            }
          }
        }
      } else if (keyName === "r") {
        // Manual refresh
        debug("Manual board refresh triggered");
        updateContent();
      }
    } else if (activeTab === "files") {
      // Files navigation with vim keys and arrow keys
      const totalFiles = getFilesSelectableCount(
        fileTree,
        searchQuery,
        expandedPaths,
      );

      if (searchMode) {
        // In search mode, handle text input
        if (keyName === "return") {
          // Exit search mode but keep filter active
          searchMode = false;
          updateContent();
        } else if (keyName === "backspace") {
          searchQuery = searchQuery.slice(0, -1);
          filesSelectedIndex = 0; // Reset selection when search changes
          updateContent();
        } else if (keyName.length === 1) {
          searchQuery += keyName;
          filesSelectedIndex = 0; // Reset selection when search changes
          updateContent();
        }
      } else {
        // Normal navigation mode
        if (keyName === "/") {
          // Activate search mode
          searchMode = true;
          updateContent();
        } else if (keyName === "up" || keyName === "k") {
          filesSelectedIndex = Math.max(0, filesSelectedIndex - 1);
          updateContent();
        } else if (keyName === "down" || keyName === "j") {
          filesSelectedIndex = Math.min(totalFiles - 1, filesSelectedIndex + 1);
          updateContent();
        } else if (keyName === "left" || keyName === "h") {
          // Collapse folder
          const file = getFileAtIndex(
            fileTree,
            searchQuery,
            expandedPaths,
            filesSelectedIndex,
          );
          if (file && file.isDirectory && expandedPaths.has(file.path)) {
            expandedPaths.delete(file.path);
            updateContent();
          }
        } else if (keyName === "right" || keyName === "l") {
          // Expand folder
          const file = getFileAtIndex(
            fileTree,
            searchQuery,
            expandedPaths,
            filesSelectedIndex,
          );
          if (file && file.isDirectory && !expandedPaths.has(file.path)) {
            expandedPaths.add(file.path);
            ensureChildrenLoaded(fileTree, file.path, true);
            updateContent();
          }
        } else if (keyName === "space" || keyName === "return") {
          // Toggle folder or activate file
          const file = getFileAtIndex(
            fileTree,
            searchQuery,
            expandedPaths,
            filesSelectedIndex,
          );
          if (file) {
            if (file.isDirectory) {
              if (expandedPaths.has(file.path)) {
                expandedPaths.delete(file.path);
              } else {
                expandedPaths.add(file.path);
                ensureChildrenLoaded(fileTree, file.path, true);
              }
              updateContent();
            } else {
              // TODO: Open file in editor
              debug("Selected file:", file.path);
            }
          }
        }
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
