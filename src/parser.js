import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "./categories.js";

const MODEL = "claude-opus-5-5";

export class ParseError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

let client;
let clientKey;
function getClient(apiKey) {
  // 폰에서 바로 Claude API를 부른다. 키는 이 폰에만 저장된다.
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    clientKey = apiKey;
  }
  return client;
}

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    product: { type: "string" },
    category: { type: "string", enum: CATEGORIES },
    quantity: { type: "number" },
    unit_price: { type: "integer" },
    amount: { type: "integer" },
  },
  required: ["name", "product", "category", "quantity", "unit_price", "amount"],
  additionalProperties: false,
};

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    store: { type: "string" },
    date: { type: "string" },
    total: { type: "integer" },
    items: { type: "array", items: ITEM_SCHEMA },
  },
  required: ["is_receipt", "store", "date", "total", "items"],
  additionalProperties: false,
};

const SYSTEM = `한국 종이 영수증 사진을 읽어 가계부와 물가 추적에 쓸 데이터로 옮깁니다.

- store: 상호명. 지점명이 있으면 포함합니다 (예: "이마트 성수점").
- date: 거래일, YYYY-MM-DD. 연도가 두 자리면 20xx로 읽습니다. 보이지 않으면 빈 문자열.
- total: 실제 결제한 최종 금액 (할인 후).
- items: 구매한 품목을 한 줄씩.
  - name: 영수증에 찍힌 표기 그대로.
  - product: 같은 상품의 가격을 영수증끼리 비교하기 위한 표준 품목명. "브랜드 상품명 용량" 꼴로 사람이 읽기 좋게 씁니다 (예: "서울우유 1L", "신라면 5입", "깐마늘 500g"). 잘리거나 축약된 표기는 알아볼 수 있는 만큼 풀어 씁니다. 사용자가 준 기존 품목명 목록에 같은 상품이 있으면 그 이름을 글자 그대로 씁니다.
  - category: 품목의 가계부 분류. 마트에서 산 먹거리는 식료품, 식당·카페·배달 영수증의 메뉴는 외식·카페입니다.
  - quantity, unit_price(1개 또는 1단위 가격), amount(그 줄의 최종 금액).
  - 특정 품목에 붙은 할인은 그 품목의 amount에 반영합니다. 영수증 전체에 붙은 할인(쿠폰, 멤버십 등)은 name과 product가 "할인"인 별도 줄로, amount를 음수로 넣고 category는 가장 많이 산 분류로 둡니다.
  - 부가세, 과세·면세 물품가액, 포인트 적립, 카드 승인 정보, 봉투 보증금 환급 안내 같은 줄은 품목이 아닙니다.
- 영수증이 아니거나 글자를 읽을 수 없으면 is_receipt를 false로 하고 items는 빈 배열로 둡니다.`;

/**
 * 영수증 이미지 하나를 구조화된 초안으로 바꾼다. 결과는 사용자가 검토·수정한 뒤 저장한다.
 */
export async function parseReceipt({ apiKey, base64, mediaType, knownProducts, today }) {
  const known = knownProducts.length
    ? `기존 품목명 목록:\n${knownProducts.join("\n")}`
    : "기존 품목명 목록: (아직 없음)";

  let response;
  try {
    response = await getClient(apiKey).beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RECEIPT_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: `오늘 날짜: ${today}\n\n${known}\n\n이 영수증을 읽어 주세요.` },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ParseError("API 키가 올바르지 않습니다. 설정에서 키를 확인하세요.", 401);
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      throw new ParseError("이 API 키로는 모델을 사용할 권한이 없습니다.", 403);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ParseError("요청이 너무 많습니다. 잠시 후 다시 시도하세요.", 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new ParseError(`요청이 거부되었습니다: ${err.message}`, 400);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ParseError("Claude API에 연결할 수 없습니다. 인터넷 연결을 확인하세요.", 502);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ParseError(`Claude API 오류 (${err.status}): ${err.message}`, 502);
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new ParseError("이 이미지는 분석할 수 없습니다. 직접 입력해 주세요.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ParseError("영수증이 너무 길어 응답이 잘렸습니다. 나눠서 찍어 주세요.", 422);
  }

  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new ParseError("분석 결과가 비어 있습니다.", 502);

  const parsed = JSON.parse(text);
  if (!parsed.is_receipt || parsed.items.length === 0) {
    throw new ParseError("영수증을 읽지 못했습니다. 더 밝고 반듯하게 다시 찍어 보세요.", 422);
  }
  return parsed;
}
