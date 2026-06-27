// HWPX 내용 뷰어 — 한컴오피스 .hwpx(ZIP + OWPML XML)를 풀어 문단·표·이미지를
// 추출해 HTML로 표시한다. 서식은 단순화. .hwp(구형 바이너리 CFBF)는 지원하지 않음.
// 의존성: JSZip(이미 로드), DOMParser(네이티브). 모든 처리는 브라우저 안에서.

(function () {
  const input = document.getElementById("hwpxInput");
  const drop = document.getElementById("hwpxDrop");
  const view = document.getElementById("hwpxView");
  const status = document.getElementById("hwpxStatus");

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function secNum(name) {
    const m = name.match(/section(\d+)\.xml$/i);
    return m ? parseInt(m[1], 10) : 0;
  }
  function guessMime(href) {
    const e = (href.split(".").pop() || "").toLowerCase();
    return (
      { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", wmf: "image/wmf", emf: "image/emf" }[e] ||
      "application/octet-stream"
    );
  }

  // content.hpf(패키지 매니페스트)에서 이미지 id → data URL 맵 구축
  async function buildImageMap(zip) {
    const out = {};
    const hpfArr = zip.file(/content\.hpf$/i);
    if (!hpfArr || !hpfArr.length) return out;
    const xml = await hpfArr[0].async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const items = [...doc.getElementsByTagName("*")].filter((e) => e.localName === "item");
    for (const it of items) {
      const id = it.getAttribute("id");
      const href = it.getAttribute("href");
      if (!id || !href || !/BinData\//i.test(href)) continue;
      const base = href.split("/").pop();
      const entry =
        zip.file(href) ||
        zip.file("Contents/" + href) ||
        zip.file(href.replace(/^\.\.\//, "")) ||
        (zip.file(new RegExp("BinData/" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i")) || [])[0];
      if (!entry) continue;
      const b64 = await entry.async("base64");
      out[id] = "data:" + (it.getAttribute("media-type") || guessMime(href)) + ";base64," + b64;
    }
    return out;
  }

  function renderTable(tbl, imgs) {
    let html = '<table class="hwpx-tbl">';
    for (const tr of [...tbl.children].filter((c) => c.localName === "tr")) {
      html += "<tr>";
      for (const tc of [...tr.children].filter((c) => c.localName === "tc")) {
        const span = tc.querySelector ? null : null;
        const colAttr = tc.getAttribute && tc.getAttribute("colSpan");
        const rowAttr = tc.getAttribute && tc.getAttribute("rowSpan");
        const cs = colAttr && +colAttr > 1 ? ` colspan="${+colAttr}"` : "";
        const rs = rowAttr && +rowAttr > 1 ? ` rowspan="${+rowAttr}"` : "";
        html += `<td${cs}${rs}>${renderChildren(tc, imgs) || ""}</td>`;
      }
      html += "</tr>";
    }
    return html + "</table>";
  }

  function renderNode(node, imgs) {
    const tag = node.localName;
    if (tag === "t") return esc(node.textContent);
    if (tag === "lineBreak" || tag === "lineseg") return ""; // 줄바꿈은 문단 단위로 처리
    if (tag === "tab") return "\t";
    if (tag === "tbl") return renderTable(node, imgs);
    if (tag === "img") {
      const ref = node.getAttribute("binaryItemIDRef") || node.getAttribute("BinItem");
      return ref && imgs[ref] ? `<img src="${imgs[ref]}" alt="" loading="lazy">` : "";
    }
    if (tag === "p") {
      const inner = renderChildren(node, imgs);
      return `<p>${inner}</p>`;
    }
    return renderChildren(node, imgs);
  }

  function renderChildren(node, imgs) {
    let html = "";
    for (const child of node.children) html += renderNode(child, imgs);
    return html;
  }

  async function openFile(file) {
    if (!window.JSZip) {
      setStatus(status, "JSZip 로드 실패 (네트워크 확인).", "err");
      return;
    }
    setStatus(status, "여는 중…", "work");
    view.innerHTML = "";
    try {
      const zip = await JSZip.loadAsync(file);
      const imgs = await buildImageMap(zip);
      const names = Object.keys(zip.files)
        .filter((n) => /Contents\/section\d+\.xml$/i.test(n))
        .sort((a, b) => secNum(a) - secNum(b));
      if (!names.length)
        throw new Error("section XML을 찾을 수 없습니다. 올바른 .hwpx 파일인지 확인하세요 (.hwp 구형 형식은 미지원).");

      const parser = new DOMParser();
      let html = "";
      for (const n of names) {
        const xml = await zip.file(n).async("string");
        const doc = parser.parseFromString(xml, "application/xml");
        if (doc.getElementsByTagName("parsererror").length) continue;
        html += renderChildren(doc.documentElement, imgs);
      }
      view.innerHTML = `<div class="hwpx-doc">${html || "<p>(표시할 내용이 없습니다)</p>"}</div>`;
      setStatus(status, `불러옴 — ${names.length}개 섹션${Object.keys(imgs).length ? `, 이미지 ${Object.keys(imgs).length}개` : ""}. 서식은 단순화되어 표시됩니다.`, "ok");
    } catch (e) {
      console.error(e);
      setStatus(status, "열기 실패: " + (e.message || e), "err");
    }
  }

  wireDropzone(drop, input, (files) => {
    if (files[0]) openFile(files[0]);
  });
})();
