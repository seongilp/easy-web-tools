// HEIC → PNG 변환 - 여러 장 일괄 처리 (libheif WASM은 heic.js가 지연 로드)

(function () {
  const input = document.getElementById("heicInput");
  const drop = document.getElementById("heicDrop");
  const list = document.getElementById("heicList");
  const zipBtn = document.getElementById("heicZip");
  const status = document.getElementById("heicStatus");

  let results = []; // { name, blob, url }

  wireDropzone(drop, input, async (files) => {
    const heics = [...files].filter((f) => isHeicFile(f));
    if (!heics.length) {
      setStatus(status, "HEIC/HEIF 파일이 없습니다. (.heic 또는 .heif 파일을 올려주세요)", "err");
      return;
    }
    zipBtn.disabled = true;
    try {
      const converted = [];
      for (let i = 0; i < heics.length; i++) {
        setStatus(status, `변환 중… (${i + 1}/${heics.length}) ${heics[i].name}`, "work");
        converted.push(await convertOne(heics[i]));
      }
      results = results.concat(converted);
      renderList();

      if (results.length === 1) {
        downloadBlob(results[0].blob, results[0].name);
        setStatus(status, "완료! PNG를 저장했습니다.", "ok");
      } else {
        setStatus(
          status,
          `완료! ${converted.length}개 변환됨. 개별 저장하거나 ZIP으로 한번에 받으세요.`,
          "ok"
        );
      }
    } catch (err) {
      console.error(err);
      setStatus(status, "변환 실패: " + err.message, "err");
    } finally {
      zipBtn.disabled = results.length < 2;
      input.value = "";
    }
  });

  async function convertOne(file) {
    const canvas = await heicToCanvas(file);
    const blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error(`${file.name} PNG 인코딩 실패`))), "image/png")
    );
    return { name: `${stripExt(file.name)}.png`, blob, url: URL.createObjectURL(blob) };
  }

  function renderList() {
    list.innerHTML = "";
    results.forEach((r, idx) => {
      const div = document.createElement("div");
      div.className = "thumb";
      const im = document.createElement("img");
      im.src = r.url;
      const cap = document.createElement("div");
      cap.innerHTML = `${r.name}<br><span class="text-zinc-500">${(r.blob.size / 1024 / 1024).toFixed(1)} MB</span>`;
      const dl = document.createElement("a");
      dl.innerHTML = '<i data-lucide="download" class="h-3.5 w-3.5"></i> 저장';
      dl.href = "#";
      dl.addEventListener("click", (e) => {
        e.preventDefault();
        downloadBlob(r.blob, r.name);
      });
      const rm = document.createElement("a");
      rm.innerHTML = '<i data-lucide="x" class="h-3.5 w-3.5"></i> 제거';
      rm.href = "#";
      rm.addEventListener("click", (e) => {
        e.preventDefault();
        URL.revokeObjectURL(r.url);
        results = results.filter((_, i) => i !== idx);
        renderList();
        zipBtn.disabled = results.length < 2;
      });
      div.appendChild(im);
      div.appendChild(cap);
      div.appendChild(dl);
      div.appendChild(rm);
      list.appendChild(div);
    });
    zipBtn.classList.toggle("hidden", results.length < 2);
    refreshIcons();
  }

  zipBtn.addEventListener("click", async () => {
    if (results.length < 2) return;
    zipBtn.disabled = true;
    setStatus(status, "ZIP으로 묶는 중…", "work");
    try {
      const zip = new JSZip();
      results.forEach((r) => zip.file(r.name, r.blob));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, `heic2png_${results.length}.zip`);
      setStatus(status, `완료! ${results.length}개를 ZIP으로 저장했습니다.`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "ZIP 저장 실패: " + err.message, "err");
    } finally {
      zipBtn.disabled = false;
    }
  });
})();
