import { Ball } from "../engine/types";
import { Cam, pitchToCanvas, scale } from "./pitch-renderer";

export function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: Ball,
  cam: Cam,
  _cw: number,
  _ch: number
): void {
  const trail = ball.trail;
  const ballHeight = ball.height ?? 0;
  const visualLift = scale(ballHeight * 0.75, cam);
  const shadowStrength = ball.shadowStrength ?? 0.46;
  for (let i = 0; i < trail.length - 1; i++) {
    const alpha = (i / trail.length) * (ballHeight > 1 ? 0.22 : 0.14);
    const [tx, ty] = pitchToCanvas(trail[i].x, trail[i].y, cam);
    ctx.beginPath();
    ctx.arc(tx, ty - visualLift * 0.35, Math.max(1, scale(ballHeight > 1 ? 0.11 : 0.16, cam)), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180, 225, 255, ${alpha})`;
    ctx.fill();
  }

  const [bx, by] = pitchToCanvas(ball.position.x, ball.position.y, cam);
  const br = Math.max(2.4, scale(0.24 + Math.min(ballHeight, 5) * 0.018, cam));
  const visualX = bx;
  const visualY = by - visualLift;

  ctx.save();
  ctx.translate(bx + 1, by + 1.8);
  ctx.scale(1.15 + ballHeight * 0.035, Math.max(0.18, 0.38 - ballHeight * 0.018));
  ctx.beginPath();
  ctx.arc(0, 0, br * (1.2 + ballHeight * 0.08), 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${shadowStrength})`;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(visualX, visualY, br, 0, Math.PI * 2);
  ctx.fillStyle = "#f4f7fb";
  ctx.fill();

  const sphere = ctx.createRadialGradient(
    visualX - br * 0.35, visualY - br * 0.35, 0,
    visualX, visualY, br
  );
  sphere.addColorStop(0, "rgba(255,255,255,0.8)");
  sphere.addColorStop(0.56, "rgba(255,255,255,0)");
  sphere.addColorStop(1, "rgba(0,0,0,0.24)");
  ctx.beginPath();
  ctx.arc(visualX, visualY, br, 0, Math.PI * 2);
  ctx.fillStyle = sphere;
  ctx.fill();

  if (ballHeight > 0.8) {
    ctx.beginPath();
    ctx.moveTo(bx, by - 1);
    ctx.lineTo(visualX, visualY + br * 0.8);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(visualX, visualY, br + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = ball.inFlight ? (ballHeight > 1 ? "rgba(180,225,255,0.48)" : "rgba(116,196,255,0.5)") : "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
