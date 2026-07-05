import { NavLink, useLocation } from "react-router-dom";

import { navigation, roleMeta } from "../navigation";
import { cn } from "../utils/cn";

export function MobileBottomNav({ role }) {
  const location = useLocation();
  const items = navigation[role].slice(0, 5);
  const palette = roleMeta[role].palette;

  return (
    <nav className="role-mobile-nav fixed inset-x-0 bottom-0 z-40 px-3 pb-3 pt-1 md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5 gap-1 rounded-full border border-white/70 bg-white/88 p-1 shadow-glass backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/88">
        {items.map((item) => {
          const Icon = item.icon;
          const forceActive = (item.to === "/instructor/analytics" && location.pathname.startsWith("/instructor/at-risk"))
            || (item.matchPrefix && location.pathname.startsWith(item.matchPrefix));
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-full text-[11px] font-black transition-all duration-300",
                  isActive || forceActive
                    ? palette.active
                    : "text-slate-500 dark:text-slate-400",
                )
              }
            >
              <Icon size={19} />
              <span className="max-w-full truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
