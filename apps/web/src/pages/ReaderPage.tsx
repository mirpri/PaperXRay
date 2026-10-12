import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PdfHighlighter, PdfLoader, type PdfHighlighterUtils } from "react-pdf-highlighter-extended";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { Annotation, CharMap, Document, DocumentSummary, LensRunActivity, LensSpec, Node as IrNode, Visibility } from "@paper-xray/contracts";
import { lensColor } from "@paper-xray/contracts";
import { ArrowUp, ArrowDown } from "lucide-react";
import {
  createHumanAnnotation,
  documentFileUrl,
  fetchAnnotations,
  fetchCharMap,
  fetchDocument,
  fetchLensRunStatus,
  fetchLenses,
  fetchNodes,
  runLens,
  setRunVisibility,
  submitClientLensRun,
} from "../api";
import { useAuth } from "../auth/AuthContext";
import { DensityBar } from "../components/DensityBar";
import {
  applyDisplayFilter,
  groupKey,
  HUMAN_GROUP,
  loadDisplaySettings,
  pageDensity,
  type DisplaySettings,
} from "../pdf/display-filter";
import { fetchProviders } from "../api";
import { loadProviderKey } from "../personal/provider-keys";
import { loadPersonalModelSettings, type PersonalModelSettings } from "../personal/model-settings";
import { useLensRunActivity } from "../personal/useLensRunActivity";
import { runPersonalLens } from "../personal/run-personal-lens";
import { useDocumentSocket } from "../useDocumentSocket";
import { Header } from "../components/Header";
import { AnnotationCard, annotationCardElementId } from "../components/AnnotationCard";
import { readerLensLabels } from "../components/lens-labels";
import { commentThreads } from "../components/comment-threads";
import { FilterChip } from "../components/FilterChip";
import { NoteComposer } from "../components/NoteComposer";
import { PdfToolbar } from "../components/PdfToolbar";
import { useItemGeometries } from "../pdf/useItemGeometries";
import { usePdfZoom, clampPdfScale } from "../pdf/usePdfZoom";
import { useCurrentPage } from "../pdf/useCurrentPage";
import { PxrHighlightContainer } from "../pdf/PxrHighlightContainer";
import { annotationsToHighlights, type PxrHighlight } from "../pdf/annotations-to-highlights";
import { findContainingNode, findTextRange, estimateCharOffsetFromPosition } from "../anchoring/find-text-range";
import type { SelectionPosition } from "../components/NoteComposer";
import { useToast } from "../ToastContext";

const MIN_ASIDE_WIDTH = 260;
const MAX_ASIDE_WIDTH = 640;

