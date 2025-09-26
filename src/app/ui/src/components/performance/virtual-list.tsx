"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number; // Number of items to render outside visible area
  className?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  className = ''
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate visible range
  const visibleRange = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.min(
      visibleStart + Math.ceil(containerHeight / itemHeight),
      items.length - 1
    );

    return {
      start: Math.max(0, visibleStart - overscan),
      end: Math.min(items.length - 1, visibleEnd + overscan)
    };
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan]);

  // Get visible items
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end + 1);
  }, [items, visibleRange.start, visibleRange.end]);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Calculate total height and offset
  const totalHeight = items.length * itemHeight;
  const offsetY = visibleRange.start * itemHeight;

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, index) => (
            <div
              key={visibleRange.start + index}
              style={{ height: itemHeight }}
            >
              {renderItem(item, visibleRange.start + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Hook for virtual scrolling with dynamic heights
export const useVirtualScrolling = <T>(
  items: T[],
  estimatedItemHeight: number,
  containerHeight: number
) => {
  const [heights, setHeights] = useState<number[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure item height
  const measureHeight = useCallback((index: number, height: number) => {
    setHeights(prev => {
      const newHeights = [...prev];
      newHeights[index] = height;
      return newHeights;
    });
  }, []);

  // Calculate positions
  const itemPositions = useMemo(() => {
    let position = 0;
    return items.map((_, index) => {
      const currentPosition = position;
      position += heights[index] || estimatedItemHeight;
      return { top: currentPosition, height: heights[index] || estimatedItemHeight };
    });
  }, [items, heights, estimatedItemHeight]);

  // Find visible range
  const visibleRange = useMemo(() => {
    let start = 0;
    let end = items.length - 1;

    // Find start
    for (let i = 0; i < itemPositions.length; i++) {
      if (itemPositions[i].top + itemPositions[i].height > scrollTop) {
        start = Math.max(0, i - 2);
        break;
      }
    }

    // Find end
    for (let i = start; i < itemPositions.length; i++) {
      if (itemPositions[i].top > scrollTop + containerHeight) {
        end = Math.min(items.length - 1, i + 2);
        break;
      }
    }

    return { start, end };
  }, [itemPositions, scrollTop, containerHeight, items.length]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = itemPositions[itemPositions.length - 1]?.top +
    (itemPositions[itemPositions.length - 1]?.height || estimatedItemHeight) || 0;

  return {
    containerRef,
    visibleRange,
    itemPositions,
    totalHeight,
    handleScroll,
    measureHeight
  };
};

// Performance-optimized virtual table for large datasets
interface VirtualTableProps<T> {
  data: T[];
  columns: Array<{
    key: keyof T;
    header: string;
    width?: number;
    render?: (value: any, item: T, index: number) => React.ReactNode;
  }>;
  rowHeight?: number;
  height: number;
  className?: string;
}

export function VirtualTable<T extends Record<string, any>>({
  data,
  columns,
  rowHeight = 50,
  height,
  className = ''
}: VirtualTableProps<T>) {
  return (
    <div className={`border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="flex">
          {columns.map((column, index) => (
            <div
              key={String(column.key)}
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider flex-shrink-0"
              style={{ width: column.width || 'auto', flex: column.width ? 'none' : '1' }}
            >
              {column.header}
            </div>
          ))}
        </div>
      </div>

      {/* Virtual rows */}
      <VirtualList
        items={data}
        itemHeight={rowHeight}
        containerHeight={height}
        className="bg-white"
        renderItem={(item, index) => (
          <div className={`flex border-b border-gray-100 hover:bg-gray-50 ${
            index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
          }`}>
            {columns.map((column) => (
              <div
                key={String(column.key)}
                className="px-4 py-3 text-sm text-gray-900 flex-shrink-0 truncate"
                style={{ width: column.width || 'auto', flex: column.width ? 'none' : '1' }}
              >
                {column.render
                  ? column.render(item[column.key], item, index)
                  : String(item[column.key] || '')
                }
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}