import { useEffect, useState } from "react";
import { scenarios, type ScenarioId } from "./lib/data";
import { ScreenRouter, type View } from "./components/screens";
import { Sun, Moon, Settings } from "./components/icons";

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
    <div className="w-[410px] min-h-[480px] bg-background text-foreground flex flex-col font-sans select-none">
      {/* scenario picker bar - preserved demo logic */}
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Demo
          </span>
          {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => (
            <button
              key={id}
              onClick={() => pickScenario(id)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition ${
                scenarioId === id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              {SCENARIO_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      {/* popup header */}
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
      <main className="pop-scroll max-h-[500px] min-h-[380px] overflow-y-auto flex-1">
        <ScreenRouter scenario={scenario} view={view} go={go} prevView={prevView} />
      </main>
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
