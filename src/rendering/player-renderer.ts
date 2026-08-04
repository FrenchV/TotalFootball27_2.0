import { DebugFrame, Player, TeamState } from "../engine/types";
import { Cam, pitchToCanvas, scale } from "./pitch-renderer";

function dotColor(team: TeamState): string {
  const c = team.color.toLowerCase();
  if (c === "#ffffff" || c === "#dddddd" || c === "#c8102e") return "#e9eef8";
  return team.color;
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  team: TeamState,
  cam: Cam,
  _cw: number,
  _ch: number,
  tick: number
): void {
  const [cx, cy] = pitchToCanvas(player.position.x, player.position.y, cam);
  const r = Math.max(3.4, scale(0.5, cam));

  if (player.hasBall) {
    const pulse = 0.72 + 0.28 * Math.sin(tick * 0.16);
    const glowR = r + Math.max(5, scale(0.75, cam)) * pulse;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, glowR);
    glow.addColorStop(0, `rgba(116, 196, 255, ${0.32 * pulse})`);
    glow.addColorStop(1, "rgba(116, 196, 255, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(142, 215, 255, ${0.7 * pulse})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  if (player.duel) {
    const pulse = 0.55 + 0.45 * Math.sin(tick * 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6 + pulse * 2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 205, 92, ${0.5 + pulse * 0.35})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (player.kickWindup) {
    const phase = player.kickWindup.progress;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * phase);
    ctx.strokeStyle = player.kickWindup.kind === "shot" ? "rgba(255, 128, 92, 0.95)" : "rgba(142, 215, 255, 0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(cx + 1.2, cy + 2.2);
  ctx.scale(1, 0.35);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.36)";
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = dotColor(team);
  ctx.fill();

  const highlight = ctx.createRadialGradient(
    cx - r * 0.35, cy - r * 0.35, 0,
    cx, cy, r
  );
  highlight.addColorStop(0, "rgba(255,255,255,0.46)");
  highlight.addColorStop(0.55, "rgba(255,255,255,0.04)");
  highlight.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = highlight;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = player.hasBall ? "rgba(155,225,255,0.96)" : "rgba(255,255,255,0.72)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (player.cards > 0) {
    ctx.fillStyle = player.cards > 1 ? "#dc3545" : "#f3c84b";
    ctx.fillRect(cx + r * 0.55, cy - r - 4, 3.5, 5.5);
  }

  if (player.keeperRead) {
    const dx = player.keeperRead.target.x - player.position.x;
    const dy = player.keeperRead.target.y - player.position.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const arrowLen = Math.max(12, scale(2.4 + player.keeperRead.progress * 4.4, cam));
    const ex = cx + (dx / len) * arrowLen;
    const ey = cy + (dy / len) * arrowLen;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = player.keeperRead.committed ? "rgba(255, 192, 92, 0.95)" : "rgba(142, 215, 255, 0.78)";
    ctx.lineWidth = 2;
    ctx.stroke();
    const a = Math.atan2(ey - cy, ex - cx);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(a - 0.55) * 5, ey - Math.sin(a - 0.55) * 5);
    ctx.lineTo(ex - Math.cos(a + 0.55) * 5, ey - Math.sin(a + 0.55) * 5);
    ctx.closePath();
    ctx.fillStyle = player.keeperRead.committed ? "rgba(255, 192, 92, 0.95)" : "rgba(142, 215, 255, 0.78)";
    ctx.fill();
  }
}

export function drawPlayers(
  ctx: CanvasRenderingContext2D,
  players: Player[],
  teams: [{ id: string; color: string; secondaryColor: string; [k: string]: unknown }, { id: string; color: string; secondaryColor: string; [k: string]: unknown }] | null,
  cam: Cam,
  cw: number,
  ch: number,
  tick: number,
  debug?: DebugFrame | null
): void {
  if (!teams) return;
  const teamMap = new Map(teams.map(t => [t.id, t as unknown as TeamState]));
  const sorted = [...players].sort((a, b) => (a.hasBall ? 1 : 0) - (b.hasBall ? 1 : 0));

  for (const p of sorted) {
    const team = teamMap.get(p.teamId);
    if (team) drawPlayer(ctx, p, team, cam, cw, ch, tick);
  }

  if (!debug) return;

  ctx.save();
  for (const line of debug.shapeLines ?? []) {
    if (line.points.length < 2) continue;
    const broken = line.breakScore > 1;
    const longBroken = line.brokenTicks > 70;
    const alpha = line.unit === "defense" ? 0.58 : line.unit === "midfield" ? 0.42 : 0.26;
    ctx.beginPath();
    line.points.forEach((point, index) => {
      const [x, y] = pitchToCanvas(point.x, point.y, cam);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = longBroken
      ? "rgba(255, 92, 92, 0.82)"
      : broken
        ? "rgba(255, 196, 87, 0.7)"
        : `rgba(142, 215, 255, ${alpha})`;
    ctx.lineWidth = line.unit === "defense" ? 2.2 : line.unit === "midfield" ? 1.7 : 1.2;
    ctx.setLineDash(line.unit === "attack" ? [4, 5] : line.unit === "midfield" ? [8, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (broken) {
      const mid = line.points[Math.floor(line.points.length / 2)];
      const [mx, my] = pitchToCanvas(mid.x, mid.y, cam);
      ctx.beginPath();
      ctx.arc(mx, my, 4 + Math.min(5, line.brokenTicks / 25), 0, Math.PI * 2);
      ctx.strokeStyle = longBroken ? "rgba(255,92,92,0.72)" : "rgba(255,196,87,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();

  const intentMap = new Map(debug.intents.map(i => [i.playerId, i]));
  ctx.save();
  ctx.font = "9px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const p of sorted) {
    const intent = intentMap.get(p.id);
    if (!intent) continue;
    const [px, py] = pitchToCanvas(p.position.x, p.position.y, cam);
    const [tx, ty] = pitchToCanvas(intent.target.x, intent.target.y, cam);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = "rgba(142,215,255,0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(210,235,255,0.78)";
    ctx.fillText(intent.intent.replace("_", " "), px, py - 7);
  }
  ctx.restore();
}
