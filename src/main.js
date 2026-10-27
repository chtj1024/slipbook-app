import { App } from "@capacitor/app";
import { api, getApiKey, setApiKey } from "./local-api.js";
import * as store from "./store.js";

// ─── 유틸 ────────────────────────────────────────────────────────────────

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const fmtQty = (q) => (Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000));

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
function fmtDate(iso, withWeekday = false) {
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${m}월 ${d}일`;
  return withWeekday ? `${base} (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})` : base;
}
const fmtShortDate = (iso) => iso.slice(2).replaceAll("-", ".");

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function changeBadge(pct) {
  if (!pct) return `<span class="badge flat">변동 없음</span>`;
  const cls = pct > 0 ? "up" : "down";
  return `<span class="badge ${cls}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return map;
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ─── 상태 ────────────────────────────────────────────────────────────────

const state = {
  tab: "ledger",
  status: { aiEnabled: false, categories: [], today: "" },
  month: "",
  productQuery: "",
};

const catColor = (cat) => {
  const i = state.status.categories.indexOf(cat);
  return `var(--c${i < 0 ? 7 : i})`;
};

const view = $("#view");
const modal = $("#modal");
const modalBody = $("#modal-body");

function openModal(html) {
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
}
const closeModal = () => modal.open && modal.close();

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal(); // 바깥(backdrop) 클릭
});

// ─── 탭 ──────────────────────────────────────────────────────────────────

const renderers = { ledger: renderLedger, prices: renderPrices, shopping: renderShopping };
const DEFAULT_TAB = "shopping"; // 앱을 열면 장보기 목록부터 보여 준다

function setTab(tab) {
  state.tab = renderers[tab] ? tab : DEFAULT_TAB;
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  if (location.hash !== `#${state.tab}`) history.replaceState(null, "", `#${state.tab}`);
  return render();
}

async function render() {
  try {
    await renderers[state.tab]();
  } catch (err) {
    view.innerHTML = `<div class="panel empty"><strong>불러오지 못했어요</strong>${esc(err.message)}</div>`;
  }
}

