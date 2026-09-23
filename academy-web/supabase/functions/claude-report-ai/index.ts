// Supabase Edge Function: claude-report-ai
//
// "학원시험 AI분석" 탭의 학생별 보고서(스트림릿 claude_report.py의
// generate_parent_report_html)에 쓰이는 Claude 호출 3종을 서버 쪽에서만
// 실행하기 위한 함수. 프롬프트/모델/토큰 수는 claude_report.py와 동일하게 맞춤.
//
//   action = "teacher_comment"  → generate_teacher_comment_draft()  (선생님이 전하는 말 초안)
//   action = "wrong_comments"   → generate_wrong_question_comments() (오답 문항별 AI 한줄평)
//   action = "cluster_methods"  → _cluster_question_methods_with_ai() (단원 1개짜리 시험의 풀이유형 묶기)
//
// 배포 방법(Supabase 대시보드):
//   Edge Functions → 새 함수 만들기 → 이름 "claude-report-ai" → 이 파일 내용 붙여넣고 Deploy
//   → Project Settings → Edge Functions → Secrets 에
//     ANTHROPIC_API_KEY = (스트림릿 .env에 있는 값과 동일) 추가

// @ts-nocheck — Deno 런타임 전역은 브라우저용 tsconfig에 타입이 없음. 실행은 Supabase Deno 서버.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL = 'claude-sonnet-4-6';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function callClaude(apiKey: string, prompt: string, maxTokens: number): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Claude 호출 실패 (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('Claude 응답에 내용이 없습니다.');
  return text;
}