function titleFor(doc: Document): string {
  return doc.title ?? `Untitled (${doc.contentHash.slice(0, 8)})`;
}

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const docId = id!;
  const [searchParams] = useSearchParams();
  const messageCommentId = searchParams.get("comment");
  const openedMessageRef = useRef<string | null>(null);
  const { showToast } = useToast();

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
  // Sidebar-card emphasis when a PDF mark is clicked (pxr/annotations-to-highlights
  // PDF-side glow instead uses the library's own isScrolledTo — see PxrHighlightContainer).
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const { trackLensRun, isLensRunning } = useLensRunActivity(docId);
  const [serverRuns, setServerRuns] = useState<{ docId: string; activity: LensRunActivity[] } | null>(null);
  const previousServerRunsRef = useRef<{ docId: string; activity: LensRunActivity[] } | null>(null);
  const lensStatusRequestRef = useRef(0);
  const lensStatusErrorRef = useRef(false);
  const [scale, setScale] = useState(1.5);
  const [asideWidth, setAsideWidth] = useState(378);
  const [asideCollapsed, setAsideCollapsed] = useState(false);

  const activeDocIdRef = useRef(docId);
  activeDocIdRef.current = docId;
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const pdfHighlighterUtilsRef = useRef<PdfHighlighterUtils | undefined>(undefined);
  usePdfZoom(pdfContainerRef, pdfHighlighterUtilsRef, setScale);

  const reloadAnnotations = useCallback(() => {
    fetchAnnotations(docId).then(result => {
      if (activeDocIdRef.current === docId) setAnnotations(result);
    }).catch((err) => {
      if (activeDocIdRef.current === docId) showToast(String(err), "error");
    });
  }, [docId, showToast]);

  // Realtime updates are immediate; polling recovers a missed completion or a refresh.
  const hasPendingAiReplies = annotations.some(item => "authorId" in item && !item.deletedAt &&
    (item.ai?.status === "queued" || item.ai?.status === "running"));
  useEffect(() => {
    if (!hasPendingAiReplies) return;
    const timer = setInterval(reloadAnnotations, 2500);
    return () => clearInterval(timer);
  }, [hasPendingAiReplies, reloadAnnotations]);

  const reloadLensRuns = useCallback(() => {
    const request = ++lensStatusRequestRef.current;
    return fetchLensRunStatus(docId)
      .then(({ lensRuns: runs, activity }) => {
        if (activeDocIdRef.current !== docId || request !== lensStatusRequestRef.current) return;
        lensStatusErrorRef.current = false;
        const previous = previousServerRunsRef.current;
        const oldActivity = previous?.docId === docId ? previous.activity : null;
        for (const run of activity) {
          const old = oldActivity?.find(item => item.lensId === run.lensId);
          if (old && old.updatedAt !== run.updatedAt && (run.status === "succeeded" || run.status === "failed")) {
            if (run.status === "failed") showToast(run.error ?? "Lens run failed", "error");
            else {
              showToast(`${run.producedCount ?? 0} annotations created.`);
              setDisplay(current => ({ ...current, hiddenGroups: current.hiddenGroups.filter(id => id !== run.lensId) }));
            }
          }
        }
        // Also catches completion while the page was closed or the socket disconnected.
        if (!oldActivity || activity.some(run => run.status === "succeeded" &&
            oldActivity.find(old => old.lensId === run.lensId)?.updatedAt !== run.updatedAt)) reloadAnnotations();
        previousServerRunsRef.current = { docId, activity };
        setServerRuns({ docId, activity });
        // A response started before a run completed must not erase that completion.
        setRanLensIds(current => new Set([...current, ...runs.map(r => r.lensId)]));
      })
      .catch((err) => {
        if (activeDocIdRef.current === docId && request === lensStatusRequestRef.current && !lensStatusErrorRef.current) {
          lensStatusErrorRef.current = true;
          showToast(String(err), "error");
        }
      });
  }, [docId, reloadAnnotations, showToast]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await reloadLensRuns();
      if (!stopped) timer = setTimeout(poll, 2500);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); lensStatusRequestRef.current++; };
  }, [reloadLensRuns]);

  useEffect(() => {
    setRanLensIds(new Set());
    fetchDocument(docId).then(setDoc).catch((err) => showToast(String(err), "error"));
    fetchNodes(docId).then(setNodes).catch((err) => showToast(String(err), "error"));
    fetchCharMap(docId).then(setCharMap).catch((err) => showToast(String(err), "error"));
    fetchLenses().then(setLenses).catch((err) => showToast(String(err), "error"));
    reloadAnnotations();
  }, [docId, reloadAnnotations, reloadLensRuns]);

  // Another user's lens run also changes which chips are "ready".
  const onRemoteChange = useCallback(() => {
    reloadAnnotations();
    reloadLensRuns();
  }, [reloadAnnotations, reloadLensRuns]);
  const onDocumentChanged = useCallback((updated: DocumentSummary) => {
    setDoc(current => current?.id === updated.id ? { ...current, title: updated.title } : current);
  }, []);
  useDocumentSocket(docId, onRemoteChange, onDocumentChanged, reloadLensRuns);

  function toggleGroup(key: string) {
    const hidden = display.hiddenGroups.includes(key)
      ? display.hiddenGroups.filter((g) => g !== key)
      : [...display.hiddenGroups, key];
    setDisplay({ ...display, hiddenGroups: hidden });
  }

  const threads = useMemo(() => commentThreads(annotations), [annotations]);
  const rootAnnotations = threads.roots;
  const displayResult = useMemo(() => applyDisplayFilter(rootAnnotations, display), [rootAnnotations, display]);
  const [sortBy, setSortBy] = useState<"position" | "confidence" | "time" | "upvote">("position");
  const [sortAsc, setSortAsc] = useState(true);
  const visibleAnnotations = useMemo(() => {
    const sorted = [...displayResult.visible];
    const direction = sortAsc ? 1 : -1;
    switch (sortBy) {
      case "position":
        return sorted.sort((a, b) => direction * (a.anchor.charRange.start - b.anchor.charRange.start));
      case "confidence":
        return sorted.sort((a, b) => {
          const aConf = "confidence" in a ? a.confidence : 0;
          const bConf = "confidence" in b ? b.confidence : 0;
          return direction * (aConf - bConf);
        });
      case "time":
        return sorted.sort((a, b) => {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return direction * (aTime - bTime);
        });
        case "upvote":
          return sorted.sort((a, b) => {
            const aVotes = a.votes?.upvotes ?? 0;
            const bVotes = b.votes?.upvotes ?? 0;
            return direction * (aVotes - bVotes);
          });
      }
    }, [displayResult.visible, sortBy, sortAsc]);

  const fileUrl = documentFileUrl(docId);
  // The file route requires the session cookie; memoized so PdfLoader doesn't see a new object (and reload the PDF) every render.
  const pdfSource = useMemo(() => ({ url: fileUrl, withCredentials: true }), [fileUrl]);
  const geometries = useItemGeometries(fileUrl);
  const currentPage = useCurrentPage(pdfContainerRef, scale);

  const lensColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const a of annotations) if ("agentId" in a) colors.set(a.agentId, lensColor(a.agentId, a.lensColor));
    for (const l of lenses ?? []) colors.set(l.id, lensColor(l.id, l.color));
    return colors;
  }, [annotations, lenses]);

  const highlights: PxrHighlight[] = useMemo(() => {
    if (!charMap || !geometries) return [];
    return annotationsToHighlights(visibleAnnotations, charMap, geometries, lensColors);
  }, [visibleAnnotations, charMap, geometries, lensColors]);

  const density = useMemo(() => (doc ? pageDensity(highlights, doc.pageCount) : []), [highlights, doc]);

  const lensNames = useMemo(() => readerLensLabels(annotations, lenses ?? [], user?.id ?? null), [annotations, lenses, user?.id]);

  const countsByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of rootAnnotations) {
      const key = groupKey(a);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [rootAnnotations]);

  useEffect(() => {
    if (!messageCommentId) return;
    const key = `${docId}:${messageCommentId}`;
    if (openedMessageRef.current === key) return;
    const comment = annotations.find(a => a.id === messageCommentId);
    if (!comment) return;
    const rootId = "authorId" in comment && comment.parentId ? comment.threadRootId : comment.id;
    const root = rootAnnotations.find(a => a.id === rootId);
    if (!root) return;
    if (!visibleAnnotations.some(a => a.id === root.id)) {
      setDisplay(current => ({ ...current, hiddenGroups: current.hiddenGroups.filter(key => key !== groupKey(root)) }));
      return;
    }
    let element: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      element = window.document.getElementById(`pxr-comment-${messageCommentId}`);
      if (!element) return;
      openedMessageRef.current = key;
      setActiveAnnotationId(root.id);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("pxr-comment-message-target");
      timer = setTimeout(() => { element?.classList.remove("pxr-comment-message-target"); setActiveAnnotationId(null); }, 3300);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); element?.classList.remove("pxr-comment-message-target"); };
  }, [docId, messageCommentId, annotations, rootAnnotations, visibleAnnotations]);

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
  function changeScale(requestedScale: number) {
    const newScale = clampPdfScale(requestedScale);
    setScale(newScale);
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    if (viewer) viewer.currentScaleValue = String(newScale);
  }

  /** Same reasoning as changeScale — drives the live viewer directly instead of going through a prop. */
  function goToPage(page: number) {
    const viewer = pdfHighlighterUtilsRef.current?.getViewer();
    if (viewer) viewer.currentPageNumber = page;
  }

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
      showToast("That annotation has no visible highlight yet (still loading the PDF, or it has no locatable evidence span).", "error");
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
    await trackLensRun(lens.id, async () => {
      try {
        if (lens.executionContext === "org-server") {
          const { status } = await runLens(docId, lens.id);
          if (activeDocIdRef.current !== docId) return;
          // Preserve busy state immediately, even if the first status query fails.
          const optimistic: LensRunActivity = { lensId: lens.id, status, stage: status === "queued" ? "queued" : "model",
            producedCount: null, submittedCount: null, error: null, updatedAt: new Date().toISOString() };
          const previous = previousServerRunsRef.current;
          const activity = [...(previous?.docId === docId ? previous.activity : []).filter(run => run.lensId !== lens.id), optimistic];
          previousServerRunsRef.current = { docId, activity };
          setServerRuns({ docId, activity });
          await reloadLensRuns();
          return;
        }
        let settings: PersonalModelSettings | null = null;
        if (lens.executionContext === "personal-client") {
          if (lens.providerId) {
            const provider = (await fetchProviders()).find((p) => p.id === lens.providerId && p.ownerId === user?.id);
            if (!provider || !lens.model?.trim()) throw new Error("The selected provider or model is unavailable. Update this lens in Lenses settings.");
            settings = { baseUrl: provider.baseUrl, model: lens.model, apiKey: loadProviderKey(user!.id, provider.id) };
          } else settings = loadPersonalModelSettings();
          if (!settings) throw new Error("Choose a provider and model on the Lenses page before running this lens.");
          if (!doc) return;
        }
        if (!settings || !doc) return;
        const result = await submitClientLensRun(
              docId,
              lens.id,
              await runPersonalLens({ spec: lens, normalizedText: doc!.normalizedText, settings }),
            );
        if (activeDocIdRef.current !== docId) return;
        const dropped = result.submittedCount - result.producedCount;
        showToast(
          `${lens.name}: ${result.producedCount} annotation${result.producedCount === 1 ? "" : "s"}` +
            (dropped > 0 ? `, ${dropped} dropped by evidence verification.` : "."),
        );
        // Show completion immediately, rather than briefly returning to “run” while refetching.
        setRanLensIds(current => new Set([...current, lens.id]));
        setDisplay(current => ({ ...current, hiddenGroups: current.hiddenGroups.filter(id => id !== lens.id) }));
        reloadAnnotations();
        reloadLensRuns();
      } catch (err) {
        if (activeDocIdRef.current === docId) showToast(err instanceof Error ? err.message : String(err), "error");
      }
    });
  }

  async function changeRunVisibility(runId: string, visibility: Visibility) {
    try {
      await setRunVisibility(docId, runId, visibility);
      reloadAnnotations();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function submitNote(selectedText: string, noteText: string, position?: SelectionPosition) {
    if (!doc || !nodes || !charMap) return;
    if (!position || !geometries) {
      showToast("PDF text positions are still loading — please try again shortly.", "error");
      return;
    }

    const charOffset = estimateCharOffsetFromPosition(
      charMap,
      position.page,
      position.x,
      position.y,
      (page, itemIndex) => geometries.get(page)?.get(itemIndex),
    );
    const pageRuns = charMap.filter((run) => run.page === position.page);
    if (charOffset === null || pageRuns.length === 0) {
      showToast("Could not locate the selected text on this PDF page.", "error");
      return;
    }
    const positionHint = { page: position.page, charOffset, pageRange: {
      start: Math.min(...pageRuns.map((run) => run.charStart)),
      end: Math.max(...pageRuns.map((run) => run.charEnd)),
    } };

    const range = findTextRange(doc.normalizedText, selectedText, positionHint);
    if (!range) {
      showToast("Could not locate the selected text in the reassembled document — try selecting within a single paragraph.", "error");
      return;
    }
    const node = findContainingNode(nodes, range.start);
    if (!node) {
      showToast("That selection falls outside any recognized paragraph.", "error");
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
      showToast(String(err), "error");
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

      <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <PdfToolbar
            scale={scale}
            onScaleChange={changeScale}
            pageCount={doc?.pageCount ?? null}
            currentPage={currentPage}
            onGoToPage={goToPage}
            asideCollapsed={asideCollapsed}
            onToggleAside={() => setAsideCollapsed(!asideCollapsed)}
          />
          <div ref={pdfContainerRef} className="pxr-pdf-region" style={{ flexGrow: 1, minHeight: 0, position: "relative", background: "var(--bg)", overflow: "hidden" }}>
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
        {!asideCollapsed && <div className="pxr-resizer" onMouseDown={startResizing} />}

        {!asideCollapsed && (
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
                {visibleAnnotations.length} / {rootAnnotations.length}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as "position" | "confidence" | "time" | "upvote")}
                style={{
                  height: 24,
                  padding: "0 6px",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 3,
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <option value="position">Position</option>
                <option value="confidence">Confidence</option>
                <option value="time">Time</option>
                <option value="upvote">Upvotes</option>
              </select>
              <button
                onClick={() => setSortAsc(!sortAsc)}
                title={sortAsc ? "Ascending" : "Descending"}
                style={{
                  width: 24,
                  height: 24,
                  padding: 0,
                  border: "1px solid var(--border-strong)",
                  borderRadius: 3,
                  background: "var(--surface)",
                  color: "var(--text)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {sortAsc ? <ArrowUp size={15} strokeWidth={1.75} /> : <ArrowDown size={15} strokeWidth={1.75} />}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "11px 16px", borderBottom: "1px solid var(--border)" }}>
            {lenses?.map((lens) => {
              const ready = ranLensIds.has(lens.id);
              const personal = lens.ownerId !== null;
              const activity = serverRuns?.docId === docId ? serverRuns.activity.find(run => run.lensId === lens.id) : undefined;
              const serverBusy = activity?.status === "queued" || activity?.status === "running";
              return (
                <FilterChip
                  key={lens.id}
                  label={lens.name}
                  color={lensColors.get(lens.id)}
                  personal={personal}
                  count={countsByGroup.get(lens.id) ?? 0}
                  ready={ready}
                  active={!display.hiddenGroups.includes(lens.id)}
                  loading={isLensRunning(lens.id) || serverBusy || (lens.executionContext === "org-server" && serverRuns?.docId !== docId)}
                  loadingLabel={activity?.stage === "queued" ? "queued" : activity?.stage === "verifying" ? "verifying" : activity?.stage === "model" ? "calling model" : undefined}
                  error={activity?.status === "failed" ? activity.error ?? "Lens run failed" : undefined}
                  onClick={() => (ready ? toggleGroup(lens.id) : triggerLensRun(lens))}
                  onRerun={ready && (lens.ownerId !== null || user?.role === "admin" || user?.role === "curator") ? () => triggerLensRun(lens) : undefined}
                />
              );
            })}
            {/* Shared personal runs and deleted lenses still get a named toggle outside the catalog. */}
            {[...countsByGroup.keys()]
              .filter((key) => key !== HUMAN_GROUP && !(lenses ?? []).some(lens => lens.id === key))
              .map((key) => (
                <FilterChip
                  key={key}
                  label={lensNames.get(key) ?? "Lens"}
                  color={lensColors.get(key) ?? lensColor(key)}
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

          <div style={{ flexGrow: 1, minHeight: 0, overflow: "auto", padding: "13px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
            {visibleAnnotations.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {rootAnnotations.length === 0 ? "No annotations yet — run a lens or add a note." : "Everything is hidden by the current filters."}
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
                color={"agentId" in a ? lensColors.get(a.agentId) : undefined}
                currentUserId={user?.id ?? null}
                currentUserRole={user?.role}
                repliesByParent={threads.byParent}
                onCommentsChanged={reloadAnnotations}
                onSetRunVisibility={changeRunVisibility}
              />
            ))}
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}
