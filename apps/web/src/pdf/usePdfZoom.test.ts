import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachPdfZoom, clampPdfScale } from "./usePdfZoom";

let frames: Map<number, FrameRequestCallback>; let nextFrame: number;
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
function flushFrame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }
function setup() {
  const root = Object.assign(new EventTarget(), { clientHeight: 600, getBoundingClientRect: () => ({ left: 100, top: 200, width: 600, height: 600 }) }) as unknown as HTMLElement;
  const viewer = {
    currentScale: 1.5,
    container: { offsetLeft: 30, offsetTop: 40, getBoundingClientRect: () => ({ left: 100, top: 200 }) } as HTMLDivElement,
    updateScale: vi.fn((options: { scaleFactor?: number }) => { viewer.currentScale = Math.round(viewer.currentScale * options.scaleFactor! * 100) / 100; }),
  };
  const onScale = vi.fn(); dispose = attachPdfZoom(root, () => viewer, onScale);
  function event(type: string, values: object) { const ev = Object.assign(new Event(type, { cancelable: true }), values); root.dispatchEvent(ev); return ev; }
  const wheel = (values: object = {}) => event("wheel", { ctrlKey: true, metaKey: false, deltaMode: 0, deltaY: -10, clientX: 250, clientY: 300, ...values });
  const touches = (distance: number) => [{ clientX: 200, clientY: 300 }, { clientX: 200 + distance, clientY: 300 }];
  return { root, viewer, onScale, event, wheel, touches };
}
describe("PDF gesture zoom", () => {
  it("leaves ordinary scrolling untouched", () => {
    const { wheel, viewer } = setup(); expect(wheel({ ctrlKey: false }).defaultPrevented).toBe(false);
    flushFrame(); expect(viewer.updateScale).not.toHaveBeenCalled();
  });
  it("accumulates high-frequency deltas but applies only once per animation frame", () => {
    const { wheel, viewer, onScale } = setup();
    for (let i = 0; i < 20; i++) expect(wheel({ deltaY: -1 }).defaultPrevented).toBe(true);
    expect(frames.size).toBe(1); expect(viewer.updateScale).not.toHaveBeenCalled();
    flushFrame(); expect(viewer.updateScale).toHaveBeenCalledTimes(1);
    expect(viewer.currentScale).toBeCloseTo(1.56, 2); expect(onScale).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180); expect(onScale).toHaveBeenCalledWith(1.56);
  });
  it("anchors at the cursor using viewer-local coordinates and delays expensive drawing", () => {
    const { wheel, viewer } = setup(); wheel(); flushFrame();
    expect(viewer.updateScale).toHaveBeenCalledWith(expect.objectContaining({ origin: [180, 140], drawingDelay: 150 }));
  });
  it("normalizes mouse line/page units and supports Cmd wheel", () => {
    const { wheel, viewer } = setup(); wheel({ ctrlKey: false, metaKey: true, deltaMode: 1, deltaY: -1 }); flushFrame();
    expect(viewer.currentScale).toBeCloseTo(1.55, 2);
    wheel({ deltaMode: 2, deltaY: 1 }); flushFrame(); expect(viewer.currentScale).toBeLessThan(1.55);
  });
  it("clamps repeated input to the same bounds used by the toolbar", () => {
    const { wheel, viewer } = setup(); for (let i = 0; i < 100; i++) wheel({ deltaY: -100 }); flushFrame(); expect(viewer.currentScale).toBe(4);
    for (let i = 0; i < 100; i++) wheel({ deltaY: 100 }); flushFrame(); expect(viewer.currentScale).toBe(0.5);
    expect(clampPdfScale(0.1)).toBe(0.5); expect(clampPdfScale(8)).toBe(4);
  });
  it("keeps single-finger scrolling native and zooms proportionally for two fingers", () => {
    const { event, touches, viewer } = setup();
    expect(event("touchstart", { touches: touches(100).slice(0, 1) }).defaultPrevented).toBe(false);
    expect(event("touchstart", { touches: touches(100) }).defaultPrevented).toBe(true);
    expect(event("touchmove", { touches: touches(150) }).defaultPrevented).toBe(true);
    flushFrame(); expect(viewer.currentScale).toBe(2.25);
    event("touchend", { touches: touches(150).slice(0, 1) });
    expect(event("touchmove", { touches: touches(200) }).defaultPrevented).toBe(false);
  });
  it("does not apply wheel/Safari duplicates while a touch pinch is active", () => {
    const { event, touches, wheel, viewer } = setup();
    event("touchstart", { touches: touches(100) }); event("gesturestart", { scale: 1 });
    event("touchmove", { touches: touches(120) }); wheel({ deltaY: -100 }); event("gesturechange", { scale: 2 });
    flushFrame(); expect(viewer.currentScale).toBe(1.8);
  });
  it("supports Safari trackpad gestures and cancels touch state cleanly", () => {
    const { event, touches, viewer } = setup();
    event("touchstart", { touches: touches(100) }); event("touchcancel", { touches: [] });
    event("gesturestart", { scale: 1 }); expect(event("gesturechange", { scale: 1.2, clientX: 250, clientY: 300 }).defaultPrevented).toBe(true);
    flushFrame(); expect(viewer.currentScale).toBe(1.8); event("gestureend", {});
  });
  it("removes listeners and pending work when leaving the reader", () => {
    const { wheel, viewer, onScale } = setup(); wheel(); dispose!(); flushFrame(); vi.advanceTimersByTime(1000);
    expect(viewer.updateScale).not.toHaveBeenCalled(); expect(onScale).not.toHaveBeenCalled();
    expect(wheel().defaultPrevented).toBe(false);
  });
});
