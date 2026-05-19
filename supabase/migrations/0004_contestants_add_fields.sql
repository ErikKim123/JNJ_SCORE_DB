-- 3.참가자 시트의 추가 컬럼 수용.
--   team_size      — 4번 컬럼 (헤더 비어있음, 값 "1" 등)
--   genre          — 5번 컬럼 (예: "바차타")
--   division       — 6번 컬럼 (예: "소셜댄스")
--   age_group      — 7번 컬럼 ("성인" 등 — 헤더는 "X" placeholder)
--   birthdate      — 8번 컬럼 (YYYY-MM-DD)
--   contact_phone  — 10번 컬럼
--   contact_email  — 11번 컬럼
--   nationality    — 12번 컬럼 (예: "Prowdmon")
--   instagram      — 13번 컬럼
--   registered_at  — 15번 컬럼 (접수일 YYYY-MM-DD)

set search_path = public;

alter table contestants
  add column if not exists team_size     text,
  add column if not exists genre         text,
  add column if not exists division      text,
  add column if not exists age_group     text,
  add column if not exists birthdate     date,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists nationality   text,
  add column if not exists instagram     text,
  add column if not exists registered_at date;
