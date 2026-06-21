// MP3 편집 (트림) - 파형에서 드래그로 구간 선택, lamejs로 MP3 인코딩

(function () {
  const input = document.getElementById("audioInput");
  const drop = document.getElementById("audioDrop");
  const editor = document.getElementById("audioEditor");
  const preview = document.getElementById("audioPreview");
  const waveCanvas = document.getElementById("audioWave");
  const selReadout = document.getElementById("audioSel");
  const playSelBtn = document.getElementById("audioPlaySel");
  const trimBtn = document.getElementById("audioTrim");
  const status = document.getElementById("audioStatus");

  let audioBuffer = null;
  let fileName = "audio";
  let sel = { start: 0, end: 0 };
  let rafId = null;

  const wave = createWaveform(waveCanvas, {
    onChange: (start, end) => {
      sel = { start, end };
      selReadout.textContent = `선택: ${formatTime(start)} ~ ${formatTime(end)}  ·  길이 ${(end - start).toFixed(2)}s`;
    },
    // 파형 클릭 → 그 지점부터 재생 (단, 선택 구간 안으로 제한)
    onSeek: (t) => {
      preview.currentTime = clampToSel(t);
      preview.play();
    },
  });

  // 선택 구간 [start,end] 안으로 시간 제한
  function clampToSel(t) {
    return Math.max(sel.start, Math.min(sel.end, t));
  }

  // 재생 중 플레이헤드를 따라가게 하고, 선택 구간을 벗어나면 시작으로 되돌려 루프
  function startPlayheadLoop() {
    cancelAnimationFrame(rafId);
    const tick = () => {
      if (!preview.paused) {
        // 끝(또는 그 직전)에 닿거나 시작보다 앞이면 선택 시작으로 점프 → 무한 루프
        if (preview.currentTime >= sel.end - 0.01 || preview.currentTime < sel.start - 0.01) {
          preview.currentTime = sel.start;
        }
      }
      wave.setPlayhead(preview.currentTime);
      if (!preview.paused && !preview.ended) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
  }
  function stopPlayheadLoop() {
    cancelAnimationFrame(rafId);
    wave.setPlayhead(preview.currentTime);
  }
  preview.addEventListener("play", startPlayheadLoop);
  preview.addEventListener("pause", stopPlayheadLoop);
  preview.addEventListener("ended", stopPlayheadLoop);
  preview.addEventListener("seeked", () => wave.setPlayhead(preview.currentTime));

  // 스페이스바: MP3 탭이 활성일 때 재생/일시정지 토글
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const audioPanelActive = document.getElementById("audio").classList.contains("active");
    if (!audioPanelActive || !audioBuffer) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (["input", "textarea", "select", "button"].includes(tag)) return;
    e.preventDefault();
    if (preview.paused) {
      if (preview.currentTime < sel.start || preview.currentTime >= sel.end - 0.01) {
        preview.currentTime = sel.start;
      }
      preview.play();
    } else {
      preview.pause();
    }
  });

  wireDropzone(drop, input, async (files) => {
    const file = files[0];
    fileName = stripExt(file.name);
    setStatus(status, "디코딩 중…", "work");
    try {
      const arrayBuf = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
      audioCtx.close();

      preview.src = URL.createObjectURL(file);
      editor.classList.remove("hidden");
      wave.setBuffer(audioBuffer);
      setStatus(status, "준비 완료. 파형을 드래그해 구간을 정하세요.", "ok");
    } catch (err) {
      console.error(err);
      setStatus(status, "이 파일을 디코딩할 수 없습니다: " + err.message, "err");
    }
  });

  // 선택 구간 반복 재생 (루프는 startPlayheadLoop에서 처리)
  playSelBtn.addEventListener("click", () => {
    if (!audioBuffer) return;
    preview.currentTime = sel.start;
    preview.play();
  });

  trimBtn.addEventListener("click", () => {
    if (!audioBuffer) return;
    const { start, end } = sel;

    if (end - start < 0.05) {
      setStatus(status, "구간이 너무 짧습니다. 파형에서 더 넓게 드래그하세요.", "err");
      return;
    }

    setStatus(status, "MP3로 인코딩 중… (길수록 시간이 걸립니다)", "work");
    trimBtn.disabled = true;

    setTimeout(() => {
      try {
        const blob = encodeTrimmedMp3(audioBuffer, start, end);
        downloadBlob(blob, `${fileName}_trim.mp3`);
        setStatus(status, "완료! MP3 파일을 저장했습니다.", "ok");
      } catch (err) {
        console.error(err);
        setStatus(status, "인코딩 실패: " + err.message, "err");
      } finally {
        trimBtn.disabled = false;
      }
    }, 30);
  });

  // 잘라낸 구간을 MP3 Blob으로 인코딩
  function encodeTrimmedMp3(buffer, start, end) {
    const sampleRate = buffer.sampleRate;
    const channels = Math.min(buffer.numberOfChannels, 2);
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const length = endSample - startSample;

    const left = buffer.getChannelData(0).subarray(startSample, endSample);
    const right = channels > 1 ? buffer.getChannelData(1).subarray(startSample, endSample) : null;

    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
    const blockSize = 1152;
    const mp3Data = [];

    const leftInt = floatTo16(left);
    const rightInt = right ? floatTo16(right) : null;

    for (let i = 0; i < length; i += blockSize) {
      const leftChunk = leftInt.subarray(i, i + blockSize);
      let mp3buf;
      if (channels > 1) {
        const rightChunk = rightInt.subarray(i, i + blockSize);
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      }
      if (mp3buf.length) mp3Data.push(mp3buf);
    }
    const flush = mp3encoder.flush();
    if (flush.length) mp3Data.push(flush);

    return new Blob(mp3Data, { type: "audio/mp3" });
  }

  // Float32 [-1,1] -> Int16
  function floatTo16(floatArr) {
    const out = new Int16Array(floatArr.length);
    for (let i = 0; i < floatArr.length; i++) {
      const s = Math.max(-1, Math.min(1, floatArr[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
})();
