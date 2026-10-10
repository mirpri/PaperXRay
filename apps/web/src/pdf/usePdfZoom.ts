import { useEffect, type RefObject } from "react";
import type { PdfHighlighterUtils } from "react-pdf-highlighter-extended";

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
export const clampPdfScale = (scale: number) => Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], scale));
type Viewer = Pick<NonNullable<ReturnType<PdfHighlighterUtils["getViewer"]>>, "currentScale" | "updateScale" | "container">;
type Point = { x: number; y: number };
type GestureEvent = Event & { scale: number; clientX?: number; clientY?: number };

/** Native listeners keep browser zoom out of the PDF, and batch rendering per frame. */
export function attachPdfZoom(root: HTMLElement, getViewer: () => Viewer | null | undefined, onScale: (scale: number) => void) {
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let targetScale: number | null = null;
  let origin: Point = { x: 0, y: 0 };
  let touchPinch: { distance: number; scale: number } | null = null;
  let safariPinch: { scale: number } | null = null;

  function apply() {
    frame = null;
    const viewer = getViewer();
    if (!viewer || targetScale === null || viewer.currentScale <= 0) return;
    const bounds = viewer.container.getBoundingClientRect();
    // PDF.js expects coordinates relative to its offset parent, not the window.
    viewer.updateScale({
      scaleFactor: targetScale / viewer.currentScale,
      origin: [origin.x - bounds.left + viewer.container.offsetLeft, origin.y - bounds.top + viewer.container.offsetTop],
      drawingDelay: 150,
    });
  }
  function queue(scale: number, point: Point) {
    if (!Number.isFinite(scale) || scale <= 0) return;
    targetScale = clampPdfScale(scale); origin = point;
    if (frame === null) frame = requestAnimationFrame(apply);
    clearTimeout(timer);
    // Updating Reader state on every wheel event re-renders all highlight layers.
    timer = setTimeout(() => {
      if (frame !== null) { cancelAnimationFrame(frame); apply(); }
      const viewer = getViewer();
      if (viewer && targetScale !== null) onScale(viewer.currentScale);
      targetScale = null;
    }, 180);
  }
  function currentScale() { return targetScale ?? getViewer()?.currentScale ?? 1.5; }
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (touchPinch || safariPinch || !getViewer() || event.deltaY === 0) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1);
    queue(currentScale() * Math.exp(-Math.max(-160, Math.min(160, pixels)) * 0.002), { x: event.clientX, y: event.clientY });
  }
  function touchGeometry(touches: TouchList) {
    const a = touches[0], b = touches[1];
    return { distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), point: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 } };
  }
  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 2 || !getViewer()) { touchPinch = null; return; }
    event.preventDefault();
    const { distance } = touchGeometry(event.touches);
    touchPinch = distance > 0 ? { distance, scale: currentScale() } : null;
  }
  function onTouchMove(event: TouchEvent) {
    if (!touchPinch || event.touches.length !== 2) return;
    event.preventDefault();
    const { distance, point } = touchGeometry(event.touches);
    queue(touchPinch.scale * distance / touchPinch.distance, point);
  }
  function onTouchEnd(event: TouchEvent) {
    if (event.touches.length !== 2) touchPinch = null;
    else onTouchStart(event);
  }
  function onTouchCancel() { touchPinch = null; safariPinch = null; }
  function gestureOrigin(event: GestureEvent): Point {
    const bounds = root.getBoundingClientRect();
    return { x: event.clientX ?? bounds.left + bounds.width / 2, y: event.clientY ?? bounds.top + bounds.height / 2 };
  }
  function onGestureStart(raw: Event) {
    raw.preventDefault();
    if (!touchPinch && getViewer()) safariPinch = { scale: currentScale() };
  }
  function onGestureChange(raw: Event) {
    raw.preventDefault();
    const event = raw as GestureEvent;
    if (safariPinch && !touchPinch) queue(safariPinch.scale * event.scale, gestureOrigin(event));
  }
  function onGestureEnd(event: Event) { event.preventDefault(); safariPinch = null; }
  const options = { passive: false, capture: true };
  root.addEventListener("wheel", onWheel, options);
  root.addEventListener("touchstart", onTouchStart, options);
  root.addEventListener("touchmove", onTouchMove, options);
  root.addEventListener("touchend", onTouchEnd, options);
  root.addEventListener("touchcancel", onTouchCancel, options);
  root.addEventListener("gesturestart", onGestureStart, options);
  root.addEventListener("gesturechange", onGestureChange, options);
  root.addEventListener("gestureend", onGestureEnd, options);
  return () => {
    root.removeEventListener("wheel", onWheel, options);
    root.removeEventListener("touchstart", onTouchStart, options);
    root.removeEventListener("touchmove", onTouchMove, options);
    root.removeEventListener("touchend", onTouchEnd, options);
    root.removeEventListener("touchcancel", onTouchCancel, options);
    root.removeEventListener("gesturestart", onGestureStart, options);
    root.removeEventListener("gesturechange", onGestureChange, options);
    root.removeEventListener("gestureend", onGestureEnd, options);
    if (frame !== null) cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

export function usePdfZoom(root: RefObject<HTMLElement | null>, utils: RefObject<PdfHighlighterUtils | undefined>, onScale: (scale: number) => void) {
  useEffect(() => {
    if (root.current) return attachPdfZoom(root.current, () => utils.current?.getViewer(), onScale);
  }, [root, utils, onScale]);
}
