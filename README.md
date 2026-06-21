# easy-web-tools

브라우저에서 바로 쓰는 웹 도구 모음. 모든 처리가 클라이언트 사이드에서 일어나 파일이 서버로 전송되지 않습니다.

**Live:** https://easywebtools-1rk.pages.dev

## 기능

- **🎵 MP3 편집** — 파형에서 드래그로 구간 선택, 선택 구간 반복 재생(스페이스바), MP3로 트림 (lamejs)
- **🖼️ 이미지 리사이즈** — 여러 장 일괄, 긴 변/너비/높이/퍼센트/정확한 크기, PNG·JPEG·WebP, HEIC 입력 지원
- **🎛️ 이미지 편집 (WASM)** — 밝기·대비·채도·색조·블러, 회전/반전, 자르기, 텍스트, 워터마크 (Photon WASM)
- **🟣 도장 찍기** — 도장 이미지를 여러 사진 위 한 곳에 일괄 합성
- **📄 PDF ↔ PNG** — PDF 페이지를 PNG로(ZIP), 여러 이미지를 하나의 PDF로 (pdf.js, jsPDF)

## 기술

- 순수 정적 사이트 (빌드 단계 없음), TailwindCSS + Lucide
- WASM: Photon(이미지 편집), libheif-js(HEIC 디코드)
- CDN: pdf.js, jsPDF, JSZip, lamejs

## 로컬 실행

```bash
python3 -m http.server 8765 --directory public
# http://localhost:8765
```

## 배포 (Cloudflare Pages)

```bash
npx wrangler pages deploy public --project-name easywebtools --branch main
```
