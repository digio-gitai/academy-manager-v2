import type { HwItemType } from '../../types/homework';
import { HW_ITEM_TYPE_LABELS } from '../../types/homework';
import styles from './HwItemRows.module.css';

export interface ItemRowDraft {
  key: string;
  itemType: HwItemType;
  materialName: string;
  pageStart: string;
  pageEnd: string;
  description: string;
}

let rowSeed = 1;
export function newItemRowDraft(): ItemRowDraft {
  rowSeed += 1;
  return {
    key: `row_${rowSeed}`,
    itemType: 'page_range',
    materialName: '',
    pageStart: '',
    pageEnd: '',
    description: '',
  };
}

interface HwItemRowsProps {
  rows: ItemRowDraft[];
  onChange: (rows: ItemRowDraft[]) => void;
}

/**
 * 스트림릿 hw_assign.py의 _render_item_rows() 재현: 항목(문제집/프린트)을
 * 여러 개 동적으로 추가·삭제할 수 있는 편집기. 공통 과제 항목과 개별 과제
 * 항목 양쪽에서 재사용됨(원본과 동일).
 */
export function HwItemRows({ rows, onChange }: HwItemRowsProps) {
  function updateRow(key: string, patch: Partial<ItemRowDraft>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    onChange(rows.filter((r) => r.key !== key));
  }

  function addRow() {
    onChange([...rows, newItemRowDraft()]);
  }

  return (
    <div className={styles.wrap}>
      {rows.map((row, idx) => (
        <div key={row.key} className={styles.row}>
          <div className={styles.rowHeader}>
            <span className={styles.rowIndex}>항목 {idx + 1}</span>
            {rows.length > 1 && (
              <button type="button" className={styles.removeButton} onClick={() => removeRow(row.key)}>
                － 항목 제거
              </button>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>문제집 · 프린트 이름</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="예: 쎈 수학(상)"
              value={row.materialName}
              onChange={(e) => updateRow(row.key, { materialName: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>유형</label>
            <div className={styles.radioGroup}>
              {(Object.keys(HW_ITEM_TYPE_LABELS) as HwItemType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={styles.radioBtn}
                  data-active={row.itemType === t}
                  onClick={() => updateRow(row.key, { itemType: t })}
                >
                  {HW_ITEM_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {row.itemType === 'page_range' ? (
            <div className={styles.pageRow}>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label className={styles.label}>시작 p</label>
                <input
                  type="number"
                  className={styles.numberInput}
                  min={1}
                  value={row.pageStart}
                  onChange={(e) => updateRow(row.key, { pageStart: e.target.value })}
                />
              </div>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label className={styles.label}>끝 p</label>
                <input
                  type="number"
                  className={styles.numberInput}
                  min={1}
                  value={row.pageEnd}
                  onChange={(e) => updateRow(row.key, { pageEnd: e.target.value })}
                />
              </div>
            </div>
          ) : null}

          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label}>설명 (선택)</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder={row.itemType === 'wrong_note' ? '예: 8/18 단원평가 오답정리' : '예: 이차방정식 문제'}
              value={row.description}
              onChange={(e) => updateRow(row.key, { description: e.target.value })}
            />
          </div>
        </div>
      ))}

      <button type="button" className={styles.addButton} onClick={addRow}>
        ＋ 항목 추가
      </button>
    </div>
  );
}
