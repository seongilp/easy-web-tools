// 엑셀 편집 — xlsx/csv를 표에서 바로 편집하고 다시 저장. (SheetJS + x-spreadsheet)
// 값은 텍스트로 유지(0으로 시작하는 숫자·날짜 보존), CSV는 인코딩 선택 + NFC 정규화.

(function () {
  const XS_CSS = "https://cdn.jsdelivr.net/npm/x-data-spreadsheet@1.1.9/dist/xspreadsheet.css";
  const XS_JS = "https://cdn.jsdelivr.net/npm/x-data-spreadsheet@1.1.9/dist/xspreadsheet.js";

  const input = document.getElementById("sheetInput");
  const drop = document.getElementById("sheetDrop");
  const encEl = document.getElementById("sheetEnc");
  const toolbar = document.getElementById("sheetToolbar");
  const gridBox = document.getElementById("sheetGrid");
  const saveXlsx = document.getElementById("sheetSaveXlsx");
  const saveCsv = document.getElementById("sheetSaveCsv");
  const status = document.getElementById("sheetStatus");

  let grid = null;
  let baseName = "sheet";

  function loadCssOnce(href) {
    if ([...document.styleSheets].some((s) => s.href === href)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }
  function loadScriptOnce(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some((s) => s.src === src)) return res();
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error("x-spreadsheet 로드 실패 (네트워크 확인)"));
      document.head.appendChild(s);
    });
  }
  async function ensureXSpreadsheet() {
    loadCssOnce(XS_CSS);
    if (!window.x_spreadsheet) await loadScriptOnce(XS_JS);
    return window.x_spreadsheet;
  }

  // SheetJS 워크북 → x-spreadsheet 데이터 (셀은 전부 문자열로)
  function stox(wb) {
    return wb.SheetNames.map((name) => {
      const o = { name, rows: {} };
      const ws = wb.Sheets[name];
      if (!ws || !ws["!ref"]) {
        o.rows.len = 100;
        return o;
      }
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      aoa.forEach((r, ri) => {
        const cells = {};
        r.forEach((c, ci) => {
          cells[ci] = { text: c == null ? "" : String(c) };
        });
        o.rows[ri] = { cells };
      });
      o.rows.len = Math.max(aoa.length + 20, 100);
      return o;
    });
  }

  // x-spreadsheet 데이터 → SheetJS 워크북 (셀은 전부 텍스트 type 's')
  function xtos(sdata) {
    const wb = XLSX.utils.book_new();
    (sdata || []).forEach((xws, si) => {
      const ws = {};
      let maxR = 0,
        maxC = 0;
      const rows = xws.rows || {};
      Object.keys(rows).forEach((k) => {
        const ri = +k;
        if (isNaN(ri)) return; // 'len' 등 제외
        const cells = (rows[k] && rows[k].cells) || {};
        Object.keys(cells).forEach((ck) => {
          const ci = +ck;
          if (isNaN(ci)) return;
          const text = cells[ck].text;
          if (text == null || text === "") return;
          ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = { t: "s", v: String(text) };
          if (ri > maxR) maxR = ri;
          if (ci > maxC) maxC = ci;
        });
      });
      ws["!ref"] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: maxR, c: maxC });
      XLSX.utils.book_append_sheet(wb, ws, xws.name || `Sheet${si + 1}`);
    });
    return wb;
  }

  async function readWorkbook(file) {
    const buf = await file.arrayBuffer();
    const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
    if (isCsv) {
      const enc = (encEl && encEl.value) || "utf-8";
      let text = new TextDecoder(enc, { fatal: false }).decode(buf);
      text = text.normalize("NFC"); // 맥 NFD 한글 보정
      return XLSX.read(text, { type: "string", raw: true });
    }
    return XLSX.read(buf, { type: "array", raw: true });
  }

  async function openFile(file) {
    setStatus(status, "여는 중…", "work");
    try {
      const xs = await ensureXSpreadsheet();
      const wb = await readWorkbook(file);
      baseName = stripExt(file.name).normalize("NFC") || "sheet";

      gridBox.innerHTML = "";
      grid = xs(gridBox, {
        mode: "edit",
        showToolbar: true,
        showGrid: true,
        view: {
          height: () => 480,
          width: () => gridBox.clientWidth || 800,
        },
      }).loadData(stox(wb));

      toolbar.classList.remove("hidden");
      setStatus(status, `편집 준비 완료 — ${wb.SheetNames.length}개 시트. 셀을 더블클릭해 편집하세요.`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "열기 실패: " + (err.message || err), "err");
    }
  }

  function currentWorkbook() {
    const data = grid.getData(); // 배열(여러 시트) 또는 단일 객체
    return xtos(Array.isArray(data) ? data : [data]);
  }

  wireDropzone(drop, input, (files) => {
    if (files[0]) openFile(files[0]);
  });

  saveXlsx.addEventListener("click", () => {
    if (!grid) return;
    try {
      const out = XLSX.write(currentWorkbook(), { bookType: "xlsx", type: "array" });
      downloadBlob(
        new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        baseName + ".xlsx"
      );
      setStatus(status, "xlsx로 저장했습니다.", "ok");
    } catch (e) {
      console.error(e);
      setStatus(status, "저장 실패: " + (e.message || e), "err");
    }
  });

  saveCsv.addEventListener("click", () => {
    if (!grid) return;
    try {
      const csv = XLSX.write(currentWorkbook(), { bookType: "csv", type: "string" });
      // 엑셀 호환을 위해 UTF-8 BOM 부착
      downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), baseName + ".csv");
      setStatus(status, "csv로 저장했습니다 (UTF-8).", "ok");
    } catch (e) {
      console.error(e);
      setStatus(status, "저장 실패: " + (e.message || e), "err");
    }
  });
})();
