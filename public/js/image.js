// 이미지 리사이즈 - 여러 장 일괄 처리 (Canvas)

(function () {
  const input = document.getElementById("imageInput");
  const drop = document.getElementById("imageDrop");
  const editor = document.getElementById("imageEditor");
  const list = document.getElementById("imageList");
  const modeEl = document.getElementById("imageMode");
  const fieldA = document.getElementById("fieldA");
  const fieldB = document.getElementById("fieldB");
  const labelA = document.getElementById("labelA");
  const labelB = document.getElementById("labelB");
  const inputA = document.getElementById("imageA");
  const inputB = document.getElementById("imageB");
  const formatEl = document.getElementById("imageFormat");
  const qualityEl = document.getElementById("imageQuality");
  const resizeBtn = document.getElementById("imageResize");
  const status = document.getElementById("imageStatus");

  let items = []; // { file, srcBlob, url, w, h, isHeic }

  wireDropzone(drop, input, async (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || isHeicFile(f));
    if (!imgs.length) {
      setStatus(status, "이미지 파일이 없습니다.", "err");
      return;
    }
    setStatus(status, `${imgs.length}개 불러오는 중…`, "work");
    try {
      const loaded = [];
      for (let i = 0; i < imgs.length; i++) {
        setStatus(status, `불러오는 중… (${i + 1}/${imgs.length})`, "work");
        const it = await loadItem(imgs[i]);
        if (it) loaded.push(it);
      }
      items = items.concat(loaded);
      editor.classList.remove("hidden");
      renderList();
      setStatus(status, `${items.length}개 준비됨. 크기를 정하고 저장하세요.`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "불러오기 실패: " + err.message, "err");
    }
  });

  async function loadItem(file) {
    const heic = isHeicFile(file);
    // HEIC는 브라우저가 캔버스로 못 그리므로 libheif로 먼저 JPEG로 변환
    let srcBlob = file;
    if (heic) srcBlob = await heicToBlob(file);
    const bitmap = await createImageBitmap(srcBlob);
    const w = bitmap.width;
    const h = bitmap.height;
    if (bitmap.close) bitmap.close();
    const url = URL.createObjectURL(srcBlob);
    return { file, srcBlob, url, w, h, isHeic: heic };
  }

  function renderList() {
    list.innerHTML = "";
    items.forEach((it, idx) => {
      const div = document.createElement("div");
      div.className = "thumb";
      const im = document.createElement("img");
      im.src = it.url;
      const cap = document.createElement("div");
      const tgt = targetSize(it.w, it.h);
      cap.innerHTML = `${it.file.name}<br>${it.w}×${it.h} → <b>${tgt.w}×${tgt.h}</b>`;
      const rm = document.createElement("a");
      rm.innerHTML = '<i data-lucide="x" class="h-3.5 w-3.5"></i> 제거';
      rm.href = "#";
      rm.addEventListener("click", (e) => {
        e.preventDefault();
        items.splice(idx, 1);
        renderList();
      });
      div.appendChild(im);
      div.appendChild(cap);
      div.appendChild(rm);
      list.appendChild(div);
    });
    resizeBtn.disabled = items.length === 0;
    refreshIcons();
  }

  // 모드에 따라 입력 필드 라벨/표시 조정
  function syncFields() {
    const mode = modeEl.value;
    fieldB.classList.add("hidden");
    if (mode === "long") {
      labelA.textContent = "긴 변 (px)";
    } else if (mode === "width") {
      labelA.textContent = "너비 (px)";
    } else if (mode === "height") {
      labelA.textContent = "높이 (px)";
    } else if (mode === "percent") {
      labelA.textContent = "비율 (%)";
      if (parseFloat(inputA.value) > 100) inputA.value = 50;
    } else if (mode === "exact") {
      labelA.textContent = "너비 (px)";
      labelB.textContent = "높이 (px)";
      fieldB.classList.remove("hidden");
    }
    renderList();
  }
  modeEl.addEventListener("change", syncFields);
  inputA.addEventListener("input", renderList);
  inputB.addEventListener("input", renderList);

  // 원본 크기 → 목표 크기 계산
  function targetSize(w, h) {
    const mode = modeEl.value;
    const a = Math.max(1, parseFloat(inputA.value) || 0);
    if (mode === "long") {
      const ratio = a / Math.max(w, h);
      return { w: Math.round(w * ratio), h: Math.round(h * ratio) };
    }
    if (mode === "width") {
      return { w: Math.round(a), h: Math.round(h * (a / w)) };
    }
    if (mode === "height") {
      return { w: Math.round(w * (a / h)), h: Math.round(a) };
    }
    if (mode === "percent") {
      const p = a / 100;
      return { w: Math.max(1, Math.round(w * p)), h: Math.max(1, Math.round(h * p)) };
    }
    // exact
    const b = Math.max(1, parseFloat(inputB.value) || 0);
    return { w: Math.round(a), h: Math.round(b) };
  }

  async function resizeOne(it) {
    const { w, h } = targetSize(it.w, it.h);

    let format = formatEl.value;
    if (format === "keep") {
      // HEIC는 그대로 못 내보내므로 JPEG, 그 외엔 원본 타입 유지
      format = it.isHeic ? "image/jpeg" : (it.srcBlob.type || "image/png");
    }
    // 캔버스가 인코딩 못 하는 포맷은 PNG로 대체
    if (!["image/png", "image/jpeg", "image/webp"].includes(format)) format = "image/png";
    const ext = format === "image/jpeg" ? "jpg" : format === "image/webp" ? "webp" : "png";

    // 정규화된 소스(HEIC는 변환된 JPEG)에서 새로 디코드
    const bitmap = await createImageBitmap(it.srcBlob);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (format === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();

    const quality = parseFloat(qualityEl.value);
    const blob = await new Promise((res) => canvas.toBlob(res, format, quality));
    if (!blob || blob.size === 0) {
      throw new Error(`${it.file.name} 인코딩 실패 (${format})`);
    }
    return { name: `${stripExt(it.file.name)}_${w}x${h}.${ext}`, blob };
  }

  resizeBtn.addEventListener("click", async () => {
    if (!items.length) return;
    resizeBtn.disabled = true;
    setStatus(status, "리사이즈 중…", "work");
    try {
      const results = [];
      for (let i = 0; i < items.length; i++) {
        setStatus(status, `리사이즈 중… (${i + 1}/${items.length})`, "work");
        results.push(await resizeOne(items[i]));
      }

      if (results.length === 1) {
        downloadBlob(results[0].blob, results[0].name);
        setStatus(status, "완료! 이미지를 저장했습니다.", "ok");
      } else {
        setStatus(status, "ZIP으로 묶는 중…", "work");
        const zip = new JSZip();
        results.forEach((r) => zip.file(r.name, r.blob));
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `resized_${results.length}.zip`);
        setStatus(status, `완료! ${results.length}개를 ZIP으로 저장했습니다.`, "ok");
      }
    } catch (err) {
      console.error(err);
      setStatus(status, "리사이즈 실패: " + err.message, "err");
    } finally {
      resizeBtn.disabled = false;
    }
  });

  syncFields();
})();