$$(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
window.addEventListener("hashchange", () => setTab(location.hash.slice(1)));

// ═══ 가계부 ══════════════════════════════════════════════════════════════

async function renderLedger() {
  const [summary, receipts] = await Promise.all([
    api(`/api/summary?month=${state.month}`),
    api(`/api/receipts?month=${state.month}`),
  ]);
  const [y, m] = state.month.split("-");
  const diff = summary.total - summary.prevTotal;
  const isCurrent = state.month === state.status.today.slice(0, 7);

  view.innerHTML = `
    <div class="toolbar">
      <div class="month-nav">
        <button class="icon-btn" data-act="month" data-delta="-1" aria-label="이전 달">‹</button>
        <h1>${Number(y)}년 ${Number(m)}월</h1>
        <button class="icon-btn" data-act="month" data-delta="1" aria-label="다음 달" ${isCurrent ? "disabled" : ""}>›</button>
      </div>
      <div class="actions">
        <button class="btn primary" data-act="scan">📷 영수증 찍기</button>
        <button class="btn" data-act="pick">앨범</button>
        <button class="btn" data-act="manual">직접 입력</button>
      </div>
    </div>

    ${state.status.aiEnabled ? "" : `
      <div class="notice">
        AI 영수증 분석이 꺼져 있어요. <button class="btn small" data-act="settings">설정</button>에서 Anthropic API 키를 넣으면 사진만 찍어도 품목이 자동으로 채워져요.
        지금은 사진을 첨부해 직접 입력할 수 있어요.
      </div>`}

    <div class="grid stats">
      <div class="panel stat">
        <div class="label">이번 달 지출</div>
        <div class="value num">${won(summary.total)}</div>
      </div>
      <div class="panel stat">
        <div class="label">지난달 대비</div>
        <div class="value num" style="color:${diff > 0 ? "var(--up)" : diff < 0 ? "var(--down)" : "inherit"}">
          ${diff === 0 ? "—" : `${diff > 0 ? "+" : "−"}${won(Math.abs(diff))}`}
        </div>
        <div class="sub num">지난달 ${won(summary.prevTotal)}</div>
      </div>
      <div class="panel stat">
        <div class="label">영수증</div>
        <div class="value num">${summary.count}장</div>
      </div>
    </div>

    <div class="grid two">
      <section class="panel">
        <h2>분류별 지출</h2>
        ${categoryBreakdown(summary)}
      </section>
      <section class="panel">
        <h2>영수증</h2>
        ${receiptList(receipts)}
      </section>
    </div>`;
}

function categoryBreakdown(summary) {
  if (!summary.categories.length) return `<div class="empty">아직 지출이 없어요</div>`;
  const max = summary.categories[0].amount;
  const sum = summary.categories.reduce((s, c) => s + c.amount, 0);
  return `
    <div class="stack" aria-hidden="true">
      ${summary.categories.map((c) => `<span style="width:${(c.amount / sum) * 100}%;background:${catColor(c.category)}"></span>`).join("")}
    </div>
    ${summary.categories
      .map(
        (c) => `
        <div class="cat-row">
          <span class="chip" style="color:var(--text)"><span class="dot" style="background:${catColor(c.category)}"></span>${esc(c.category)}</span>
          <div class="cat-bar"><span style="width:${(c.amount / max) * 100}%;background:${catColor(c.category)}"></span></div>
          <span class="num">${won(c.amount)} <small style="color:var(--muted)">${Math.round((c.amount / sum) * 100)}%</small></span>
        </div>`,
      )
      .join("")}`;
}

function receiptList(receipts) {
  if (!receipts.length) {
    return `<div class="empty"><strong>영수증이 없어요</strong>‘영수증 스캔’으로 종이 영수증을 찍어 보세요.</div>`;
  }
  const byDay = groupBy(receipts, (r) => r.date);
  return [...byDay]
    .map(
      ([date, rows]) => `
      <div class="day-group">
        <div class="day-label">${fmtDate(date, true)}</div>
        ${rows
          .map(
            (r) => `
            <button class="receipt-row" data-act="open-receipt" data-id="${r.id}">
              <div class="main">
                <div class="store">${esc(r.store)}</div>
                <div class="meta">품목 ${r.itemCount}개${r.hasImage ? " · 사진" : ""}${r.memo ? ` · ${esc(r.memo)}` : ""}</div>
              </div>
              <div class="amount num">${won(r.total)}</div>
            </button>`,
          )
          .join("")}
      </div>`,
    )
    .join("");
}

async function openReceiptDetail(id) {
  const r = await api(`/api/receipts/${id}`);
  openModal(`
    <div class="modal-head">
      <h2>${esc(r.store)}</h2>
      <button class="icon-btn" data-act="close" aria-label="닫기">✕</button>
    </div>
    <div class="editor ${r.imageUrl ? "" : "no-image"}">
      ${r.imageUrl ? `<div class="receipt-image"><img src="${r.imageUrl}" alt="영수증 사진"></div>` : ""}
      <div>
        <div class="chip" style="margin-bottom:10px">${r.date.slice(0, 4)}년 ${fmtDate(r.date, true)}${r.memo ? ` · ${esc(r.memo)}` : ""}</div>
        <table class="detail-items">
          <thead><tr><th>품목</th><th>분류</th><th class="r">수량</th><th class="r">금액</th></tr></thead>
          <tbody>
            ${r.items
              .map(
                (i) => `
                <tr>
                  <td>${esc(i.product)}${i.product !== i.name ? `<span class="sub">${esc(i.name)}</span>` : ""}</td>
                  <td><span class="chip"><span class="dot" style="background:${catColor(i.category)}"></span>${esc(i.category)}</span></td>
                  <td class="r num">${fmtQty(i.quantity)}</td>
                  <td class="r num" ${i.amount < 0 ? 'style="color:var(--danger)"' : ""}>${won(i.amount)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
          <tfoot><tr><td colspan="3">합계</td><td class="r num">${won(r.total)}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn danger" data-act="delete-receipt" data-id="${r.id}">삭제</button>
      <div class="right">
        <button class="btn" data-act="close">닫기</button>
        <button class="btn primary" data-act="edit-receipt" data-id="${r.id}">수정</button>
      </div>
    </div>`);
}

// ─── 영수증 편집기 ───────────────────────────────────────────────────────

const editor = { receiptId: null, image: null, parsedTotal: null, products: [] };

const emptyItem = () => ({ name: "", product: "", category: "식료품", quantity: 1, unit_price: 0, amount: 0 });

async function openEditor({ draft, receiptId = null, image = null, imageUrl = null, loading = false }) {
  editor.receiptId = receiptId;
  editor.image = image;
  editor.parsedTotal = draft?.total ?? null;
  const items = draft?.items?.length ? draft.items : [emptyItem()];
  const src = image || imageUrl;

  openModal(`
    <div class="modal-head">
      <h2>${receiptId ? "영수증 수정" : "영수증 추가"}</h2>
      <button class="icon-btn" data-act="close" aria-label="닫기">✕</button>
    </div>
    <form id="receipt-form" autocomplete="off">
      <div class="editor ${src ? "" : "no-image"}">
        ${src ? `<div class="receipt-image"><img src="${src}" alt="영수증 사진">${loading ? `<div class="loading-overlay" id="parse-overlay"><div><div class="spinner"></div>영수증 읽는 중…</div></div>` : ""}</div>` : ""}
        <div>
          <div id="editor-error"></div>
          <div class="fields">
            <label class="field">상호<input name="store" value="${esc(draft?.store)}" placeholder="예: 이마트 성수점"></label>
            <label class="field">날짜<input name="date" type="date" value="${esc(draft?.date || state.status.today)}" required></label>
            <label class="field wide">메모<input name="memo" value="${esc(draft?.memo)}" placeholder="선택"></label>
          </div>
          <div class="items-head">
            <span>영수증 표기</span><span>품목명 (가격 추적용)</span><span>분류</span><span>수량</span><span>단가</span><span>금액</span><span></span>
          </div>
          <div class="items" id="items">
            ${loading ? `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>` : items.map(itemRow).join("")}
          </div>
          <button type="button" class="btn ghost small" data-act="add-row" ${loading ? "disabled" : ""}>+ 품목 추가</button>
          <div class="items-total"><span id="total-warn" class="warn"></span><span>합계 <span id="items-total" class="num">0원</span></span></div>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-act="close">취소</button>
        <div class="right">
          <button type="submit" class="btn primary" id="save-receipt" ${loading ? "disabled" : ""}>저장</button>
        </div>
      </div>
    </form>
    <datalist id="product-names">${editor.products.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>`);
  updateTotal();
}

function itemRow(i) {
  const cats = state.status.categories
    .map((c) => `<option ${c === i.category ? "selected" : ""}>${esc(c)}</option>`)
    .join("");
  // .cap 캡션은 좁은 화면에서만 보인다 (넓은 화면은 표 머리글을 쓴다)
  return `
    <div class="item-row">
      <label class="cell"><span class="cap">영수증 표기</span><input data-k="name" value="${esc(i.name)}" placeholder="영수증 표기"></label>
      <label class="cell"><span class="cap">품목명 (가격 추적용)</span><input data-k="product" value="${esc(i.product)}" ${i.product && i.product !== i.name ? 'data-touched="1"' : ""} placeholder="예: 서울우유 1L" list="product-names"></label>
      <label class="cell"><span class="cap">분류</span><select data-k="category">${cats}</select></label>
      <label class="cell"><span class="cap">수량</span><input data-k="quantity" class="n num" type="number" step="any" min="0" value="${i.quantity}"></label>
      <label class="cell"><span class="cap">단가</span><input data-k="unit_price" class="n num" type="number" step="1" value="${i.unit_price}"></label>
      <label class="cell"><span class="cap">금액</span><input data-k="amount" class="n num ${i.amount < 0 ? "neg" : ""}" type="number" step="1" value="${i.amount}"></label>
      <button type="button" class="icon-btn" data-act="remove-row" aria-label="품목 삭제">×</button>
    </div>`;
}

function readItems() {
  return $$("#items .item-row").map((row) => {
    const get = (k) => $(`[data-k="${k}"]`, row).value;
    return {
      name: get("name").trim(),
      product: get("product").trim(),
      category: get("category"),
      quantity: Number(get("quantity")) || 1,
      unit_price: Number(get("unit_price")) || 0,
      amount: Number(get("amount")) || 0,
    };
  });
}

function updateTotal() {
  const el = $("#items-total");
  if (!el) return;
  const sum = readItems().reduce((s, i) => s + i.amount, 0);
  el.textContent = won(sum);
  const warn = $("#total-warn");
  warn.textContent =
    editor.parsedTotal && editor.parsedTotal !== sum
      ? `영수증 결제액 ${won(editor.parsedTotal)}과 ${won(Math.abs(editor.parsedTotal - sum))} 차이가 나요. 품목을 확인해 주세요.`
      : "";
}

function fillParsed(draft) {
  editor.parsedTotal = draft.total || null;
  const form = $("#receipt-form");
  if (!form) return;
  form.store.value = draft.store || "";
  if (draft.date) form.date.value = draft.date;
  $("#items").innerHTML = draft.items.map(itemRow).join("");
  $("#parse-overlay")?.remove();
  $$("#receipt-form [disabled]").forEach((b) => (b.disabled = false));
  updateTotal();
}

function showParseError(message) {
  $("#parse-overlay")?.remove();
  $("#editor-error").innerHTML = `<div class="error-box">${esc(message)} 아래에 직접 입력할 수 있어요.</div>`;
  $("#items").innerHTML = itemRow(emptyItem());
  $$("#receipt-form [disabled]").forEach((b) => (b.disabled = false));
  updateTotal();
}

document.addEventListener("input", (e) => {
  const row = e.target.closest(".item-row");
  if (!row) return;
  const k = e.target.dataset.k;
  if (k === "quantity" || k === "unit_price") {
    const q = Number($('[data-k="quantity"]', row).value) || 0;
    const p = Number($('[data-k="unit_price"]', row).value) || 0;
    $('[data-k="amount"]', row).value = Math.round(q * p);
  }
  if (k === "name") {
    const product = $('[data-k="product"]', row);
    if (!product.dataset.touched) product.value = e.target.value;
  }
  if (k === "product") e.target.dataset.touched = "1";
  $('[data-k="amount"]', row).classList.toggle("neg", Number($('[data-k="amount"]', row).value) < 0);
  updateTotal();
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "receipt-form") return;
  e.preventDefault();
  const form = e.target;
  const items = readItems().filter((i) => i.name || i.product);
  items.forEach((i) => (i.name ||= i.product));
  if (!items.length) return toast("품목을 하나 이상 입력하세요");

  const body = { store: form.store.value, date: form.date.value, memo: form.memo.value, items };
  const button = $("#save-receipt");
  button.disabled = true;
  try {
    if (editor.receiptId) {
      await api(`/api/receipts/${editor.receiptId}`, { method: "PUT", body });
      toast("수정했어요");
    } else {
      const res = await api("/api/receipts", { method: "POST", body: { ...body, image: editor.image } });
      toast(
        res.checkedOff.length
          ? `저장했어요 · 장보기 목록에서 ${res.checkedOff.length}개 체크 (${res.checkedOff.join(", ")})`
          : "저장했어요",
      );
    }
    state.month = body.date.slice(0, 7);
    closeModal();
    render();
  } catch (err) {
    button.disabled = false;
    $("#editor-error").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
});

async function loadProductNames() {
  try {
    editor.products = (await api("/api/products")).map((p) => p.product);
  } catch {
    editor.products = [];
  }
}

// 긴 변 최대 2000px JPEG로 줄여서 보낸다 (업로드·분석 비용 절약)
async function shrinkImage(file, maxSide = 2000) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

const onImagePicked = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  let image;
  try {
    image = await shrinkImage(file);
  } catch {
    return toast("이 이미지 형식은 열 수 없어요 (JPG·PNG로 찍어 주세요)");
  }
  await loadProductNames();

  if (!state.status.aiEnabled) {
    return openEditor({ image, draft: null });
  }
  openEditor({ image, draft: null, loading: true });
  try {
    const draft = await api("/api/parse", { method: "POST", body: { image } });
    if (editor.image === image) fillParsed(draft);
  } catch (err) {
    if (editor.image === image) showParseError(err.message);
  }
};
$("#file-input").addEventListener("change", onImagePicked);
$("#camera-input").addEventListener("change", onImagePicked);

// ─── 설정 ────────────────────────────────────────────────────────────────

async function openSettings() {
  const key = await getApiKey();
  openModal(`
    <div class="modal-head">
      <h2>설정</h2>
      <button class="icon-btn" data-act="close" aria-label="닫기">✕</button>
    </div>
    <form id="settings-form" autocomplete="off">
      <label class="field">Anthropic API 키
        <input name="apiKey" type="password" value="${esc(key)}" placeholder="sk-ant-..." autocapitalize="off" spellcheck="false">
      </label>
      <p class="chip" style="display:block;margin:8px 0 0;line-height:1.6">
        키를 넣으면 영수증 사진을 Claude가 읽어 품목을 자동으로 채워 줘요. 키는 이 폰에만 저장되고, 분석할 때 영수증 사진과 함께 Anthropic으로만 전송돼요.
        키는 console.anthropic.com 에서 만들 수 있어요.
      </p>
      <div class="modal-foot">
        ${key ? `<button type="button" class="btn danger" data-act="clear-key">키 삭제</button>` : "<span></span>"}
        <div class="right">
          <button type="button" class="btn" data-act="close">취소</button>
          <button class="btn primary">저장</button>
        </div>
      </div>
    </form>`);
}

async function applyKey(key) {
  await setApiKey(key);
  state.status = await api("/api/status");
  closeModal();
  render();
}

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "settings-form") return;
  e.preventDefault();
  await applyKey(e.target.apiKey.value);
  toast(state.status.aiEnabled ? "AI 영수증 분석을 켰어요" : "API 키를 지웠어요");
});

// ═══ 물가 ════════════════════════════════════════════════════════════════

async function renderPrices() {
  const products = await api("/api/products");
  const tracked = products.filter((p) => p.count >= 2);
  const risers = tracked.filter((p) => p.changeFromFirst > 0).sort((a, b) => b.changeFromFirst - a.changeFromFirst).slice(0, 5);
  const fallers = tracked.filter((p) => p.changeFromFirst < 0).sort((a, b) => a.changeFromFirst - b.changeFromFirst).slice(0, 5);

  const mover = (p) => `
    <button class="mover" data-act="open-product" data-name="${esc(p.product)}">
      <span class="name">${esc(p.product)}</span>
      <span class="num">${won(p.last.price)} ${changeBadge(p.changeFromFirst)}</span>
    </button>`;

  view.innerHTML = `
    <div class="toolbar">
      <h1>물가 추적</h1>
      <span class="chip">영수증 속 품목 ${products.length}개 · 2번 이상 산 품목 ${tracked.length}개</span>
    </div>
    ${
      products.length === 0
        ? `<div class="panel empty"><strong>아직 추적할 품목이 없어요</strong>영수증을 저장하면 품목별 가격이 자동으로 쌓여요.</div>`
        : `
      <div class="movers">
        <section class="panel">
          <h2>처음 산 때보다 오른 품목</h2>
          ${risers.length ? risers.map(mover).join("") : `<div class="empty" style="padding:12px">오른 품목이 없어요</div>`}
        </section>
        <section class="panel">
          <h2>처음 산 때보다 내린 품목</h2>
          ${fallers.length ? fallers.map(mover).join("") : `<div class="empty" style="padding:12px">내린 품목이 없어요</div>`}
        </section>
      </div>
      <section class="panel">
        <input class="search" id="product-search" type="search" placeholder="품목 검색 (예: 우유, 계란)" value="${esc(state.productQuery)}">
        <div class="product-list" id="product-list"></div>
      </section>`
    }`;

  if (!products.length) return;
  const list = $("#product-list");
  const draw = () => {
    const q = state.productQuery.trim().toLowerCase();
    const shown = q ? products.filter((p) => p.product.toLowerCase().includes(q)) : products;
    list.innerHTML = shown.length
      ? shown.map(productRow).join("")
      : `<div class="empty">‘${esc(state.productQuery)}’에 맞는 품목이 없어요</div>`;
  };
  $("#product-search").addEventListener("input", (e) => {
    state.productQuery = e.target.value;
    draw();
  });
  draw();
}

function productRow(p) {
  const cheaperElsewhere = p.min.price < p.last.price && p.min.store !== p.last.store;
  return `
    <button class="product-row" data-act="open-product" data-name="${esc(p.product)}">
      <div style="min-width:0">
        <div class="name">${esc(p.product)}</div>
        <div class="meta"><span class="dot" style="background:${catColor(p.category)}"></span> ${esc(p.category)} · ${p.count}번 구매 · 최근 ${fmtShortDate(p.last.date)} ${esc(p.last.store)}</div>
      </div>
      <div class="badge-col">${p.count >= 2 ? changeBadge(p.changeFromPrev) : `<span class="badge flat">첫 기록</span>`}</div>
      <div class="price num">${won(p.last.price)}
        <small>${cheaperElsewhere ? `최저 ${won(p.min.price)} · ${esc(p.min.store)}` : p.count >= 2 ? `평균 ${won(p.avgPrice)}` : "&nbsp;"}</small>
      </div>
    </button>`;
}

function priceChart(records) {
  const W = 640, H = 220, L = 56, R = 16, T = 16, B = 30;
  const prices = records.map((r) => r.unit_price);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (lo === hi) { lo = lo * 0.9; hi = hi * 1.1 || 1; }
  const pad = (hi - lo) * 0.15;
  lo = Math.max(0, lo - pad); hi += pad;

  const t0 = Date.parse(records[0].date);
  const t1 = Date.parse(records.at(-1).date);
  const x = (r, i) => (t1 === t0 ? L + ((W - L - R) * (i + 0.5)) / records.length : L + ((Date.parse(r.date) - t0) / (t1 - t0)) * (W - L - R));
  const y = (p) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);
  const pts = records.map((r, i) => [x(r, i), y(r.unit_price)]);
  const minPrice = Math.min(...prices);

  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v / 10) * 10);
  const path = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const area = `${path}L${pts.at(-1)[0].toFixed(1)},${H - B}L${pts[0][0].toFixed(1)},${H - B}Z`;

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="단가 추이">
      ${ticks.map((v) => `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString("ko-KR")}</text>`).join("")}
      <path class="area" d="${area}"/>
      <path class="line" d="${path}"/>
      ${pts.map(([px, py], i) => `<circle class="pt ${records[i].unit_price === minPrice ? "min" : ""}" cx="${px}" cy="${py}" r="4.5"><title>${records[i].date} ${records[i].store} ${won(records[i].unit_price)}</title></circle>`).join("")}
      <text x="${L}" y="${H - 8}">${fmtShortDate(records[0].date)}</text>
      <text x="${W - R}" y="${H - 8}" text-anchor="end">${fmtShortDate(records.at(-1).date)}</text>
    </svg>`;
}

async function openProduct(name) {
  const { summary: s, stores, records } = await api(`/api/products/detail?name=${encodeURIComponent(name)}`);
  openModal(`
    <div class="modal-head">
      <h2>${esc(s.product)}</h2>
      <button class="icon-btn" data-act="close" aria-label="닫기">✕</button>
    </div>
    <div class="kv">
      <div><div class="label">최근 단가</div><div class="value num">${won(s.last.price)}</div><div class="sub">${fmtShortDate(s.last.date)} · ${esc(s.last.store)}</div></div>
      <div><div class="label">직전 대비</div><div class="value">${s.count >= 2 ? changeBadge(s.changeFromPrev) : "—"}</div><div class="sub num">${s.prevPrice ? `직전 ${won(s.prevPrice)}` : "첫 기록"}</div></div>
      <div><div class="label">최저가</div><div class="value num">${won(s.min.price)}</div><div class="sub">${fmtShortDate(s.min.date)} · ${esc(s.min.store)}</div></div>
      <div><div class="label">구매 주기</div><div class="value num">${s.avgInterval ? `${Math.round(s.avgInterval)}일` : "—"}</div><div class="sub">${s.count}번 구매</div></div>
    </div>
    ${records.length >= 2 ? priceChart(records) : ""}
    ${stores.length >= 2 ? `
      <div class="subhead">상점별 최근 단가</div>
      <table class="detail-items">
        <tbody>${stores.map((st, i) => `<tr><td>${esc(st.store)} ${i === 0 ? '<span class="badge down">가장 저렴</span>' : ""}</td><td class="r num">${won(st.lastPrice)}</td><td class="r" style="color:var(--muted);font-size:13px">${fmtShortDate(st.lastDate)}</td></tr>`).join("")}</tbody>
      </table>` : ""}
    <div class="subhead">구매 기록</div>
    <table class="detail-items">
      <thead><tr><th>날짜</th><th>상점</th><th class="r">수량</th><th class="r">단가</th></tr></thead>
      <tbody>${[...records].reverse().map((r) => `<tr><td class="num">${r.date}</td><td>${esc(r.store)}<span class="sub">${esc(r.name)}</span></td><td class="r num">${fmtQty(r.quantity)}</td><td class="r num">${won(r.unit_price)}</td></tr>`).join("")}</tbody>
    </table>
    <div class="modal-foot">
      <span></span>
      <div class="right">
        <button class="btn" data-act="close">닫기</button>
        <button class="btn primary" data-act="add-to-list" data-name="${esc(s.product)}">장보기 목록에 추가</button>
      </div>
    </div>`);
}

// ═══ 장보기 ══════════════════════════════════════════════════════════════

async function renderShopping() {
  const data = await api("/api/shopping");
  const open = data.items.filter((i) => !i.checked);
  const done = data.items.filter((i) => i.checked);

  view.innerHTML = `
    <div class="toolbar"><h1>장보기 목록</h1></div>
    <div class="grid two list-first">
      <section class="panel">
        <form class="add-form" id="add-form" autocomplete="off">
          <input name="name" placeholder="살 것 추가 (예: 우유)" list="shop-products" aria-label="품목" required>
          <input name="quantity" type="number" min="1" max="99" value="1" aria-label="수량" class="num">
          <button class="btn primary">추가</button>
        </form>
        <datalist id="shop-products">${data.productNames.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        ${
          data.frequent.length
            ? `<div class="quick-add" role="group" aria-label="자주 산 품목 빠른 추가">${data.frequent
                .map(
                  (f) => `
              <button class="quick-chip ${f.quantity ? "on" : ""}" data-act="add-to-list" data-name="${esc(f.product)}">
                ${esc(f.product)}${f.quantity ? ` <span class="num">×${f.quantity}</span>` : ""}
              </button>`,
                )
                .join("")}</div>`
            : ""
        }
        ${
          data.items.length === 0
            ? `<div class="empty"><strong>목록이 비어 있어요</strong>살 것을 적어 두면 영수증을 저장할 때 산 품목이 자동으로 체크돼요.</div>`
            : `
          <div>${open.map(checkItem).join("") || `<div class="empty" style="padding:16px">모두 샀어요 🎉</div>`}</div>
          ${done.length ? `<div class="subhead">산 것 ${done.length}개</div><div>${done.map(checkItem).join("")}</div>` : ""}
          <div class="list-foot">
            <div class="estimate">예상 금액<strong class="num">${won(data.estimate)}</strong>
              ${data.unpriced ? `<div style="font-size:12px">가격 기록이 없는 ${data.unpriced}개는 빠져 있어요</div>` : ""}
            </div>
            ${done.length ? `<button class="btn small" data-act="clear-checked">산 것 정리</button>` : ""}
          </div>`
        }
      </section>
      <section class="panel">
        <h2>다 떨어졌을지도 몰라요</h2>
        ${
          data.suggestions.length
            ? data.suggestions
                .map(
                  (s) => `
              <div class="suggest">
                <div>
                  <div class="name">${esc(s.product)}</div>
                  <div class="meta">보통 ${Math.round(s.avgInterval)}일마다 구매 · 마지막 ${s.daysSince}일 전 · ${won(s.lastPrice)}</div>
                </div>
                <button class="btn small" data-act="add-to-list" data-name="${esc(s.product)}">추가</button>
              </div>`,
                )
                .join("")
            : `<div class="empty" style="padding:16px">같은 품목을 두 번 이상 사면 구매 주기를 계산해서 살 때가 된 품목을 알려 드려요.</div>`
        }
      </section>
    </div>`;

  $("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    await addToList(f.name.value, Number(f.quantity.value));
  });
}

function checkItem(i) {
  const p = i.price;
  let hint = "가격 기록 없음";
  if (p) {
    hint = `최근 ${won(p.last.price)} · ${esc(p.last.store)}`;
    if (p.min.price < p.last.price) hint += ` · <span class="cheap">최저 ${won(p.min.price)} (${esc(p.min.store)})</span>`;
    if (p.product !== i.name) hint = `${esc(p.product)} 기준 · ${hint}`;
  }
  return `
    <div class="check-item ${i.checked ? "done" : ""}">
      <input type="checkbox" data-act="toggle" data-id="${i.id}" ${i.checked ? "checked" : ""} aria-label="${esc(i.name)} 체크">
      <div style="min-width:0"><div class="name">${esc(i.name)}</div><div class="hint">${hint}</div></div>
      ${i.checked ? `<span></span>` : `
        <div class="qty">
          <button data-act="qty" data-id="${i.id}" data-q="${i.quantity - 1}" ${i.quantity <= 1 ? "disabled" : ""} aria-label="수량 줄이기">−</button>
          <span class="num">${i.quantity}</span>
          <button data-act="qty" data-id="${i.id}" data-q="${i.quantity + 1}" aria-label="수량 늘리기">+</button>
        </div>`}
      <button class="icon-btn" data-act="remove-item" data-id="${i.id}" aria-label="삭제">×</button>
    </div>`;
}

async function addToList(name, quantity = 1) {
  name = name.trim();
  if (!name) return;
  const res = await api("/api/shopping", { method: "POST", body: { name, quantity } });
  toast(res.merged ? `‘${name}’ 수량을 늘렸어요` : `‘${name}’ 추가했어요`);
  if (state.tab === "shopping") renderShopping();
}

// ═══ 클릭 위임 ═══════════════════════════════════════════════════════════

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const { act, id, name } = el.dataset;

  try {
    switch (act) {
      case "close":
        return closeModal();
      case "month":
        state.month = shiftMonth(state.month, Number(el.dataset.delta));
        return renderLedger();
      case "scan":
        return $("#camera-input").click();
      case "pick":
        return $("#file-input").click();
      case "settings":
        return await openSettings();
      case "clear-key":
        await applyKey(null);
        return toast("API 키를 지웠어요");
      case "manual":
        await loadProductNames();
        return openEditor({ draft: null });
      case "open-receipt":
        return await openReceiptDetail(id);
      case "edit-receipt": {
        const r = await api(`/api/receipts/${id}`);
        await loadProductNames();
        return openEditor({ draft: { ...r, total: null }, receiptId: Number(id), imageUrl: r.imageUrl });
      }
      case "delete-receipt":
        if (!confirm("이 영수증을 삭제할까요? 되돌릴 수 없어요.")) return;
        await api(`/api/receipts/${id}`, { method: "DELETE" });
        closeModal();
        toast("삭제했어요");
        return render();
      case "add-row": {
        $("#items").insertAdjacentHTML("beforeend", itemRow(emptyItem()));
        return $("#items .item-row:last-child input").focus();
      }
      case "remove-row":
        el.closest(".item-row").remove();
        return updateTotal();
      case "open-product":
        return await openProduct(name);
      case "add-to-list":
        await addToList(name);
        if (modal.open) closeModal();
        return;
      case "toggle":
        await api(`/api/shopping/${id}`, { method: "PATCH", body: { checked: el.checked } });
        return renderShopping();
      case "qty":
        await api(`/api/shopping/${id}`, { method: "PATCH", body: { quantity: Number(el.dataset.q) } });
        return renderShopping();
      case "remove-item":
        await api(`/api/shopping/${id}`, { method: "DELETE" });
        return renderShopping();
      case "clear-checked": {
        const { removed } = await api("/api/shopping/checked", { method: "DELETE" });
        toast(`${removed}개 정리했어요`);
        return renderShopping();
      }
    }
  } catch (err) {
    toast(err.message);
  }
});

// ─── 시작 ────────────────────────────────────────────────────────────────

// 안드로이드 뒤로 가기: 창 닫기 → 첫 탭으로 → 앱 내리기
App.addListener("backButton", () => {
  if (modal.open) return closeModal();
  if (state.tab !== DEFAULT_TAB) return setTab(DEFAULT_TAB);
  App.minimizeApp();
}).catch(() => {}); // 브라우저에서 열었을 때는 플러그인이 없다

(async function init() {
  try {
    await store.load();
    state.status = await api("/api/status");
  } catch (err) {
    view.innerHTML = `<div class="panel empty"><strong>데이터를 열 수 없어요</strong>${esc(err.message)}</div>`;
    return;
  }
  state.month = state.status.today.slice(0, 7);
  setTab(location.hash.slice(1) || DEFAULT_TAB);
})();
