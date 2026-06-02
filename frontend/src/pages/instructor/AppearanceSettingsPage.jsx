import { Check, LayoutDashboard, Moon, PanelLeft, Palette, Rows3, Settings2, Sparkle, SunMedium, TextCursorInput } from "lucide-react";
import { useLocation } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { ThemeToggle } from "../../components/ThemeToggle";
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

const densityDescriptions = {
  comfortable: "Larger spacing and calmer cards for normal teaching work.",
  compact: "Denser spacing for power users and repeated review sessions.",
  focus: "Hides secondary widgets so one primary task stays prominent.",
};

const layoutDescriptions = {
  "sidebar-classic": "A steady desktop sidebar with predictable navigation.",
  "collapsible-sidebar": "A narrower sidebar that leaves more room for content.",
  "top-navigation": "A horizontal desktop navigation bar for wide workspaces.",
};

const motionDescriptions = {
  smooth: "Subtle fade, slide, hover, drawer, and modal transitions.",
  minimal: "Shorter transitions with less movement.",
  reduced: "Most transitions are disabled for comfort.",
};

const accessibilityDescriptions = {
  standard: "Balanced contrast and default text sizing.",
  "high-contrast": "Stronger borders and contrast for scanability.",
  readable: "Slightly larger text and line-height for long sessions.",
};

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
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{palette.feeling}</p>
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

function OptionSelector({ title, description, icon: Icon, options, descriptions, value, onChange }) {
  return (
    <InstructorCard>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-role-hover text-[var(--color-primary)]">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-[var(--color-text)]">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{description}</p>
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
                  <span className="mt-1 block text-sm leading-5 text-[var(--color-muted)]">{descriptions[id]}</span>
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
      title: "Aurora classroom",
      detail: "Navy surfaces keep live sessions focused while ice blue and mauve accents highlight what needs attention.",
      swatches: ["#020613", "#173D63", "#5F688A", "#A2B7D6", "#B487A4"],
    },
    {
      title: "Readable cards",
      detail: "Learning content stays on bright cards with calm spacing, rounded corners, and clear answer targets.",
      swatches: ["#FFFFFF", "#F3F6FB", "#EAF1FA", "#A2B7D6", "#173D63"],
    },
  ];

  return (
    <div className="page-grid student-settings">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-[#A2B7D6]">Student settings</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Appearance</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#D7E2F0]">
            Your student workspace uses the dark aurora academic palette for live classes, progress, and quick answers.
          </p>
        </div>
        <Badge tone="violet">Aurora mode</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <DashboardCard className="bg-[#173D63] text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge tone="slate" className="bg-white/12 text-[#EAF1FA]">Current palette</Badge>
              <h2 className="mt-4 text-2xl font-black">Dark academic classroom</h2>
              <p className="mt-2 text-sm leading-7 text-[#D7E2F0]">
                The student UI stays separate from instructor dashboards: navy headers, ice blue highlights, and mauve accents for AI and question moments.
              </p>
            </div>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/12 text-[#A2B7D6]">
              <Palette size={22} />
            </span>
          </div>
          <div className="mt-6 flex gap-2">
            {["#020613", "#173D63", "#5F688A", "#A2B7D6", "#B487A4"].map((color) => (
              <span key={color} className="h-10 flex-1 rounded-full border border-white/12" style={{ background: color }} />
            ))}
          </div>
        </DashboardCard>

        <DashboardCard>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-950">Display comfort</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Use the global light/dark control when you need browser-level contrast changes. Student classroom styling remains aurora-focused.
              </p>
            </div>
            <ThemeToggle />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-[#DCE6F4] bg-[#F3F6FB] p-4">
              <p className="text-sm font-black text-[#020613]">Focus first</p>
              <p className="mt-1 text-sm leading-6 text-[#5F688A]">Pages emphasize one classroom action at a time.</p>
            </div>
            <div className="rounded-[24px] border border-[#E8D8E4] bg-[#FBF4F8] p-4">
              <p className="text-sm font-black text-[#020613]">Question accents</p>
              <p className="mt-1 text-sm leading-6 text-[#5F688A]">Mauve accents mark AI, answers, and feedback moments.</p>
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
    showToast({ title: "Appearance updated", description: "Your app workspace preference was saved on this device.", tone: "success" });
  }

  return (
    <div className="page-grid">
      <InstructorPageHeader
        eyebrow="Settings"
        title="Appearance"
        description="Tune the whole app into a calm, classical workspace that stays comfortable during long teaching and learning sessions."
        action={<InstructorBadge tone="primary">Saved locally</InstructorBadge>}
      />

      <InstructorSection
        title="Theme Palette"
        description="Choose a restrained palette. These tokens drive app surfaces, actions, borders, and status colors."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(appPalettes).map(([id, palette]) => (
            <ThemePaletteCard key={id} id={id} palette={palette} selected={appearance.palette === id} onSelect={(next) => updateAppearance({ palette: next })} />
          ))}
        </div>
      </InstructorSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <OptionSelector
          title="Density"
          description="Control spacing and information density."
          icon={Rows3}
          options={densityOptions}
          descriptions={densityDescriptions}
          value={appearance.density}
          onChange={(density) => updateAppearance({ density })}
        />
        <OptionSelector
          title="Layout Style"
          description="Choose how desktop navigation should feel."
          icon={appearance.layout === "top-navigation" ? LayoutDashboard : PanelLeft}
          options={layoutOptions}
          descriptions={layoutDescriptions}
          value={appearance.layout}
          onChange={(layout) => updateAppearance({ layout })}
        />
        <OptionSelector
          title="Motion Preference"
          description="Keep motion subtle and easy on the eyes."
          icon={appearance.motion === "reduced" ? Moon : SunMedium}
          options={motionOptions}
          descriptions={motionDescriptions}
          value={appearance.motion}
          onChange={(motion) => updateAppearance({ motion })}
        />
        <OptionSelector
          title="Accessibility Preference"
          description="Adjust contrast and reading comfort."
          icon={appearance.accessibility === "readable" ? TextCursorInput : Settings2}
          options={accessibilityOptions}
          descriptions={accessibilityDescriptions}
          value={appearance.accessibility}
          onChange={(accessibility) => updateAppearance({ accessibility })}
        />
      </div>

      <InstructorCard>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-role-hover text-[var(--color-primary)]">
              <Palette size={21} />
            </span>
            <div>
              <h2 className="font-black text-[var(--color-text)]">Current workspace feel</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{appearance.paletteMeta.feeling}</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => updateAppearance({ palette: "soft-mint-dashboard", density: "comfortable", layout: "sidebar-classic", motion: "smooth", accessibility: "standard" })}>
            <Sparkle size={16} />
            Restore defaults
          </Button>
        </div>
      </InstructorCard>
    </div>
  );
}
