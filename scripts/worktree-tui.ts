import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  createTextAttributes,
  KeyEvent,
} from "@opentui/core";

// Type for keyInput that properly types the event methods
// The KeyHandler class extends EventEmitter<KeyHandlerEventMap> but TypeScript
// doesn't recognize the generic form, so we define the interface we need
interface KeyInputHandler {
  on(event: "keypress", listener: (key: Readonly<KeyEvent>) => void): this;
  on(event: "keyrelease", listener: (key: Readonly<KeyEvent>) => void): this;
}

// Type guard to safely cast renderer.keyInput to KeyInputHandler
// This checks at runtime that the object has the expected 'on' method
function isKeyInputHandler(value: unknown): value is KeyInputHandler {
  return (
    typeof value === "object" &&
    value !== null &&
    "on" in value &&
    typeof (value as Record<string, unknown>).on === "function"
  );
}

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
  getMainRepoPath,
  buildProjectNodes,
  deduplicateRecentProjects,
} from "./lib/project-manager";
import {
  readDirectoryEntries,
  loadNodeChildren,
  ensureChildrenLoaded,
} from "./components/file-tree";
import {
  renderIssuePopup,
  hidePopup,
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
import type { GroupedIssues, ReadonlyBeadsIssue } from "./lib/types";
import { initTmuxManager, setDebugFn } from "./lib/tmux-manager";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Debug logging - must be defined before setDebugFn
const DEBUG = process.argv.includes("--debug");
const CHECK_ONLY = process.argv.includes("--check-only");
const DEBUG_LOG_PATH = `${homedir()}/.local/share/oak-tui/debug.log`;

function debug(...args: readonly unknown[]): void {
  if (!DEBUG) return;
  const timestamp = new Date().toLocaleTimeString();
  const message = args
    .map((a) => {
      if (typeof a === "string") return a;
      if (typeof a === "number" || typeof a === "boolean") return String(a);
      if (a === null) return "null";
      if (a === undefined) return "undefined";
      return JSON.stringify(a);
    })
    .join(" ");
  appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`);
}

// UI state persistence
const DATA_DIR = join(homedir(), ".local", "share", "oak-tui");
const UI_STATE_PATH = join(DATA_DIR, "ui-state.json");

function loadUIState(): { activeTab?: TabId } {
  try {
    if (existsSync(UI_STATE_PATH)) {
      const data = readFileSync(UI_STATE_PATH, "utf-8");
      const parsed: unknown = JSON.parse(data);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "activeTab" in parsed
      ) {
        const activeTab = (parsed as { activeTab: unknown }).activeTab;
        if (
          activeTab === "projects" ||
          activeTab === "board" ||
          activeTab === "files" ||
          activeTab === "themes"
        ) {
          return { activeTab };
        }
      }
      return {};
    }
  } catch (err) {
    debug("Error loading UI state:", err);
  }
  return {};
}

function saveUIState(state: Readonly<{ activeTab: TabId }>): void {
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
setDebugFn((...args: readonly unknown[]) => {
  debug("tmux:", ...args);
});

// Initialize tmux manager (load background panes)
initTmuxManager();

// Helper type guard for Error
function isError(value: unknown): value is Error {
  return value instanceof Error;
}

// Crash recovery - using type guards to satisfy strict linting
process.on("uncaughtException", (error) => {
  const message = isError(error) ? error.message : String(error);
  console.error("\n\n❌ Crash detected:", message);
  console.error("\nPress 'r' to reload, or Ctrl+C to exit");
  if (process.stdin.isTTY) {
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
  if (process.stdin.isTTY) {
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
  let gitRoot = getGitRoot(startDir) ?? startDir;
  debug("Git root:", gitRoot);

  // Deduplicate recent projects on startup (resolves worktrees to main repos)
  const dedupeCount = deduplicateRecentProjects();
  if (dedupeCount > 0) {
    debug(`Deduplicated ${dedupeCount} project entries on startup`);
  }

  let recentProjects = loadRecentProjects();
  let projectNodes = buildProjectNodes(recentProjects, gitRoot);
  debug("Project nodes:", projectNodes.length);
  let fileTree = readDirectoryEntries(gitRoot, 0, true);
  debug("File tree entries:", fileTree.length);

  // Resolve to main repo path before saving
  const mainRepoPath = getMainRepoPath(gitRoot);
  if (mainRepoPath !== null && mainRepoPath !== "") {
    saveRecentProject(mainRepoPath);
    // Update gitRoot to main repo path for consistency
    gitRoot = mainRepoPath;
    // Rebuild project nodes with correct git root
    projectNodes = buildProjectNodes(recentProjects, gitRoot);
  } else {
    saveRecentProject(gitRoot);
  }

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
  let projectsRefreshInterval: ReturnType<typeof setInterval> | null = null;
  let activeWorktreePath: string | undefined; // Track active worktree for Board tab
  // Issue popup state
  let issuePopupState: IssuePopupState = {
    issue: null,
    scrollOffset: 0,
    visible: false,
  };

  // Worktree switch handler - used by both keyboard and mouse
  const handleWorktreeSwitch = (worktreePath: string, projectPath: string) => {
    void import("./lib/tmux-manager").then(
      ({
        switchToWorktree,
      }: Readonly<{
        switchToWorktree: (path: string, projectPath: string) => void;
      }>) => {
        switchToWorktree(worktreePath, projectPath);
        // Update active worktree path for Board tab
        activeWorktreePath = worktreePath;
        debug(`Active worktree set to: ${activeWorktreePath}`);
        // Refresh board if it's the active tab
        if (activeTab === "board") {
          debug("Board refresh triggered by worktree switch");
          boardIssues = fetchAndGroupIssues(activeWorktreePath);
        }
        updateContent();
      },
    );
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

  TABS.forEach((tab: Readonly<{ id: TabId; label: string }>, _i) => {
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
      attributes:
        activeTab === tab.id ? createTextAttributes({ bold: true }) : 0,
    });
    tabBox.add(tabText);
    tabBox.onMouse = (
      event: Readonly<{ type: string; stopPropagation: () => void }>,
    ) => {
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
    gitRoot = getGitRoot(newDir) ?? newDir;
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
    // Clear refresh intervals when switching tabs
    if (boardRefreshInterval) {
      clearInterval(boardRefreshInterval);
      boardRefreshInterval = null;
    }
    if (projectsRefreshInterval) {
      clearInterval(projectsRefreshInterval);
      projectsRefreshInterval = null;
    }

    // Hide search box by default
    ui.searchBoxOuter.visible = false;

    // Clear existing content
    clearContent(ui.contentScroll);
    renderCounter++;

    // Update tab colors
    TABS.forEach((tab: Readonly<{ id: TabId; label: string }>) => {
      const tabBox = ui.tabBar
        .getChildren()
        .find((c: Readonly<{ id?: string }>) => c.id === `tab-${tab.id}`);
      const tabText = tabBox?.getChildren()[0];
      if (tabText !== undefined && tabText instanceof TextRenderable) {
        tabText.fg = activeTab === tab.id ? "#fab283" : "#808080";
        tabText.attributes =
          activeTab === tab.id ? createTextAttributes({ bold: true }) : 0;
      }
    });

    if (activeTab === "projects") {
      // Show search box when in search mode
      if (projectsSearchMode || projectsSearchQuery !== "") {
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
        activeWorktreePath,
        handleWorktreeSwitch,
      );

      // Set up auto-refresh every 5 seconds
      debug("Setting up projects auto-refresh (5s interval)");
      projectsRefreshInterval = setInterval(() => {
        debug("Auto-refreshing projects list...");
        // Rebuild project nodes to detect new worktrees
        const mainRepoPath = getMainRepoPath(gitRoot);
        const refreshedProjectNodes = buildProjectNodes(
          recentProjects,
          mainRepoPath ?? gitRoot,
        );
        projectNodes = refreshedProjectNodes;

        // Re-filter and re-render
        const refreshedFiltered = filterProjects(
          projectNodes,
          projectsSearchQuery,
        );
        clearContent(ui.contentScroll);
        renderCounter++;
        renderProjects(
          renderer,
          ui.contentScroll,
          refreshedFiltered,
          renderCounter,
          updateContent,
          selectedIndex,
          activeWorktreePath,
          handleWorktreeSwitch,
        );
        renderer.requestRender();
      }, 5000);
    } else if (activeTab === "files") {
      // Show search box only when in search mode
      if (searchMode || searchQuery !== "") {
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
          setTimeout(() => {
            updateContent();
          }, 0);
        },
        filesSelectedIndex,
      );
    } else if (activeTab === "board") {
      // Show search box when in search mode
      if (boardSearchMode || boardSearchQuery !== "") {
        ui.searchBoxOuter.visible = true;
        ui.searchInput.content = boardSearchQuery;
        ui.searchPlaceholder.visible = boardSearchQuery.length === 0;
        ui.searchCursor.visible = boardSearchMode;
      }

      // Fetch fresh issues and filter (use active worktree path if set)
      boardIssues = fetchAndGroupIssues(activeWorktreePath);
      const filteredIssues = filterBoardIssues(boardIssues, boardSearchQuery);

      // Show popup if visible, otherwise show board
      if (issuePopupState.visible && issuePopupState.issue) {
        renderIssuePopup(
          renderer,
          ui.contentScroll,
          issuePopupState,
          currentTheme(),
          renderCounter,
          () => {
            setTimeout(() => {
              hidePopup(issuePopupState);
              updateContent();
            }, 0);
          },
        );
      } else {
        renderBoard(
          renderer,
          ui.contentScroll,
          filteredIssues,
          renderCounter,
          selectedIndex,
          (issue: ReadonlyBeadsIssue) => {
            debug("Selected issue:", issue.id);
          },
          (issue: ReadonlyBeadsIssue) => {
            // Double-click opens popup - defer to avoid crash during mouse event
            setTimeout(() => {
              debug("Opening issue popup:", issue.id);
              issuePopupState.visible = true;
              issuePopupState.issue = issue;
              issuePopupState.scrollOffset = 0;
              updateContent();
            }, 0);
          },
        );
      }

      // Set up auto-refresh every 5 seconds (skip if popup is visible)
      boardRefreshInterval = setInterval(() => {
        if (issuePopupState.visible) return; // Don't refresh while popup is open
        boardIssues = fetchAndGroupIssues(activeWorktreePath);
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
          (issue: ReadonlyBeadsIssue) => {
            debug("Selected issue:", issue.id);
          },
          (issue: ReadonlyBeadsIssue) => {
            // Double-click opens popup - defer to avoid crash during mouse event
            setTimeout(() => {
              debug("Opening issue popup:", issue.id);
              issuePopupState.visible = true;
              issuePopupState.issue = issue;
              issuePopupState.scrollOffset = 0;
              updateContent();
            }, 0);
          },
        );
        renderer.requestRender();
        debug(`Board auto-refreshed (render ${renderCounter})`);
      }, 5000);
    } else {
      // activeTab === "themes"
      renderThemes(
        renderer,
        ui.contentScroll,
        availableThemes(),
        currentTheme().name,
        renderCounter,
        (themeName: string) => {
          setTheme(themeName);
          updateUIColors(ui);
          setTimeout(() => {
            updateContent();
          }, 0);
        },
      );
    }
  }

  // Keyboard handler
  // Use type guard to safely cast renderer.keyInput to KeyInputHandler
  // TypeScript's EventEmitter generic doesn't expose the `on` method properly
  // for typed event maps in the @opentui/core KeyHandler
  if (!isKeyInputHandler(renderer.keyInput)) {
    throw new Error("renderer.keyInput is not a valid KeyInputHandler");
  }
  const keyInput: KeyInputHandler = renderer.keyInput;
  keyInput.on("keypress", (key: Readonly<KeyEvent>) => {
    const keyName: string = key.name;
    debug(
      `Key pressed: ${keyName}, ctrl: ${key.ctrl}, shift: ${key.shift}, meta: ${key.meta}`,
    );

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
      const currentIndex = TABS.findIndex(
        (t: Readonly<{ id: TabId; label: string }>) => t.id === activeTab,
      );
      const prevIndex = (currentIndex - 1 + TABS.length) % TABS.length;
      activeTab = TABS[prevIndex].id;
      saveUIState({ activeTab });
      selectedIndex = 0;
      updateContent();
    } else if (keyName === "tab") {
      // Tab: cycle tabs forward
      const currentIndex = TABS.findIndex(
        (t: Readonly<{ id: TabId; label: string }>) => t.id === activeTab,
      );
      const nextIndex = (currentIndex + 1) % TABS.length;
      activeTab = TABS[nextIndex].id;
      saveUIState({ activeTab });
      selectedIndex = 0; // Reset selection when switching tabs
      updateContent();
    } else if (
      ((keyName === "left" && key.ctrl) ||
        (keyName === "h" && key.ctrl) ||
        (keyName === "backspace" &&
          !searchMode &&
          !projectsSearchMode &&
          !boardSearchMode)) &&
      !key.shift
    ) {
      // Ctrl+Left or Ctrl+h (backspace): navigate to previous tab
      // Note: Ctrl+h is interpreted as backspace by the terminal
      const currentIndex = TABS.findIndex(
        (t: Readonly<{ id: TabId; label: string }>) => t.id === activeTab,
      );
      const prevIndex = (currentIndex - 1 + TABS.length) % TABS.length;
      activeTab = TABS[prevIndex].id;
      saveUIState({ activeTab });
      selectedIndex = 0;
      updateContent();
    } else if (
      ((keyName === "right" && key.ctrl) || (keyName === "l" && key.ctrl)) &&
      !key.shift
    ) {
      // Ctrl+Right or Ctrl+l: navigate to next tab
      const currentIndex = TABS.findIndex(
        (t: Readonly<{ id: TabId; label: string }>) => t.id === activeTab,
      );
      const nextIndex = (currentIndex + 1) % TABS.length;
      activeTab = TABS[nextIndex].id;
      saveUIState({ activeTab });
      selectedIndex = 0;
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
        searchQuery !== "" ||
        projectsSearchMode ||
        projectsSearchQuery !== "" ||
        boardSearchMode ||
        boardSearchQuery !== ""
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
          // Find the original node in projectNodes by path
          const originalNode = projectNodes.find(
            (n) => n.path === filteredProjects[item.projectIndex].path,
          );
          if (originalNode?.isExpanded) {
            originalNode.isExpanded = false;
            expandedPaths.delete(originalNode.path);
            updateContent();
          }
        }
      } else if (keyName === "right" || keyName === "l") {
        // Expand/unfold the current item
        const item = getItemAtIndex(filteredProjects, selectedIndex);
        if (item) {
          // Find the original node in projectNodes by path
          const originalNode = projectNodes.find(
            (n) => n.path === filteredProjects[item.projectIndex].path,
          );
          if (originalNode && !originalNode.isExpanded) {
            originalNode.isExpanded = true;
            expandedPaths.add(originalNode.path);
            updateContent();
          }
        }
      } else if (keyName === "space" || keyName === "return") {
        // Select/activate the current item
        const item = getItemAtIndex(filteredProjects, selectedIndex);
        if (item) {
          if (item.type === "project") {
            // Toggle project expansion - find original node
            const originalNode = projectNodes.find(
              (n) => n.path === filteredProjects[item.projectIndex].path,
            );
            if (originalNode) {
              originalNode.isExpanded = !originalNode.isExpanded;
              if (originalNode.isExpanded) {
                expandedPaths.add(originalNode.path);
              } else {
                expandedPaths.delete(originalNode.path);
              }
              updateContent();
            }
          } else if (typeof item.worktreeIndex === "number") {
            // item.type must be "worktree" at this point
            // Switch to worktree - use filteredProjects for reading data
            const node = filteredProjects[item.projectIndex];
            const wt = node.worktrees[item.worktreeIndex];
            if (wt !== undefined) {
              handleWorktreeSwitch(wt.path, node.path);
            }
          }
        }
      } else if (keyName === "d") {
        // Delete project from recent list (only for project headers, not worktrees)
        const item = getItemAtIndex(filteredProjects, selectedIndex);
        if (item?.type === "project") {
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
        if (result !== null) {
          // Copy issue ID to clipboard using xclip or xsel
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
          if (file?.isDirectory === true && expandedPaths.has(file.path)) {
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
          if (file?.isDirectory === true && !expandedPaths.has(file.path)) {
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
          if (file !== null) {
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
        } else if (keyName === "y") {
          // Copy relative file path to clipboard
          const file = getFileAtIndex(
            fileTree,
            searchQuery,
            expandedPaths,
            filesSelectedIndex,
          );
          if (file !== null) {
            const relativePath = file.path.replace(currentDir + "/", "");
            try {
              execSync(
                `echo -n "${relativePath}" | xclip -selection clipboard`,
                { stdio: "ignore" },
              );
              debug("Copied to clipboard:", relativePath);
            } catch {
              // Try xsel as fallback
              try {
                execSync(
                  `echo -n "${relativePath}" | xsel --clipboard --input`,
                  { stdio: "ignore" },
                );
                debug("Copied to clipboard (xsel):", relativePath);
              } catch {
                debug("Failed to copy to clipboard - xclip/xsel not available");
              }
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
    if (process.stdin.isTTY) {
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

void runWithCrashRecovery();
