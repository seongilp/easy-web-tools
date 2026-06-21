// 공통 유틸리티

// 동적으로 추가한 lucide 아이콘(<i data-lucide>)을 SVG로 렌더
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

// 상태 메시지 표시
function setStatus(el, message, type = "") {
  el.textContent = message;
  el.className = "status" + (type ? " " + type : "");
}

// Blob을 파일로 다운로드
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 약간의 지연 후 메모리 해제
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 파일명에서 확장자 제거
function stripExt(name) {
  return name.replace(/\.[^/.]+$/, "");
}

// 초를 mm:ss 형태로
function formatTime(sec) {
  if (!isFinite(sec)) return "–";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s} (${sec.toFixed(1)}s)`;
}

// 드래그&드롭 영역을 파일 입력과 연결
// 주의: dropEl이 <label>이고 inputEl을 감싸고 있으면 클릭은 브라우저가
// 자동 처리하므로 여기서 input.click()을 호출하면 안 된다(이중 호출 → 파일창이 바로 닫힘).
function wireDropzone(dropEl, inputEl, onFiles) {
  inputEl.addEventListener("change", () => {
    if (inputEl.files.length) onFiles(inputEl.files);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropEl.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropEl.classList.remove("dragover");
    })
  );
  dropEl.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length) onFiles(files);
  });
}
