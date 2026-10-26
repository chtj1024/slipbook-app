// 폰 안(IndexedDB)에 데이터를 저장한다.
// 영수증·장보기 목록은 작아서 한 덩어리로 들고 있다가 바뀔 때마다 통째로 저장하고,
// 용량이 큰 영수증 사진만 따로 저장한다.

const DB_NAME = "slipbook";
let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
      req.result.createObjectStore("images");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const emptyData = () => ({ receipts: [], shopping: [], seq: { receipt: 0, shopping: 0 } });

let data;

export async function load() {
  data = (await run("kv", "readonly", (s) => s.get("data"))) ?? emptyData();
  // 저장 공간이 부족할 때 OS가 데이터를 지우지 않도록 요청
  navigator.storage?.persist?.().catch(() => {});
  return data;
}

export const getData = () => data;

export const save = () => run("kv", "readwrite", (s) => s.put(data, "data"));

export const nextId = (kind) => ++data.seq[kind];

export const getSetting = (key) => run("kv", "readonly", (s) => s.get(`setting:${key}`));
export const setSetting = (key, value) =>
  run("kv", "readwrite", (s) => (value ? s.put(value, `setting:${key}`) : s.delete(`setting:${key}`)));

export const getImage = (id) => run("images", "readonly", (s) => s.get(id));
export const putImage = (id, dataUrl) => run("images", "readwrite", (s) => s.put(dataUrl, id));
export const deleteImage = (id) => run("images", "readwrite", (s) => s.delete(id));
