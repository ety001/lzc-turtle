/** 解析 / 执行错误（带行号） */
export interface ParseError {
  line: number;
  message: string;
}

/**
 * 有序绘图指令流的一条指令。
 * 坐标系：画布中心为原点 (0,0)，y 轴向上为正；渲染时翻转到 canvas 坐标。
 * heading：角度制，0 = 朝正上（北），顺时针增大。
 */
export type DrawCommand =
  | { type: 'segment'; x1: number; y1: number; x2: number; y2: number; heading: number; color: string; width: number }
  | { type: 'move'; x: number; y: number; heading: number }
  | { type: 'turn'; heading: number }
  | { type: 'pen'; down: boolean }
  | { type: 'color'; color: string }
  | { type: 'width'; width: number }
  | { type: 'clear' }
  | { type: 'wait'; ms: number };

export interface RunResult {
  errors: ParseError[];
  commands: DrawCommand[];
}

/** AST 节点 */
export type AstNode =
  | { kind: 'cmd'; name: string; args: string[]; line: number }
  | { kind: 'repeat'; count: number; body: AstNode[]; line: number };

export interface TurtleState {
  x: number;
  y: number;
  heading: number;
  penDown: boolean;
  color: string;
  width: number;
}

export const INITIAL_STATE: TurtleState = {
  x: 0,
  y: 0,
  heading: 0,
  penDown: true,
  color: '#f2b950',
  width: 2,
};
