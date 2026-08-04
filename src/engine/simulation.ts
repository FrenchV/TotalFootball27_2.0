import {
  MatchState, Player, TeamState, Ball, Position, GameEvent, TeamPhase, MatchPhase, DebugFrame, DebugShapeLine
} from "./types";
import { TEAMS } from "./teams";
import { FORMATIONS } from "./formations";
import {
  PITCH_WIDTH, PITCH_HEIGHT,
  GOAL_WIDTH, PENALTY_BOX_WIDTH, PENALTY_BOX_HEIGHT,
  GOAL_AREA_HEIGHT, CENTER_CIRCLE_RADIUS, PENALTY_SPOT_DIST,
  LEFT_GOAL_CENTER, RIGHT_GOAL_CENTER
} from "./pitch";

// ─── Math helpers ─────────────────────────────────────────────────────────────

function dist(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function rand(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }
function randN(): number {
  // Box-Muller gaussian
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-10)) * Math.cos(2 * Math.PI * Math.random());
}
function makeId(): string { return Math.random().toString(36).slice(2, 9); }
function angDiff(a: Position, b: Position): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// ─── Pitch helpers ────────────────────────────────────────────────────────────

function goalCenter(dir: "right" | "left"): Position {
  return dir === "right" ? { ...RIGHT_GOAL_CENTER } : { ...LEFT_GOAL_CENTER };
}
function ownGoalCenter(dir: "right" | "left"): Position {
  return dir === "right" ? { ...LEFT_GOAL_CENTER } : { ...RIGHT_GOAL_CENTER };
}
function inOwnHalf(pos: Position, dir: "right" | "left"): boolean {
  return dir === "right" ? pos.x < PITCH_WIDTH / 2 : pos.x > PITCH_WIDTH / 2;
}
function inFinalThird(pos: Position, dir: "right" | "left"): boolean {
  return dir === "right" ? pos.x > PITCH_WIDTH * 0.67 : pos.x < PITCH_WIDTH * 0.33;
}
function inMiddleThird(pos: Position): boolean {
  return pos.x >= PITCH_WIDTH * 0.33 && pos.x <= PITCH_WIDTH * 0.67;
}
function inOpponentBox(pos: Position, dir: "right" | "left"): boolean {
  const yOk = Math.abs(pos.y - PITCH_HEIGHT / 2) < PENALTY_BOX_HEIGHT / 2;
  if (!yOk) return false;
  return dir === "right" ? pos.x > PITCH_WIDTH - PENALTY_BOX_WIDTH : pos.x < PENALTY_BOX_WIDTH;
}
function inOwnBox(pos: Position, dir: "right" | "left"): boolean {
  const yOk = Math.abs(pos.y - PITCH_HEIGHT / 2) < PENALTY_BOX_HEIGHT / 2;
  if (!yOk) return false;
  return dir === "right" ? pos.x < PENALTY_BOX_WIDTH : pos.x > PITCH_WIDTH - PENALTY_BOX_WIDTH;
}
function inOwnGoalArea(pos: Position, dir: "right" | "left"): boolean {
  const yOk = Math.abs(pos.y - PITCH_HEIGHT / 2) < GOAL_AREA_HEIGHT / 2;
  if (!yOk) return false;
  return dir === "right" ? pos.x < 5.5 : pos.x > PITCH_WIDTH - 5.5;
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

function normalizeRole(r: string): string {
  const map: Record<string, string> = {
    LCB: "CB", RCB: "CB", LWB: "LB", RWB: "RB", LM: "CM", RM: "CM"
  };
  return map[r] || r;
}
function displayRole(r: string): string {
  const map: Record<string, string> = {
    LCB: "CB", RCB: "CB", LWB: "WB", RWB: "WB", LM: "CM", RM: "CM",
    GK: "GK", CB: "CB", LB: "LB", RB: "RB", DM: "DM", CM: "CM",
    AM: "AM", LW: "LW", RW: "RW", CF: "CF", SS: "SS"
  };
  return map[r] ?? r.slice(0, 2).toUpperCase();
}
function roleSpeed(r: string): number {
  const speeds: Record<string, number> = {
    GK: 0.14, CB: 0.18, LB: 0.22, RB: 0.22,
    DM: 0.20, CM: 0.22, AM: 0.23, LW: 0.26, RW: 0.26, CF: 0.24, SS: 0.23
  };
  return speeds[normalizeRole(r)] ?? 0.21;
}
// How many ticks the carrier holds the ball before deciding
// At 30 fps: 30 ticks = 1 real second. GK at 30t holds ~1s before decision.
function holdTicks(role: string, pressure: number, style: string): number {
  const base: Record<string, number> = {
    GK: 32, CB: 26, LB: 20, RB: 20, DM: 20, CM: 14, AM: 11, LW: 10, RW: 10, CF: 9, SS: 10
  };
  let h = base[normalizeRole(role)] ?? 14;
  if (style === "POSSESSION") h = Math.round(h * 1.35);
  if (style === "DIRECT")     h = Math.round(h * 0.70);
  if (style === "COUNTER")    h = Math.round(h * 0.80);
  h -= Math.round(pressure * 10);
  return clamp(h, 3, 50);
}

// Player profile: 0=disciplined/safe, 1=creative/risky
function roleRisk(role: string): number {
  const r: Record<string, number> = {
    GK: 0.05, CB: 0.08, LB: 0.20, RB: 0.20, DM: 0.15,
    CM: 0.30, AM: 0.70, LW: 0.75, RW: 0.75, CF: 0.55, SS: 0.65
  };
  return r[normalizeRole(role)] ?? 0.30;
}
// Accuracy of a pass: 1.0 = perfect, lower = error
function passAccuracy(distU: number, pressure: number, role: string, style: string): number {
  let acc = 1.0;
  if (distU < 10) acc -= 0.01;
  else if (distU < 18) acc -= 0.04;
  else if (distU < 28) acc -= 0.10;
  else if (distU < 38) acc -= 0.18;
  else acc -= 0.27;
  acc -= pressure * 0.28;
  const roleBonus: Record<string, number> = {
    GK: 0.04, CB: 0.05, LB: 0.02, RB: 0.02, DM: 0.04,
    CM: 0.01, AM: -0.01, LW: -0.02, RW: -0.02, CF: -0.03, SS: -0.02
  };
  acc += roleBonus[normalizeRole(role)] ?? 0;
  if (style === "POSSESSION") acc += 0.05;
  return clamp(acc, 0.42, 1.0);
}
// Probability of a clean first touch (not losing the ball)
function firstTouchSuccess(pressure: number, role: string): boolean {
  let p = 0.92;
  p -= pressure * 0.30;
  const roleBonus: Record<string, number> = {
    CB: 0.04, DM: 0.03, CM: 0.02, GK: 0.05, LB: 0.02, RB: 0.02,
    AM: -0.01, CF: -0.02, LW: -0.03, RW: -0.03
  };
  p += roleBonus[normalizeRole(role)] ?? 0;
  return Math.random() < clamp(p, 0.45, 0.97);
}

// ─── Simulation ───────────────────────────────────────────────────────────────

type VelState = { vx: number; vy: number; wp: number };
type PlayerIntent =
  | "carrier"
  | "near_support"
  | "far_support"
  | "runner"
  | "hold_width"
  | "cover_lane"
  | "mark"
  | "recover"
  | "rest_defense"
  | "press"
  | "cover"
  | "screen"
  | "line_hold";
type IntentTarget = { intent: PlayerIntent; target: Position };
type DefensiveAssignment = {
  intent: PlayerIntent;
  target: Position;
  assignment: string;
  markId: string | null;
};
type FormationBehavior = {
  restDefenseCount: number;
  supportCount: number;
  runnerCount: number;
  pressCount: number;
  lineStep: number;
  fullbackPush: number;
  wingbackPush: number;
  midfieldJoin: number;
  forwardPin: number;
  widthSource: "wingers" | "fullbacks" | "wingbacks" | "mixed";
};
type TeamShape = {
  fwd: 1 | -1;
  ballProgress: number;
  ballSideShift: number;
  compactness: number;
  width: number;
  behavior: FormationBehavior;
  defensiveLineX: number;
  midfieldLineX: number;
  forwardLineX: number;
};
type BallActionClass = "short" | "driven" | "through" | "switch" | "cross" | "clearance" | "shot";
type BallFlightProfile = {
  kind: BallActionClass;
  trajectory: "ground" | "driven" | "lofted";
  speed: number;
  minTicks: number;
  maxTicks: number;
  errorScale: number;
  interceptionRadius: number;
  interceptionChance: number;
  firstTouchModifier: number;
  receiverLead: number;
  looseChance: number;
  apex: number;
  hang: number;
};
type PossessionStoryPhase =
  | "buildup"
  | "recycle"
  | "switch"
  | "central_progression"
  | "wide_attack"
  | "counter"
  | "box_entry"
  | "shot"
  | "clearance"
  | "restart";
type PossessionPlan = {
  phase: PossessionStoryPhase;
  startedTick: number;
  duration: number;
  side: "left" | "right" | "central";
};
type FinalThirdPatternName =
  | "wide_triangle"
  | "overlap"
  | "underlap"
  | "half_space_slip"
  | "cutback"
  | "far_post_cross"
  | "edge_shot";
type FinalThirdPatternState = {
  name: FinalThirdPatternName;
  startedTick: number;
  duration: number;
  side: "left" | "right";
};
type TacticalActionKind =
  | "short_pass"
  | "progressive_pass"
  | "through_ball"
  | "switch"
  | "cross"
  | "cutback"
  | "shot"
  | "carry"
  | "dribble"
  | "recycle"
  | "pause";
type PlayerIQProfile = {
  vision: number;
  composure: number;
  passing: number;
  positioning: number;
  finishing: number;
  flair: number;
  risk: number;
};
type TacticalDecision = {
  carrierId?: string;
  kind: TacticalActionKind;
  score: number;
  reason: string;
  target?: Player;
  xThreatDelta: number;
  shotQuality: number;
  passValue: number;
  carryValue: number;
  pressureRisk: number;
  roleBias: number;
  patternBias: number;
};
type PossessionMemoryAction = {
  tick: number;
  type: "pass" | "shot" | "carry" | "dribble" | "turnover" | "clearance";
  kind?: BallActionClass;
  fromRole?: string;
  toRole?: string;
  from?: Position;
  to?: Position;
  progressDelta: number;
  direction: "forward" | "back" | "lateral";
  success: boolean;
};
type PossessionMemorySummary = {
  recentLobs: number;
  recentBackPasses: number;
  recentForwardPasses: number;
  recentShots: number;
  recentCarries: number;
  netProgress: number;
  stale: boolean;
  lobSpam: boolean;
  recyclingLoop: boolean;
};
type FirstTouch = {
  recipientId: string;
  countdownTicks: number;
  success: boolean;
  looseBallPos: Position;
  receivePoint: Position;
};
type GKSave = {
  diveTarget: Position;
  divePhase: "diving" | "holding" | "recovering";
  diveProgress: number;
};
type PendingKick =
  | { kind: "pass"; fromId: string; toId: string; type: "PASS" | "CLEARANCE"; forward: boolean; bypassControl: boolean; ticks: number }
  | { kind: "shot"; fromId: string; teamId: string; ticks: number };
type ActiveDuel = { attackerId: string; defenderId: string; startedTick: number; duration: number };
type VarReview = { attackerLine: number; defenderLine: number; attackerTeamId: string; restartTeamId: string; location: Position; ticks: number };
type RestartKind = "kickoff" | "corner" | "freekick" | "penalty" | "goalkick";
type RestartState = {
  kind: RestartKind;
  teamId: string;
  location: Position;
  side?: "top" | "bottom";
  takerId?: string;
  startedTick: number;
};
type StarProfile = {
  style: "explosive" | "finesse" | "flair" | "power" | "creator";
  dribble: number;
  finishing: number;
  creativity: number;
  weakFoot: number;
};
export type SimulationScenario = "default" | "midfield-press" | "wing-overload" | "final-third";
export type SimulationOptions = {
  seed?: number | null;
  scenario?: SimulationScenario;
};

export class Simulation {
  state: MatchState;

  private tickN = 0;
  private holdTimer = 0;
  private holdTarget = 8;
  private flightTotalTicks = 0;
  private flightRecipientId: string | null = null;
  private flightProfile: BallFlightProfile | null = null;
  private isShot = false;
  private shotOnTarget = false;
  private shotAttackerTeamId: string | null = null;
  private pauseTimer = 0;
  private cornerSide: "top" | "bottom" = "top";
  private cornerAttDir: "right" | "left" = "right";
  private restart: RestartState | null = null;

  // Organic movement state
  private playerVel = new Map<string, VelState>();
  // Forward-progression urgency
  private safePassStreak = new Map<string, number>();
  // Possession story director
  private possessionPlans = new Map<string, PossessionPlan>();
  private finalThirdPatterns = new Map<string, FinalThirdPatternState>();
  private possessionMemory = new Map<string, PossessionMemoryAction[]>();
  private lastTacticalDecision: TacticalDecision | null = null;
  private duelCooldown = new Map<string, number>();
  private shapeBreakHistory = new Map<string, number>();
  private looseBallChasers = new Set<string>();
  // First-touch system
  private firstTouch: FirstTouch | null = null;
  // GK save animation state
  private gkSaves = new Map<string, GKSave>();
  private pendingKick: PendingKick | null = null;
  private activeDuel: ActiveDuel | null = null;
  private varReview: VarReview | null = null;
  // Carry / dribble state machine
  private carryTimer = 0;          // ticks remaining while carrier dribbles/carries
  private carryTarget: Position | null = null;
  private carryMode: "forward" | "sideways" | "pause" | "cut_in" | "take_on" | "burst" = "pause";
  private seed: number | null = null;
  private rngState = 1;
  private scenario: SimulationScenario = "default";
  private debugFrame: DebugFrame = { seed: null, scenario: "default", intents: [], shapes: [] };

  constructor(teamAId: string, teamBId: string, options: SimulationOptions = {}) {
    this.seed = options.seed ?? null;
    this.scenario = options.scenario ?? "default";
    this.rngState = this.seed == null ? Math.floor(Math.random() * 0x7fffffff) || 1 : this.seedToState(this.seed);

    const cfgA = TEAMS.find(t => t.id === teamAId) ?? TEAMS[0];
    const cfgB = TEAMS.find(t => t.id === teamBId) ?? TEAMS[1];

    const teamA: TeamState = {
      ...cfgA,
      phase: "BUILD_UP",
      attackingDirection: "right",
      dominance: 0.5,
      phaseTimer: 0,
      momentum: 0
    };
    const teamB: TeamState = {
      ...cfgB,
      phase: "DEFENSIVE_BLOCK",
      attackingDirection: "left",
      dominance: 0.5,
      phaseTimer: 0,
      momentum: 0
    };

    const playersA = this.buildPlayers(teamA, true);
    const playersB = this.buildPlayers(teamB, false);

    const striker = playersA.find(p => p.role === "CF") ?? playersA[playersA.length - 1];
    striker.hasBall = true;

    this.state = {
      clock: 0, half: 1, score: [0, 0],
      phase: "kickoff",
      players: [...playersA, ...playersB],
      ball: {
        position: { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2 },
        velocity: { x: 0, y: 0 },
        carrier: striker.id,
        trail: [],
        inFlight: false,
        targetPosition: null,
        flightProgress: 0,
        flightStart: null,
        flightKind: null,
        height: 0,
        spin: 0,
        shadowStrength: 0.46
      },
      teams: [teamA, teamB],
      possessionTeam: teamA.id,
      lastEvent: null,
      recentEvents: [],
      speed: 1,
      tick: 0,
      varReview: null
    };
    this.holdTimer = 0;
    this.holdTarget = 20;
    this.pauseTimer = 20;
    this.prepareKickoff(teamA.id);
    this.applyScenario(this.scenario);
    this.debugFrame = { seed: this.seed, scenario: this.scenario, intents: [], shapes: [] };
  }

  private buildPlayers(team: TeamState, isA: boolean): Player[] {
    const formation = FORMATIONS[team.formation] ?? FORMATIONS["4-3-3"];
    return formation.map((fp, i) => {
      const rawX = fp.x * PITCH_WIDTH;
      const rawY = fp.y * PITCH_HEIGHT;
      const x = isA ? rawX : PITCH_WIDTH - rawX;
      const y = isA ? rawY : PITCH_HEIGHT - rawY;
      const base: Position = { x, y };
      const normRole = normalizeRole(fp.role);
      return {
        id: `${team.id}-${i}`,
        teamId: team.id,
        role: normRole as any,
        displayRole: displayRole(fp.role),
        number: i + 1,
        position: { ...base },
        targetPosition: { ...base },
        basePosition: { ...base },
        speed: roleSpeed(fp.role),
        hasBall: false,
        isDribbling: false,
        stamina: 100,
        pressure: 0,
        lastActionTick: 0,
        strength: clamp(0.43 + (normalizeRole(fp.role) === "CB" || normalizeRole(fp.role) === "CF" ? 0.24 : 0.12) + this.rand(-0.1, 0.1), 0.25, 0.95),
        balance: clamp(0.5 + (normalizeRole(fp.role) === "DM" || normalizeRole(fp.role) === "CM" ? 0.18 : 0.08) + this.rand(-0.1, 0.1), 0.25, 0.95),
        aggression: clamp(0.32 + (normalizeRole(fp.role) === "CB" || normalizeRole(fp.role) === "DM" ? 0.28 : 0.12) + this.rand(-0.1, 0.1), 0.15, 0.95),
        tackling: clamp(0.35 + (normalizeRole(fp.role) === "CB" ? 0.34 : normalizeRole(fp.role) === "DM" ? 0.28 : 0.1) + this.rand(-0.08, 0.08), 0.15, 0.95),
        finishing: clamp(0.28 + (["CF", "SS"].includes(normalizeRole(fp.role)) ? 0.52 : ["AM", "LW", "RW"].includes(normalizeRole(fp.role)) ? 0.34 : 0.08) + this.rand(-0.08, 0.08), 0.08, 0.98),
        discipline: clamp(0.78 - (normalizeRole(fp.role) === "CB" || normalizeRole(fp.role) === "DM" ? 0.16 : 0) + this.rand(-0.1, 0.1), 0.25, 0.98),
        cards: 0,
        duel: null,
        kickWindup: null,
        keeperRead: null
      };
    });
  }

  // ─── Accessors ───────────────────────────────────────────────────────────

  private carrier(): Player | undefined {
    return this.state.players.find(p => p.id === this.state.ball.carrier);
  }
  private teamOf(p: Player): TeamState | undefined {
    return this.state.teams?.find(t => t.id === p.teamId);
  }
  private opposing(teamId: string): TeamState | undefined {
    return this.state.teams?.find(t => t.id !== teamId);
  }
  private teamPlayers(teamId: string): Player[] {
    return this.state.players.filter(p => p.teamId === teamId);
  }
  private gk(teamId: string): Player | undefined {
    return this.state.players.find(p => p.teamId === teamId && p.role === "GK");
  }
  private groundBall(): void {
    this.state.ball.height = 0;
    this.state.ball.flightKind = null;
    this.state.ball.shadowStrength = 0.46;
  }

  // ─── Main tick ───────────────────────────────────────────────────────────

  private seedToState(seed: number): number {
    const s = Math.floor(Math.abs(seed)) % 2147483647;
    return s === 0 ? 1 : s;
  }

  private random(): number {
    this.rngState = (this.rngState * 48271) % 2147483647;
    return this.rngState / 2147483647;
  }

  private chance(p: number): boolean {
    return this.random() < p;
  }

  private rand(lo: number, hi: number): number {
    return lo + this.random() * (hi - lo);
  }

  private randN(): number {
    return Math.sqrt(-2 * Math.log(this.random() + 1e-10)) * Math.cos(2 * Math.PI * this.random());
  }

  private makeId(): string {
    return Math.floor(this.random() * 0x7fffffff).toString(36);
  }

  private firstTouchSuccess(pressure: number, role: string, modifier = 0): boolean {
    let p = 0.92;
    p -= pressure * 0.30;
    const roleBonus: Record<string, number> = {
      CB: 0.04, DM: 0.03, CM: 0.02, GK: 0.05, LB: 0.02, RB: 0.02,
      AM: -0.01, CF: -0.02, LW: -0.03, RW: -0.03
    };
    p += roleBonus[normalizeRole(role)] ?? 0;
    p += modifier;
    return this.chance(clamp(p, 0.45, 0.97));
  }

  private applyScenario(scenario: SimulationScenario): void {
    if (scenario === "default") return;
    const s = this.state;
    const teamA = s.teams?.[0];
    const teamB = s.teams?.[1];
    if (!teamA || !teamB) return;

    const place = (team: TeamState, role: string, index: number, pos: Position, hasBall = false) => {
      const players = this.teamPlayers(team.id).filter(p => p.role === role);
      const p = players[index] ?? players[0];
      if (!p) return;
      p.position = { ...pos };
      p.targetPosition = { ...pos };
      p.hasBall = hasBall;
      if (hasBall) {
        s.ball.carrier = p.id;
        s.ball.position = { ...pos };
        s.possessionTeam = team.id;
      }
    };

    s.phase = "playing";
    this.pauseTimer = 0;
    s.ball.inFlight = false;
    s.ball.trail = [];
    s.players.forEach(p => { p.hasBall = false; });
    this.flightProfile = null;
    this.flightRecipientId = null;
    this.isShot = false;

    if (scenario === "midfield-press") {
      teamA.phase = "PROGRESSION";
      teamB.phase = "DEFENSIVE_BLOCK";
      place(teamA, "CM", 0, { x: PITCH_WIDTH * 0.48, y: PITCH_HEIGHT * 0.42 }, true);
      place(teamA, "LW", 0, { x: PITCH_WIDTH * 0.61, y: PITCH_HEIGHT * 0.18 });
      place(teamA, "RW", 0, { x: PITCH_WIDTH * 0.61, y: PITCH_HEIGHT * 0.82 });
      place(teamA, "CF", 0, { x: PITCH_WIDTH * 0.68, y: PITCH_HEIGHT * 0.5 });
      place(teamB, "CF", 0, { x: PITCH_WIDTH * 0.54, y: PITCH_HEIGHT * 0.43 });
      place(teamB, "AM", 0, { x: PITCH_WIDTH * 0.58, y: PITCH_HEIGHT * 0.56 });
    } else if (scenario === "wing-overload") {
      teamA.phase = "FINAL_THIRD";
      teamB.phase = "DEFENSIVE_BLOCK";
      place(teamA, "LW", 0, { x: PITCH_WIDTH * 0.74, y: PITCH_HEIGHT * 0.18 }, true);
      place(teamA, "LB", 0, { x: PITCH_WIDTH * 0.67, y: PITCH_HEIGHT * 0.12 });
      place(teamA, "AM", 0, { x: PITCH_WIDTH * 0.73, y: PITCH_HEIGHT * 0.43 });
      place(teamA, "CF", 0, { x: PITCH_WIDTH * 0.82, y: PITCH_HEIGHT * 0.5 });
      place(teamA, "RW", 0, { x: PITCH_WIDTH * 0.78, y: PITCH_HEIGHT * 0.72 });
    } else if (scenario === "final-third") {
      teamA.phase = "FINAL_THIRD";
      teamB.phase = "DEFENSIVE_BLOCK";
      place(teamA, "AM", 0, { x: PITCH_WIDTH * 0.72, y: PITCH_HEIGHT * 0.52 }, true);
      place(teamA, "CF", 0, { x: PITCH_WIDTH * 0.84, y: PITCH_HEIGHT * 0.48 });
      place(teamA, "LW", 0, { x: PITCH_WIDTH * 0.77, y: PITCH_HEIGHT * 0.20 });
      place(teamA, "RW", 0, { x: PITCH_WIDTH * 0.77, y: PITCH_HEIGHT * 0.80 });
      place(teamA, "CM", 0, { x: PITCH_WIDTH * 0.64, y: PITCH_HEIGHT * 0.38 });
    }

    this.holdTimer = 0;
    this.holdTarget = 8;
  }

  getDebugFrame(): DebugFrame {
    return {
      seed: this.debugFrame.seed,
      scenario: this.debugFrame.scenario,
      intents: this.debugFrame.intents.map(i => ({ ...i, target: { ...i.target } })),
      shapes: this.debugFrame.shapes.map(sh => ({ ...sh })),
      shapeLines: (this.debugFrame.shapeLines ?? []).map(line => ({
        ...line,
        playerIds: [...line.playerIds],
        points: line.points.map(p => ({ ...p }))
      })),
      metrics: { ...(this.debugFrame.metrics ?? {}) }
    };
  }

  getDirectorPhases(): Record<string, PossessionStoryPhase> {
    const phases: Record<string, PossessionStoryPhase> = {};
    for (const team of this.state.teams ?? []) {
      phases[team.id] = this.possessionStory(team).phase;
    }
    return phases;
  }

  tick(): void {
    const s = this.state;
    if (s.phase === "fulltime") return;
    this.tickN++;
    s.tick = this.tickN;

    if (s.phase === "kickoff") { this.tickKickoff(); return; }
    if (s.phase === "goalcelebration") { this.tickCelebration(); return; }
    if (s.phase === "corner") { this.tickCorner(); return; }
    if (s.phase === "freekick") { this.tickFreeKick(); return; }
    if (s.phase === "penalty") { this.tickPenalty(); return; }
    if (s.phase === "var") { this.tickVarReview(); return; }
    if (s.phase === "goalkick") { this.tickGoalKick(); return; }
    if (s.phase === "halftime") { this.tickHalftime(); return; }

    s.clock += (2 / 30) * s.speed;
    if (s.half === 1 && s.clock >= 2700) { this.triggerHalftime(); return; }
    if (s.half === 2 && s.clock >= 5400) { s.phase = "fulltime"; return; }

    this.updatePressures();
    this.updateBall();
    this.updateTeamPhases();
    this.updateTacticalPlayerTargets();
    this.movePlayers();
    this.separatePlayers();
    this.updateTrail();
  }

  // ─── Paused states ────────────────────────────────────────────────────────

  private tickKickoff(): void {
    this.applyRestartTargets();
    this.movePlayers();
    this.pauseTimer--;
    if (this.pauseTimer <= 0) {
      this.state.phase = "playing";
      const c = this.carrier();
      if (c) {
        c.position = { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2 };
        this.state.ball.position = { ...c.position };
        this.holdTimer = 0;
        this.holdTarget = holdTicks(c.role, 0, this.teamOf(c)?.playStyle ?? "BALANCED");
      }
      this.restart = null;
      this.addEvent("KICKOFF", null, this.state.possessionTeam, { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2 }, true);
    }
  }
  private tickCelebration(): void {
    this.pauseTimer--;
    if (this.pauseTimer <= 0) this.resetKickoff();
  }
  private tickHalftime(): void {
    this.pauseTimer--;
    if (this.pauseTimer <= 0) this.startSecondHalf();
  }
  private tickCorner(): void {
    this.applyRestartTargets();
    this.movePlayers();
    this.pauseTimer--;
    if (this.pauseTimer <= 0) this.executeCorner();
  }
  private tickFreeKick(): void {
    this.applyRestartTargets();
    this.movePlayers();
    this.pauseTimer--;
    if (this.pauseTimer <= 0) this.executeFreeKick();
  }
  private tickPenalty(): void {
    this.applyRestartTargets();
    this.movePlayers();
    this.pauseTimer--;
    if (this.pauseTimer <= 0) this.executePenalty();
  }
  private tickGoalKick(): void {
    this.movePlayers();
    this.pauseTimer--;
    if (this.pauseTimer <= 0) {
      const s = this.state;
      const defTeam = s.teams?.find(t => t.id !== s.possessionTeam);
      if (defTeam) {
        const gkP = this.gk(defTeam.id);
        if (gkP) {
          const goalX = defTeam.attackingDirection === "right" ? 5.5 : PITCH_WIDTH - 5.5;
          gkP.position = { x: goalX, y: PITCH_HEIGHT / 2 };
          this.giveBall(gkP.id);
          s.phase = "playing";
          this.holdTarget = 14;
        }
      }
    }
  }
  private tickVarReview(): void {
    const review = this.varReview;
    if (!review) { this.state.phase = "playing"; return; }
    review.ticks--;
    this.state.varReview = {
      attackerLine: review.attackerLine,
      defenderLine: review.defenderLine,
      attackerTeamId: review.attackerTeamId,
      decision: "OFFSIDE",
      progress: clamp(1 - review.ticks / 42, 0, 1)
    };
    if (review.ticks > 0) return;
    this.state.varReview = null;
    this.varReview = null;
    this.beginRestart("freekick", review.restartTeamId, review.location);
  }

  private triggerHalftime(): void {
    const s = this.state;
    s.phase = "halftime";
    this.pauseTimer = 90;
    s.ball.carrier = null;
    s.ball.inFlight = false;
    this.firstTouch = null;
    s.players.forEach(p => { p.hasBall = false; });
  }
  private startSecondHalf(): void {
    const s = this.state;
    s.half = 2;
    s.phase = "kickoff";
    if (s.teams) {
      s.teams[0].attackingDirection = s.teams[0].attackingDirection === "right" ? "left" : "right";
      s.teams[1].attackingDirection = s.teams[1].attackingDirection === "right" ? "left" : "right";
    }
    for (const p of s.players) p.basePosition = { x: PITCH_WIDTH - p.basePosition.x, y: PITCH_HEIGHT - p.basePosition.y };
    const teamB = s.teams?.[1];
    if (teamB) this.prepareKickoff(teamB.id);
    this.pauseTimer = 25;
  }
  private resetKickoff(): void {
    const s = this.state;
    s.phase = "kickoff";
    const scoringTeamId = this.shotAttackerTeamId ?? s.teams?.[0]?.id;
    const kickoffTeamId = s.teams?.find(t => t.id !== scoringTeamId)?.id ?? s.teams?.[1]?.id;
    if (kickoffTeamId) this.prepareKickoff(kickoffTeamId);
    this.holdTimer = 0;
    this.pauseTimer = 20;
    this.isShot = false;
    this.firstTouch = null;
    this.flightRecipientId = null;
    this.flightProfile = null;
    this.gkSaves.clear();
  }
  private executeCorner(): void {
    const restart = this.restart;
    const team = restart ? this.state.teams?.find(t => t.id === restart.teamId) : undefined;
    const taker = restart?.takerId ? this.state.players.find(p => p.id === restart.takerId) : undefined;
    if (!restart || !team || !taker) { this.state.phase = "playing"; return; }
    this.giveBall(taker.id);
    this.state.phase = "playing";
    this.restart = null;
    const target = this.findSetPieceBoxTarget(team, taker) ?? this.findBoxTarget(taker, team);
    if (target) this.executePass(taker, target, "PASS", true, true);
  }

  // Restarts own the player targets until the whistle. Normal shape AI resumes only
  // after the ball has been struck, so players cannot wander out of a legal setup.
  private prepareKickoff(teamId: string): void {
    const s = this.state;
    const team = s.teams?.find(t => t.id === teamId);
    if (!team) return;
    const players = this.teamPlayers(team.id);
    const taker = players.find(p => p.role === "CF") ?? players.find(p => p.role === "AM") ?? players[players.length - 1];
    if (!taker) return;
    s.players.forEach(p => { p.hasBall = false; p.isDribbling = false; });
    taker.hasBall = true;
    s.ball.carrier = taker.id;
    s.ball.position = { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2 };
    s.ball.inFlight = false;
    s.ball.targetPosition = null;
    s.ball.trail = [];
    s.possessionTeam = team.id;
    this.restart = {
      kind: "kickoff",
      teamId: team.id,
      location: { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2 },
      takerId: taker.id,
      startedTick: this.tickN
    };
    this.applyRestartTargets(true);
  }

  private beginRestart(kind: RestartKind, teamId: string, location: Position, side?: "top" | "bottom"): void {
    const s = this.state;
    const team = s.teams?.find(t => t.id === teamId);
    if (!team) return;
    const taker = this.selectSetPieceTaker(team, kind);
    s.players.forEach(p => { p.hasBall = false; p.isDribbling = false; });
    s.ball.carrier = null;
    s.ball.inFlight = false;
    s.ball.targetPosition = null;
    s.ball.flightStart = null;
    s.ball.trail = [];
    this.firstTouch = null;
    this.flightRecipientId = null;
    this.flightProfile = null;
    this.carryTimer = 0;
    this.carryTarget = null;
    s.possessionTeam = teamId;
    this.restart = { kind, teamId, location: { ...location }, side, takerId: taker?.id, startedTick: this.tickN };
    s.phase = kind === "corner" ? "corner" : kind === "freekick" ? "freekick" : kind === "penalty" ? "penalty" : "goalkick";
    this.pauseTimer = kind === "penalty" ? 34 : kind === "corner" ? 30 : kind === "freekick" ? 26 : 20;
    this.applyRestartTargets(true);
  }

  private selectSetPieceTaker(team: TeamState, kind: RestartKind): Player | undefined {
    const players = this.teamPlayers(team.id);
    const preferred = kind === "corner"
      ? ["LW", "RW", "LB", "RB", "AM", "CM"]
      : kind === "penalty"
        ? ["CF", "SS", "AM", "LW", "RW"]
        : kind === "goalkick"
          ? ["GK"]
          : ["AM", "CM", "LW", "RW", "CF", "LB", "RB"];
    return preferred.map(role => players.find(p => p.role === role)).find(Boolean) ?? players[0];
  }

  private applyRestartTargets(snap = false): void {
    const restart = this.restart;
    const s = this.state;
    const attacking = restart ? s.teams?.find(t => t.id === restart.teamId) : undefined;
    if (!restart || !attacking) return;
    const defending = this.opposing(attacking.id);
    const targetFor = (player: Player): Position => {
      const team = this.teamOf(player)!;
      if (restart.kind === "kickoff") return this.kickoffPosition(player, attacking, restart);
      if (restart.kind === "corner") return this.cornerPosition(player, attacking, team, restart);
      if (restart.kind === "penalty") return this.penaltyPosition(player, attacking, team, restart);
      return this.freeKickPosition(player, attacking, team, restart);
    };

    for (const player of s.players) {
      const target = targetFor(player);
      player.targetPosition = target;
      if (snap) player.position = { ...target };
    }
    if (restart.kind !== "kickoff") {
      s.ball.position = { ...restart.location };
      s.ball.carrier = null;
    }
    if (this.debugFrame.metrics) {
      this.debugFrame.metrics.restart = restart.kind;
      this.debugFrame.metrics.restartTeam = attacking.id;
      this.debugFrame.metrics.whistleInTicks = Math.max(0, this.pauseTimer);
    }
    // Keep both teams in a set-piece phase while the referee holds play.
    attacking.phase = "SET_PIECE";
    if (defending) defending.phase = "SET_PIECE";
  }

  private kickoffPosition(player: Player, kickoffTeam: TeamState, restart: RestartState): Position {
    const team = this.teamOf(player)!;
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const ownSideX = fwd > 0
      ? Math.min(player.basePosition.x, PITCH_WIDTH / 2 - 0.8)
      : Math.max(player.basePosition.x, PITCH_WIDTH / 2 + 0.8);
    if (player.id === restart.takerId) return { x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2 };
    let target = { x: ownSideX, y: player.basePosition.y };
    const fromCentre = dist(target, restart.location);
    if (team.id !== kickoffTeam.id && fromCentre < CENTER_CIRCLE_RADIUS + 0.7) {
      const dx = target.x - restart.location.x || -fwd;
      const dy = target.y - restart.location.y || (player.number % 2 ? 1 : -1);
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      target = { x: restart.location.x + dx / d * (CENTER_CIRCLE_RADIUS + 0.7), y: restart.location.y + dy / d * (CENTER_CIRCLE_RADIUS + 0.7) };
      target.x = fwd > 0 ? Math.min(target.x, PITCH_WIDTH / 2 - 0.8) : Math.max(target.x, PITCH_WIDTH / 2 + 0.8);
    }
    return { x: clamp(target.x, 1, PITCH_WIDTH - 1), y: clamp(target.y, 2, PITCH_HEIGHT - 2) };
  }

  private cornerPosition(player: Player, attacking: TeamState, team: TeamState, restart: RestartState): Position {
    const fwd = attacking.attackingDirection === "right" ? 1 : -1;
    const goal = goalCenter(attacking.attackingDirection);
    const sameTeam = team.id === attacking.id;
    if (player.id === restart.takerId) return { ...restart.location };
    if (player.role === "GK") return sameTeam
      ? { x: ownGoalCenter(team.attackingDirection).x + (team.attackingDirection === "right" ? 2.2 : -2.2), y: PITCH_HEIGHT / 2 }
      : { x: goal.x - fwd * 1.4, y: PITCH_HEIGHT / 2 };
    const order = player.number % 5;
    if (sameTeam) {
      if (["CF", "SS", "CB"].includes(player.role)) return { x: goal.x - fwd * (7 + order * 1.25), y: clamp(PITCH_HEIGHT / 2 + (order - 2) * 5.2, 18, 50) };
      if (["AM", "LW", "RW"].includes(player.role)) return { x: goal.x - fwd * (14 + order), y: clamp(PITCH_HEIGHT / 2 + (order - 2) * 6.5, 13, 55) };
      if (player.role === "DM") return { x: this.xAtProgress(attacking, 0.64), y: PITCH_HEIGHT / 2 + (order % 2 ? 10 : -10) };
      return { x: this.xAtProgress(attacking, 0.70), y: restart.side === "top" ? 11 + order * 3 : PITCH_HEIGHT - 11 - order * 3 };
    }
    if (["CB", "LB", "RB", "DM"].includes(player.role)) return { x: goal.x - fwd * (6 + order * 1.1), y: clamp(PITCH_HEIGHT / 2 + (order - 2) * 5, 17, 51) };
    return { x: goal.x - fwd * (15 + order * 1.5), y: clamp(PITCH_HEIGHT / 2 + (order - 2) * 6.5, 12, 56) };
  }

  private freeKickPosition(player: Player, attacking: TeamState, team: TeamState, restart: RestartState): Position {
    const fwd = attacking.attackingDirection === "right" ? 1 : -1;
    const goal = goalCenter(attacking.attackingDirection);
    const sameTeam = team.id === attacking.id;
    if (player.id === restart.takerId) return { ...restart.location };
    if (player.role === "GK") return sameTeam
      ? { x: ownGoalCenter(team.attackingDirection).x + (team.attackingDirection === "right" ? 2 : -2), y: PITCH_HEIGHT / 2 }
      : { x: goal.x - fwd * 1.3, y: PITCH_HEIGHT / 2 };
    const directRange = dist(restart.location, goal) < 34;
    if (!sameTeam && directRange && ["CB", "DM", "CM", "LB", "RB"].includes(player.role)) {
      const wallIndex = player.number % 4;
      return {
        x: clamp(restart.location.x + fwd * 9.4, 2, PITCH_WIDTH - 2),
        y: clamp(restart.location.y + (wallIndex - 1.5) * 2.2, 5, PITCH_HEIGHT - 5)
      };
    }
    const depth = sameTeam ? (player.role === "CF" || player.role === "SS" ? 12 : 7) : 13;
    const yOffset = (player.number % 5 - 2) * (sameTeam ? 5.5 : 4.6);
    return {
      x: clamp(restart.location.x + fwd * depth, 3, PITCH_WIDTH - 3),
      y: clamp(restart.location.y + yOffset, 4, PITCH_HEIGHT - 4)
    };
  }

  private penaltyPosition(player: Player, attacking: TeamState, team: TeamState, restart: RestartState): Position {
    const fwd = attacking.attackingDirection === "right" ? 1 : -1;
    const goal = goalCenter(attacking.attackingDirection);
    if (player.id === restart.takerId) return { x: goal.x - fwd * PENALTY_SPOT_DIST, y: PITCH_HEIGHT / 2 };
    if (player.role === "GK") return team.id === attacking.id
      ? { x: ownGoalCenter(team.attackingDirection).x + (team.attackingDirection === "right" ? 2 : -2), y: PITCH_HEIGHT / 2 }
      : { x: goal.x - fwd * 0.7, y: PITCH_HEIGHT / 2 };
    const arcX = goal.x - fwd * (PENALTY_BOX_WIDTH + 3.2 + (player.number % 2) * 1.4);
    return { x: clamp(arcX, 3, PITCH_WIDTH - 3), y: clamp(PITCH_HEIGHT / 2 + (player.number % 6 - 2.5) * 5.3, 7, PITCH_HEIGHT - 7) };
  }

  private findSetPieceBoxTarget(team: TeamState, taker: Player): Player | null {
    const goal = goalCenter(team.attackingDirection);
    return this.teamPlayers(team.id)
      .filter(p => p.id !== taker.id && ["CF", "SS", "CB", "AM", "DM"].includes(p.role))
      .map(p => ({ player: p, score: (p.role === "CF" || p.role === "SS" ? 18 : 10) + Math.max(0, 20 - dist(p.position, goal)) - p.pressure * 7 }))
      .sort((a, b) => b.score - a.score)[0]?.player ?? null;
  }

  private executeFreeKick(): void {
    const restart = this.restart;
    const team = restart ? this.state.teams?.find(t => t.id === restart.teamId) : undefined;
    const taker = restart?.takerId ? this.state.players.find(p => p.id === restart.takerId) : undefined;
    if (!restart || !team || !taker) { this.state.phase = "playing"; return; }
    this.giveBall(taker.id);
    this.state.phase = "playing";
    this.restart = null;
    const goal = goalCenter(team.attackingDirection);
    if (dist(taker.position, goal) < 28 && Math.abs(taker.position.y - goal.y) < 21 && this.chance(0.46)) {
      this.executeShot(taker, team);
      return;
    }
    const target = this.findSetPieceBoxTarget(team, taker) ?? this.findProgressiveOutlet(taker, team, this.evaluatePassOptions(taker, team, this.teamPlayers(team.id).filter(p => p.id !== taker.id)));
    if (target) this.executePass(taker, target, "PASS", true, true);
  }

  private executePenalty(): void {
    const restart = this.restart;
    const team = restart ? this.state.teams?.find(t => t.id === restart.teamId) : undefined;
    const taker = restart?.takerId ? this.state.players.find(p => p.id === restart.takerId) : undefined;
    if (!restart || !team || !taker) { this.state.phase = "playing"; return; }
    this.giveBall(taker.id);
    this.state.phase = "playing";
    this.restart = null;
    this.executeShot(taker, team);
  }

  private awardFoul(attacking: TeamState, offender: Player, location: Position): void {
    const penalty = inOpponentBox(location, attacking.attackingDirection);
    this.addEvent("FOUL", offender.id, offender.teamId, location, false);
    const goal = goalCenter(attacking.attackingDirection);
    const denialOfChance = dist(location, goal) < 18 && Math.abs(location.y - goal.y) < 12;
    const cardRisk = offender.aggression * 0.38 + (1 - offender.discipline) * 0.48 + (denialOfChance ? 0.34 : 0);
    if (this.chance(cardRisk)) {
      offender.cards = denialOfChance && this.chance(0.48) ? 2 : Math.min(2, offender.cards + 1) as 0 | 1 | 2;
      this.addEvent(offender.cards === 2 ? "RED_CARD" : "YELLOW_CARD", offender.id, offender.teamId, location, false);
      if (offender.cards === 2) {
        offender.targetPosition = { x: -20, y: -20 };
        offender.speed = 0;
      }
    }
    this.addEvent(penalty ? "PENALTY" : "FREEKICK", null, attacking.id, location, true);
    if (penalty) {
      this.beginRestart("penalty", attacking.id, { x: goal.x - (attacking.attackingDirection === "right" ? 1 : -1) * PENALTY_SPOT_DIST, y: PITCH_HEIGHT / 2 });
    } else {
      this.beginRestart("freekick", attacking.id, location);
    }
  }

  // ─── Pressure ─────────────────────────────────────────────────────────────

  private updatePressures(): void {
    for (const p of this.state.players) {
      let pressure = 0;
      for (const opp of this.state.players) {
        if (opp.teamId === p.teamId) continue;
        const d = dist(p.position, opp.position);
        if (d < 8) pressure += (1 - d / 8) * 0.75;
      }
      p.pressure = clamp(pressure, 0, 1);
    }
  }

  // ─── Ball system ──────────────────────────────────────────────────────────

  private updateBall(): void {
    const s = this.state;
    if (s.ball.inFlight) {
      this.updateFlight();
    } else if (this.firstTouch) {
      this.updateFirstTouch();
    } else if (s.ball.carrier) {
      this.updateCarrier();
    } else {
      this.chaseBall();
    }
  }

  private updateFlight(): void {
    const s = this.state;
    const ball = s.ball;
    if (!ball.inFlight || !ball.targetPosition || !ball.flightStart) return;

    const profile = this.flightProfile;
    const spd = (1 / this.flightTotalTicks) * s.speed;
    ball.flightProgress = clamp(ball.flightProgress + spd, 0, 1);

    const rawT = ball.flightProgress;
    const easedT = profile?.trajectory === "lofted"
      ? rawT < 0.5
        ? 1.15 * rawT * rawT
        : 1 - Math.pow(1 - rawT, 1.65) * 0.54
      : profile?.trajectory === "driven"
        ? 1 - Math.pow(1 - rawT, 1.12)
        : rawT;
    ball.position.x = lerp(ball.flightStart.x, ball.targetPosition.x, clamp(easedT, 0, 1));
    ball.position.y = lerp(ball.flightStart.y, ball.targetPosition.y, clamp(easedT, 0, 1));
    const arc = Math.sin(Math.PI * rawT);
    ball.height = profile ? Math.max(0, profile.apex * arc * (profile.trajectory === "lofted" ? profile.hang : 1)) : 0;
    ball.spin = ((ball.spin ?? 0) + (profile?.trajectory === "lofted" ? 0.08 : profile?.trajectory === "driven" ? 0.16 : 0.11) * s.speed) % (Math.PI * 2);
    ball.shadowStrength = clamp(0.46 - (ball.height ?? 0) * 0.035, 0.18, 0.5);
    ball.flightKind = profile?.kind ?? null;

    if (this.isShot) {
      const defending = this.opposing(this.shotAttackerTeamId ?? "");
      const keeper = defending ? this.gk(defending.id) : undefined;
      if (keeper?.keeperRead) {
        keeper.keeperRead.progress = rawT;
        keeper.keeperRead.committed = rawT > 0.32;
      }
    }

    // Interception: opponent in the pass lane with timing based on ball class.
    if (!this.isShot && this.flightRecipientId && ball.flightProgress > 0.12 && ball.flightProgress < 0.9) {
      const opponents = s.players.filter(p => p.teamId !== s.possessionTeam && p.role !== "GK");
      for (const opp of opponents) {
        const d = dist(opp.position, ball.position);
        const radius = profile?.interceptionRadius ?? 1.8;
        const heightPenalty = ball.height && ball.height > 2.2 ? 0.35 : 1;
        const chance = (profile?.interceptionChance ?? 0.12) * heightPenalty;
        if (d < radius && this.chance(chance * s.speed)) {
          ball.inFlight = false;
          ball.flightProgress = 0;
          this.flightRecipientId = null;
          this.flightProfile = null;
          if (d < 1.35) {
            this.giveBall(opp.id);
            this.addEvent("TACKLE", opp.id, opp.teamId, ball.position, true);
          } else {
            s.ball.carrier = null;
            s.possessionTeam = null;
            this.groundBall();
            opp.targetPosition = { ...ball.position };
            this.addEvent("TACKLE", opp.id, opp.teamId, ball.position, false);
          }
          return;
        }
      }
    }

    if (ball.flightProgress >= 1) {
      ball.inFlight = false;
      ball.flightProgress = 0;
      ball.position = { ...ball.targetPosition };
      ball.height = 0;
      ball.shadowStrength = 0.46;

      if (this.isShot) {
        this.resolveShotArrival();
      } else if (this.flightRecipientId) {
        const rec = s.players.find(p => p.id === this.flightRecipientId);
        if (rec) {
          // First touch check
          const touchMod = profile?.firstTouchModifier ?? 0;
          const success = this.firstTouchSuccess(rec.pressure, rec.role, touchMod);
          const looseBallOffset = success ? 0 : this.rand(2.5, profile?.kind === "cross" ? 6.5 : 5.0);
          const looseAngle = this.random() * Math.PI * 2;
          this.firstTouch = {
            recipientId: rec.id,
            countdownTicks: success ? 2 : 3,
            success,
            receivePoint: { ...ball.position },
            looseBallPos: success
              ? { ...ball.position }
              : {
                  x: clamp(ball.position.x + Math.cos(looseAngle) * looseBallOffset, 1, PITCH_WIDTH - 1),
                  y: clamp(ball.position.y + Math.sin(looseAngle) * looseBallOffset, 1, PITCH_HEIGHT - 1)
                }
          };
        } else {
          // Target player gone — loose ball
          s.ball.carrier = null;
          s.possessionTeam = null;
        }
        this.flightRecipientId = null;
      } else {
        s.ball.carrier = null;
        s.possessionTeam = null;
      }
      this.isShot = false;
      this.flightProfile = null;
    }
  }

  private isLooseBallLive(): boolean {
    const b = this.state.ball;
    return !b.carrier && !b.inFlight && !this.firstTouch;
  }

  private updateFirstTouch(): void {
    const ft = this.firstTouch!;
    const rec = this.state.players.find(p => p.id === ft.recipientId);
    if (rec) rec.targetPosition = { ...ft.receivePoint };
    ft.countdownTicks -= this.state.speed;
    if (ft.countdownTicks > 0) return;

    this.firstTouch = null;
    if (ft.success && rec && dist(rec.position, ft.receivePoint) < 2.4) {
      this.state.ball.position = { ...ft.receivePoint };
      this.giveBall(ft.recipientId);
    } else {
      // Bad touch — ball goes to loose position
      this.state.ball.position = { ...ft.looseBallPos };
      this.state.ball.carrier = null;
      this.state.possessionTeam = null;
      this.groundBall();
    }
  }

  private updateCarrier(): void {
    const s = this.state;
    const c = this.carrier();
    if (!c) return;
    s.ball.position = { ...c.position };
    this.groundBall();
    const team = this.teamOf(c);
    if (team && this.resolveCarrierDuel(c, team)) return;

    if (this.pendingKick) {
      this.updateKickWindup(c, team);
      return;
    }

    // ── Carry / dribble state machine ───────────────────────────────────────
    if (this.carryTimer > 0) {
      this.carryTimer--;
      // Drive player toward carry target
      if (this.carryTarget) {
        c.targetPosition = { ...this.carryTarget };
      }
      // Heavy pressure can force a quicker decision, but tackles are resolved only by contact duels.
      if (c.pressure > 0.78 && this.chance(0.18)) {
        this.carryTimer = 0;
        this.carryTarget = null;
        this.holdTarget = 2; // decide immediately
      }
      return;
    }

    // ── Normal hold timer ────────────────────────────────────────────────────
    this.holdTimer++;
    if (this.holdTimer < this.holdTarget) return;
    this.holdTimer = 0;
    c.isDribbling = false;
    this.makeDecision(c);
  }

  private chaseBall(): void {
    const s = this.state;
    this.looseBallChasers.clear();
    const contenders = s.players
      .filter(p => p.role !== "GK" || dist(p.position, s.ball.position) < 13)
      .map(p => {
        const d = dist(p.position, s.ball.position);
        const team = this.teamOf(p);
        const ownGoal = team ? ownGoalCenter(team.attackingDirection) : s.ball.position;
        const recoveryBias = team && inOwnHalf(s.ball.position, team.attackingDirection) ? -1.5 : 0;
        const gkPenalty = p.role === "GK" ? 5 : 0;
        const farPenalty = d > 34 ? 20 : d > 24 ? 8 : 0;
        return { player: p, d, score: d + gkPenalty + farPenalty + recoveryBias + dist(p.position, ownGoal) * 0.005 };
      })
      .sort((a, b) => a.score - b.score);

    const winner = contenders.find(c => c.d < 1.7);
    if (winner) {
      this.giveBall(winner.player.id);
      return;
    }

    const teamsSent = new Set<string>();
    const sentPlayers = new Set<string>();
    for (const c of contenders) {
      if (c.d > 30) continue;
      if (teamsSent.has(c.player.teamId)) continue;
      c.player.targetPosition = { ...s.ball.position };
      c.player.isDribbling = false;
      this.looseBallChasers.add(c.player.id);
      sentPlayers.add(c.player.id);
      teamsSent.add(c.player.teamId);
      if (teamsSent.size >= 2) break;
    }

    for (const c of contenders) {
      if (sentPlayers.size >= 3) break;
      if (sentPlayers.has(c.player.id) || c.d > 10) continue;
      c.player.targetPosition = { ...s.ball.position };
      c.player.isDribbling = false;
      this.looseBallChasers.add(c.player.id);
      sentPlayers.add(c.player.id);
    }
  }

  // ─── Shot resolution ──────────────────────────────────────────────────────

  private resolveShotArrival(): void {
    const s = this.state;
    const defTeam = this.opposing(this.shotAttackerTeamId ?? "");
    const gkP = defTeam ? this.gk(defTeam.id) : undefined;

    if (this.shotOnTarget && gkP) {
      const gkD = dist(gkP.position, s.ball.position);
      // GK save probability based on distance to ball landing spot
      // Close = high chance, far = low chance
      const reachRadius = 4.5;
      const shotDistance = this.flightTotalTicks * 5.7;
      const readBonus = gkP.keeperRead?.committed ? 0.08 : 0;
      const saveChance = clamp((gkD < reachRadius ? 0.72 - (gkD / reachRadius) * 0.45 : 0.08) + readBonus - Math.max(0, shotDistance - 20) * 0.006, 0.06, 0.76);

      if (this.chance(saveChance)) {
        // A keeper can hold a clean strike or parry a powerful/awkward effort into play.
        gkP.position = { ...s.ball.position };
        this.gkSaves.set(gkP.id, {
          diveTarget: { ...s.ball.position },
          divePhase: "holding",
          diveProgress: 0
        });
        const catchChance = clamp(0.72 - gkD * 0.1 - Math.max(0, shotDistance - 16) * 0.018, 0.18, 0.76);
        if (this.chance(catchChance)) {
          this.giveBall(gkP.id);
          this.addEvent("CATCH", gkP.id, gkP.teamId, gkP.position, true);
          this.holdTarget = 12;
        } else {
          const ownGoal = ownGoalCenter(defTeam!.attackingDirection);
          const reboundAngle = Math.atan2(s.ball.position.y - ownGoal.y, s.ball.position.x - ownGoal.x) + this.rand(-0.85, 0.85);
          s.ball.position = { x: clamp(s.ball.position.x + Math.cos(reboundAngle) * this.rand(4, 9), 1, PITCH_WIDTH - 1), y: clamp(s.ball.position.y + Math.sin(reboundAngle) * this.rand(4, 9), 1, PITCH_HEIGHT - 1) };
          s.ball.carrier = null;
          s.possessionTeam = null;
          this.groundBall();
          this.addEvent("REBOUND", gkP.id, gkP.teamId, gkP.position, true);
        }
        this.addEvent("SAVE", gkP.id, gkP.teamId, gkP.position, true);
        // GK kicks long after save
        const attTeam = s.teams?.find(t => t.id === this.shotAttackerTeamId);
        if (attTeam) {
          const goal = ownGoalCenter(defTeam!.attackingDirection);
          // Move GK to own goal area
          gkP.targetPosition = { x: goal.x, y: goal.y };
        }
        this.safePassStreak.set(gkP.teamId, 0);
      } else {
        // GOAL
        const attTeam = s.teams?.find(t => t.id === this.shotAttackerTeamId);
        if (attTeam) this.scoreGoal(attTeam);
      }
    } else if (this.shotOnTarget && !gkP) {
      // No GK — auto goal
      const attTeam = s.teams?.find(t => t.id === this.shotAttackerTeamId);
      if (attTeam) this.scoreGoal(attTeam);
    } else {
      // Off target — corner or goal kick
      const attackDir = s.teams?.find(t => t.id === this.shotAttackerTeamId)?.attackingDirection;
      const side = s.ball.position.y < PITCH_HEIGHT / 2 ? "top" : "bottom";
      if (this.chance(0.55)) {
        this.cornerSide = side;
        this.cornerAttDir = attackDir ?? "right";
        const cornerTeam = this.shotAttackerTeamId;
        const cornerPos = {
          x: this.cornerAttDir === "right" ? PITCH_WIDTH : 0,
          y: side === "top" ? 0 : PITCH_HEIGHT
        };
        if (cornerTeam) this.beginRestart("corner", cornerTeam, cornerPos, side);
        this.addEvent("CORNER", null, this.shotAttackerTeamId, s.ball.position, true);
      } else {
        s.phase = "goalkick";
        this.pauseTimer = 18;
      }
    }
    this.shotAttackerTeamId = null;
    if (gkP) gkP.keeperRead = null;
  }

  private scoreGoal(team: TeamState): void {
    const s = this.state;
    const idx = s.teams?.[0]?.id === team.id ? 0 : 1;
    s.score[idx]++;
    s.phase = "goalcelebration";
    this.pauseTimer = 80;
    this.addEvent("GOAL", s.ball.carrier, team.id, s.ball.position, true);
    s.players.forEach(p => { p.hasBall = false; });
    s.ball.carrier = null;
    s.ball.inFlight = false;
    this.looseBallChasers.clear();
    this.firstTouch = null;
    this.flightProfile = null;
    this.gkSaves.clear();
  }

  private giveBall(playerId: string): void {
    const s = this.state;
    s.players.forEach(p => { p.hasBall = false; p.isDribbling = false; });
    s.ball.carrier = null;
    s.ball.inFlight = false;
    this.firstTouch = null;
    this.flightProfile = null;
    this.flightRecipientId = null;
    this.isShot = false;
    this.carryTimer = 0;
    this.carryTarget = null;

    const p = s.players.find(pl => pl.id === playerId);
    if (!p) return;
    p.hasBall = true;
    p.lastActionTick = this.tickN;
    s.ball.carrier = playerId;
    s.ball.position = { ...p.position };
    this.groundBall();
    const prevTeam = s.possessionTeam;
    s.possessionTeam = p.teamId;
    if (prevTeam !== p.teamId) {
      if (prevTeam) {
        const oldTeam = s.teams?.find(t => t.id === prevTeam);
        if (oldTeam) {
          this.recordPossessionAction(prevTeam, {
            tick: this.tickN,
            type: "turnover",
            from: { ...s.ball.position },
            to: { ...s.ball.position },
            progressDelta: 0,
            direction: "lateral",
            success: false
          });
        }
      }
      this.onPossessionChange(p.teamId);
    }
    this.holdTimer = 0;
    const team = this.teamOf(p);
    const baseHold = holdTicks(p.role, p.pressure, team?.playStyle ?? "BALANCED");
    const settle = p.role === "GK" ? 18 : p.role === "CB" || p.role === "DM" ? 12 : p.pressure > 0.55 ? 11 : 8;
    this.holdTarget = Math.max(baseHold, settle);
  }

  private onPossessionChange(newTeamId: string): void {
    const s = this.state;
    const newTeam = s.teams?.find(t => t.id === newTeamId);
    const oldTeam = s.teams?.find(t => t.id !== newTeamId);
    if (newTeam) {
      const progress = newTeam.attackingDirection === "right"
        ? s.ball.position.x / PITCH_WIDTH
        : 1 - s.ball.position.x / PITCH_WIDTH;
      const story: PossessionStoryPhase = progress > 0.42 ? "counter" : inOwnHalf(s.ball.position, newTeam.attackingDirection) ? "buildup" : "central_progression";
      this.possessionPlans.set(newTeam.id, {
        phase: story,
        startedTick: this.tickN,
        duration: story === "counter" ? 24 : 18,
        side: this.sideOf(s.ball.position)
      });
      newTeam.phase = this.storyToTeamPhase(story);
      newTeam.phaseTimer = 0;
    }
    if (oldTeam) {
      oldTeam.phase = "DEFENSIVE_BLOCK";
      oldTeam.phaseTimer = 0;
      this.possessionPlans.delete(oldTeam.id);
    }
    // Reset safe pass streak for the new team
    this.safePassStreak.set(newTeamId, 0);
    this.lastTacticalDecision = null;
  }

  // ─── Decision making ──────────────────────────────────────────────────────

  private starProfile(player: Player): StarProfile | null {
    const role = normalizeRole(player.role);
    if (player.teamId === "fra" && role === "LW") return { style: "explosive", dribble: 0.97, finishing: 0.92, creativity: 0.78, weakFoot: 0.82 };
    if (player.teamId === "fra" && (role === "RW" || role === "AM")) return { style: "creator", dribble: 0.90, finishing: 0.82, creativity: 0.91, weakFoot: 0.84 };
    if (player.teamId === "arg" && (role === "RW" || role === "AM" || role === "SS")) return { style: "finesse", dribble: 0.98, finishing: 0.91, creativity: 0.98, weakFoot: 0.79 };
    if (player.teamId === "bra" && (role === "LW" || role === "AM")) return { style: "flair", dribble: 0.96, finishing: 0.86, creativity: 0.94, weakFoot: 0.87 };
    if (player.teamId === "por" && (role === "CF" || role === "LW")) return { style: "power", dribble: 0.88, finishing: 0.97, creativity: 0.78, weakFoot: 0.88 };
    if (player.teamId === "eng" && (role === "RW" || role === "AM")) return { style: "creator", dribble: 0.91, finishing: 0.84, creativity: 0.93, weakFoot: 0.86 };
    if (player.teamId === "esp" && (role === "LW" || role === "RW" || role === "AM")) return { style: "finesse", dribble: 0.90, finishing: 0.80, creativity: 0.92, weakFoot: 0.82 };
    if (["LW", "RW", "AM", "SS", "CF"].includes(role)) return { style: "creator", dribble: 0.78, finishing: 0.74, creativity: 0.76, weakFoot: 0.72 };
    return null;
  }

  private nearestDefender(pos: Position, teamId: string, radius = 8): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.state.players) {
      if (p.teamId === teamId || p.role === "GK") continue;
      const d = dist(pos, p.position);
      if (d < radius && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  private roleDribbleSkill(player: Player): number {
    const star = this.starProfile(player);
    if (star) return star.dribble;
    const role = normalizeRole(player.role);
    const base: Record<string, number> = {
      GK: 0.22,
      CB: 0.42,
      LB: 0.58,
      RB: 0.58,
      DM: 0.54,
      CM: 0.64,
      AM: 0.76,
      LW: 0.80,
      RW: 0.80,
      CF: 0.70,
      SS: 0.78
    };
    return base[role] ?? 0.58;
  }

  private roleTackleSkill(player: Player): number {
    const role = normalizeRole(player.role);
    const base: Record<string, number> = {
      GK: 0.25,
      CB: 0.82,
      LB: 0.72,
      RB: 0.72,
      DM: 0.78,
      CM: 0.63,
      AM: 0.45,
      LW: 0.38,
      RW: 0.38,
      CF: 0.34,
      SS: 0.38
    };
    return base[role] ?? 0.55;
  }

  // FC IQ-style player tendencies. These are deliberately role-first so every player
  // has a football brain, while the star profiles push the ceiling without making
  // everyone play the same highlight-reel game.
  private playerIQ(player: Player): PlayerIQProfile {
    const role = normalizeRole(player.role);
    const base: Record<string, PlayerIQProfile> = {
      GK: { vision: 0.56, composure: 0.80, passing: 0.70, positioning: 0.74, finishing: 0.04, flair: 0.08, risk: 0.06 },
      CB: { vision: 0.60, composure: 0.72, passing: 0.67, positioning: 0.80, finishing: 0.12, flair: 0.16, risk: 0.12 },
      LB: { vision: 0.66, composure: 0.65, passing: 0.68, positioning: 0.71, finishing: 0.28, flair: 0.38, risk: 0.31 },
      RB: { vision: 0.66, composure: 0.65, passing: 0.68, positioning: 0.71, finishing: 0.28, flair: 0.38, risk: 0.31 },
      DM: { vision: 0.76, composure: 0.80, passing: 0.78, positioning: 0.84, finishing: 0.30, flair: 0.34, risk: 0.24 },
      CM: { vision: 0.80, composure: 0.73, passing: 0.80, positioning: 0.76, finishing: 0.45, flair: 0.52, risk: 0.42 },
      AM: { vision: 0.88, composure: 0.72, passing: 0.84, positioning: 0.82, finishing: 0.70, flair: 0.74, risk: 0.67 },
      LW: { vision: 0.75, composure: 0.64, passing: 0.73, positioning: 0.78, finishing: 0.68, flair: 0.80, risk: 0.72 },
      RW: { vision: 0.75, composure: 0.64, passing: 0.73, positioning: 0.78, finishing: 0.68, flair: 0.80, risk: 0.72 },
      CF: { vision: 0.68, composure: 0.78, passing: 0.63, positioning: 0.90, finishing: 0.84, flair: 0.64, risk: 0.66 },
      SS: { vision: 0.82, composure: 0.74, passing: 0.76, positioning: 0.88, finishing: 0.78, flair: 0.78, risk: 0.70 }
    };
    const profile = { ...(base[role] ?? base.CM) };
    const star = this.starProfile(player);
    if (!star) return profile;
    profile.passing = clamp(profile.passing + (star.creativity - 0.70) * 0.55, 0, 1);
    profile.vision = clamp(profile.vision + (star.creativity - 0.70) * 0.62, 0, 1);
    profile.composure = clamp(profile.composure + (star.finishing - 0.72) * 0.30, 0, 1);
    profile.finishing = clamp(profile.finishing + (star.finishing - 0.70) * 0.55, 0, 1);
    profile.flair = clamp(profile.flair + (star.dribble - 0.72) * 0.58, 0, 1);
    profile.risk = clamp(profile.risk + (star.creativity - 0.72) * 0.28, 0, 1);
    return profile;
  }

  private nearestOpponentDistance(pos: Position, teamId: string): number {
    return this.state.players
      .filter(player => player.teamId !== teamId && player.role !== "GK")
      .reduce((nearest, player) => Math.min(nearest, dist(pos, player.position)), 40);
  }

  // A compact expected-threat model. It is not a fake xG number: it measures how
  // much more dangerous a position is, letting the engine compare unlike actions.
  private xThreat(team: TeamState, pos: Position): number {
    const progress = this.progressOf(team, pos);
    const goal = goalCenter(team.attackingDirection);
    const goalDistance = dist(pos, goal);
    const centrality = 1 - clamp(Math.abs(pos.y - PITCH_HEIGHT / 2) / (PITCH_HEIGHT / 2), 0, 1);
    const finalThird = clamp((progress - 0.48) / 0.52, 0, 1);
    const closeRange = clamp((38 - goalDistance) / 38, 0, 1);
    const boxBonus = inOpponentBox(pos, team.attackingDirection) ? 0.20 : 0;
    const halfSpace = Math.abs(pos.y - PITCH_HEIGHT / 2) > 7 && Math.abs(pos.y - PITCH_HEIGHT / 2) < 23 ? 0.05 : 0;
    return clamp(
      0.03 + progress * 0.16 + finalThird ** 1.7 * 0.31 + closeRange * 0.19 + centrality * 0.11 + boxBonus + halfSpace,
      0,
      1
    );
  }

  private shotQuality(carrier: Player, team: TeamState, iq: PlayerIQProfile): number {
    const goal = goalCenter(team.attackingDirection);
    const dGoal = dist(carrier.position, goal);
    const centrality = 1 - clamp(Math.abs(carrier.position.y - goal.y) / 27, 0, 1);
    const range = clamp((34 - dGoal) / 34, 0, 1);
    const clearPath = this.hasClearPathToGoal(carrier, team) ? 1 : 0;
    const box = inOpponentBox(carrier.position, team.attackingDirection) ? 0.18 : 0;
    const defenders = this.state.players.filter(player => player.teamId !== team.id && player.role !== "GK" && dist(player.position, carrier.position) < 7).length;
    return clamp(
      range * 0.38 + centrality * 0.20 + clearPath * 0.17 + box + iq.finishing * 0.12 + iq.composure * 0.07 - carrier.pressure * 0.24 - defenders * 0.045,
      0,
      1
    );
  }

  private patternDecisionBias(kind: TacticalActionKind, carrier: Player, team: TeamState, target?: Player): number {
    const pattern = this.activeFinalThirdPattern(team);
    if (!pattern || this.progressOf(team, carrier.position) < 0.56) return 0;
    const sameSide = target ? this.playerOnPatternSide(target, pattern.side) : this.playerOnPatternSide(carrier, pattern.side);
    const targetProgress = target ? this.progressOf(team, target.position) : this.progressOf(team, carrier.position);
    const targetBox = target ? inOpponentBox(target.position, team.attackingDirection) : false;
    if (pattern.name === "overlap" && sameSide && (kind === "progressive_pass" || kind === "carry" || kind === "cross")) return 10;
    if (pattern.name === "underlap" && sameSide && (kind === "through_ball" || kind === "progressive_pass" || kind === "dribble")) return 11;
    if (pattern.name === "half_space_slip" && (kind === "through_ball" || kind === "progressive_pass")) return 12;
    if (pattern.name === "cutback" && (kind === "cutback" || (kind === "progressive_pass" && targetProgress > 0.70))) return 15;
    if (pattern.name === "far_post_cross" && (kind === "cross" || kind === "cutback") && !sameSide) return 14;
    if (pattern.name === "edge_shot" && (kind === "shot" || (kind === "progressive_pass" && targetProgress > 0.64 && !targetBox))) return 12;
    if (pattern.name === "wide_triangle" && sameSide && (kind === "short_pass" || kind === "progressive_pass" || kind === "carry")) return 9;
    return 0;
  }

  private classifyPassAction(carrier: Player, target: Player, team: TeamState): TacticalActionKind {
    const profile = this.profileForPass(carrier, target, "PASS", this.progressOf(team, target.position) > this.progressOf(team, carrier.position) + 0.05);
    const wideCarrier = Math.abs(carrier.position.y - PITCH_HEIGHT / 2) > PITCH_HEIGHT * 0.25;
    const centralTarget = Math.abs(target.position.y - PITCH_HEIGHT / 2) < PITCH_HEIGHT * 0.24;
    if (profile.kind === "switch") return "switch";
    if (profile.kind === "cross") return wideCarrier && centralTarget ? "cutback" : "cross";
    const delta = this.xThreat(team, target.position) - this.xThreat(team, carrier.position);
    if (delta < -0.025) return "recycle";
    if (delta > 0.07) return "progressive_pass";
    return "short_pass";
  }

  private scoreTacticalPass(
    carrier: Player,
    team: TeamState,
    option: { target: Player; weight: number },
    iq: PlayerIQProfile
  ): TacticalDecision {
    const target = option.target;
    const kind = this.classifyPassAction(carrier, target, team);
    const xThreatDelta = this.xThreat(team, target.position) - this.xThreat(team, carrier.position);
    const openness = clamp(this.nearestOpponentDistance(target.position, team.id) / 8, 0, 1);
    const travel = dist(carrier.position, target.position);
    const forward = this.progressOf(team, target.position) > this.progressOf(team, carrier.position) + 0.05;
    const roleBias = (["AM", "CM", "DM"].includes(carrier.role) ? 5 : 0) + (target.role === "CF" || target.role === "SS" ? 2 : 0);
    const patternBias = this.patternDecisionBias(kind, carrier, team, target);
    const memory = this.memorySummary(team);
    const pressureRisk = clamp(carrier.pressure * 0.65 + target.pressure * 0.35 + clamp((travel - 24) / 38, 0, 0.25), 0, 1);
    let score = option.weight * 0.78 + xThreatDelta * 66 + openness * 9 + iq.passing * 7 + iq.vision * (forward ? 6 : 2) + roleBias + patternBias;
    if (kind === "recycle") score += carrier.pressure > 0.56 || memory.stale ? 5 : -2;
    if (kind === "switch") score += iq.vision * 4 - pressureRisk * 8;
    if (kind === "cross" || kind === "cutback") score += target.role === "CF" || target.role === "SS" ? 7 : 0;
    if (forward && memory.stale) score += 8;
    if (kind === "recycle" && this.progressOf(team, carrier.position) > 0.64) score -= 15;
    if (travel > 34 && kind !== "switch" && kind !== "cross") score -= 8;
    score -= pressureRisk * (kind === "short_pass" ? 4 : 10);
    return {
      kind,
      score: score + this.rand(-1.4, 1.4),
      reason: `${kind.replace("_", " ")} to ${target.role}: ${forward ? "progress" : "secure"} lane`,
      target,
      xThreatDelta,
      shotQuality: 0,
      passValue: score,
      carryValue: 0,
      pressureRisk,
      roleBias,
      patternBias
    };
  }

  private tacticalCarryTarget(carrier: Player, team: TeamState): Position {
    const goal = goalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const towardGoalY = (goal.y - carrier.position.y) * 0.22;
    return {
      x: clamp(carrier.position.x + fwd * 10, 2, PITCH_WIDTH - 2),
      y: clamp(carrier.position.y + towardGoalY, 2, PITCH_HEIGHT - 2)
    };
  }

  private chooseTacticalDecision(carrier: Player, team: TeamState): TacticalDecision | null {
    const iq = this.playerIQ(carrier);
    const progress = this.progressOf(team, carrier.position);
    const finalThird = progress > 0.63;
    const decisions: TacticalDecision[] = [];
    const teammates = this.teamPlayers(team.id).filter(player => player.id !== carrier.id && !inOwnGoalArea(player.position, team.attackingDirection));
    const passOptions = this.evaluatePassOptions(carrier, team, teammates);
    decisions.push(...passOptions.map(option => this.scoreTacticalPass(carrier, team, option, iq)));

    const shotQuality = this.shotQuality(carrier, team, iq);
    if (shotQuality > (finalThird ? 0.24 : 0.42) && carrier.role !== "GK" && carrier.role !== "CB") {
      const patternBias = this.patternDecisionBias("shot", carrier, team);
      const score = shotQuality * 88 + iq.finishing * 9 + iq.composure * 5 + patternBias;
      decisions.push({
        kind: "shot",
        score: score + this.rand(-1.2, 1.2),
        reason: shotQuality > 0.62 ? "high-quality finish" : "goal lane opens",
        xThreatDelta: 0,
        shotQuality,
        passValue: 0,
        carryValue: 0,
        pressureRisk: carrier.pressure,
        roleBias: iq.finishing * 9,
        patternBias
      });
    }

    const throughTarget = carrier.role !== "GK" && carrier.role !== "CB" ? this.findThroughBallTarget(carrier, team) : null;
    if (throughTarget && carrier.pressure < 0.70) {
      const throughPoint = {
        x: clamp(throughTarget.position.x + (team.attackingDirection === "right" ? 1 : -1) * 8, 2, PITCH_WIDTH - 2),
        y: throughTarget.position.y
      };
      const xThreatDelta = this.xThreat(team, throughPoint) - this.xThreat(team, carrier.position);
      const pressureRisk = clamp(carrier.pressure * 0.72 + throughTarget.pressure * 0.35, 0, 1);
      const patternBias = this.patternDecisionBias("through_ball", carrier, team, throughTarget);
      const score = xThreatDelta * 76 + iq.vision * 13 + iq.passing * 8 + iq.risk * 6 + patternBias - pressureRisk * 17;
      decisions.push({
        kind: "through_ball",
        score: score + this.rand(-1.5, 1.5),
        reason: `threaded run for ${throughTarget.role}`,
        target: throughTarget,
        xThreatDelta,
        shotQuality: 0,
        passValue: score,
        carryValue: 0,
        pressureRisk,
        roleBias: iq.vision * 8,
        patternBias
      });
    }

    if (carrier.role !== "GK" && carrier.role !== "CB") {
      const carryTarget = this.tacticalCarryTarget(carrier, team);
      const xThreatDelta = this.xThreat(team, carryTarget) - this.xThreat(team, carrier.position);
      const space = this.hasSpaceAhead(carrier, team) ? 1 : 0;
      const patternBias = this.patternDecisionBias("carry", carrier, team);
      const carryValue = xThreatDelta * 58 + space * 18 + this.roleDribbleSkill(carrier) * 9 + iq.composure * 4 + patternBias - carrier.pressure * 20;
      if (space || (finalThird && carrier.pressure < 0.45)) {
        decisions.push({
          kind: "carry",
          score: carryValue + this.rand(-1.2, 1.2),
          reason: space ? "open grass ahead" : "drive into the final third",
          xThreatDelta,
          shotQuality: 0,
          passValue: 0,
          carryValue,
          pressureRisk: carrier.pressure,
          roleBias: this.roleDribbleSkill(carrier) * 7,
          patternBias
        });
      }

      const nearbyDefender = this.nearestDefender(carrier.position, team.id, 6.5);
      if (nearbyDefender && carrier.pressure < 0.78) {
        const patternBias = this.patternDecisionBias("dribble", carrier, team);
        const carryValue = this.roleDribbleSkill(carrier) * 24 + iq.flair * 14 + (finalThird ? 12 : 0) + patternBias - carrier.pressure * 13 - this.roleTackleSkill(nearbyDefender) * 9;
        decisions.push({
          kind: "dribble",
          score: carryValue + this.rand(-1.3, 1.3),
          reason: `take on ${nearbyDefender.role} in isolation`,
          xThreatDelta: Math.max(0, this.xThreat(team, carryTarget) - this.xThreat(team, carrier.position)),
          shotQuality: 0,
          passValue: 0,
          carryValue,
          pressureRisk: carrier.pressure,
          roleBias: this.roleDribbleSkill(carrier) * 10,
          patternBias
        });
      }
    }

    if (carrier.pressure < 0.16 && progress < 0.62) {
      const pauseValue = iq.composure * 10 + iq.vision * 7 - progress * 4;
      decisions.push({
        kind: "pause",
        score: pauseValue + this.rand(-0.8, 0.8),
        reason: "scan before forcing the next pass",
        xThreatDelta: 0,
        shotQuality: 0,
        passValue: 0,
        carryValue: 0,
        pressureRisk: carrier.pressure,
        roleBias: iq.composure * 6,
        patternBias: 0
      });
    }

    return decisions.sort((a, b) => b.score - a.score)[0] ?? null;
  }

  private tryTacticalIQDecision(carrier: Player, team: TeamState): boolean {
    if (carrier.role === "GK" || inOwnBox(carrier.position, team.attackingDirection)) return false;
    const decision = this.chooseTacticalDecision(carrier, team);
    if (!decision || decision.score < 10) return false;
    decision.carrierId = carrier.id;
    this.lastTacticalDecision = decision;
    switch (decision.kind) {
      case "shot":
        this.executeShot(carrier, team);
        return true;
      case "through_ball":
        if (decision.target) {
          this.executeThroughBall(carrier, decision.target, team);
          return true;
        }
        return false;
      case "carry":
        this.executeCarryForward(carrier, team);
        return true;
      case "dribble": {
        const star = this.starProfile(carrier);
        if (star && this.progressOf(team, carrier.position) > 0.62) this.executeEliteTakeOn(carrier, team, star, this.nearestDefender(carrier.position, team.id, 7) ?? undefined);
        else this.executeDribble(carrier, team);
        return true;
      }
      case "pause":
        this.executePause(carrier, team);
        return true;
      default:
        if (decision.target) {
          const targetProgress = this.progressOf(team, decision.target.position);
          this.executePass(carrier, decision.target, "PASS", targetProgress > this.progressOf(team, carrier.position) + 0.05);
          return true;
        }
        return false;
    }
  }

  private passControlRequirement(distance: number, profile: BallFlightProfile, pressure: number): number {
    let required = distance < 9 ? 2 : distance < 15 ? 6 : distance < 24 ? 12 : 18;
    if (profile.trajectory === "driven") required += 3;
    if (profile.trajectory === "lofted") required += 6;
    if (pressure > 0.55) required += 4;
    return required;
  }

  private delayPassForControl(from: Player, team: TeamState, distance: number, profile: BallFlightProfile): boolean {
    if (profile.kind === "clearance") return false;
    const controlTicks = this.tickN - from.lastActionTick;
    const required = this.passControlRequirement(distance, profile, from.pressure);
    if (controlTicks >= required) return false;

    if (from.role !== "GK" && this.hasSpaceAhead(from, team) && this.chance(0.45 + this.roleDribbleSkill(from) * 0.25)) {
      this.executeCarryForward(from, team);
    } else if (from.role !== "GK" && from.pressure > 0.45 && this.nearestDefender(from.position, from.teamId, 4.5)) {
      this.executeDribble(from, team);
    } else {
      this.executePause(from, team);
    }
    return true;
  }

  private queueKick(kick: PendingKick, player: Player): void {
    this.pendingKick = kick;
    player.kickWindup = { kind: kick.kind, progress: 0 };
    player.isDribbling = false;
  }

  private updateKickWindup(carrier: Player, team?: TeamState): void {
    const kick = this.pendingKick;
    if (!kick || kick.fromId !== carrier.id || !team) { this.pendingKick = null; return; }
    const defender = this.touchingDefender(carrier);
    if (defender && this.chance(0.06 + defender.tackling * 0.07)) {
      this.pendingKick = null;
      carrier.kickWindup = null;
      this.state.ball.position = { ...carrier.position };
      this.state.ball.carrier = null;
      this.state.possessionTeam = null;
      this.groundBall();
      this.addEvent("TACKLE", defender.id, defender.teamId, carrier.position, false);
      return;
    }
    kick.ticks -= this.state.speed;
    if (carrier.kickWindup) carrier.kickWindup.progress = clamp(1 - kick.ticks / (kick.kind === "shot" ? 10 : 5), 0, 1);
    if (kick.ticks > 0) return;
    carrier.kickWindup = null;
    this.pendingKick = null;
    if (kick.kind === "shot") this.executeShot(carrier, team, true);
    else {
      const target = this.state.players.find(p => p.id === kick.toId);
      if (target) this.executePass(carrier, target, kick.type, kick.forward, kick.bypassControl, true);
    }
  }

  private touchingDefender(carrier: Player): Player | null {
    const touchRadius = carrier.isDribbling ? 1.85 : 1.55;
    return this.nearestDefender(carrier.position, carrier.teamId, touchRadius);
  }

  private resolveCarrierDuel(carrier: Player, team: TeamState): boolean {
    const defender = this.touchingDefender(carrier);
    if (!defender && !this.activeDuel) return false;

    if (!this.activeDuel && defender) {
      this.activeDuel = { attackerId: carrier.id, defenderId: defender.id, startedTick: this.tickN, duration: 7 };
      carrier.duel = { opponentId: defender.id, progress: 0 };
      defender.duel = { opponentId: carrier.id, progress: 0 };
      carrier.isDribbling = true;
      this.addEvent("DUEL", carrier.id, carrier.teamId, carrier.position, true);
      return true;
    }
    const duel = this.activeDuel;
    if (!duel) return false;
    const attacker = this.state.players.find(p => p.id === duel.attackerId);
    const challenger = this.state.players.find(p => p.id === duel.defenderId);
    if (!attacker || !challenger || attacker.id !== carrier.id) { this.activeDuel = null; return false; }
    const progress = clamp((this.tickN - duel.startedTick) / duel.duration, 0, 1);
    attacker.duel = { opponentId: challenger.id, progress };
    challenger.duel = { opponentId: attacker.id, progress };
    attacker.targetPosition = { x: lerp(attacker.position.x, challenger.position.x, 0.18), y: lerp(attacker.position.y, challenger.position.y, 0.18) };
    challenger.targetPosition = { x: lerp(challenger.position.x, attacker.position.x, 0.18), y: lerp(challenger.position.y, attacker.position.y, 0.18) };
    if (progress < 1) return true;
    this.activeDuel = null;
    attacker.duel = null;
    challenger.duel = null;

    const key = `${attacker.id}:${challenger.id}`;
    const last = this.duelCooldown.get(key) ?? -999;
    if (this.tickN - last < 10) return false;
    this.duelCooldown.set(key, this.tickN);

    const attackerSkill = this.roleDribbleSkill(attacker) + attacker.balance * 0.34 + attacker.strength * 0.22;
    const defenderSkill = this.roleTackleSkill(challenger) + challenger.tackling * 0.35 + challenger.strength * 0.22;
    const attackerMoving = attacker.isDribbling || dist(attacker.position, attacker.targetPosition) > 1.5;
    const attackerScore = attackerSkill + (attackerMoving ? 0.12 : 0) + this.rand(-0.10, 0.10) - attacker.pressure * 0.10;
    const defenderScore = defenderSkill + this.rand(-0.10, 0.10) + challenger.aggression * 0.08;
    const attackerWins = attackerScore >= defenderScore;

    if (!attackerWins) {
      // A mistimed challenge is more likely against a moving dribbler. Awarding the
      // restart before possession changes keeps the attacking side on the ball.
      const foulChance = (attacker.isDribbling ? 0.07 : 0.025)
        + challenger.aggression * 0.12 + (1 - challenger.discipline) * 0.17;
      if (this.chance(foulChance)) {
        this.awardFoul(team, challenger, { ...attacker.position });
        return true;
      }
      if (this.chance(0.22 + Math.abs(attackerScore - defenderScore) * 0.18)) {
        this.state.ball.position = { x: clamp((attacker.position.x + challenger.position.x) / 2 + this.rand(-2, 2), 1, PITCH_WIDTH - 1), y: clamp((attacker.position.y + challenger.position.y) / 2 + this.rand(-2, 2), 1, PITCH_HEIGHT - 1) };
        this.state.ball.carrier = null;
        this.state.possessionTeam = null;
        this.groundBall();
        this.addEvent("TACKLE", challenger.id, challenger.teamId, attacker.position, false);
        return true;
      }
      this.giveBall(challenger.id);
      this.recordPossessionAction(team.id, {
        tick: this.tickN,
        type: "turnover",
        fromRole: attacker.role,
        from: { ...attacker.position },
        to: { ...challenger.position },
        progressDelta: 0,
        direction: "lateral",
        success: false
      });
      this.addEvent("TACKLE", challenger.id, challenger.teamId, attacker.position, true);
      return true;
    }

    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const awayY = Math.sign(attacker.position.y - challenger.position.y) || (this.chance(0.5) ? 1 : -1);
    const slipTarget = {
      x: clamp(attacker.position.x + fwd * this.rand(2.8, 5.8), 1, PITCH_WIDTH - 1),
      y: clamp(attacker.position.y + awayY * this.rand(1.6, 3.8), 1, PITCH_HEIGHT - 1)
    };
    this.carryTarget = slipTarget;
    this.carryTimer = Math.max(this.carryTimer, Math.round(this.rand(5, 10)));
    this.carryMode = "take_on";
    attacker.isDribbling = true;
    this.recordPossessionAction(team.id, {
      tick: this.tickN,
      type: "dribble",
      fromRole: attacker.role,
      from: { ...attacker.position },
      to: { ...slipTarget },
      progressDelta: this.progressOf(team, slipTarget) - this.progressOf(team, attacker.position),
      direction: "forward",
      success: true
    });
    this.addEvent("DRIBBLE", attacker.id, attacker.teamId, attacker.position, true);
    return false;
  }

  private boxCornerThreat(carrier: Player, team: TeamState): boolean {
    const progress = this.progressOf(team, carrier.position);
    const widePocket = carrier.position.y < PITCH_HEIGHT * 0.34 || carrier.position.y > PITCH_HEIGHT * 0.66;
    const halfSpace = carrier.position.y > PITCH_HEIGHT * 0.25 && carrier.position.y < PITCH_HEIGHT * 0.75;
    return progress > 0.68 && progress < 0.90 && (widePocket || halfSpace);
  }

  private keeperCommitted(team: TeamState): boolean {
    const defTeam = this.opposing(team.id);
    if (!defTeam) return false;
    const gk = this.gk(defTeam.id);
    if (!gk) return false;
    const goal = ownGoalCenter(defTeam.attackingDirection);
    return dist(gk.position, goal) > 2.8;
  }

  private findSquareBallTarget(carrier: Player, team: TeamState): Player | null {
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const goal = goalCenter(team.attackingDirection);
    const candidates = this.teamPlayers(team.id)
      .filter(p => p.id !== carrier.id && ["CF", "SS", "AM", "LW", "RW", "CM"].includes(p.role))
      .filter(p => Math.abs(p.position.y - goal.y) < 12)
      .filter(p => (p.position.x - carrier.position.x) * fwd > -10)
      .map(p => {
        const dGoal = dist(p.position, goal);
        const open = this.state.players
          .filter(o => o.teamId !== team.id && o.role !== "GK")
          .every(o => dist(o.position, p.position) > 3.8);
        const laneClear = this.state.players
          .filter(o => o.teamId !== team.id && o.role !== "GK")
          .every(o => this.distToLine(carrier.position, p.position, o.position) > 1.8);
        return { p, score: (open ? 16 : 0) + (laneClear ? 10 : 0) + Math.max(0, 18 - dGoal) };
      })
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.score > 14 ? candidates[0].p : null;
  }

  private tryEliteFinalThirdAction(carrier: Player, team: TeamState): boolean {
    const star = this.starProfile(carrier);
    if (!star) return false;

    const goal = goalCenter(team.attackingDirection);
    const dGoal = dist(carrier.position, goal);
    const progress = this.progressOf(team, carrier.position);
    const finalThird = progress > 0.64;
    const inBox = inOpponentBox(carrier.position, team.attackingDirection);
    if (!finalThird || dGoal > 34) return false;

    const squareTarget = this.findSquareBallTarget(carrier, team);
    const keeperPulled = this.keeperCommitted(team);
    const cutbackWindow = inBox && dGoal < 16 && Math.abs(carrier.position.y - goal.y) > 5;
    if (inBox && squareTarget && (keeperPulled || cutbackWindow) && this.chance((keeperPulled ? 0.50 : 0.28) + star.creativity * 0.35)) {
      this.executePass(carrier, squareTarget, "PASS", true);
      return true;
    }

    const openShotLane = this.hasClearPathToGoal(carrier, team);
    const cornerThreat = this.boxCornerThreat(carrier, team);
    const defender = this.nearestDefender(carrier.position, team.id, cornerThreat ? 7.5 : 5.5);
    const outsideBoxWindow = !inBox && dGoal < 28 && progress > 0.70 && Math.abs(carrier.position.y - goal.y) < 22;

    if (outsideBoxWindow && (openShotLane || carrier.pressure < 0.38) && this.chance(0.20 + star.finishing * 0.38)) {
      this.executeShot(carrier, team);
      return true;
    }

    if (cornerThreat && defender && carrier.pressure < 0.72 && this.chance(0.40 + star.dribble * 0.42)) {
      this.executeEliteTakeOn(carrier, team, star, defender);
      return true;
    }

    if (["LW", "RW", "AM", "SS", "CF"].includes(carrier.role) && dGoal < 26 && carrier.pressure < 0.48 && this.chance(0.18 + star.dribble * 0.24)) {
      this.executeEliteTakeOn(carrier, team, star, defender ?? undefined);
      return true;
    }

    return false;
  }

  private tryChanceCreationSurge(carrier: Player, team: TeamState): boolean {
    const memory = this.memorySummary(team);
    const streak = this.safePassStreak.get(team.id) ?? 0;
    const goal = goalCenter(team.attackingDirection);
    const dGoal = dist(carrier.position, goal);
    const progress = this.progressOf(team, carrier.position);
    const staleAttack = memory.stale || memory.recyclingLoop || streak > 6 || (memory.netProgress < 0.05 && memory.recentForwardPasses <= 1);
    const usefulZone = progress > 0.36 && progress < 0.88;
    if (!staleAttack || !usefulZone || carrier.role === "GK" || carrier.role === "CB") return false;

    const boxTarget = progress > 0.68 ? this.findCrossOrCutbackTarget(carrier, team) ?? this.findBoxTarget(carrier, team) : null;
    if (boxTarget && this.chance(0.48)) {
      this.executePass(carrier, boxTarget, "PASS", true);
      return true;
    }

    const throughTarget = this.findThroughBallTarget(carrier, team);
    if (throughTarget && carrier.pressure < 0.62 && this.chance(0.36 + this.roleDribbleSkill(carrier) * 0.16)) {
      this.executeThroughBall(carrier, throughTarget, team);
      return true;
    }

    if (dGoal < 24 && ["CF", "SS", "AM", "LW", "RW", "CM"].includes(carrier.role) && this.hasClearPathToGoal(carrier, team) && this.chance(0.42)) {
      this.executeShot(carrier, team);
      return true;
    }

    if (this.hasSpaceAhead(carrier, team) && carrier.pressure < 0.58 && this.chance(0.52)) {
      this.executeCarryForward(carrier, team);
      return true;
    }

    if (this.nearestDefender(carrier.position, carrier.teamId, 5.5) && carrier.pressure < 0.72 && this.chance(0.30 + this.roleDribbleSkill(carrier) * 0.24)) {
      this.executeDribble(carrier, team);
      return true;
    }

    return false;
  }

  private patternTargetScore(player: Player, point: Position, preferredRoles: string[], team: TeamState): number {
    const roleBonus = preferredRoles.includes(player.role) ? 18 : ["CF", "SS", "AM", "LW", "RW", "CM"].includes(player.role) ? 6 : 0;
    const nearestDef = this.state.players
      .filter(p => p.teamId !== team.id && p.role !== "GK")
      .reduce((best, opp) => Math.min(best, dist(opp.position, player.position)), 99);
    return roleBonus + clamp(nearestDef, 0, 8) * 1.8 - dist(player.position, point) * 0.7 - player.pressure * 8;
  }

  private findPatternTarget(
    carrier: Player,
    team: TeamState,
    pattern: FinalThirdPatternState,
    lane: "touchline" | "halfspace" | "box" | "farpost" | "edge",
    preferredRoles: string[]
  ): Player | null {
    const point = {
      x: this.patternProgressTarget(team, lane === "edge" ? 0.74 : lane === "farpost" ? 0.87 : lane === "box" ? 0.85 : 0.76),
      y: this.patternLane(pattern.side, lane)
    };
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const candidates = this.teamPlayers(team.id)
      .filter(p => p.id !== carrier.id && p.role !== "GK")
      .filter(p => {
        const aheadEnough = (p.position.x - carrier.position.x) * fwd > (lane === "edge" ? -16 : -8);
        return aheadEnough || preferredRoles.includes("CM") || preferredRoles.includes("AM");
      })
      .map(p => ({ player: p, score: this.patternTargetScore(p, point, preferredRoles, team) }))
      .filter(o => o.score > -8)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.player ?? null;
  }

  private tryFinalThirdPatternAction(carrier: Player, team: TeamState): boolean {
    const pattern = this.activeFinalThirdPattern(team);
    if (!pattern || carrier.role === "GK" || carrier.role === "CB") return false;
    const progress = this.progressOf(team, carrier.position);
    if (progress < 0.58 || carrier.pressure > 0.82) return false;

    const goal = goalCenter(team.attackingDirection);
    const wideCarrier = carrier.position.y < PITCH_HEIGHT * 0.26 || carrier.position.y > PITCH_HEIGHT * 0.74;
    const bylineCarrier = progress > 0.78 && wideCarrier;
    const centralCarrier = Math.abs(carrier.position.y - PITCH_HEIGHT / 2) < 18;
    const age = this.tickN - pattern.startedTick;
    const mature = age > 18;

    if ((pattern.name === "cutback" || pattern.name === "wide_triangle") && bylineCarrier && mature) {
      const cutback = this.findPatternTarget(carrier, team, pattern, "edge", ["AM", "CM", "SS", "CF"])
        ?? this.findCrossOrCutbackTarget(carrier, team);
      if (cutback && this.chance(pattern.name === "cutback" ? 0.82 : 0.58)) {
        this.executePass(carrier, cutback, "PASS", true);
        return true;
      }
    }

    if ((pattern.name === "far_post_cross" || pattern.name === "wide_triangle") && wideCarrier && progress > 0.68 && mature) {
      const farPost = this.findPatternTarget(carrier, team, pattern, "farpost", ["LW", "RW", "CF", "SS"]);
      if (farPost && this.chance(pattern.name === "far_post_cross" ? 0.74 : 0.42)) {
        this.executePass(carrier, farPost, "PASS", true);
        return true;
      }
    }

    if (pattern.name === "overlap" && wideCarrier) {
      const overlap = this.findPatternTarget(carrier, team, pattern, "touchline", ["LB", "RB", "LW", "RW"]);
      if (overlap && dist(overlap.position, carrier.position) < 28 && this.chance(0.54)) {
        this.executePass(carrier, overlap, "PASS", true);
        return true;
      }
      if (this.hasSpaceAhead(carrier, team) && this.chance(0.32)) {
        this.executeCarryForward(carrier, team);
        return true;
      }
    }

    if (pattern.name === "underlap" || pattern.name === "half_space_slip") {
      const runner = this.findPatternTarget(carrier, team, pattern, "halfspace", pattern.name === "underlap" ? ["CM", "AM", "LB", "RB"] : ["AM", "SS", "CF"]);
      if (runner && progress > 0.60 && carrier.pressure < 0.66 && this.chance(pattern.name === "half_space_slip" ? 0.58 : 0.44)) {
        this.executeThroughBall(carrier, runner, team);
        return true;
      }
    }

    if (pattern.name === "edge_shot") {
      if (centralCarrier && dist(carrier.position, goal) < 28 && ["AM", "CM", "SS", "LW", "RW"].includes(carrier.role) && this.hasClearPathToGoal(carrier, team) && this.chance(0.54)) {
        this.executeShot(carrier, team);
        return true;
      }
      const edge = this.findPatternTarget(carrier, team, pattern, "edge", ["AM", "CM", "SS"]);
      if (edge && dist(edge.position, goal) < 34 && this.chance(0.50)) {
        this.executePass(carrier, edge, "PASS", true);
        return true;
      }
    }

    if (wideCarrier && progress > 0.70 && mature) {
      const boxTarget = this.findPatternTarget(carrier, team, pattern, "box", ["CF", "SS", "AM"])
        ?? this.findBoxTarget(carrier, team);
      if (boxTarget && this.chance(0.36)) {
        this.executePass(carrier, boxTarget, "PASS", true);
        return true;
      }
    }

    if (this.hasSpaceAhead(carrier, team) && progress < 0.76 && carrier.pressure < 0.48 && this.chance(0.22)) {
      this.executeCarryForward(carrier, team);
      return true;
    }

    return false;
  }

  private makeDecision(carrier: Player): void {
    const s = this.state;
    const team = this.teamOf(carrier);
    if (!team) return;

    const goal = goalCenter(team.attackingDirection);
    const dGoal = dist(carrier.position, goal);
    const inBox = inOpponentBox(carrier.position, team.attackingDirection);
    const finalThird = inFinalThird(carrier.position, team.attackingDirection);
    const ownHalf = inOwnHalf(carrier.position, team.attackingDirection);
    const ownBox = inOwnBox(carrier.position, team.attackingDirection);
    const risk = roleRisk(carrier.role);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const story = this.possessionStory(team).phase;
    const goalMouthChance = dGoal < 14 && Math.abs(carrier.position.y - goal.y) < 11 && ["CF", "SS", "AM", "LW", "RW", "CM"].includes(carrier.role);

    // ── Emergency clearance ───────────────────────────────────────────────────
    if (ownBox && carrier.pressure > 0.4) {
      const clearTarget = this.findClearanceTarget(carrier, team);
      if (clearTarget) { this.executePass(carrier, clearTarget, "CLEARANCE"); return; }
    }

    // ── Shot evaluation ───────────────────────────────────────────────────────
    // Main decision layer: rank every realistic action before phase-specific fallbacks.
    if (this.tryTacticalIQDecision(carrier, team)) return;
    if (this.tryFinalThirdPatternAction(carrier, team)) return;
    if (this.tryEliteFinalThirdAction(carrier, team)) return;
    if (this.tryChanceCreationSurge(carrier, team)) return;

    if (goalMouthChance) {
      const squareTarget = this.findSquareBallTarget(carrier, team);
      if (squareTarget && Math.abs(carrier.position.y - goal.y) > 5 && this.chance(0.38)) {
        this.executePass(carrier, squareTarget, "PASS", true);
        return;
      }
      this.executeShot(carrier, team);
      return;
    }

    let shotProb = 0;
    if (inBox) {
      const angle = Math.abs(Math.atan2(carrier.position.y - goal.y, goal.x - carrier.position.x));
      const angleDeg = angle * 180 / Math.PI;
      shotProb = angleDeg < 35 ? 0.50 : angleDeg < 55 ? 0.28 : 0.12;
      shotProb *= (1 - carrier.pressure * 0.5);
      if (dGoal < 12) shotProb = Math.max(shotProb, 0.58 * (1 - carrier.pressure * 0.35));
      if (dGoal < 8 && carrier.pressure < 0.35) shotProb = Math.max(shotProb, 0.72);
      // Long-shot risk attempt for creative attackers
    } else if (dGoal < 22 && finalThird && risk > 0.5 && this.chance(risk * 0.18)) {
      shotProb = 0.22 * (1 - carrier.pressure * 0.5);
    }
    if (finalThird && ["CF", "SS", "AM", "LW", "RW"].includes(carrier.role) && dGoal < 30) {
      shotProb = Math.max(shotProb, (dGoal < 20 ? 0.30 : 0.16) * (1 - carrier.pressure * 0.42));
    }
    if (story === "shot" && dGoal < 28 && ["CF", "SS", "AM", "LW", "RW"].includes(carrier.role)) {
      shotProb = Math.max(shotProb, (dGoal < 18 ? 0.54 : 0.30) * (1 - carrier.pressure * 0.36));
    }
    if (story === "box_entry" && inBox) {
      shotProb = Math.max(shotProb, 0.48 * (1 - carrier.pressure * 0.38));
    }
    const poorShotAngle = Math.abs(carrier.position.y - goal.y) > 18 || (dGoal < 18 && Math.abs(carrier.position.y - goal.y) > 12);
    if (poorShotAngle && !this.starProfile(carrier)) shotProb *= 0.28;
    if (poorShotAngle && ["LB", "RB", "DM", "CM"].includes(carrier.role)) shotProb *= 0.18;
    const oneOnOne = this.hasClearPathToGoal(carrier, team);
    if (oneOnOne && dGoal < 24 && ["CF", "SS", "AM", "LW", "RW"].includes(carrier.role)) {
      if (dGoal > 10 && carrier.pressure < 0.42) {
        this.executeCarryForward(carrier, team);
        return;
      }
      shotProb = Math.max(shotProb, 0.78 * (1 - carrier.pressure * 0.25));
    }
    if (this.chance(shotProb)) { this.executeShot(carrier, team); return; }

    const wideChannel = carrier.position.y < PITCH_HEIGHT * 0.24 || carrier.position.y > PITCH_HEIGHT * 0.76;
    const advancedChanceZone = finalThird && dGoal < 36;
    if (advancedChanceZone && wideChannel) {
      const crossTarget = this.findCrossOrCutbackTarget(carrier, team);
      if (crossTarget && this.chance(story === "wide_attack" ? 0.82 : 0.62)) {
        this.executePass(carrier, crossTarget, "PASS", true);
        return;
      }
    }
    const boxBallChance = story === "wide_attack" ? 0.66 : story === "box_entry" ? 0.58 : wideChannel ? 0.46 : 0.30;
    if (advancedChanceZone && this.chance(boxBallChance)) {
      const boxTarget = this.findBoxTarget(carrier, team);
      if (boxTarget) {
        this.executePass(carrier, boxTarget, "PASS", true);
        return;
      }
      if (dGoal < 28) {
        this.executeShot(carrier, team);
        return;
      }
    }

    // ── Dribbling decisions ───────────────────────────────────────────────────
    // A) Pause / scan: very low pressure, player holds ball and scans for options
    if (carrier.pressure < 0.15 && !finalThird && story !== "counter" && this.chance(ownHalf ? 0.16 : 0.08)) {
      this.executePause(carrier, team);
      return;
    }

    const carrierProgress = this.progressOf(team, carrier.position);
    const midfieldBand = carrierProgress > 0.34 && carrierProgress < 0.68;
    if (midfieldBand && ["DM", "CM", "AM", "LB", "RB"].includes(carrier.role) && !ownHalf) {
      const nearbyDefender = this.nearestDefender(carrier.position, carrier.teamId, 5.5);
      const lineBreakChance = story === "central_progression" ? 0.38 : 0.24;
      if (nearbyDefender && carrier.pressure < 0.68 && this.chance(lineBreakChance + this.roleDribbleSkill(carrier) * 0.16)) {
        this.executeDribble(carrier, team);
        return;
      }
      if (this.hasSpaceAhead(carrier, team) && carrier.pressure < 0.50 && this.chance(lineBreakChance + 0.12)) {
        this.executeCarryForward(carrier, team);
        return;
      }
    }

    // B) Sideways carry to open angle (all outfield roles, low pressure)
    const dribbleSkill = this.roleDribbleSkill(carrier);
    const isOutfield = carrier.role !== "GK";
    if (isOutfield && carrier.pressure < 0.32 && story !== "box_entry" && story !== "shot" && this.chance(finalThird ? 0.10 + dribbleSkill * 0.10 : 0.10 + dribbleSkill * 0.16)) {
      this.executeCarrySideways(carrier, team);
      return;
    }

    // C) Drive into space: every outfield player can carry, with attackers doing it more often.
    const driveRoles = ["CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "CF", "SS"];
    const spaceAhead = this.hasSpaceAhead(carrier, team);
    const roleCarryBias = ["CB", "DM"].includes(carrier.role) ? 0.55 : ["LB", "RB", "CM"].includes(carrier.role) ? 0.82 : 1.08;
    const carryChance = (story === "counter" ? 0.52 : finalThird ? 0.38 : ownHalf ? 0.18 : 0.30) * roleCarryBias + dribbleSkill * 0.10;
    if (driveRoles.includes(carrier.role) && spaceAhead && carrier.pressure < 0.58 && this.chance(carryChance)) {
      this.executeCarryForward(carrier, team);
      return;
    }

    // D) Take on a defender when contact/near-contact pressure is there.
    const takeOnRoles = ["LB", "RB", "DM", "CM", "AM", "LW", "RW", "CF", "SS"];
    const duelNearby = Boolean(this.nearestDefender(carrier.position, carrier.teamId, 4.2));
    if (takeOnRoles.includes(carrier.role) && (finalThird || duelNearby) && carrier.pressure < 0.72 && this.chance(dribbleSkill * (finalThird ? 0.30 : 0.18))) {
      this.executeDribble(carrier, team);
      return;
    }

    // ── Pass evaluation ───────────────────────────────────────────────────────
    const teammates = this.teamPlayers(team.id).filter(p =>
      p.id !== carrier.id && !inOwnGoalArea(p.position, team.attackingDirection)
    );
    const options = this.evaluatePassOptions(carrier, team, teammates);

    // E) Through ball: risky pass into space for creative players in final third
    if (risk > 0.45 && (finalThird || !ownHalf) && carrier.pressure < 0.58 && this.chance(risk * (story === "box_entry" || story === "counter" ? 0.42 : finalThird ? 0.34 : 0.18))) {
      const throughTarget = this.findThroughBallTarget(carrier, team);
      if (throughTarget) { this.executeThroughBall(carrier, throughTarget, team); return; }
    }

    const directProgression = story === "central_progression" || story === "counter" || story === "wide_attack" || story === "box_entry";
    if (directProgression && carrier.pressure < 0.68 && this.chance(story === "counter" ? 0.58 : story === "box_entry" ? 0.46 : 0.34)) {
      const progressive = this.findProgressiveOutlet(carrier, team, options);
      if (progressive) {
        const recipientDGoal = dist(progressive.position, goal);
        this.executePass(carrier, progressive, "PASS", recipientDGoal < dGoal - 4);
        return;
      }
    }

    const chosen = this.weightedChoice(options);
    if (chosen) {
      const recipientDGoal = dist(chosen.target.position, goal);
      const carrierDGoal = dist(carrier.position, goal);
      const isForwardPass = recipientDGoal < carrierDGoal - 4;
      this.executePass(carrier, chosen.target, "PASS", isForwardPass);
    } else {
      // No options — hold longer
      this.holdTarget = Math.min(this.holdTarget + 5, 40);
    }
  }

  private hasSpaceAhead(carrier: Player, team: TeamState): boolean {
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const lookAhead = { x: carrier.position.x + fwd * 8, y: carrier.position.y };
    const opponents = this.state.players.filter(p => p.teamId !== carrier.teamId);
    for (const opp of opponents) {
      if (dist(opp.position, lookAhead) < 6) return false;
    }
    return true;
  }

  private findThroughBallTarget(carrier: Player, team: TeamState): Player | null {
    const goal = goalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const attackers = this.teamPlayers(team.id).filter(p =>
      p.id !== carrier.id && ["CF", "LW", "RW", "SS", "AM"].includes(p.role)
    );
    // Find an attacker ahead of carrier who has space between them and goal
    for (const a of attackers) {
      const ahead = fwd > 0 ? a.position.x > carrier.position.x + 5 : a.position.x < carrier.position.x - 5;
      if (!ahead) continue;
      const dGoal = dist(a.position, goal);
      if (dGoal > 45) continue;
      // Check no defender between them and goal
      const opponents = this.state.players.filter(p => p.teamId !== carrier.teamId && p.role !== "GK");
      let clear = true;
      for (const opp of opponents) {
        if (dist(opp.position, a.position) < 3.8) { clear = false; break; }
      }
      if (clear) return a;
    }
    return null;
  }

  private findBoxTarget(carrier: Player, team: TeamState): Player | null {
    const goal = goalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const attackers = this.teamPlayers(team.id).filter(p =>
      p.id !== carrier.id && ["CF", "SS", "AM", "LW", "RW", "CM"].includes(p.role)
    );
    const candidates = attackers
      .map(p => {
        const ahead = fwd > 0 ? p.position.x > carrier.position.x - 5 : p.position.x < carrier.position.x + 5;
        const dGoal = dist(p.position, goal);
        const centrality = 1 - Math.abs(p.position.y - PITCH_HEIGHT / 2) / (PITCH_HEIGHT / 2);
        const boxBonus = inOpponentBox(p.position, team.attackingDirection) ? 18 : 0;
        const roleBonus = p.role === "CF" || p.role === "SS" ? 12 : p.role === "AM" ? 8 : 4;
        const pressurePenalty = p.pressure * 8;
        const score = (ahead ? 12 : 0) + boxBonus + roleBonus + centrality * 8 + Math.max(0, 34 - dGoal) - pressurePenalty;
        return { player: p, score };
      })
      .filter(o => o.score > 14)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.player ?? null;
  }

  private hasClearPathToGoal(carrier: Player, team: TeamState): boolean {
    const goal = goalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const dGoal = dist(carrier.position, goal);
    if (dGoal > 26) return false;
    const opponents = this.state.players.filter(p => p.teamId !== carrier.teamId && p.role !== "GK");
    let blockers = 0;
    for (const opp of opponents) {
      const ahead = (opp.position.x - carrier.position.x) * fwd > -1;
      if (!ahead) continue;
      const laneD = this.distToLine(carrier.position, goal, opp.position);
      const goalSide = dist(opp.position, goal) < dGoal + 2;
      if (goalSide && laneD < 5.4) blockers++;
    }
    return blockers === 0 || (blockers === 1 && carrier.pressure < 0.18);
  }

  private findCrossOrCutbackTarget(carrier: Player, team: TeamState): Player | null {
    const goal = goalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const attackers = this.teamPlayers(team.id).filter(p =>
      p.id !== carrier.id && ["CF", "SS", "AM", "LW", "RW", "CM"].includes(p.role)
    );
    const opponents = this.state.players.filter(p => p.teamId !== team.id && p.role !== "GK");
    const byline = team.attackingDirection === "right"
      ? carrier.position.x > PITCH_WIDTH * 0.78
      : carrier.position.x < PITCH_WIDTH * 0.22;

    const candidates = attackers.map(p => {
      const aheadOrLevel = (p.position.x - carrier.position.x) * fwd > (byline ? -12 : -2);
      const central = Math.abs(p.position.y - PITCH_HEIGHT / 2) < PITCH_HEIGHT * 0.24;
      const dGoal = dist(p.position, goal);
      const nearestDef = opponents.reduce((best, opp) => Math.min(best, dist(opp.position, p.position)), 99);
      const inBox = inOpponentBox(p.position, team.attackingDirection);
      let score = 0;
      if (aheadOrLevel) score += 12;
      if (central) score += 9;
      if (inBox) score += 16;
      if (byline && dGoal < 20) score += 8;
      if (p.role === "CF" || p.role === "SS") score += 10;
      if (p.role === "AM") score += 7;
      score += clamp(nearestDef, 0, 8) * 2;
      score += Math.max(0, 30 - dGoal);
      score -= p.pressure * 12;
      return { player: p, score };
    })
      .filter(o => o.score > 26)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.player ?? null;
  }

  private findProgressiveOutlet(carrier: Player, team: TeamState, options: Array<{ target: Player; weight: number }>): Player | null {
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const story = this.possessionStory(team);
    const memory = this.memorySummary(team);
    const carrierProgress = team.attackingDirection === "right"
      ? carrier.position.x / PITCH_WIDTH
      : 1 - carrier.position.x / PITCH_WIDTH;
    const candidates = options
      .filter(o => {
        const p = o.target;
        const targetProgress = team.attackingDirection === "right"
          ? p.position.x / PITCH_WIDTH
          : 1 - p.position.x / PITCH_WIDTH;
        const aheadBy = (p.position.x - carrier.position.x) * fwd;
        if (aheadBy < 5 && targetProgress < carrierProgress + 0.08) return false;
        if (p.role === "GK" || p.role === "CB") return false;
        return true;
      })
      .map(o => {
        const p = o.target;
        const targetProgress = team.attackingDirection === "right"
          ? p.position.x / PITCH_WIDTH
          : 1 - p.position.x / PITCH_WIDTH;
        const centrality = 1 - Math.abs(p.position.y - PITCH_HEIGHT / 2) / (PITCH_HEIGHT / 2);
        let score = o.weight + (targetProgress - carrierProgress) * 40 + centrality * 5;
        if (["CF", "SS", "AM", "LW", "RW"].includes(p.role)) score += 8;
        if (story.phase === "wide_attack" && (p.role === "LW" || p.role === "RW" || p.role === "LB" || p.role === "RB")) score += 8;
        if (story.phase === "box_entry" && inOpponentBox(p.position, team.attackingDirection)) score += 16;
        score -= p.pressure * 8;
        return { player: p, score };
      })
      .filter(o => o.score > 10)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.player ?? null;
  }

  private buildShapeLines(team: TeamState, players: Player[]): DebugShapeLine[] {
    const groups: Array<{ unit: DebugShapeLine["unit"]; roles: string[]; strictness: number }> = [
      { unit: "defense", roles: ["CB", "LB", "RB"], strictness: 0.78 },
      { unit: "midfield", roles: ["DM", "CM", "AM"], strictness: 0.56 },
      { unit: "attack", roles: ["LW", "RW", "CF", "SS"], strictness: 0.34 }
    ];

    return groups.map(group => {
      const unitPlayers = players
        .filter(p => group.roles.includes(p.role))
        .sort((a, b) => a.position.y - b.position.y);
      const points = unitPlayers.map(p => ({ ...p.position }));
      const avgX = points.length ? points.reduce((sum, p) => sum + p.x, 0) / points.length : 0;
      const maxXDrift = points.length ? Math.max(...points.map(p => Math.abs(p.x - avgX))) : 0;
      const sortedY = [...points].sort((a, b) => a.y - b.y);
      let maxGap = 0;
      for (let i = 1; i < sortedY.length; i++) {
        maxGap = Math.max(maxGap, Math.abs(sortedY[i].y - sortedY[i - 1].y));
      }
      const driftLimit = group.unit === "defense" ? 5.5 : group.unit === "midfield" ? 8.5 : 13;
      const gapLimit = group.unit === "defense" ? 17 : group.unit === "midfield" ? 21 : 29;
      const breakScore = clamp((maxXDrift / driftLimit) * 0.58 + (maxGap / gapLimit) * 0.42, 0, 2);
      const key = `${team.id}:${group.unit}`;
      const previous = this.shapeBreakHistory.get(key) ?? 0;
      const brokenTicks = breakScore > 1 ? previous + 1 : Math.max(0, previous - 2);
      this.shapeBreakHistory.set(key, brokenTicks);
      return {
        teamId: team.id,
        unit: group.unit,
        strictness: group.strictness,
        breakScore: Number(breakScore.toFixed(2)),
        brokenTicks,
        playerIds: unitPlayers.map(p => p.id),
        points
      };
    }).filter(line => line.points.length > 1);
  }

  private findClearanceTarget(carrier: Player, team: TeamState): Player | null {
    // Clear long: find furthest forward teammate
    const teammates = this.teamPlayers(team.id).filter(p => p.id !== carrier.id);
    const goal = goalCenter(team.attackingDirection);
    const candidates = teammates.filter(p => {
      const d = dist(carrier.position, p.position);
      return d > 8 && d < 50;
    });
    if (candidates.length === 0) return null;
    // Sort by closest to opponent goal
    candidates.sort((a, b) => dist(a.position, goal) - dist(b.position, goal));
    return candidates[0];
  }

  // ─── Pass evaluation ──────────────────────────────────────────────────────

  private evaluatePassOptions(
    carrier: Player,
    team: TeamState,
    teammates: Player[]
  ): Array<{ target: Player; weight: number }> {
    const s = this.state;
    const goal = goalCenter(team.attackingDirection);
    const ownGoal = ownGoalCenter(team.attackingDirection);
    const carrierDGoal = dist(carrier.position, goal);
    const options: Array<{ target: Player; weight: number }> = [];
    const streak = this.safePassStreak.get(carrier.teamId) ?? 0;
    const progressUrgency = clamp(streak / 6, 0, 1);
    const story = this.possessionStory(team);
    const memory = this.memorySummary(team);

    const ballIsLeft = carrier.position.y < PITCH_HEIGHT * 0.38;
    const ballIsRight = carrier.position.y > PITCH_HEIGHT * 0.62;

    for (const t of teammates) {
      const d = dist(carrier.position, t.position);
      if (d < 2.0 || d > 55) continue;

      const tDGoal = dist(t.position, goal);
      const isForward = tDGoal < carrierDGoal - 4;
      const isBack = tDGoal > carrierDGoal + 4;
      const isLateral = !isForward && !isBack;
      const carrierProgress = team.attackingDirection === "right"
        ? carrier.position.x / PITCH_WIDTH
        : 1 - carrier.position.x / PITCH_WIDTH;
      const targetProgress = team.attackingDirection === "right"
        ? t.position.x / PITCH_WIDTH
        : 1 - t.position.x / PITCH_WIDTH;

      // Base weights — all directions competitive
      let w = 6;
      if (isBack) w = 7;
      else if (isLateral) w = 8;
      else if (isForward) w = 7;

      // Progression urgency
      if (isForward) w += progressUrgency * 9;
      if (isBack && streak > 4) w -= 3;
      if (targetProgress > 0.52 && ["CF", "SS", "AM", "LW", "RW"].includes(t.role)) w += 5;
      if (carrierProgress > 0.45 && isForward) w += 5;
      if (carrierProgress > 0.60 && isBack) w -= 4;
      if (carrierProgress > 0.60 && (t.role === "CF" || t.role === "SS" || t.role === "AM")) w += 5;
      const carrierHasGoalPath = this.hasClearPathToGoal(carrier, team);
      if (carrierHasGoalPath && carrierDGoal < 24 && isBack) w -= 22;
      if ((team.phase === "FINAL_THIRD" || story.phase === "shot" || story.phase === "box_entry") && isBack && carrierDGoal < 28) w -= 12;
      const carrierNearGoal = carrierDGoal < 18 && Math.abs(carrier.position.y - goal.y) < 16;
      const targetNearGoal = tDGoal < 18 && Math.abs(t.position.y - goal.y) < 16;
      const trueCutback = targetNearGoal && !isBack && Math.abs(t.position.y - carrier.position.y) > 5;
      if (carrierNearGoal && isBack) w -= 28;
      if (carrierNearGoal && isLateral && !trueCutback) w -= 8;
      if (trueCutback && ["CF", "SS", "AM", "CM", "LW", "RW"].includes(t.role)) w += 14;
      if ((story.phase === "wide_attack" || story.phase === "box_entry") && inOpponentBox(t.position, team.attackingDirection)) w += 10;
      const lateralDistance = Math.abs(carrier.position.y - t.position.y);
      const likelyLofted = (d > 28 && lateralDistance > 20) || (d > 24 && (t.role === "LW" || t.role === "RW"));
      if (likelyLofted && story.phase !== "switch" && story.phase !== "wide_attack" && story.phase !== "clearance") w -= 14;
      if (likelyLofted && carrier.pressure < 0.35 && team.phase === "BUILD_UP") w -= 10;
      if (likelyLofted && streak < 4 && story.phase !== "switch") w -= 6;
      if (memory.lobSpam && likelyLofted) w -= 20;
      if (memory.recyclingLoop && isBack) w -= 12;
      if (memory.stale && isForward) w += 8;

      const pattern = this.activeFinalThirdPattern(team);
      if (pattern && carrierProgress > 0.56) {
        const targetSameSide = this.playerOnPatternSide(t, pattern.side);
        const targetWide = t.position.y < PITCH_HEIGHT * 0.24 || t.position.y > PITCH_HEIGHT * 0.76;
        const targetHalfspace = Math.abs(t.position.y - this.patternLane(pattern.side, "halfspace")) < 10;
        const targetEdge = Math.abs(t.position.y - PITCH_HEIGHT / 2) < 13 && targetProgress > 0.64 && targetProgress < 0.80;
        const targetBox = targetProgress > 0.78 && Math.abs(t.position.y - PITCH_HEIGHT / 2) < 18;
        if (pattern.name === "wide_triangle") {
          if (targetSameSide && d < 22 && ["LW", "RW", "LB", "RB", "AM", "CM"].includes(t.role)) w += 12;
          if (targetBox && ["CF", "SS"].includes(t.role)) w += 8;
        } else if (pattern.name === "overlap") {
          if (targetSameSide && targetWide && ["LB", "RB", "LW", "RW"].includes(t.role)) w += 14;
          if (targetHalfspace && ["AM", "CM", "LW", "RW"].includes(t.role)) w += 7;
        } else if (pattern.name === "underlap") {
          if (targetHalfspace && ["CM", "AM", "LB", "RB"].includes(t.role)) w += 14;
          if (targetSameSide && targetWide && ["LW", "RW"].includes(t.role)) w += 8;
        } else if (pattern.name === "half_space_slip") {
          if (targetHalfspace && ["AM", "SS", "CF"].includes(t.role) && isForward) w += 16;
          if (targetSameSide && targetWide) w += 5;
        } else if (pattern.name === "cutback") {
          if (targetEdge && ["AM", "CM", "SS"].includes(t.role)) w += 16;
          if (targetBox && ["CF", "SS"].includes(t.role)) w += 10;
        } else if (pattern.name === "far_post_cross") {
          if (!targetSameSide && targetProgress > 0.76 && ["LW", "RW", "CF", "SS"].includes(t.role)) w += 15;
          if (targetSameSide && targetWide) w += 7;
        } else if (pattern.name === "edge_shot") {
          if (targetEdge && ["AM", "CM", "SS"].includes(t.role)) w += 16;
          if (targetBox && ["CF", "SS"].includes(t.role)) w += 6;
        }
        if (isBack && carrierProgress > 0.68 && !targetEdge) w -= 6;
      }

      switch (story.phase) {
        case "recycle":
          if ((isBack || isLateral) && d < 24) w += 10;
          if (isForward && d > 22) w -= 6;
          if (t.role === "CB" || t.role === "DM" || t.role === "CM") w += 5;
          break;
        case "switch": {
          const oppositeSide = story.side === "left"
            ? t.position.y > PITCH_HEIGHT * 0.58
            : story.side === "right"
              ? t.position.y < PITCH_HEIGHT * 0.42
              : Math.abs(t.position.y - carrier.position.y) > 18;
          if (oppositeSide && d > 18) w += 10;
          if ((t.role === "LW" || t.role === "RW" || t.role === "LB" || t.role === "RB") && oppositeSide) w += 6;
          if (isBack && d < 16) w += 3;
          break;
        }
        case "central_progression":
          if (isForward && ["DM", "CM", "AM", "CF", "SS"].includes(t.role)) w += 10;
          if (Math.abs(t.position.y - PITCH_HEIGHT / 2) < 14) w += 5;
          break;
        case "wide_attack": {
          const sameSide = story.side === "left"
            ? t.position.y < PITCH_HEIGHT * 0.46
            : story.side === "right"
              ? t.position.y > PITCH_HEIGHT * 0.54
              : t.position.y < PITCH_HEIGHT * 0.24 || t.position.y > PITCH_HEIGHT * 0.76;
          if (sameSide && ["LW", "RW", "LB", "RB", "AM", "CM"].includes(t.role)) w += 12;
          if (sameSide && isForward) w += 7;
          if (!sameSide && isLateral && d > 22) w += 3;
          break;
        }
        case "counter":
          if (isForward) w += 14;
          if (["CF", "SS", "LW", "RW", "AM"].includes(t.role)) w += 8;
          if (isBack) w -= 8;
          break;
        case "box_entry":
          if (inOpponentBox(t.position, team.attackingDirection)) w += 18;
          if (isForward && ["CF", "SS", "AM", "LW", "RW"].includes(t.role)) w += 12;
          if (isBack) w -= 6;
          break;
        case "shot":
          if (isForward && dist(t.position, goal) < 20) w += 14;
          if (["CF", "SS", "AM"].includes(t.role)) w += 8;
          if (isBack) w -= 9;
          break;
        case "clearance":
          if (isForward && d > 18) w += 16;
          if (["CF", "LW", "RW"].includes(t.role)) w += 10;
          if (isBack) w -= 12;
          break;
      }

      // Distance preference (professional football is mostly <25u passes)
      if (d < 8)  w += 5;
      else if (d < 14) w += 4;
      else if (d < 22) w += 2;
      else if (d < 32) w += 0;
      else w -= 3;

      // Pressure penalty on target
      w -= t.pressure * 5;

      // Carrier pressure — quicker release preferred
      if (carrier.pressure > 0.55) {
        w += isBack ? 3 : isLateral ? 2 : 0;
      }

      // GK — only under extreme pressure
      if (t.role === "GK") {
        w = carrier.pressure > 0.75 ? 5 : 0.5;
      }

      // === Phase modifiers ===
      switch (team.phase) {
        case "BUILD_UP": {
          // ─ Patient half-pitch possession — realistic build-up patterns ─────
          // GK → CB: GK always prefers short to CBs
          if (carrier.role === "GK" && t.role === "CB") { w += 14; }
          // CB ↔ CB: spine of build-up, strongly favoured
          if (carrier.role === "CB" && t.role === "CB") { w += 12; }
          // CB → DM: progress through the pivot
          if (carrier.role === "CB" && t.role === "DM") { w += 9; }
          // CB → FB: wide outlet
          if (carrier.role === "CB" && (t.role === "LB" || t.role === "RB")) { w += 10; }
          // FB → CB: recycle back to centre
          if ((carrier.role === "LB" || carrier.role === "RB") && t.role === "CB") { w += 8; }
          // DM → CB: safety valve
          if (carrier.role === "DM" && t.role === "CB") { w += 7; }
          // DM ↔ CM: midfield recycling
          if (carrier.role === "DM" && t.role === "CM") { w += 6; }
          // No hopeful long balls from deep build-up, but allow progression once the block is drawn out.
          if (isForward && d > 20) w -= carrierProgress > 0.34 ? 2 : 8;
          if (isForward && d > 30) w -= carrierProgress > 0.42 ? 4 : 15;
          // Short back/lateral passes favoured
          if ((isBack || isLateral) && d < 20) w += 6;
          if (d < 12) w += 4; // always prefer close short pass
          break;
        }
        case "CIRCULATION": {
          // ─ Switch play — shift ball side to side ──────────────────────────
          if (ballIsLeft && (t.role === "RB" || t.role === "RW") && d > 20) w += 12;
          if (ballIsRight && (t.role === "LB" || t.role === "LW") && d > 20) w += 12;
          if (isLateral && d > 15) w += 5;
          if (isForward) w += 2;
          // Recycle options stay competitive
          if (isBack && d < 18) w += 4;
          if (carrier.role === "CB" && t.role === "CB") w += 6;
          break;
        }

        case "PROGRESSION":
          // Move ball forward aggressively
          if (isForward) w += 8;
          if (t.role === "CM" || t.role === "AM") w += 3;
          if (t.role === "LW" || t.role === "RW" || t.role === "CF") w += 4;
          if (d > 18 && isForward) w += 2; // longer progressive passes OK
          break;

        case "FINAL_THIRD":
          // Get ball to dangerous players fast
          const closeToGoal = carrierDGoal < 18;
          if (closeToGoal && isForward) w += 6;
          if (isForward) w += 8;
          if (t.role === "CF" || t.role === "SS") w += 6;
          if (t.role === "AM" || t.role === "LW" || t.role === "RW") w += 5;
          if (inOpponentBox(t.position, team.attackingDirection)) w += 12;
          if (closeToGoal && (t.role === "CF" || t.role === "SS" || t.role === "AM")) w += 3;
          if (closeToGoal && (t.role === "LW" || t.role === "RW")) w += 2;
          const inWideChannel = t.position.y < PITCH_HEIGHT * 0.24 || t.position.y > PITCH_HEIGHT * 0.76;
          const onBylineSide = team.attackingDirection === "right"
            ? carrier.position.x > PITCH_WIDTH * 0.78
            : carrier.position.x < PITCH_WIDTH * 0.22;
          const cutbackZone = onBylineSide && inWideChannel && dist(t.position, goal) < 22;
          if (cutbackZone && (t.role === "AM" || t.role === "CM" || t.role === "CF" || t.role === "SS")) w += 11;
          if (cutbackZone && (t.role === "LW" || t.role === "RW")) w += 4;
          // Half-space exploitation (inside positions between width and center)
          const halfSpaceY1 = PITCH_HEIGHT * 0.3;
          const halfSpaceY2 = PITCH_HEIGHT * 0.7;
          const inHalfSpace = t.position.y > halfSpaceY1 && t.position.y < halfSpaceY2 &&
            Math.abs(t.position.y - PITCH_HEIGHT / 2) > 5;
          if (inHalfSpace) w += 3;
          if (closeToGoal && isLateral) w += 2;
          break;

        case "DEFENSIVE_BLOCK":
          // Transition play — quick forward ball
          if (isForward && d > 15) w += 4;
          if (t.role === "CF" || t.role === "LW" || t.role === "RW") w += 3;
          break;
      }

      // === Play style modifiers ===
      switch (team.playStyle) {
        case "POSSESSION":
          if (d < 15) w += 4;
          if (d > 30) w -= 3;
          if (isBack || isLateral) w += 2;
          break;
        case "DIRECT":
          if (isForward) w += 5;
          if (d > 22) w += 3;
          if (t.role === "CF") w += 5;
          break;
        case "COUNTER":
          if (isForward && d > 20) w += 8;
          if (t.role === "CF" || t.role === "LW" || t.role === "RW") w += 5;
          break;
        case "BALANCED":
          if (isForward && d < 28) w += 3;
          break;
      }

      // Defender blocking pass lane
      const opponents = s.players.filter(p => p.teamId !== carrier.teamId && p.role !== "GK");
      for (const opp of opponents) {
        const lineD = this.distToLine(carrier.position, t.position, opp.position);
        if (lineD < 2.0) w -= 4;
        if (lineD < 1.2) w -= 5;
      }

      if (w > 0) options.push({ target: t, weight: w });
    }

    return options;
  }

  private distToLine(from: Position, to: Position, point: Position): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return dist(from, point);
    const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / len2, 0, 1);
    return dist(point, { x: from.x + t * dx, y: from.y + t * dy });
  }

  private weightedChoice<T extends { weight: number }>(opts: T[]): T | null {
    if (opts.length === 0) return null;
    const total = opts.reduce((s, o) => s + Math.max(0, o.weight), 0);
    if (total <= 0) return null;
    let r = this.random() * total;
    for (const o of opts) { r -= Math.max(0, o.weight); if (r <= 0) return o; }
    return opts[opts.length - 1];
  }

  // ─── Pass execution ───────────────────────────────────────────────────────

  private profileForPass(from: Player, to: Player, type: "PASS" | "CLEARANCE", isForwardPass: boolean): BallFlightProfile {
    const team = this.teamOf(from);
    const d = dist(from.position, to.position);
    const lateral = Math.abs(from.position.y - to.position.y);
    const wideStart = Math.abs(from.position.y - PITCH_HEIGHT / 2) > PITCH_HEIGHT * 0.25;
    const boxTarget = team ? inOpponentBox(to.position, team.attackingDirection) : false;
    const finalThirdStart = team ? inFinalThird(from.position, team.attackingDirection) : false;

    if (type === "CLEARANCE") {
      return { kind: "clearance", trajectory: "lofted", speed: 1.7, minTicks: 24, maxTicks: 76, errorScale: 1.72, interceptionRadius: 1.0, interceptionChance: 0.028, firstTouchModifier: -0.18, receiverLead: 0.7, looseChance: 0.42, apex: 7.4, hang: 1.5 };
    }

    if (finalThirdStart && wideStart && (boxTarget || lateral > 18)) {
      return { kind: "cross", trajectory: "lofted", speed: 2.05, minTicks: 16, maxTicks: 48, errorScale: 1.32, interceptionRadius: 1.25, interceptionChance: 0.055, firstTouchModifier: -0.09, receiverLead: 0.92, looseChance: 0.27, apex: 5.5, hang: 1.3 };
    }

    if (d > 28 && lateral > 20) {
      return { kind: "switch", trajectory: "lofted", speed: 1.65, minTicks: 24, maxTicks: 72, errorScale: 1.24, interceptionRadius: 1.1, interceptionChance: 0.034, firstTouchModifier: -0.07, receiverLead: 0.5, looseChance: 0.22, apex: 7.2, hang: 1.48 };
    }

    if (isForwardPass || d > 18) {
      return { kind: "driven", trajectory: "driven", speed: 2.95, minTicks: 8, maxTicks: 34, errorScale: 1.04, interceptionRadius: 1.55, interceptionChance: 0.095, firstTouchModifier: -0.04, receiverLead: 0.65, looseChance: 0.17, apex: 1.15, hang: 0.42 };
    }

    return { kind: "short", trajectory: "ground", speed: 2.55, minTicks: 6, maxTicks: 22, errorScale: 0.66, interceptionRadius: 1.85, interceptionChance: 0.12, firstTouchModifier: 0.04, receiverLead: 0.2, looseChance: 0.08, apex: 0.16, hang: 0.08 };
  }

  private throughBallProfile(): BallFlightProfile {
    return { kind: "through", trajectory: "driven", speed: 3.05, minTicks: 9, maxTicks: 34, errorScale: 1.18, interceptionRadius: 1.45, interceptionChance: 0.08, firstTouchModifier: -0.06, receiverLead: 1, looseChance: 0.28, apex: 0.9, hang: 0.34 };
  }

  private shotProfile(): BallFlightProfile {
    return { kind: "shot", trajectory: "driven", speed: 5.7, minTicks: 4, maxTicks: 14, errorScale: 1, interceptionRadius: 0, interceptionChance: 0, firstTouchModifier: 0, receiverLead: 0, looseChance: 0, apex: 0.65, hang: 0.18 };
  }

  private anticipateBall(player: Player, targetPos: Position, profile: BallFlightProfile): void {
    if (profile.receiverLead <= 0) return;
    const vx = targetPos.x - player.position.x;
    const vy = targetPos.y - player.position.y;
    const len = Math.sqrt(vx * vx + vy * vy) || 1;
    const lead = Math.min(dist(player.position, targetPos), 6 + profile.receiverLead * 5);
    player.targetPosition = {
      x: clamp(player.position.x + (vx / len) * lead, 1, PITCH_WIDTH - 1),
      y: clamp(player.position.y + (vy / len) * lead, 1, PITCH_HEIGHT - 1)
    };
  }

  private executePass(
    from: Player,
    to: Player,
    type: "PASS" | "CLEARANCE",
    isForwardPass = false,
    bypassControlBuffer = false,
    immediate = false
  ): void {
    const s = this.state;
    const team = this.teamOf(from);
    const style = team?.playStyle ?? "BALANCED";
    const d = dist(from.position, to.position);
    const profile = this.profileForPass(from, to, type, isForwardPass);
    if (type === "PASS" && !immediate) {
      this.queueKick({ kind: "pass", fromId: from.id, toId: to.id, type, forward: isForwardPass, bypassControl: bypassControlBuffer, ticks: 5 }, from);
      return;
    }
    if (team && type === "PASS" && !bypassControlBuffer && this.delayPassForControl(from, team, d, profile)) return;

    if (team && type === "PASS" && this.isOffsideAtPass(from, to, team)) {
      this.callOffside(from, to, team);
      return;
    }

    // Compute pass accuracy and apply error
    const acc = passAccuracy(d, from.pressure, from.role, style);
    const errorMag = (1 - acc) * d * 0.35 * profile.errorScale;
    const errX = this.randN() * errorMag;
    const errY = this.randN() * errorMag;

    // Target with error
    const targetPos: Position = {
      x: clamp(to.position.x + errX, 1, PITCH_WIDTH - 1),
      y: clamp(to.position.y + errY, 1, PITCH_HEIGHT - 1)
    };

    // Very inaccurate (acc < 0.62) has a chance of creating a truly loose ball (no recipient)
    const isLoose = acc < 0.62 && this.chance(profile.looseChance);
    const ticks = clamp(Math.round(d / profile.speed), profile.minTicks, profile.maxTicks);

    from.hasBall = false;
    from.lastActionTick = this.tickN;
    s.ball.carrier = null;
    s.ball.inFlight = true;
    this.looseBallChasers.clear();
    s.ball.flightProgress = 0;
    s.ball.flightStart = { ...from.position };
    s.ball.targetPosition = targetPos;
    s.ball.flightKind = profile.kind;
    s.ball.height = 0;
    s.ball.shadowStrength = 0.46;
    this.flightTotalTicks = ticks;
    this.flightRecipientId = isLoose ? null : to.id;
    this.flightProfile = profile;
    this.isShot = false;
    this.anticipateBall(to, targetPos, profile);

    // Track safe-pass streak
    const streak = this.safePassStreak.get(from.teamId) ?? 0;
    this.safePassStreak.set(from.teamId, isForwardPass ? 0 : streak + 1);
    if (team) {
      const fromProgress = this.progressOf(team, from.position);
      const toProgress = this.progressOf(team, targetPos);
      const delta = toProgress - fromProgress;
      this.recordPossessionAction(from.teamId, {
        tick: this.tickN,
        type: type === "CLEARANCE" ? "clearance" : "pass",
        kind: profile.kind,
        fromRole: from.role,
        toRole: to.role,
        from: { ...from.position },
        to: { ...targetPos },
        progressDelta: delta,
        direction: delta > 0.045 ? "forward" : delta < -0.045 ? "back" : "lateral",
        success: !isLoose
      });
    }

    this.addEvent(type, from.id, from.teamId, from.position, true);
  }

  // ─── Shot execution ───────────────────────────────────────────────────────

  private executeShot(carrier: Player, team: TeamState, immediate = false): void {
    if (!immediate) {
      this.queueKick({ kind: "shot", fromId: carrier.id, teamId: team.id, ticks: 10 }, carrier);
      return;
    }
    const s = this.state;
    const goal = goalCenter(team.attackingDirection);
    const d = dist(carrier.position, goal);
    const profile = this.shotProfile();
    const star = this.starProfile(carrier);

    // Shot accuracy degrades with distance, pressure, and angle
    const angleToGoal = Math.abs(Math.atan2(carrier.position.y - goal.y, goal.x - carrier.position.x));
    const anglePenalty = (angleToGoal / (Math.PI / 2)) * 4;
    const starComposure = star ? (star.finishing * 0.40 + star.creativity * 0.14 + star.weakFoot * 0.1) : 0;
    const distancePenalty = Math.max(0, d - 16) * 0.25 + Math.max(0, d - 25) * 0.38;
    const styleBonus = star?.style === "finesse" ? 0.82 : star?.style === "power" && d < 20 ? 0.88 : star?.style === "flair" ? 0.92 : 1;
    const spread = Math.max(
      0.65,
      (carrier.pressure * 4 + (d / 25) * 3 + distancePenalty + anglePenalty) * (1 - (starComposure + carrier.finishing * 0.36) * 0.46) * styleBonus
    );
    const curve = (star?.style === "finesse" ? 0.85 : 0.28) * (carrier.position.y < goal.y ? 1 : -1);
    const targetY = goal.y + curve + this.randN() * spread;
    const onTarget = Math.abs(targetY - goal.y) < GOAL_WIDTH / 2;

    const finalTargetY = onTarget
      ? clamp(targetY, goal.y - GOAL_WIDTH / 2 + 0.4, goal.y + GOAL_WIDTH / 2 - 0.4)
      : clamp(targetY, goal.y - GOAL_WIDTH - 4, goal.y + GOAL_WIDTH + 4);

    carrier.hasBall = false;
    carrier.lastActionTick = this.tickN;
    s.ball.carrier = null;
    s.ball.inFlight = true;
    this.looseBallChasers.clear();
    s.ball.flightProgress = 0;
    s.ball.flightStart = { ...carrier.position };
    s.ball.targetPosition = { x: goal.x, y: finalTargetY };
    s.ball.flightKind = profile.kind;
    s.ball.height = 0;
    s.ball.shadowStrength = 0.46;
    this.flightTotalTicks = clamp(Math.round(d / profile.speed), profile.minTicks, profile.maxTicks);
    this.flightRecipientId = null;
    this.flightProfile = profile;
    this.isShot = true;
    this.shotOnTarget = onTarget;
    this.shotAttackerTeamId = team.id;
    this.recordPossessionAction(team.id, {
      tick: this.tickN,
      type: "shot",
      kind: "shot",
      fromRole: carrier.role,
      from: { ...carrier.position },
      to: { x: goal.x, y: finalTargetY },
      progressDelta: Math.max(0, this.progressOf(team, goal) - this.progressOf(team, carrier.position)),
      direction: "forward",
      success: onTarget
    });

    this.addEvent("SHOT", carrier.id, carrier.teamId, carrier.position, onTarget);

    // Prime GK to dive toward ball landing
    const defTeam = this.opposing(team.id);
    if (defTeam) {
      const gkP = this.gk(defTeam.id);
      if (gkP) {
        gkP.targetPosition = { x: goal.x, y: finalTargetY };
        gkP.keeperRead = { target: { x: goal.x, y: finalTargetY }, progress: 0, committed: false };
      }
    }
  }

  private isOffsideAtPass(from: Player, to: Player, attacking: TeamState): boolean {
    if (to.teamId !== from.teamId || to.role === "GK") return false;
    const fwd = attacking.attackingDirection === "right" ? 1 : -1;
    if ((to.position.x - from.position.x) * fwd <= 0.6) return false;
    if ((to.position.x - PITCH_WIDTH / 2) * fwd <= 0) return false;
    const defenders = this.teamPlayers(this.opposing(attacking.id)?.id ?? "").filter(p => p.role !== "GK");
    if (defenders.length < 2) return false;
    const line = defenders.sort((a, b) => fwd * b.position.x - fwd * a.position.x)[1].position.x;
    return (to.position.x - line) * fwd > 0.35;
  }

  private callOffside(from: Player, to: Player, attacking: TeamState): void {
    const defending = this.opposing(attacking.id);
    if (!defending) return;
    const fwd = attacking.attackingDirection === "right" ? 1 : -1;
    const defenders = this.teamPlayers(defending.id).filter(p => p.role !== "GK").sort((a, b) => fwd * b.position.x - fwd * a.position.x);
    const defenderLine = defenders[1]?.position.x ?? PITCH_WIDTH / 2;
    const gap = Math.abs(to.position.x - defenderLine);
    this.addEvent("OFFSIDE", to.id, attacking.id, to.position, false);
    if (gap < 1.5) {
      this.varReview = { attackerLine: to.position.x, defenderLine, attackerTeamId: attacking.id, restartTeamId: defending.id, location: { ...from.position }, ticks: 42 };
      this.state.varReview = { attackerLine: to.position.x, defenderLine, attackerTeamId: attacking.id, decision: "OFFSIDE", progress: 0 };
      this.state.phase = "var";
      this.state.players.forEach(p => { p.hasBall = false; p.isDribbling = false; });
      this.state.ball.carrier = null;
      this.state.ball.inFlight = false;
      this.addEvent("VAR", null, attacking.id, to.position, false);
    } else {
      this.beginRestart("freekick", defending.id, from.position);
    }
  }

  // ── Carry / dribble execution ──────────────────────────────────────────────

  // Pause and scan: player holds position, scans field (no movement)
  private executePause(carrier: Player, team: TeamState): void {
    // Slow scan: keep moving slightly while delaying the next action
    const scanOffset = this.continuousMicroOffset(carrier, team, this.state.ball.position);
    carrier.targetPosition = {
      x: clamp(carrier.position.x + scanOffset.x * 2, 1, PITCH_WIDTH - 1),
      y: clamp(carrier.position.y + scanOffset.y * 2, 1, PITCH_HEIGHT - 1)
    };
    this.carryTimer = Math.round(this.rand(8, 18));
    this.carryTarget = { ...carrier.position };
    this.carryMode = "pause";
    // After pause expires, give fresh hold timer for decision
    this.holdTarget = holdTicks(carrier.role, carrier.pressure, team.playStyle);
  }

  // Carry sideways to change the angle and open passing lanes
  private executeCarrySideways(carrier: Player, team: TeamState): void {
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    // Move perpendicular (toward center or wide depending on position)
    const toCenterY = PITCH_HEIGHT / 2 - carrier.position.y;
    const sideDir = Math.abs(toCenterY) > 6 ? Math.sign(toCenterY) : (this.chance(0.5) ? 1 : -1);
    const moveY = sideDir * this.rand(4, 9);
    const moveX = fwd * this.rand(1, 3); // slight forward drift
    this.carryTarget = {
      x: clamp(carrier.position.x + moveX, 2, PITCH_WIDTH - 2),
      y: clamp(carrier.position.y + moveY, 2, PITCH_HEIGHT - 2)
    };
    this.carryTimer = Math.round(this.rand(10, 22));
    this.carryMode = "sideways";
    carrier.isDribbling = true;
    this.holdTarget = holdTicks(carrier.role, carrier.pressure, team.playStyle);
  }

  // Drive ball forward into space
  private executeCarryForward(carrier: Player, team: TeamState): void {
    const goal = goalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const dx = goal.x - carrier.position.x;
    const dy = (goal.y - carrier.position.y) * 0.3;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const advance = this.rand(7, 14);
    this.carryTarget = {
      x: clamp(carrier.position.x + (dx / d) * advance, 2, PITCH_WIDTH - 2),
      y: clamp(carrier.position.y + (dy / d) * advance, 2, PITCH_HEIGHT - 2)
    };
    this.carryTimer = Math.round(this.rand(12, 25));
    this.carryMode = "forward";
    carrier.isDribbling = true;
    this.holdTarget = holdTicks(carrier.role, carrier.pressure * 0.5, team.playStyle);
    this.recordPossessionAction(team.id, {
      tick: this.tickN,
      type: "carry",
      fromRole: carrier.role,
      from: { ...carrier.position },
      to: { ...this.carryTarget },
      progressDelta: this.progressOf(team, this.carryTarget) - this.progressOf(team, carrier.position),
      direction: "forward",
      success: true
    });
    this.addEvent("DRIBBLE", carrier.id, carrier.teamId, carrier.position, true);
  }

  // Dribble at a defender — risky, might succeed or be dispossessed
  private executeEliteTakeOn(carrier: Player, team: TeamState, star: StarProfile, defender?: Player): void {
    const goal = goalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const toCenter = Math.sign(PITCH_HEIGHT / 2 - carrier.position.y) || (this.chance(0.5) ? 1 : -1);
    const dGoal = dist(carrier.position, goal);
    const cutInside = carrier.role === "LW" || carrier.role === "RW" || Math.abs(carrier.position.y - goal.y) > 8;
    const burst = star.style === "explosive" || (dGoal > 17 && this.chance(0.45));
    const advance = burst ? this.rand(9, 15) : this.rand(5, 10);
    const centerMove = cutInside
      ? toCenter * (star.style === "flair" ? this.rand(6, 11) : this.rand(4, 8))
      : this.rand(-3, 3);
    const goalLean = star.style === "power" ? 0.18 : star.style === "finesse" ? 0.44 : 0.32;

    this.carryTarget = {
      x: clamp(carrier.position.x + fwd * advance, 1.5, PITCH_WIDTH - 1.5),
      y: clamp(lerp(carrier.position.y + centerMove, goal.y, goalLean), 2, PITCH_HEIGHT - 2)
    };
    this.carryTimer = Math.round(burst ? this.rand(8, 16) : this.rand(12, 22));
    this.carryMode = cutInside ? "cut_in" : burst ? "burst" : "take_on";
    carrier.isDribbling = true;
    this.holdTarget = Math.max(5, Math.round(holdTicks(carrier.role, carrier.pressure * 0.45, team.playStyle) * 0.55));
    this.recordPossessionAction(team.id, {
      tick: this.tickN,
      type: "dribble",
      fromRole: carrier.role,
      from: { ...carrier.position },
      to: { ...this.carryTarget },
      progressDelta: this.progressOf(team, this.carryTarget) - this.progressOf(team, carrier.position),
      direction: "forward",
      success: true
    });
    this.addEvent("DRIBBLE", carrier.id, carrier.teamId, carrier.position, true);
  }

  private executeDribble(carrier: Player, team: TeamState): void {
    const goal = goalCenter(team.attackingDirection);
    const dx = goal.x - carrier.position.x;
    const dy = goal.y - carrier.position.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const dribbleDefenders = this.state.players.filter(p =>
      p.teamId !== carrier.teamId && p.role !== "GK" && dist(p.position, carrier.position) < 5
    );
    const dribbleSkill = this.roleDribbleSkill(carrier);
    const dribbleAdvance = this.rand(5, 10 + dribbleSkill * 4);
    const dodgeY = dribbleDefenders[0]
      ? Math.sign(carrier.position.y - dribbleDefenders[0].position.y) * this.rand(1.5, 4.5)
      : this.rand(-2.5, 2.5);
    this.carryTarget = {
      x: clamp(carrier.position.x + (dx / d) * dribbleAdvance, 1, PITCH_WIDTH - 1),
      y: clamp(carrier.position.y + (dy / d) * dribbleAdvance * 0.30 + dodgeY, 2, PITCH_HEIGHT - 2)
    };
    this.carryTimer = Math.round(this.rand(8, 18));
    this.carryMode = dribbleDefenders.length ? "take_on" : "forward";
    carrier.isDribbling = true;
    this.holdTarget = Math.max(6, Math.round(holdTicks(carrier.role, carrier.pressure * 0.65, team.playStyle) * 0.75));
    this.recordPossessionAction(team.id, {
      tick: this.tickN,
      type: "dribble",
      fromRole: carrier.role,
      from: { ...carrier.position },
      to: { ...this.carryTarget },
      progressDelta: this.progressOf(team, this.carryTarget) - this.progressOf(team, carrier.position),
      direction: "forward",
      success: true
    });
    this.addEvent("DRIBBLE", carrier.id, carrier.teamId, carrier.position, true);
    return;
    /*
    // Dribble attempt: if defender nearby, chance of dispossession
    const nearDef = this.state.players.filter(p =>
      p.teamId !== carrier.teamId && p.role !== "GK" && dist(p.position, carrier.position) < 5
    );
    if (nearDef.length > 0 && this.chance(nearDef.length * 0.28)) {
      // Dispossessed — give ball to nearest defender
      const def = nearDef[0];
      this.giveBall(def.id);
      this.addEvent("TACKLE", def.id, def.teamId, carrier.position, true);
      return;
    }
    const advance = this.rand(6, 11);
    this.carryTarget = {
      x: clamp(carrier.position.x + (dx / d) * advance, 1, PITCH_WIDTH - 1),
      y: clamp(carrier.position.y + (dy / d) * advance * 0.35, 2, PITCH_HEIGHT - 2)
    };
    this.carryTimer = Math.round(this.rand(10, 20));
    this.carryMode = "forward";
    carrier.isDribbling = true;
    this.holdTarget = holdTicks(carrier.role, carrier.pressure, team.playStyle);
    this.recordPossessionAction(team.id, {
      tick: this.tickN,
      type: "dribble",
      fromRole: carrier.role,
      from: { ...carrier.position },
      to: { ...this.carryTarget },
      progressDelta: this.progressOf(team, this.carryTarget) - this.progressOf(team, carrier.position),
      direction: "forward",
      success: true
    });
    this.addEvent("DRIBBLE", carrier.id, carrier.teamId, carrier.position, true);
  }

  // Through ball — passes into space ahead of the runner
    */
  }

  private executeThroughBall(carrier: Player, target: Player, team: TeamState): void {
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const profile = this.throughBallProfile();
    // Pass to where the runner WILL be, not where they are
    const runAhead = this.rand(6, 12);
    const throughPos: Position = {
      x: clamp(target.position.x + fwd * runAhead, 2, PITCH_WIDTH - 2),
      y: clamp(target.position.y + this.rand(-3, 3), 2, PITCH_HEIGHT - 2)
    };
    // High inaccuracy risk
    const acc = passAccuracy(dist(carrier.position, throughPos), carrier.pressure, carrier.role, team.playStyle) * 0.80;
    const errMag = (1 - acc) * 8 * profile.errorScale;
    const errX = this.randN() * errMag;
    const errY = this.randN() * errMag;
    const finalPos: Position = {
      x: clamp(throughPos.x + errX, 1, PITCH_WIDTH - 1),
      y: clamp(throughPos.y + errY, 1, PITCH_HEIGHT - 1)
    };
    const d = dist(carrier.position, finalPos);
    const isLoose = acc < 0.60 && this.chance(profile.looseChance);

    carrier.hasBall = false;
    carrier.lastActionTick = this.tickN;
    this.state.ball.carrier = null;
    this.state.ball.inFlight = true;
    this.looseBallChasers.clear();
    this.state.ball.flightProgress = 0;
    this.state.ball.flightStart = { ...carrier.position };
    this.state.ball.targetPosition = finalPos;
    this.state.ball.flightKind = profile.kind;
    this.state.ball.height = 0;
    this.state.ball.shadowStrength = 0.46;
    this.flightTotalTicks = clamp(Math.round(d / profile.speed), profile.minTicks, profile.maxTicks);
    this.flightRecipientId = isLoose ? null : target.id;
    this.flightProfile = profile;
    this.isShot = false;
    // Target runs forward toward ball
    this.anticipateBall(target, finalPos, profile);
    this.safePassStreak.set(carrier.teamId, 0);
    this.recordPossessionAction(team.id, {
      tick: this.tickN,
      type: "pass",
      kind: "through",
      fromRole: carrier.role,
      toRole: target.role,
      from: { ...carrier.position },
      to: { ...finalPos },
      progressDelta: this.progressOf(team, finalPos) - this.progressOf(team, carrier.position),
      direction: "forward",
      success: !isLoose
    });
    this.addEvent("PASS", carrier.id, carrier.teamId, carrier.position, !isLoose);
  }

  // ─── Team phase logic ─────────────────────────────────────────────────────

  private possessionStory(team: TeamState): PossessionPlan {
    let plan = this.possessionPlans.get(team.id);
    if (!plan) {
      plan = { phase: "restart", startedTick: this.tickN, duration: 8, side: "central" };
      this.possessionPlans.set(team.id, plan);
    }
    return plan;
  }

  private activeFinalThirdPattern(team: TeamState): FinalThirdPatternState | null {
    const pattern = this.finalThirdPatterns.get(team.id);
    if (!pattern) return null;
    if (this.tickN - pattern.startedTick > pattern.duration) {
      this.finalThirdPatterns.delete(team.id);
      return null;
    }
    return pattern;
  }

  private updateFinalThirdPattern(team: TeamState, story: PossessionPlan): void {
    if (this.state.possessionTeam !== team.id || this.state.ball.inFlight || this.isLooseBallLive()) {
      this.finalThirdPatterns.delete(team.id);
      return;
    }

    const carrier = this.carrier();
    const progress = this.progressOf(team, this.state.ball.position);
    const usablePhase = story.phase === "wide_attack" || story.phase === "box_entry" || story.phase === "shot" || story.phase === "central_progression";
    if (!carrier || carrier.teamId !== team.id || !usablePhase || progress < 0.56) {
      this.finalThirdPatterns.delete(team.id);
      return;
    }

    const current = this.activeFinalThirdPattern(team);
    const side = story.side === "central"
      ? (this.state.ball.position.y < PITCH_HEIGHT / 2 ? "left" : "right")
      : story.side;
    if (current && Math.abs(this.progressOf(team, carrier.position) - progress) < 0.20) {
      current.side = side;
      return;
    }

    const wide = carrier.position.y < PITCH_HEIGHT * 0.34 || carrier.position.y > PITCH_HEIGHT * 0.66;
    const memory = this.memorySummary(team);
    const options: Array<{ name: FinalThirdPatternName; weight: number }> = [
      { name: "wide_triangle", weight: wide ? 18 : 7 },
      { name: "overlap", weight: wide ? 14 : 4 },
      { name: "underlap", weight: wide ? 10 : 8 },
      { name: "half_space_slip", weight: wide ? 8 : 15 },
      { name: "cutback", weight: progress > 0.72 ? 14 : 5 },
      { name: "far_post_cross", weight: wide && progress > 0.66 ? 12 : 3 },
      { name: "edge_shot", weight: memory.stale || memory.recyclingLoop ? 14 : 7 }
    ];
    const chosen = this.weightedChoice(options)?.name ?? "wide_triangle";
    this.finalThirdPatterns.set(team.id, {
      name: chosen,
      side,
      startedTick: this.tickN,
      duration: Math.round(this.rand(54, 96))
    });
  }

  private sideOf(pos: Position): "left" | "right" | "central" {
    if (pos.y < PITCH_HEIGHT * 0.38) return "left";
    if (pos.y > PITCH_HEIGHT * 0.62) return "right";
    return "central";
  }

  private progressOf(team: TeamState, pos: Position): number {
    return team.attackingDirection === "right" ? pos.x / PITCH_WIDTH : 1 - pos.x / PITCH_WIDTH;
  }

  private recordPossessionAction(teamId: string, action: PossessionMemoryAction): void {
    const actions = this.possessionMemory.get(teamId) ?? [];
    actions.unshift(action);
    this.possessionMemory.set(teamId, actions.slice(0, 12));
  }

  private memorySummary(team: TeamState): PossessionMemorySummary {
    const actions = this.possessionMemory.get(team.id) ?? [];
    const recent = actions.slice(0, 7);
    const recentLobs = recent.filter(a => a.kind === "switch" || a.kind === "cross" || a.kind === "clearance").length;
    const recentBackPasses = recent.filter(a => a.type === "pass" && a.direction === "back").length;
    const recentForwardPasses = recent.filter(a => a.type === "pass" && a.direction === "forward").length;
    const recentShots = recent.filter(a => a.type === "shot").length;
    const recentCarries = recent.filter(a => a.type === "carry" || a.type === "dribble").length;
    const netProgress = recent.reduce((sum, a) => sum + a.progressDelta, 0);
    return {
      recentLobs,
      recentBackPasses,
      recentForwardPasses,
      recentShots,
      recentCarries,
      netProgress,
      stale: recent.length >= 5 && netProgress < 0.08 && recentShots === 0,
      lobSpam: recentLobs >= 2,
      recyclingLoop: recentBackPasses >= 3 && recentForwardPasses <= 1
    };
  }

  private choosePossessionStory(team: TeamState): PossessionPlan {
    const s = this.state;
    const ball = s.ball;
    const carrier = this.carrier();
    const current = this.possessionStory(team);
    const age = this.tickN - current.startedTick;
    const progress = team.attackingDirection === "right"
      ? ball.position.x / PITCH_WIDTH
      : 1 - ball.position.x / PITCH_WIDTH;
    const ownH = inOwnHalf(ball.position, team.attackingDirection);
    const finalT = inFinalThird(ball.position, team.attackingDirection);
    const side = this.sideOf(ball.position);
    const streak = this.safePassStreak.get(team.id) ?? 0;
    const pressure = carrier?.teamId === team.id ? carrier.pressure : 0;
    const memory = this.memorySummary(team);

    if (s.phase === "kickoff" || s.phase === "corner" || s.phase === "goalkick") {
      return { phase: "restart", startedTick: this.tickN, duration: 12, side };
    }
    if (inOwnBox(ball.position, team.attackingDirection) && pressure > 0.38) {
      return { phase: "clearance", startedTick: this.tickN, duration: 12, side };
    }
    if (age < current.duration && current.phase !== "restart") {
      if (current.phase === "shot" && (!finalT || progress < 0.66)) {
        return { phase: "central_progression", startedTick: this.tickN, duration: 18, side };
      }
      if ((memory.stale || memory.recyclingLoop) && current.phase === "buildup") {
        return { phase: "central_progression", startedTick: this.tickN, duration: 24, side };
      }
      if ((memory.stale || memory.recyclingLoop || streak > 7) && progress > 0.42 && current.phase === "recycle") {
        return { phase: finalT ? "box_entry" : "central_progression", startedTick: this.tickN, duration: 24, side };
      }
      if (memory.lobSpam && current.phase === "switch") {
        return { phase: "central_progression", startedTick: this.tickN, duration: 22, side };
      }
      return current;
    }

    if (team.phase === "TRANSITION_ATT" || (team.playStyle === "COUNTER" && progress > 0.38 && pressure < 0.55 && this.chance(0.34))) {
      return { phase: "counter", startedTick: this.tickN, duration: Math.round(this.rand(18, 34)), side };
    }

    if (ownH) {
      if (pressure > 0.56) return { phase: "recycle", startedTick: this.tickN, duration: Math.round(this.rand(16, 28)), side };
      if (memory.stale || memory.recyclingLoop || streak > 5 || progress > 0.38) return { phase: "central_progression", startedTick: this.tickN, duration: Math.round(this.rand(22, 38)), side };
      return this.chance(0.14)
        ? { phase: "switch", startedTick: this.tickN, duration: Math.round(this.rand(20, 34)), side }
        : { phase: "buildup", startedTick: this.tickN, duration: Math.round(this.rand(24, 42)), side };
    }

    if (finalT) {
      if (progress > 0.82 && carrier && ["CF", "SS", "AM", "LW", "RW"].includes(carrier.role)) {
        return { phase: "shot", startedTick: this.tickN, duration: Math.round(this.rand(10, 18)), side };
      }
      if (side !== "central" && this.chance(0.58)) {
        return { phase: "wide_attack", startedTick: this.tickN, duration: Math.round(this.rand(22, 38)), side };
      }
      return this.chance(0.74)
        ? { phase: "box_entry", startedTick: this.tickN, duration: Math.round(this.rand(18, 30)), side }
        : { phase: "wide_attack", startedTick: this.tickN, duration: Math.round(this.rand(16, 28)), side };
    }

    if (!memory.lobSpam && streak > 9 && this.chance(0.22)) {
      return { phase: "switch", startedTick: this.tickN, duration: Math.round(this.rand(18, 32)), side };
    }
    if (side !== "central" && this.chance(0.38)) {
      return { phase: "wide_attack", startedTick: this.tickN, duration: Math.round(this.rand(20, 34)), side };
    }
    return { phase: "central_progression", startedTick: this.tickN, duration: Math.round(this.rand(20, 36)), side };
  }

  private storyToTeamPhase(story: PossessionStoryPhase): TeamPhase {
    switch (story) {
      case "buildup": return "BUILD_UP";
      case "recycle":
      case "switch":
        return "CIRCULATION";
      case "central_progression":
      case "wide_attack":
      case "counter":
      case "clearance":
        return "PROGRESSION";
      case "box_entry":
      case "shot":
        return "FINAL_THIRD";
      case "restart":
      default:
        return "SET_PIECE";
    }
  }

  private updateTeamPhases(): void {
    const s = this.state;
    if (!s.teams) return;
    for (const team of s.teams) {
      team.phaseTimer++;
      if (s.possessionTeam !== team.id) {
        team.phase = "DEFENSIVE_BLOCK";
        continue;
      }

      const previous = this.possessionStory(team);
      const next = this.choosePossessionStory(team);
      this.possessionPlans.set(team.id, next);
      const nextTeamPhase = this.storyToTeamPhase(next.phase);
      if (team.phase !== nextTeamPhase || previous.phase !== next.phase) {
        team.phaseTimer = 0;
      }
      team.phase = nextTeamPhase;
      this.updateFinalThirdPattern(team, next);
    }
  }

  // ─── Player target positions ──────────────────────────────────────────────

  private updateTacticalPlayerTargets(): void {
    const s = this.state;
    if (!s.teams) return;
    const carrier = this.carrier();
    const looseLive = this.isLooseBallLive();
    // Keep the last choice visible through its pass flight/first touch. It resets
    // on a turnover, so the debug panel always describes the active possession.
    const iqDecision = this.lastTacticalDecision;
    this.debugFrame = {
      seed: this.seed,
      scenario: this.scenario,
      intents: [],
      shapes: [],
      shapeLines: [],
      metrics: {
        tick: this.tickN,
        possessionTeam: s.possessionTeam,
        carrierId: carrier?.id ?? null,
        carrierRole: carrier?.role ?? null,
        carrierStar: carrier ? this.starProfile(carrier)?.style ?? null : null,
        iqAction: iqDecision?.kind ?? null,
        iqReason: iqDecision?.reason ?? null,
        iqScore: iqDecision ? Number(iqDecision.score.toFixed(2)) : null,
        iqTargetId: iqDecision?.target?.id ?? null,
        iqShotQuality: iqDecision ? Number(iqDecision.shotQuality.toFixed(3)) : null,
        iqPassValue: iqDecision ? Number(iqDecision.passValue.toFixed(2)) : null,
        iqCarryValue: iqDecision ? Number(iqDecision.carryValue.toFixed(2)) : null,
        iqXThreatDelta: iqDecision ? Number(iqDecision.xThreatDelta.toFixed(3)) : null,
        iqPressureRisk: iqDecision ? Number(iqDecision.pressureRisk.toFixed(3)) : null,
        iqRoleBias: iqDecision ? Number(iqDecision.roleBias.toFixed(2)) : null,
        iqPatternBias: iqDecision ? Number(iqDecision.patternBias.toFixed(2)) : null,
        ballX: Number(s.ball.position.x.toFixed(2)),
        ballY: Number(s.ball.position.y.toFixed(2)),
        looseBallChasers: this.looseBallChasers.size,
        possessionMemory: s.possessionTeam
          ? JSON.stringify(this.memorySummary(s.teams?.find(t => t.id === s.possessionTeam) ?? s.teams![0]))
          : null,
        finalThirdPattern: s.possessionTeam
          ? this.activeFinalThirdPattern(s.teams?.find(t => t.id === s.possessionTeam) ?? s.teams![0])?.name ?? null
          : null,
        finalThirdPatternSide: s.possessionTeam
          ? this.activeFinalThirdPattern(s.teams?.find(t => t.id === s.possessionTeam) ?? s.teams![0])?.side ?? null
          : null
      }
    };

    for (const team of s.teams) {
      const hasBall = s.possessionTeam === team.id;
      const ballPos = s.ball.position;
      const players = this.teamPlayers(team.id);
      const opponents = s.players.filter(p => p.teamId !== team.id);
      const shape = this.computeTeamShape(team, hasBall, ballPos);
      const danger = hasBall ? "possession" : this.defensiveDanger(team, opponents, ballPos);
      const pattern = hasBall ? this.activeFinalThirdPattern(team) : null;
      const shapeLines = this.buildShapeLines(team, players);
      this.debugFrame.shapeLines?.push(...shapeLines);
      this.debugFrame.shapes.push({
        teamId: team.id,
        defensiveLineX: shape.defensiveLineX,
        midfieldLineX: shape.midfieldLineX,
        forwardLineX: shape.forwardLineX,
        compactness: shape.compactness,
        width: shape.width,
        ballProgress: shape.ballProgress,
        pressureHeight: Number((shape.forwardLineX).toFixed(2)),
        danger: pattern ? `${danger}:${pattern.name}:${pattern.side}` : danger
      });
      const supportMap = hasBall && carrier?.teamId === team.id
        ? this.assignSupportNetwork(team, players, carrier, shape)
        : new Map<string, PlayerIntent>();
      const pressers = hasBall
        ? new Set<string>()
        : this.assignPressers(team, players.filter(p => !p.hasBall && p.role !== "GK"), ballPos);
      const threats = opponents
        .filter(p => p.role !== "GK")
        .map(p => ({ player: p, score: this.threatScore(p, team, ballPos) }))
        .sort((a, b) => b.score - a.score);
      const leadThreat = threats[0]?.player ?? null;
      const secondaryThreat = threats[1]?.player ?? null;
      const defensiveAssignments = hasBall
        ? new Map<string, DefensiveAssignment>()
        : this.assignDefensiveAssignments(team, players, opponents, shape, ballPos, pressers, threats.map(t => t.player));

      for (const player of players) {
        if (player.hasBall) continue;
        if (player.id === this.flightRecipientId) continue;
        if (this.firstTouch?.recipientId === player.id) continue;

        if (looseLive && this.looseBallChasers.has(player.id)) {
          const recoverTarget = { ...ballPos };
          this.debugFrame.intents.push({
            playerId: player.id,
            teamId: player.teamId,
            role: player.role,
            intent: "recover",
            target: recoverTarget,
            position: { ...player.position },
            pressure: Number(player.pressure.toFixed(2)),
            assignment: "loose ball recovery",
            markId: null
          });
          player.targetPosition = recoverTarget;
          continue;
        }

        if (player.role === "GK") {
          this.positionGK(player, team, ballPos, hasBall);
          continue;
        }

        const intentTarget = !hasBall && pressers.has(player.id)
          ? this.pressTarget(player, team, ballPos)
          : hasBall
            ? this.attackingIntentTarget(player, team, players, shape, ballPos, supportMap.get(player.id), carrier)
            : this.defensiveIntentTarget(player, team, shape, ballPos, leadThreat, secondaryThreat, defensiveAssignments.get(player.id));
        const orderedTarget = this.enforceLineOrder(player, shape, intentTarget.target);
        intentTarget.target = orderedTarget;
        this.debugFrame.intents.push({
          playerId: player.id,
          teamId: player.teamId,
          role: player.role,
          intent: intentTarget.intent,
          target: { ...intentTarget.target },
          position: { ...player.position },
          pressure: Number(player.pressure.toFixed(2)),
          assignment: defensiveAssignments.get(player.id)?.assignment,
          markId: defensiveAssignments.get(player.id)?.markId ?? null
        });

        const micro = this.continuousMicroOffset(player, team, intentTarget.target);
        const microScale = intentTarget.intent === "line_hold" || intentTarget.intent === "rest_defense" ? 0.45 : 1;
        player.targetPosition = {
          x: clamp(intentTarget.target.x + micro.x * microScale, 1, PITCH_WIDTH - 1),
          y: clamp(intentTarget.target.y + micro.y * microScale, 1, PITCH_HEIGHT - 1)
        };
      }
    }
    if (this.debugFrame.metrics) {
      this.debugFrame.metrics.shapeBreaks = JSON.stringify((this.debugFrame.shapeLines ?? []).map(line => ({
        teamId: line.teamId,
        unit: line.unit,
        breakScore: line.breakScore,
        brokenTicks: line.brokenTicks
      })));
    }
  }

  private computeTeamShape(team: TeamState, hasBall: boolean, ballPos: Position): TeamShape {
    const behavior = this.formationBehavior(team);
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const ownGoal = ownGoalCenter(team.attackingDirection);
    const story = this.possessionStory(team);
    const ballProgress = team.attackingDirection === "right"
      ? ballPos.x / PITCH_WIDTH
      : 1 - ballPos.x / PITCH_WIDTH;
    const defensiveBase = hasBall
      ? 28 + ballProgress * 38 * behavior.lineStep
      : (team.pressStyle === "HIGH_PRESS" ? 34 : team.pressStyle === "MID_BLOCK" ? 26 : 18) * behavior.lineStep;
    const storyDepth = hasBall
      ? story.phase === "box_entry" || story.phase === "shot" ? 8
        : story.phase === "wide_attack" || story.phase === "counter" ? 5
          : story.phase === "recycle" ? -2
            : 0
      : 0;
    const phaseDepth = hasBall && team.phase === "FINAL_THIRD" ? 4 : hasBall && team.phase === "BUILD_UP" ? -3 : 0;
    const lineDepth = phaseDepth + storyDepth;
    const defensiveLineX = clamp(ownGoal.x + fwd * (defensiveBase + lineDepth), 5, PITCH_WIDTH - 5);
    const midfieldGap = hasBall ? 16 + ballProgress * 10 * behavior.midfieldJoin : team.pressStyle === "LOW_BLOCK" ? 8.5 : 10.5;
    const frontPressBonus = !hasBall && ballProgress > 0.42 ? clamp((ballProgress - 0.42) * 22, 0, 7) : 0;
    const forwardGap = hasBall ? 22 + ballProgress * 16 * behavior.forwardPin : team.pressStyle === "HIGH_PRESS" ? 14 + frontPressBonus : 11 + frontPressBonus;

    return {
      fwd,
      ballProgress,
      ballSideShift: (ballPos.y - PITCH_HEIGHT / 2) * (hasBall ? 0.22 : 0.34),
      compactness: hasBall
        ? team.phase === "FINAL_THIRD" ? 0.46 : 0.34
        : team.pressStyle === "LOW_BLOCK" ? 0.76 : team.pressStyle === "MID_BLOCK" ? 0.66 : 0.58,
      width: hasBall
        ? team.phase === "FINAL_THIRD" ? 1.08 : team.phase === "BUILD_UP" ? 0.92 : 1
        : team.pressStyle === "LOW_BLOCK" ? 0.62 : 0.72,
      behavior,
      defensiveLineX,
      midfieldLineX: clamp(defensiveLineX + fwd * midfieldGap, 4, PITCH_WIDTH - 4),
      forwardLineX: clamp(defensiveLineX + fwd * (midfieldGap + forwardGap), 4, PITCH_WIDTH - 4)
    };
  }

  private formationBehavior(team: TeamState): FormationBehavior {
    const table: Record<string, FormationBehavior> = {
      "4-3-3": {
        restDefenseCount: 3, supportCount: 2, runnerCount: 3, pressCount: 3,
        lineStep: 1.08, fullbackPush: 0.95, wingbackPush: 0, midfieldJoin: 1.0,
        forwardPin: 1.08, widthSource: "wingers"
      },
      "4-2-3-1": {
        restDefenseCount: 4, supportCount: 2, runnerCount: 3, pressCount: 2,
        lineStep: 1.0, fullbackPush: 0.62, wingbackPush: 0, midfieldJoin: 0.78,
        forwardPin: 1.02, widthSource: "mixed"
      },
      "4-4-2": {
        restDefenseCount: 3, supportCount: 2, runnerCount: 2, pressCount: 2,
        lineStep: 1.03, fullbackPush: 0.55, wingbackPush: 0, midfieldJoin: 0.82,
        forwardPin: 1.16, widthSource: "mixed"
      },
      "3-5-2": {
        restDefenseCount: 3, supportCount: 2, runnerCount: 3, pressCount: 2,
        lineStep: 1.08, fullbackPush: 0, wingbackPush: 1.35, midfieldJoin: 0.95,
        forwardPin: 1.16, widthSource: "wingbacks"
      },
      "5-4-1": {
        restDefenseCount: 5, supportCount: 2, runnerCount: 1, pressCount: 1,
        lineStep: 0.86, fullbackPush: 0, wingbackPush: 0.55, midfieldJoin: 0.58,
        forwardPin: 0.82, widthSource: "wingbacks"
      },
      "4-5-1": {
        restDefenseCount: 4, supportCount: 3, runnerCount: 2, pressCount: 1,
        lineStep: 0.92, fullbackPush: 0.42, wingbackPush: 0, midfieldJoin: 0.72,
        forwardPin: 0.9, widthSource: "mixed"
      },
    };
    return table[team.formation] ?? table["4-3-3"];
  }

  private restDefenseRank(player: Player, team: TeamState): number {
    const role = player.role;
    const base: Record<string, number> = {
      GK: 100, CB: 90, DM: 78, LB: 58, RB: 58, CM: 46, AM: 22, LW: 12, RW: 12, CF: 4, SS: 4
    };
    let score = base[role] ?? 35;
    if (team.formation === "3-5-2" && (role === "LB" || role === "RB")) score -= 22;
    if ((team.formation === "5-4-1" || team.formation === "4-5-1") && (role === "LB" || role === "RB")) score += 16;
    if (team.formation === "4-2-3-1" && role === "DM") score += 18;
    return score;
  }

  private mustStayInRestDefense(player: Player, team: TeamState, players: Player[], shape: TeamShape): boolean {
    if (player.role === "GK") return true;
    const story = this.possessionStory(team);
    const ranked = players
      .filter(p => p.role !== "GK" && !["CF", "SS", "LW", "RW", "AM"].includes(p.role))
      .sort((a, b) => this.restDefenseRank(b, team) - this.restDefenseRank(a, team));
    const aggressivePhase = story.phase === "counter" || story.phase === "box_entry" || story.phase === "shot" || story.phase === "wide_attack";
    const count = aggressivePhase
      ? Math.max(2, shape.behavior.restDefenseCount - 2)
      : shape.ballProgress > 0.68
        ? Math.max(2, shape.behavior.restDefenseCount - 1)
        : Math.max(2, shape.behavior.restDefenseCount - 1);
    return ranked.slice(0, count).some(p => p.id === player.id);
  }

  private assignSupportNetwork(team: TeamState, players: Player[], carrier: Player, shape: TeamShape): Map<string, PlayerIntent> {
    const support = new Map<string, PlayerIntent>();
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const story = this.possessionStory(team);
    const eligible = players
      .filter(p => p.id !== carrier.id && p.role !== "GK" && !this.mustStayInRestDefense(p, team, players, shape))
      .map(p => {
        const d = dist(p.position, carrier.position);
        const ahead = fwd > 0 ? p.position.x > carrier.position.x : p.position.x < carrier.position.x;
        const central = 1 - Math.abs(p.position.y - carrier.position.y) / PITCH_HEIGHT;
        let roleBonus = ["DM", "CM", "AM", "LB", "RB"].includes(p.role) ? 8 : ["LW", "RW", "CF", "SS"].includes(p.role) ? 4 : 0;
        const sameSide = story.side === "left"
          ? p.position.y < PITCH_HEIGHT * 0.48
          : story.side === "right"
            ? p.position.y > PITCH_HEIGHT * 0.52
            : Math.abs(p.position.y - carrier.position.y) < 18;
        if (shape.behavior.widthSource === "fullbacks" && (p.role === "LB" || p.role === "RB")) roleBonus += 8;
        if (shape.behavior.widthSource === "wingbacks" && (p.role === "LB" || p.role === "RB")) roleBonus += 12;
        if (team.formation === "4-2-3-1" && p.role === "DM") roleBonus -= 5;
        if (team.formation === "4-5-1" && p.role === "CM") roleBonus += 4;
        if (story.phase === "wide_attack" && sameSide && ["LW", "RW", "LB", "RB", "AM", "CM"].includes(p.role)) roleBonus += 12;
        if (story.phase === "box_entry" && ["CF", "SS", "AM", "LW", "RW"].includes(p.role)) roleBonus += ahead ? 14 : 5;
        if (story.phase === "counter" && ahead && ["CF", "SS", "LW", "RW", "AM"].includes(p.role)) roleBonus += 16;
        if (story.phase === "switch" && !sameSide && ["LW", "RW", "LB", "RB"].includes(p.role)) roleBonus += 14;
        if (story.phase === "recycle" && ["CB", "DM", "CM"].includes(p.role)) roleBonus += 10;
        return { player: p, score: (40 - d) + central * 8 + roleBonus + (ahead ? 2 : 0) };
      })
      .sort((a, b) => b.score - a.score)
      .map(o => o.player);

    const supportCount = story.phase === "recycle"
      ? shape.behavior.supportCount + 1
      : story.phase === "box_entry" || story.phase === "counter"
        ? Math.max(1, shape.behavior.supportCount - 1)
        : shape.behavior.supportCount;
    const runnerCount = story.phase === "box_entry" || story.phase === "counter" || story.phase === "shot"
      ? shape.behavior.runnerCount + 1
      : story.phase === "recycle"
        ? Math.max(1, shape.behavior.runnerCount - 2)
        : team.phase === "FINAL_THIRD"
          ? shape.behavior.runnerCount
          : Math.max(1, shape.behavior.runnerCount - 1);

    eligible.slice(0, supportCount).forEach(p => support.set(p.id, "near_support"));
    eligible.slice(supportCount, supportCount + 2).forEach(p => support.set(p.id, "far_support"));
    eligible
      .filter(p => ["CF", "LW", "RW", "SS", "AM"].includes(p.role) && !support.has(p.id))
      .slice(0, runnerCount)
      .forEach(p => support.set(p.id, "runner"));
    return support;
  }

  private xAtProgress(team: TeamState, progress: number): number {
    const p = clamp(progress, 0.02, 0.98);
    return team.attackingDirection === "right" ? PITCH_WIDTH * p : PITCH_WIDTH * (1 - p);
  }

  private enforceAttackingOccupation(player: Player, team: TeamState, shape: TeamShape, target: Position): Position {
    const story = this.possessionStory(team);
    const role = player.role;
    const advancedStory = story.phase === "central_progression" || story.phase === "wide_attack" ||
      story.phase === "counter" || story.phase === "box_entry" || story.phase === "shot";
    if (!advancedStory || role === "GK" || role === "CB") return target;

    let minProgress = 0;
    if (["CF", "SS"].includes(role)) minProgress = story.phase === "box_entry" || story.phase === "shot" ? 0.82 : story.phase === "counter" ? 0.72 : 0.64;
    else if (role === "LW" || role === "RW") minProgress = story.phase === "wide_attack" ? 0.70 : story.phase === "box_entry" ? 0.74 : 0.58;
    else if (role === "AM") minProgress = story.phase === "box_entry" || story.phase === "shot" ? 0.68 : 0.56;
    else if (role === "CM") minProgress = story.phase === "counter" ? 0.52 : story.phase === "box_entry" || story.phase === "wide_attack" ? 0.58 : 0.50;
    else if (role === "DM") minProgress = story.phase === "box_entry" || story.phase === "shot" ? 0.52 : 0.46;
    else if (role === "LB" || role === "RB") minProgress = story.phase === "wide_attack" ? 0.60 : story.phase === "box_entry" ? 0.56 : 0.46;

    if (minProgress <= 0) return target;
    const floorX = this.xAtProgress(team, Math.max(minProgress, shape.ballProgress + (["CF", "SS", "LW", "RW", "AM"].includes(role) ? 0.06 : -0.02)));
    const x = shape.fwd > 0 ? Math.max(target.x, floorX) : Math.min(target.x, floorX);
    return { x, y: target.y };
  }

  private enforceLineOrder(player: Player, shape: TeamShape, target: Position): Position {
    const role = player.role;
    if (role === "GK" || role === "CB" || role === "LB" || role === "RB") return target;

    let minAhead = 1.5;
    if (role === "DM") minAhead = 2.5;
    else if (role === "CM") minAhead = 4.5;
    else if (role === "AM") minAhead = 7;
    else if (role === "LW" || role === "RW" || role === "CF" || role === "SS") minAhead = 9;

    const floorX = shape.defensiveLineX + shape.fwd * minAhead;
    const orderedX = shape.fwd > 0
      ? Math.max(target.x, floorX)
      : Math.min(target.x, floorX);
    return { x: orderedX, y: target.y };
  }

  private playerOnPatternSide(player: Player, side: "left" | "right"): boolean {
    return side === "left"
      ? player.basePosition.y < PITCH_HEIGHT / 2
      : player.basePosition.y > PITCH_HEIGHT / 2;
  }

  private patternLane(side: "left" | "right", lane: "touchline" | "halfspace" | "box" | "farpost" | "edge"): number {
    const top = side === "left";
    switch (lane) {
      case "touchline": return top ? PITCH_HEIGHT * 0.12 : PITCH_HEIGHT * 0.88;
      case "halfspace": return top ? PITCH_HEIGHT * 0.34 : PITCH_HEIGHT * 0.66;
      case "box": return top ? PITCH_HEIGHT * 0.44 : PITCH_HEIGHT * 0.56;
      case "farpost": return top ? PITCH_HEIGHT * 0.68 : PITCH_HEIGHT * 0.32;
      case "edge":
      default: return PITCH_HEIGHT / 2;
    }
  }

  private patternProgressTarget(team: TeamState, progress: number): number {
    return this.xAtProgress(team, progress);
  }

  private finalThirdPatternIntent(
    player: Player,
    team: TeamState,
    pattern: FinalThirdPatternState | null,
    shape: TeamShape,
    current: IntentTarget,
    carrier: Player | undefined
  ): IntentTarget {
    if (!pattern || player.role === "GK" || player.role === "CB") return current;
    if (this.mustStayInRestDefense(player, team, this.teamPlayers(team.id), shape)) return current;

    const role = player.role;
    const sameSide = this.playerOnPatternSide(player, pattern.side);
    const ballProgress = clamp(shape.ballProgress, 0.56, 0.90);
    let intent = current.intent;
    let target = { ...current.target };
    const setTarget = (progress: number, y: number, nextIntent: PlayerIntent) => {
      intent = nextIntent;
      target = {
        x: this.patternProgressTarget(team, progress),
        y
      };
    };

    if (pattern.name === "wide_triangle") {
      if ((role === "LW" || role === "RW") && sameSide) setTarget(Math.max(ballProgress + 0.04, 0.72), this.patternLane(pattern.side, "touchline"), "hold_width");
      else if ((role === "LB" || role === "RB") && sameSide) setTarget(Math.max(ballProgress - 0.03, 0.62), this.patternLane(pattern.side, "touchline"), "near_support");
      else if ((role === "AM" || role === "CM") && sameSide) setTarget(Math.max(ballProgress + 0.02, 0.68), this.patternLane(pattern.side, "halfspace"), "near_support");
      else if (role === "CF" || role === "SS") setTarget(0.84, this.patternLane(pattern.side, "box"), "runner");
      else if ((role === "LW" || role === "RW") && !sameSide) setTarget(0.82, this.patternLane(pattern.side, "farpost"), "runner");
      else if (role === "CM" || role === "DM") setTarget(0.64, this.patternLane(pattern.side, "edge"), "cover_lane");
    } else if (pattern.name === "overlap") {
      if ((role === "LB" || role === "RB") && sameSide) setTarget(Math.max(ballProgress + 0.09, 0.76), this.patternLane(pattern.side, "touchline"), "runner");
      else if ((role === "LW" || role === "RW") && sameSide) setTarget(Math.max(ballProgress + 0.02, 0.70), this.patternLane(pattern.side, "halfspace"), "near_support");
      else if (role === "AM" || (role === "CM" && sameSide)) setTarget(Math.max(ballProgress, 0.66), this.patternLane(pattern.side, "halfspace"), "far_support");
      else if (role === "CF" || role === "SS") setTarget(0.85, this.patternLane(pattern.side, "box"), "runner");
      else if ((role === "LW" || role === "RW") && !sameSide) setTarget(0.84, this.patternLane(pattern.side, "farpost"), "runner");
    } else if (pattern.name === "underlap") {
      if ((role === "LW" || role === "RW") && sameSide) setTarget(Math.max(ballProgress + 0.02, 0.72), this.patternLane(pattern.side, "touchline"), "hold_width");
      else if ((role === "LB" || role === "RB" || role === "CM") && sameSide) setTarget(Math.max(ballProgress + 0.06, 0.72), this.patternLane(pattern.side, "halfspace"), "runner");
      else if (role === "AM") setTarget(0.70, this.patternLane(pattern.side, "edge"), "near_support");
      else if (role === "CF" || role === "SS") setTarget(0.84, this.patternLane(pattern.side, "box"), "runner");
      else if ((role === "LW" || role === "RW") && !sameSide) setTarget(0.82, this.patternLane(pattern.side, "farpost"), "runner");
    } else if (pattern.name === "half_space_slip") {
      if (role === "AM" || role === "SS") setTarget(0.77, this.patternLane(pattern.side, "halfspace"), "runner");
      else if (role === "CF") setTarget(0.86, PITCH_HEIGHT / 2, "runner");
      else if (role === "LW" || role === "RW") setTarget(0.72, sameSide ? this.patternLane(pattern.side, "touchline") : this.patternLane(pattern.side, "farpost"), sameSide ? "hold_width" : "runner");
      else if (role === "CM") setTarget(0.66, this.patternLane(pattern.side, "edge"), "near_support");
      else if (role === "DM") setTarget(0.58, PITCH_HEIGHT / 2, "screen");
    } else if (pattern.name === "cutback") {
      if ((role === "LW" || role === "RW" || role === "LB" || role === "RB") && sameSide) setTarget(0.84, this.patternLane(pattern.side, "touchline"), "hold_width");
      else if (role === "CF" || role === "SS") setTarget(0.88, this.patternLane(pattern.side, "box"), "runner");
      else if (role === "AM" || role === "CM") setTarget(0.76, this.patternLane(pattern.side, "edge"), "far_support");
      else if ((role === "LW" || role === "RW") && !sameSide) setTarget(0.85, this.patternLane(pattern.side, "farpost"), "runner");
    } else if (pattern.name === "far_post_cross") {
      if ((role === "LW" || role === "RW") && sameSide) setTarget(0.80, this.patternLane(pattern.side, "touchline"), "hold_width");
      else if ((role === "LW" || role === "RW") && !sameSide) setTarget(0.88, this.patternLane(pattern.side, "farpost"), "runner");
      else if (role === "CF" || role === "SS") setTarget(0.86, this.patternLane(pattern.side, "box"), "runner");
      else if (role === "AM" || role === "CM") setTarget(0.73, this.patternLane(pattern.side, "edge"), "far_support");
      else if ((role === "LB" || role === "RB") && sameSide) setTarget(0.70, this.patternLane(pattern.side, "touchline"), "near_support");
    } else if (pattern.name === "edge_shot") {
      if (role === "AM" || role === "CM") setTarget(0.74, this.patternLane(pattern.side, "edge"), "far_support");
      else if (role === "CF" || role === "SS") setTarget(0.84, PITCH_HEIGHT / 2, "runner");
      else if (role === "LW" || role === "RW") setTarget(0.76, sameSide ? this.patternLane(pattern.side, "touchline") : this.patternLane(pattern.side, "farpost"), sameSide ? "hold_width" : "runner");
      else if (role === "DM") setTarget(0.62, PITCH_HEIGHT / 2, "screen");
    }

    if (carrier && player.id !== carrier.id && (intent === "near_support" || intent === "far_support")) {
      const minAhead = intent === "near_support" ? -4 : 2;
      const desiredX = carrier.position.x + shape.fwd * minAhead;
      target.x = shape.fwd > 0 ? Math.max(target.x, desiredX) : Math.min(target.x, desiredX);
    }

    return {
      intent,
      target: {
        x: clamp(target.x, 1.5, PITCH_WIDTH - 1.5),
        y: clamp(target.y, 1.5, PITCH_HEIGHT - 1.5)
      }
    };
  }

  private attackingIntentTarget(
    player: Player,
    team: TeamState,
    players: Player[],
    shape: TeamShape,
    ballPos: Position,
    assignedIntent: PlayerIntent | undefined,
    carrier: Player | undefined
  ): IntentTarget {
    const base = player.basePosition;
    const role = player.role;
    const story = this.possessionStory(team);
    let intent: PlayerIntent = assignedIntent ?? (["LW", "RW", "LB", "RB"].includes(role) ? "hold_width" : ["CM", "DM", "AM"].includes(role) ? "cover_lane" : "runner");
    let tx = base.x + this.attackPush(role, team.phase, team.attackingDirection, shape.ballProgress) * 0.78;
    let ty = this.shapeY(base.y, ballPos.y, shape);

    if (this.mustStayInRestDefense(player, team, players, shape)) {
      intent = "rest_defense";
      const lineOffset = role === "DM" ? shape.fwd * 5 : role === "CM" ? shape.fwd * 8 : 0;
      tx = lerp(tx, shape.defensiveLineX + lineOffset, 0.72);
      ty = this.shapeY(base.y, ballPos.y, { ...shape, compactness: role === "DM" || role === "CM" ? 0.34 : 0.22 });
    } else if (role === "CB") {
      intent = "rest_defense";
      tx = lerp(tx, shape.defensiveLineX, 0.62);
      ty = this.shapeY(base.y, ballPos.y, { ...shape, compactness: 0.22 });
    } else if (role === "LB" || role === "RB") {
      intent = team.phase === "FINAL_THIRD" ? "hold_width" : intent;
      const widePush = team.formation === "3-5-2" || team.formation === "5-4-1"
        ? shape.behavior.wingbackPush
        : shape.behavior.fullbackPush;
      tx = lerp(tx, shape.defensiveLineX + shape.fwd * (6 + 12 * widePush * shape.ballProgress), 0.52);
      ty = this.wideLaneY(player, shape, 5, PITCH_HEIGHT - 5);
    } else if (role === "DM") {
      intent = assignedIntent ?? "screen";
      tx = lerp(tx, shape.midfieldLineX - shape.fwd * 4, 0.55);
      ty = lerp(ty, ballPos.y, 0.16);
    } else if (role === "CM" || role === "AM") {
      intent = assignedIntent ?? "far_support";
      tx = lerp(tx, shape.midfieldLineX + (role === "AM" ? shape.fwd * 6 : 0), 0.48);
      ty = lerp(ty, ballPos.y, role === "AM" ? 0.22 : 0.16);
    } else if (role === "LW" || role === "RW") {
      intent = assignedIntent ?? "hold_width";
      const cutInside = shape.behavior.widthSource === "fullbacks" || shape.behavior.widthSource === "wingbacks";
      tx = lerp(tx, shape.forwardLineX - shape.fwd * (cutInside ? -1 : 1), 0.58);
      ty = cutInside
        ? lerp(this.wideLaneY(player, shape, 8, PITCH_HEIGHT - 8), PITCH_HEIGHT / 2, 0.30)
        : this.wideLaneY(player, shape, 3, PITCH_HEIGHT - 3);
    } else if (role === "CF" || role === "SS") {
      intent = assignedIntent ?? "runner";
      tx = lerp(tx, shape.forwardLineX + shape.fwd * 2, 0.68);
      ty = lerp(ty, PITCH_HEIGHT / 2 + (ballPos.y < PITCH_HEIGHT / 2 ? 5 : -5), 0.2);
    }

    if (carrier && assignedIntent === "near_support") {
      const side = player.position.y < carrier.position.y ? -1 : 1;
      tx = carrier.position.x - shape.fwd * clamp(6 + player.pressure * 5, 5, 10);
      ty = carrier.position.y + side * clamp(7 - player.pressure * 2, 4, 8);
    } else if (carrier && assignedIntent === "far_support") {
      const side = player.position.y < PITCH_HEIGHT / 2 ? -1 : 1;
      tx = carrier.position.x + shape.fwd * 5;
      ty = carrier.position.y + side * 12;
    } else if (carrier && assignedIntent === "runner") {
      const side = player.position.y < PITCH_HEIGHT / 2 ? -1 : 1;
      const runDepth = story.phase === "counter"
        ? 22
        : story.phase === "box_entry" || story.phase === "shot"
          ? 20
          : team.phase === "FINAL_THIRD" ? 18 : shape.ballProgress > 0.42 ? 14 : 10;
      tx = carrier.position.x + shape.fwd * runDepth;
      ty = lerp(player.position.y, PITCH_HEIGHT / 2 + side * (story.phase === "box_entry" || story.phase === "shot" ? 7 : 13), 0.34);
    }

    if (story.phase === "wide_attack" && story.side !== "central") {
      const sameSide = story.side === "left"
        ? player.basePosition.y < PITCH_HEIGHT / 2
        : player.basePosition.y > PITCH_HEIGHT / 2;
      if (sameSide && ["LW", "RW", "LB", "RB", "AM", "CM"].includes(role)) {
        intent = role === "LW" || role === "RW" || role === "LB" || role === "RB" ? "hold_width" : intent;
        const wideAdvance = carrier ? carrier.position.x + shape.fwd * 6 : tx;
        tx = shape.fwd > 0 ? Math.max(tx, wideAdvance) : Math.min(tx, wideAdvance);
        ty = story.side === "left" ? PITCH_HEIGHT * 0.15 : PITCH_HEIGHT * 0.85;
      } else if (["CF", "SS", "AM"].includes(role)) {
        intent = assignedIntent ?? "runner";
        tx = carrier ? carrier.position.x + shape.fwd * 14 : tx;
        ty = lerp(ty, PITCH_HEIGHT / 2, 0.42);
      }
    } else if (story.phase === "box_entry" || story.phase === "shot") {
      if (["CF", "SS", "AM", "LW", "RW"].includes(role)) {
        intent = assignedIntent ?? "runner";
        const boxX = shape.fwd > 0 ? PITCH_WIDTH - 11 : 11;
        tx = lerp(tx, boxX, role === "CF" || role === "SS" ? 0.62 : 0.36);
        ty = lerp(ty, PITCH_HEIGHT / 2 + (role === "LW" ? -7 : role === "RW" ? 7 : 0), 0.48);
      }
    } else if (story.phase === "counter" && ["CF", "SS", "LW", "RW", "AM"].includes(role)) {
      intent = assignedIntent ?? "runner";
      tx = carrier ? carrier.position.x + shape.fwd * 18 : tx + shape.fwd * 8;
      ty = lerp(ty, role === "LW" ? PITCH_HEIGHT * 0.24 : role === "RW" ? PITCH_HEIGHT * 0.76 : PITCH_HEIGHT / 2, 0.32);
    } else if (story.phase === "recycle" && ["CB", "DM", "CM"].includes(role)) {
      intent = assignedIntent ?? "near_support";
      tx = carrier ? carrier.position.x - shape.fwd * (role === "CB" ? 14 : 8) : tx;
      ty = carrier ? lerp(ty, carrier.position.y, 0.24) : ty;
    }

    if (["LW", "RW", "CF", "SS", "AM"].includes(role) && shape.ballProgress > 0.32) {
      const opponentHalfFloor = shape.fwd > 0 ? PITCH_WIDTH * 0.54 : PITCH_WIDTH * 0.46;
      tx = shape.fwd > 0 ? Math.max(tx, opponentHalfFloor) : Math.min(tx, opponentHalfFloor);
    }

    const patternIntent = this.finalThirdPatternIntent(player, team, this.activeFinalThirdPattern(team), shape, {
      intent,
      target: {
        x: clamp(tx, 1.5, PITCH_WIDTH - 1.5),
        y: clamp(ty, 1.5, PITCH_HEIGHT - 1.5)
      }
    }, carrier);
    intent = patternIntent.intent;
    tx = patternIntent.target.x;
    ty = patternIntent.target.y;

    const occupied = this.enforceAttackingOccupation(player, team, shape, {
      x: clamp(tx, 1.5, PITCH_WIDTH - 1.5),
      y: clamp(ty, 1.5, PITCH_HEIGHT - 1.5)
    });

    return {
      intent,
      target: { x: clamp(occupied.x, 1.5, PITCH_WIDTH - 1.5), y: clamp(occupied.y, 1.5, PITCH_HEIGHT - 1.5) }
    };
  }

  private defensiveIntentTarget(
    player: Player,
    team: TeamState,
    shape: TeamShape,
    ballPos: Position,
    leadThreat: Player | null,
    secondaryThreat: Player | null,
    assignment?: DefensiveAssignment
  ): IntentTarget {
    if (assignment) return { intent: assignment.intent, target: assignment.target };

    const base = player.basePosition;
    let intent: PlayerIntent = "line_hold";
    let tx = base.x;
    let ty = this.shapeY(base.y, ballPos.y, shape);

    if (player.role === "CB" || player.role === "LB" || player.role === "RB") {
      tx = shape.defensiveLineX;
      if (leadThreat || secondaryThreat) {
        const runner = player.role === "CB" ? (leadThreat ?? secondaryThreat) : secondaryThreat;
        if (runner && this.threatScore(runner, team, ballPos) > 1.15) {
          const track = clamp(1 - dist(player.position, runner.position) / 22, 0, 1);
          intent = "cover";
          tx = lerp(tx, runner.position.x - shape.fwd * 1.5, track * 0.22);
          ty = lerp(ty, runner.position.y, track * 0.28);
        }
      }
    } else if (player.role === "DM" || player.role === "CM" || player.role === "AM") {
      intent = "screen";
      tx = shape.midfieldLineX;
      if (leadThreat && dist(player.position, leadThreat.position) < 17) {
        const cover = clamp(1 - dist(player.position, leadThreat.position) / 17, 0, 1);
        intent = "cover";
        tx = lerp(tx, leadThreat.position.x - shape.fwd * 2, cover * 0.28);
        ty = lerp(ty, leadThreat.position.y, cover * 0.24);
      }
    } else {
      tx = shape.forwardLineX;
    }

    const ballSideX = team.pressStyle === "LOW_BLOCK" ? tx : lerp(tx, ballPos.x, 0.035);
    return {
      intent,
      target: { x: clamp(ballSideX, 1.5, PITCH_WIDTH - 1.5), y: clamp(ty, 1.5, PITCH_HEIGHT - 1.5) }
    };
  }

  private defensiveDanger(team: TeamState, opponents: Player[], ballPos: Position): string {
    const progress = team.attackingDirection === "right"
      ? ballPos.x / PITCH_WIDTH
      : 1 - ballPos.x / PITCH_WIDTH;
    const dangerousRun = opponents.some(p =>
      ["CF", "SS", "AM", "LW", "RW"].includes(p.role) &&
      this.threatScore(p, team, ballPos) > 1.35
    );
    if (inOwnBox(ballPos, team.attackingDirection)) return "box";
    if (progress < 0.24 || dangerousRun) return "drop";
    if (progress < 0.40) return "compact";
    return "press";
  }

  private assignDefensiveAssignments(
    team: TeamState,
    players: Player[],
    opponents: Player[],
    shape: TeamShape,
    ballPos: Position,
    pressers: Set<string>,
    threats: Player[]
  ): Map<string, DefensiveAssignment> {
    const assignments = new Map<string, DefensiveAssignment>();
    const fwd = shape.fwd;
    const danger = this.defensiveDanger(team, opponents, ballPos);
    const nonGk = players.filter(p => p.role !== "GK" && !p.hasBall);
    const mids = nonGk.filter(p => ["DM", "CM", "AM"].includes(p.role));
    const backs = nonGk.filter(p => ["CB", "LB", "RB"].includes(p.role));
    const forwards = nonGk.filter(p => ["CF", "SS", "LW", "RW"].includes(p.role));

    const coverPool = [
      ...mids,
      ...forwards,
      ...backs
    ];
    const nearestNonPresser = coverPool
      .filter(p => !pressers.has(p.id))
      .sort((a, b) => dist(a.position, ballPos) - dist(b.position, ballPos));
    const cover = nearestNonPresser[0];
    if (cover) {
      assignments.set(cover.id, {
        intent: "cover",
        assignment: "cover presser",
        markId: this.state.ball.carrier,
        target: {
          x: clamp(ballPos.x - fwd * 5.5, 1.5, PITCH_WIDTH - 1.5),
          y: clamp(ballPos.y + (ballPos.y < PITCH_HEIGHT / 2 ? 4 : -4), 1.5, PITCH_HEIGHT - 1.5)
        }
      });
    }

    const screeners = mids
      .filter(p => !assignments.has(p.id) && !pressers.has(p.id))
      .sort((a, b) => dist(a.position, ballPos) - dist(b.position, ballPos))
      .slice(0, danger === "press" ? 1 : 2);
    screeners.forEach((p, i) => {
      assignments.set(p.id, {
        intent: "screen",
        assignment: i === 0 ? "block central lane" : "screen pocket",
        markId: null,
        target: {
          x: clamp(lerp(shape.midfieldLineX, ballPos.x - fwd * 7, 0.42), 1.5, PITCH_WIDTH - 1.5),
          y: clamp(ballPos.y + (i === 0 ? 0 : ballPos.y < PITCH_HEIGHT / 2 ? 8 : -8), 1.5, PITCH_HEIGHT - 1.5)
        }
      });
    });

    const trackableThreats = threats.filter(t => ["CF", "SS", "AM", "LW", "RW"].includes(t.role)).slice(0, 4);
    for (const threat of trackableThreats) {
      const pool = threat.role === "LW" || threat.role === "RW"
        ? backs
            .filter(p => p.role === "LB" || p.role === "RB")
            .sort((a, b) => Math.abs(a.basePosition.y - threat.position.y) - Math.abs(b.basePosition.y - threat.position.y))
        : threat.role === "AM"
          ? [...mids, ...backs]
          : backs.filter(p => p.role === "CB");
      const marker = pool
        .filter(p => !assignments.has(p.id) && !pressers.has(p.id))
        .sort((a, b) =>
          (dist(a.position, threat.position) + Math.abs(a.basePosition.y - threat.position.y) * 0.35) -
          (dist(b.position, threat.position) + Math.abs(b.basePosition.y - threat.position.y) * 0.35)
        )[0];
      if (!marker) continue;
      const drop = danger === "drop" || danger === "box" ? 3.5 : 1.8;
      const rawTrackX = threat.position.x - fwd * drop;
      const maxLineStep = marker.role === "CB" ? 5.5 : 7.5;
      const disciplinedX = clamp(rawTrackX, shape.defensiveLineX - maxLineStep, shape.defensiveLineX + maxLineStep);
      assignments.set(marker.id, {
        intent: "mark",
        assignment: `track ${threat.role}`,
        markId: threat.id,
        target: {
          x: clamp(disciplinedX, 1.5, PITCH_WIDTH - 1.5),
          y: clamp(lerp(this.shapeY(marker.basePosition.y, ballPos.y, shape), threat.position.y, marker.role === "CB" ? 0.42 : 0.58), 1.5, PITCH_HEIGHT - 1.5)
        }
      });
    }

    backs
      .filter(p => !assignments.has(p.id) && !pressers.has(p.id))
      .forEach(p => {
        const lineDrop = danger === "drop" ? -fwd * 4 : danger === "press" ? fwd * 2 : 0;
        assignments.set(p.id, {
          intent: "line_hold",
          assignment: "hold back line",
          markId: null,
          target: {
            x: clamp(shape.defensiveLineX + lineDrop, 1.5, PITCH_WIDTH - 1.5),
            y: this.shapeY(p.basePosition.y, ballPos.y, { ...shape, compactness: danger === "box" ? 0.86 : shape.compactness })
          }
        });
      });

    forwards
      .filter(p => !assignments.has(p.id) && !pressers.has(p.id))
      .forEach(p => {
        assignments.set(p.id, {
          intent: "cover_lane",
          assignment: "shade outlet",
          markId: null,
          target: {
            x: clamp(shape.forwardLineX, 1.5, PITCH_WIDTH - 1.5),
            y: this.shapeY(p.basePosition.y, ballPos.y, shape)
          }
        });
      });

    return assignments;
  }

  private pressTarget(player: Player, team: TeamState, ballPos: Position): IntentTarget {
    const angleGoal = ownGoalCenter(team.attackingDirection);
    const blockLaneX = lerp(ballPos.x, angleGoal.x, 0.10);
    const blockLaneY = lerp(ballPos.y, angleGoal.y, 0.10);
    const pressAggression = team.pressStyle === "HIGH_PRESS" ? 0.70 : 0.54;
    return {
      intent: "press",
      target: {
        x: clamp(lerp(player.position.x, blockLaneX, pressAggression), 1, PITCH_WIDTH - 1),
        y: clamp(lerp(player.position.y, blockLaneY, pressAggression), 1, PITCH_HEIGHT - 1)
      }
    };
  }

  private shapeY(baseY: number, ballY: number, shape: TeamShape): number {
    const compressedBase = PITCH_HEIGHT / 2 + (baseY - PITCH_HEIGHT / 2) * shape.width;
    return clamp(lerp(compressedBase, ballY, shape.compactness * 0.34) + shape.ballSideShift, 2, PITCH_HEIGHT - 2);
  }

  private wideLaneY(player: Player, shape: TeamShape, top: number, bottom: number): number {
    const isTopSide = player.basePosition.y < PITCH_HEIGHT / 2;
    const lane = isTopSide ? PITCH_HEIGHT * 0.16 : PITCH_HEIGHT * 0.84;
    return clamp(lerp(lane, PITCH_HEIGHT / 2 + (lane - PITCH_HEIGHT / 2) * shape.width, 0.28), top, bottom);
  }

  private updatePlayerTargets(): void {
    const s = this.state;
    if (!s.teams) return;

    for (const team of s.teams) {
      const hasBall = s.possessionTeam === team.id;
      const ball = s.ball;
      const ballPos = ball.position;
      const threatTargets = this.teamPlayers(team.id)
        .filter(p => p.role !== "GK" && !p.hasBall)
        .map(p => ({ player: p, score: this.threatScore(p, team, ballPos) }))
        .sort((a, b) => b.score - a.score);
      const leadThreat = threatTargets[0]?.player ?? null;
      const secondaryThreat = threatTargets[1]?.player ?? null;

      // Lateral shift: whole team shifts slightly toward ball y
      const yPull = (ballPos.y - PITCH_HEIGHT / 2) * 0.15;

      // Forward/back shift based on ball position
      const ballProgress = team.attackingDirection === "right"
        ? ballPos.x / PITCH_WIDTH
        : 1 - ballPos.x / PITCH_WIDTH;

      // Which defenders should press (max 1-2 depending on press style)
      const defPlayers = this.teamPlayers(team.id).filter(p => !p.hasBall && p.role !== "GK");
      const pressers = hasBall
        ? new Set<string>()
        : this.assignPressers(team, defPlayers, ballPos);

      for (const player of this.teamPlayers(team.id)) {
        if (player.hasBall) continue;
        if (player.id === this.flightRecipientId) continue;
        if (this.firstTouch?.recipientId === player.id) continue;

        const base = player.basePosition;

        if (player.role === "GK") {
          this.positionGK(player, team, ballPos, hasBall);
          continue;
        }

        if (!hasBall && pressers.has(player.id)) {
          // This player is assigned to press — move toward ball
          const pressX = lerp(player.position.x, ballPos.x, 0.50);
          const pressY = lerp(player.position.y, ballPos.y, 0.50);
          player.targetPosition = {
            x: clamp(pressX, 1, PITCH_WIDTH - 1),
            y: clamp(pressY, 1, PITCH_HEIGHT - 1)
          };
          continue;
        }

        let tx: number;
        let ty: number;

        if (hasBall) {
          // ── Attacking shape ──
          const push = this.attackPush(player.role, team.phase, team.attackingDirection, ballProgress);
          tx = clamp(base.x + push, 2, PITCH_WIDTH - 2);
          ty = clamp(base.y + yPull, 2, PITCH_HEIGHT - 2);

          // CMs track ball laterally
          if (player.role === "CM" || player.role === "DM") {
            ty = lerp(ty, ballPos.y, 0.10);
          }
          // Wide players maintain width
          if (player.role === "LW") ty = clamp(ty, 2, PITCH_HEIGHT * 0.28);
          if (player.role === "RW") ty = clamp(ty, PITCH_HEIGHT * 0.72, PITCH_HEIGHT - 2);
          // FBs push forward when team in final third
          if ((player.role === "LB" || player.role === "RB") && team.phase === "FINAL_THIRD") {
            tx += team.attackingDirection === "right" ? 6 : -6;
          }

          if (team.phase === "FINAL_THIRD") {
            if (player.role === "CF" || player.role === "SS") {
              const pullAcross = ballPos.y < PITCH_HEIGHT / 2 ? 7 : -7;
              ty = clamp(lerp(ty, PITCH_HEIGHT / 2 + pullAcross, 0.22), 2, PITCH_HEIGHT - 2);
              tx = lerp(tx, ballPos.x + (team.attackingDirection === "right" ? -4 : 4), 0.08);
            }
            if (player.role === "AM") {
              tx = lerp(tx, ballPos.x + (team.attackingDirection === "right" ? -3 : 3), 0.12);
              ty = lerp(ty, ballPos.y + (ballPos.y < PITCH_HEIGHT / 2 ? 6 : -6), 0.18);
            }
            if (player.role === "LW") {
              ty = clamp(lerp(ty, Math.min(ballPos.y + 8, PITCH_HEIGHT - 4), 0.12), 2, PITCH_HEIGHT - 2);
            }
            if (player.role === "RW") {
              ty = clamp(lerp(ty, Math.max(ballPos.y - 8, 4), 0.12), 2, PITCH_HEIGHT - 2);
            }
          }

          if (leadThreat && player.id !== leadThreat.id && (player.role === "CM" || player.role === "DM" || player.role === "AM")) {
            const driftTowardThreat = clamp(dist(player.position, leadThreat.position) / 40, 0.08, 0.3);
            tx = lerp(tx, leadThreat.position.x, driftTowardThreat * 0.15);
            ty = lerp(ty, leadThreat.position.y, driftTowardThreat * 0.08);
          }
        } else {
          // ── Defensive shape — SHAPE FIRST ──
          const pull = this.defensivePull(team, ballPos);
          tx = clamp(base.x + pull, 2, PITCH_WIDTH - 2);
          ty = clamp(base.y + yPull, 2, PITCH_HEIGHT - 2);

          // Back four: maintain compact line
          if (player.role === "CB" || player.role === "LB" || player.role === "RB") {
            // Defensive line x stays tight — don't follow ball forward
            tx = clamp(tx, 2, PITCH_WIDTH * 0.55);
          }

          // Midfield line: hold 8-10u ahead of defensive line
          if (player.role === "CM" || player.role === "DM" || player.role === "AM") {
            const defLineX = this.computeDefensiveLineX(team, ballPos);
            const midLineX = team.attackingDirection === "right"
              ? defLineX + 10
              : defLineX - 10;
            tx = lerp(tx, midLineX, 0.3);
            ty = lerp(ty, ballPos.y, 0.08); // slight ball-side compact
          }

          // Loose man marking: nearby danger pulls players tighter without abandoning team shape.
          if (leadThreat && player.role !== "CB" && dist(player.position, leadThreat.position) < 18) {
            const track = clamp(1 - dist(player.position, leadThreat.position) / 18, 0, 1);
            tx = lerp(tx, leadThreat.position.x, track * 0.35);
            ty = lerp(ty, leadThreat.position.y, track * 0.22);
          } else if ((player.role === "CB" || player.role === "LB" || player.role === "RB") && secondaryThreat) {
            const danger = Math.max(
              this.threatScore(leadThreat ?? secondaryThreat, team, ballPos),
              this.threatScore(secondaryThreat, team, ballPos)
            );
            if (danger > 1.35) {
              const runner = player.role === "CB" ? (leadThreat ?? secondaryThreat) : secondaryThreat;
              if (runner) {
                const track = clamp(1 - dist(player.position, runner.position) / 22, 0, 1);
                tx = lerp(tx, runner.position.x, track * 0.24);
                ty = lerp(ty, runner.position.y, track * 0.15);
              }
            }
          }

          // Compact entire block toward ball x (not ball chasing, but shift)
          const compactX = lerp(tx, ballPos.x, 0.04);
          tx = team.pressStyle === "LOW_BLOCK" ? tx : compactX;
        }

        const micro = this.continuousMicroOffset(player, team, ballPos);
        player.targetPosition = {
          x: clamp(tx + micro.x, 1, PITCH_WIDTH - 1),
          y: clamp(ty + micro.y, 1, PITCH_HEIGHT - 1)
        };
      }
    }
  }

  // Returns which players should actively press
  private assignPressers(team: TeamState, players: Player[], ballPos: Position): Set<string> {
    const pressers = new Set<string>();
    if (team.pressStyle === "LOW_BLOCK") return pressers;
    const behavior = this.formationBehavior(team);
    const ballProgress = team.attackingDirection === "right"
      ? ballPos.x / PITCH_WIDTH
      : 1 - ballPos.x / PITCH_WIDTH;

    const eligible = players.filter(p => {
      if (team.pressStyle === "MID_BLOCK") {
        return (p.role === "CM" || p.role === "DM" || p.role === "AM" ||
          p.role === "LW" || p.role === "RW" || p.role === "CF" || p.role === "SS");
      }
      return p.role !== "CB";
    });

    const sorted = [...eligible].sort((a, b) =>
      (dist(a.position, ballPos) - this.pressRoleBonus(a.role, team)) -
      (dist(b.position, ballPos) - this.pressRoleBonus(b.role, team))
    );

    const wideTrap = ballPos.y < PITCH_HEIGHT * 0.22 || ballPos.y > PITCH_HEIGHT * 0.78;
    const maxPressers = team.pressStyle === "HIGH_PRESS"
      ? Math.min(wideTrap || ballProgress > 0.48 ? 2 : 1, behavior.pressCount)
      : ballProgress > 0.44 && wideTrap ? Math.min(2, behavior.pressCount) : 1;
    const triggerDist = team.pressStyle === "HIGH_PRESS" ? 31 : ballProgress > 0.44 ? 26 : 21;

    for (const p of sorted.slice(0, maxPressers)) {
      if (dist(p.position, ballPos) < triggerDist) {
        pressers.add(p.id);
      }
    }
    return pressers;
  }

  private pressRoleBonus(role: string, team: TeamState): number {
    const r: Record<string, number> = {
      CF: 7, SS: 7, LW: 5, RW: 5, AM: 4, CM: 2, DM: 1, LB: -2, RB: -2
    };
    let bonus = r[normalizeRole(role)] ?? 0;
    if (team.formation === "4-4-2" && role === "CF") bonus += 4;
    if (team.formation === "4-2-3-1" && (role === "CF" || role === "AM")) bonus += 4;
    if (team.formation === "3-5-2" && (role === "CF" || role === "LB" || role === "RB")) bonus += 3;
    if (team.formation === "5-4-1" && role !== "CF") bonus -= 5;
    if (team.formation === "4-5-1" && (role === "CM" || role === "DM")) bonus += 2;
    return bonus;
  }

  private threatScore(player: Player, team: TeamState, ballPos: Position): number {
    const goal = goalCenter(team.attackingDirection);
    const dGoal = dist(player.position, goal);
    const dBall = dist(player.position, ballPos);
    const inDangerZone = inOpponentBox(player.position, team.attackingDirection) ||
      inFinalThird(player.position, team.attackingDirection);
    let score = 0;
    if (inDangerZone) score += 1.2;
    score += Math.max(0, 1.2 - dGoal / 32);
    score += Math.max(0, 0.9 - dBall / 20);
    if (player.role === "CF" || player.role === "SS" || player.role === "AM") score += 0.4;
    if (player.role === "LW" || player.role === "RW") score += 0.25;
    return score;
  }

  private continuousMicroOffset(player: Player, team: TeamState, ballPos: Position): Position {
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    const tickPhase = (this.tickN * 0.05) + (player.number * 0.7);
    const stylePush = team.phase === "FINAL_THIRD" ? 1 : team.phase === "PROGRESSION" ? 0.75 : 0.55;
    const roleBiasX: Record<string, number> = {
      GK: 0, CB: 0.35, LB: 0.6, RB: 0.6, DM: 0.55,
      CM: 0.7, AM: 0.85, LW: 0.95, RW: 0.95, CF: 0.8, SS: 0.8
    };
    const roleBiasY: Record<string, number> = {
      GK: 0.25, CB: 0.45, LB: 0.55, RB: 0.55, DM: 0.6,
      CM: 0.7, AM: 0.75, LW: 0.85, RW: 0.85, CF: 0.65, SS: 0.7
    };
    const px = Math.sin(tickPhase + (player.id.length * 0.3));
    const py = Math.cos(tickPhase * 0.88 + (player.number * 0.2));
    const ballLeanX = clamp((ballPos.x - player.position.x) * 0.02, -0.9, 0.9);
    const ballLeanY = clamp((ballPos.y - player.position.y) * 0.015, -0.7, 0.7);
    return {
      x: px * roleBiasX[player.role] * stylePush + ballLeanX + fwd * 0.08,
      y: py * roleBiasY[player.role] * 0.55 + ballLeanY
    };
  }

  // Calculate where the defensive line is positioned
  private computeDefensiveLineX(team: TeamState, ballPos: Position): number {
    const ownGoal = ownGoalCenter(team.attackingDirection);
    const fwd = team.attackingDirection === "right" ? 1 : -1;

    // Defensive line position relative to own goal based on press style
    const lineOffset: Record<string, number> = {
      HIGH_PRESS: 35, MID_BLOCK: 22, LOW_BLOCK: 15
    };
    const offset = lineOffset[team.pressStyle] ?? 20;
    return ownGoal.x + offset * fwd;
  }

  private positionGK(gk: Player, team: TeamState, ballPos: Position, teamHasBall: boolean): void {
    const goal = ownGoalCenter(team.attackingDirection);
    const goalX = goal.x;
    const postY1 = goal.y - GOAL_WIDTH / 2;
    const postY2 = goal.y + GOAL_WIDTH / 2;
    const dBallGoal = dist(ballPos, goal);
    const saveState = this.gkSaves.get(gk.id);

    if (saveState) {
      if (saveState.divePhase === "holding") {
        gk.targetPosition = { ...saveState.diveTarget };
        saveState.diveProgress += 0.18;
        if (saveState.diveProgress >= 0.55) {
          saveState.divePhase = "recovering";
          saveState.diveProgress = 0;
        }
        return;
      }

      if (saveState.divePhase === "recovering") {
        const recoveryX = team.attackingDirection === "right"
          ? clamp(goalX + 1.2, goalX, goalX + 4.5)
          : clamp(goalX - 1.2, goalX - 4.5, goalX);
        const recoveryY = lerp(gk.position.y, goal.y, 0.18);
        gk.targetPosition = {
          x: recoveryX,
          y: clamp(recoveryY, postY1 + 0.3, postY2 - 0.3)
        };
        saveState.diveProgress += 0.12;
        if (saveState.diveProgress >= 1) {
          this.gkSaves.delete(gk.id);
        }
        return;
      }
    }

    if (teamHasBall) {
      // With ball: GK stays near own goal, tracks slightly
      const advance = clamp(dBallGoal * 0.04, 0, 2.5);
      const gkX = team.attackingDirection === "right" ? goalX + advance : goalX - advance;
      gk.targetPosition = {
        x: gkX,
        y: clamp(lerp(goal.y, ballPos.y, 0.12), postY1 + 0.4, postY2 - 0.4)
      };
    } else {
      // Without ball: angle-bisector positioning
      // Come off line proportional to ball distance (closer to opponent = come further out)
      const dangerBonus = inOwnBox(ballPos, team.attackingDirection) ? 1.5 : inOwnGoalArea(ballPos, team.attackingDirection) ? 2.5 : 0;
      const maxAdvance = team.pressStyle === "LOW_BLOCK" ? 2 : 4.5 + dangerBonus;
      const advance = clamp((PITCH_WIDTH * 0.5 / dBallGoal) * maxAdvance, 0, maxAdvance);

      const gkX = team.attackingDirection === "right"
        ? clamp(goalX + advance, goalX, goalX + maxAdvance)
        : clamp(goalX - advance, goalX - maxAdvance, goalX);

      // Cover the angle: GK tracks ball y but stays within posts
      const trackY = lerp(goal.y, ballPos.y, inOwnBox(ballPos, team.attackingDirection) ? 0.42 : 0.28);
      gk.targetPosition = {
        x: gkX,
        y: clamp(trackY, postY1 + 0.3, postY2 - 0.3)
      };
    }
  }

  private attackPush(role: string, phase: TeamPhase, dir: "right" | "left", ballProgress: number): number {
    const fwd = dir === "right" ? 1 : -1;
    const prog = (ballProgress - 0.4) * 5;

    const pushMap: Partial<Record<string, number>> = {
      GK: 0, CB: 0.5 + prog * 0.15, LB: 4 + prog * 0.6,
      RB: 4 + prog * 0.6, DM: 2 + prog * 0.3,
      CM: 4 + prog * 0.7, AM: 7 + prog * 0.8,
      LW: 6 + prog, RW: 6 + prog,
      CF: 10 + prog * 0.4, SS: 9 + prog * 0.4
    };

    let push = pushMap[role] ?? 5;

    if (phase === "BUILD_UP") {
      if (role === "DM" || role === "CB") push -= 3;
      if (role === "CF" || role === "LW" || role === "RW") push -= 1;
    } else if (phase === "FINAL_THIRD") {
      if (role === "LB" || role === "RB") push += 7;
      if (role === "CM") push += 5;
    }

    return push * fwd;
  }

  private defensivePull(team: TeamState, ballPos: Position): number {
    const fwd = team.attackingDirection === "right" ? 1 : -1;
    switch (team.pressStyle) {
      case "HIGH_PRESS": return 2 * fwd;
      case "MID_BLOCK":  return -5 * fwd;
      case "LOW_BLOCK":  return -14 * fwd;
      default:           return -5 * fwd;
    }
  }

  // ─── Player movement ──────────────────────────────────────────────────────

  private movePlayers(): void {
    const s = this.state;
    for (const p of s.players) {
      const spd = p.speed * Math.max(1, s.speed * 0.55);
      const dx = p.targetPosition.x - p.position.x;
      const dy = p.targetPosition.y - p.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.04) continue;

      let vel = this.playerVel.get(p.id);
      if (!vel) {
        vel = { vx: 0, vy: 0, wp: this.random() * Math.PI * 2 };
        this.playerVel.set(p.id, vel);
      }

      const desiredVx = (dx / d) * spd;
      const desiredVy = (dy / d) * spd;

      // Smooth acceleration with turning cost: harder to change direction fast
      const dotWithCurrent = vel.vx * desiredVx + vel.vy * desiredVy;
      const turning = dotWithCurrent < 0; // reversing direction
      const accel = turning
        ? 0.10  // slow turn
        : d > 8 ? 0.20 : d > 3 ? 0.32 : 0.48;

      vel.vx = lerp(vel.vx, desiredVx, accel);
      vel.vy = lerp(vel.vy, desiredVy, accel);

      // Organic perpendicular micro-wobble
      vel.wp += 0.12 + this.random() * 0.04;
      const speed2 = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
      let wobbleX = 0;
      let wobbleY = 0;
      if (!p.hasBall && speed2 > 0.02) {
        const wobbleAmt = Math.min(0.05, d * 0.010) * Math.sin(vel.wp);
        const px = -vel.vy / speed2;
        const py =  vel.vx / speed2;
        wobbleX = px * wobbleAmt;
        wobbleY = py * wobbleAmt;
      } else if (p.hasBall && p.isDribbling && speed2 > 0.02) {
        const eliteShimmy = this.carryMode === "cut_in" || this.carryMode === "take_on" || this.carryMode === "burst";
        const wobbleAmt = (eliteShimmy ? 0.16 : 0.06) * Math.sin(vel.wp * (eliteShimmy ? 1.8 : 1.1));
        const px = -vel.vy / speed2;
        const py = vel.vx / speed2;
        wobbleX = px * wobbleAmt;
        wobbleY = py * wobbleAmt;
      }

      p.position.x = clamp(p.position.x + vel.vx + wobbleX, 0.5, PITCH_WIDTH  - 0.5);
      p.position.y = clamp(p.position.y + vel.vy + wobbleY, 0.5, PITCH_HEIGHT - 0.5);

      if (p.hasBall) s.ball.position = { ...p.position };
    }
  }

  // ─── Separation ───────────────────────────────────────────────────────────

  private separatePlayers(): void {
    const MIN_SEP = 2.2;
    const players = this.state.players;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i];
          const b = players[j];
          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= MIN_SEP * MIN_SEP || d2 < 0.0001) continue;
          const d = Math.sqrt(d2);
          const overlap = (MIN_SEP - d) * 0.45;
          const nx = dx / d;
          const ny = dy / d;
          if (a.hasBall) {
            b.position.x = clamp(b.position.x + nx * overlap * 2, 0.5, PITCH_WIDTH - 0.5);
            b.position.y = clamp(b.position.y + ny * overlap * 2, 0.5, PITCH_HEIGHT - 0.5);
          } else if (b.hasBall) {
            a.position.x = clamp(a.position.x - nx * overlap * 2, 0.5, PITCH_WIDTH - 0.5);
            a.position.y = clamp(a.position.y - ny * overlap * 2, 0.5, PITCH_HEIGHT - 0.5);
          } else {
            a.position.x = clamp(a.position.x - nx * overlap, 0.5, PITCH_WIDTH - 0.5);
            a.position.y = clamp(a.position.y - ny * overlap, 0.5, PITCH_HEIGHT - 0.5);
            b.position.x = clamp(b.position.x + nx * overlap, 0.5, PITCH_WIDTH - 0.5);
            b.position.y = clamp(b.position.y + ny * overlap, 0.5, PITCH_HEIGHT - 0.5);
          }
        }
      }
    }
  }

  private updateTrail(): void {
    const ball = this.state.ball;
    ball.trail.push({ ...ball.position });
    if (ball.trail.length > 12) ball.trail.shift();
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  private addEvent(
    type: GameEvent["type"],
    playerId: string | null,
    teamId: string | null,
    pos: Position,
    success: boolean
  ): void {
    const ev: GameEvent = {
      id: this.makeId(),
      type,
      tick: this.tickN,
      playerId,
      teamId,
      position: { ...pos },
      success,
      message: this.generateCommentary(type, teamId, success)
    };
    this.state.lastEvent = ev;
    this.state.recentEvents.unshift(ev);
    if (this.state.recentEvents.length > 14) this.state.recentEvents.pop();
  }

  private generateCommentary(type: GameEvent["type"], teamId: string | null, success: boolean): string {
    const team = this.state.teams?.find(t => t.id === teamId);
    const name = team?.name ?? "The team";
    const msgs: Record<string, string[]> = {
      PASS: [
        `${name} keeping it moving.`,
        `Patient possession from ${name}.`,
        `${name} working the ball.`,
        `Neat combination from ${name}.`,
        `${name} probing for the opening.`,
        `${name} recycling patiently.`,
        `Smooth build-up play from ${name}.`,
      ],
      SHOT: success
        ? [`${name} shoot! On target!`, `Effort from ${name}!`, `${name} test the keeper!`]
        : [`${name} shoot — wide!`, `${name} try from distance.`, `Off target from ${name}.`],
      SAVE: [`Great save!`, `The goalkeeper denies ${name}.`, `Excellent stop!`],
      GOAL: [`GOAL! ${name} score!`, `${name} find the net! Brilliant!`, `${name} are ahead!`],
      TACKLE: [`${name} win possession!`, `Strong challenge from ${name}.`],
      CLEARANCE: [`${name} clear the danger.`, `Defensive clearance.`],
      CORNER: [`${name} earn a corner.`],
      DRIBBLE: [`${name} driving forward!`, `${name} taking on the defender.`],
      KICKOFF: [`${name} get us underway.`, `Kick-off!`],
      THROWIN: [`Throw-in to ${name}.`],
      FOUL: [`Foul given against ${name}.`],
      HEADER: [`Header from ${name}!`],
    };
    const pool = msgs[type] ?? [`${name} in action.`];
    return pool[Math.floor(this.random() * pool.length)];
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  setSpeed(s: number): void { this.state.speed = s; }

  getPossessionPct(): [number, number] {
    const s = this.state;
    if (!s.teams) return [50, 50];
    const evs = s.recentEvents.slice(0, 24);
    if (evs.length === 0) return [50, 50];
    const teamA = s.teams[0].id;
    const aCount = evs.filter(e => e.teamId === teamA).length;
    const pct = Math.round((aCount / evs.length) * 100);
    return [pct, 100 - pct];
  }
}
