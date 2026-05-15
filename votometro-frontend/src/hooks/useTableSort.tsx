import React, { useState, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { SortConfig, SortType, ValueExtractor, UseTableSortReturn } from '../types/sorting';

export function useTableSort<T>(
  data: T[],
  defaultSort?: SortConfig,
  valueExtractor?: ValueExtractor<T>,
  onSortChange?: () => void
): UseTableSortReturn<T> {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(defaultSort || null);

  // Default value extractor - direct property access
  const getValue = useCallback(
    (item: T, key: string): any => {
      if (valueExtractor) {
        return valueExtractor(item, key);
      }
      return (item as any)[key];
    },
    [valueExtractor]
  );

  // Comparison function for different data types
  const compareValues = useCallback((a: any, b: any, type: SortType = 'string'): number => {
    // Handle null/undefined
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;

    switch (type) {
      case 'string':
        return String(a).toLowerCase().localeCompare(String(b).toLowerCase(), 'es-ES');

      case 'number':
        return Number(a) - Number(b);

      case 'date': {
        const dateA = new Date(a.replace(' ', 'T')).getTime();
        const dateB = new Date(b.replace(' ', 'T')).getTime();
        if (isNaN(dateA) && isNaN(dateB)) return 0;
        if (isNaN(dateA)) return 1;
        if (isNaN(dateB)) return -1;
        return dateA - dateB;
      }

      case 'boolean':
        return a === b ? 0 : a ? -1 : 1;

      case 'computed':
        return String(a).toLowerCase().localeCompare(String(b).toLowerCase(), 'es-ES');

      default:
        return 0;
    }
  }, []);

  // Detect sort type from value
  const detectSortType = useCallback((value: any): SortType => {
    if (value == null) return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') {
      const dateTest = new Date(value.replace(' ', 'T'));
      if (!isNaN(dateTest.getTime()) && value.includes('-')) {
        return 'date';
      }
    }
    return 'string';
  }, []);

  // Sort the data
  const sortedData = useMemo(() => {
    if (!sortConfig || !data.length) return data;

    const sorted = [...data].sort((a, b) => {
      const aValue = getValue(a, sortConfig.key);
      const bValue = getValue(b, sortConfig.key);

      const type = detectSortType(aValue);
      const comparison = compareValues(aValue, bValue, type);

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [data, sortConfig, getValue, compareValues, detectSortType]);

  // Request sort on a column
  const requestSort = useCallback(
    (key: string) => {
      let direction: 'asc' | 'desc' = 'asc';

      if (sortConfig && sortConfig.key === key) {
        direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
      }

      setSortConfig({ key, direction });

      if (onSortChange) {
        onSortChange();
      }
    },
    [sortConfig, onSortChange]
  );

  // Clear sort
  const clearSort = useCallback(() => {
    setSortConfig(null);
    if (onSortChange) {
      onSortChange();
    }
  }, [onSortChange]);

  // Get sort icon for a column
  const getSortIcon = useCallback(
    (columnKey: string): React.ReactNode | null => {
      if (!sortConfig || sortConfig.key !== columnKey) {
        return null;
      }

      return sortConfig.direction === 'asc' ? (
        <ChevronUp className='w-4 h-4 text-orange-500' />
      ) : (
        <ChevronDown className='w-4 h-4 text-orange-500' />
      );
    },
    [sortConfig]
  );

  return {
    sortedData,
    sortConfig,
    requestSort,
    getSortIcon,
    clearSort,
  };
}
