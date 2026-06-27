// CSV → XLSX 변환 — 전부 텍스트로 유지(keep-as-text), UTF-8 / EUC-KR 인코딩 선택.
// 라이브러리: SheetJS(window.XLSX). 파일은 서버로 전송되지 않고 브라우저에서 변환된다.

(function () {
  const input = document.getElementById("csvInput");
  const drop = document.getElementById("csvDrop");
  const encEl = document.getElementById("csvEnc");
  const status = document.getElementById("csvStatus");

  let pending = null; // { file } — 인코딩을 바꿔 다시 변환할 수 있게 마지막 파일을 보관

  // RFC 4180 스타일 CSV 파서. 따옴표 안의 콤마/개행/이스케이프("")를 처리한다.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const n = text.length;
    let i = 0;
    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        if (text[i + 1] === "\n") i++;
        i++;
        continue;
      }
      if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }
      field += c;
      i++;
    }
    // 마지막 필드/행 (파일이 개행으로 끝나지 않은 경우)
    if (field !== "" || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // 2차원 문자열 배열 → 모든 셀을 텍스트(type 's')로 고정한 시트
  function aoaToTextSheet(aoa) {
    const ws = {};
    let maxCol = 0;
    aoa.forEach((row, r) => {
      if (row.length > maxCol) maxCol = row.length;
      row.forEach((val, c) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        ws[ref] = { t: "s", v: String(val) }; // 숫자/날짜 자동 변환 없이 전부 문자열
      });
    });
    const lastRow = aoa.length ? aoa.length - 1 : 0;
    const lastCol = maxCol ? maxCol - 1 : 0;
    ws["!ref"] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: lastRow, c: lastCol });
    return ws;
  }

  async function convert(file) {
    if (!window.XLSX) {
      setStatus(status, "XLSX 라이브러리를 불러오지 못했습니다 (네트워크 확인).", "err");
      return;
    }
    const enc = encEl.value || "utf-8";
    setStatus(status, `변환 중… (${enc.toUpperCase()})`, "work");
    try {
      const buf = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder(enc, { fatal: false }).decode(buf);
      } catch (e) {
        setStatus(status, `이 브라우저에서 ${enc} 디코딩을 지원하지 않습니다.`, "err");
        return;
      }
      // 맥은 한글을 NFD(자모 분리)로 저장 → 다른 곳에서 깨져 보임. NFC로 합쳐 정상화.
      // NFC는 멱등이라 이미 정상인 파일은 그대로 유지된다.
      text = text.normalize("NFC");
      const aoa = parseCsv(text);
      if (!aoa.length) {
        setStatus(status, "빈 파일이거나 읽을 행이 없습니다.", "err");
        return;
      }
      const ws = aoaToTextSheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      // 다운로드 파일명도 NFC로 정상화 (맥에서 만든 파일명은 NFD인 경우가 많음)
      downloadBlob(blob, stripExt(file.name).normalize("NFC") + ".xlsx");
      setStatus(status, `완료 — ${aoa.length}행 변환됨. 인코딩이 깨지면 위에서 바꿔 다시 시도하세요.`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "변환 실패: " + (err.message || err), "err");
    }
  }

  wireDropzone(drop, input, (files) => {
    const f = files[0];
    if (!f) return;
    pending = { file: f };
    convert(f);
  });

  // 인코딩 토글을 바꾸면 마지막 파일을 같은 설정으로 다시 변환
  encEl.addEventListener("change", () => {
    if (pending) convert(pending.file);
  });
})();
