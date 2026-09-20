/**
 * 시간당 지표를 Slack 메시지로 만든다. 순수 함수 — 전송은 index.ts 가 한다.
 *
 * **Slack 은 마크다운이 아니다.** 굵게는 별 하나(`*굵게*`), `#` 제목과 표는 없고,
 * 링크는 `<url|글자>` 다. 마크다운으로 쓰면 별 두 개와 `#` 가 글자 그대로 보인다.
 * 숫자는 문단에 늘어놓는 것보다 `fields` 로 나눠야 폰에서도 한눈에 들어온다.
 */
import type { Stats } from './aggregate';

export type ReportInput = {
  stats: Stats;
  /** 직전 시간의 방문자 수. 비교 대상이 없으면 null — 증감을 지어내지 않는다 */
  prevVisitors: number | null;
  /** 'MM-DD HH:mm~HH:mm' (KST) */
  windowLabel: string;
  demoUrl: string;
  /** 집계 조회 자체가 실패했다. 0 과 구별해서 말해야 한다 */
  failed?: boolean;
};

function delta(now: number, prev: number | null): string {
  if (prev === null) return '';
  const d = now - prev;
  if (d === 0) return ' (직전과 같음)';
  return ` (직전 ${d > 0 ? '+' : ''}${d})`;
}

export function buildReport(input: ReportInput): { blocks: unknown[] } {
  const { stats: s, windowLabel, demoUrl } = input;

  // 조회가 깨진 것을 "방문 없음"으로 보고하면, 토큰이 만료돼 아무것도 못 읽는 상태가
  // 조용한 새벽과 똑같이 보인다 — 며칠을 모르고 지나간다
  if (input.failed) {
    return {
      blocks: [
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `:warning: *Etavia 데모* ${windowLabel} · 집계 조회 실패 (숫자를 못 읽었습니다)` },
          ],
        },
      ],
    };
  }

  // 조용한 시간엔 카드를 통째로 보내지 않는다. 밤새 같은 카드가 쌓이면 아무도 안 본다 —
  // 그래도 한 줄은 보낸다. 안 보내면 cron 이 죽은 건지 사람이 없는 건지 구분이 안 된다.
  if (s.visitors === 0) {
    return {
      blocks: [
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `:zzz: *Etavia 데모* ${windowLabel} · 방문 없음` }],
        },
      ],
    };
  }

  const rate = Math.round((s.askers / s.visitors) * 100);

  return {
    blocks: [
      // header 는 plain_text 만 받는다. mrkdwn 을 넣으면 Slack 이 블록을 거부한다
      { type: 'header', text: { type: 'plain_text', text: '📊 Etavia 데모 리포트', emoji: true } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `${windowLabel} (KST)` }] },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*방문*\n${s.visitors}명${delta(s.visitors, input.prevVisitors)}` },
          { type: 'mrkdwn', text: `*질문*\n${s.asks}회` },
          { type: 'mrkdwn', text: `*계획 확정*\n${s.plans}건` },
          { type: 'mrkdwn', text: `*질문한 사람*\n${s.askers}명 / ${s.visitors}명 (${rate}%)` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              s.askers > 0
                ? `1인당 평균 ${s.avgAsks}회 · 최다 ${s.maxAsks}회  ·  <${demoUrl}|데모 열기>`
                : `아직 질문한 사람은 없어요  ·  <${demoUrl}|데모 열기>`,
          },
        ],
      },
    ],
  };
}
