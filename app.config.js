/**
 * app.json을 그대로 쓰되 서버 주소·앱 토큰만 .env에서 주입한다.
 *
 * **공급자 API 키는 여기로 주입하지 않는다.** extra에 넣은 값은 앱 번들에
 * 그대로 인라인되고, 웹 데모의 번들은 공개다 — 카카오(KAKAO_REST_KEY)도
 * 구글(GOOGLE_PLACES_KEY)도 그래서 주입 경로 자체를 없앴다. 공급자 키는
 * Workers 시크릿에만 두고, 앱은 /places·/route 프록시를 지난다.
 * (serverUrl·appToken은 번들에 실린다. appToken은 공급자 키가 아니라
 * 워커 앞단의 호출 게이트이고, 상한은 server/src/guard.ts가 건다.)
 */
const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    // Workers 프록시. 비어 있으면 앱은 라우팅을 목 공급자로 돌린다
    serverUrl: process.env.SERVER_URL ?? '',
    appToken: process.env.APP_TOKEN ?? '',
  },
});
