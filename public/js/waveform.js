// 파형 렌더링 + 드래그 구간 선택 + 재생 플레이헤드
// createWaveform(canvas, { onChange, onSeek })
//   -> { setBuffer, getSelection, setSelection, setPlayhead }

function createWaveform(canvas, opts) {
  opts = opts || {};
  const onChange = opts.onChange;
  const onSeek = opts.onSeek;

  const ctx = canvas.getContext("2d");
  const HANDLE_HIT = 10; // 핸들 잡히는 픽셀 범위
  const CLICK_SLOP = 4; // 이 픽셀 미만 이동은 '클릭(seek)'으로 처리

  let buffer = null;
  let duration = 0;
  let selStart = 0;
  let selEnd = 0;
  let playhead = null; // 재생 위치(초) 또는 null
  let dragMode = null; // "start" | "end" | "new" | null
  let downX = 0;
  let prevSel = null; // 클릭(seek) 판정 시 복원용

  // 정적 파형은 오프스크린에 한 번만 그려두고 매 프레임 blit (성능)
  const off = document.createElement("canvas");
  const offCtx = off.getContext("2d");

  const COLOR = {
    wave: "#5b8cff",
    dim: "rgba(24,27,34,0.62)", // 비선택 구간을 어둡게 덮는 오버레이
    region: "rgba(91,140,255,0.18)",
    handle: "#7aa2ff",
    playhead: "#ff5b6e",
    bg: "#181b22",
  };

  function setBuffer(audioBuffer) {
    buffer = audioBuffer;
    duration = audioBuffer.duration;
    selStart = 0;
    selEnd = duration;
    playhead = null;
    renderStatic();
    draw();
    emit();
  }

  function getSelection() {
    return { start: selStart, end: selEnd };
  }

  function setSelection(start, end) {
    selStart = clamp(start, 0, duration);
    selEnd = clamp(end, 0, duration);
    if (selEnd < selStart) [selStart, selEnd] = [selEnd, selStart];
    draw();
    emit();
  }

  // 재생 위치 갱신(매 프레임 호출). null이면 플레이헤드 숨김.
  function setPlayhead(t) {
    playhead = t == null ? null : clamp(t, 0, duration);
    draw();
  }

  // ── 내부 ──
  function emit() {
    if (onChange) onChange(selStart, selEnd, duration);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function timeToX(t) {
    return (t / duration) * canvas.width;
  }
  function xToTime(x) {
    return clamp((x / canvas.width) * duration, 0, duration);
  }

  // 전체 파형을 밝은 색으로 오프스크린에 1회 렌더
  function renderStatic() {
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;
    off.width = w;
    off.height = h;

    offCtx.fillStyle = COLOR.bg;
    offCtx.fillRect(0, 0, w, h);

    const channel = buffer.getChannelData(0);
    const samplesPerBucket = Math.floor(channel.length / w) || 1;
    offCtx.strokeStyle = COLOR.wave;
    offCtx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const start = x * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, channel.length);
      for (let i = start; i < end; i++) {
        const v = channel[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      offCtx.moveTo(x + 0.5, mid + min * mid);
      offCtx.lineTo(x + 0.5, mid + max * mid);
    }
    offCtx.stroke();
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    if (!buffer) {
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, w, h);
      return;
    }

    const xs = timeToX(selStart);
    const xe = timeToX(selEnd);

    // 1) 밝은 파형 blit
    ctx.drawImage(off, 0, 0);
    // 2) 비선택 구간 어둡게
    ctx.fillStyle = COLOR.dim;
    ctx.fillRect(0, 0, xs, h);
    ctx.fillRect(xe, 0, w - xe, h);
    // 3) 선택 구간 살짝 강조
    ctx.fillStyle = COLOR.region;
    ctx.fillRect(xs, 0, xe - xs, h);
    // 4) 핸들
    ctx.fillStyle = COLOR.handle;
    ctx.fillRect(xs - 1, 0, 3, h);
    ctx.fillRect(xe - 1, 0, 3, h);
    // 5) 재생 플레이헤드
    if (playhead != null) {
      const px = timeToX(playhead);
      ctx.fillStyle = COLOR.playhead;
      ctx.fillRect(px - 1, 0, 2, h);
      // 위쪽 삼각형 마커
      ctx.beginPath();
      ctx.moveTo(px - 5, 0);
      ctx.lineTo(px + 5, 0);
      ctx.lineTo(px, 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  function pointerX(e) {
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    return (cssX / rect.width) * canvas.width;
  }

  function onDown(e) {
    if (!buffer) return;
    canvas.setPointerCapture(e.pointerId);
    const x = pointerX(e);
    downX = x;
    prevSel = { start: selStart, end: selEnd };
    const xs = timeToX(selStart);
    const xe = timeToX(selEnd);

    if (Math.abs(x - xs) <= HANDLE_HIT) {
      dragMode = "start";
    } else if (Math.abs(x - xe) <= HANDLE_HIT) {
      dragMode = "end";
    } else {
      dragMode = "new";
      selStart = xToTime(x);
      selEnd = selStart;
    }
    draw();
  }

  function onMove(e) {
    if (!buffer) return;
    if (!dragMode) {
      updateCursor(e);
      return;
    }
    const t = xToTime(pointerX(e));
    if (dragMode === "start") selStart = t;
    else if (dragMode === "end") selEnd = t;
    else if (dragMode === "new") selEnd = t;

    if (selEnd < selStart) {
      [selStart, selEnd] = [selEnd, selStart];
      dragMode = dragMode === "start" ? "end" : dragMode === "end" ? "start" : dragMode;
    }
    draw();
    emit();
  }

  function onUp(e) {
    if (!buffer) return;
    const movedPx = Math.abs(pointerX(e) - downX);
    // 거의 안 움직였으면 클릭 = 그 지점부터 재생(seek), 선택은 원래대로 복원
    if (dragMode === "new" && movedPx < CLICK_SLOP) {
      if (prevSel) {
        selStart = prevSel.start;
        selEnd = prevSel.end;
      }
      const t = xToTime(downX);
      setPlayhead(t);
      draw();
      emit();
      if (onSeek) onSeek(t);
    }
    dragMode = null;
  }

  function updateCursor(e) {
    const x = pointerX(e);
    const near =
      Math.abs(x - timeToX(selStart)) <= HANDLE_HIT ||
      Math.abs(x - timeToX(selEnd)) <= HANDLE_HIT;
    canvas.style.cursor = near ? "ew-resize" : "crosshair";
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return { setBuffer, getSelection, setSelection, setPlayhead };
}
