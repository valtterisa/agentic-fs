export type FsNodeType = "file" | "directory";

export type Role = "admin" | "editor" | "viewer";

export interface SessionContext {
  userId: string;
  role: Role;
  cwd: string;
  tenantId: string;
}

export interface FsNode {
  path: string;
  type: FsNodeType;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface GrepMatch {
  path: string;
  line: number;
  value: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  userId: string;
  role: Role;
  tenantId: string;
  command: string;
  target: string;
  status: "ok" | "error";
  details?: Record<string, unknown>;
}

export interface ToolRequestBase {
  path?: string;
  pattern?: string;
  args?: string[];
}

