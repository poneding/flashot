import type { AnnotationObject, Command } from "@/annotation/types";

export interface CommandStack {
  execute(cmd: Command, objects: AnnotationObject[]): AnnotationObject[];
  undo(objects: AnnotationObject[]): AnnotationObject[];
  redo(objects: AnnotationObject[]): AnnotationObject[];
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createCommandStack(): CommandStack {
  const history: Command[] = [];
  let index = -1;

  function applyCommand(
    cmd: Command,
    objects: AnnotationObject[],
    direction: "forward" | "backward"
  ): AnnotationObject[] {
    const { type, objectId } = cmd;
    const patch = direction === "forward" ? cmd.after : cmd.before;

    if (type === "add") {
      if (direction === "forward") {
        return [...objects, patch as AnnotationObject];
      }
      return objects.filter((o) => o.id !== objectId);
    }

    if (type === "delete") {
      if (direction === "forward") {
        return objects.filter((o) => o.id !== objectId);
      }
      const restored = [...objects];
      restored.splice(cmd.objectIndex ?? objects.length, 0, cmd.before as AnnotationObject);
      return restored;
    }

    return objects.map((o) =>
      o.id === objectId ? { ...o, ...patch } : o
    );
  }

  return {
    execute(cmd, objects) {
      if (cmd.type === "delete") {
        cmd = { ...cmd, objectIndex: objects.findIndex((object) => object.id === cmd.objectId) };
      }
      history.splice(index + 1);
      history.push(cmd);
      index++;
      return applyCommand(cmd, objects, "forward");
    },
    undo(objects) {
      if (index < 0) return objects;
      const cmd = history[index];
      index--;
      return applyCommand(cmd, objects, "backward");
    },
    redo(objects) {
      if (index >= history.length - 1) return objects;
      index++;
      const cmd = history[index];
      return applyCommand(cmd, objects, "forward");
    },
    canUndo() {
      return index >= 0;
    },
    canRedo() {
      return index < history.length - 1;
    },
    clear() {
      history.length = 0;
      index = -1;
    },
  };
}
