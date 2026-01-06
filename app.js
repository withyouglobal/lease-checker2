/* =========================
   DOM
========================= */
const standardTextEl = document.getElementById("standardText");
const reloadStandardBtn = document.getElementById("reloadStandard");
const standardStatusEl = document.getElementById("standardStatus");
const standardMetaEl = document.getElementById("standardMeta");

const imageInput = document.getElementById("imageInput");
const clearImagesBtn = document.getElementById("clearImages");
const imageStatusEl = document.getElementById("imageStatus");
const previewListEl = document.getElementById("previewList");

const runBtn = document.getElementById("runBtn");
const progressEl = document.getElementById("progress");
const resultBox = document.getElementById("resultBox");
const diffBox = document.getElementById("diffBox");

let loadedStandardText = "";

/* =========================
   Anchors / Template
========================= */
const STANDARD_ANCHORS = [
  "임차주택의 표시",
  "계약내용",
  "특약사항",
  "제1조",
  "제2조",
  "제3조",
];

const APT_ANCHORS = [
  "아파트의 표시",
  "계약내용",
  "특약사항",
  "제1조",
  "제2조",
  "제3조",
];

function normalizeForSearch(s) {
  return (s || "")
    .replace(/\s+/g, "")
    .replace(/[^\uAC00-\uD7A3A-Za-z0-9]/g, "")
    .toLowerCase();
}

function countAnchorHits(text, anchors) {
  const t = normalizeForSearch(text);
  let hit = 0;
  for (const a of anchors) {
    if (t.includes(normalizeForSearch(a))) hit++;
  }
  return hit;
}

function detectTemplate(text) {
  const stdHits = countAnchorHits(text, STANDARD_ANCHORS);
  const aptHits = countAnchorHits(text, APT_ANCHORS);

  // 제목 기반 힌트(아파트 전세 계약서 문구가 자주 등장)
  const t = normalizeForSearch(text);
  const hasAptTitle = t.includes(normalizeForSearch("아파트전세계약서")) || t.includes(normalizeForSearch("아파트전세계약서"));

  if (stdHits >= 4 && stdHits >= aptHits) return { type: "STANDARD", stdHits, aptHits };
  if (aptHits >= 4 || hasAptTitle) return { type: "APT", stdHits, aptHits };
  return { type: "UNKNOWN", stdHits, aptHits };
}

function findMissingAnchors(text, anchors) {
  const t = normalizeForSearch(text);
  return anchors.filter(a => !t.includes(normalizeForSearch(a)));
}

/* =========================
   Risk Terms (키워드 탐지)
========================= */
const RISK_REGEX = [
  { label: "면책/책임제한", re: /(면책|책임\s*없|일체\s*책임|책임\s*제한)/g },
  { label: "일방 해지/해제", re: /(일방적(으로)?\s*(해지|해제)|임의\s*(해지|해제)|즉시\s*(해지|해제))/g },
  { label: "과도한 위약금/배상", re: /(위약금|손해배상|배상금).{0,30}(전액|2배|배액|3배|삼배)/g },
  { label: "권리 포기 강요", re: /(포기한다|권리를\s*포기|이의\s*제기\s*하지\s*않)/g },
  { label: "전속관할",
