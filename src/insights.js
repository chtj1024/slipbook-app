import { NON_GROCERY } from "./categories.js";

const DAY = 24 * 60 * 60 * 1000;

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

const pct = (from, to) => (from ? Math.round(((to - from) / from) * 1000) / 10 : 0);

// 띄어쓰기·대소문자 차이를 무시하고 비교하기 위한 키
export const keyOf = (s) => String(s).replace(/\s+/g, "").toLowerCase();

/** 가격 추적 대상 구매 기록 (할인 줄과 0원 줄은 제외), 날짜 오름차순 */
export function priceRecords(receipts, product) {
  const rows = [];
  for (const r of receipts) {
    for (const i of r.items) {
      if (i.amount <= 0 || i.unit_price <= 0) continue;
      if (product !== undefined && i.product !== product) continue;
      rows.push({ ...i, store: r.store, date: r.date, receipt_id: r.id });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.receipt_id - b.receipt_id);
}

/** 품목별 가격 요약: 최근가, 직전 대비 변동, 최저가와 그 상점, 구매 주기 */
export function summarizeProducts(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.product)) groups.set(r.product, []);
    groups.get(r.product).push(r);
  }

  const summaries = [];
  for (const [product, rows] of groups) {
    const last = rows.at(-1);
    const prev = rows.at(-2);
    const first = rows[0];
    const min = rows.reduce((a, b) => (b.unit_price < a.unit_price ? b : a));
    const max = rows.reduce((a, b) => (b.unit_price > a.unit_price ? b : a));
    const dates = [...new Set(rows.map((r) => r.date))];
    const avgInterval =
      dates.length >= 2 ? daysBetween(dates[0], dates.at(-1)) / (dates.length - 1) : null;

    summaries.push({
      product,
      category: last.category,
      count: rows.length,
      last: { price: last.unit_price, store: last.store, date: last.date },
      prevPrice: prev ? prev.unit_price : null,
      changeFromPrev: prev ? pct(prev.unit_price, last.unit_price) : 0,
      changeFromFirst: pct(first.unit_price, last.unit_price),
      firstDate: first.date,
      min: { price: min.unit_price, store: min.store, date: min.date },
      maxPrice: max.unit_price,
      avgPrice: Math.round(rows.reduce((s, r) => s + r.unit_price, 0) / rows.length),
      purchaseDays: dates.length,
      avgInterval: avgInterval === null ? null : Math.round(avgInterval * 10) / 10,
    });
  }
  return summaries;
}

/** 상점별 최근가·최저가 (같은 품목을 여러 곳에서 샀을 때 비교용) */
export function storeComparison(records) {
  const byStore = new Map();
  for (const r of records) {
    const s = byStore.get(r.store) ?? { store: r.store, count: 0, minPrice: Infinity };
    s.count += 1;
    s.minPrice = Math.min(s.minPrice, r.unit_price);
    s.lastPrice = r.unit_price;
    s.lastDate = r.date;
    byStore.set(r.store, s);
  }
  return [...byStore.values()].sort((a, b) => a.lastPrice - b.lastPrice);
}

/**
 * 장보기 항목 이름으로 가장 그럴듯한 추적 품목을 찾는다.
 * 정확히 같은 이름이 우선이고, 아니면 이름을 포함하는 품목 중 가장 자주 산 것.
 */
export function matchProduct(name, summaries) {
  const k = keyOf(name);
  if (!k) return null;
  const exact = summaries.find((s) => keyOf(s.product) === k);
  if (exact) return exact;
  if (k.length < 2) return null;
  const partial = summaries.filter((s) => keyOf(s.product).includes(k));
  return partial.sort((a, b) => b.count - a.count)[0] ?? null;
}

/** 구매한 품목 줄이 장보기 항목에 해당하는지 */
export function itemMatchesListName(item, listName) {
  const k = keyOf(listName);
  if (!k) return false;
  const p = keyOf(item.product);
  const n = keyOf(item.name);
  if (p === k || n === k) return true;
  return k.length >= 2 && (p.includes(k) || n.includes(k));
}

/**
 * "다 떨어졌을지도 몰라요" 추천: 두 번 이상 산 품목 중
 * 평균 구매 주기만큼 시간이 지났고 아직 목록에 없는 것.
 */
export function restockSuggestions(summaries, openListNames, limit = 6) {
  const now = today();
  const onList = (s) => openListNames.some((n) => matchProduct(n, [s]));
  return summaries
    .filter((s) => s.purchaseDays >= 2 && s.avgInterval >= 1 && !NON_GROCERY.has(s.category))
    .map((s) => ({ ...s, daysSince: daysBetween(s.last.date, now) }))
    .filter((s) => s.daysSince >= s.avgInterval * 0.9 && !onList(s))
    .sort((a, b) => b.daysSince / b.avgInterval - a.daysSince / a.avgInterval)
    .slice(0, limit)
    .map((s) => ({
      product: s.product,
      category: s.category,
      avgInterval: s.avgInterval,
      daysSince: s.daysSince,
      lastPrice: s.last.price,
    }));
}
