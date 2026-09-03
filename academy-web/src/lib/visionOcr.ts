import { supabase } from './supabaseClient';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
// Vite 전용 문법: 이 워커 파일을 실제로 import(실행)하는 게 아니라, 빌드 시
// 이 파일이 저장될 경로(URL)만 문자열로 받아옴. PDF 렌더링은 브라우저 메인
// 스레드를 막지 않도록 별도 워커 스레드에서 돌아가는데, 그 워커가 실행할
// 파일 위치를 pdf.js 라이브러리에 알려주는 용도.
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface OcrPage {
  page: number;
  text: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

/**
 * PDF 파일 1개 → 페이지마다 이미지(base64 JPEG)로 렌더링.
 * 시험지를 스캔해서 PDF로 받는 경우가 많아서(2026-08-28, 사용자 확인) 추가함.
 * scale: 2는 인식 정확도를 위해 화면 표시용보다 살짝 크게 렌더링(원본 스트림릿의
 * "PDF를 페이지 이미지로 변환 후 OCR" 방식과 같은 개념 — 단, 여긴 브라우저에서
 * 직접 렌더링한다는 점만 다름).
 */
async function pdfFileToPageImages(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const images: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('이미지를 그릴 캔버스를 만들지 못했습니다.');
    }
    await page.render({ canvasContext: context, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.92));
  }

  return images;
}

/**
 * 업로드한 파일들(이미지·PDF 섞어서 선택 가능) → OCR에 넘길 페이지 이미지
 * (base64) 배열로 변환. PDF는 각 페이지가 별도 이미지로 풀림(예: 2페이지짜리
 * PDF 1개를 올리면 이미지 2장으로 취급됨).
 *
 * 주의: hwp/hwpx 파일은 이 함수에 넘기면 안 됨(이미지가 아니라 텍스트 문서라서
 * 여기 방식으로 처리 불가) — extractTextFromFiles()에서 미리 걸러냄.
 */
export async function filesToPageImages(files: File[]): Promise<string[]> {
  const allImages: string[] = [];
  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const pdfImages = await pdfFileToPageImages(file);
      allImages.push(...pdfImages);
    } else {
      allImages.push(await fileToBase64(file));
    }
  }
  return allImages;
}

/**
 * 페이지 이미지(base64 문자열) 목록 → Google Vision OCR 텍스트 추출.
 *
 * 실제 API 키(Google Vision)는 브라우저에 절대 노출하지 않고, Supabase Edge
 * Function(vision-ocr)이 서버 쪽에서만 호출하도록 구성함 — 학부모님께 전하는
 * 글(OpenAI)과 동일한 원칙.
 * Edge Function 코드: academy-web/supabase/functions/vision-ocr/index.ts
 * (Supabase 대시보드에서 별도로 배포해야 실제로 동작함).
 */
export async function extractTextFromPageImages(images: string[]): Promise<OcrPage[]> {
  const { data, error } = await supabase.functions.invoke<{ pages?: OcrPage[]; error?: string }>('vision-ocr', {
    body: { images },
  });

  if (error) {
    throw error;
  }
  if (!data || data.error || !data.pages) {
    throw new Error(data?.error || 'OCR 텍스트 추출에 실패했습니다.');
  }
  return data.pages;
}

function isHwpxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.hwpx');
}

function isHwpFile(file: File): boolean {
  // .hwpx는 '.hwp'로 끝나지 않으므로(마지막 글자가 x) 별도 제외 처리 불필요.
  return file.name.toLowerCase().endsWith('.hwp');
}

/**
 * hwpx 문서 하나의 본문(section) XML 하나 → 문단 단위 줄글 텍스트.
 * hwpx는 한글이 저장 시 zip 안에 XML로 본문을 담아두는 최신 포맷(OWPML)이라,
 * 이미지로 바꿔서 OCR로 "읽을" 필요 없이 문서 안의 실제 글자를 그대로 꺼낼 수 있음
 * — 오히려 OCR보다 정확함. 문단(hp:p) 안의 텍스트런(hp:t)만 모아서 줄 단위로 합침
 * (글자 서식/표 구조 등은 무시 — 여기서는 GPT 분석용 순수 텍스트만 필요하므로 충분).
 */
function extractTextFromHwpxSectionXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return '';
  }
  const paragraphs = Array.from(doc.getElementsByTagName('*')).filter((el) => el.localName === 'p');
  const lines = paragraphs.map((p) => {
    const runs = Array.from(p.getElementsByTagName('*')).filter((el) => el.localName === 't');
    return runs.map((r) => r.textContent || '').join('');
  });
  return lines.join('\n');
}

/**
 * hwpx 파일(zip+XML) → 전체 텍스트.
 * 1순위: Contents/section0.xml, section1.xml, ... 을 순서대로 파싱해서 본문 추출.
 * 2순위(안전망): 위에서 텍스트를 못 뽑았을 때만, 한글이 미리보기/검색용으로
 * 자동 저장해두는 Preview/PrvText.txt를 대신 사용(UTF-16LE로 저장되는 경우가
 * 많아 BOM을 보고 인코딩을 맞춰서 읽음).
 */
async function extractHwpxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const sectionEntries = Object.keys(zip.files)
    .filter((name) => /(^|\/)section\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/section(\d+)\.xml$/i)?.[1] ?? '0', 10);
      const nb = parseInt(b.match(/section(\d+)\.xml$/i)?.[1] ?? '0', 10);
      return na - nb;
    });

  let text = '';
  if (sectionEntries.length > 0) {
    const parts: string[] = [];
    for (const name of sectionEntries) {
      const xml = await zip.files[name].async('text');
      parts.push(extractTextFromHwpxSectionXml(xml));
    }
    text = parts.join('\n\n').trim();
  }

  if (!text) {
    const previewMatches = zip.file(/Preview\/PrvText\.txt$/i);
    if (previewMatches.length > 0) {
      const buf = await previewMatches[0].async('arraybuffer');
      const bytes = new Uint8Array(buf);
      const isUtf16LE = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
      const decoder = new TextDecoder(isUtf16LE ? 'utf-16le' : 'utf-8');
      text = decoder.decode(isUtf16LE ? bytes.slice(2) : bytes).trim();
    }
  }

  if (!text) {
    throw new Error(
      `"${file.name}"에서 텍스트를 추출하지 못했습니다. 파일이 손상되었거나 지원하지 않는 hwpx 구조일 수 있습니다. PDF로 저장 후 다시 시도해 주세요.`,
    );
  }
  return text;
}

/**
 * 업로드 파일들(이미지·PDF·hwpx 혼합 가능) → OCR/텍스트 추출까지 한 번에.
 * "학원시험 AI분석"/"기출문제분석" 공용 진입점.
 *
 * 파일 종류별 처리:
 * - 이미지/PDF: 기존 그대로 이미지로 바꿔서 Google Vision OCR로 텍스트 추출.
 * - hwpx(최신 한글 형식): OCR 안 거치고 파일 안의 실제 텍스트를 직접 추출(더 정확함).
 * - hwp(구버전 한글 형식): 브라우저에서 안정적으로 읽어낼 방법이 없어서 지원 안 함 —
 *   섞여 있으면 다른 파일 처리 전에 바로 안내 메시지를 던짐(2026-09-03 추가).
 */
export async function extractTextFromFiles(files: File[]): Promise<OcrPage[]> {
  const hwpFiles = files.filter(isHwpFile);
  if (hwpFiles.length > 0) {
    const names = hwpFiles.map((f) => f.name).join(', ');
    throw new Error(
      `구버전 HWP 파일(${names})은 직접 읽을 수 없습니다. 한글 프로그램에서 "다른 이름으로 저장" → PDF를 선택해서 저장한 뒤, 그 PDF 파일로 다시 올려주세요.`,
    );
  }

  const hwpxFiles = files.filter(isHwpxFile);
  const otherFiles = files.filter((f) => !isHwpxFile(f) && !isHwpFile(f));

  const pages: OcrPage[] = [];
  let pageNum = 1;

  if (otherFiles.length > 0) {
    const images = await filesToPageImages(otherFiles);
    const ocrPages = await extractTextFromPageImages(images);
    for (const p of ocrPages) {
      pages.push({ page: pageNum, text: p.text });
      pageNum += 1;
    }
  }

  for (const file of hwpxFiles) {
    const text = await extractHwpxText(file);
    pages.push({ page: pageNum, text });
    pageNum += 1;
  }

  return pages;
}
