import { useEffect, useState } from 'react';
import type { ReferenceMaterial } from '../../lib/hwReference';
import {
  deleteReferenceMaterial,
  detectPageOffsetFromFile,
  detectPageOffsetFromUrl,
  fetchReferenceMaterials,
  saveReferenceMaterial,
  updateReferenceMaterialOffset,
} from '../../lib/hwReference';
import styles from './ReferenceUploadSection.module.css';

interface ReferenceUploadSectionProps {
  classId: string;
}

/**
 * 스트림릿 hw_reference.py의 render_reference_upload_section() 재현: 문제집·
 * 프린트 PDF를 반별로 미리 업로드해두면, 학생 인증샷 속 페이지 번호를 AI가
 * 손글씨로 읽는 대신 PDF 페이지 이미지와 직접 비교해서 찾아줌(선택 사항 —
 * 등록 안 해도 기존 방식대로 동작). 표지·목차 때문에 "인쇄 페이지"와 "PDF
 * 파일 내 장 번호"가 어긋나는 경우를 위한 page_offset 보정도 포함.
 *
 * [2026-08-30] dev DB(hw_reference_materials) + Supabase Storage(hw-reference-pdfs
 * 버킷)에 실제로 연결함(lib/hwReference.ts). 수동 보정 입력/저장은 실제로 동작함.
 *
 * [2026-09-01] "🤖 자동 감지"/"자동 재감지" 버튼을 실제로 연결함(과제인증
 * 4단계의 1/3) — Edge Function hw-detect-page-offset 호출, 결과로 오프셋
 * 입력값을 자동 채움(hw_reference.py의 auto_detect_page_offset과 동일 로직).
 * PDF→이미지 렌더링은 브라우저(pdf.js)에서, GPT-4o 판독만 서버(Edge Function)에서.
 *
 * [2026-08-30] PDF 파일 선택 칸에 드래그 앤 드롭 추가 — AiTestOcrPanel.tsx의
 * 기존 드롭존 패턴(isDragging state + onDragOver/onDragLeave/onDrop)을 그대로
 * 재사용. 클릭해서 선택하는 방식도 그대로 유지됨(투명 input이 영역 전체를 덮음).
 */
