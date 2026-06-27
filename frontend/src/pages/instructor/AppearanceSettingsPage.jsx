import { Check, LayoutDashboard, Moon, PanelLeft, Palette, Rows3, Settings2, SunMedium, TextCursorInput } from "lucide-react";
import { useLocation } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import {
  InstructorBadge,
  InstructorCard,
  InstructorPageHeader,
  InstructorSection,
} from "../../components/instructor/InstructorUI";
import {
  accessibilityOptions,
  densityOptions,
  appPalettes,
  layoutOptions,
  motionOptions,
  useAppAppearance,
} from "../../state/InstructorAppearanceContext";
import { useToast } from "../../components/ToastProvider";
import { cn } from "../../utils/cn";

function ThemePaletteCard({ id, palette, selected, onSelect }) {
  const swatches = [palette.colors.bg, palette.colors.surface, palette.colors.primary, palette.colors.accent, palette.colors.success];

  return (
    <button
      className={cn(
        "focus-ring grid rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-4 text-left transition-all",
        selected ? "border-[color:var(--color-primary)] shadow-soft" : "border-[var(--color-border)] hover:border-[color:var(--color-primary)]",
      )}
      type="button"
      onClick={() => onSelect(id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-[var(--color-text)]">{palette.name}</h3>
        </div>
        {selected && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-white">
            <Check size={15} />
          </span>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        {swatches.map((color) => (
          <span key={color} className="h-8 flex-1 rounded-md border border-black/5" style={{ background: color }} />
        ))}
      </div>
    </button>
  );
}

function OptionSelector({ title, icon: Icon, options, value, onChange }) {
  return (
    <InstructorCard>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-role-hover text-[var(--color-primary)]">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-[var(--color-text)]">{title}</h2>
          <div className="mt-4 grid gap-2">
            {Object.entries(options).map(([id, label]) => (
              <button
                key={id}
                className={cn(
                  "focus-ring flex items-start justify-between gap-3 rounded-[var(--radius-card)] border px-3 py-3 text-left transition-all",
                  value === id ? "border-[color:var(--color-primary)] bg-role-hover" : "border-[var(--color-border)] bg-[var(--color-surface)]",
                )}
                type="button"
                onClick={() => onChange(id)}
              >
                <span>
                  <span className="block text-sm font-black text-[var(--color-text)]">{label}</span>
                </span>
                {value === id && <Check className="shrink-0 text-[var(--color-primary)]" size={17} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </InstructorCard>
  );
}

function StudentAppearancePage() {
  const comfortCards = [
    {
      title: "AILA classroom",
      detail: "Soft surfaces, readable cards, and teal accents keep live participation clear without visual noise.",
      swatches: ["#F4F5F4", "#FFFFFF", "#EAF8F0", "#79D99C", "#2B7886"],
    },
    {
      title: "Readable cards",
      detail: "Learning content stays on bright cards with calm spacing, rounded corners, and clear answer targets.",
      swatches: ["#FFFFFF", "#F8FAF8", "#E8ECEA", "#79D99C", "#245866"],
    },
  ];

  return (
    <div className="page-grid student-settings">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Student settings</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">Appearance</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            Your student workspace uses the same calm AILA theme as the rest of the system.
          </p>
        </div>
        <Badge tone="role">AILA theme</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <DashboardCard>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="role">Current palette</Badge>
              <h2 className="mt-4 text-2xl font-black text-slate-950 dark:text-white">Clean classroom workspace</h2>
              <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                Student pages now share the same AILA structure: light cards, teal focus states, and compact navigation.
              </p>
            </div>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-role-soft text-role-primary">
              <Palette size={22} />
            </span>
          </div>
          <div className="mt-6 flex gap-2">
            {["#F4F5F4", "#FFFFFF", "#EAF8F0", "#79D99C", "#2B7886"].map((color) => (
              <span key={color} className="h-10 flex-1 rounded-full border border-black/5" style={{ background: color }} />
            ))}
          </div>
        </DashboardCard>

        <DashboardCard>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-950">Display comfort</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Student classroom styling stays aligned with the light AILA workspace.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-[#DCE6F4] bg-[#F3F6FB] p-4">
              <p className="text-sm font-black text-[#020613]">Focus first</p>
              <p className="mt-1 text-sm leading-6 text-[#5F688A]">Pages emphasize one classroom action at a time.</p>
            </div>
            <div className="rounded-[24px] border border-[#D7F0DF] bg-[#EAF8F0] p-4">
              <p className="text-sm font-black text-[#020613]">Question accents</p>
              <p className="mt-1 text-sm leading-6 text-[#5F688A]">Teal accents mark answers, status, and feedback moments.</p>
            </div>
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {comfortCards.map((card) => (
          <DashboardCard key={card.title}>
            <h2 className="text-lg font-black text-slate-950">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{card.detail}</p>
            <div className="mt-5 flex gap-2">
              {card.swatches.map((color) => (
                <span key={color} className="h-9 flex-1 rounded-full border border-black/5" style={{ background: color }} />
              ))}
            </div>
          </DashboardCard>
        ))}
      </div>
    </div>
  );
}

export function AppearanceSettingsPage() {
  const location = useLocation();
  const appearance = useAppAppearance();
  const { showToast } = useToast();

  if (location.pathname.startsWith("/student")) return <StudentAppearancePage />;

  function updateAppearance(patch) {
    appearance.setAppearance(patch);
    showToast({ title: "Saved", tone: "success" });
  }

  return (
    <div className="page-grid">
      <InstructorPageHeader
        title="Appearance"
        action={<InstructorBadge tone="primary">Saved locally</InstructorBadge>}
      />

      <InstructorSection title="Palette">
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(appPalettes).map(([id, palette]) => (
            <ThemePaletteCard key={id} id={id} palette={palette} selected={appearance.palette === id} onSelect={(next) => updateAppearance({ palette: next })} />
          ))}
        </div>
      </InstructorSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <OptionSelector
          title="Density"
          icon={Rows3}
          options={densityOptions}
          value={appearance.density}
          onChange={(density) => updateAppearance({ density })}
        />
        <OptionSelector
          title="Layout"
          icon={appearance.layout === "top-navigation" ? LayoutDashboard : PanelLeft}
          options={layoutOptions}
          value={appearance.layout}
          onChange={(layout) => updateAppearance({ layout })}
        />
        <OptionSelector
          title="Motion"
          icon={appearance.motion === "reduced" ? Moon : SunMedium}
          options={motionOptions}
          value={appearance.motion}
          onChange={(motion) => updateAppearance({ motion })}
        />
        <OptionSelector
          title="Accessibility"
          icon={appearance.accessibility === "readable" ? TextCursorInput : Settings2}
          options={accessibilityOptions}
          value={appearance.accessibility}
          onChange={(accessibility) => updateAppearance({ accessibility })}
        />
      </div>

      <InstructorCard>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="font-black text-[var(--color-text)]">Defaults</h2>
          <Button type="button" variant="outline" onClick={() => updateAppearance({ palette: "soft-mint-dashboard", density: "comfortable", layout: "sidebar-classic", motion: "smooth", accessibility: "standard" })}>
            Reset
          </Button>
        </div>
      </InstructorCard>
    </div>
  );
}
