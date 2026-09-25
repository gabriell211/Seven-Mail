import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 6,
  className,
  getKey,
  renderItem,
}: {
  items: T[];
  estimateSize: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight || 600));
    observer.observe(element);
    setViewportHeight(element.clientHeight || 600);
    return () => observer.disconnect();
  }, []);

  const range = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan);
    const count = Math.ceil(viewportHeight / estimateSize) + overscan * 2;
    const end = Math.min(items.length, start + count);
    return { start, end };
  }, [scrollTop, viewportHeight, estimateSize, overscan, items.length]);

  const top = range.start * estimateSize;
  const bottom = Math.max(0, (items.length - range.end) * estimateSize);
  const visible = items.slice(range.start, range.end);

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      role="listbox"
      aria-label="Lista virtualizada de mensagens"
      tabIndex={0}
    >
      <div aria-hidden="true" style={{ height: top }} />
      {visible.map((item, offset) => (
        <div key={getKey(item, range.start + offset)} role="presentation">
          {renderItem(item, range.start + offset)}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: bottom }} />
    </div>
  );
}
