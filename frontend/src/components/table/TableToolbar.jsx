import { ClearFiltersButton } from "./ClearFiltersButton";
import { TableFilterChip } from "./TableFilterChip";
import { TableSearch } from "./TableSearch";

export function TableToolbar({
  search = "",
  onSearchChange,
  searchPlaceholder = "Search",
  filters = [],
  onClearFilters,
  children,
}) {
  const activeFilters = filters.filter((filter) => filter.valueLabel);
  const hasActiveFilters = Boolean(search) || activeFilters.length > 0;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange && (
          <TableSearch value={search} onChange={onSearchChange} placeholder={searchPlaceholder} />
        )}
        {children}
        {onClearFilters && <ClearFiltersButton active={hasActiveFilters} onClick={onClearFilters} />}
      </div>
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((filter) => (
            <TableFilterChip
              key={filter.key || filter.label}
              label={filter.label}
              valueLabel={filter.valueLabel}
              onClear={filter.onClear}
            />
          ))}
        </div>
      )}
    </div>
  );
}
