import { PlayerRole } from './types';

export type FormationPosition = {
  role: PlayerRole;
  x: number; // 0 to 1 relative to own half/pitch
  y: number; // 0 to 1 relative to width
};

export const FORMATIONS: Record<string, FormationPosition[]> = {
  "4-3-3": [
    { role: "GK", x: 0.05, y: 0.5 },
    { role: "LCB", x: 0.22, y: 0.35 },
    { role: "RCB", x: 0.22, y: 0.65 },
    { role: "LB", x: 0.18, y: 0.15 },
    { role: "RB", x: 0.18, y: 0.85 },
    { role: "CM", x: 0.45, y: 0.3 },
    { role: "DM", x: 0.38, y: 0.5 },
    { role: "CM", x: 0.45, y: 0.7 },
    { role: "LW", x: 0.7, y: 0.15 },
    { role: "RW", x: 0.7, y: 0.85 },
    { role: "CF", x: 0.8, y: 0.5 },
  ],
  "4-2-3-1": [
    { role: "GK", x: 0.05, y: 0.5 },
    { role: "LCB", x: 0.22, y: 0.35 },
    { role: "RCB", x: 0.22, y: 0.65 },
    { role: "LB", x: 0.18, y: 0.15 },
    { role: "RB", x: 0.18, y: 0.85 },
    { role: "DM", x: 0.38, y: 0.35 },
    { role: "DM", x: 0.38, y: 0.65 },
    { role: "LW", x: 0.65, y: 0.15 },
    { role: "AM", x: 0.65, y: 0.5 },
    { role: "RW", x: 0.65, y: 0.85 },
    { role: "CF", x: 0.85, y: 0.5 },
  ],
  "4-4-2": [
    { role: "GK", x: 0.05, y: 0.5 },
    { role: "LCB", x: 0.22, y: 0.35 },
    { role: "RCB", x: 0.22, y: 0.65 },
    { role: "LB", x: 0.18, y: 0.15 },
    { role: "RB", x: 0.18, y: 0.85 },
    { role: "LM", x: 0.45, y: 0.15 },
    { role: "CM", x: 0.45, y: 0.35 },
    { role: "CM", x: 0.45, y: 0.65 },
    { role: "RM", x: 0.45, y: 0.85 },
    { role: "CF", x: 0.75, y: 0.4 },
    { role: "CF", x: 0.75, y: 0.6 },
  ],
  "3-5-2": [
    { role: "GK", x: 0.05, y: 0.5 },
    { role: "LCB", x: 0.2, y: 0.3 },
    { role: "CB", x: 0.18, y: 0.5 },
    { role: "RCB", x: 0.2, y: 0.7 },
    { role: "LWB", x: 0.35, y: 0.1 },
    { role: "CM", x: 0.4, y: 0.35 },
    { role: "DM", x: 0.35, y: 0.5 },
    { role: "CM", x: 0.4, y: 0.65 },
    { role: "RWB", x: 0.35, y: 0.9 },
    { role: "CF", x: 0.75, y: 0.4 },
    { role: "CF", x: 0.75, y: 0.6 },
  ],
  "5-4-1": [
    { role: "GK", x: 0.05, y: 0.5 },
    { role: "LWB", x: 0.18, y: 0.1 },
    { role: "LCB", x: 0.15, y: 0.3 },
    { role: "CB", x: 0.12, y: 0.5 },
    { role: "RCB", x: 0.15, y: 0.7 },
    { role: "RWB", x: 0.18, y: 0.9 },
    { role: "LM", x: 0.35, y: 0.2 },
    { role: "CM", x: 0.35, y: 0.4 },
    { role: "CM", x: 0.35, y: 0.6 },
    { role: "RM", x: 0.35, y: 0.8 },
    { role: "CF", x: 0.7, y: 0.5 },
  ],
  "4-5-1": [
    { role: "GK", x: 0.05, y: 0.5 },
    { role: "LCB", x: 0.2, y: 0.35 },
    { role: "RCB", x: 0.2, y: 0.65 },
    { role: "LB", x: 0.18, y: 0.15 },
    { role: "RB", x: 0.18, y: 0.85 },
    { role: "LM", x: 0.45, y: 0.15 },
    { role: "CM", x: 0.4, y: 0.35 },
    { role: "DM", x: 0.35, y: 0.5 },
    { role: "CM", x: 0.4, y: 0.65 },
    { role: "RM", x: 0.45, y: 0.85 },
    { role: "CF", x: 0.75, y: 0.5 },
  ]
} as unknown as Record<string, FormationPosition[]>;
