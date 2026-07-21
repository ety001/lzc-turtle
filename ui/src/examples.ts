export interface Example {
  name: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    name: '正方形',
    code: `; 画一个边长 200 的正方形
SETPW 3
SETPC #f2b950
REPEAT 4 [
  FD 200
  RT 90
]`,
  },
  {
    name: '五角星',
    code: `; 五角星：每次转 144 度
CS
SETPW 2
SETPC gold
REPEAT 5 [
  FD 260
  RT 144
]`,
  },
  {
    name: '螺旋',
    code: `; 彩色螺旋：步长逐渐变大
CS
REPEAT 90 [
  SETPC #7ec8a9
  FD 4
  RT 91
  ; 利用嵌套循环放大
  REPEAT 1 [ FD 0 ]
]
; 更经典的写法：
CS
REPEAT 60 [
  FD 6
  RT 95
  FD 2
]`,
  },
  {
    name: '花朵',
    code: `; 花朵：旋转画 12 个花瓣圆
CS
SETPW 2
SETPC pink
REPEAT 12 [
  REPEAT 36 [
    FD 8
    RT 10
  ]
  RT 30
]
HOME`,
  },
  {
    name: '中文命令示例',
    code: `# 全部使用中文命令，注释也可以用 # 号
清屏
画笔粗细 4
画笔颜色 红色
重复 4 [
  前进 150
  右转 90
]
抬笔
回家
落笔
画笔颜色 蓝色
重复 36 [ 前进 5 右转 10 ]`,
  },
  {
    name: '嵌套循环多边形',
    code: `; 嵌套 REPEAT：多边形组成的花环
CS
SETPW 2
REPEAT 8 [
  SETPC #e8853d
  REPEAT 6 [
    FD 60
    RT 60
  ]
  RT 45
]`,
  },
];
