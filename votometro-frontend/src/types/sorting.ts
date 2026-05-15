export type SortDirection = 'asc' | 'desc';

export type SortType = 'string' | 'number' | 'date' | 'boolean' | 'computed';

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export interface ColumnDefinition<T = any> {
  key: string;
  label: string;
  type: SortType;
  sortable: boolean;
  getValue?: (item: T) => any;
  compareFunction?: (a: T, b: T) => number;
}

export type ValueExtractor<T> = (item: T, key: string) => any;

export interface UseTableSortConfig<T> {
  defaultSort?: SortConfig;
  onSortChange?: () => void;
  valueExtractor?: ValueExtractor<T>;
}

export interface UseTableSortReturn<T> {
  sortedData: T[];
  sortConfig: SortConfig | null;
  requestSort: (key: string) => void;
  getSortIcon: (columnKey: string) => React.ReactNode | null;
  clearSort: () => void;
}
