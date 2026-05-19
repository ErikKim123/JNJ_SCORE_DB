// One-shot importer: Google Sheets → Supabase.
//
//   node scripts/import-from-sheets.mjs                     # all comps in 대회목록시트
//   node scripts/import-from-sheets.mjs 202606-0001         # only this comp id
//   node scripts/import-from-sheets.mjs --wipe              # truncate first
//
// Idempotent: uses ON CONFLICT upsert on (competition_id, ...) PKs/UQs.
// Mirrors parsing logic in app/api/sheet/* routes — keep in sync until those
// routes are swapped to read from Supabase.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenv } from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
dotenv({ path: join(root, '.env.local') });

const REF = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const INDEX_SHEET_ID = '1bRclkuN8fuSfhoSrRUEtBjPPx6TePofxojE72qHV6iU';
const INDEX_GID = '2102151233';

// ---------- CSV / fetch helpers (mirrors lib/sheet-fetch.ts) ----------
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === ',') { out.push(cur); cur = ''; }
    else if (c === '"') inQuotes = true;
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function fetchTab(sheetId, tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&headers=0&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status} for ${tabName}`);
  return await res.text();
}

async function fetchIndexCsv() {
  const url = `https://docs.google.com/spreadsheets/d/${INDEX_SHEET_ID}/export?format=csv&gid=${INDEX_GID}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Index sheet HTTP ${res.status}`);
  return await res.text();
}

// ---------- 대회목록시트 parser (mirrors /api/sheet/competitions) ----------
function parseCompetitions(csv) {
  const lines = csv.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^고유번호\s*,/.test(l));
  if (headerIdx < 0) return [];
  const headers = parseCsvLine(lines[headerIdx]).map((h) => h.trim());
  const at = (name, fallbacks = []) => {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
    for (const f of fallbacks) {
      const j = headers.indexOf(f);
      if (j >= 0) return j;
    }
    return -1;
  };
  const colId = at('고유번호');
  const colName = at('대회명');
  const colDate = at('대회 일시', ['대회일시']);
  const colOrg = at('주최');
  const colCName = at('담당자 이름', ['담당자']);
  const colCPhone = at('담당자 연락처', ['연락처']);
  const colCEmail = at('담당자 이메일');
  const colMaster = at('마스터 파일', ['마스터파일']);
  const colMasterName = at('파일명');
  const out = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const id = cols[colId]?.trim();
    const name = cols[colName]?.trim();
    if (!id || !name) continue;
    const masterUrl = cols[colMaster]?.trim() || '';
    const masterId = masterUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
    out.push({
      id, name,
      date: cols[colDate]?.trim() ?? '',
      organizer: cols[colOrg]?.trim() || null,
      contactName: cols[colCName]?.trim() || null,
      contactPhone: cols[colCPhone]?.trim() || null,
      contactEmail: cols[colCEmail]?.trim() || null,
      masterFileId: masterId || null,
      masterFileName: cols[colMasterName]?.trim() || null,
    });
  }
  return out;
}

