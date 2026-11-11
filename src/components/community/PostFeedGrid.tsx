import { Children, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { postFeedRowSpan } from "../../lib/postFeedLayout";

// Sparse row placement (never dense or CSS columns) keeps each successive
// card at the same or a later vertical position, matching the DOM order.
// ResizeObserver repacks after photos, text, comments or widths change.
export function PostFeedGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:auto-rows-[1px] lg:items-start lg:gap-x-4 lg:gap-y-0 ${className}`} data-post-feed-grid>
      {Children.map(children, (child) => <MeasuredPost>{child}</MeasuredPost>)}
    </div>
  );
}

function MeasuredPost({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(1);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setRows(postFeedRowSpan(content.getBoundingClientRect().height));
    // Fill the grid rows before paint, not after a frame of overlapping cards.
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="min-w-0 lg:pb-4" style={{ gridRowEnd: `span ${rows}` }}>
      <div ref={contentRef} className="min-w-0" data-post-feed-measure>{children}</div>
    </div>
  );
}
