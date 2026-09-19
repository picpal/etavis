/**
 * KV 쓰기를 한 곳으로 모은다.
 *
 * 왜 만드나: 2026-09-19 프로덕션에서 `/places` 한 건이 503 으로 죽었고 남은 로그는
 * `[fetch] unhandled` + `KV PUT failed: 429 Too Many Requests` 두 줄뿐이었다.
 * 서버에는 `kv.put` 이 8곳 있는데 **어느 것이 터졌는지 알 길이 없다** —
 * `index.ts` 의 포괄 catch 가 모든 예외를 같은 503 으로 뭉갠다.
 * 고칠 자리를 정하려면 그것부터 알아야 한다.
 *
 * **키는 로그에 남기지 않는다.** 분당 카운터 키에 사용자 IP 가 들어 있다
 * (`rlip:<path>:<ip>:<minute>`). 대신 호출부가 넘기는 `site` 문자열이 어느 쓰기인지
 * 전부 말해 준다 — 그 값은 코드가 정하는 리터럴이라 사용자 데이터가 섞이지 않는다.
 */
export type KvPutMode =
  /** 실패를 삼킨다. 캐시 쓰기 전용 — 캐시는 최적화라 놓쳐도 다음 요청이 채운다 */
  | 'best-effort'
  /** 실패를 다시 던진다. 실패가 뜻을 갖는 자리(상한 카운터·예산 예약) */
  | 'required';

type Puttable = { put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> };

/**
 * @returns 썼으면 `true`, best-effort 로 삼켰으면 `false`.
 *          호출부가 "못 썼다"를 알아야 할 때(예: 예산 예약 실패) 쓰라고 돌려준다.
 */
export async function kvPut(
  kv: Puttable,
  site: string,
  key: string,
  value: string,
  opts: { expirationTtl?: number },
  mode: KvPutMode,
): Promise<boolean> {
  try {
    await kv.put(key, value, opts);
    return true;
  } catch (err) {
    /* 한 줄로 찍는다 — `wrangler tail --format json` 이 같은 이벤트에 요청 URL 과
       cf-ray 를 이미 붙여 주므로 여기서 요청을 다시 식별할 필요가 없다 */
    console.error(`[kv.put failed] site=${site} mode=${mode} err=${String(err)}`);
    if (mode === 'required') throw err;
    return false;
  }
}