// ---------- 1.대회정보 parser ----------
function parseEvent(csv) {
  const map = new Map();
  for (const line of csv.split(/\r?\n/)) {
    const cols = parseCsvLine(line);
    const k = cols[0]?.trim();
    const v = cols[1]?.trim();
    if (k && v) map.set(k, v);
  }
  const get = (...keys) => {
    for (const k of keys) { const v = map.get(k); if (v) return v; }
    return null;
  };
  const dateText = get('대회 일시', '대회일시') ?? '';
  const m = dateText.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const isoDate = m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : null;
  const passCap = (raw) => {
    const v = String(raw ?? '').trim();
    const n = parseInt(v.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    name: get('대회명'),
    subtitle: get('대회 부제/슬로건', '대회 부제'),
    venue: get('대회 장소'),
    venueAddress: get('상세 주소'),
    organizer: get('주최'),
    host: get('주관'),
    sponsor: get('후원'),
    eventDate: isoDate,
    eventDateText: dateText || null,
    genres: get('대회 장르'),
    divisions: get('참가 부문'),
    ageGroups: get('참가 연령'),
    capacityNote: get('참가 인원(팀) 제한'),
    feeNote: get('참가비'),
    prizeNote: get('시상 내역'),
    formatNote: get('대회 진행 방식'),
    contactName: get('담당자 이름'),
    contactPhone: get('담당자 연락처'),
    contactEmail: get('담당자 이메일'),
    homepage: get('공식 홈페이지/SNS'),
    notice: get('기타 공지사항'),
    prelimPassCap: passCap(get('🟢 예선 통과 인원 (역할별)', '예선 통과 인원 (역할별)', '예선 통과 인원')),
    semiPassCap:   passCap(get('🟠 본선 통과 인원 (역할별)', '본선 통과 인원 (역할별)', '본선 통과 인원')),
    templateNo:    Number.parseInt(get('디자인 템플릿 번호') || '', 10) || null,
    roundStates: {
      prelim: parseLifecycle(get('예선 대회 상태', '예선')),
      semi:   parseLifecycle(get('본선 대회 상태', '본선')),
      final:  parseLifecycle(get('결승 대회 상태', '결승')),
    },
  };
}

function parseLifecycle(text) {
  if (!text) return 'prep';
  const t = String(text).trim().toLowerCase();
  if (t === 'live' || t.includes('진행')) return 'live';
  if (t === 'prep' || t.includes('준비')) return 'prep';
  if (t === 'pairing' || t.includes('페어링') || t.includes('조편성') || t.includes('매칭')) return 'pairing';
  if (t === 'calculate total' || t === 'calculate' || t.includes('집계') || t.includes('계산')) return 'calculate';
  if (t === 'result' || t.includes('결과') || t.includes('발표')) return 'result';
  if (t === 'close' || t === 'closed' || t.includes('종료') || t.includes('마감')) return 'close';
  if (t === 'open' || t.includes('대기') || t.includes('예정')) return 'open';
  return 'prep';
}

// ---------- 2.심사위원 parser ----------
function parseJudges(csv) {
  const judges = [];
  for (const line of csv.split(/\r?\n/)) {
    const cols = parseCsvLine(line);
    const num = cols[0]?.trim() ?? '';
    const name = cols[1]?.trim() ?? '';
    if (!/^\d+$/.test(num) || !name) continue;
    const target = parseVoteTarget(cols[11]);
    judges.push({
      displayNo: parseInt(num, 10),
      name,
      stageName: cols[2]?.trim() || null,
      genre: cols[3]?.trim() || null,
      affiliation: cols[4]?.trim() || null,
      career: cols[5]?.trim() || null,
      contactPhone: cols[6]?.trim() || null,
      contactEmail: cols[7]?.trim() || null,
      memo: cols[8]?.trim() || null,
      maxPrelimVotes: parseIntOrNull(cols[9]),
      maxSemiVotes: parseIntOrNull(cols[10]),
      voteTarget: target,
    });
  }
  return judges;
}

function parseIntOrNull(raw) {
  const v = String(raw ?? '').trim();
  if (!/^\d+$/.test(v)) return null;
  return parseInt(v, 10);
}

function parseVoteTarget(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return 'all';
  if (v === '리더' || v === 'leader' || v.includes('리더')) return 'leader';
  if (v === '팔로워' || v === '팔로어' || v === 'follower' || v.includes('팔로')) return 'follower';
  return 'all';
}

function parseRole(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === '리더' || v === 'leader' || v.includes('리더')) return 'leader';
  if (v === '팔로워' || v === '팔로어' || v === 'follower' || v.includes('팔로')) return 'follower';
  return 'solo';
}

