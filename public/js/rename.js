// 파일명 수정 — 맥 NFD(자모 분리)로 깨진 한글 파일명을 NFC로 자동 정상화하고,
// 필요하면 직접 편집한 뒤 원본 내용 그대로 다시 내려받는다. 파일 내용은 변형하지 않는다.

(function () {
  const input = document.getElementById("renameInput");
  const drop = document.getElementById("renameDrop");
  const list = document.getElementById("renameList");
  const actions = document.getElementById("renameActions");
  const zipBtn = document.getElementById("renameZip");
  const status = document.getElementById("renameStatus");

  let items = []; // { file, value } — value: 수정된 전체 파일명(확장자 포함)

  // 맥은 한글을 NFD로 저장 → 다른 곳에서 깨져 보임. NFC로 합치면 정상화된다(멱등).
  function fixName(name) {
    return name.normalize("NFC");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function render() {
    list.innerHTML = "";
    items.forEach((it, i) => {
      const changed = it.file.name !== it.value;
      const li = document.createElement("li");

      const orig = document.createElement("div");
      orig.className = "orig";
      orig.innerHTML =
        `<i data-lucide="file" class="h-3.5 w-3.5"></i>` +
        `<span class="fn">${escapeHtml(it.file.name)}</span>` +
        (changed ? `<span class="badge">자동 수정됨</span>` : "");

      const row = document.createElement("div");
      row.className = "row";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = it.value;
      nameInput.spellcheck = false;
      nameInput.addEventListener("input", () => {
        items[i].value = nameInput.value;
      });

      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "btn-ghost";
      dl.innerHTML = `<i data-lucide="download" class="h-4 w-4"></i> 저장`;
      dl.addEventListener("click", () => {
        const fn = (items[i].value || "").trim() || it.file.name;
        downloadBlob(it.file, fn);
      });

      row.appendChild(nameInput);
      row.appendChild(dl);
      li.appendChild(orig);
      li.appendChild(row);
      list.appendChild(li);
    });
    actions.classList.toggle("hidden", items.length < 2);
    refreshIcons();
  }

  wireDropzone(drop, input, (files) => {
    [...files].forEach((f) => items.push({ file: f, value: fixName(f.name) }));
    const fixed = items.filter((it) => it.file.name !== it.value).length;
    setStatus(
      status,
      `${items.length}개 파일 · 자동 수정 ${fixed}개. 필요하면 이름을 직접 고친 뒤 저장하세요.`,
      fixed ? "ok" : ""
    );
    render();
  });

  // 여러 파일을 한 번에: ZIP으로 묶어 저장 (수정된 이름으로)
  zipBtn.addEventListener("click", async () => {
    if (!items.length) return;
    if (!window.JSZip) {
      setStatus(status, "JSZip 로드 실패 (네트워크 확인).", "err");
      return;
    }
    setStatus(status, "ZIP 생성 중…", "work");
    try {
      const zip = new JSZip();
      const seen = new Map(); // 같은 이름 충돌 시 " (n)" 접미사로 구분
      for (const it of items) {
        let fn = (it.value || "").trim() || it.file.name;
        if (seen.has(fn)) {
          const n = seen.get(fn) + 1;
          seen.set(fn, n);
          const base = stripExt(fn);
          const ext = fn.slice(base.length);
          fn = `${base} (${n})${ext}`;
        } else {
          seen.set(fn, 1);
        }
        zip.file(fn, it.file);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "renamed.zip");
      setStatus(status, `완료 — ${items.length}개 파일을 ZIP으로 저장했습니다.`, "ok");
    } catch (e) {
      console.error(e);
      setStatus(status, "ZIP 생성 실패: " + (e.message || e), "err");
    }
  });
})();
