/**
 * 바깥 API가 실패한 이유를 한 줄로 옮긴다.
 *
 * 예전엔 상태 코드만 넘겨서 `{"error":"upstream","status":400}` 만 보였고,
 * 그게 인증 문제인지 모델 이름 문제인지 알 수 없었다 — 2026-09-15 에 그걸로 한 번 헤맸다.
 * 앱은 이 필드를 읽지 않는다(실패면 목으로 떨어질 뿐이다). 운영자가 보라고 남긴다.
 *
 * 토큰으로 막힌 엔드포인트라 노출 범위가 좁고, 그래도 길이는 자른다 —
 * 바깥 서비스가 무엇을 담아 보낼지 우리가 정하지 않는다.
 */
export async function upstreamDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: { message?: string } | string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message;
    return typeof msg === 'string' ? msg.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