// ---------- 3.참가자 parser (contestants + votes + final scores) ----------
// Mirrors app/api/sheet/round/route.ts but in one pass collects ALL data per
// contestant (across all judges and rounds).
function parseParticipants(csv) {
  const lines = csv.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => {
    const first = parseCsvLine(l)[0]?.replace(/^☑\s*/, '').trim() ?? '';
    return first === '참가번호';
  });
  if (headerIdx < 0) throw new Error('Cannot locate 참가번호 header row in 3.참가자');

  const headers = parseCsvLine(lines[headerIdx]).map((h) => h.replace(/^☑\s*/, '').trim());
  const subHeaders = parseCsvLine(lines[headerIdx + 1] ?? '').map((h) => h.trim());
  const dataStart = subHeaders.some((h) => h === '기본기') ? headerIdx + 2 : headerIdx + 1;

  const at = (name, fallbacks = []) => {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
    for (const f of fallbacks) { const j = headers.indexOf(f); if (j >= 0) return j; }
    return -1;
  };
  const numIdx = at('참가번호');
  const teamIdx = at('팀명/참가자명', ['팀명', '참가자명']);
  const leaderIdx = at('대표자명', ['대표자', '리더']);
  const roleIdx = at('역할', ['역활']);
  const photoIdx = at('사진', ['사진 URL', 'photo']);
  const photoOrigIdx = at('사진원본', ['사진 원본', '원본사진']);
  const memoIdx = at('상태', ['비고']);
  // 추가 컬럼: 위치 기반 (헤더가 비어있거나 "X" placeholder 인 경우 포함).
  //   4=team_size (헤더 빈칸), 5=장르, 6=부문,
  //   7=age_group (헤더 "X"), 8=birthdate (헤더 "X"),
  //   10=연락처, 11=이메일, 12=Nationality, 13=Instagram Handle,
  //   15=접수일
  const genreIdx = at('장르');
  const divisionIdx = at('부문');
  const ageIdx = leaderIdx >= 0 ? leaderIdx + 4 : -1; // 대표자(3) + 4 = 7
  const birthIdx = leaderIdx >= 0 ? leaderIdx + 5 : -1;
  const teamSizeIdx = leaderIdx >= 0 ? leaderIdx + 1 : -1; // 대표자(3) + 1 = 4
  const phoneIdx = at('연락처');
  const emailIdx = at('이메일');
  const nationIdx = at('Nationality');
  const instaIdx = at('Instagram Handle', ['Instagram', '인스타그램']);
  const registeredIdx = at('접수일');

  // Judge VOTE column groups
  //   prelim: (after 비고 or 상태) .. (before 예선 등수 / 예선통과)
  //   semi:   (after 예선 등수 + 자동 컬럼) .. (before 본선 등수 / 본선통과)
  const prelimStart = (() => {
    const a = headers.indexOf('상태');
    if (a >= 0) return a + 1;
    const b = headers.indexOf('비고');
    if (b >= 0) return b + 1;
    return -1;
  })();
  let prelimEnd = headers.indexOf('예선 등수');
  if (prelimEnd < 0) prelimEnd = headers.findIndex((h) => h.startsWith('예선통과'));
  const prelimJudgeCount = prelimStart >= 0 && prelimEnd > prelimStart ? prelimEnd - prelimStart : 0;

  const semiStart = (() => {
    const r = headers.indexOf('예선 등수');
    if (r >= 0) return r + 2; // +1 등수, +1 자동통과(빈 헤더)
    const labeled = headers.findIndex((h) => h.startsWith('예선통과'));
    if (labeled >= 0) return labeled + 1;
    return -1;
  })();
  let semiEnd = headers.indexOf('본선 등수');
  if (semiEnd < 0) semiEnd = headers.findIndex((h) => h.startsWith('본선통과'));
  const semiJudgeCount = semiStart >= 0 && semiEnd > semiStart ? semiEnd - semiStart : 0;

  // Final score group: 본선 등수 + 3 = J01.basics (validated against sub-header 기본기)
  const finalGroupStart = (() => {
    const r = headers.indexOf('본선 등수');
    if (r >= 0) {
      const start = r + 3;
      const j1 = subHeaders[start]?.trim();
      const j2 = subHeaders[start + 3]?.trim();
      if (j1 === '기본기' || j2 === '기본기') return start;
    }
    const subFirst = subHeaders.indexOf('기본기');
    if (subFirst >= 0) return subFirst;
    return -1;
  })();
  // count of final-score judges = number of consecutive 기본기 sub-headers after start, /3
  const finalJudgeCount = (() => {
    if (finalGroupStart < 0) return 0;
    let count = 0;
    for (let c = finalGroupStart; c + 2 < subHeaders.length; c += 3) {
      const lbl = subHeaders[c]?.trim();
      const next = subHeaders[c + 3]?.trim();
      if (lbl === '기본기') { count++; continue; }
      if (next === '기본기' && lbl === '') { count++; continue; } // J01 sub-header empty
      break;
    }
    return count;
  })();

  const contestants = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const number = cols[numIdx]?.trim() ?? '';
    if (!/^\d+/.test(number)) continue;

    const role = roleIdx >= 0 ? parseRole(cols[roleIdx]) : null;
    const photoUrl = pickPhoto(cols[photoIdx], cols[photoOrigIdx]);
    const c = {
      number,
      teamOrName: teamIdx >= 0 ? cols[teamIdx]?.trim() || null : null,
      representative: leaderIdx >= 0 ? cols[leaderIdx]?.trim() || null : null,
      role,
      photoUrl,
      memo: memoIdx >= 0 ? cols[memoIdx]?.trim() || null : null,
      teamSize: teamSizeIdx >= 0 ? cols[teamSizeIdx]?.trim() || null : null,
      genre: genreIdx >= 0 ? cols[genreIdx]?.trim() || null : null,
      division: divisionIdx >= 0 ? cols[divisionIdx]?.trim() || null : null,
      ageGroup: ageIdx >= 0 ? cols[ageIdx]?.trim() || null : null,
      birthdate: birthIdx >= 0 ? toIsoDate(cols[birthIdx]) : null,
      contactPhone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || null : null,
      contactEmail: emailIdx >= 0 ? cols[emailIdx]?.trim() || null : null,
      nationality: nationIdx >= 0 ? cols[nationIdx]?.trim() || null : null,
      instagram: instaIdx >= 0 ? cols[instaIdx]?.trim() || null : null,
      registeredAt: registeredIdx >= 0 ? toIsoDate(cols[registeredIdx]) : null,
      prelimVotes: [],
      semiVotes: [],
      finalScores: [],
    };

    // Prelim per-judge votes
    for (let j = 0; j < prelimJudgeCount; j++) {
      const cell = (cols[prelimStart + j] ?? '').trim().toUpperCase();
      if (cell === 'O') c.prelimVotes.push({ judgeNo: j + 1, vote: 'O' });
      else if (cell === 'X') c.prelimVotes.push({ judgeNo: j + 1, vote: 'X' });
      // empty / READY → not recorded yet
    }
    // Semi per-judge votes
    for (let j = 0; j < semiJudgeCount; j++) {
      const cell = (cols[semiStart + j] ?? '').trim().toUpperCase();
      if (cell === 'O') c.semiVotes.push({ judgeNo: j + 1, vote: 'O' });
      else if (cell === 'X') c.semiVotes.push({ judgeNo: j + 1, vote: 'X' });
    }
    // Final per-judge scores
    for (let j = 0; j < finalJudgeCount; j++) {
      const base = finalGroupStart + j * 3;
      const b = parseScore(cols[base]);
      const cc = parseScore(cols[base + 1]);
      const m = parseScore(cols[base + 2]);
      if (b != null && cc != null && m != null) {
        c.finalScores.push({ judgeNo: j + 1, basics: b, connection: cc, musicality: m });
      }
    }
    contestants.push(c);
  }
  return contestants;
}

