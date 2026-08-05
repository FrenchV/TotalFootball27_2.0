import { useCallback, useEffect, useRef, useState } from "react";
import { Simulation, SimulationScenario } from "../engine/simulation";
import { DebugFrame, GameEvent, MatchState, Player, TeamState } from "../engine/types";
import { TEAMS } from "../engine/teams";
import { computeCam, drawPitch, pitchToCanvas } from "../rendering/pitch-renderer";
import { drawPlayers } from "../rendering/player-renderer";
import { drawBall } from "../rendering/ball-renderer";
import loadingScreenImage from "/images/LoadingScreen.png";

type DisplayState = {
  score: [number, number];
  clock: number;
  half: 1 | 2;
  phase: string;
  possessionTeam: string | null;
  teamAName: string;
  teamBName: string;
  teamAColor: string;
  teamBColor: string;
  recentEvents: GameEvent[];
  matchOver: boolean;
  commentary: string;
};

declare global {
  interface Window {
    __TACTICAL_DEBUG__?: {
      tick: number;
      state: {
        clock: number;
        phase: string;
        possessionTeam: string | null;
        ball: {
          x: number;
          y: number;
          carrier: string | null;
          inFlight: boolean;
        };
        teams: Array<{
          id: string;
          name: string;
          formation: string;
          phase: string;
          phaseTimer: number;
          direction: "left" | "right";
        }>;
        carrier: null | {
          id: string;
          teamId: string;
          role: string;
          x: number;
          y: number;
          pressure: number;
        };
        recentEvents: Array<{
          type: string;
          teamId: string | null;
          playerId: string | null;
          tick: number;
          success: boolean;
          message?: string;
        }>;
        director: Record<string, string>;
      };
      debug: DebugFrame | null;
      intentCounts: Record<string, number>;
    };
  }
}

function publishTacticalDebug(sim: Simulation, debug: DebugFrame | null, tick: number) {
  const s = sim.state;
  const carrier = s.players.find(p => p.id === s.ball.carrier);
  const intentCounts = (debug?.intents ?? []).reduce<Record<string, number>>((acc, intent) => {
    acc[intent.intent] = (acc[intent.intent] ?? 0) + 1;
    return acc;
  }, {});

  window.__TACTICAL_DEBUG__ = {
    tick,
    state: {
      clock: s.clock,
      phase: s.phase,
      possessionTeam: s.possessionTeam,
      ball: {
        x: s.ball.position.x,
        y: s.ball.position.y,
        carrier: s.ball.carrier,
        inFlight: s.ball.inFlight,
      },
      teams: (s.teams ?? []).map(team => ({
        id: team.id,
        name: team.name,
        formation: team.formation,
        phase: team.phase,
        phaseTimer: team.phaseTimer,
        direction: team.attackingDirection,
      })),
      carrier: carrier ? {
        id: carrier.id,
        teamId: carrier.teamId,
        role: carrier.role,
        x: carrier.position.x,
        y: carrier.position.y,
        pressure: carrier.pressure,
      } : null,
      recentEvents: s.recentEvents.slice(0, 8).map(event => ({
        type: event.type,
        teamId: event.teamId,
        playerId: event.playerId,
        tick: event.tick,
        success: event.success,
        message: event.message,
      })),
      director: sim.getDirectorPhases(),
    },
    debug,
    intentCounts,
  };
}

