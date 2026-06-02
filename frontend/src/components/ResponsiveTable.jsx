import { Badge } from "./Badge";
import { DashboardCard } from "./DashboardCard";

export function ResponsiveTable({ columns, rows }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-900 md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3 font-black">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row, index) => (
              <tr key={row.id || index} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-4 text-slate-700 dark:text-slate-200">
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {rows.map((row, index) => (
          <DashboardCard key={row.id || index}>
            {columns.map((column) => (
              <div key={column.key} className="flex items-center justify-between gap-4 py-2">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{column.label}</span>
                <span className="text-right text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {column.render ? column.render(row) : row[column.key]}
                </span>
              </div>
            ))}
          </DashboardCard>
        ))}
      </div>
    </>
  );
}

export function RiskBadge({ level }) {
  const tone = level === "High" ? "red" : level === "Medium" ? "gold" : "green";
  return <Badge tone={tone}>{level}</Badge>;
}