function pickPhoto(...candidates) {
  for (const raw of candidates) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    if (v.toUpperCase() === '#REF!' || v.startsWith('#')) continue;
    if (!/^https?:\/\//i.test(v)) continue;
    return v; // store raw URL — UI normalizes to lh3
  }
  return null;
}

function toIsoDate(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const m = v.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function parseScore(raw) {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.round(n);
  if (clamped < 1 || clamped > 10) return null;
  return clamped;
}

// ---------- DB writer ----------
async function importCompetition(client, idx) {
  console.log(`\n── importing ${idx.id} (${idx.name}) ──`);
  if (!idx.masterFileId) { console.log('  skip: no master file ID'); return; }

  // 1. Read sheet tabs
  const [eventCsv, judgesCsv, partsCsv] = await Promise.all([
    fetchTab(idx.masterFileId, '1.대회정보'),
    fetchTab(idx.masterFileId, '2.심사위원'),
    fetchTab(idx.masterFileId, '3.참가자'),
  ]);
  const ev = parseEvent(eventCsv);
  const judges = parseJudges(judgesCsv);
  const contestants = parseParticipants(partsCsv);
  console.log(`  parsed: ${judges.length} judges, ${contestants.length} contestants`);

  // 2. Upsert competition row
  await client.query(`
    insert into competitions (
      id, name, subtitle, event_date, event_date_text, venue, venue_address,
      organizer, host, sponsor, genres, divisions, age_groups,
      capacity_note, fee_note, prize_note, format_note,
      contact_name, contact_phone, contact_email, homepage, notice,
      prelim_pass_cap, semi_pass_cap, template_no
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
    )
    on conflict (id) do update set
      name = excluded.name, subtitle = excluded.subtitle,
      event_date = excluded.event_date, event_date_text = excluded.event_date_text,
      venue = excluded.venue, venue_address = excluded.venue_address,
      organizer = excluded.organizer, host = excluded.host, sponsor = excluded.sponsor,
      genres = excluded.genres, divisions = excluded.divisions, age_groups = excluded.age_groups,
      capacity_note = excluded.capacity_note, fee_note = excluded.fee_note,
      prize_note = excluded.prize_note, format_note = excluded.format_note,
      contact_name = excluded.contact_name, contact_phone = excluded.contact_phone,
      contact_email = excluded.contact_email, homepage = excluded.homepage, notice = excluded.notice,
      prelim_pass_cap = excluded.prelim_pass_cap, semi_pass_cap = excluded.semi_pass_cap,
      template_no = excluded.template_no
  `, [
    idx.id, ev.name ?? idx.name, ev.subtitle, ev.eventDate, ev.eventDateText,
    ev.venue, ev.venueAddress, ev.organizer ?? idx.organizer, ev.host, ev.sponsor,
    ev.genres, ev.divisions, ev.ageGroups,
    ev.capacityNote, ev.feeNote, ev.prizeNote, ev.formatNote,
    ev.contactName ?? idx.contactName, ev.contactPhone ?? idx.contactPhone,
    ev.contactEmail ?? idx.contactEmail, ev.homepage, ev.notice,
    ev.prelimPassCap, ev.semiPassCap, ev.templateNo,
  ]);

  // 3. round_states
  for (const r of ['prelim', 'semi', 'final']) {
    await client.query(`
      insert into round_states (competition_id, round, status)
      values ($1, $2::round_kind, $3::round_status)
      on conflict (competition_id, round) do update set status = excluded.status
    `, [idx.id, r, ev.roundStates[r]]);
  }

  // 4. judges
  // Upsert by (competition_id, display_no); track id mapping for vote/score inserts.
  const judgeIdByNo = new Map();
  for (const j of judges) {
    const r = await client.query(`
      insert into judges (
        competition_id, display_no, name, stage_name, genre, affiliation, career,
        contact_phone, contact_email, memo,
        max_prelim_votes, max_semi_votes, vote_target
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vote_target)
      on conflict (competition_id, display_no) do update set
        name = excluded.name, stage_name = excluded.stage_name,
        genre = excluded.genre, affiliation = excluded.affiliation, career = excluded.career,
        contact_phone = excluded.contact_phone, contact_email = excluded.contact_email,
        memo = excluded.memo,
        max_prelim_votes = excluded.max_prelim_votes, max_semi_votes = excluded.max_semi_votes,
        vote_target = excluded.vote_target
      returning id
    `, [
      idx.id, j.displayNo, j.name, j.stageName, j.genre, j.affiliation, j.career,
      j.contactPhone, j.contactEmail, j.memo,
      j.maxPrelimVotes, j.maxSemiVotes, j.voteTarget,
    ]);
    judgeIdByNo.set(j.displayNo, r.rows[0].id);
  }

  // 5. contestants (+ collect id mapping by number)
  const contestantIdByNumber = new Map();
  let voteCount = 0, scoreCount = 0;
  for (const c of contestants) {
    const r = await client.query(`
      insert into contestants (
        competition_id, number, team_or_name, representative, role, photo_url, memo,
        team_size, genre, division, age_group, birthdate,
        contact_phone, contact_email, nationality, instagram, registered_at
      ) values (
        $1,$2,$3,$4,$5::contestant_role,$6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17
      )
      on conflict (competition_id, number) do update set
        team_or_name = excluded.team_or_name,
        representative = excluded.representative,
        role = excluded.role,
        photo_url = excluded.photo_url,
        memo = excluded.memo,
        team_size = excluded.team_size,
        genre = excluded.genre,
        division = excluded.division,
        age_group = excluded.age_group,
        birthdate = excluded.birthdate,
        contact_phone = excluded.contact_phone,
        contact_email = excluded.contact_email,
        nationality = excluded.nationality,
        instagram = excluded.instagram,
        registered_at = excluded.registered_at
      returning id
    `, [
      idx.id, c.number, c.teamOrName, c.representative, c.role, c.photoUrl, c.memo,
      c.teamSize, c.genre, c.division, c.ageGroup, c.birthdate,
      c.contactPhone, c.contactEmail, c.nationality, c.instagram, c.registeredAt,
    ]);
    const cid = r.rows[0].id;
    contestantIdByNumber.set(c.number, cid);

    // 6. round_votes (prelim + semi)
    for (const v of c.prelimVotes) {
      const jid = judgeIdByNo.get(v.judgeNo);
      if (!jid) continue;
      await client.query(`
        insert into round_votes (competition_id, round, judge_id, contestant_id, vote)
        values ($1, 'prelim'::round_kind, $2, $3, $4::vote_value)
        on conflict (competition_id, round, judge_id, contestant_id)
        do update set vote = excluded.vote
      `, [idx.id, jid, cid, v.vote]);
      voteCount++;
    }
    for (const v of c.semiVotes) {
      const jid = judgeIdByNo.get(v.judgeNo);
      if (!jid) continue;
      await client.query(`
        insert into round_votes (competition_id, round, judge_id, contestant_id, vote)
        values ($1, 'semi'::round_kind, $2, $3, $4::vote_value)
        on conflict (competition_id, round, judge_id, contestant_id)
        do update set vote = excluded.vote
      `, [idx.id, jid, cid, v.vote]);
      voteCount++;
    }
    // 7. final_scores
    for (const s of c.finalScores) {
      const jid = judgeIdByNo.get(s.judgeNo);
      if (!jid) continue;
      await client.query(`
        insert into final_scores (competition_id, judge_id, contestant_id, basics, connection, musicality)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (competition_id, judge_id, contestant_id)
        do update set basics = excluded.basics, connection = excluded.connection, musicality = excluded.musicality
      `, [idx.id, jid, cid, s.basics, s.connection, s.musicality]);
      scoreCount++;
    }
  }
  console.log(`  wrote: judges=${judges.length} contestants=${contestants.length} votes=${voteCount} scores=${scoreCount}`);
}

// ---------- main ----------
const wipe = process.argv.includes('--wipe');
const onlyId = process.argv.find((a) => !a.startsWith('--') && /^\d{6}-\d{4}$/.test(a));

console.log('[importer] fetching 대회목록시트 ...');
const idxCsv = await fetchIndexCsv();
let competitions = parseCompetitions(idxCsv);
if (onlyId) competitions = competitions.filter((c) => c.id === onlyId);
if (!competitions.length) { console.error('No competitions found'); process.exit(1); }
console.log(`[importer] ${competitions.length} competition(s) to import:`, competitions.map((c) => c.id).join(', '));

const client = new Client({
  host: process.env.SUPABASE_DB_POOLER_HOST,
  port: 5432,
  user: `postgres.${REF}`,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  if (wipe) {
    console.log('[importer] WIPING all data (cascade) ...');
    await client.query('truncate competitions cascade');
  }
  for (const c of competitions) {
    try { await importCompetition(client, c); }
    catch (err) { console.error(`  ❌ ${c.id} failed:`, err.message); }
  }
  // Summary
  const { rows } = await client.query(`
    select
      (select count(*) from competitions) as competitions,
      (select count(*) from judges) as judges,
      (select count(*) from contestants) as contestants,
      (select count(*) from round_votes where round = 'prelim') as prelim_votes,
      (select count(*) from round_votes where round = 'semi') as semi_votes,
      (select count(*) from final_scores) as final_scores
  `);
  console.log('\n=== final counts ===');
  console.table(rows);
} finally {
  await client.end();
}
