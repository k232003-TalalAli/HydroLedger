import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
  getRowKey: (row: T) => string;
}

export function DataTable<T>({
  columns,
  rows,
  emptyMessage = 'Nothing here yet.',
  getRowKey,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border px-4 py-8 text-center text-sm text-text-2">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-bg">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-b border-border px-3 py-2 font-sans text-[11px] uppercase tracking-label text-text-2"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="border-b border-border last:border-0">
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2 font-mono text-xs text-text">
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
