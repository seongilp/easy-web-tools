// 네이티브 <select>를 버튼 그룹(세그먼트 컨트롤)으로 대체.
// 원본 <select>는 값/상태 유지를 위해 그대로 두고 시각적으로만 숨긴다.
// 버튼 클릭 시 select.value 갱신 + 'change' 이벤트 발생 → 기존 로직과 호환.

(function () {
  function enhance(select) {
    if (select.dataset.enhanced) return;
    select.dataset.enhanced = "1";

    const seg = document.createElement("div");
    seg.className = "seg";
    select.parentNode.insertBefore(seg, select);
    select.classList.add("cs-native");

    function build() {
      seg.innerHTML = "";
      [...select.options].forEach((opt, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "seg-btn" + (i === select.selectedIndex ? " active" : "");
        btn.textContent = opt.textContent;
        btn.addEventListener("click", () => {
          select.selectedIndex = i;
          updateActive();
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        seg.appendChild(btn);
      });
    }

    function updateActive() {
      [...seg.children].forEach((btn, i) =>
        btn.classList.toggle("active", i === select.selectedIndex)
      );
    }

    // 외부에서 select.value를 바꾼 경우 활성 버튼 동기화
    select.addEventListener("change", updateActive);

    build();
  }

  function enhanceAll() {
    // data-no-enhance가 붙은 select는 네이티브 드롭다운으로 둔다(엑셀풍 툴바 등)
    document.querySelectorAll("select:not([data-no-enhance])").forEach(enhance);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceAll);
  } else {
    enhanceAll();
  }
  window.enhanceSelects = enhanceAll;
})();
