import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export function VirtualList<T>({
  items,
  estimateSize,
  overscan = 6,
  className,
  getKey,
  getSize,
  renderItem,
  ariaLabel = "Lista virtualizada",
}: {
  items: T[];
  estimateSize: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => string;
  getSize?: (item: T, index: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  ariaLabel?: string;
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

  const layout = useMemo(() => {
    const sizes = items.map((item,index)=>Math.max(1,getSize?.(item,index)??estimateSize));
    const offsets = new Array<number>(items.length + 1).fill(0);
    for(let index=0;index<sizes.length;index+=1) offsets[index+1]=offsets[index]+sizes[index];
    return {sizes,offsets,total:offsets[offsets.length-1]??0};
  },[items,estimateSize,getSize]);

  const range = useMemo(() => {
    let low=0;
    let high=items.length;
    while(low<high){
      const middle=Math.floor((low+high)/2);
      if(layout.offsets[middle+1] < scrollTop) low=middle+1;
      else high=middle;
    }
    const start=Math.max(0,low-overscan);
    const viewportEnd=scrollTop+viewportHeight;
    let end=start;
    while(end<items.length&&layout.offsets[end] < viewportEnd) end+=1;
    end=Math.min(items.length,end+overscan);
    return {start,end};
  },[scrollTop,viewportHeight,overscan,items.length,layout]);

  const top=layout.offsets[range.start]??0;
  const bottom=Math.max(0,layout.total-(layout.offsets[range.end]??layout.total));
  const visible=items.slice(range.start,range.end);

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      role="listbox"
      aria-label={ariaLabel}
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