function stripJsonFence(raw: string): string {
  return raw.replace(/```json|```/g, '').trim();
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

function teacherCommentPrompt(p: {
  studentName: string;
  score: number;
  classAvg: number | null;
  rank: number | null;
  totalStudents: number | null;
  wrongNumbers: number[];
  totalQuestions: number;
  historyScores: number[];
  testName: string;
}): string {
  const wrongCount = p.wrongNumbers.length;
  const correctCount = p.totalQuestions - wrongCount;
  let trend = '';
  if (p.historyScores.length >= 2) {
    const diff = p.historyScores[p.historyScores.length - 1] - p.historyScores[p.historyScores.length - 2];
    if (diff > 0) trend = `지난 시험 대비 ${fmt1(diff)}점 향상`;
    else if (diff < 0) trend = `지난 시험 대비 ${fmt1(Math.abs(diff))}점 하락`;
    else trend = '지난 시험과 동일한 점수';
  }
  const rankStr = p.rank && p.totalStudents ? `${p.rank}/${p.totalStudents}` : '집계 중';
  const avgStr = p.classAvg != null ? `${fmt1(p.classAvg)}점` : '집계 중';
  const wrongStr = p.wrongNumbers.length > 0 ? `[${p.wrongNumbers.join(', ')}]` : '없음';

  return (
    `수학학원 선생님이 학부모님께 보내는 코멘트를 작성해줘.\n\n` +
    `학생명: ${p.studentName}\n` +
    `시험명: ${p.testName}\n` +
    `이번 점수: ${fmt1(p.score)}점 (${p.totalQuestions}문항 중 ${correctCount}개 정답)\n` +
    `오답 문항: ${wrongStr}\n` +
    `반 평균: ${avgStr}\n` +
    `반 석차: ${rankStr}\n` +
    `점수 추이: ${trend || '첫 시험'}\n\n` +
    `조건:\n` +
    `- 학부모님께 드리는 말투로 (존댓말)\n` +
    `- 3~4문장으로 간결하게\n` +
    `- 칭찬 + 구체적 피드백 + 응원 순서로\n` +
    `- 너무 형식적이지 않게, 진심이 느껴지게\n` +
    `- 학생 이름 꼭 포함\n` +
    `- 학생을 높이는 표현('~해 드릴게요', '~드리겠습니다', '~짚어드릴 예정입니다' 등)은 ` +
    `쓰지 마세요. 존댓말(높임)은 이 글을 읽는 학부모님께만 적용하고, ` +
    `학생의 행동·앞으로 할 일을 서술할 때는 '~해 줄게요', '~짚어줄 예정입니다', ` +
    `'~봐줄게요'처럼 평서형으로 쓰세요.\n` +
    `- 코멘트 텍스트만 출력 (다른 설명 없이)\n`
  );
}

function wrongCommentsPrompt(
  studentName: string,
  details: { number: number; topic?: string; method?: string; difficulty?: string }[],
): string {
  const itemsText = details
    .map(
      (d) =>
        `- ${d.number}번: 단원=${d.topic || '미분류'}, ` +
        `풀이유형=${d.method || '미분류'}, ` +
        `난이도=${d.difficulty || ''}`,
    )
    .join('\n');
  return (
    `수학 학원 선생님으로서, ${studentName} 학생의 오답 문항에 대해 ` +
    `학부모님이 읽을 문항별 한줄 피드백을 작성해줘.\n\n` +
    `오답 문항 목록:\n${itemsText}\n\n` +
    `조건:\n` +
    `- 각 문항마다 1~2문장으로 간결하게\n` +
    `- 어떤 개념이 부족한지 + 어떻게 보완하면 좋은지 포함\n` +
    `- 학부모가 이해할 수 있는 쉬운 표현 사용\n` +
    `- 학생을 높이는 표현('~해 드릴게요', '~드리겠습니다' 등)은 쓰지 마세요. ` +
    `존댓말(높임)은 이 글을 읽는 학부모님께만 적용하고, 학생에 대한 서술은 ` +
    `'~해 줄게요', '~보완하면 좋습니다'처럼 평서형으로 쓰세요.\n` +
    `- 아래 JSON 형식으로만 출력 (다른 설명 없이):\n` +
    `{"comments": [{"number": 3, "comment": "한줄평 내용"}, ...]}`
  );
}

function clusterPrompt(methods: string[]): string {
  const methodsText = methods.map((m) => `- ${m}`).join('\n');
  return (
    "다음은 한 수학 시험(같은 단원)의 문항들에 AI가 붙인 '세부 풀이유형' " +
    `이름 목록이야 (총 ${methods.length}개, 문항마다 제각각 구체적으로 붙어서 ` +
    '그대로는 통계로 묶이지 않아).\n\n' +
    `${methodsText}\n\n` +
    "이 이름들을 의미상 비슷한 것끼리 묶어서, 4~6개 정도의 더 큰 '유형'으로 " +
    '분류해줘. 조건:\n' +
    '- 각 유형 이름은 학부모가 봐도 이해할 수 있게 8자 내외로 짧고 명확하게\n' +
    '- 목록에 있는 모든 항목이 정확히 하나의 유형에 속해야 함(빠짐 없이)\n' +
    '- 유형 개수는 2개 이상, 목록 개수보다는 적어야 함(안 그러면 묶는 의미가 없음)\n' +
    '- 아래 JSON 형식으로만 출력 (다른 설명 없이):\n' +
    '{"mapping": [{"original": "원래 이름", "type": "묶인 유형 이름"}, ...]}'
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. Supabase 대시보드 Secrets를 확인해 주세요.' }, 500);
    }

    const body = await req.json();
    const action = body?.action;

    if (action === 'teacher_comment') {
      const comment = await callClaude(apiKey, teacherCommentPrompt(body), 500);
      return json({ comment });
    }

    if (action === 'wrong_comments') {
      const details = Array.isArray(body.wrongDetails) ? body.wrongDetails : [];
      if (details.length === 0) return json({ comments: [] });
      const raw = await callClaude(apiKey, wrongCommentsPrompt(String(body.studentName || ''), details), 1000);
      const parsed = JSON.parse(stripJsonFence(raw));
      const comments = (parsed?.comments ?? []).map((c: { number: unknown; comment: unknown }) => ({
        number: Number(c.number),
        comment: String(c.comment),
      }));
      return json({ comments });
    }

    if (action === 'cluster_methods') {
      const methods: string[] = Array.isArray(body.methods) ? body.methods.map(String) : [];
      if (methods.length < 2) return json({ mapping: null });
      const raw = await callClaude(apiKey, clusterPrompt(methods), 2000);
      const parsed = JSON.parse(stripJsonFence(raw));
      const mapping: Record<string, string> = {};
      for (const item of parsed?.mapping ?? []) {
        mapping[String(item.original)] = String(item.type);
      }
      const covers = methods.every((m) => m in mapping);
      const nTypes = new Set(Object.values(mapping)).size;
      if (!covers || !(nTypes > 1 && nTypes < methods.length)) return json({ mapping: null });
      return json({ mapping });
    }

    return json({ error: `알 수 없는 action: ${String(action)}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
