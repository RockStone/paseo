import type { TrackerBoard, TrackerItem } from "../../shared/board";

export const TASK_FILE: "docs/drive.md";
export const OWNER_FILE: "docs/owner-todo.md";
export function parse(text: string, owner?: boolean): TrackerItem[];
export function documentPath(projectDir: string, relative: string): Promise<string | null>;
export function snapshot(path: string): Promise<{ bytes: Buffer; version: string; mode: number }>;
export function writeReply(
  path: string,
  expectedVersion: string,
  id: string,
  text: string,
): Promise<string>;
export function mutateReply(
  path: string,
  expectedVersion: string,
  id: string,
  mutation:
    | { action: "edit"; replyId: string; text: string }
    | { action: "remove"; replyId: string }
    | { action: "status"; done: boolean },
): Promise<string>;
export class TrackerStore {
  constructor(options?: { timestamps?: boolean });
  cache: Map<string, TrackerBoard>;
  read(root: string): Promise<TrackerBoard>;
  prune(roots: Set<string>): void;
}
