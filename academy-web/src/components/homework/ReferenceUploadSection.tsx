import { useState } from 'react';
import type { ReferenceMaterial } from '../../types/hwReference';
import { initialReferenceMaterials } from '../../data/mockHwReference';
import styles from './ReferenceUploadSection.module.css';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

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
 * 실제 PDF 페이지 이미지 비교/AI 자동 오프셋 감지(auto_detect_page_offset)는
 * 서버에서 PDF를 실제로 열어 읽는 게 핵심이라, 이번 mock 단계에서는 업로드 ·
 * 목록 · 삭제 · 수동 보정까지만 그대로 만들고 "자동 감지" 버튼은 데모 문구로
 * 대체함(다른 화면과 동일한 보류 방식).
 */
export function ReferenceUploadSection({ classId }: ReferenceUploadSectionProps) {
  const [materials, setMaterials] = useState<ReferenceMaterial[]>(initialReferenceMaterials);
  const [isOpen, setIsOpen] = useState(false);

  const [newName, setNewName] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newOffsetInput, setNewOffsetInput] = useState('1');
  const [newAutoMessage, setNewAutoMessage] = useState('');
  const [newError, setNewError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');

  const [offsetOpenFor, setOffsetOpenFor] = useState<string | null>(null);
  const [offsetInputs, setOffsetInputs] = useState<Record<string, string>>({});
  const [offsetAutoMessages, setOffsetAutoMessages] = useState<Record<string, string>>({});
  const [offsetSavedMessages, setOffsetSavedMessages] = useState<Record<string, string>>({});

  const classMaterials = materials.filter((m) => m.classId === classId);

  function handleAutoDetectNew() {
    // 실제로는 업로드한 PDF 앞부분을 AI가 읽어 오프셋을 추정함(auto_detect_page_offset).
    // 여기서는 서버 연동 전이라 데모 값으로 대체.
    setNewOffsetInput('2');
    setNewAutoMessage('✅ 자동 감지 완료 (데모) — 표지 1장 감지, 인쇄 1페이지 = PDF 2번째 장');
  }

  function handleUpload() {
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
    const newMaterial: ReferenceMaterial = {
      id: `ref_${Date.now()}`,
      classId,
      materialName: newName.trim(),
      fileName: newFile.name,
      pageOffset: Math.max(0, Number(newOffsetInput) - 1 || 0),
      uploadedAt: todayStr(),
    };
    setMaterials((prev) => [...prev, newMaterial]);
    setUploadMessage(`✅ '${newMaterial.materialName}' 등록 완료`);
    setNewName('');
    setNewFile(null);
    setNewOffsetInput('1');
    setNewAutoMessage('');
  }

  function handleDelete(id: string) {
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  }

  function handleAutoDetectExisting(id: string) {
    setOffsetInputs((prev) => ({ ...prev, [id]: '2' }));
    setOffsetAutoMessages((prev) => ({ ...prev, [id]: '✅ 자동 재감지 완료 (데모) — 표지 1장 감지' }));
  }

  function handleSaveOffset(id: string) {
    const value = offsetInputs[id];
    const material = materials.find((m) => m.id === id);
    if (value === undefined || !material) return;
    const nextOffset = Math.max(0, Number(value) - 1 || 0);
    setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, pageOffset: nextOffset } : m)));
    setOffsetSavedMessages((prev) => ({ ...prev, [id]: '저장했습니다. 다음 페이지 확인부터 적용됩니다.' }));
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
            이름'이 과제 항목의 이름과 정확히 같아야 자동으로 연결됩니다. 문제집이 끝나면 삭제 후 다음 문제집으로
            교체하세요.
          </p>

          {classMaterials.length > 0 ? (
            <>
              <h4 className={styles.subTitle}>등록된 자료</h4>
              {classMaterials.map((m) => (
                <div key={m.id} className={styles.materialRow}>
                  <div className={styles.materialInfo}>
                    <span className={styles.materialIcon}>📄</span>
                    <span>
                      {m.materialName}
                      {m.pageOffset > 0 && ` · 인쇄 1페이지 = PDF ${m.pageOffset + 1}번째 장`}
                      {' '}(업로드 {m.uploadedAt})
                    </span>
                  </div>
                  <button type="button" className={styles.deleteButton} onClick={() => handleDelete(m.id)}>
                    삭제
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
                        고치세요. '자동 재감지'를 누르면 AI가 다시 읽어서 값을 채워줍니다 — 안 밀려 있으면 그대로
                        두면 됩니다.
                      </p>
                      <button type="button" className={styles.smallButton} onClick={() => handleAutoDetectExisting(m.id)}>
                        🤖 자동 재감지
                      </button>
                      {offsetAutoMessages[m.id] && <p className={styles.successText}>{offsetAutoMessages[m.id]}</p>}

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
                      <button type="button" className={styles.smallButton} onClick={() => handleSaveOffset(m.id)}>
                        보정값 저장
                      </button>
                      {offsetSavedMessages[m.id] && <p className={styles.successText}>{offsetSavedMessages[m.id]}</p>}
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <p className={styles.caption}>아직 등록된 자료가 없습니다. 등록 안 해도 기존 방식(사진 속 숫자 읽기)으로 그대로 동작합니다.</p>
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
            <input
              type="file"
              accept="application/pdf"
              className={styles.fileInput}
              onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {newFile && (
            <button type="button" className={styles.smallButton} onClick={handleAutoDetectNew}>
              🤖 페이지 번호 자동 감지 (추천)
            </button>
          )}
          {newAutoMessage && <p className={styles.successText}>{newAutoMessage}</p>}

          <div className={styles.field}>
            <label className={styles.label}>PDF 파일에서 '인쇄된 1페이지'가 실제로 몇 번째 장인가요?</label>
            <input
              type="number"
              className={styles.numberInput}
              min={1}
              value={newOffsetInput}
              onChange={(e) => setNewOffsetInput(e.target.value)}
            />
          </div>

          {newError && <p className={styles.errorText}>{newError}</p>}

          <button type="button" className={styles.uploadButton} onClick={handleUpload}>
            업로드
          </button>
          {uploadMessage && <p className={styles.successText}>{uploadMessage}</p>}
        </div>
      )}
    </div>
  );
}
