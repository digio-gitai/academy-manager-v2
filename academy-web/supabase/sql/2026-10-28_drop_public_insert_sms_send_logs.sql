-- 2026-10-28: sms_send_logs 공개 insert 정책 삭제.
-- 기록은 서버(send-sms / hw-nightly-sms, 서비스 키)와 야간 파이썬 스크립트(DB 직접 연결)만 쓴다.
drop policy if exists "allow public insert sms_send_logs" on public.sms_send_logs;
