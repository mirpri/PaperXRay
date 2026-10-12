import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** Keep long comments readable without letting one comment fill the discussion panel. */
export function CommentText({ children, style }: { children: string; style?: CSSProperties }) {
  const id = useId();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setOverflowing(element.scrollHeight > lineHeight * 6 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, expanded]);

  return <div className="pxr-comment-text">
    <p id={id} ref={textRef} className={expanded ? "pxr-comment-text-body" : "pxr-comment-text-body pxr-comment-text-collapsed"} style={style}>
      {children}
    </p>
    {overflowing && <button type="button" className="pxr-comment-text-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
      {expanded ? "Show less" : "Show more"}
    </button>}
  </div>;
}
