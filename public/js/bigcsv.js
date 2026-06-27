// 대용량 CSV 편집 (WASM · DuckDB-WASM)
// 수십만~수백만 행 CSV를 브라우저 내장 DB에 올려, 페이지 단위 편집 + WHERE 필터 +
// 다시 CSV로 내보내기. 전체를 메모리에 펼치지 않아 큰 파일도 견딘다. 값은 전부 텍스트.

(function () {
  const DUCKDB_ESM = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";

  const input = document.getElementById("bigInput");
  const drop = document.getElementById("bigDrop");
  const encEl = document.getElementById("bigEnc");
  const panel = document.getElementById("bigPanelBody");
  const tableBox = document.getElementById("bigTable");
  const info = document.getElementById("bigInfo");
  const filterEl = document.getElementById("bigFilter");
  const applyBtn = document.getElementById("bigApply");
  const prevBtn = document.getElementById("bigPrev");
  const nextBtn = document.getElementById("bigNext");
  const sizeEl = document.getElementById("bigPageSize");
  const exportBtn = document.getElementById("bigExport");
  const status = document.getElementById("bigStatus");
  const panelBody = document.getElementById("bigPanelBody");
  const fsToggle = document.getElementById("bigFsToggle");
  const titleEl = document.getElementById("bigTitle");

  let duckdb = null;
  let db = null;
  let conn = null;
  let cols = [];
  let total = 0;
  let page = 0;
  let where = "";
  let baseName = "data";
  let currentRows = []; // 현재 페이지 데이터
  let active = { r: 0, c: 0 }; // 선택된 셀(엑셀식)
  let editing = false;

  function pageSize() {
    return parseInt(sizeEl.value, 10) || 100;
  }
  function q(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  // 큰 파일도 메모리에 통째로 올리지 않도록 스트림으로 EUC-KR→UTF-8 변환 (UTF-8이면 그대로)
  async function toUtf8File(file, enc) {
    if (enc === "utf-8") return file;
    const dec = new TextDecoder(enc);
    const out = new TextEncoder();
    const reader = file.stream().getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(out.encode(dec.decode(value, { stream: true })));
    }
    chunks.push(out.encode(dec.decode()));
    return new Blob(chunks, { type: "text/csv" });
  }

  async function ensureDuckDB() {
    if (db) return;
    setStatus(status, "DuckDB(WASM) 불러오는 중… (최초 1회)", "work");
    duckdb = await import(/* @vite-ignore */ DUCKDB_ESM);
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    // mainWorker는 교차출처 URL이라 blob 워커로 감싸 importScripts로 로드
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
    );
    const worker = new Worker(workerUrl);
    db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    conn = await db.connect();
  }

  async function loadCsv(file) {
    try {
      await ensureDuckDB();
      setStatus(status, "CSV를 불러오는 중…", "work");
      baseName = stripExt(file.name).normalize("NFC") || "data";

      const enc = (encEl && encEl.value) || "utf-8";
      const src = await toUtf8File(file, enc);
      await db.registerFileHandle("input.csv", src, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);

      // __id로 행 식별(편집·정렬용). 값은 전부 문자열로 읽어 형 변환/유실 방지.
      await conn.query(
        `CREATE OR REPLACE TABLE t AS
         SELECT CAST(row_number() OVER () AS BIGINT) AS __id, *
         FROM read_csv_auto('input.csv', header=true, all_varchar=true, sample_size=-1)`
      );

      const desc = await conn.query(`PRAGMA table_info('t')`);
      cols = desc
        .toArray()
        .map((r) => r.toJSON().name)
        .filter((n) => n !== "__id");

      where = "";
      filterEl.value = "";
      page = 0;
      await refresh();
      panel.classList.remove("hidden");
      if (titleEl) titleEl.textContent = `${file.name} — ${total.toLocaleString()}행 · ${cols.length}열`;
      setFullscreen(true); // 파일이 열리면 엑셀처럼 전체화면으로
      setStatus(status, `불러옴 — ${total.toLocaleString()}행 · ${cols.length}열. 셀을 고치면 즉시 반영됩니다.`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "불러오기 실패: " + (err.message || err), "err");
    }
  }

  async function countRows() {
    const sql = `SELECT count(*)::BIGINT AS n FROM t ${where ? "WHERE " + where : ""}`;
    const r = await conn.query(sql);
    return Number(r.toArray()[0].toJSON().n);
  }

  async function fetchPage() {
    const sz = pageSize();
    const sql = `SELECT * FROM t ${where ? "WHERE " + where : ""} ORDER BY __id LIMIT ${sz} OFFSET ${page * sz}`;
    const r = await conn.query(sql);
    return r.toArray().map((row) => row.toJSON());
  }

  async function refresh() {
    total = await countRows();
    const sz = pageSize();
    const pages = Math.max(1, Math.ceil(total / sz));
    if (page >= pages) page = pages - 1;
    if (page < 0) page = 0;
    const rows = await fetchPage();
    currentRows = rows;
    renderTable(rows);
    info.textContent = `${total.toLocaleString()}행 · ${page + 1} / ${pages} 페이지`;
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= pages - 1;
    selectCell(0, 0, false); // 페이지 바뀌면 첫 셀 선택
  }

  // 엑셀식 열 문자: 0→A, 1→B, … 26→AA
  function colLetter(n) {
    let s = "";
    n++;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function renderTable(rows) {
    const tbl = document.createElement("table");
    tbl.className = "xlgrid";

    // 헤더 2줄: (1) 엑셀식 열 문자  (2) 실제 컬럼명
    const thead = document.createElement("thead");
    const letterTr = document.createElement("tr");
    letterTr.className = "collet";
    const corner = document.createElement("th");
    corner.className = "corner";
    letterTr.appendChild(corner);
    cols.forEach((_, i) => {
      const th = document.createElement("th");
      th.textContent = colLetter(i);
      letterTr.appendChild(th);
    });
    thead.appendChild(letterTr);

    const nameTr = document.createElement("tr");
    nameTr.className = "colname";
    const cornerHash = document.createElement("th");
    cornerHash.className = "corner";
    nameTr.appendChild(cornerHash);
    cols.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c;
      nameTr.appendChild(th);
    });
    thead.appendChild(nameTr);
    tbl.appendChild(thead);

    const sz = pageSize();
    const tbody = document.createElement("tbody");
    rows.forEach((row, ri) => {
      const tr = document.createElement("tr");
      const num = document.createElement("td");
      num.className = "rownum";
      num.textContent = (page * sz + ri + 1).toLocaleString(); // 엑셀식 행 번호(보이는 위치)
      tr.appendChild(num);
      cols.forEach((c, ci) => {
        const td = document.createElement("td");
        td.dataset.r = ri;
        td.dataset.c = ci;
        td.textContent = row[c] == null ? "" : String(row[c]); // 기본은 텍스트(편집 모드 아님)
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);

    tableBox.innerHTML = "";
    tableBox.appendChild(tbl);
  }

  // ── 엑셀식 셀 선택/편집 ─────────────────────────────────────────
  function cellEl(r, c) {
    return tableBox.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  }
  function clamp(v, max) {
    return Math.max(0, Math.min(v, max));
  }
  function applyActive() {
    const prev = tableBox.querySelector("td.cellsel");
    if (prev) prev.classList.remove("cellsel");
    const td = cellEl(active.r, active.c);
    if (td) {
      td.classList.add("cellsel");
      td.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  function selectCell(r, c, focus = true) {
    if (!currentRows.length) return;
    active = { r: clamp(r, currentRows.length - 1), c: clamp(c, cols.length - 1) };
    applyActive();
    if (focus) tableBox.focus();
  }

  function beginEdit(initial) {
    const td = cellEl(active.r, active.c);
    if (!td) return;
    editing = true;
    td.classList.add("editing");
    const cur = currentRows[active.r][cols[active.c]];
    const inp = document.createElement("input");
    inp.className = "celledit";
    inp.value = initial != null ? initial : cur == null ? "" : String(cur);
    inp.spellcheck = false;
    td.textContent = "";
    td.appendChild(inp);
    inp.focus();
    if (initial == null) inp.select();
    else inp.setSelectionRange(inp.value.length, inp.value.length);

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit(e.shiftKey ? "up" : "down");
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit(e.shiftKey ? "left" : "right");
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // 전체화면 닫힘 방지
        cancelEdit();
      } else {
        e.stopPropagation(); // 입력 중에는 그리드 네비게이션 차단
      }
    });
    inp.addEventListener("blur", () => {
      if (editing) commitEdit(null);
    });
  }

  function endEditDom(text) {
    const td = cellEl(active.r, active.c);
    if (td) {
      td.classList.remove("editing");
      td.textContent = text;
    }
    editing = false;
  }

  async function commitEdit(move) {
    const td = cellEl(active.r, active.c);
    const inp = td && td.querySelector("input");
    const col = cols[active.c];
    const old = currentRows[active.r][col];
    const val = inp ? inp.value : old == null ? "" : String(old);
    const id = currentRows[active.r].__id;
    endEditDom(val);
    applyActive();
    if (val !== (old == null ? "" : String(old))) {
      currentRows[active.r][col] = val;
      if (td) td.classList.add("edited");
      try {
        await updateCell(id, col, val);
      } catch (err) {
        console.error(err);
        setStatus(status, "셀 수정 실패: " + (err.message || err), "err");
      }
    }
    if (move === "down") selectCell(active.r + 1, active.c);
    else if (move === "up") selectCell(active.r - 1, active.c);
    else if (move === "right") selectCell(active.r, active.c + 1);
    else if (move === "left") selectCell(active.r, active.c - 1);
    else tableBox.focus();
  }

  function cancelEdit() {
    const old = currentRows[active.r][cols[active.c]];
    endEditDom(old == null ? "" : String(old));
    applyActive();
    tableBox.focus();
  }

  // __id는 우리가 부여한 정수라 리터럴로 인라인. 사용자 값만 파라미터 바인딩.
  // (DuckDB-WASM은 BigInt 파라미터를 워커로 직렬화하지 못해 ? 바인딩 대신 인라인)
  async function updateCell(id, col, value) {
    const stmt = await conn.prepare(`UPDATE t SET ${q(col)} = ? WHERE __id = ${Number(id)}`);
    await stmt.query(value);
    await stmt.close();
  }

  // 그리드 키보드 네비게이션 (편집 중이 아닐 때)
  tableBox.addEventListener("keydown", (e) => {
    if (editing) return;
    const k = e.key;
    if (k === "ArrowUp") { e.preventDefault(); selectCell(active.r - 1, active.c); }
    else if (k === "ArrowDown") { e.preventDefault(); selectCell(active.r + 1, active.c); }
    else if (k === "ArrowLeft") { e.preventDefault(); selectCell(active.r, active.c - 1); }
    else if (k === "ArrowRight" || k === "Tab") { e.preventDefault(); selectCell(active.r, active.c + (e.shiftKey ? -1 : 1)); }
    else if (k === "Enter" || k === "F2") { e.preventDefault(); beginEdit(); }
    else if (k === "PageDown") { e.preventDefault(); if (!nextBtn.disabled) nextBtn.click(); }
    else if (k === "PageUp") { e.preventDefault(); if (!prevBtn.disabled) prevBtn.click(); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); beginEdit(""); commitEdit(null); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); beginEdit(k); }
  });
  // 클릭=선택, 더블클릭=편집
  tableBox.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const td = e.target.closest("td[data-c]");
    if (!td) return;
    if (editing) commitEdit(null);
    selectCell(+td.dataset.r, +td.dataset.c);
  });
  tableBox.addEventListener("dblclick", (e) => {
    const td = e.target.closest("td[data-c]");
    if (!td) return;
    selectCell(+td.dataset.r, +td.dataset.c);
    beginEdit();
  });

  // 전체화면(엑셀처럼) 토글
  function setFullscreen(on) {
    panelBody.classList.toggle("fs", on);
    document.body.style.overflow = on ? "hidden" : "";
    if (fsToggle) {
      fsToggle.innerHTML = on
        ? '<i data-lucide="minimize-2" class="h-4 w-4"></i> 닫기 (Esc)'
        : '<i data-lucide="maximize-2" class="h-4 w-4"></i> 전체화면';
      refreshIcons();
    }
  }
  if (fsToggle) {
    fsToggle.addEventListener("click", () => setFullscreen(!panelBody.classList.contains("fs")));
  }
  const exitBtn = document.getElementById("bigExit");
  if (exitBtn) exitBtn.addEventListener("click", () => setFullscreen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !editing && panelBody.classList.contains("fs")) setFullscreen(false);
  });

  applyBtn.addEventListener("click", async () => {
    const expr = filterEl.value.trim();
    try {
      // 잘못된 식이면 여기서 에러 → 필터 미적용 상태 유지
      where = expr;
      page = 0;
      await refresh();
      setStatus(status, expr ? `필터 적용됨 — ${total.toLocaleString()}행` : "필터 해제됨", "ok");
    } catch (err) {
      console.error(err);
      where = "";
      setStatus(status, "필터 식 오류: " + (err.message || err), "err");
    }
  });

  prevBtn.addEventListener("click", async () => {
    page--;
    await refresh();
  });
  nextBtn.addEventListener("click", async () => {
    page++;
    await refresh();
  });
  sizeEl.addEventListener("change", async () => {
    page = 0;
    await refresh();
  });

  exportBtn.addEventListener("click", async () => {
    if (!conn) return;
    setStatus(status, "CSV 내보내는 중…", "work");
    try {
      await conn.query(
        `COPY (SELECT * EXCLUDE(__id) FROM t ${where ? "WHERE " + where : ""} ORDER BY __id)
         TO 'out.csv' WITH (HEADER, FORMAT CSV)`
      );
      const buf = await db.copyFileToBuffer("out.csv");
      downloadBlob(new Blob(["﻿", buf], { type: "text/csv;charset=utf-8" }), baseName + "_edited.csv");
      await db.dropFile("out.csv").catch(() => {});
      setStatus(status, `내보냄 — ${total.toLocaleString()}행 (${where ? "필터 적용" : "전체"}).`, "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "내보내기 실패: " + (err.message || err), "err");
    }
  });

  wireDropzone(drop, input, (files) => {
    if (files[0]) loadCsv(files[0]);
  });
})();
