import type { Role } from "./types";

const roleOrder: Role[] = ["viewer", "editor", "admin"];

export function canWrite(role: Role, path: string): boolean {
  if (path.startsWith("/kb")) return false;
  return roleOrder.indexOf(role) >= roleOrder.indexOf("editor");
}

export function canRead(_role: Role, _path: string): boolean {
  return true;
}

export function assertAllowed(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

