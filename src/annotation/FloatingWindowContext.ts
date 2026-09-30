import { createContext, useContext } from "react";

export type FloatingWindowDirection = "left" | "right" | "top" | "bottom";

// Owned palettes can grow beyond their current viewport. Their menus and
// tooltips open away from the image instead of flipping against that viewport.
export const FloatingWindowContext = createContext<FloatingWindowDirection | null>(null);
export const useFloatingWindowDirection = () => useContext(FloatingWindowContext);
