import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { CornerRadiusPanel } from "@/overlay/CornerRadiusPanel";

function Harness({
  value,
  onChange,
  onDismiss,
  ignoreDismissRef,
}: {
  value: number;
  onChange: (n: number) => void;
  onDismiss: () => void;
  ignoreDismissRef?: RefObject<HTMLElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div data-testid="outside">outside</div>
      <CornerRadiusPanel
        panelRef={ref}
        value={value}
        onChange={onChange}
        onDismiss={onDismiss}
        ignoreDismissRef={ignoreDismissRef}
        style={{ position: "fixed", top: 0, left: 0 }}
      />
    </>
  );
}

function IgnoreDismissHarness({ onDismiss }: { onDismiss: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button">
        trigger
      </button>
      <Harness value={0} onChange={() => {}} onDismiss={onDismiss} ignoreDismissRef={triggerRef} />
    </>
  );
}

describe("CornerRadiusPanel", () => {
  it("renders the current value with a px suffix", () => {
    const { getByText } = render(
      <Harness value={16} onChange={() => {}} onDismiss={() => {}} />,
    );
    expect(getByText("16 px")).toBeTruthy();
  });

  it("calls onChange from a scrollable 0-60 option list", () => {
    const onChange = vi.fn();
    const { getByRole, queryByRole, getByTestId } = render(
      <Harness value={16} onChange={onChange} onDismiss={() => {}} />,
    );
    expect(queryByRole("combobox", { name: "Corner radius" })).toBeNull();
    const list = getByTestId("screenshot-corner-radius-list");
    const firstOption = getByRole("button", { name: "Corner radius: 0 px" });
    expect(list.className).toContain("flashot-dark-scrollbar");
    expect(list.style.maxHeight).toBe("200px");
    expect(firstOption).toBeTruthy();
    expect(firstOption.style.width).toBe("100%");
    expect(firstOption.style.display).toBe("flex");
    expect(firstOption.style.justifyContent).toBe("center");
    expect(getByRole("button", { name: "Corner radius: 1 px" })).toBeTruthy();
    expect(getByRole("button", { name: "Corner radius: 60 px" })).toBeTruthy();
    expect(queryByRole("button", { name: "Corner radius: 61 px" })).toBeNull();

    fireEvent.click(getByRole("button", { name: "Corner radius: 59 px" }));

    expect(onChange).toHaveBeenCalledWith(59);
  });

  it("dismisses when the user clicks outside the panel", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <Harness value={0} onChange={() => {}} onDismiss={onDismiss} />,
    );
    fireEvent.mouseDown(getByTestId("outside"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("does not dismiss when the user clicks an ignored trigger", () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(<IgnoreDismissHarness onDismiss={onDismiss} />);

    fireEvent.mouseDown(getByRole("button", { name: "trigger" }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("uses border-box sizing so fixed width includes padding and border", () => {
    const { container } = render(
      <Harness value={0} onChange={() => {}} onDismiss={() => {}} />,
    );
    const panel = container.querySelector("[data-corner-radius-panel]") as HTMLElement;

    expect(panel.style.boxSizing).toBe("border-box");
  });
});
