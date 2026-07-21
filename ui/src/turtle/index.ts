import { parse } from './parser';
import { execute } from './execute';
import type { RunResult } from './types';

export type { ParseError, DrawCommand, RunResult, AstNode, TurtleState } from './types';
export { INITIAL_STATE } from './types';
export { parse } from './parser';
export { execute } from './execute';
export { tokenize, CN_ALIAS, CN_COLOR } from './lexer';

/** 一步完成「解析 + 执行」。有解析错误时不执行。 */
export function run(source: string): RunResult {
  const { nodes, errors } = parse(source);
  if (errors.length > 0) {
    return { errors, commands: [] };
  }
  const { commands, errors: execErrors } = execute(nodes);
  return { errors: execErrors, commands };
}
