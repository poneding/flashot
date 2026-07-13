/** @vitest-environment jsdom */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Tabs", () => {
  it("uses Tailwind 3 compatible shadcn active tab styles", () => {
    render(
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>
        <TabsContent value="general">General settings</TabsContent>
        <TabsContent value="appearance">Appearance settings</TabsContent>
      </Tabs>,
    );

    const activeTab = screen.getByRole("tab", { name: "General" });

    expect(activeTab.getAttribute("aria-selected")).toBe("true");
    expect(activeTab.hasAttribute("data-active")).toBe(true);
    expect(activeTab.className).toContain("data-[active]:bg-background");
    expect(activeTab.className).toContain("data-[active]:text-foreground");
    expect(activeTab.className).toContain("data-[active]:shadow-sm");
    expect(activeTab.className).toContain("dark:data-[active]:bg-background");
    expect(activeTab.className).not.toContain("dark:data-[active]:bg-input/30");
    expect(activeTab.className).not.toContain("data-active:bg-background");
  });
});
