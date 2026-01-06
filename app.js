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
  { label: "전속관할", re: /(전속\s*관할|관할\s*법원)/g },
  { label: "중개사 책임 전면 부인", re: /(개업공인중개사).{0,40}(일체\s*책임|책임을\s*지지\s*않)/g },
];

function scanRisk(text) {
  const found = [];
  for (const r of RISK_REGEX) {
    if (r.re.test(text)) found.push(r.label);
    r.re.lastIndex = 0;
  }
  return found;
}

/* =========================
   Similarity (3-gram)
========================= */
function shingle3(str) {
  const s = normalizeForSearch(str);
  const set = new Set();
  for (let i = 0; i < Math.max(0, s.length - 2); i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

function jaccard(aSet, bSet) {
  if (aSet.size === 0 && bSet.size === 0) return 1;
  let inter = 0;
  for (const v of aSet) if (bSet.has(v)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union === 0 ? 0 : inter / union;
}

function containment(aSet, bSet) {
  // a ⊆ b 의 정도 = |a ∩ b| / |a|
  if (aSet.size === 0) return 0;
  let inter = 0;
  for (const v of aSet) if (bSet.has(v)) inter++;
  return inter / aSet.size;
}

/* =========================
   OCR Cleanup (노이즈 완화)
========================= */
function collapseSpacedLetters(line) {
  // "본 아 파 트 에 대 하 여" 같은 '한 글자씩 띄어쓰기'를 부분적으로 축약
  // 최소 4개 이상의 단일문자 토큰이 연속될 때만 작동
  const pattern = /(?:^|\s)(?:[가-힣A-Za-z0-9]\s){4,}[가-힣A-Za-z0-9](?:\s|$)/g;
  return line.replace(pattern, (m) => m.replace(/\s+/g, ""));
}

function cleanOcrText(text) {
  if (!text) return "";

  // ¶ → 줄바꿈
  let t = text.replace(/¶/g, "\n");

  // 공백 정리
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");

  // 줄 단위로 정리
  const rawLines = t.split("\n").map(x => x.trim()).filter(Boolean);

  // 1) '한 글자 띄어쓰기' 축약
  const collapsedLines = rawLines.map(collapseSpacedLetters);

  // 2) 유사한 중복 라인 제거(공백 제거 키 기준)
  const uniq = [];
  const seen = new Set();
  for (const ln of collapsedLines) {
    const key = ln.replace(/\s+/g, "");
    if (key.length < 2) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(ln);
  }

  return uniq.join("\n");
}

/* =========================
   UI Helpers
========================= */
function setProgress(msg) {
  progressEl.textContent = msg || "";
}

function setStandardMeta() {
  const len = (standardTextEl.value || "").length;
  standardMetaEl.textContent = `표준 텍스트 길이: ${len.toLocaleString()} 글자`;
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderResult(payload) {
  const {
    templateType,
    stdHits,
    aptHits,
    ocrLength,
    imageCount,
    missingAnchorsStandard,
    missingAnchorsDetected,
    risks,
    containActualInStandard,
    containStandardInActual,
    jaccardScore,
  } = payload;

  const templateLabel =
    templateType === "STANDARD" ? "표준계약서 서식(추정)" :
    templateType === "APT" ? "아파트 전세 계약서/비표준 서식(추정)" :
    "서식 불명(추정)";

  const missStdHtml = missingAnchorsStandard.length
    ? `<ul>${missingAnchorsStandard.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
    : `<div>없음</div>`;

  const missDetHtml = missingAnchorsDetected.length
    ? `<ul>${missingAnchorsDetected.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
    : `<div>없음</div>`;

  const risksHtml = risks.length
    ? `<ul>${risks.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
    : `<div>없음</div>`;

  resultBox.innerHTML = `
    <div><b>템플릿 감지:</b> ${escapeHtml(templateLabel)} (표준 앵커 ${stdHits}/${STANDARD_ANCHORS.length}, 아파트 앵커 ${aptHits}/${APT_ANCHORS.length})</div>
    <div><b>OCR 입력:</b> 사진 ${imageCount}장, OCR 글자수(정리 후): ${ocrLength.toLocaleString()}</div>
    <hr/>

    <div><b>포함률(실제→표준):</b> ${containActualInStandard}%</div>
    <div class="muted">촬영한(인식된) 내용이 표준 텍스트 안에 얼마나 포함되는지 (부분 촬영에 강함)</div>

    <div style="margin-top:8px;"><b>포함률(표준→실제):</b> ${containStandardInActual}%</div>
    <div class="muted">표준 텍스트가 OCR 결과에 얼마나 커버되는지 (부분 촬영이면 낮아질 수 있음)</div>

    <div style="margin-top:8px;"><b>전체유사도(Jaccard):</b> ${jaccardScore}%</div>
    <div class="muted">양쪽 전체를 대칭 비교하는 점수 (길이 차이/노이즈에 민감)</div>

    <hr/>
    <div><b>표준 앵커 누락(참고):</b>${missStdHtml}</div>
    <hr/>
    <div><b>감지된 템플릿 앵커 누락(중요):</b>${missDetHtml}</div>
    <hr/>
    <div><b>주의 문구(키워드 기반):</b>${risksHtml}</div>
  `;
}

function renderDiff(stdText, actText) {
  if (typeof diff_match_patch === "undefined") {
    diffBox.textContent = "diff 라이브러리를 불러오지 못했습니다. (네트워크/CDN 차단 가능)";
    return;
  }

  // 너무 길면 모바일이 버벅이므로 일부만
  const MAX_CHARS = 6000;
  const s = (stdText || "").slice(0, MAX_CHARS);
  const a = (actText || "").slice(0, MAX_CHARS);

  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(s, a);
  dmp.diff_cleanupSemantic(diffs);
  diffBox.innerHTML = dmp.diff_prettyHtml(diffs);
}

/* =========================
   Load standard.txt
========================= */
async function loadStandardTxt() {
  standardStatusEl.textContent = "standard.txt 불러오는 중...";
  try {
    const res = await fetch("standard.txt", { cache: "no-store" });
    if (!res.ok) throw new Error("standard.txt fetch failed");
    loadedStandardText = await res.text();
    standardTextEl.value = loadedStandardText;
    standardStatusEl.textContent = "standard.txt 로드 완료";
    setStandardMeta();
  } catch (e) {
    standardStatusEl.textContent = "standard.txt 로드 실패(파일이 없거나 권한/경로 문제)";
    setStandardMeta();
  }
}

reloadStandardBtn.addEventListener("click", loadStandardTxt);
standardTextEl.addEventListener("input", setStandardMeta);

/* =========================
   Image preview (multiple)
========================= */
function renderPreviews(files) {
  previewListEl.innerHTML = "";
  if (!files || files.length === 0) {
    imageStatusEl.textContent = "선택된 사진 없음";
    return;
  }
  imageStatusEl.textContent = `선택된 사진: ${files.length}장`;

  for (const file of files) {
    const url = URL.createObjectURL(file);
    const wrap = document.createElement("div");
    wrap.className = "thumbWrap";

    const img = document.createElement("img");
    img.className = "thumb";
    img.src = url;
    img.alt = file.name;

    const cap = document.createElement("div");
    cap.className = "thumbCap muted";
    cap.textContent = file.name.length > 18 ? (file.name.slice(0, 18) + "…") : file.name;

    wrap.appendChild(img);
    wrap.appendChild(cap);
    previewListEl.appendChild(wrap);
  }
}

imageInput.addEventListener("change", () => {
  const files = Array.from(imageInput.files || []);
  renderPreviews(files);
});

clearImagesBtn.addEventListener("click", () => {
  imageInput.value = "";
  renderPreviews([]);
});

/* =========================
   OCR + Compare
========================= */
async function runOCRAndCompare() {
  const files = Array.from(imageInput.files || []);
  if (files.length === 0) {
    alert("계약서 사진을 먼저 선택/촬영해 주세요.");
    return;
  }

  const std = (standardTextEl.value || "").trim();
  if (std.length < 500) {
    alert("표준계약서 텍스트(standard.txt)가 비어있거나 너무 짧습니다. standard.txt에 표준계약서 전체 텍스트를 넣어주세요.");
    return;
  }

  runBtn.disabled = true;
  resultBox.innerHTML = "처리 중...";
  diffBox.innerHTML = "";

  try {
    setProgress("OCR 워커 준비 중...");

    const worker = await Tesseract.createWorker({
      logger: (m) => {
        if (m?.status && typeof m.progress === "number") {
          setProgress(`${m.status} ${(m.progress * 100).toFixed(0)}%`);
        }
      },
      // 특정 네트워크에서 언어데이터 로드가 막히면 아래 langPath를 고려하세요.
      // langPath: "https://tessdata.projectnaptha.com/4.0.0"
    });

    await worker.loadLanguage("kor");
    await worker.initialize("kor");

    let combinedRaw = "";
    for (let i = 0; i < files.length; i++) {
      setProgress(`OCR 인식 중... (${i + 1}/${files.length})`);
      const { data } = await worker.recognize(files[i]);
      combinedRaw += "\n\n" + (data?.text || "");
    }

    await worker.terminate();
    setProgress("");

    const actual = cleanOcrText(combinedRaw);
    const stdClean = (std || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // 템플릿 감지 및 앵커
    const template = detectTemplate(actual);
    const missingAnchorsStandard = findMissingAnchors(actual, STANDARD_ANCHORS);
    const detectedAnchors = template.type === "APT" ? APT_ANCHORS : STANDARD_ANCHORS;
    const missingAnchorsDetected = findMissingAnchors(actual, detectedAnchors);

    // 점수 계산
    const sSet = shingle3(stdClean);
    const aSet = shingle3(actual);

    const containAinS = Math.round(containment(aSet, sSet) * 100);
    const containSinA = Math.round(containment(sSet, aSet) * 100);
    const jacScore = Math.round(jaccard(sSet, aSet) * 100);

    const risks = scanRisk(actual);

    renderResult({
      templateType: template.type,
      stdHits: template.stdHits,
      aptHits: template.aptHits,
      ocrLength: actual.length,
      imageCount: files.length,
      missingAnchorsStandard,
      missingAnchorsDetected,
      risks,
      containActualInStandard: containAinS,
      containStandardInActual: containSinA,
      jaccardScore: jacScore,
    });

    renderDiff(stdClean, actual);

  } catch (e) {
    console.error(e);
    setProgress("");
    alert("OCR 또는 비교 중 오류가 발생했습니다. (네트워크/언어데이터/브라우저 권한/메모리 제한을 확인하세요)");
    resultBox.innerHTML = "오류가 발생했습니다. 다시 시도해 주세요.";
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", runOCRAndCompare);

/* =========================
   Init
========================= */
(function init() {
  loadStandardTxt();
  renderPreviews([]);
})();
