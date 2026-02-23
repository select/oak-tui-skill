// Shared constants across the application

import { join } from "node:path";
import { homedir } from "node:os";

// Data directory for storing application state, config, and logs
export const DATA_DIR = join(homedir(), ".local", "share", "oak-tui");

// Directories to always ignore (too large/not useful)
export const IGNORED_DIRS = new Set([
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
