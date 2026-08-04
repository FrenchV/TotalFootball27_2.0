export const PITCH_WIDTH = 105;
export const PITCH_HEIGHT = 68;

export const GOAL_WIDTH = 7.32;
export const GOAL_DEPTH = 2;
export const PENALTY_BOX_WIDTH = 16.5;
export const PENALTY_BOX_HEIGHT = 40.32;
export const GOAL_AREA_WIDTH = 5.5;
export const GOAL_AREA_HEIGHT = 18.32;
export const CENTER_CIRCLE_RADIUS = 9.15;
export const PENALTY_SPOT_DIST = 11;

export const LEFT_GOAL_CENTER = { x: 0, y: PITCH_HEIGHT / 2 };
export const RIGHT_GOAL_CENTER = { x: PITCH_WIDTH, y: PITCH_HEIGHT / 2 };

export function isInsidePitch(x: number, y: number) {
  return x >= 0 && x <= PITCH_WIDTH && y >= 0 && y <= PITCH_HEIGHT;
}

export function distance(p1: { x: number, y: number }, p2: { x: number, y: number }) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}
