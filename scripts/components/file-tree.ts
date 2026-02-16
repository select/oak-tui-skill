import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  type CliRenderer,
  type MouseEvent,
} from "@opentui/core";
import { readdirSync, statSync, lstatSync } from "fs";
import { join } from "path";

// File tree node interface
export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  depth: number;
  children?: FileTreeNode[];
}

// Directories to always ignore (too large/not useful)
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

// File icons by extension (B&W Unicode)
const FILE_ICONS: Record<string, string> = {
  ".ts": "◈", // U+25C8 - code files
  ".tsx": "◈",
  ".js": "◈",
  ".jsx": "◈",
  ".json": "◉", // U+25C9 - config files
  ".md": "☰", // U+2630 - docs
  ".lua": "◆", // U+25C6 - script
  ".sh": "▪", // U+25AA - shell script
  ".zsh": "▪",
  ".py": "◆", // U+25C6 - script
  ".rs": "◈", // U+25C8 - code
  ".go": "◈", // U+25C8 - code
};

export function getFileIcon(name: string, isDirectory: boolean): string {
  if (isDirectory) return "▸"; // U+25B8 - directory
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  return FILE_ICONS[ext] || "○"; // U+25CB - default file
}

// Read directory entries (single level, no recursion)
export function readDirectoryEntries(
  dir: string,
  depth: number,
  showHidden = true,
): FileTreeNode[] {
  try {
    const entries = readdirSync(dir)
      .filter((e) => {
        // Always ignore certain large directories
        if (IGNORED_DIRS.has(e)) return false;
        // Show hidden files based on setting
        if (e.startsWith(".") && !showHidden) return false;
        return true;
      })
      .sort((a, b) => {
        const aPath = join(dir, a);
        const bPath = join(dir, b);
        try {
          const aIsDir = statSync(aPath).isDirectory();
          const bIsDir = statSync(bPath).isDirectory();
          // Directories first
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;
        } catch {}
        // Hidden files after non-hidden within same type
        const aHidden = a.startsWith(".");
        const bHidden = b.startsWith(".");
        if (aHidden && !bHidden) return 1;
        if (!aHidden && bHidden) return -1;
        return a.localeCompare(b);
      });

    return entries.map((entry) => {
      const fullPath = join(dir, entry);
      let isDirectory = false;
      let isSymlink = false;

      try {
        const lstats = lstatSync(fullPath);
        isSymlink = lstats.isSymbolicLink();
        const stats = statSync(fullPath);
        isDirectory = stats.isDirectory();
      } catch {}

      return {
        name: entry,
        path: fullPath,
        isDirectory,
        isSymlink,
        depth,
        // Children are NOT loaded here - they're loaded lazily on expand
        children: undefined,
      };
    });
  } catch {
    return [];
  }
}

// Load children for a specific node (lazy loading)
export function loadNodeChildren(
  node: FileTreeNode,
  showHidden = true,
): FileTreeNode[] {
  if (!node.isDirectory) return [];
  return readDirectoryEntries(node.path, node.depth + 1, showHidden);
}

// Find a node by path in the tree and load its children
export function ensureChildrenLoaded(
  nodes: FileTreeNode[],
  targetPath: string,
  showHidden = true,
): boolean {
  for (const node of nodes) {
    if (node.path === targetPath) {
      if (node.isDirectory && !node.children) {
        node.children = loadNodeChildren(node, showHidden);
      }
      return true;
    }
    if (node.children) {
      if (ensureChildrenLoaded(node.children, targetPath, showHidden)) {
        return true;
      }
    }
  }
  return false;
}

// Fuzzy search function
export function fuzzyMatch(
  pattern: string,
  str: string,
): { match: boolean; score: number } {
  if (!pattern) return { match: true, score: 0 };

  const patternLower = pattern.toLowerCase();
  const strLower = str.toLowerCase();

  // Exact substring match gets highest score
  if (strLower.includes(patternLower)) {
    return { match: true, score: 100 - strLower.indexOf(patternLower) };
  }

  // Fuzzy match - all pattern chars must appear in order
  let patternIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (
    let i = 0;
    i < strLower.length && patternIdx < patternLower.length;
    i++
  ) {
    if (strLower[i] === patternLower[patternIdx]) {
      // Consecutive matches score higher
      if (lastMatchIdx === i - 1) score += 10;
      else score += 1;
      // Match at start scores higher
      if (i === 0) score += 20;
      // Match after separator scores higher
      if (
        i > 0 &&
        (str[i - 1] === "/" ||
          str[i - 1] === "-" ||
          str[i - 1] === "_" ||
          str[i - 1] === ".")
      )
        score += 15;

      lastMatchIdx = i;
      patternIdx++;
    }
  }

  return { match: patternIdx === patternLower.length, score };
}

