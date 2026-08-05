import {
  PITCH_WIDTH, PITCH_HEIGHT,
  GOAL_WIDTH, PENALTY_BOX_WIDTH, PENALTY_BOX_HEIGHT,
  GOAL_AREA_WIDTH, GOAL_AREA_HEIGHT,
  CENTER_CIRCLE_RADIUS, PENALTY_SPOT_DIST
} from "../engine/pitch";

export type Cam = {
  offsetX: number;
  offsetY: number;
  zoom: number;
  pitchW: number;
  pitchH: number;
};

export function pitchToCanvas(px: number, py: number, cam: Cam): [number, number] {
  return [px * cam.zoom + cam.offsetX, py * cam.zoom + cam.offsetY];
}

export function scale(units: number, cam: Cam): number {
  return units * cam.zoom;
}

export function computeCam(canvasW: number, canvasH: number): Cam {
  const availableW = Math.min(canvasW * 0.58, 1120);
  const availableH = Math.min(canvasH * 0.58, 690);
  const zx = availableW / PITCH_WIDTH;
  const zy = availableH / PITCH_HEIGHT;
  const zoom = Math.min(zx, zy);
  const pitchW = PITCH_WIDTH * zoom;
  const pitchH = PITCH_HEIGHT * zoom;
  return {
    zoom,
    offsetX: (canvasW - pitchW) / 2,
    offsetY: Math.max(145, (canvasH - pitchH) / 2 + 18),
    pitchW,
    pitchH
  };
}

