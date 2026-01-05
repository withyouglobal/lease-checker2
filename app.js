const standardTextEl = document.getElementById("standardText");
const reloadStandardBtn = document.getElementById("reloadStandard");
const standardStatusEl = document.getElementById("standardStatus");

const imageInput = document.getElementById("imageInput");
const previewImg = document.getElementById("previewImg");

const runBtn = document.getElementById("runBtn");
const progressEl = document.getElementById("progress");
const resultBox = document.getElementById("resultBox");
const diffBox = document.getElementById("diffBox");

let loadedStandardText = "";

const EXPECTED_ANCHORS = [
  "임차주택의 표시",
  "계약내용",
  "특약사항",
  "제1조",
  "제2조",
  "제3조",
];

const RISK_REGEX = [
  { label: "면책/책임제한", re: /(면책|책임\s*없|일체\s*책임|책임\s*제한)/g },
  { label: "일방 해지/해제", re: /(일방적(으로)?\s*(해지|해제)|임의\s*(해지|해제)|즉시\s*(해지|해제))/g },
  { label: "과도한 위약금/배상", re: /(위약금|손해배상|배상금).{0,20}(전액|2배|배액|3배|삼배)/g },
  { label: "권리 포기 강요", re: /(포기한다|권리를\s*포기|이의\s*제기\s*하지\s*않)/g },
  { label: "전속관할", re: /(전속\s*관할|관할\s*법원)/g },
];

function normalizeForSearch(s) {
  return (s || "")
    .replace(/\s+/g, "")
    .replace(/[^\uAC00-\uD7A3A-Za-z0-9]/g, "")
    .toLowerCase();
}

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

function findMissingAnchors(text) {
  const t = normalizeForSearch(text);
  return EXPECTED_ANCHORS.filter(a => !t.includes(normalizeForSearch(a)));
}

function scanRisk(text) {
  const found = [];
  for (const r of RISK_REGEX) {
    if (r.re.test(text)) found.push(r.label);
    r.re.lastIndex = 0;
  }
  return found;
}

async function loadStandardTxt() {
  standardStatusEl.textContent = "standard.txt 불러오는 중...";
  try {
    const res = await fetch("standard.txt", { cache: "no-store" });
    if (!res.ok) throw new Error("standard.txt fetch failed");
    loadedStandardText = await res.text();
    standardTextEl.value = loadedStandardText;
    standardStatusEl.textContent = "standard.txt 로드 완료";
  } catch (e) {
    standardStatusEl.textContent = "standard.txt 로드 실패(파일이 없거나 권한/경로 문제)";
  }
}

reloadStandardBtn.addEventListener("click", loadStandardTxt);

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewImg.style.display = "block";
});

function setProgress(msg) {
  progressEl.textContent = msg || "";
}

function renderResult({ score, missingAnchors, risks, ocrLength }) {
  const missingHtml = missingAnchors.length
    ? `<ul>${missingAnchors.map(x => `<li>${x}</li>`).join("")}</ul>`
    : `<div>없음</div>`;

  const risksHtml = risks.length
    ? `<ul>${risks.map(x => `<li>${x}</li>`).join("")}</ul>`
    : `<div>없음</div>`;

  resultBox.innerHTML = `
    <div><b>일치도(유사도):</b> ${score}%</div>
    <div class="muted">OCR 추출 글자수(대략): ${ocrLength}</div>
    <hr/>
    <div><b>표준 서식 앵커 누락(촬영 잘림/각도/OCR 오류 의심):</b>${missingHtml}</div>
    <hr/>
    <div><b>주의 문구(키워드 기반):</b>${risksHtml}</div>
  `;
}

function renderDiff(stdText, actText) {
  if (typeof diff_match_patch === "undefined") {
    diffBox.textContent = "diff 라이브러리를 불러오지 못했습니다.";
    return;
  }
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(stdText, actText);
  dmp.diff_cleanupSemantic(diffs);
  diffBox.innerHTML = dmp.diff_prettyHtml(diffs);
}

async function runOCRAndCompare() {
  const file = imageInput.files?.[0];
  if (!file) {
    alert("계약서 사진을 먼저 선택/촬영해 주세요.");
    return;
  }

  const std = (standardTextEl.value || "").trim();
  if (std.length < 200) {
    alert("표준계약서 텍스트(standard.txt)가 비어있거나 너무 짧습니다. standard.txt에 표준계약서 전체 텍스트를 넣어주세요.");
    return;
  }

  setProgress("OCR 준비 중...");
  runBtn.disabled = true;

  try {
    // Tesseract.js worker 생성 및 언어 설정(한국어)
    const worker = await Tesseract.createWorker({
      logger: (m) => {
        if (m?.status && typeof m.progress === "number") {
          setProgress(`${m.status} ${(m.progress * 100).toFixed(0)}%`);
        }
      },
      // 기본 langPath가 막히는 환경이면 아래 줄을 활성화해 보세요.
      // langPath: "https://tessdata.projectnaptha.com/4.0.0"
    });

    await worker.loadLanguage("kor");
    await worker.initialize("kor");

    setProgress("OCR 인식 중...");
    const { data } = await worker.recognize(file);
    const actual = (data?.text || "").trim();

    await worker.terminate();
    setProgress("");

    // 비교(3-gram Jaccard)
    const sSet = shingle3(std);
    const aSet = shingle3(actual);
    const score = Math.round(jaccard(sSet, aSet) * 100);

    const missingAnchors = findMissingAnchors(actual);
    const risks = scanRisk(actual);

    renderResult({ score, missingAnchors, risks, ocrLength: actual.length });
    renderDiff(std.slice(0, 6000), actual.slice(0, 6000)); // 너무 길면 느려져서 앞부분만

  } catch (e) {
    console.error(e);
    setProgress("");
    alert("OCR 또는 비교 중 오류가 발생했습니다. (네트워크/언어데이터/브라우저 권한을 확인하세요)");
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", runOCRAndCompare);

// 초기 로드
loadStandardTxt();
