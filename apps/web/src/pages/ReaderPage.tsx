import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PdfHighlighter, PdfLoader, type PdfHighlighterUtils } from "react-pdf-highlighter-extended";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { Annotation, CharMap, Document, LensSpec, Node as IrNode, Visibility } from "@paper-xray/contracts";
import {
  createHumanAnnotation,
  documentFileUrl,
  fetchAnnotations,
  fetchCharMap,
  fetchDocument,
  fetchLensRuns,
  fetchLenses,
  fetchNodes,
  runLens,
  setRunVisibility,
  submitClientLensRun,
} from "../api";
import { useAuth } from "../auth/AuthContext";
import { DensityBar } from "../components/DensityBar";
import { DisplayControls } from "../components/DisplayControls";
import {
  applyDisplayFilter,
  groupKey,
  HUMAN_GROUP,
  loadDisplaySettings,
  pageDensity,
  saveDisplaySettings,
  SHOW_EVERYTHING,
  type DisplaySettings,
} from "../pdf/display-filter";
import { loadPersonalModelSettings } from "../personal/model-settings";
import { runPersonalLens } from "../personal/run-personal-lens";
import { useDocumentSocket } from "../useDocumentSocket";
import { Header } from "../components/Header";
import { AnnotationCard, annotationCardElementId } from "../components/AnnotationCard";
import { FilterChip } from "../components/FilterChip";
import { NoteComposer } from "../components/NoteComposer";
import { PdfToolbar } from "../components/PdfToolbar";
import { useItemGeometries } from "../pdf/useItemGeometries";
import { useCurrentPage } from "../pdf/useCurrentPage";
import { PxrHighlightContainer } from "../pdf/PxrHighlightContainer";
import { annotationsToHighlights, type PxrHighlight } from "../pdf/annotations-to-highlights";
import { findContainingNode, findTextRange } from "../anchoring/find-text-range";

const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MIN_ASIDE_WIDTH = 260;
const MAX_ASIDE_WIDTH = 640;

