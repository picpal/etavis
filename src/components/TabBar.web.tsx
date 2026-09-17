/**
 * 웹 데모에는 탭바를 안 단다.
 *
 * 데모 범위는 핵심 한 줄기(A1→A2→A3→A5→A6)다. 탭바를 남기면 진행중·주변·기록으로
 * 갈 수 있는데(TabBar.tsx:80 이 실제로 이동한다) 그 화면들은 데모 범위 밖이다.
 * 눌렀더니 미완성 화면이 나오면 나머지 화면도 못 믿게 된다.
 *
 * 부르는 쪽 9곳(HomeScreen·PlanScreen·OptionsScreen·TimelineScreen …)은 손대지 않는다.
 */
export function TabBar() {
  return null;
}
