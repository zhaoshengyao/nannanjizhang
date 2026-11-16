import type { Category } from './threshold'

/**
 * 关键词 → 分类猜测
 * 返回匹配到的分类与是否命中关键词（未命中时落到「其他」，用于统计自动分类率）
 */
const RULES: { cat: string; re: RegExp }[] = [
  { cat: '餐饮', re: /瑞幸|星巴克|manner|咖啡|奶茶|喜茶|蜜雪|麦当劳|肯德基|华莱士|汉堡|外卖|美团|饿了么|餐厅|饭店|食堂|便利店|早餐|午餐|晚餐|夜宵|烧烤|火锅|面包|蛋糕|小吃/i },
  { cat: '交通', re: /地铁|公交|滴滴|出租车|打车|火车|高铁|12306|机票|航班|加油|停车|ETC|共享单车|哈啰|青桔/i },
  { cat: '购物', re: /淘宝|天猫|京东|拼多多|唯品会|超市|商场|生鲜|盒马|便利蜂|沃尔玛|永辉|优衣库|网购|旗舰店|小米|华为|苹果/i },
  { cat: '居家', re: /电费|水费|燃气|煤气|话费|流量|宽带|物业|房租|租金|家政|保洁|维修|家具|宜家/i },
  { cat: '娱乐', re: /电影|影城|视频|腾讯视频|爱奇艺|优酷|bilibili|B站|游戏|Steam|音乐|网易云|会员|KTV|演出|门票|健身/i },
  { cat: '医疗', re: /医院|药房|药店|药品|诊所|体检|挂号|牙科|眼科|医保/i },
  { cat: '学习', re: /书店|图书|当当|课程|网课|培训|学费|考试|文具|得到|知乎|极客时间/i },
  { cat: '其他', re: /转账|红包|工资|报销|退款|提现|零钱|余额宝|还款|信用卡/i }
]

export function guessCat(text: string, cats: Category[]): { id: string; matched: boolean } {
  const c = text || ''
  for (const rule of RULES) {
    if (!rule.re.test(c)) continue
    if (rule.cat === '其他') break
    const hit = cats.find(x => x.name.includes(rule.cat) || rule.cat.includes(x.name))
    if (hit) return { id: hit.id, matched: true }
  }
  const others = cats.find(x => x.name === '其他')
  return { id: others?.id || cats[0]?.id || '', matched: false }
}

/** 兼容旧调用：只取分类 ID */
export function guessCatId(text: string, cats: Category[]): string {
  return guessCat(text, cats).id
}
