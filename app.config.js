/**
 * app.json을 그대로 쓰되 API 키만 .env에서 주입한다.
 *
 * 키를 app.json에 두면 레포에 그대로 올라간다. .env는 gitignore 대상이라
 * 저장소에는 빈 값만 남는다. (다만 키는 여전히 앱 번들에 인라인되므로
 * 앱에서 추출은 가능하다 — 실서비스로 가면 프록시 서버를 두는 게 맞다.)
 */
const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    kakaoRestKey: process.env.KAKAO_REST_KEY ?? '',
    googlePlacesKey: process.env.GOOGLE_PLACES_KEY ?? '',
    // Workers 프록시. 비어 있으면 앱은 라우팅을 목 공급자로 돌린다
    serverUrl: process.env.SERVER_URL ?? '',
    appToken: process.env.APP_TOKEN ?? '',
  },
});
