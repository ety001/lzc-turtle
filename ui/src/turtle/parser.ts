import { CN_ALIAS, CN_COLOR, tokenize } from './lexer';
import type { AstNode, ParseError } from './types';

/** 命令元数据：参数个数与参数校验 */
const ARITY: Record<string, number> = {
  FD: 1, BK: 1, RT: 1, LT: 1,
  PU: 0, PD: 0,
  SETPC: 1, SETPW: 1,
  HOME: 0, CS: 0,
  REPEAT: 1,
  WAIT: 1,
};

const CSS_COLOR_NAMES = new Set([
  'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink',
  'black', 'white', 'gray', 'grey', 'brown', 'magenta', 'lime', 'olive',
  'navy', 'teal', 'maroon', 'silver', 'gold', 'violet', 'indigo', 'coral',
  'salmon', 'khaki', 'crimson', 'orchid', 'plum', 'turquoise', 'skyblue',
]);

function isValidColor(s: string): boolean {
  if (/^#[0-9a-fA-F]{3}$/.test(s) || /^#[0-9a-fA-F]{6}$/.test(s)) return true;
  if (s in CN_COLOR) return true;
  return CSS_COLOR_NAMES.has(s.toLowerCase());
}

/** 归一化颜色参数：中文别名 → CSS 颜色名 */
export function normalizeColor(s: string): string {
  return CN_COLOR[s] ?? s;
}

function parseNumber(raw: string, line: number, what: string, errors: ParseError[]): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    errors.push({ line, message: `${what}「${raw}」不是有效数字` });
    return null;
  }
  return n;
}

export function parse(source: string): { nodes: AstNode[]; errors: ParseError[] } {
  const tokens = tokenize(source);
  const errors: ParseError[] = [];
  let pos = 0;

  const peek = () => tokens[pos];

  function parseBlock(inRepeat: boolean, repeatLine: number): AstNode[] {
    const nodes: AstNode[] = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.text === ']') {
        if (!inRepeat) {
          errors.push({ line: tok.line, message: '多余的「]」，没有匹配的「[」' });
        }
        pos++;
        return nodes;
      }
      if (tok.text === '[') {
        errors.push({ line: tok.line, message: '「[」只能出现在 REPEAT n 之后' });
        pos++;
        continue;
      }
      const rawName = tok.text;
      const name = (CN_ALIAS[rawName] ?? rawName).toUpperCase();
      const line = tok.line;
      pos++;

      if (!(name in ARITY)) {
        errors.push({ line, message: `未知命令「${rawName}」` });
        // 跳过同行剩余 token，避免把参数也报成未知命令
        while (pos < tokens.length && tokens[pos].line === line) pos++;
        continue;
      }

      if (name === 'REPEAT') {
        const countTok = peek();
        let count = 0;
        if (!countTok) {
          errors.push({ line, message: 'REPEAT 缺少次数参数' });
        } else {
          pos++;
          const n = parseNumber(countTok.text, countTok.line, 'REPEAT 次数', errors);
          if (n !== null) {
            if (!Number.isInteger(n) || n < 0) {
              errors.push({ line: countTok.line, message: 'REPEAT 次数必须是非负整数' });
            } else {
              count = n;
            }
          }
        }
        const open = peek();
        if (!open || open.text !== '[') {
          errors.push({ line, message: 'REPEAT n 之后需要「[ ... ]」块' });
          nodes.push({ kind: 'repeat', count, body: [], line });
        } else {
          pos++;
          const body = parseBlock(true, line);
          nodes.push({ kind: 'repeat', count, body, line });
        }
        continue;
      }

      const args: string[] = [];
      for (let i = 0; i < ARITY[name]; i++) {
        const argTok = peek();
        if (!argTok || argTok.text === '[' || argTok.text === ']') {
          errors.push({ line, message: `命令 ${name} 需要 ${ARITY[name]} 个参数` });
          break;
        }
        pos++;
        args.push(argTok.text);
      }
      if (args.length === ARITY[name]) {
        // 数值类参数在解析期校验，错误尽早暴露
        if (['FD', 'BK', 'RT', 'LT', 'WAIT'].includes(name)) {
          parseNumber(args[0], line, `命令 ${name} 的参数`, errors);
        } else if (name === 'SETPW') {
          const n = parseNumber(args[0], line, '画笔粗细', errors);
          if (n !== null && n <= 0) {
            errors.push({ line, message: '画笔粗细必须大于 0' });
          }
        } else if (name === 'SETPC') {
          if (!isValidColor(args[0])) {
            errors.push({ line, message: `无法识别的颜色「${args[0]}」（支持 #rrggbb、常见颜色名、中文颜色名）` });
          }
        }
        nodes.push({ kind: 'cmd', name, args, line });
      }
    }
    if (inRepeat) {
      errors.push({ line: repeatLine, message: 'REPEAT 块缺少闭合的「]」' });
    }
    return nodes;
  }

  const nodes = parseBlock(false, 0);
  return { nodes, errors };
}
