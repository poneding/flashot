import { describe, it, expect } from "vitest";
import { createCommandStack } from "@/annotation/commands";
import type { AnnotationObject, Command } from "@/annotation/types";

const makeObject = (id: string): AnnotationObject => ({
  id,
  type: "rect",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 100 },
  style: { color: "#ff0000", strokeWidth: 4 },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
});

describe("createCommandStack", () => {
  it("executes an add command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    const cmd: Command = { type: "add", objectId: "1", before: {}, after: obj };
    const objects = stack.execute(cmd, []);
    expect(objects).toHaveLength(1);
    expect(objects[0].id).toBe("1");
  });

  it("undoes an add command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    const objects = stack.undo([obj]);
    expect(objects).toHaveLength(0);
  });

  it("redoes after undo", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    stack.undo([obj]);
    const objects = stack.redo([]);
    expect(objects).toHaveLength(1);
    expect(objects[0].id).toBe("1");
  });

  it("executes a move command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    const cmd: Command = {
      type: "move",
      objectId: "1",
      before: { transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } },
      after: { transform: { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 } },
    };
    const objects = stack.execute(cmd, [obj]);
    expect(objects[0].transform.x).toBe(50);
    expect(objects[0].transform.y).toBe(50);
  });

  it("executes a delete command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    const cmd: Command = { type: "delete", objectId: "1", before: obj, after: {} };
    const objects = stack.execute(cmd, [obj]);
    expect(objects).toHaveLength(0);
  });

  it("clears redo stack on new command after undo", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    stack.undo([obj]);
    expect(stack.canRedo()).toBe(true);
    const obj2 = makeObject("2");
    stack.execute({ type: "add", objectId: "2", before: {}, after: obj2 }, []);
    expect(stack.canRedo()).toBe(false);
  });

  it("canUndo/canRedo report correctly", () => {
    const stack = createCommandStack();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });
});
