// 도장 찍기 — 도장 이미지 1개를 여러 배경 사진 위 한 곳에 일괄 합성

(function () {
  const $ = (id) => document.getElementById(id);
  const baseInput = $("stampBaseInput");
  const baseDrop = $("stampBaseDrop");
  const stampInput = $("stampImgInput");
  const stampDrop = $("stampImgDrop");
  const editorBox = $("stampEditor");
  const canvas = $("stampCanvas");
  const list = $("stampList");
  const sizeEl = $("stampSize");
  const opacityEl = $("stampOpacity");
  const applyBtn = $("stampApply");
  const status = $("stampStatus");

  const PREVIEW_MAX = 900;

  let bases = []; // { file, bitmap, w, h, url }
  let stamp = null; // { bitmap, w, h }
  let pos = { x: 0.85, y: 0.85 }; // 정규화 중심(기본 우하단)
  let dragging = false;

  async function loadBitmap(file) {
    let blob = file;
    if (isHeicFile(file)) blob = await heicToBlob(file);
    return await createImageBitmap(blob);
  }

  // ── 배경 사진 업로드(여러 장) ──
  wireDropzone(baseDrop, baseInput, async (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || isHeicFile(f));
    if (!imgs.length) {
      setStatus(status, "이미지 파일이 없습니다.", "err");
      return;
    }
    setStatus(status, `배경 ${imgs.length}장 불러오는 중…`, "work");
    try {
      for (let i = 0; i < imgs.length; i++) {
        setStatus(status, `배경 불러오는 중… (${i + 1}/${imgs.length})`, "work");
        const bmp = await loadBitmap(imgs[i]);
        const url = bitmapToThumb(bmp);
        bases.push({ file: imgs[i], bitmap: bmp, w: bmp.width, h: bmp.height, url });
      }
      maybeShowEditor();
      renderList();
      render();
      setStatus(status, `배경 ${bases.length}장 준비됨.` + (stamp ? "" : " 이제 도장 이미지를 올리세요."), "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "불러오기 실패: " + err.message, "err");
    }
  });

  // ── 도장 이미지 업로드(1개) ──
  wireDropzone(stampDrop, stampInput, async (files) => {
    const file = files[0];
    if (!file.type.startsWith("image/") && !isHeicFile(file)) {
      setStatus(status, "이미지 파일이 아닙니다.", "err");
      return;
    }
    setStatus(status, "도장 불러오는 중…", "work");
    try {
      const bmp = await loadBitmap(file);
      stamp = { bitmap: bmp, w: bmp.width, h: bmp.height };
      maybeShowEditor();
      render();
      setStatus(status, bases.length ? "준비 완료. 도장을 드래그해 위치를 정하세요." : "도장 준비됨. 배경 사진을 올리세요.", "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "도장 불러오기 실패: " + err.message, "err");
    }
  });

  function maybeShowEditor() {
    if (bases.length && stamp) editorBox.classList.remove("hidden");
  }

  function bitmapToThumb(bmp) {
    const cv = document.createElement("canvas");
    const scale = Math.min(1, 200 / Math.max(bmp.width, bmp.height));
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  }

  function renderList() {
    list.innerHTML = "";
    bases.forEach((b, idx) => {
      const div = document.createElement("div");
      div.className = "thumb";
      const im = document.createElement("img");
      im.src = b.url;
      const cap = document.createElement("div");
      cap.textContent = `${b.file.name} (${b.w}×${b.h})`;
      const rm = document.createElement("a");
      rm.href = "#";
      rm.innerHTML = '<i data-lucide="x" class="h-3.5 w-3.5"></i> 제거';
      rm.addEventListener("click", (e) => {
        e.preventDefault();
        bases.splice(idx, 1);
        if (!bases.length) editorBox.classList.add("hidden");
        renderList();
        render();
      });
      div.appendChild(im);
      div.appendChild(cap);
      div.appendChild(rm);
      list.appendChild(div);
    });
    refreshIcons();
  }

  // ── 미리보기(첫 사진 기준) ──
  function render() {
    if (!bases.length || !stamp) return;
    const base = bases[0];
    const scale = Math.min(1, PREVIEW_MAX / Math.max(base.w, base.h));
    const w = Math.round(base.w * scale);
    const h = Math.round(base.h * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(base.bitmap, 0, 0, w, h);
    drawStamp(ctx, w, h);
  }

  // 도장을 ctx에 그림(중심 정규화 좌표, 크기는 배경 너비 대비 %)
  function drawStamp(ctx, baseW, baseH) {
    const sw = (+sizeEl.value / 100) * baseW;
    const sh = sw * (stamp.h / stamp.w);
    const cx = pos.x * baseW;
    const cy = pos.y * baseH;
    ctx.save();
    ctx.globalAlpha = +opacityEl.value / 100;
    ctx.drawImage(stamp.bitmap, cx - sw / 2, cy - sh / 2, sw, sh);
    ctx.restore();
  }

  // ── 슬라이더 ──
  sizeEl.addEventListener("input", () => {
    $("stampSizeV").textContent = sizeEl.value + "%";
    render();
  });
  opacityEl.addEventListener("input", () => {
    $("stampOpacityV").textContent = opacityEl.value + "%";
    render();
  });

  // ── 드래그로 위치 이동 ──
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }
  canvas.style.cursor = "move";
  canvas.addEventListener("pointerdown", (e) => {
    if (!bases.length || !stamp) return;
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    const p = canvasPoint(e);
    pos = { x: clamp01(p.x), y: clamp01(p.y) };
    render();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = canvasPoint(e);
    pos = { x: clamp01(p.x), y: clamp01(p.y) };
    render();
  });
  canvas.addEventListener("pointerup", () => (dragging = false));
  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  // ── 전체 적용 후 저장 ──
  applyBtn.addEventListener("click", async () => {
    if (!bases.length || !stamp) return;
    applyBtn.disabled = true;
    setStatus(status, "도장 합성 중…", "work");
    try {
      const results = [];
      for (let i = 0; i < bases.length; i++) {
        setStatus(status, `합성 중… (${i + 1}/${bases.length})`, "work");
        const b = bases[i];
        const cv = document.createElement("canvas");
        cv.width = b.w;
        cv.height = b.h;
        const ctx = cv.getContext("2d");
        ctx.drawImage(b.bitmap, 0, 0);
        drawStamp(ctx, b.w, b.h);
        const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
        results.push({ name: `${stripExt(b.file.name)}_stamped.png`, blob });
      }

      if (results.length === 1) {
        downloadBlob(results[0].blob, results[0].name);
        setStatus(status, "완료! 도장 찍은 이미지를 저장했습니다.", "ok");
      } else {
        setStatus(status, "ZIP으로 묶는 중…", "work");
        const zip = new JSZip();
        results.forEach((r) => zip.file(r.name, r.blob));
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `stamped_${results.length}.zip`);
        setStatus(status, `완료! ${results.length}장에 도장을 찍어 ZIP으로 저장했습니다.`, "ok");
      }
    } catch (err) {
      console.error(err);
      setStatus(status, "실패: " + err.message, "err");
    } finally {
      applyBtn.disabled = false;
    }
  });
})();
