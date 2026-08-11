-- 문제은행 난이도 일괄 수정 (2026-07-24)
--
-- 배경: 기본·최다빈출 = 중난이도(Mid), 발전·최다오답 = 상난이도(High)로 확정.
-- 그런데 zokbo_import.py의 예전 코드는 "기본·최다빈출 -> Low"로 잘못 매핑돼 있었음
-- (코드는 이미 수정함). 이 스크립트는 이미 등록된 기존 데이터 값만 바로잡는다.
--
-- 지금까지 등록된 자료는 전부 "기본" 등급 7,663문항뿐이라, 아래 조건이면
-- 정확히 그 데이터만 걸린다 (다른 자료가 실수로 같이 바뀔 위험 없음).
--
-- 실행 방법: Supabase 대시보드 -> SQL Editor에 아래 내용을 순서대로 붙여넣고 실행.

-- 1) 실행 전 확인 — 몇 건이 바뀔지 먼저 확인 (여기서 반드시 숫자를 확인하고 다음 단계로)
SELECT COUNT(*) AS will_update
FROM question_bank
WHERE source_format = 'zokbo' AND level = 'Low';

-- 2) 실제 수정 — 위에서 확인한 숫자가 예상(약 7,663)과 맞으면 실행
UPDATE question_bank
SET level = 'Mid'
WHERE source_format = 'zokbo' AND level = 'Low';

-- 3) 실행 후 확인 — 전체 난이도 분포 재확인 (Low 0건, Mid만 늘어나 있으면 정상)
SELECT level, COUNT(*) FROM question_bank GROUP BY level;
