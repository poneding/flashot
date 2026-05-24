import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { CornerRadiusPanel } from "@/overlay/CornerRadiusPanel";

function Harness({
  value,
  onChange,
  onDismiss,
}: {
  value: number;
  onChange: (n: number) => void;
  onDismiss: () => void;
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
        style={{ position: "fixed", top: 0, left: 0 }}
      />
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

  it("calls onChange with the slider's numeric value", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Harness value={0} onChange={onChange} onDismiss={() => {}} />,
    );
    const slider = getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "24" } });
    expect(onChange).toHaveBeenCalledWith(24);
  });

  it("dismisses when the user clicks outside the panel", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <Harness value={0} onChange={() => {}} onDismiss={onDismiss} />,
    );
    fireEvent.mouseDown(getByTestId("outside"));
    expect(onDismiss).toHaveBeenCalled();
  });
});
