export type Position = { x: number; y: number };

export type TeamPhase =
  | "BUILD_UP"
  | "CIRCULATION"
  | "PROGRESSION"
  | "FINAL_THIRD"
  | "TRANSITION_DEF"
  | "TRANSITION_ATT"
  | "DEFENSIVE_BLOCK"
  | "SET_PIECE";

export type PressStyle = "HIGH_PRESS" | "MID_BLOCK" | "LOW_BLOCK";
export type PlayStyle = "POSSESSION" | "DIRECT" | "COUNTER" | "BALANCED";
export type PlayerRole =
  | "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM"
  | "LW" | "RW" | "CF" | "SS";

export type Player = {
  id: string;
  teamId: string;
  role: PlayerRole;
  displayRole: string;
  number: number;
  position: Position;
  targetPosition: Position;
  basePosition: Position;
  speed: number;
  hasBall: boolean;
  isDribbling: boolean;
  stamina: number;
  pressure: number;
  lastActionTick: number;
  strength: number;
  balance: number;
  aggression: number;
  tackling: number;
  finishing: number;
  discipline: number;
  cards: 0 | 1 | 2;
  duel?: { opponentId: string; progress: number } | null;
  kickWindup?: { kind: "pass" | "shot"; progress: number } | null;
  keeperRead?: { target: Position; progress: number; committed: boolean } | null;
};

export type Ball = {
  position: Position;
  velocity: Position;
  carrier: string | null;
  trail: Position[];
  inFlight: boolean;
  targetPosition: Position | null;
  flightProgress: number;
  flightStart: Position | null;
  flightKind?: string | null;
  height?: number;
  spin?: number;
  shadowStrength?: number;
};

export type TeamState = {
  id: string;
  name: string;
  color: string;
  secondaryColor: string;
  phase: TeamPhase;
  pressStyle: PressStyle;
  playStyle: PlayStyle;
  formation: string;
  attackingDirection: "left" | "right";
  dominance: number;
  phaseTimer: number;
  momentum: number;
};

export type MatchPhase =
  | "playing" | "halftime" | "fulltime" | "kickoff"
  | "goalcelebration" | "corner" | "goalkick" | "freekick" | "penalty" | "var" | "setup";

export type MatchState = {
  clock: number;
  half: 1 | 2;
  score: [number, number];
  phase: MatchPhase;
  players: Player[];
  ball: Ball;
  teams: [TeamState, TeamState] | null;
  possessionTeam: string | null;
  lastEvent: GameEvent | null;
  recentEvents: GameEvent[];
  speed: number;
  tick: number;
  varReview?: {
    attackerLine: number;
    defenderLine: number;
    attackerTeamId: string;
    decision: "OFFSIDE" | "GOAL CONFIRMED";
    progress: number;
  } | null;
};

export type GameEvent = {
  id: string;
  type:
    | "PASS" | "SHOT" | "SAVE" | "GOAL" | "TACKLE" | "CLEARANCE"
    | "CORNER" | "THROWIN" | "FOUL" | "FREEKICK" | "PENALTY" | "HEADER" | "DRIBBLE" | "KICKOFF"
    | "OFFSIDE" | "VAR" | "YELLOW_CARD" | "RED_CARD" | "CATCH" | "REBOUND" | "DUEL";
  tick: number;
  playerId: string | null;
  teamId: string | null;
  position: Position;
  success: boolean;
  message?: string;
};

export type DebugPlayerIntent = {
  playerId: string;
  teamId?: string;
  role?: string;
  intent: string;
  target: Position;
  position?: Position;
  pressure?: number;
  assignment?: string;
  markId?: string | null;
};

export type DebugTeamShape = {
  teamId: string;
  defensiveLineX: number;
  midfieldLineX: number;
  forwardLineX: number;
  compactness: number;
  width: number;
  ballProgress: number;
  pressureHeight?: number;
  danger?: string;
};

export type DebugShapeLine = {
  teamId: string;
  unit: "defense" | "midfield" | "attack";
  strictness: number;
  breakScore: number;
  brokenTicks: number;
  playerIds: string[];
  points: Position[];
};

export type DebugFrame = {
  seed: number | null;
  scenario: string;
  intents: DebugPlayerIntent[];
  shapes: DebugTeamShape[];
  shapeLines?: DebugShapeLine[];
  metrics?: Record<string, number | string | null>;
};
