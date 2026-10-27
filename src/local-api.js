// PC 버전의 server.js가 하던 일을 폰 안에서 처리한다.
// 화면 코드는 그대로 api("/api/...")를 부르고, 여기서 경로별로 나눠 처리한다.
import { CATEGORIES } from "./categories.js";
import { parseReceipt } from "./parser.js";
import * as store from "./store.js";
import {
  today,
  priceRecords,
  summarizeProducts,
  storeComparison,
  matchProduct,
  itemMatchesListName,
  restockSuggestions,
  frequentProducts,
} from "./insights.js";

class HttpError extends Error {}
const fail = (message) => {
  throw new HttpError(message);
};

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

const monthParam = (m) => (MONTH_RE.test(m ?? "") ? m : today().slice(0, 7));

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const now = () => new Date().toISOString();
const receipts = () => store.getData().receipts;
const shopping = () => store.getData().shopping;
const findReceipt = (id) => receipts().find((r) => r.id === id) ?? fail("영수증을 찾을 수 없습니다.");
const findShopping = (id) => shopping().find((s) => s.id === id) ?? fail("항목을 찾을 수 없습니다.");
const inMonth = (month) => receipts().filter((r) => r.date.startsWith(month));
const totalOf = (r) => r.items.reduce((s, i) => s + i.amount, 0);

export const getApiKey = () => store.getSetting("apiKey");
export const setApiKey = (key) => store.setSetting("apiKey", key?.trim() || null);

// ─── 영수증 ──────────────────────────────────────────────────────────────

function cleanReceipt(body = {}) {
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => {
      const name = String(i.name ?? "").trim();
      const quantity = Number(i.quantity) > 0 ? Number(i.quantity) : 1;
      let unit_price = Math.round(Number(i.unit_price) || 0);
      let amount = Math.round(Number(i.amount) || 0);
      if (!amount && unit_price) amount = Math.round(unit_price * quantity);
      if (!unit_price && amount > 0) unit_price = Math.round(amount / quantity);
      return {
        name,
        product: String(i.product ?? "").trim() || name,
        category: CATEGORIES.includes(i.category) ? i.category : "기타",
        quantity,
        unit_price,
        amount,
      };
    })
    .filter((i) => i.name);

  if (items.length === 0) fail("품목을 하나 이상 입력하세요.");

  return {
    store: String(body.store ?? "").trim() || "알 수 없는 상점",
    date: DATE_RE.test(body.date ?? "") ? body.date : today(),
    memo: String(body.memo ?? "").trim(),
    items,
  };
}

/** 저장한 영수증에 들어 있는 품목을 장보기 목록에서 자동으로 체크한다. */
function checkOffShoppingList(items) {
  const hits = shopping().filter(
    (s) => !s.checked && items.some((i) => i.amount > 0 && itemMatchesListName(i, s.name)),
  );
  hits.forEach((s) => Object.assign(s, { checked: true, checkedAt: now() }));
  return hits.map((s) => s.name);
}

async function createReceipt(body) {
  const r = cleanReceipt(body);
  const id = store.nextId("receipt");
  const hasImage = DATA_URL_RE.test(body.image ?? "");
  if (hasImage) await store.putImage(id, body.image);
  receipts().push({ id, ...r, hasImage, createdAt: now() });
  const checkedOff = checkOffShoppingList(r.items);
  await store.save();
  return { id, date: r.date, checkedOff };
}

async function updateReceipt(id, body) {
  const r = cleanReceipt(body);
  Object.assign(findReceipt(id), r);
  await store.save();
  return { id, date: r.date };
}

async function deleteReceipt(id) {
  const r = findReceipt(id);
  store.getData().receipts = receipts().filter((x) => x !== r);
  await store.save();
  if (r.hasImage) await store.deleteImage(id);
  return null;
}

async function receiptDetail(id) {
  const r = findReceipt(id);
  return {
    id: r.id,
    store: r.store,
    date: r.date,
    memo: r.memo,
    imageUrl: r.hasImage ? await store.getImage(id) : null,
    items: r.items,
    total: totalOf(r),
  };
}

