import { useEffect, useState } from "react";
import { scenarios, type ScenarioId } from "./lib/data";
import { ScreenRouter, type View } from "./components/screens";
import { Logo, Sun, Moon, Settings } from "./components/icons";

const SCENARIO_LABELS: Record<ScenarioId, string> = {
  good: "Safe",
  overpriced: "Overpriced",
  suspicious: "High risk",
};

export default function App() {
  const [dark, setDark] = useState(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("sg-theme") : null;
    if (saved) return saved === "dark";
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [scenarioId, setScenarioId] = useState<ScenarioId>("good");
  const [view, setView] = useState<View>("ready");
  const [prevView, setPrevView] = useState<View>("ready");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("sg-theme", dark ? "dark" : "light");
  }, [dark]);

  const scenario = scenarios[scenarioId];

  const pickScenario = (id: ScenarioId) => {
    setScenarioId(id);
    setView("ready");
    setPrevView("ready");
  };

  const go = (v: View) => {
    setPrevView(view);
    setView(v);
  };

  return (
    <div className="min-h-screen w-full bg-page px-4 py-8">
      <div className="mx-auto flex max-w-[880px] flex-col items-center gap-6">
        {/* brand line */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <Logo size={24} />
            <span className="text-[16px] font-semibold">DealSense</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">Shop smarter. Buy safer. Stay private.</p>
        </div>

        {/* scenario picker */}
        <div className="flex items-center gap-1.5">
          <span className="mr-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Demo
          </span>
          {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => (
            <button
              key={id}
              onClick={() => pickScenario(id)}
              className={`rounded-full border px-3.5 py-1.5 text-[11px] font-medium transition ${
                scenarioId === id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              {SCENARIO_LABELS[id]}
            </button>
          ))}
        </div>

        {/* mock browser chrome + popup */}
        <div className="relative w-full max-w-[410px]">
          {/* mock toolbar */}
          <div className="flex items-center gap-2 rounded-t-xl border border-b-0 border-border bg-card/70 px-3 py-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/50" />
              <span className="h-2.5 w-2.5 rounded-full bg-caution/50" />
              <span className="h-2.5 w-2.5 rounded-full bg-safe/50" />
            </div>
            <div className="mx-auto h-5 w-[180px] rounded-md border border-border bg-muted" />
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card">
              <Logo size={14} />
            </span>
          </div>

          {/* popup */}
          <div
            className="overflow-hidden rounded-b-2xl border border-border bg-background"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            {/* header */}
            <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <button
                onClick={() => { setView("ready"); setPrevView("ready"); }}
                className="flex items-center gap-2"
              >
                <span className="text-[17px] font-bold tracking-tight">DealSense</span>
              </button>
              <div className="flex items-center gap-2">
                {/* sliding capsule theme toggle */}
                <div className="relative flex items-center rounded-full border border-border bg-muted p-[3px] gap-0.5">
                  <div
                    className={`pointer-events-none absolute top-[3px] bottom-[3px] rounded-full bg-card shadow-sm transition-all duration-300 ${
                      dark ? "left-[calc(50%-1px)] right-[3px]" : "left-[3px] right-[calc(50%-1px)]"
                    }`}
                  />
                  <button
                    onClick={() => setDark(false)}
                    aria-label="Light mode"
                    className={`relative z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full transition-colors ${
                      !dark ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Sun width={12} height={12} />
                  </button>
                  <button
                    onClick={() => setDark(true)}
                    aria-label="Dark mode"
                    className={`relative z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full transition-colors ${
                      dark ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Moon width={12} height={12} />
                  </button>
                </div>
                <IconBtn
                  label="Settings"
                  active={view === "settings"}
                  onClick={() => go("settings")}
                >
                  <Settings width={15} height={15} />
                </IconBtn>
              </div>
            </header>

            {/* body */}
            <main className="pop-scroll max-h-[470px] min-h-[380px] overflow-y-auto">
              <ScreenRouter scenario={scenario} view={view} go={go} prevView={prevView} />
            </main>
          </div>
        </div>

        <p className="max-w-[380px] text-center text-[11px] leading-relaxed text-muted-foreground">
          Interactive mockup — realistic sample data only. No real scraping or tracking.
        </p>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
