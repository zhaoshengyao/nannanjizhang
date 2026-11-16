import type { Category } from './threshold'

export const DEF_CATS: [string, string][] = [
  ['餐', '餐饮'],
  ['交', '交通'],
  ['购', '购物'],
  ['娱', '娱乐'],
  ['居', '居家'],
  ['医', '医疗'],
  ['学', '学习'],
  ['其', '其他']
]

export function buildDefaultCats(): Category[] {
  return DEF_CATS.map((c, i) => ({ id: 'c' + i, icon: c[0], name: c[1] }))
}
