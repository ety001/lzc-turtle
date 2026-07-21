import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { DrawCommand } from '../turtle';

export const LOGICAL_WIDTH = 800;
export const LOGICAL_HEIGHT = 600;

export interface TurtleCanvasHandle {
  /** 播放一段指令流（会先清空画布、海龟复位） */
  play: (commands: DrawCommand[]) => void;
  /** 停止播放（保留已画内容） */
  stop: () => void;
  /** 清屏并把海龟复位到中心 */
  reset: () => void;
  /** 导出 256px 宽 PNG dataURL 缩略图 */
  getThumbnail: () => string;
  isRunning: () => boolean;
}

interface Props {
  /** 1 | 5 | 20，0 表示瞬时 */
  speed: number;
  onFinish?: () => void;
  onRunningChange?: (running: boolean) => void;
}

interface AnimState {
  queue: DrawCommand[];
  index: number;
  x: number;
  y: number;
  heading: number; // 当前动画中的朝向（数学角，0=上，顺时针）
  running: boolean;
  raf: number;
  lastTs: number;
  waitLeft: number; // 剩余等待毫秒
}

const BG = '#14161b';
const TURTLE_COLOR = '#e8e6e3';
const BASE_MOVE = 240; // px/s @1x
const BASE_TURN = 480; // deg/s @1x

function shortestDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