export function drawPitch(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  cam: Cam
): void {
  ctx.save();

  // ── Background ──────────────────────────────────────────────────────────
  ctx.fillStyle = "#07120b";
  ctx.fillRect(0, 0, cw, ch);

  const bg = ctx.createLinearGradient(0, 0, cw, ch);
  bg.addColorStop(0, "rgba(23, 58, 34, 0.35)");
  bg.addColorStop(0.45, "rgba(8, 22, 13, 0.18)");
  bg.addColorStop(1, "rgba(10, 30, 18, 0.42)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  // ── Grass base ──────────────────────────────────────────────────────────
  const [px0, py0] = pitchToCanvas(0, 0, cam);
  const [px1, py1] = pitchToCanvas(PITCH_WIDTH, PITCH_HEIGHT, cam);
  const pitchW = px1 - px0;
  const pitchH = py1 - py0;

  ctx.shadowColor = "rgba(0,0,0,0.42)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#0b1d12";
  ctx.fillRect(px0 - 10, py0 - 10, pitchW + 20, pitchH + 20);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const grass = ctx.createLinearGradient(px0, py0, px1, py1);
  grass.addColorStop(0, "#1f7a3d");
  grass.addColorStop(0.5, "#186935");
  grass.addColorStop(1, "#13552b");
  ctx.fillStyle = grass;
  ctx.fillRect(px0, py0, pitchW, pitchH);

  // ── Alternating stripes ─────────────────────────────────────────────────
  const stripes = 12;
  const stripeW = pitchW / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0
      ? "rgba(0,0,0,0.11)"
      : "rgba(255,255,255,0.035)";
    ctx.fillRect(px0 + i * stripeW, py0, stripeW, pitchH);
  }

  for (let i = 0; i < 9; i++) {
    const x = px0 + (pitchW / 8) * i;
    ctx.strokeStyle = "rgba(255,255,255,0.02)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, py0);
    ctx.lineTo(x, py1);
    ctx.stroke();
  }

  // ── Line style ──────────────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(245,250,245,0.72)";
  ctx.lineWidth = Math.max(1, scale(0.16, cam));

  // ── Pitch outline ────────────────────────────────────────────────────────
  ctx.strokeRect(px0, py0, pitchW, pitchH);

  // ── Halfway line ─────────────────────────────────────────────────────────
  const [hx] = pitchToCanvas(PITCH_WIDTH / 2, 0, cam);
  ctx.beginPath();
  ctx.moveTo(hx, py0);
  ctx.lineTo(hx, py1);
  ctx.stroke();

  // ── Center circle ─────────────────────────────────────────────────────────
  const [cx, cy] = pitchToCanvas(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, cam);
  ctx.beginPath();
  ctx.arc(cx, cy, scale(CENTER_CIRCLE_RADIUS, cam), 0, Math.PI * 2);
  ctx.stroke();

  // ── Center spot ──────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(245,250,245,0.72)";
  ctx.beginPath();
  ctx.arc(cx, cy, scale(0.45, cam), 0, Math.PI * 2);
  ctx.fill();

  // ── Penalty boxes ─────────────────────────────────────────────────────────
  const boxYTop = (PITCH_HEIGHT - PENALTY_BOX_HEIGHT) / 2;
  const boxYBot = boxYTop + PENALTY_BOX_HEIGHT;
  const [lboxX0] = pitchToCanvas(0, boxYTop, cam);
  const [lboxX1, lboxY0] = pitchToCanvas(PENALTY_BOX_WIDTH, boxYTop, cam);
  const [, lboxY1] = pitchToCanvas(PENALTY_BOX_WIDTH, boxYBot, cam);
  const boxH = lboxY1 - lboxY0;

  // Left penalty box
  ctx.strokeRect(px0, lboxY0, lboxX1 - px0, boxH);

  // Right penalty box
  const [rboxX0] = pitchToCanvas(PITCH_WIDTH - PENALTY_BOX_WIDTH, boxYTop, cam);
  ctx.strokeRect(rboxX0, lboxY0, px1 - rboxX0, boxH);

  // ── Goal areas ────────────────────────────────────────────────────────────
  const gaYTop = (PITCH_HEIGHT - GOAL_AREA_HEIGHT) / 2;
  const gaYBot = gaYTop + GOAL_AREA_HEIGHT;
  const [, gaY0] = pitchToCanvas(0, gaYTop, cam);
  const [lgaX1] = pitchToCanvas(GOAL_AREA_WIDTH, gaYTop, cam);
  const [, gaY1] = pitchToCanvas(0, gaYBot, cam);
  const gaH = gaY1 - gaY0;

  // Left goal area
  ctx.strokeRect(px0, gaY0, lgaX1 - px0, gaH);

  // Right goal area
  const [rgaX0] = pitchToCanvas(PITCH_WIDTH - GOAL_AREA_WIDTH, gaYTop, cam);
  ctx.strokeRect(rgaX0, gaY0, px1 - rgaX0, gaH);

  // ── Penalty spots ─────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(220,235,255,0.42)";
  const [lpsx, lpsy] = pitchToCanvas(PENALTY_SPOT_DIST, PITCH_HEIGHT / 2, cam);
  ctx.beginPath();
  ctx.arc(lpsx, lpsy, scale(0.45, cam), 0, Math.PI * 2);
  ctx.fill();

  const [rpsx, rpsy] = pitchToCanvas(PITCH_WIDTH - PENALTY_SPOT_DIST, PITCH_HEIGHT / 2, cam);
  ctx.beginPath();
  ctx.arc(rpsx, rpsy, scale(0.45, cam), 0, Math.PI * 2);
  ctx.fill();

  // ── Penalty arcs ─────────────────────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.rect(lboxX1, py0, pitchW, pitchH);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(lpsx, lpsy, scale(9.15, cam), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(px0, py0, rboxX0 - px0, pitchH);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(rpsx, rpsy, scale(9.15, cam), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // ── Goals ─────────────────────────────────────────────────────────────────
  const goalYTop = (PITCH_HEIGHT - GOAL_WIDTH) / 2;
  const goalYBot = goalYTop + GOAL_WIDTH;
  const [, gY0] = pitchToCanvas(0, goalYTop, cam);
  const [, gY1] = pitchToCanvas(0, goalYBot, cam);
  const goalH = gY1 - gY0;
  const goalDepth = scale(2.44, cam);

  ctx.strokeStyle = "rgba(245,250,245,0.68)";
  ctx.lineWidth = Math.max(1, scale(0.16, cam));

  // Left goal (extends to the left of pitch)
  ctx.strokeRect(px0 - goalDepth, gY0, goalDepth, goalH);
  // Goal back fill
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  ctx.fillRect(px0 - goalDepth, gY0, goalDepth, goalH);

  // Right goal
  ctx.strokeRect(px1, gY0, goalDepth, goalH);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  ctx.fillRect(px1, gY0, goalDepth, goalH);

  // ── Corner arcs ───────────────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(245,250,245,0.68)";
  ctx.lineWidth = Math.max(1, scale(0.16, cam));
  const cornerR = scale(1, cam);
  const corners: [number, number, number, number][] = [
    [0, 0, 0, Math.PI / 2],
    [PITCH_WIDTH, 0, Math.PI / 2, Math.PI],
    [0, PITCH_HEIGHT, -Math.PI / 2, 0],
    [PITCH_WIDTH, PITCH_HEIGHT, Math.PI, 3 * Math.PI / 2]
  ];
  for (const [px, py, a0, a1] of corners) {
    const [ccx, ccy] = pitchToCanvas(px, py, cam);
    ctx.beginPath();
    ctx.arc(ccx, ccy, cornerR, a0, a1);
    ctx.stroke();
  }

  // ── Vignette ──────────────────────────────────────────────────────────────
  const vg = ctx.createRadialGradient(
    cw / 2, ch / 2, Math.min(cw, ch) * 0.25,
    cw / 2, ch / 2, Math.max(cw, ch) * 0.8
  );
  vg.addColorStop(0, "transparent");
  vg.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, cw, ch);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(px0 - 10, py0 - 10, pitchW + 20, pitchH + 20);

  ctx.restore();
}
