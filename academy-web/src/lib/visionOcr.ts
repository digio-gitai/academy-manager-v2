import { supabase } from './supabaseClient';
import * as pdfjsLib from 'pdfjs-dist';
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

/**
 * 업로드 파일들(이미지·PDF 혼합 가능) → OCR 텍스트까지 한 번에.
 * "학원시험 AI분석" 4단계 계획 중 1단계(OCR 텍스트 추출만) 담당.
 * 다음 단계에서 GPT-4o 정제/문항 분석이 추가될 예정.
 */
export async function extractTextFromFiles(files: File[]): Promise<OcrPage[]> {
  const images = await filesToPageImages(files);
  return extractTextFromPageImages(images);
}
