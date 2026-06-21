// HEIC/HEIF 디코더 — 최신 libheif-js(WASM) 사용. 아이폰 그리드/HDR HEIC까지 지원.

(function () {
  const LIBHEIF_URL =
    "https://cdn.jsdelivr.net/npm/libheif-js@1.18.2/libheif-wasm/libheif-bundle.js";

  let modPromise = null;

  function loadLibheif() {
    if (modPromise) return modPromise;
    modPromise = new Promise((res, rej) => {
      if (window.libheif) return res();
      const s = document.createElement("script");
      s.src = LIBHEIF_URL;
      s.onload = res;
      s.onerror = () => rej(new Error("libheif 로드 실패 (네트워크 확인)"));
      document.head.appendChild(s);
    }).then(() => window.libheif());
    return modPromise;
  }

  window.isHeicFile = function (f) {
    const t = (f.type || "").toLowerCase();
    const n = (f.name || "").toLowerCase();
    return (
      t === "image/heic" ||
      t === "image/heif" ||
      n.endsWith(".heic") ||
      n.endsWith(".heif")
    );
  };

  // HEIC 파일 → 디코드된 canvas
  window.heicToCanvas = async function (file) {
    const mod = await loadLibheif();
    const decoder = new mod.HeifDecoder();
    const buf = new Uint8Array(await file.arrayBuffer());
    const images = decoder.decode(buf);
    if (!images || !images.length) throw new Error("HEIC를 디코드하지 못했습니다.");

    const image = images[0];
    const w = image.get_width();
    const h = image.get_height();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(w, h);

    await new Promise((resolve, reject) => {
      image.display(imageData, (out) =>
        out ? resolve() : reject(new Error("HEIC 픽셀 변환 실패"))
      );
    });
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

  // HEIC 파일 → Blob (기본 JPEG)
  window.heicToBlob = async function (file, type = "image/jpeg", quality = 0.92) {
    const canvas = await heicToCanvas(file);
    return await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("HEIC 변환 실패"))), type, quality)
    );
  };
})();
