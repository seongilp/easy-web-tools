// PDF <-> PNG 변환

(function () {
  // pdf.js worker 설정
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  // ===== ① PDF -> PNG =====
  const pdf2pngInput = document.getElementById("pdf2pngInput");
  const pdf2pngDrop = document.getElementById("pdf2pngDrop");
  const pdfScale = document.getElementById("pdfScale");
  const pdf2pngStatus = document.getElementById("pdf2pngStatus");
  const pdf2pngZipBtn = document.getElementById("pdf2pngZip");
  const thumbs = document.getElementById("pdf2pngThumbs");

  // 변환 결과를 보관해 버튼 클릭(사용자 제스처) 시 다운로드한다.
  // 비동기 작업 후 자동 다운로드는 브라우저가 차단할 수 있으므로 버튼이 필수.
  let lastZipBlob = null;
  let lastZipName = "pages.zip";

  wireDropzone(pdf2pngDrop, pdf2pngInput, async (files) => {
    const file = files[0];
    if (file.type !== "application/pdf") {
      setStatus(pdf2pngStatus, "PDF 파일이 아닙니다.", "err");
      return;
    }
    const baseName = stripExt(file.name);
    const scale = parseFloat(pdfScale.value);
    thumbs.innerHTML = "";
    lastZipBlob = null;
    pdf2pngZipBtn.classList.add("hidden");
    setStatus(pdf2pngStatus, "PDF 읽는 중…", "work");

    try {
      const data = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const pageBlobs = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        setStatus(pdf2pngStatus, `렌더링 중… (${p}/${pdf.numPages})`, "work");
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
        const name = `${baseName}_p${String(p).padStart(2, "0")}.png`;
        pageBlobs.push({ name, blob });
        addThumb(canvas.toDataURL("image/png"), name, blob);
      }

      // ZIP 미리 생성해두고 버튼으로 다운로드
      setStatus(pdf2pngStatus, "ZIP으로 묶는 중…", "work");
      const zip = new JSZip();
      pageBlobs.forEach((pb) => zip.file(pb.name, pb.blob));
      lastZipBlob = await zip.generateAsync({ type: "blob" });
      lastZipName = `${baseName}_pages.zip`;
      pdf2pngZipBtn.textContent = `📦 전체 ${pageBlobs.length}페이지 ZIP으로 한번에 저장`;
      pdf2pngZipBtn.classList.remove("hidden");

      setStatus(
        pdf2pngStatus,
        `완료! ${pageBlobs.length}페이지 변환됨. 아래 버튼으로 한번에 받거나 개별 저장하세요.`,
        "ok"
      );
    } catch (err) {
      console.error(err);
      setStatus(pdf2pngStatus, "변환 실패: " + err.message, "err");
    }
  });

  // 전체 ZIP 다운로드 (사용자 클릭 → 브라우저 차단 없음)
  pdf2pngZipBtn.addEventListener("click", () => {
    if (lastZipBlob) downloadBlob(lastZipBlob, lastZipName);
  });

  function addThumb(dataUrl, name, blob) {
    const div = document.createElement("div");
    div.className = "thumb";
    const im = document.createElement("img");
    im.src = dataUrl;
    const a = document.createElement("a");
    a.innerHTML = '<i data-lucide="download" class="h-3.5 w-3.5"></i> ' + name;
    a.href = "#";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      downloadBlob(blob, name);
    });
    div.appendChild(im);
    div.appendChild(a);
    thumbs.appendChild(div);
    refreshIcons();
  }

  // ===== ② PNG -> PDF =====
  const png2pdfInput = document.getElementById("png2pdfInput");
  const png2pdfDrop = document.getElementById("png2pdfDrop");
  const png2pdfList = document.getElementById("png2pdfList");
  const png2pdfBtn = document.getElementById("png2pdfBtn");
  const png2pdfStatus = document.getElementById("png2pdfStatus");
  const pageSizeEl = document.getElementById("pdfPageSize");
  const orientEl = document.getElementById("pdfOrient");

  let items = []; // { id, file, url }
  let nextId = 0;

  wireDropzone(png2pdfDrop, png2pdfInput, (files) => {
    [...files].forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      items.push({ id: nextId++, file, url: URL.createObjectURL(file) });
    });
    renderList();
  });

  function renderList() {
    png2pdfList.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.draggable = true;
      li.dataset.id = item.id;

      li.innerHTML = `<span class="handle"><i data-lucide="grip-vertical" class="h-4 w-4"></i></span>`;
      const im = document.createElement("img");
      im.src = item.url;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = item.file.name;
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.innerHTML = '<i data-lucide="x" class="h-4 w-4"></i>';
      rm.addEventListener("click", () => {
        items = items.filter((x) => x.id !== item.id);
        renderList();
      });

      li.appendChild(im);
      li.appendChild(name);
      li.appendChild(rm);
      attachDrag(li);
      png2pdfList.appendChild(li);
    });
    png2pdfBtn.disabled = items.length === 0;
    refreshIcons();
  }

  // 드래그로 순서 변경
  let dragId = null;
  function attachDrag(li) {
    li.addEventListener("dragstart", () => {
      dragId = parseInt(li.dataset.id, 10);
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const overId = parseInt(li.dataset.id, 10);
      if (dragId === null || dragId === overId) return;
      const from = items.findIndex((x) => x.id === dragId);
      const to = items.findIndex((x) => x.id === overId);
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      renderList();
    });
  }

  png2pdfBtn.addEventListener("click", async () => {
    if (!items.length) return;
    setStatus(png2pdfStatus, "PDF 생성 중…", "work");
    png2pdfBtn.disabled = true;

    try {
      const { jsPDF } = window.jspdf;
      const pageSize = pageSizeEl.value;
      let doc = null;

      for (let i = 0; i < items.length; i++) {
        const imgEl = await loadImage(items[i].url);
        const iw = imgEl.naturalWidth;
        const ih = imgEl.naturalHeight;
        const orient =
          orientEl.value === "auto" ? (iw >= ih ? "l" : "p") : orientEl.value;

        const dataUrl = imageToDataUrl(imgEl);

        if (pageSize === "fit") {
          // 이미지 픽셀 크기를 pt로 사용 (1px = 1pt 근사)
          const fmt = [iw, ih];
          if (i === 0) {
            doc = new jsPDF({ orientation: iw >= ih ? "l" : "p", unit: "pt", format: fmt });
          } else {
            doc.addPage(fmt, iw >= ih ? "l" : "p");
          }
          doc.addImage(dataUrl, "JPEG", 0, 0, iw, ih);
        } else {
          const format = pageSize; // a4 | letter
          if (i === 0) {
            doc = new jsPDF({ orientation: orient, unit: "pt", format });
          } else {
            doc.addPage(format, orient);
          }
          const pw = doc.internal.pageSize.getWidth();
          const ph = doc.internal.pageSize.getHeight();
          // 페이지에 맞춰 비율 유지하며 중앙 배치
          const ratio = Math.min(pw / iw, ph / ih);
          const w = iw * ratio;
          const h = ih * ratio;
          doc.addImage(dataUrl, "JPEG", (pw - w) / 2, (ph - h) / 2, w, h);
        }
      }

      doc.save("combined.pdf");
      setStatus(png2pdfStatus, `완료! ${items.length}장을 PDF로 합쳤습니다.`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(png2pdfStatus, "생성 실패: " + err.message, "err");
    } finally {
      png2pdfBtn.disabled = false;
    }
  });

  function loadImage(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
  }

  // 투명 배경을 흰색으로 채워 JPEG로 변환 (PDF 용량 절감)
  function imageToDataUrl(imgEl) {
    const canvas = document.createElement("canvas");
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgEl, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  }
})();
