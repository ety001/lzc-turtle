import { normalizeColor } from './parser';
import type { AstNode, DrawCommand, ParseError, TurtleState } from './types';
import { INITIAL_STATE } from './types';

/** 防御性上限：避免恶意/失误程序卡死页面 */
const MAX_COMMANDS = 200_000;
const MAX_REPEAT = 10_000;

const DEG = Math.PI / 180;

export function execute(nodes: AstNode[]): { commands: DrawCommand[]; errors: ParseError[] } {
  const commands: DrawCommand[] = [];
  const errors: ParseError[] = [];
  const state: TurtleState = { ...INITIAL_STATE };

  const push = (cmd: DrawCommand, line: number): boolean => {
    if (commands.length >= MAX_COMMANDS) {
      errors.push({ line, message: `指令数量超过上限 ${MAX_COMMANDS}，已终止执行` });
      return false;
    }
    commands.push(cmd);
    return true;
  };

  function forward(dist: number, line: number): boolean {
    const nx = state.x + Math.sin(state.heading * DEG) * dist;
    const ny = state.y + Math.cos(state.heading * DEG) * dist;
    const ok = state.penDown
      ? push({ type: 'segment', x1: state.x, y1: state.y, x2: nx, y2: ny, heading: state.heading, color: state.color, width: state.width }, line)
      : push({ type: 'move', x: nx, y: ny, heading: state.heading }, line);
    state.x = nx;
    state.y = ny;
    return ok;
  }

  function runNode(node: AstNode): boolean {
    if (node.kind === 'repeat') {
      if (node.count > MAX_REPEAT) {
        errors.push({ line: node.line, message: `REPEAT 次数超过上限 ${MAX_REPEAT}` });
        return false;
      }
      for (let i = 0; i < node.count; i++) {
        for (const child of node.body) {
          if (!runNode(child)) return false;
        }
      }
      return true;
    }

    const { name, args, line } = node;
    const num = () => Number(args[0]);
    switch (name) {
      case 'FD': return forward(num(), line);
      case 'BK': return forward(-num(), line);
      case 'RT': {
        state.heading = (state.heading + num()) % 360;
        return push({ type: 'turn', heading: state.heading }, line);
      }
      case 'LT': {
        state.heading = (state.heading - num()) % 360;
        return push({ type: 'turn', heading: state.heading }, line);
      }
      case 'PU':
        state.penDown = false;
        return push({ type: 'pen', down: false }, line);
      case 'PD':
        state.penDown = true;
        return push({ type: 'pen', down: true }, line);
      case 'SETPC': {
        state.color = normalizeColor(args[0]);
        return push({ type: 'color', color: state.color }, line);
      }
      case 'SETPW': {
        state.width = num();
        return push({ type: 'width', width: state.width }, line);
      }
      case 'HOME': {
        const ox = state.x, oy = state.y;
        state.x = 0; state.y = 0; state.heading = 0;
        return state.penDown
          ? push({ type: 'segment', x1: ox, y1: oy, x2: 0, y2: 0, heading: 0, color: state.color, width: state.width }, line)
          : push({ type: 'move', x: 0, y: 0, heading: 0 }, line);
      }
      case 'CS': {
        state.x = 0; state.y = 0; state.heading = 0;
        return push({ type: 'clear' }, line);
      }
      case 'WAIT': {
        const ms = Math.min(Math.max(num(), 0), 60_000);
        return push({ type: 'wait', ms }, line);
      }
      default:
        errors.push({ line, message: `未实现的命令 ${name}` });
        return false;
    }
  }

  for (const node of nodes) {
    if (!runNode(node)) break;
  }
  return { commands, errors };
}
