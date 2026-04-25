import type { Role } from "./types";

const roleOrder: Role[] = ["viewer", "editor", "admin"];
const readableRoots = ["/kb", "/workspace", "/memory", "/scratch", "/tools"];
const writableRoots = ["/workspace", "/memory", "/scratch"];

function isWithinRoots(path: string, roots: string[]): boolean {
  if (path === "/") return true;
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

export function canWrite(role: Role, path: string): boolean {
  if (!isWithinRoots(path, writableRoots)) return false;
  return roleOrder.indexOf(role) >= roleOrder.indexOf("editor");
}

export function canRead(role: Role, path: string): boolean {
  if (!isWithinRoots(path, readableRoots)) return false;
  return roleOrder.indexOf(role) >= roleOrder.indexOf("viewer");
}

export function assertAllowed(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