function createTacticalDebugSnapshot(sim: Simulation, debug: DebugFrame | null, tick: number) {
  const s = sim.state;
  const carrier = s.players.find(p => p.id === s.ball.carrier);
  const intentCounts = (debug?.intents ?? []).reduce<Record<string, number>>((acc, intent) => {
    acc[intent.intent] = (acc[intent.intent] ?? 0) + 1;
    return acc;
  }, {});
  const assignmentCounts = (debug?.intents ?? []).reduce<Record<string, number>>((acc, intent) => {
    const key = intent.assignment ?? "unassigned";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const intentCountsByTeam = (debug?.intents ?? []).reduce<Record<string, Record<string, number>>>((acc, intent) => {
    const teamId = intent.teamId ?? "unknown";
    acc[teamId] ??= {};
    acc[teamId][intent.intent] = (acc[teamId][intent.intent] ?? 0) + 1;
    return acc;
  }, {});

  return {
    tick,
    clock: s.clock,
    matchPhase: s.phase,
    possessionTeam: s.possessionTeam,
    ball: {
      x: Number(s.ball.position.x.toFixed(2)),
      y: Number(s.ball.position.y.toFixed(2)),
      carrier: s.ball.carrier,
      inFlight: s.ball.inFlight,
      kind: s.ball.flightKind ?? null,
      height: Number((s.ball.height ?? 0).toFixed(2)),
      progress: Number(s.ball.flightProgress.toFixed(3)),
    },
    teams: (s.teams ?? []).map(team => ({
      id: team.id,
      name: team.name,
      formation: team.formation,
      phase: team.phase,
      phaseTimer: team.phaseTimer,
      direction: team.attackingDirection,
    })),
    carrier: carrier ? {
      id: carrier.id,
      teamId: carrier.teamId,
      role: carrier.role,
      x: Number(carrier.position.x.toFixed(2)),
      y: Number(carrier.position.y.toFixed(2)),
      pressure: Number(carrier.pressure.toFixed(2)),
    } : null,
    director: sim.getDirectorPhases(),
    intentCounts,
    intentCountsByTeam,
    assignmentCounts,
    shapes: debug?.shapes ?? [],
    shapeLines: debug?.shapeLines ?? [],
    intents: debug?.intents ?? [],
    metrics: debug?.metrics ?? {},
    players: s.players.map(p => ({
      id: p.id,
      teamId: p.teamId,
      role: p.role,
      number: p.number,
      x: Number(p.position.x.toFixed(2)),
      y: Number(p.position.y.toFixed(2)),
      tx: Number(p.targetPosition.x.toFixed(2)),
      ty: Number(p.targetPosition.y.toFixed(2)),
      hasBall: p.hasBall,
      pressure: Number(p.pressure.toFixed(2)),
      stamina: Number(p.stamina.toFixed(1)),
    })),
    recentEvents: s.recentEvents.slice(0, 8).map(event => ({
      type: event.type,
      teamId: event.teamId,
      playerId: event.playerId,
      tick: event.tick,
      success: event.success,
      message: event.message,
    })),
  };
}

function writeDebugSnapshot(node: HTMLPreElement | null, sim: Simulation, debug: DebugFrame | null, tick: number) {
  const json = JSON.stringify(createTacticalDebugSnapshot(sim, debug, tick));
  if (node) {
    node.textContent = json;
    node.dataset.tick = String(tick);
    node.dataset.ready = "true";
  }
  document.documentElement.dataset.tacticalDebugTick = String(tick);
  return json;
}

function formatClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseBadge(phase: string): string {
  const map: Record<string, string> = {
    BUILD_UP: "Build Up",
    CIRCULATION: "Circulation",
    PROGRESSION: "Progression",
    FINAL_THIRD: "Final Third",
    DEFENSIVE_BLOCK: "Defending",
    TRANSITION_DEF: "Transition",
    TRANSITION_ATT: "Counter",
    SET_PIECE: "Set Piece",
  };
  return map[phase] ?? phase;
}

function eventLabel(ev?: GameEvent): string | null {
  if (!ev) return null;
  if (ev.type === "GOAL") return "GOAL";
  if (ev.type === "SHOT") return ev.success ? "SHOT ON TARGET" : "SHOT";
  if (ev.type === "SAVE") return "SAVE";
  if (ev.type === "CORNER") return "CORNER";
  if (ev.type === "FREEKICK") return "FREE KICK";
  if (ev.type === "PENALTY") return "PENALTY";
  if (ev.type === "TACKLE") return "TURNOVER";
  if (ev.type === "OFFSIDE") return "OFFSIDE";
  if (ev.type === "VAR") return "VAR REVIEW";
  if (ev.type === "YELLOW_CARD") return "YELLOW CARD";
  if (ev.type === "RED_CARD") return "RED CARD";
  if (ev.type === "REBOUND") return "REBOUND";
  if (ev.type === "CATCH") return "CATCH";
  return null;
}

function drawVarOverlay(ctx: CanvasRenderingContext2D, state: MatchState, width: number, height: number) {
  const review = state.varReview;
  if (!review || !state.teams) return;
  const cam = computeCam(width, height);
  const [, ay] = pitchToCanvas(review.attackerLine, 0, cam);
  const [attackerX] = pitchToCanvas(review.attackerLine, 0, cam);
  const [defenderX] = pitchToCanvas(review.defenderLine, 0, cam);
  const attacking = state.teams.find(t => t.id === review.attackerTeamId);
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.20 + review.progress * 0.32})`;
  ctx.fillRect(0, 0, width, height);
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(96, 202, 255, 0.95)";
  ctx.beginPath(); ctx.moveTo(defenderX, ay); ctx.lineTo(defenderX, height); ctx.stroke();
  ctx.strokeStyle = "rgba(255, 99, 99, 0.96)";
  ctx.beginPath(); ctx.moveTo(attackerX, ay); ctx.lineTo(attackerX, height); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(6, 10, 20, 0.92)";
  ctx.fillRect(width / 2 - 162, 26, 324, 56);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(width / 2 - 162, 26, 324, 56);
  ctx.fillStyle = attacking?.color ?? "#fff";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("VAR CHECK - OFFSIDE", width / 2, 49);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(review.decision, width / 2, 69);
  ctx.restore();
}

function teamTone(color: string): string {
  const c = color.toLowerCase();
  if (c === "#ffffff" || c === "#dddddd") return "#f0f4fb";
  return color;
}

function teamMark(teamName: string): string {
  return teamName
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatBroadcastTag(value: string): string {
  return value.replaceAll("_", " ");
}

function LineupRail({
  side,
  team,
  players,
}: {
  side: "left" | "right";
  team?: TeamState;
  players: Player[];
}) {
  if (!team) return null;

  return (
    <div className={`absolute top-[188px] ${side === "left" ? "left-6" : "right-6"} hidden w-[230px] lg:block`}>
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase text-white/45">
        <span className="h-2.5 w-2.5 rounded-full border border-white/40" style={{ background: teamTone(team.color) }} />
        <span className="font-broadcast text-sm font-bold tracking-normal text-white/80">{team.name}</span>
        <span className="ml-auto">{team.formation}</span>
      </div>
      <div className="space-y-1.5">
        {players.map((p) => {
          const stamina = Math.max(18, Math.min(100, Math.round(p.stamina)));
          const hot = p.hasBall;
          return (
            <div key={p.id} className="grid grid-cols-[24px_34px_1fr] items-center gap-2 text-[10px] text-white/64">
              <span className="font-broadcast text-right text-xs text-white/42">{p.number}</span>
              <span className={hot ? "font-broadcast text-xs font-bold text-sky-200" : "font-broadcast text-xs text-white/72"}>
                {p.displayRole}
              </span>
              <span className="h-[3px] overflow-hidden rounded bg-white/10">
                <span
                  className="block h-full rounded"
                  style={{
                    width: `${stamina}%`,
                    background: hot ? "#8ed7ff" : stamina > 55 ? "#68d47a" : stamina > 32 ? "#d7b84a" : "#d75f5f",
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MatchSimulator() {
  const [teamA, setTeamA] = useState("esp");
  const [teamB, setTeamB] = useState("eng");
  const [isRunning, setIsRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [introVisible, setIntroVisible] = useState(true);
  const [introFading, setIntroFading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [seedText, setSeedText] = useState("25");
  const [scenario, setScenario] = useState<SimulationScenario>("default");
  const [debugFrame, setDebugFrame] = useState<DebugFrame | null>(null);
  const [debugJson, setDebugJson] = useState("");
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugPreRef = useRef<HTMLPreElement>(null);
  const simRef = useRef<Simulation | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accRef = useRef<number>(0);
  const tickN = useRef<number>(0);
  const pausedRef = useRef(false);
  const debugModeRef = useRef(false);

  const TICK_MS = 1000 / 30;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    debugModeRef.current = debugMode;
  }, [debugMode]);

  useEffect(() => {
    document.title = "TF 27 | Total Football 27";
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute(
      "content",
      "Total Football 27 (TF 27) is a football match simulator with a simple starter screen and a clean broadcast-style presentation.",
    );
  }, []);

  useEffect(() => {
    if (isRunning || !introVisible) return;

    setIntroFading(false);
    const fadeTimer = window.setTimeout(() => setIntroFading(true), 5000);
    const hideTimer = window.setTimeout(() => setIntroVisible(false), 5560);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [introVisible, isRunning]);

  const startMatch = useCallback((aId: string, bId: string) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const seed = seedText.trim() === "" ? null : Number(seedText);
    const sim = new Simulation(aId, bId, {
      seed: Number.isFinite(seed) ? seed : null,
      scenario,
    });
    simRef.current = sim;
    lastTimeRef.current = 0;
    accRef.current = 0;
    tickN.current = 0;
    setPaused(false);
    pausedRef.current = false;
    setIsRunning(true);
    const debug = sim.getDebugFrame();
    setDebugFrame(debugModeRef.current ? debug : null);
    setDebugJson(writeDebugSnapshot(debugPreRef.current, sim, debug, tickN.current));
    publishTacticalDebug(sim, debug, tickN.current);

    const cfgA = TEAMS.find(t => t.id === aId) ?? TEAMS[0];
    const cfgB = TEAMS.find(t => t.id === bId) ?? TEAMS[1];

    setDisplayState({
      score: [0, 0],
      clock: 0,
      half: 1,
      phase: "kickoff",
      possessionTeam: aId,
      teamAName: cfgA.name,
      teamBName: cfgB.name,
      teamAColor: cfgA.color,
      teamBColor: cfgB.color,
      recentEvents: [],
      matchOver: false,
      commentary: `${cfgA.name} vs ${cfgB.name}`,
    });
  }, [scenario, seedText]);

  useEffect(() => {
    if (!isRunning) return;

    const loop = (now: number) => {
      const sim = simRef.current;
      const canvas = canvasRef.current;
      if (!sim || !canvas) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      if (lastTimeRef.current === 0) lastTimeRef.current = now;
      const delta = Math.min(now - lastTimeRef.current, 100);
      lastTimeRef.current = now;
      tickN.current++;

      if (!pausedRef.current && sim.state.phase !== "fulltime") {
        accRef.current += delta;
        let ticks = 0;
        while (accRef.current >= TICK_MS && ticks < 5) {
          try {
            sim.tick();
          } catch {
            const aId = sim.state.teams?.[0]?.id ?? "esp";
            const bId = sim.state.teams?.[1]?.id ?? "eng";
            const seed = seedText.trim() === "" ? null : Number(seedText);
            simRef.current = new Simulation(aId, bId, {
              seed: Number.isFinite(seed) ? seed : null,
              scenario,
            });
            accRef.current = 0;
            break;
          }
          accRef.current -= TICK_MS;
          ticks++;
        }
      }

      const ctx = canvas.getContext("2d");
      if (ctx) {
        const { width, height } = canvas;
        const cam = computeCam(width, height);
        ctx.clearRect(0, 0, width, height);
        drawPitch(ctx, width, height, cam);
        drawVarOverlay(ctx, sim.state, width, height);
        const debug = sim.getDebugFrame();
        drawPlayers(ctx, sim.state.players, sim.state.teams, cam, width, height, tickN.current, debugModeRef.current ? debug : null);
        drawBall(ctx, sim.state.ball, cam, width, height);
        writeDebugSnapshot(debugPreRef.current, sim, debug, tickN.current);
        publishTacticalDebug(sim, debug, tickN.current);
      }

      if (tickN.current % 3 === 0) {
        const s = sim.state;
        const cfgA = TEAMS.find(t => t.id === s.teams?.[0]?.id);
        const cfgB = TEAMS.find(t => t.id === s.teams?.[1]?.id);
        const lastEvent = s.recentEvents[0];
        setDisplayState(prev => ({
          score: [...s.score] as [number, number],
          clock: s.clock,
          half: s.half,
          phase: s.phase,
          possessionTeam: s.possessionTeam,
          teamAName: s.teams?.[0]?.name ?? prev?.teamAName ?? "",
          teamBName: s.teams?.[1]?.name ?? prev?.teamBName ?? "",
          teamAColor: s.teams?.[0]?.color ?? cfgA?.color ?? "#1a3f9e",
          teamBColor: s.teams?.[1]?.color ?? cfgB?.color ?? "#e9eef8",
          recentEvents: s.recentEvents.slice(0, 5),
          matchOver: s.phase === "fulltime",
          commentary: lastEvent?.message ?? prev?.commentary ?? "",
        }));
        const debug = sim.getDebugFrame();
        setDebugFrame(debugModeRef.current ? debug : null);
        setDebugJson(writeDebugSnapshot(debugPreRef.current, sim, debug, tickN.current));
        publishTacticalDebug(sim, debug, tickN.current);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isRunning, TICK_MS, scenario, seedText]);

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const setSpeed = (s: number) => {
    if (simRef.current) simRef.current.setSpeed(s);
  };

  const simState: MatchState | undefined = simRef.current?.state;
  const ds = displayState;
  const teams = simState?.teams;
  const selectedTeamA = TEAMS.find((t) => t.id === teamA) ?? TEAMS[0];
  const selectedTeamB = TEAMS.find((t) => t.id === teamB && t.id !== teamA)
    ?? TEAMS.find((t) => t.id !== teamA)
    ?? TEAMS[1];
  const homePlayers = teams ? simState.players.filter(p => p.teamId === teams[0].id) : [];
  const awayPlayers = teams ? simState.players.filter(p => p.teamId === teams[1].id) : [];
  const lastEvent = ds?.recentEvents[0];
  const bigEvent = eventLabel(lastEvent);
  const iqMetrics = debugFrame?.metrics ?? {};
  const introImage = loadingScreenImage;
  const starterStageClass = introVisible
    ? introFading
      ? "opacity-0 scale-[1.01]"
      : "opacity-100 scale-100"
    : "opacity-100 scale-100";
  const setupStageClass = introVisible
    ? introFading
      ? "opacity-100 blur-0 translate-y-0"
      : "opacity-0 blur-sm translate-y-2 pointer-events-none"
    : "opacity-100 blur-0 translate-y-0";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0b0f16] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.07),transparent_38%),linear-gradient(180deg,#101621_0%,#0b0f16_52%,#070a0f_100%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 transition-opacity duration-500" style={{ opacity: isRunning ? 1 : 0 }} />
      <pre ref={debugPreRef} data-testid="tactical-debug-json" data-ready={debugJson ? "true" : "false"} className="hidden">{debugJson}</pre>

      {!isRunning && (
        <div className="relative z-10 h-full">
          <div className={`absolute inset-0 z-20 overflow-hidden bg-black transition-all duration-500 ease-out ${starterStageClass}`}>
            <img src={introImage} alt="TF 27 starter art" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/45 via-black/10 to-transparent" />
            <div className="absolute bottom-6 left-6 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-white/75 backdrop-blur-sm sm:bottom-8 sm:left-8">
              Loading match day
            </div>
          </div>

          <div className={`relative z-10 flex h-full items-center justify-center px-4 py-6 transition-all duration-500 ease-out sm:px-6 ${setupStageClass}`}>
            <div className="grid w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-[#111827]/92 shadow-2xl lg:grid-cols-[1.12fr_0.88fr]">
              <div className="relative min-h-[260px] bg-black lg:min-h-[640px]">
                <img src={introImage} alt="TF 27 starter art" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-tr from-black/68 via-black/18 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6 lg:p-8">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/35 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-white/70 backdrop-blur-sm">
                    Total Football 27
                  </div>
                  <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                    Tactical Simulation
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/72 sm:text-base">
                    Pick a fixture, choose a scenario, and start the match.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-5 p-5 sm:p-6 lg:p-8">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-white/42">
                <span>Starting page</span>
                <span>Simple setup</span>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">Home</div>
                    <div className="mt-1 text-lg font-medium text-white">{selectedTeamA.name}</div>
                    <div className="text-xs text-white/45">{selectedTeamA.formation}</div>
                  </div>
                  <div className="text-center text-2xl font-semibold text-amber-300">VS</div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">Away</div>
                    <div className="mt-1 text-lg font-medium text-white">{selectedTeamB.name}</div>
                    <div className="text-xs text-white/45">{selectedTeamB.formation}</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-[0.22em] text-white/40">Home side</span>
                  <select
                    data-testid="select-team-a"
                    value={teamA}
                    onChange={e => setTeamA(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20"
                  >
                    {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name} ({t.formation})</option>)}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-[0.22em] text-white/40">Away side</span>
                  <select
                    data-testid="select-team-b"
                    value={teamB}
                    onChange={e => setTeamB(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20"
                  >
                    {TEAMS.filter(t => t.id !== teamA).map(t => <option key={t.id} value={t.id}>{t.name} ({t.formation})</option>)}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-[0.22em] text-white/40">Match scenario</span>
                  <select
                    data-testid="select-scenario"
                    value={scenario}
                    onChange={e => setScenario(e.target.value as SimulationScenario)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20"
                  >
                    <option value="default">Default Match</option>
                    <option value="midfield-press">Midfield Press</option>
                    <option value="wing-overload">Wing Overload</option>
                    <option value="final-third">Final Third</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-[0.22em] text-white/40">Seed</span>
                  <input
                    data-testid="input-seed"
                    value={seedText}
                    onChange={e => setSeedText(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20"
                    inputMode="numeric"
                  />
                </label>
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/75">
                <span>Broadcast debug overlay</span>
                <input data-testid="toggle-debug" type="checkbox" checked={debugMode} onChange={e => setDebugMode(e.target.checked)} className="h-4 w-4 accent-amber-300" />
              </label>

              <button
                data-testid="btn-kickoff"
                onClick={() => startMatch(teamA, teamB === teamA ? TEAMS.find(t => t.id !== teamA)?.id ?? "eng" : teamB)}
                className="w-full rounded-2xl bg-amber-300 px-4 py-4 text-sm font-semibold uppercase tracking-[0.28em] text-slate-950 transition hover:bg-amber-200"
              >
                Start Match
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      {isRunning && ds && (
        <>
          <div className="absolute left-1/2 top-4 z-10 w-[min(100%-1rem,760px)] -translate-x-1/2 rounded-full border border-white/10 bg-black/45 px-4 py-3 backdrop-blur-md">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
              <div className="flex items-center justify-end gap-3 text-right">
                <div>
                  <div className="font-medium text-white" style={{ color: teamTone(ds.teamAColor) }}>
                    {ds.teamAName}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
                    {teams?.[0]?.phase ? phaseBadge(teams[0].phase) : ""}
                  </div>
                </div>
                <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: teamTone(ds.teamAColor) }} />
              </div>

              <div className="min-w-[120px] text-center">
                <div className="text-3xl font-semibold leading-none text-white" data-testid="score-display">
                  {ds.score[0]}:{ds.score[1]}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-white/45" data-testid="match-clock">
                  {formatClock(ds.clock)}
                </div>
              </div>

              <div className="flex items-center gap-3 text-left">
                <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: teamTone(ds.teamBColor) }} />
                <div>
                  <div className="font-medium text-white" style={{ color: teamTone(ds.teamBColor) }}>
                    {ds.teamBName}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">
                    {teams?.[1]?.phase ? phaseBadge(teams[1].phase) : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {debugMode && debugFrame && (
            <div className="absolute right-6 top-[92px] z-10 hidden w-[260px] rounded-2xl border border-sky-200/20 bg-black/45 p-3 text-[10px] text-white/62 lg:block">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-sky-100">
                <span>Debug Harness</span>
                <span>Seed {debugFrame.seed ?? "random"}</span>
              </div>
              <div className="mb-2 uppercase text-white/42">{debugFrame.scenario}</div>
              <div className="grid grid-cols-3 gap-1">
                {debugFrame.shapes.map(shape => (
                  <div key={shape.teamId} className="border border-white/8 bg-white/[0.03] p-1">
                    <div className="font-bold text-white/76">{shape.teamId}</div>
                    <div>D {shape.defensiveLineX.toFixed(1)}</div>
                    <div>M {shape.midfieldLineX.toFixed(1)}</div>
                    <div>F {shape.forwardLineX.toFixed(1)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 border border-sky-200/15 bg-sky-100/[0.035] p-2 text-[9px] leading-relaxed text-white/58">
                <div className="mb-1 font-broadcast text-[10px] font-bold uppercase text-sky-100">Decision IQ</div>
                <div className="flex justify-between gap-2"><span>Action</span><span className="truncate text-right text-white/85">{String(iqMetrics.iqAction ?? "awaiting touch")}</span></div>
                <div className="flex justify-between gap-2"><span>Target</span><span className="truncate text-right text-white/85">{String(iqMetrics.iqTargetId ?? "-")}</span></div>
                <div className="flex justify-between gap-2"><span>Value</span><span className="text-white/85">{iqMetrics.iqScore ?? "-"}</span></div>
                <div className="flex justify-between gap-2"><span>xThreat</span><span className="text-white/85">{iqMetrics.iqXThreatDelta ?? "-"}</span></div>
                <div className="mt-1 border-t border-white/8 pt-1 text-white/44">{String(iqMetrics.iqReason ?? "No decision recorded yet")}</div>
              </div>
            </div>
          )}

          {bigEvent && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[360px] max-w-[70vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-[#0f1622]/95 px-8 py-6 text-center shadow-2xl">
              <div className="text-3xl font-semibold uppercase tracking-tight text-white">
                {bigEvent}
              </div>
              <div className="mt-2 text-xs text-white/65">
                {lastEvent?.message}
              </div>
            </div>
          )}

          <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/45 px-2 py-2 backdrop-blur-md">
            {[1, 2, 4].map(s => {
              const active = (simRef.current?.state.speed ?? 1) === s;
              return (
                <button
                  key={s}
                  data-testid={`btn-speed-${s}x`}
                  onClick={() => setSpeed(s)}
                  className={active ? "rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950" : "rounded-full px-4 py-2 text-sm text-white/70 hover:bg-white/10"}
                >
                  {s}x
                </button>
              );
            })}
            <button
              data-testid="btn-pause"
              onClick={() => setPaused(p => !p)}
              className="rounded-full px-4 py-2 text-sm text-white/70 hover:bg-white/10"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              data-testid="btn-new-match"
              onClick={() => { setIsRunning(false); setPaused(false); setDebugFrame(null); setDebugJson(""); setIntroVisible(false); setIntroFading(false); }}
              className="rounded-full px-4 py-2 text-sm text-white/70 hover:bg-white/10"
            >
              Return to Select
            </button>
          </div>

          <div className="absolute bottom-6 left-6 z-10 hidden w-[260px] space-y-1.5 lg:block">
            {ds.recentEvents.slice(0, 4).map((ev, i) => {
              const team = teams?.find(t => t.id === ev.teamId);
              return (
                <div
                  key={ev.id}
                  className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/35 px-2.5 py-1.5 text-[10px] text-white/58 backdrop-blur-sm"
                  style={{ opacity: 1 - i * 0.18 }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: team ? teamTone(team.color) : "#ffffff" }} />
                  <span className="text-xs font-semibold text-white/76">{ev.type}</span>
                  <span className="truncate">{ev.message}</span>
                </div>
              );
            })}
          </div>

          {ds.matchOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
              <div className="rounded-3xl border border-white/15 bg-[#0b101d]/95 px-10 py-8 text-center shadow-2xl">
                <div className="text-3xl font-semibold uppercase tracking-[0.22em] text-white">Final Whistle</div>
                <div className="my-3 text-5xl font-semibold text-white">{ds.score[0]}:{ds.score[1]}</div>
                <button
                  data-testid="btn-new-match-fulltime"
                  onClick={() => { setIsRunning(false); setPaused(false); setIntroVisible(false); setIntroFading(false); }}
                  className="mt-2 rounded-full bg-white px-5 py-2 text-sm font-semibold uppercase text-[#080b14]"
                >
                  Return to Select
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
