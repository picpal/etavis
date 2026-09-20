/** A5 — 추천. 답(제시간 도착 여부)이 맨 위, 3안은 그 아래. "최적"이 아니라 "검증한 안 중 최선" */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { color, type } from '../theme/tokens';
import { usePlan, toHHMM } from '../state/plan';
import { nowMin } from '../lib/clock';
import { usePlanFlow } from '../state/planFlowProvider';
import { usePlanRequest } from '../state/usePlanRequest';
import { effectiveVisits, josa, slotCandidates, toLegacyPlan } from '../state/planFlowBridge';
import { haptic, PrimaryButton, SegmentControl } from '../components/common';
import { NavHeader } from '../components/NavHeader';
import { TabBar } from '../components/TabBar';
import { CandidateSheet } from '../sheets/CandidateSheet';
import { StopList } from '../components/StopList';
import { signedMin, timingCopy } from '../lib/timingCopy';
import { recommendTabState } from '../lib/routePlan/recommendTab';
import { makeReasonClient } from '../lib/reasonClient';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Options'>;

const hhmm = (min: number) => toHHMM(Math.round(min)).padStart(5, '0');

/**
 * 출발→도착 타임바. 직행이면 어디까지, 들르면 얼마나 더, 마감은 어디쯤인지를 한 줄로 보인다.
 * 숫자 세 개(직행·경유·마감)를 문장으로 읽게 하지 않으려고.
 */