// Filter file tree based on search pattern
export function filterFileTree(
  nodes: FileTreeNode[],
  pattern: string,
): FileTreeNode[] {
  if (!pattern) return nodes;

  const results: FileTreeNode[] = [];

  function searchNode(
    node: FileTreeNode,
    parentMatches: boolean,
  ): FileTreeNode | null {
    const { match } = fuzzyMatch(pattern, node.name);

    // For directories, also check if any children match
    let matchingChildren: FileTreeNode[] = [];
    if (node.children) {
      for (const child of node.children) {
        const matchedChild = searchNode(child, match || parentMatches);
        if (matchedChild) matchingChildren.push(matchedChild);
      }
    }

    // Include node if it matches or has matching children
    if (match || matchingChildren.length > 0) {
      return {
        ...node,
        children: matchingChildren.length > 0 ? matchingChildren : undefined,
      };
    }

    return null;
  }

  for (const node of nodes) {
    const matched = searchNode(node, false);
    if (matched) results.push(matched);
  }

  return results;
}

// Flatten file tree for rendering, respecting expanded state
export function flattenFileTree(
  nodes: FileTreeNode[],
  expandedPaths: Set<string>,
  searchFilter: string,
): FileTreeNode[] {
  const result: FileTreeNode[] = [];

  function traverse(nodeList: FileTreeNode[]) {
    for (const node of nodeList) {
      result.push(node);
      // Show children if expanded OR if there's a search filter (show all matches)
      if (node.children && (expandedPaths.has(node.path) || searchFilter)) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return result;
}

// File tree component state
export interface FileTreeState {
  fileTree: FileTreeNode[];
  expandedPaths: Set<string>;
  searchFilter: string;
}

// Create file tree state
export function createFileTreeState(rootDir: string): FileTreeState {
  // Only load the first level initially
  const fileTree = readDirectoryEntries(rootDir, 0, true);
  // Expand first level by default and load their children
  const expandedPaths = new Set<string>();
  for (const node of fileTree) {
    if (node.isDirectory) {
      expandedPaths.add(node.path);
      // Load children for expanded directories
      node.children = loadNodeChildren(node, true);
    }
  }
  return { fileTree, expandedPaths, searchFilter: "" };
}

// Render file tree into a ScrollBox
export function renderFileTree(
  renderer: CliRenderer,
  contentScroll: ScrollBoxRenderable,
  state: FileTreeState,
  renderCounter: number,
  onToggleFolder: (path: string) => void,
): void {
  // Clear existing content
  const children = contentScroll.getChildren();
  for (const child of children) {
    contentScroll.remove(child.id);
    child.destroyRecursively();
  }

  // Filter and flatten tree
  const filteredTree = filterFileTree(state.fileTree, state.searchFilter);
  const flatFiles = flattenFileTree(
    filteredTree,
    state.expandedPaths,
    state.searchFilter,
  );

  if (flatFiles.length === 0) {
    const emptyText = new TextRenderable(renderer, {
      id: `empty-${renderCounter}`,
      content: state.searchFilter ? "No matches found" : "No files",
      fg: "#5c6370",
    });
    contentScroll.add(emptyText);
    return;
  }

  // Render each file/folder
  flatFiles.forEach((file, i) => {
    const isExpanded = state.expandedPaths.has(file.path);
    const indent = "  ".repeat(file.depth);
    const expandIcon = file.isDirectory ? (isExpanded ? "▼ " : "▶ ") : "  ";
    const icon = getFileIcon(file.name, file.isDirectory);
    const symlinkIndicator = file.isSymlink ? " →" : "";
    const hiddenDim = file.name.startsWith(".") ? "#6c7380" : undefined;

    const fileBox = new BoxRenderable(renderer, {
      id: `file-box-${renderCounter}-${i}`,
      width: "100%",
      flexDirection: "row",
    });

    const fileText = new TextRenderable(renderer, {
      id: `file-${renderCounter}-${i}`,
      content: `${indent}${expandIcon}${icon} ${file.name}${symlinkIndicator}`,
      fg: hiddenDim || (file.isDirectory ? "#61afef" : "#abb2bf"),
    });

    fileBox.add(fileText);
    contentScroll.add(fileBox);

    // Add click handler for directories
    if (file.isDirectory) {
      const filePath = file.path;
      fileBox.onMouse = (event: MouseEvent) => {
        try {
          if (event.type === "down") {
            event.stopPropagation();
            onToggleFolder(filePath);
          }
        } catch {
          // Ignore mouse handler errors
        }
      };
    }
  });
}
