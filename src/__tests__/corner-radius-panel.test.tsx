import { afterEach, describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { CornerRadiusPanel } from "@/overlay/CornerRadiusPanel";

const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

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
  afterEach(() => {
    restoreScrollIntoView();
  });

  it("renders the current value without a px suffix", () => {
    const { getByText } = render(
      <Harness value={16} onChange={() => {}} onDismiss={() => {}} />,
    );
    expect(getByText("16")).toBeTruthy();
  });

  it("calls onChange from a scrollable 0-60 option list", () => {
    const onChange = vi.fn();
    const { getByRole, queryByRole, getByTestId } = render(
      <Harness value={16} onChange={onChange} onDismiss={() => {}} />,
    );
    expect(queryByRole("combobox", { name: "Corner radius" })).toBeNull();
    const list = getByTestId("screenshot-corner-radius-list");
    const firstOption = getByRole("button", { name: "Corner radius: 0" });
    expect(list.className).toContain("flashot-dark-scrollbar");
    expect(list.style.maxHeight).toBe("200px");
    expect(list.style.width).toBe("max-content");
    expect(list.style.minWidth).toBe("62px");
    expect(firstOption).toBeTruthy();
    expect(firstOption.style.width).toBe("100%");
    expect(firstOption.style.display).toBe("flex");
    expect(firstOption.style.justifyContent).toBe("center");
    expect(getByRole("button", { name: "Corner radius: 1" })).toBeTruthy();
    expect(getByRole("button", { name: "Corner radius: 60" })).toBeTruthy();
    expect(queryByRole("button", { name: "Corner radius: 61" })).toBeNull();

    fireEvent.click(getByRole("button", { name: "Corner radius: 59" }));

    expect(onChange).toHaveBeenCalledWith(59);
  });

  it("scrolls the current value into view when opened", () => {
    const scrolledLabels = captureScrollIntoViewLabels();

    render(
      <Harness value={48} onChange={() => {}} onDismiss={() => {}} />,
    );

    expect(scrolledLabels).toContain("Corner radius: 48");
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

  it("keeps the panel width fitted to its numeric content", () => {
    const { container } = render(
      <CornerRadiusPanelWithWidth value={0} />,
    );
    const panel = container.querySelector("[data-corner-radius-panel]") as HTMLElement;

    expect(panel.style.boxSizing).toBe("border-box");
    expect(panel.style.width).toBe("max-content");
  });
});

function CornerRadiusPanelWithWidth({ value }: { value: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <CornerRadiusPanel
      panelRef={ref}
      value={value}
      onChange={() => {}}
      onDismiss={() => {}}
      style={{ position: "fixed", top: 0, left: 0, width: 72 }}
    />
  );
}

function captureScrollIntoViewLabels(): string[] {
  const labels: string[] = [];
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement) {
      labels.push(this.getAttribute("aria-label") ?? this.textContent ?? "");
    },
  });
  return labels;
}

function restoreScrollIntoView() {
  if (originalScrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoViewDescriptor);
    return;
  }

  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
}