const TurtleCanvas = forwardRef<TurtleCanvasHandle, Props>(function TurtleCanvas(
  { speed, onFinish, onRunningChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<AnimState>({
    queue: [],
    index: 0,
    x: 0,
    y: 0,
    heading: 0,
    running: false,
    raf: 0,
    lastTs: 0,
    waitLeft: 0,
  });
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onRunningChangeRef = useRef(onRunningChange);
  onRunningChangeRef.current = onRunningChange;

  const toCanvasX = (x: number) => LOGICAL_WIDTH / 2 + x;
  const toCanvasY = (y: number) => LOGICAL_HEIGHT / 2 - y;

  const clearOffscreen = useCallback(() => {
    const off = offRef.current;
    const ctx = off?.getContext('2d');
    if (!off || !ctx) return;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  }, []);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const off = offRef.current;
    if (!canvas || !off) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const a = animRef.current;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.drawImage(off, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    // 画海龟（三角箭头），朝 heading 方向
    const cx = toCanvasX(a.x);
    const cy = toCanvasY(a.y);
    const rad = (a.heading * Math.PI) / 180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = TURTLE_COLOR;
    ctx.fill();
    ctx.strokeStyle = '#1a1d24';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }, []);

  const setRunning = useCallback(
    (running: boolean) => {
      const a = animRef.current;
      if (a.running !== running) {
        a.running = running;
        onRunningChangeRef.current?.(running);
      }
    },
    [],
  );

  /** 推进动画：dt 秒。返回是否已全部播完。 */
  const advance = useCallback((dt: number): boolean => {
    const a = animRef.current;
    const spd = speedRef.current;
    const instant = spd === 0;
    let moveBudget = instant ? Infinity : BASE_MOVE * spd * dt;
    let turnBudget = instant ? Infinity : BASE_TURN * spd * dt;
    let waitBudget = instant ? Infinity : 1000 * spd * dt;

    const off = offRef.current;
    const octx = off?.getContext('2d') ?? null;

    while (a.index < a.queue.length) {
      const cmd = a.queue[a.index];
      switch (cmd.type) {
        case 'clear':
          if (octx) {
            octx.fillStyle = BG;
            octx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
          }
          a.x = 0;
          a.y = 0;
          a.heading = 0;
          a.index++;
          break;
        case 'pen':
        case 'color':
        case 'width':
          a.index++;
          break;
        case 'turn': {
          const delta = shortestDelta(a.heading, cmd.heading);
          if (Math.abs(delta) <= turnBudget) {
            a.heading = cmd.heading;
            turnBudget -= Math.abs(delta);
            a.index++;
          } else {
            a.heading += Math.sign(delta) * turnBudget;
            return false;
          }
          break;
        }
        case 'wait': {
          if (a.waitLeft <= 0) a.waitLeft = cmd.ms;
          if (a.waitLeft <= waitBudget) {
            waitBudget -= a.waitLeft;
            a.waitLeft = 0;
            a.index++;
          } else {
            a.waitLeft -= waitBudget;
            return false;
          }
          break;
        }
        case 'move':
        case 'segment': {
          const tx = cmd.type === 'move' ? cmd.x : cmd.x2;
          const ty = cmd.type === 'move' ? cmd.y : cmd.y2;
          const dx = tx - a.x;
          const dy = ty - a.y;
          const dist = Math.hypot(dx, dy);
          a.heading = cmd.heading;
          if (dist <= moveBudget || dist < 1e-9) {
            a.x = tx;
            a.y = ty;
            moveBudget -= dist;
            if (cmd.type === 'segment' && octx) {
              octx.strokeStyle = cmd.color;
              octx.lineWidth = cmd.width;
              octx.lineCap = 'round';
              octx.beginPath();
              octx.moveTo(toCanvasX(cmd.x1), toCanvasY(cmd.y1));
              octx.lineTo(toCanvasX(cmd.x2), toCanvasY(cmd.y2));
              octx.stroke();
            }
            a.index++;
          } else {
            const ratio = moveBudget / dist;
            const px = a.x + dx * ratio;
            const py = a.y + dy * ratio;
            if (cmd.type === 'segment' && octx) {
              octx.strokeStyle = cmd.color;
              octx.lineWidth = cmd.width;
              octx.lineCap = 'round';
              octx.beginPath();
              octx.moveTo(toCanvasX(a.x), toCanvasY(a.y));
              octx.lineTo(toCanvasX(px), toCanvasY(py));
              octx.stroke();
            }
            a.x = px;
            a.y = py;
            return false;
          }
          break;
        }
      }
    }
    return true;
  }, []);

  const tick = useCallback(
    (ts: number) => {
      const a = animRef.current;
      const dt = Math.min((ts - a.lastTs) / 1000, 0.1);
      a.lastTs = ts;
      const done = advance(dt);
      renderFrame();
      if (done) {
        setRunning(false);
        onFinishRef.current?.();
        return;
      }
      a.raf = requestAnimationFrame(tick);
    },
    [advance, renderFrame, setRunning],
  );

  const stopLoop = useCallback(() => {
    const a = animRef.current;
    if (a.raf) cancelAnimationFrame(a.raf);
    a.raf = 0;
    setRunning(false);
  }, [setRunning]);

  const play = useCallback(
    (commands: DrawCommand[]) => {
      stopLoop();
      const a = animRef.current;
      a.queue = commands;
      a.index = 0;
      a.x = 0;
      a.y = 0;
      a.heading = 0;
      a.waitLeft = 0;
      clearOffscreen();
      if (commands.length === 0) {
        renderFrame();
        onFinishRef.current?.();
        return;
      }
      setRunning(true);
      a.lastTs = performance.now();
      a.raf = requestAnimationFrame(tick);
    },
    [stopLoop, clearOffscreen, renderFrame, setRunning, tick],
  );

  const stop = useCallback(() => {
    stopLoop();
  }, [stopLoop]);

  const reset = useCallback(() => {
    stopLoop();
    const a = animRef.current;
    a.queue = [];
    a.index = 0;
    a.x = 0;
    a.y = 0;
    a.heading = 0;
    clearOffscreen();
    renderFrame();
  }, [stopLoop, clearOffscreen, renderFrame]);

  const getThumbnail = useCallback((): string => {
    const off = offRef.current;
    const tmp = document.createElement('canvas');
    tmp.width = 256;
    tmp.height = Math.round((256 * LOGICAL_HEIGHT) / LOGICAL_WIDTH);
    const ctx = tmp.getContext('2d');
    if (off && ctx) {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(off, 0, 0, tmp.width, tmp.height);
    }
    return tmp.toDataURL('image/png');
  }, []);

  const isRunning = useCallback(() => animRef.current.running, []);

  useImperativeHandle(ref, () => ({ play, stop, reset, getThumbnail, isRunning }), [
    play,
    stop,
    reset,
    getThumbnail,
    isRunning,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = LOGICAL_WIDTH * dpr;
    canvas.height = LOGICAL_HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    const off = document.createElement('canvas');
    off.width = LOGICAL_WIDTH * dpr;
    off.height = LOGICAL_HEIGHT * dpr;
    const octx = off.getContext('2d');
    octx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    offRef.current = off;

    clearOffscreen();
    renderFrame();
    return () => stopLoop();
  }, [clearOffscreen, renderFrame, stopLoop]);

  return (
    <canvas
      ref={canvasRef}
      className="turtle-canvas"
      style={{ aspectRatio: `${LOGICAL_WIDTH} / ${LOGICAL_HEIGHT}` }}
    />
  );
});

export default TurtleCanvas;
