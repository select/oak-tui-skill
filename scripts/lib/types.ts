// Core types and interfaces for Git Worktree Manager

export interface ThemeColors {
  primary: string; // Main accent color
  secondary: string; // Secondary accent
  accent: string; // Tertiary accent

  error: string;
  warning: string;
  success: string;
  info: string;

  text: string; // Primary text
  textMuted: string; // Secondary text

  background: string; // Main background
  backgroundPanel: string; // Header/footer (darker)

  border: string;
  borderFocused: string;
}

export interface Theme {
  name: string;
  displayName: string;
  colors: ThemeColors;
}

export interface Worktree {
  path: string;
  branch: string;
  commit: string;
  isPrunable: boolean;
}

export interface ProjectNode {
  path: string;
  name: string;
  worktrees: Worktree[];
  isExpanded: boolean;
  isActive: boolean;
}

export interface TmuxSession {
  paneId: string;
  projectPath: string;
}

export interface BackgroundPane {
  paneId: string;
  worktreePath: string;
  projectPath: string;
  createdAt: number; // timestamp
}

export type TabId = "projects" | "board" | "files" | "themes";

// Beads issue types
export type BeadsStatus = "open" | "in_progress" | "blocked" | "closed";
export type BeadsType = "task" | "bug" | "feature" | "epic" | "chore";

export interface BeadsIssue {
  id: string;
  title: string;
  description?: string;
  status: BeadsStatus;
  priority: number; // 0-4
  issue_type: BeadsType;
  created_at: string;
  updated_at: string;
  dependency_count: number;
  dependent_count: number;
  assignee?: string;
  labels?: string[];
}

export interface GroupedIssues {
  blocked: BeadsIssue[];
  ready: BeadsIssue[];
  in_progress: BeadsIssue[];
  closed: BeadsIssue[];
}

export interface Tab {
  id: TabId;
  label: string;
}