export function ReferenceUploadSection({ classId }: ReferenceUploadSectionProps) {
  const [materials, setMaterials] = useState<ReferenceMaterial[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [newName, setNewName] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [newOffsetInput, setNewOffsetInput] = useState('1');
  const [newError, setNewError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploading, setUploading] = useState(false);

  const [offsetOpenFor, setOffsetOpenFor] = useState<number | null>(null);
  const [offsetInputs, setOffsetInputs] = useState<Record<number, string>>({});
  const [offsetSavedMessages, setOffsetSavedMessages] = useState<Record<number, string>>({});
  const [offsetSavingId, setOffsetSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  // [2026-09-01] 과제인증 4단계(1/3): 페이지 오프셋 자동 감지 상태.
  const [detectingNew, setDetectingNew] = useState(false);
  const [detectNewMessage, setDetectNewMessage] = useState('');
  const [detectingId, setDetectingId] = useState<number | null>(null);
  const [detectMessages, setDetectMessages] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!classId || !isOpen) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchReferenceMaterials(classId)
      .then((rows) => {
        if (!cancelled) setMaterials(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, isOpen]);

  async function refresh() {
    const rows = await fetchReferenceMaterials(classId);
    setMaterials(rows);
  }

  function applyPickedFile(file: File | undefined | null) {
    if (!file) return;
    setNewError('');
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setNewError('PDF 파일만 올릴 수 있습니다.');
      return;
    }
    setNewFile(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    applyPickedFile(e.target.files?.[0]);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      applyPickedFile(file);
      setFileInputKey((k) => k + 1);
    }
  }

  async function handleDetectNewOffset() {
    if (!newFile) return;
    setDetectNewMessage('');
    setDetectingNew(true);
    try {
      const result = await detectPageOffsetFromFile(newFile);
      if (result.offset !== null) {
        setNewOffsetInput(String(result.offset + 1));
        setDetectNewMessage(`✅ 자동 감지 완료 — ${result.detail} 아래 숫자를 확인해보세요.`);
      } else {
        setDetectNewMessage(`⚠️ 자동 감지 실패: ${result.detail}`);
      }
    } catch (err) {
      setDetectNewMessage(`⚠️ 자동 감지 중 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDetectingNew(false);
    }
  }

  async function handleDetectExistingOffset(material: ReferenceMaterial) {
    setDetectMessages((prev) => ({ ...prev, [material.id]: '' }));
    setDetectingId(material.id);
    try {
      const result = await detectPageOffsetFromUrl(material.fileUrl);
      if (result.offset !== null) {
        setOffsetInputs((prev) => ({ ...prev, [material.id]: String(result.offset! + 1) }));
        setDetectMessages((prev) => ({ ...prev, [material.id]: `✅ 자동 감지 완료 — ${result.detail}` }));
      } else {
        setDetectMessages((prev) => ({ ...prev, [material.id]: `⚠️ 자동 감지 실패: ${result.detail}` }));
      }
    } catch (err) {
      setDetectMessages((prev) => ({
        ...prev,
        [material.id]: `⚠️ 자동 감지 중 오류: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setDetectingId(null);
    }
  }

  async function handleUpload() {
    setNewError('');
    setUploadMessage('');
    if (!newName.trim()) {
      setNewError('문제집/프린트 이름을 입력해주세요.');
      return;
    }
    if (!newFile) {
      setNewError('PDF 파일을 선택해주세요.');
      return;
    }
    const offset = Math.max(0, Number(newOffsetInput) - 1 || 0);
    setUploading(true);
    try {
      const saved = await saveReferenceMaterial(classId, newName, newFile, offset);
      await refresh();
      setUploadMessage(`✅ '${saved.materialName}' 등록 완료 (전체 ${saved.pageCount}페이지)`);
      setNewName('');
      setNewFile(null);
      setFileInputKey((k) => k + 1);
      setNewOffsetInput('1');
    } catch (err) {
      setNewError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(material: ReferenceMaterial) {
    if (!window.confirm(`'${material.materialName}'을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setDeletingId(material.id);
    try {
      await deleteReferenceMaterial(material);
      await refresh();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [material.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveOffset(material: ReferenceMaterial) {
    const value = offsetInputs[material.id];
    if (value === undefined) return;
    const nextOffset = Math.max(0, Number(value) - 1 || 0);
    setOffsetSavingId(material.id);
    try {
      await updateReferenceMaterialOffset(material.id, nextOffset);
      await refresh();
      setOffsetSavedMessages((prev) => ({ ...prev, [material.id]: '저장했습니다. 다음 페이지 확인부터 적용됩니다.' }));
    } catch (err) {
      setRowError((prev) => ({ ...prev, [material.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setOffsetSavingId(null);
    }
  }

  return (
    <div className={styles.card}>
      <button type="button" className={styles.expanderToggle} onClick={() => setIsOpen((v) => !v)}>
        {isOpen ? '▾' : '▸'} 📎 과제 자료 업로드 (문제집/프린트 PDF) — 선택 사항, AI 페이지 인식 정확도를 크게 높여줍니다
      </button>

      {isOpen && (
        <div className={styles.body}>
          <p className={styles.caption}>
            문제집/프린트 PDF를 미리 올려두면, 학생이 인증샷을 올렸을 때 AI가 손글씨/인쇄 숫자를 읽는 대신 사진을 실제
            페이지 이미지와 직접 비교해서 몇 쪽인지 찾아줍니다 — 훨씬 정확합니다. 아래에서 등록하는 '문제집/프린트
            이름'이 과제 항목의 이름과 정확히 같아야 자동으로 연결됩니다. 문제집이 끝나면 같은 이름으로 다시
            업로드하면 교체됩니다.
          </p>

          {loading && <p className={styles.caption}>불러오는 중...</p>}
          {loadError && <p className={styles.errorText}>목록을 불러오지 못했습니다: {loadError}</p>}

          {!loading && materials.length > 0 ? (
            <>
              <h4 className={styles.subTitle}>등록된 자료</h4>
              {materials.map((m) => (
                <div key={m.id} className={styles.materialRow}>
                  <div className={styles.materialInfo}>
                    <span className={styles.materialIcon}>📄</span>
                    <span>
                      {m.materialName} · 전체 {m.pageCount}페이지
                      {m.pageOffset > 0 && ` · 인쇄 1페이지 = PDF ${m.pageOffset + 1}번째 장`}
                      {' '}(업로드 {m.uploadedAt})
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => handleDelete(m)}
                    disabled={deletingId === m.id}
                  >
                    {deletingId === m.id ? '삭제 중...' : '삭제'}
                  </button>

                  <button
                    type="button"
                    className={styles.offsetToggle}
                    onClick={() => setOffsetOpenFor(offsetOpenFor === m.id ? null : m.id)}
                  >
                    {offsetOpenFor === m.id ? '▾' : '▸'} ⚙️ '{m.materialName}' 페이지 밀림 보정
                  </button>

                  {offsetOpenFor === m.id && (
                    <div className={styles.offsetBody}>
                      <p className={styles.caption}>
                        표지·목차 등이 앞에 있어서 '인쇄된 1페이지'가 PDF 파일 자체의 첫 장이 아니라면 여기서
                        고치세요. 안 밀려 있으면 그대로 두면 됩니다.
                      </p>
                      <div className={styles.field}>
                        <label className={styles.label}>PDF 파일에서 '인쇄 1페이지'가 실제로 몇 번째 장인가요?</label>
                        <input
                          type="number"
                          className={styles.numberInput}
                          min={1}
                          value={offsetInputs[m.id] ?? String(m.pageOffset + 1)}
                          onChange={(e) => setOffsetInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.smallButton}
                        onClick={() => handleSaveOffset(m)}
                        disabled={offsetSavingId === m.id}
                      >
                        {offsetSavingId === m.id ? '저장 중...' : '보정값 저장'}
                      </button>{' '}
                      <button
                        type="button"
                        className={styles.smallButton}
                        onClick={() => handleDetectExistingOffset(m)}
                        disabled={detectingId === m.id}
                      >
                        {detectingId === m.id ? '감지 중...' : '🤖 자동 재감지'}
                      </button>
                      {offsetSavedMessages[m.id] && <p className={styles.successText}>{offsetSavedMessages[m.id]}</p>}
                      {detectMessages[m.id] && <p className={styles.caption}>{detectMessages[m.id]}</p>}
                    </div>
                  )}
                  {rowError[m.id] && <p className={styles.errorText}>{rowError[m.id]}</p>}
                </div>
              ))}
            </>
          ) : (
            !loading &&
            !loadError && (
              <p className={styles.caption}>아직 등록된 자료가 없습니다. 등록 안 해도 기존 방식(사진 속 숫자 읽기)으로 그대로 동작합니다.</p>
            )
          )}

          <h4 className={styles.subTitle}>새 자료 등록</h4>

          <div className={styles.field}>
            <label className={styles.label}>문제집/프린트 이름 (과제 항목 이름과 똑같이 입력)</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="예: 쎈 수학(상)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>PDF 파일</label>
            <div
              className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {newFile ? (
                <p className={styles.dropzoneText}>
                  📄 {newFile.name}
                  <br />
                  (다시 클릭하거나 새 파일을 끌어다 놓으면 선택이 바뀝니다)
                </p>
              ) : (
                <p className={styles.dropzoneText}>여기로 PDF 파일을 끌어다 놓거나, 클릭해서 선택하세요</p>
              )}
              <input
                key={fileInputKey}
                type="file"
                accept="application/pdf"
                className={styles.hiddenFileInput}
                onChange={handleFileInputChange}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>PDF 파일에서 '인쇄된 1페이지'가 실제로 몇 번째 장인가요? (모르면 1로 두세요)</label>
            <input
              type="number"
              className={styles.numberInput}
              min={1}
              value={newOffsetInput}
              onChange={(e) => setNewOffsetInput(e.target.value)}
            />
          </div>

          <button
            type="button"
            className={styles.smallButton}
            onClick={handleDetectNewOffset}
            disabled={!newFile || detectingNew}
          >
            {detectingNew ? '감지 중...' : '🤖 페이지 번호 자동 감지 (추천)'}
          </button>
          {detectNewMessage && <p className={styles.caption}>{detectNewMessage}</p>}

          {newError && <p className={styles.errorText}>{newError}</p>}

          <button type="button" className={styles.uploadButton} onClick={handleUpload} disabled={uploading}>
            {uploading ? '업로드 중...' : '업로드'}
          </button>
          {uploadMessage && <p className={styles.successText}>{uploadMessage}</p>}
        </div>
      )}
    </div>
  );
}