function titleFor(doc: Document): string {
  return doc.originalFilename ?? `Untitled (${doc.contentHash.slice(0, 8)})`;
}

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const docId = id!;

  // Named `doc` (not `document`) deliberately — this component also needs
  // the real global `document` (DOM) for jump-to-text scrolling, and a
  // shadowing local variable of the same name silently breaks that.
  const [doc, setDoc] = useState<Document | null>(null);
  const [nodes, setNodes] = useState<IrNode[] | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [charMap, setCharMap] = useState<CharMap | null>(null);
  const { user } = useAuth();
  const [lenses, setLenses] = useState<LensSpec[] | null>(null);
  const [ranLensIds, setRanLensIds] = useState<Set<string>>(new Set());
  const [display, setDisplay] = useState<DisplaySettings>(loadDisplaySettings);
  const [notice, setNotice] = useState<string | null>(null);
  // Sidebar-card emphasis when a PDF mark is clicked (pxr/annotations-to-highlights
  // PDF-side glow instead uses the library's own isScrolledTo — see PxrHighlightContainer).
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [runningLensId, setRunningLensId] = useState<string | null>(null);
  const [noteHint, setNoteHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.5);
  const [asideWidth, setAsideWidth] = useState(378);

  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const pdfHighlighterUtilsRef = useRef<PdfHighlighterUtils | undefined>(undefined);
  const lastWheelZoomAt = useRef(0);

  const reloadAnnotations = useCallback(() => {
    fetchAnnotations(docId).then(setAnnotations).catch((err) => setError(String(err)));
  }, [docId]);

  const reloadLensRuns = useCallback(() => {
    fetchLensRuns(docId)
      .then((runs) => setRanLensIds(new Set(runs.map((r) => r.lensId))))
      .catch((err) => setError(String(err)));
  }, [docId]);

  useEffect(() => {
    fetchDocument(docId).then(setDoc).catch((err) => setError(String(err)));
    fetchNodes(docId).then(setNodes).catch((err) => setError(String(err)));
    fetchCharMap(docId).then(setCharMap).catch((err) => setError(String(err)));
    fetchLenses().then(setLenses).catch((err) => setError(String(err)));
    reloadAnnotations();
    reloadLensRuns();
  }, [docId, reloadAnnotations, reloadLensRuns]);

  // Another user's lens run also changes which chips are "ready".
  const onRemoteChange = useCallback(() => {
    reloadAnnotations();
    reloadLensRuns();
  }, [reloadAnnotations, reloadLensRuns]);
  useDocumentSocket(docId, onRemoteChange);

  function changeDisplay(next: DisplaySettings) {
    setDisplay(next);
    saveDisplaySettings(next);
  }

  function toggleGroup(key: string) {
    const hidden = display.hiddenGroups.includes(key)
      ? display.hiddenGroups.filter((g) => g !== key)
      : [...display.hiddenGroups, key];
    setDisplay({ ...display, hiddenGroups: hidden });
  }

  const displayResult = useMemo(() => applyDisplayFilter(annotations, display), [annotations, display]);
  const visibleAnnotations = displayResult.visible;

  const fileUrl = documentFileUrl(docId);
  // The file route requires the session cookie; memoized so PdfLoader doesn't see a new object (and reload the PDF) every render.
  const pdfSource = useMemo(() => ({ url: fileUrl, withCredentials: true }), [fileUrl]);
  const geometries = useItemGeometries(fileUrl);
  const currentPage = useCurrentPage(pdfContainerRef, scale);

  const highlights: PxrHighlight[] = useMemo(() => {
    if (!charMap || !geometries) return [];
    return annotationsToHighlights(visibleAnnotations, charMap, geometries);
  }, [visibleAnnotations, charMap, geometries]);

  const density = useMemo(() => (doc ? pageDensity(highlights, doc.pageCount) : []), [highlights, doc]);

  const lensNames = useMemo(() => new Map((lenses ?? []).map((l) => [l.id, l.name])), [lenses]);

  const countsByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of annotations) {
      const key = groupKey(a);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [annotations]);

  /**
   * Zoom, driven directly through the live pdf.js viewer instance
   * (`PdfHighlighterUtils.getViewer()`) rather than by changing a prop:
   * react-pdf-highlighter-extended only re-applies its `pdfScaleValue` prop
   * on container resize / initial document load, not on every prop change,
   * and remounting the component to force it (an earlier approach) tore
   * down and rebuilt every page on each zoom step, which is what caused the
   * flicker/scroll-jump. Setting `viewer.currentScaleValue` directly is
   * pdf.js's own API for this and updates in place with no remount.
   */
  function changeScale(newScale: number) {
    setScale(newScale);
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    if (viewer) viewer.currentScaleValue = String(newScale);
  }

  /** Same reasoning as changeScale — drives the live viewer directly instead of going through a prop. */
  function goToPage(page: number) {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    if (viewer) viewer.currentPageNumber = page;
  }

  // Ctrl/Cmd + wheel to zoom, like every other PDF viewer. Throttled to at
  // most one zoom step per 250ms so a fast trackpad/wheel gesture doesn't
  // fire dozens of scale changes in a row.
  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelZoomAt.current < 250) return;
      lastWheelZoomAt.current = now;
      setScale((current) => {
        const next =
          e.deltaY < 0
            ? ZOOM_STEPS.find((s) => s > current) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
            : [...ZOOM_STEPS].reverse().find((s) => s < current) ?? ZOOM_STEPS[0];
        const viewer = pdfHighlighterUtilsRef.current?.getViewer();
        if (viewer) viewer.currentScaleValue = String(next);
        return next;
      });
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Draggable divider resizing the annotations sidebar.
  function startResizing(startEvent: React.MouseEvent) {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startWidth = asideWidth;

    function onMouseMove(e: MouseEvent) {
      const next = startWidth - (e.clientX - startX);
      setAsideWidth(Math.min(Math.max(next, MIN_ASIDE_WIDTH), MAX_ASIDE_WIDTH));
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  /** Sidebar "Jump to text" -> scroll + glow the PDF highlight (via the library's own scrollToHighlight, which also drives PxrHighlightContainer's isScrolledTo styling). */
  function jumpToHighlight(annotationId: string) {
    const highlight = highlights.find((h) => h.annotationId === annotationId);
    if (!highlight) {
      setError("That annotation has no visible highlight yet (still loading the PDF, or it has no locatable evidence span).");
      return;
    }
    pdfHighlighterUtilsRef.current?.scrollToHighlight(highlight);
  }

  /** Clicking a highlighted mark in the PDF -> scroll + emphasize its sidebar card. */
  function jumpToCard(annotationId: string) {
    // Only visible annotations have PDF marks, so the card is always in the list.
    setActiveAnnotationId(annotationId);
    window.setTimeout(() => setActiveAnnotationId((current) => (current === annotationId ? null : current)), 3300);
    // Card may not exist in the DOM yet this tick if the filter just changed.
    requestAnimationFrame(() => {
      window.document.getElementById(annotationCardElementId(annotationId))?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  /**
   * Org lenses run on the server. Personal lenses run here in the browser
   * against the user's own endpoint (docs/02-decisions.md #6); only the
   * quoted results go to the server, which re-verifies them.
   */
  async function triggerLensRun(lens: LensSpec) {
    setError(null);
    setNotice(null);
    let settings = null;
    if (lens.executionContext === "personal-client") {
      settings = loadPersonalModelSettings();
      if (!settings) {
        setError("Set up your model endpoint on the Lenses page before running a personal lens.");
        return;
      }
      if (!doc) return;
    }
    setRunningLensId(lens.id);
    try {
      const result = settings
        ? await submitClientLensRun(
            docId,
            lens.id,
            await runPersonalLens({ spec: lens, normalizedText: doc!.normalizedText, settings }),
          )
        : await runLens(docId, lens.id);
      const dropped = result.submittedCount - result.producedCount;
      setNotice(
        `${lens.name}: ${result.producedCount} annotation${result.producedCount === 1 ? "" : "s"}` +
          (dropped > 0 ? `, ${dropped} dropped by evidence verification.` : "."),
      );
      if (display.hiddenGroups.includes(lens.id)) toggleGroup(lens.id);
      reloadAnnotations();
      reloadLensRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningLensId(null);
    }
  }

  async function changeRunVisibility(runId: string, visibility: Visibility) {
    try {
      await setRunVisibility(docId, runId, visibility);
      reloadAnnotations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitNote(selectedText: string, noteText: string) {
    if (!doc || !nodes) return;
    const range = findTextRange(doc.normalizedText, selectedText);
    if (!range) {
      setError("Could not locate the selected text in the reassembled document — try selecting within a single paragraph.");
      return;
    }
    const node = findContainingNode(nodes, range.start);
    if (!node) {
      setError("That selection falls outside any recognized paragraph.");
      return;
    }
    try {
      await createHumanAnnotation(docId, {
        anchor: { charRange: range, contextPrefix: "", contextSuffix: "", nodeId: node.id },
        body: noteText,
        visibility: "org",
      });
      reloadAnnotations();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      <Header
        left={
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <Link to="/" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Library
            </Link>
            <span style={{ color: "var(--border-strong)" }}>/</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 480,
              }}
            >
              {doc ? titleFor(doc) : "Loading…"}
            </span>
          </div>
        }
      />

      {notice && !error && (
        <p style={{ color: "var(--text)", fontSize: 13, padding: "8px 18px", margin: 0, background: "var(--panel)", borderBottom: "1px solid var(--border)" }}>
          {notice}
        </p>
      )}
      {error && (
        <p style={{ color: "crimson", fontSize: 13, padding: "8px 18px", margin: 0, background: "#FFF3F3" }}>
          {error}
        </p>
      )}

      <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <PdfToolbar
            scale={scale}
            onScaleChange={changeScale}
            pageCount={doc?.pageCount ?? null}
            currentPage={currentPage}
            onGoToPage={goToPage}
          />
          <div ref={pdfContainerRef} style={{ flexGrow: 1, position: "relative", background: "var(--bg)", overflow: "auto" }}>
            {noteHint && (
              <div
                style={{
                  position: "sticky",
                  top: 10,
                  left: "50%",
                  width: "fit-content",
                  margin: "0 auto",
                  zIndex: 10,
                  background: "var(--text)",
                  color: "#FFFFFF",
                  fontSize: 12,
                  padding: "7px 14px",
                  borderRadius: 3,
                }}
              >
                Select any text below, then write your note.
              </div>
            )}
            <PdfLoader
              document={pdfSource}
              workerSrc={workerUrl}
              beforeLoad={(progress) => (
                <div style={{ padding: 24 }}>Loading PDF… {Math.floor((progress.loaded / progress.total) * 100)}%</div>
              )}
            >
              {(pdfDocument) => (
                <PdfHighlighter
                  pdfDocument={pdfDocument}
                  pdfScaleValue={scale}
                  enableAreaSelection={() => false}
                  selectionTip={<NoteComposer onSave={submitNote} />}
                  utilsRef={(utils) => {
                    pdfHighlighterUtilsRef.current = utils;
                  }}
                  highlights={highlights}
                >
                  <PxrHighlightContainer onHighlightClick={jumpToCard} />
                </PdfHighlighter>
              )}
            </PdfLoader>
          </div>
        </div>

        {density.length > 0 && <DensityBar density={density} currentPage={currentPage} onGoToPage={goToPage} />}

        {/* biome-ignore lint: mouse-driven resizer, not a semantic control */}
        <div className="pxr-resizer" onMouseDown={startResizing} />

        <aside
          style={{
            width: asideWidth,
            flexShrink: 0,
            boxSizing: "border-box",
            background: "var(--panel)",
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px 11px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Annotations</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {visibleAnnotations.length} / {annotations.length} SHOWN
              </span>
            </div>
            <button
              onClick={() => setNoteHint((v) => !v)}
              style={{
                height: 28,
                padding: "0 10px",
                fontSize: 11,
                fontWeight: 500,
                border: "1px solid var(--border-strong)",
                borderRadius: 3,
                background: noteHint ? "var(--text)" : "var(--surface)",
                color: noteHint ? "#FFFFFF" : "var(--text)",
              }}
            >
              ＋ Add note
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "11px 16px", borderBottom: "1px solid var(--border)" }}>
            {lenses?.map((lens) => {
              const ready = ranLensIds.has(lens.id);
              const personal = lens.executionContext === "personal-client";
              return (
                <FilterChip
                  key={lens.id}
                  label={lens.name}
                  personal={personal}
                  count={countsByGroup.get(lens.id) ?? 0}
                  ready={ready}
                  active={!display.hiddenGroups.includes(lens.id)}
                  loading={runningLensId === lens.id}
                  onClick={() => (ready ? toggleGroup(lens.id) : triggerLensRun(lens))}
                  onRerun={ready ? () => triggerLensRun(lens) : undefined}
                />
              );
            })}
            {/* Annotations from lenses no longer in the catalog (deleted, or a legacy id) still get a toggle. */}
            {[...countsByGroup.keys()]
              .filter((key) => key !== HUMAN_GROUP && !lensNames.has(key))
              .map((key) => (
                <FilterChip
                  key={key}
                  label={key}
                  count={countsByGroup.get(key) ?? 0}
                  ready
                  active={!display.hiddenGroups.includes(key)}
                  loading={false}
                  onClick={() => toggleGroup(key)}
                />
              ))}
            <FilterChip
              label="Human"
              count={countsByGroup.get(HUMAN_GROUP) ?? 0}
              ready
              active={!display.hiddenGroups.includes(HUMAN_GROUP)}
              loading={false}
              onClick={() => toggleGroup(HUMAN_GROUP)}
            />
          </div>

          <DisplayControls
            settings={display}
            result={displayResult}
            onChange={changeDisplay}
            onShowEverything={() => changeDisplay({ ...display, ...SHOW_EVERYTHING })}
          />

          <div style={{ flexGrow: 1, minHeight: 0, overflow: "auto", padding: "13px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
            {visibleAnnotations.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {annotations.length === 0 ? "No annotations yet — run a lens or add a note." : "Everything is hidden by the current filters."}
              </p>
            )}
            {visibleAnnotations.map((a) => (
              <AnnotationCard
                key={a.id}
                annotation={a}
                normalizedText={doc?.normalizedText ?? ""}
                active={a.id === activeAnnotationId}
                onJumpTo={jumpToHighlight}
                lensName={"agentId" in a ? lensNames.get(a.agentId) : undefined}
                currentUserId={user?.id ?? null}
                onSetRunVisibility={changeRunVisibility}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