function receiptList(month) {
  return inMonth(month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .map((r) => ({
      id: r.id,
      store: r.store,
      date: r.date,
      memo: r.memo,
      hasImage: r.hasImage,
      total: totalOf(r),
      itemCount: r.items.length,
    }));
}

function summary(month) {
  const monthTotal = (m) => inMonth(m).reduce((s, r) => s + totalOf(r), 0);
  const byCat = new Map();
  for (const r of inMonth(month)) {
    for (const i of r.items) byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.amount);
  }
  const categories = [...byCat]
    .map(([category, amount]) => ({ category, amount }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return {
    month,
    total: monthTotal(month),
    prevTotal: monthTotal(shiftMonth(month, -1)),
    count: inMonth(month).length,
    categories,
  };
}

function knownProducts() {
  const seen = new Set();
  const out = [];
  // 최근 영수증부터 훑어서 최근에 쓴 이름이 앞에 오게 한다
  for (const r of [...receipts()].sort((a, b) => b.id - a.id)) {
    for (const i of r.items) {
      if (i.amount > 0 && !seen.has(i.product)) {
        seen.add(i.product);
        out.push(i.product);
      }
    }
  }
  return out.slice(0, 400);
}

async function parse(body) {
  const apiKey = await getApiKey();
  if (!apiKey) fail("AI 분석이 꺼져 있습니다. 설정(⚙)에서 Anthropic API 키를 넣어 주세요.");
  const match = DATA_URL_RE.exec(body?.image ?? "");
  if (!match) fail("이미지 형식이 올바르지 않습니다.");
  return parseReceipt({
    apiKey,
    mediaType: match[1],
    base64: match[2],
    knownProducts: knownProducts(),
    today: today(),
  });
}

// ─── 물가 ────────────────────────────────────────────────────────────────

const products = () =>
  summarizeProducts(priceRecords(receipts())).sort(
    (a, b) => b.count - a.count || b.last.date.localeCompare(a.last.date),
  );

function productDetail(name) {
  const records = priceRecords(receipts(), name);
  if (records.length === 0) fail("구매 기록이 없는 품목입니다.");
  return { summary: summarizeProducts(records)[0], stores: storeComparison(records), records };
}

// ─── 장보기 ──────────────────────────────────────────────────────────────

function shoppingView() {
  const summaries = summarizeProducts(priceRecords(receipts()));
  const items = [...shopping()]
    .sort((a, b) => Number(a.checked) - Number(b.checked) || a.id - b.id)
    .map((row) => {
      const m = matchProduct(row.name, summaries);
      return { ...row, price: m && { product: m.product, last: m.last, min: m.min } };
    });
  const open = items.filter((i) => !i.checked);
  return {
    items,
    estimate: open.reduce((s, i) => s + (i.price ? i.price.last.price * i.quantity : 0), 0),
    unpriced: open.filter((i) => !i.price).length,
    suggestions: restockSuggestions(summaries, open.map((i) => i.name)),
    frequent: frequentProducts(summaries, open),
    productNames: summaries.map((s) => s.product).sort((a, b) => a.localeCompare(b, "ko")),
  };
}

const clampQty = (q) => Math.max(1, Math.min(99, Math.round(Number(q) || 1)));

async function addShopping(body) {
  const name = String(body?.name ?? "").trim();
  if (!name) fail("품목 이름을 입력하세요.");
  const quantity = clampQty(body?.quantity);
  const existing = shopping().find((s) => !s.checked && s.name === name);
  if (existing) {
    existing.quantity = clampQty(existing.quantity + quantity);
    await store.save();
    return { id: existing.id, merged: true };
  }
  const id = store.nextId("shopping");
  shopping().push({ id, name, quantity, checked: false, createdAt: now(), checkedAt: null });
  await store.save();
  return { id, merged: false };
}

async function patchShopping(id, body) {
  const s = findShopping(id);
  if (typeof body?.checked === "boolean") {
    s.checked = body.checked;
    s.checkedAt = body.checked ? now() : null;
  }
  if (body?.quantity !== undefined) s.quantity = clampQty(body.quantity);
  await store.save();
  return { id };
}

async function clearChecked() {
  const before = shopping().length;
  store.getData().shopping = shopping().filter((s) => !s.checked);
  await store.save();
  return { removed: before - shopping().length };
}

async function deleteShopping(id) {
  store.getData().shopping = shopping().filter((s) => s.id !== id);
  await store.save();
  return null;
}

// ─── 경로 분배 ───────────────────────────────────────────────────────────

export async function api(path, { method = "GET", body } = {}) {
  const url = new URL(path, "http://app");
  const q = Object.fromEntries(url.searchParams);
  const route = `${method} ${url.pathname}`;
  const idMatch = /^\/api\/(receipts|shopping)\/(\d+)$/.exec(url.pathname);
  const id = idMatch ? Number(idMatch[2]) : null;

  try {
    switch (route) {
      case "GET /api/status":
        return { aiEnabled: Boolean(await getApiKey()), categories: CATEGORIES, today: today() };
      case "POST /api/parse":
        return await parse(body);
      case "GET /api/receipts":
        return receiptList(monthParam(q.month));
      case "POST /api/receipts":
        return await createReceipt(body);
      case "GET /api/summary":
        return summary(monthParam(q.month));
      case "GET /api/products":
        return products();
      case "GET /api/products/detail":
        return productDetail(String(q.name ?? ""));
      case "GET /api/shopping":
        return shoppingView();
      case "POST /api/shopping":
        return await addShopping(body);
      case "DELETE /api/shopping/checked":
        return await clearChecked();
    }
    if (idMatch?.[1] === "receipts") {
      if (method === "GET") return await receiptDetail(id);
      if (method === "PUT") return await updateReceipt(id, body);
      if (method === "DELETE") return await deleteReceipt(id);
    }
    if (idMatch?.[1] === "shopping") {
      if (method === "PATCH") return await patchShopping(id, body);
      if (method === "DELETE") return await deleteShopping(id);
    }
    fail("없는 기능입니다.");
  } catch (err) {
    // 저장 중 실패하면 메모리 상태가 저장본과 달라질 수 있으니 다시 읽어 맞춘다
    if (!(err instanceof HttpError) && method !== "GET") await store.load();
    throw err;
  }
}