function EtaBar({ departMin, directMin, totalMin, arriveByMin, estimated, showVerdict }: {
  departMin: number; directMin: number; totalMin: number; arriveByMin: number | null; estimated: boolean;
  /** 추정치 위에서는 초과를 판정하지 않는다 — timingCopy.showVerdict */
  showVerdict: boolean;
}) {
  const deadline = arriveByMin == null ? null : arriveByMin - departMin;
  // 막대 끝이 곧 도착(또는 더 늦은 마감). 여백을 두면 도착점이 어디인지 흐려진다
  const span = Math.max(totalMin, deadline ?? 0, 1);
  const pct = (m: number) => `${Math.max(0, Math.min(100, (m / span) * 100))}%` as const;
  const late = showVerdict && deadline != null && totalMin > deadline;
  const pre = estimated ? '약 ' : '';
  const dp = deadline == null ? 0 : (deadline / span) * 100;
  const deadlineAtEdge = dp < 22 || dp > 78;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 22, justifyContent: 'center' }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: color.track, overflow: 'hidden' }}>
          {/* 들르기 포함 전체. 늦으면 마감을 넘긴 구간만 파스텔 레드 — 어디서부터 늦는지 보이게 */}
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(totalMin), backgroundColor: color.primary, borderRadius: 4 }} />
          {late && (
            <View style={{ position: 'absolute', left: pct(Math.max(0, deadline!)), top: 0, bottom: 0, width: pct(totalMin - Math.max(0, deadline!)), backgroundColor: color.lateSoft, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
          )}
          {/* 직행만큼은 옅게 — 그 위로 튀어나온 부분이 '들러서 더 걸리는' 시간 */}
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(directMin), backgroundColor: color.stroke, borderRadius: 4 }} />
        </View>
        {deadline != null && (
          <View style={{ position: 'absolute', left: pct(deadline), top: 0, bottom: 0, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: late ? color.late : color.green }} />
        )}
      </View>
      <View style={{ height: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[type.micro, { color: color.muted }]}>{hhmm(departMin)} 출발</Text>
          <Text style={[type.micro, { color: color.muted }]}>{pre}{hhmm(departMin + totalMin)} 도착</Text>
        </View>
        {/* 마감 라벨은 눈금 바로 아래. 가장자리에 붙어 출발·도착 라벨과 겹칠 때는 아래 범례 줄로 내린다 */}
        {deadline != null && !deadlineAtEdge && (
          <View style={{ position: 'absolute', top: 0, left: pct(deadline), width: 120, marginLeft: -60, alignItems: 'center' }}>
            <Text style={[type.micro, { color: late ? color.late : color.green, backgroundColor: color.bg, paddingHorizontal: 4 }]}>마감 {hhmm(arriveByMin!)}</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.stroke }} />
          <Text style={[type.micro, { color: color.muted }]}>직행 {Math.round(directMin)}분</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.primary }} />
          {/* 부호를 '+'로 박아 두면 음수일 때 '+-5분'이 된다 — 추정 구간이 섞이면 들르기가 음수로 나올 수 있다(2026-09-20 기기) */}
          <Text style={[type.micro, { color: color.muted }]}>들르기 {signedMin(totalMin - directMin)}</Text>
        </View>
        {late && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.lateSoft }} />
            <Text style={[type.micro, { color: color.muted }]}>초과 {Math.round(totalMin - Math.max(0, deadline!))}분</Text>
          </View>
        )}
        {deadline != null && deadlineAtEdge && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 2, height: 10, borderRadius: 1, backgroundColor: late ? color.late : color.green }} />
            <Text style={[type.micro, { color: late ? color.late : color.green }]}>마감 {hhmm(arriveByMin!)}{deadline <= 0 ? ' 지남' : ''}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function OptionsScreen({ navigation }: Props) {
  const flow = usePlanFlow();
  const request = usePlanRequest();
  /* `state` 는 아래에서 flow 의 것을 쓰므로 이름을 갈라 둔다 — 여기서 필요한 건
     사용자가 실제로 한 말(`chat`)이고, 그건 계획 요청(`PlanRequest`)에는 없다 */
  const { applyLive, removeChip, state: planState } = usePlan();
  const { state } = flow;
  const result = state.result;
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  /* 뺄 예정인 경유지. 여기 담아만 두고 계획은 '다시 계산'을 누를 때 한 번에 고친다.
     예전에는 한 곳 뺄 때마다 removeChip → flow.reset → Calculating 이라, 검색부터
     전부 다시 돌았다(외부 호출 약 30회). 세 곳을 하나씩 빼면 90회였고, 회랑이
     매번 바뀌어 남아 있던 후보까지 다른 가게로 갈렸다.
     칩을 실제로 건드리지 않으므로 되돌리기도 공짜다 — 목록에서 빼기만 취소하면 된다 */
  const [pendingRemove, setPendingRemove] = useState<string[]>([]);

  const current = useMemo(
    () => (result ? effectiveVisits(result, state.slots, state.selectedOptionIdx, state.overrides) : null),
    [result, state.slots, state.selectedOptionIdx, state.overrides],
  );

  const pickIdx = current ? current.visits.findIndex(v => v.slotId === pickSlot) : -1;
  const pickVisit = current && pickIdx >= 0 ? current.visits[pickIdx] : null;
  // 지금 고른 안 기준으로 낸다 — result.alternatives는 1안 기준이라 2·3안에서 중복·누락이 생긴다.
  // 매 렌더 새 배열을 만들지 않는다 — CandidateSheet 안의 sorted useMemo가 실제로 캐시되게
  const sheetCands = useMemo(
    () => (result && current && pickIdx >= 0 ? slotCandidates(result, state.slots, current.visits, pickIdx, current.timing) : []),
    [result, current, pickIdx, state.slots],
  );

  /** 짐을 덜 드는 안의 옵션 인덱스. 계획이 없거나 짐을 재지 않았으면 null */
  const comfortIdx = result?.comfortIdx ?? null;
  /* 탭이 가리킬 안과 켜진 자리. 판단은 `recommendTab.ts` 한 곳이 한다 */
  const tab = recommendTabState(comfortIdx, state.selectedOptionIdx);
  /* 두 기준이 각각 몇 시 도착인지. 탭 라벨에 박아 두려는 값이다 — 번갈아 눌러
     기억으로 비교하게 두면, 도착 시각이 화면 위쪽에 있어 스크롤이 내려간 순간
     비교가 끊긴다. 교체(overrides)까지 반영해야 화면의 다른 숫자와 어긋나지 않는다 */
  const tabTiming = useMemo(() => {
    if (!result) return null;
    const pick = (idx: number) => effectiveVisits(result, state.slots, idx, state.overrides).timing;
    const comfort = pick(tab.target);
    return { comfort, fast: tab.target === 0 ? comfort : pick(0) };
  }, [result, state.slots, state.overrides, tab.target]);
  /* 두 기준이 같은 안을 가리킬 때(`sameAsFast`) 켜진 자리를 화면이 직접 든다.
     그때는 어느 쪽을 눌러도 고를 안이 0 하나뿐이라 `selectedOptionIdx` 가 안 움직이고,
     그 값으로 켜진 자리를 정하면 썸이 손가락을 안 따라온다 — 눌러도 아무 일도 없는
     버튼은 앱이 멈춘 것처럼 보인다. 고르는 안은 그대로 두고 '어디를 눌렀나'만 기억한다 */
  const [sameSeg, setSameSeg] = useState<0 | 1>(0);
  /* 아래 얼리 리턴(`if (!result || ...)`)보다 위에 둔다 — 그 리턴은 조건부라
     result 가 있다가 없어지는 렌더가 있을 수 있는데(`recalculate` 가 flow.reset 뒤
     아직 이 화면에 머무는 순간), 훅은 매 렌더 같은 순서로 불려야 한다(Rules of
     Hooks). "값이 없으면 아무 것도 안 한다"는 일은 얼리 리턴 대신 이제 effect
     안의 `!result` 가드가 맡는다 */
  /* 서버가 준 설명 한 줄. 없으면 고정 문구로 떨어진다 — 설명은 장식이다 */
  const [whyLine, setWhyLine] = useState<string | null>(null);
  /* 계획당 한 번만 부른다(`server/src/guard.ts:80` 도 같은 상한을 건다).
     추천안이 최단안과 같으면 보낼 두 번째 안이 없어 아예 부르지 않는다 */
  const askedRef = useRef(false);
  useEffect(() => {
    if (tab.sameAsFast || askedRef.current || !result || !state.request) return;
    const req = state.request;
    const comfort = result.options[tab.target];
    const fast = result.options[0];
    if (!comfort || !fast) return;
    askedRef.current = true;
    const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; appToken?: string };
    const baseUrl = extra.serverUrl?.trim();
    const appToken = extra.appToken?.trim();
    if (!baseUrl || !appToken) return;
    const client = makeReasonClient({ baseUrl, appToken, deviceId: Constants.sessionId ?? 'unknown' });
    /* 화면을 나가도 요청은 날아가 있을 수 있다 — 응답이 늦게 와서 죽은 화면에
       setState 하지 않도록 막는다. reasonClient 는 타임아웃용 AbortController 를
       자체로 들고 있어 밖에서 취소 신호를 얹을 자리가 없다(그 API를 넓히는 건 이
       수정 범위 밖이다) — 그래서 더 가벼운 ignore 플래그로 막는다 */
    let ignore = false;
    void client({
      /* 서버 프롬프트가 하는 일은 "사용자 문장을 읽고, 거기 없는 사실은 지어내지
         않는다"이다. 빈 문자열을 보내면 읽을 문장이 없어 가게 이름만 보고 문장을
         지어낸다 — 금지하려던 바로 그 짓이다. 사용자가 한 말은 `PlanRequest` 가
         아니라 대화 스토어에 있다. 마지막 발화가 지금 화면을 만든 말이라 그걸 보낸다 */
      text: planState.chat[planState.chat.length - 1] ?? '',
      mode: req.mode,
      fast: { stops: fast.visits.map(v => v.candidate.name), totalMin: Math.round(result.rescore(fast.visits).totalMin) },
      comfort: { stops: comfort.visits.map(v => v.candidate.name), totalMin: Math.round(result.rescore(comfort.visits).totalMin) },
    }).then(why => { if (!ignore) setWhyLine(why); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sameAsFast, tab.target, result]);

  if (!result || !current || !state.request) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <NavHeader title="추천 경로" onBack={() => navigation.goBack()} />
        {/* 늘어나는 요소가 없으면 탭바가 글 바로 밑에 붙어 화면 한가운데 뜬다 — flex:1 로 아래로 민다 */}
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { color: color.muted, padding: 20 }]}>계산된 경로가 없어요. 계획 화면에서 다시 시작해 주세요.</Text>
        </View>
        <TabBar />
      </View>
    );
  }

  const req = state.request;
  const arriveMin = req.departAtMin + current.timing.totalMin;
  // 반올림 후에 늦음을 판정한다 — 그래야 "0분 늦어요"가 뜨지 않는다
  const slack = req.arriveByMin == null ? null : Math.round(req.arriveByMin - arriveMin);
  const late = slack != null && slack < 0;
  /* 출처는 결과가 안다. 서버 연결 여부만으로는 대중교통 추정치를 실측인 양 말하게 된다 */
  const copy = timingCopy(result.timingSource, req.mode, current.timing.estimated);
  const approx = copy.approx;
  const stale = request ? flow.isStale(request) : false;

  // 완화안도 마감을 못 지킬 수 있다 — 그때 "−3분 여유"라고 쓰면 안 된다
  /* 경유지 빼기 — 표시만 해 둔다. 늦을 때 '무엇을 빼야 맞추나'가 이 화면의 질문이라
     여러 곳을 재보게 되는데, 한 번 뺄 때마다 화면이 로딩으로 튀면 비교가 끊긴다 */
  const removeStop = (slotId: string) => {
    haptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPendingRemove(p => (p.includes(slotId) ? p : [...p, slotId]));
  };
  const undoRemove = (slotId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPendingRemove(p => p.filter(id => id !== slotId));
  };

  /* 조건이 달라진 상태. 여기서 미뤄 둔 빼기와, 이 화면 밖에서 바뀐 것(이동수단·마감·
     목적지 — isStale 이 본다)을 함께 센다. 사용자에게는 둘 다 '숫자가 옛것'이다 */
  const dirty = pendingRemove.length > 0 || stale;

  const recalculate = () => {
    haptic();
    for (const slotId of pendingRemove) removeChip(slotId);
    flow.reset();
    navigation.replace('Calculating');
  };

  const confirm = () => {
    /* 출발은 '지금'이다. 계산 시작 시각(req.departAtMin)을 그대로 쓰면 이 화면에서
       머문 만큼 타임라인이 과거 기준이 된다 — 3안을 비교하다 보면 몇 분은 쉽게 지난다.
       구간 소요시간은 차이값이라 시계만 옮기면 되고, 교통 상황까지 다시 보려면
       재계산이 필요하다(그건 isStale 배너가 맡는다). */
    applyLive(toLegacyPlan({ flow: state, departMin: nowMin() }));
    navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Today' }] });
  };

  /* 탭 한 칸에 박을 '이 기준을 고르면 몇 시 도착'. 판정(늦음)은 timingCopy 가 허락할
     때만 색으로 말한다 — 추정치 위에서 붉게 칠하면 없는 확신을 파는 것이다 */
  const segArrival = (t: { totalMin: number; estimated: boolean }) => {
    const at = req.departAtMin + t.totalMin;
    const c = timingCopy(result.timingSource, req.mode, t.estimated);
    const isLate = req.arriveByMin != null && Math.round(req.arriveByMin - at) < 0;
    return { text: `${c.approx}${hhmm(at)}`, tint: c.showVerdict && isLate ? color.late : null };
  };
  const segComfort = tabTiming ? segArrival(tabTiming.comfort) : null;
  const segFast = tabTiming ? segArrival(tabTiming.fast) : null;

  /* 기준 고르기 — **늘 보인다.** 가리킬 추천안이 따로 없을 때도 자리를 비우지 않는다:
     탭이 있다 없다 하면 사용자는 자기가 뭘 잘못 눌렀는지 의심한다. 자리는 경유지 목록
     바로 위다 — 이 탭이 실제로 바꾸는 건 아래 목록의 순서이고, 도착 시각은 그 결과다 */
  const criteria = (
    <View style={{ gap: 7, opacity: dirty ? 0.4 : 1 }}>
      <SegmentControl
        options={['추천 순서', '최단 시간']}
        subs={[segComfort?.text ?? null, segFast?.text ?? null]}
        subTints={[segComfort?.tint ?? null, segFast?.tint ?? null]}
        /* 기본 트랙(`color.bg`)은 화면 배경과 같은 색이다 — 카드 위에 놓을 때를 전제한
           값이라, 배경 위에 바로 두면 트랙이 사라지고 켜진 칸만 떠 있는 카드로 보인다 */
        track={color.track}
        value={tab.sameAsFast ? sameSeg : tab.value}
        onChange={i => {
          haptic();
          setSameSeg(i === 0 ? 0 : 1);
          flow.select(i === 0 ? tab.target : 0);
        }}
        fontSize={14}
        padV={10}
      />
      {/* 버튼만으로는 두 기준이 무슨 뜻인지 모른다. 높이를 미리 잡아 둔다 —
          설명이 나중에 와서 줄이 생기면 아래가 밀리고, 그게 곧 '말없이 바뀐다'다 */}
      <Text
        numberOfLines={1}
        style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, paddingHorizontal: 2 }}
      >
        {/* `가장 편해요` 라고 쓰던 자리다. 무엇과 견줘 '가장'인지 코드가 모른다 —
            `sameAsFast` 에는 짐을 아예 안 잰 경우(자동차는 늘 그렇다)가 섞여 있다.
            서버가 LLM 에게 금지한 말이기도 하다(`server/src/reason.ts` FORBIDDEN).
            그래서 등수 대신 사실만 말한다: 지금은 두 기준의 답이 같다 */}
        {tab.sameAsFast
          ? '두 기준이 지금은 같은 순서를 가리켜요'
          : tab.value === 0
            ? whyLine ?? '짐을 들고 이동하는 시간을 줄였어요'
            : '총 이동 시간이 가장 짧아요'}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader title="추천 경로" onBack={() => navigation.goBack()} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}>
        {/* 왜 아래 숫자가 흐린지 말해 준다. 누르는 자리는 아니다 —
            다시 계산은 하단 기본 버튼 하나로 모았다. 같은 동작이 두 군데 있으면
            어느 쪽이 '진짜'인지 사용자가 고민하게 된다 */}
        {dirty && (
          <View style={{ backgroundColor: color.amberBg, borderRadius: 14, padding: 14 }}>
            <Text style={[type.body, { color: color.amberDeep }]}>
              {pendingRemove.length > 0
                ? `경유지 ${pendingRemove.length}곳을 뺐어요 · 아래 '다시 계산'을 눌러야 시간이 바뀌어요`
                : "조건이 바뀌었어요 · 아래 '다시 계산'을 눌러주세요"}
            </Text>
          </View>
        )}

        {/* 1. 판정 — 답 먼저. 카드 없이 헤드라인 + 타임바: 직행·들르기·마감을 한 줄 그림으로.
            조건이 달라졌으면 흐리게 — 지우지는 않는다. 무엇과 견줘 뺐는지가 이 숫자라
            사라지면 비교 기준이 없어진다. 대신 현재값처럼 읽히지 않게 힘을 뺀다 */}
        <View style={{ gap: 10, paddingHorizontal: 2, paddingTop: 2, opacity: dirty ? 0.4 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            {/* 답은 항상 도착 시각. 마감이 있으면 옆에 '여유'/'늦어요' 한마디 — 늦으면 시각도 붉게.
                추정이면 판정을 내지 않는다 — 추정치 위의 "여유"는 거짓 정밀도다 */}
            <Text style={[type.displayXL, { color: late && copy.showVerdict ? color.late : color.ink }]}>{approx}{hhmm(arriveMin)} 도착</Text>
            {slack != null && copy.showVerdict && (
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 18, color: late ? color.late : color.green }}>
                {late ? `${-slack}분 늦어요` : `${slack}분 여유`}
              </Text>
            )}
          </View>
          {copy.banner && (
            <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 13, lineHeight: 18, color: color.amberDeep }}>{copy.banner}</Text>
          )}
          <EtaBar
            departMin={req.departAtMin}
            directMin={result.directMin}
            totalMin={current.timing.totalMin}
            arriveByMin={req.arriveByMin}
            estimated={approx !== ''}
            showVerdict={copy.showVerdict}
          />
        </View>

        {/* 못 찾아 빠진 슬롯 — 경유지 행에는 나오지 않으니 여기서 말해 준다 */}
        {state.slots
          .filter(s => result.slotStatus[s.id] === 'none')
          .map(s => (
            <Text key={s.id} style={[type.caption, { color: color.muted }]}>
              {s.query}{josa(s.query, '이/가') === '이' ? '은' : '는'} 경로 근처에서 못 찾아 뺐어요
            </Text>
          ))}

        {/* 검색이 죽어 아예 못 본 슬롯 — 위의 '못 찾아 뺐어요'와 반드시 다른 말을 쓴다.
            찾아봤는데 없는 것과 아예 못 본 것은 다른 사실이고, 섞으면 사용자에게
            없는 사실을 말하게 된다 */}
        {state.slots
          .filter(s => result.slotStatus[s.id] === 'unchecked')
          .map(s => (
            <Text key={`unchecked-${s.id}`} style={[type.caption, { color: color.muted }]}>
              {s.query}{josa(s.query, '이/가') === '이' ? '은' : '는'} 이번엔 확인하지 못했어요 · 다시 계산하면 다시 찾아볼게요
            </Text>
          ))}

        {/* near 로 좁혀 봤지만 그쪽에 한 곳도 없어 제약을 푼 슬롯 — 위치가 어긋난 걸 말해 준다.
            빠진 것도 아니고 요청대로도 아닌 중간 상태라, 말하지 않으면 사용자는 앱이 말을
            흘린 줄 안다 */}
        {state.slots
          .filter(s => s.nearRelaxed && result.slotStatus[s.id] !== 'none')
          .map(s => (
            <Text key={`near-${s.id}`} style={[type.caption, { color: color.muted }]}>
              {s.near === 'end' ? '목적지' : '출발지'} 쪽엔 {s.query}{josa(s.query, '이/가')} 없어서 경로 위 다른 곳으로 잡았어요
            </Text>
          ))}

        {/* 2. 경유지 — 이 화면의 본문. 빼기·교체 모두 여기서, 바뀌면 위 도착 시각이 다시 계산된다 */}
        <StopList
          result={result}
          visits={current.visits}
          arrivals={current.timing.arrivals}
          slots={state.slots}
          departAtMin={req.departAtMin}
          arriveByMin={req.arriveByMin}
          late={late && copy.showVerdict}
          approx={approx}
          onPick={slotId => { setPickSlot(slotId); }}
          onRemove={removeStop}
          pendingRemove={pendingRemove}
          onUndoRemove={undoRemove}
          headerAccessory={criteria}
        />
      </ScrollView>

      <View style={{ backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.hairline, paddingTop: 16, paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}>
        {/* 조건이 달라졌으면 '다시 계산', 계산이 끝난 뒤에야 '경로로 계속'.
            버튼 하나가 두 가지 일을 번갈아 맡는다 — 옛 숫자를 그대로 확정해 버리는
            길을 아예 없애려면 같은 자리에 있어야 한다 */}
        {dirty ? (
          <PrimaryButton label="다시 계산" chevron height={56} borderRadius={18} onPress={recalculate} />
        ) : (
          <PrimaryButton label={`${approx}${hhmm(arriveMin)} 도착 경로로 계속`} chevron height={56} borderRadius={18} onPress={confirm} />
        )}
        <Pressable onPress={() => { haptic(); navigation.popTo('Plan'); }} hitSlop={{ top: 8, bottom: 12, left: 20, right: 20 }}>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
            확정 전이라 언제든 대화로 바꿀 수 있어요 · <Text style={{ fontFamily: 'Pretendard-SemiBold', color: color.primary }}>대화로 바꾸기</Text>
          </Text>
        </Pressable>
      </View>
      <TabBar />

      <CandidateSheet
        visible={!!pickVisit}
        title={`${pickVisit?.candidate.name ?? ''} 교체`}
        candidates={sheetCands}
        currentId={pickVisit?.candidate.id}
        mode={req.mode}
        timingSource={result.timingSource}
        onPick={candId => pickSlot && flow.setOverride(state.selectedOptionIdx, pickSlot, candId)}
        onClose={() => setPickSlot(null)}
      />
    </View>
  );
}
