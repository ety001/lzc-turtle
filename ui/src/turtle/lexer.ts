/** 词法分析：把源码切为带行号的 token 流 */

export interface Token {
  text: string;
  line: number;
}

/** 中文命令别名 → 英文核心命令（大小写不敏感在 parser 层处理） */
export const CN_ALIAS: Record<string, string> = {
  前进: 'FD',
  后退: 'BK',
  右转: 'RT',
  左转: 'LT',
  抬笔: 'PU',
  落笔: 'PD',
  画笔颜色: 'SETPC',
  画笔粗细: 'SETPW',
  回家: 'HOME',
  清屏: 'CS',
  重复: 'REPEAT',
  等待: 'WAIT',
};

/** 中文颜色别名（SETPC 参数用） */
export const CN_COLOR: Record<string, string> = {
  红: 'red', 红色: 'red',
  橙: 'orange', 橙色: 'orange',
  黄: 'yellow', 黄色: 'yellow',
  绿: 'green', 绿色: 'green',
  青: 'cyan', 青色: 'cyan',
  蓝: 'blue', 蓝色: 'blue',
  紫: 'purple', 紫色: 'purple',
  粉: 'pink', 粉色: 'pink',
  黑: 'black', 黑色: 'black',
  白: 'white', 白色: 'white',
  灰: 'gray', 灰色: 'gray',
  棕: 'brown', 棕色: 'brown',
};

const CN_ALIAS_KEYS = Object.keys(CN_ALIAS).sort((a, b) => b.length - a.length);

/**
 * 注释规则（契约：`;` 或 `#` 开头到行尾）：
 * - `;` 出现在任意位置 → 行内注释，截断到行尾
 * - `#` 是一行第一个非空白字符 → 整行注释
 *   （`#` 不在行首时不作注释，以兼容 `SETPC #ff0000`）
 */
function stripComment(line: string): string {
  const trimmedStart = line.search(/\S/);
  if (trimmedStart >= 0 && line[trimmedStart] === '#') return '';
  const semi = line.indexOf(';');
  return semi >= 0 ? line.slice(0, semi) : line;
}

/**
 * 中文别名允许参数连写（如 `前进100`、`重复4[前进50 右转90]`）。
 * 把一个以中文别名开头的 token 拆成「别名 + 剩余部分」。
 */
function splitCnAttached(raw: string): string[] {
  for (const key of CN_ALIAS_KEYS) {
    if (raw.startsWith(key) && raw.length > key.length) {
      return [key, ...splitCnAttached(raw.slice(key.length))];
    }
  }
  return [raw];
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const text = stripComment(lines[i]);
    let cur = '';
    const flush = () => {
      if (cur) {
        for (const piece of splitCnAttached(cur)) {
          tokens.push({ text: piece, line: lineNo });
        }
        cur = '';
      }
    };
    for (const ch of text) {
      if (ch === ' ' || ch === '\t' || ch === '　') {
        flush();
      } else if (ch === '[' || ch === ']') {
        flush();
        tokens.push({ text: ch, line: lineNo });
      } else {
        cur += ch;
      }
    }
    flush();
  }
  return tokens;
}
