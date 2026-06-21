// 이미지 편집 (WASM / Photon) — 보정·블러·회전/반전·자르기·텍스트·워터마크
import * as photon from "./vendor/photon_rs_bg.js";

(function () {
  const PREVIEW_MAX = 1400;

  const $ = (id) => document.getElementById(id);
  const input = $("editInput");
  const drop = $("editDrop");
  const editorBox = $("editEditor");
  const canvas = $("editCanvas");
  const status = $("editStatus");

  const brightnessEl = $("editBrightness");
  const contrastEl = $("editContrast");
  const saturationEl = $("editSaturation");
  const hueEl = $("editHue");
  const blurEl = $("editBlur");
  const grayEl = $("editGray");
  const sepiaEl = $("editSepia");
  const invertEl = $("editInvert");
  const filterEl = $("editFilter");

  const textEl = $("editText");
  const textSizeEl = $("editTextSize");
  const textColorEl = $("editTextColor");
  const wmTextEl = $("editWmText");
  const wmSizeEl = $("editWmSize");
  const wmOpacityEl = $("editWmOpacity");

  let wasmReady = false;
  let fullOrig = null;
  let scaledOrig = null;
  let fileName = "image";
  let rafPending = false;

  // 텍스트 오버레이 위치(정규화 0..1)
  let textPos = { x: 0.5, y: 0.5 };

  // 자르기 상태
  let cropMode = false;
  let cropRect = null; // {x,y,w,h} (editCanvas 픽셀 좌표)
  let dragging = null; // 'text' | 'crop' | null
  let dragStart = null;

  // ── WASM 초기화 ──
  async function initWasm() {
    if (wasmReady) return;
    const resp = await fetch("js/vendor/photon_rs_bg.wasm");
    const bytes = await resp.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      "./photon_rs_bg.js": photon,
    });
    photon.__wbg_set_wasm(instance.exports);
    wasmReady = true;
  }

  // ── 업로드 ──
  wireDropzone(drop, input, async (files) => {
    const file = files[0];
    if (!file.type.startsWith("image/") && !isHeicFile(file)) {
      setStatus(status, "이미지 파일이 아닙니다.", "err");
      return;
    }
    fileName = stripExt(file.name);
    setStatus(status, "불러오는 중…", "work");
    try {
      await initWasm();
      let blob = file;
      if (isHeicFile(file)) blob = await heicToBlob(file);
      const bmp = await createImageBitmap(blob);
      fullOrig = canvasFrom(bmp, bmp.width, bmp.height);
      if (bmp.close) bmp.close();
      rebuildScaled();
      resetControls();
      editorBox.classList.remove("hidden");
      render();
      setStatus(status, "준비 완료. 보정·블러·자르기·텍스트·워터마크를 사용하세요.", "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "불러오기 실패: " + err.message, "err");
    }
  });

  function canvasFrom(src, w, h) {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    cv.getContext("2d", { willReadFrequently: true }).drawImage(src, 0, 0, w, h);
    return cv;
  }

  function rebuildScaled() {
    const { width: w, height: h } = fullOrig;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(w, h));
    scaledOrig = canvasFrom(fullOrig, Math.round(w * scale), Math.round(h * scale));
  }

  // ── 색/블러 파이프라인 (Photon) ──
  function applyPipeline(src) {
    const cv = canvasFrom(src, src.width, src.height);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const img = photon.open_image(cv, ctx);

    const b = +brightnessEl.value;
    const c = +contrastEl.value;
    const s = +saturationEl.value;
    const hue = +hueEl.value;
    const blur = +blurEl.value;

    if (b > 0) photon.lighten_hsl(img, b / 200);
    else if (b < 0) photon.darken_hsl(img, -b / 200);
    if (c !== 0) photon.adjust_contrast(img, c);
    if (s > 0) photon.saturate_hsl(img, s / 100);
    else if (s < 0) photon.desaturate_hsl(img, -s / 100);
    if (hue !== 0) photon.hue_rotate_hsl(img, hue);
    if (grayEl.checked) photon.grayscale(img);
    if (sepiaEl.checked) photon.sepia(img);
    if (invertEl.checked) photon.invert(img);
    if (filterEl.value) photon.filter(img, filterEl.value);
    if (blur > 0) photon.gaussian_blur(img, blur);

    // putImageData가 이미지 소유권을 가져가며 free 한다 → 별도 free 금지
    photon.putImageData(cv, ctx, img);
    return cv;
  }

  // ── 오버레이(텍스트/워터마크)를 ctx에 그림. 정규화 좌표·비율 폰트라 해상도 무관 ──
  function drawOverlays(ctx, w, h) {
    // 워터마크 (대각선 반복)
    const wm = wmTextEl.value.trim();
    if (wm) {
      const fs = Math.max(8, (+wmSizeEl.value / 100) * w);
      ctx.save();
      ctx.globalAlpha = +wmOpacityEl.value / 100;
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${fs}px -apple-system, Arial, sans-serif`;
      ctx.textBaseline = "middle";
      const text = wm + "   ";
      const tw = ctx.measureText(text).width;
      const stepX = tw;
      const stepY = fs * 3;
      const diag = Math.sqrt(w * w + h * h);
      ctx.translate(w / 2, h / 2);
      ctx.rotate((-28 * Math.PI) / 180);
      for (let y = -diag; y < diag; y += stepY) {
        for (let x = -diag; x < diag; x += stepX) {
          ctx.fillText(text, x, y);
        }
      }
      ctx.restore();
    }

    // 텍스트
    const t = textEl.value;
    if (t) {
      const fs = Math.max(10, (+textSizeEl.value / 100) * w);
      ctx.save();
      ctx.font = `bold ${fs}px -apple-system, Arial, sans-serif`;
      ctx.fillStyle = textColorEl.value;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      // 가독성을 위한 옅은 외곽선
      ctx.lineWidth = Math.max(1, fs / 12);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      const x = textPos.x * w;
      const y = textPos.y * h;
      ctx.strokeText(t, x, y);
      ctx.fillText(t, x, y);
      ctx.restore();
    }
  }

  function drawCropOverlay(ctx, w, h) {
    if (!cropRect) return;
    ctx.save();
    // 바깥 어둡게
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
    ctx.fill("evenodd");
    // 테두리
    ctx.strokeStyle = "#818cf8";
    ctx.lineWidth = 2;
    ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
    ctx.restore();
  }

  // ── 미리보기 렌더 ──
  function render() {
    if (!scaledOrig || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const out = applyPipeline(scaledOrig);
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(out, 0, 0);
      drawOverlays(ctx, canvas.width, canvas.height);
      if (cropMode) drawCropOverlay(ctx, canvas.width, canvas.height);
    });
  }

  // ── 슬라이더/입력 바인딩 ──
  function bindLive(el, labelId, suffix) {
    el.addEventListener("input", () => {
      if (labelId) $(labelId).textContent = el.value + (suffix || "");
      render();
    });
  }
  bindLive(brightnessEl, "editBrightnessV", "");
  bindLive(contrastEl, "editContrastV", "");
  bindLive(saturationEl, "editSaturationV", "");
  bindLive(hueEl, "editHueV", "°");
  bindLive(blurEl, "editBlurV", "");
  bindLive(textSizeEl, "editTextSizeV", "%");
  bindLive(wmSizeEl, "editWmSizeV", "%");
  bindLive(wmOpacityEl, "editWmOpacityV", "%");
  [grayEl, sepiaEl, invertEl, filterEl].forEach((el) => el.addEventListener("change", render));
  [textEl, textColorEl, wmTextEl].forEach((el) => el.addEventListener("input", render));

  // ── 캔버스 포인터 (텍스트 드래그 / 자르기) ──
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!scaledOrig) return;
    canvas.setPointerCapture(e.pointerId);
    const p = canvasPoint(e);
    if (cropMode) {
      dragging = "crop";
      dragStart = p;
      cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
    } else if (textEl.value) {
      dragging = "text";
      textPos = { x: p.x / canvas.width, y: p.y / canvas.height };
      render();
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = canvasPoint(e);
    if (dragging === "crop") {
      cropRect = {
        x: Math.min(dragStart.x, p.x),
        y: Math.min(dragStart.y, p.y),
        w: Math.abs(p.x - dragStart.x),
        h: Math.abs(p.y - dragStart.y),
      };
    } else if (dragging === "text") {
      textPos = {
        x: Math.max(0, Math.min(1, p.x / canvas.width)),
        y: Math.max(0, Math.min(1, p.y / canvas.height)),
      };
    }
    render();
  });
  canvas.addEventListener("pointerup", () => {
    dragging = null;
  });

  // ── 자르기 ──
  function setCropMode(on) {
    cropMode = on;
    cropRect = null;
    $("editCropStart").classList.toggle("hidden", on);
    $("editCropApply").classList.toggle("hidden", !on);
    $("editCropCancel").classList.toggle("hidden", !on);
    canvas.style.cursor = on ? "crosshair" : "default";
    render();
  }
  $("editCropStart").addEventListener("click", () => {
    setCropMode(true);
    setStatus(status, "캔버스에서 드래그해 자를 영역을 선택하세요.", "work");
  });
  $("editCropCancel").addEventListener("click", () => {
    setCropMode(false);
    setStatus(status, "자르기 취소됨.", "");
  });
  $("editCropApply").addEventListener("click", () => {
    if (!cropRect || cropRect.w < 4 || cropRect.h < 4) {
      setStatus(status, "자를 영역을 먼저 드래그하세요.", "err");
      return;
    }
    // editCanvas 좌표 → fullOrig 좌표
    const fx = fullOrig.width / canvas.width;
    const fy = fullOrig.height / canvas.height;
    const sx = Math.round(cropRect.x * fx);
    const sy = Math.round(cropRect.y * fy);
    const sw = Math.round(cropRect.w * fx);
    const sh = Math.round(cropRect.h * fy);
    const cv = document.createElement("canvas");
    cv.width = sw;
    cv.height = sh;
    cv.getContext("2d").drawImage(fullOrig, sx, sy, sw, sh, 0, 0, sw, sh);
    fullOrig = cv;
    rebuildScaled();
    setCropMode(false);
    setStatus(status, `자르기 완료 (${sw}×${sh}).`, "ok");
  });

  // ── 기하 변환 ──
  function bakeGeometry(fn) {
    if (!fullOrig) return;
    const ctx = fullOrig.getContext("2d", { willReadFrequently: true });
    const img = photon.open_image(fullOrig, ctx);
    const result = fn(img);
    const out = result || img;
    const w = out.get_width();
    const h = out.get_height();
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    photon.putImageData(cv, cv.getContext("2d"), out);
    if (result) img.free();
    fullOrig = cv;
    rebuildScaled();
    render();
  }
  $("editRotL").addEventListener("click", () => bakeGeometry((img) => photon.rotate(img, 270)));
  $("editRotR").addEventListener("click", () => bakeGeometry((img) => photon.rotate(img, 90)));
  $("editFlipH").addEventListener("click", () => bakeGeometry((img) => { photon.fliph(img); return null; }));
  $("editFlipV").addEventListener("click", () => bakeGeometry((img) => { photon.flipv(img); return null; }));

  function resetControls() {
    brightnessEl.value = 0;
    contrastEl.value = 0;
    saturationEl.value = 0;
    hueEl.value = 0;
    blurEl.value = 0;
    grayEl.checked = sepiaEl.checked = invertEl.checked = false;
    filterEl.value = "";
    if (window.enhanceSelects) {
      // 커스텀 셀렉트 라벨 동기화
      filterEl.dispatchEvent(new Event("change"));
    }
    textEl.value = "";
    wmTextEl.value = "";
    textSizeEl.value = 6;
    textColorEl.value = "#ffffff";
    wmSizeEl.value = 4;
    wmOpacityEl.value = 25;
    textPos = { x: 0.5, y: 0.5 };
    $("editBrightnessV").textContent = "0";
    $("editContrastV").textContent = "0";
    $("editSaturationV").textContent = "0";
    $("editHueV").textContent = "0°";
    $("editBlurV").textContent = "0";
    $("editTextSizeV").textContent = "6%";
    $("editWmSizeV").textContent = "4%";
    $("editWmOpacityV").textContent = "25%";
    if (cropMode) setCropMode(false);
  }
  $("editReset").addEventListener("click", () => {
    resetControls();
    render();
  });

  // ── 저장 (전체 해상도) ──
  $("editSave").addEventListener("click", () => {
    if (!fullOrig) return;
    if (cropMode) setCropMode(false);
    setStatus(status, "전체 해상도로 처리 중…", "work");
    setTimeout(() => {
      try {
        const out = applyPipeline(fullOrig);
        const ctx = out.getContext("2d");
        drawOverlays(ctx, out.width, out.height);
        out.toBlob((blob) => {
          if (!blob) {
            setStatus(status, "저장 실패", "err");
            return;
          }
          downloadBlob(blob, `${fileName}_edited.png`);
          setStatus(status, `완료! ${out.width}×${out.height} PNG로 저장했습니다.`, "ok");
        }, "image/png");
      } catch (err) {
        console.error(err);
        setStatus(status, "저장 실패: " + err.message, "err");
      }
    }, 20);
  });
})();
