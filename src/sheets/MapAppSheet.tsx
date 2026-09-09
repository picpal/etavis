/**
 * A7 — 외부 지도 앱 선택 시트.
 *
 * 확정한 경로를 각 앱의 URL scheme으로 직렬화해 넘긴다.
 * 앱마다 받을 수 있는 경유지 수가 달라서, 무엇이 전달되고 무엇이 빠지는지를
 * 행마다 그대로 적는다 — 넘어간 줄 알았는데 안 넘어간 게 제일 나쁘다.
 *
 * 대중교통은 지도 앱이 경유지를 아예 못 받으므로 구간 단위로 넘긴다 (src/lib/routeLegs.ts).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, type } from '../theme/tokens';
import { usePlan } from '../state/plan';
import { useCurrentPlace } from '../lib/currentPlace';
import { linkFor, MAP_APPS, MapAppId, MapAppSpec, RoutePlan, transferNote } from '../lib/mapLinks';
import { useRouteLegs } from '../lib/routeLegs';
import { Card, haptic } from '../components/common';
import { Chevron, DashedLineV, Hairline } from '../components/primitives';
import { Sheet } from '../components/Sheet';

const DEEPLINK_DELAY = 300;

type InstalledMap = Partial<Record<MapAppId, boolean>>;

export function MapAppSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { state } = usePlan();
  const here = useCurrentPlace();
  const { legs, nextLeg, byLeg } = useRouteLegs();
  const [failed, setFailed] = useState<MapAppSpec | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMap>({});
  const [legIndex, setLegIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 열 때마다 '지금 갈 구간'으로 되돌린다 — 대부분 그걸 원한다
  useEffect(() => {
    if (!visible) return;
    setLegIndex(null);
    setPickerOpen(false);
    setFailed(null);
  }, [visible]);

  const leg = legs.find(l => l.index === legIndex) ?? nextLeg;

  const wholePlan = useMemo<RoutePlan>(
    () => ({
      // 출발지를 생략하면 세 앱 모두 현재 위치를 쓴다 — GPS가 아직이면 그쪽에 맡긴다
      origin: here.coord ? { name: '내 위치', coord: here.coord } : null,
      waypoints: state.stops.map(s => ({ name: s.name, coord: s.coord })),
      destination: {
        name: state.destinationName ?? state.dataset.destination.name,
        coord: state.destinationCoord ?? state.dataset.destination.coord,
      },
      mode: state.mode,
    }),
    [here.coord, state.stops, state.destinationName, state.destinationCoord, state.dataset, state.mode],
  );

  const plan = useMemo<RoutePlan>(
    () =>
      byLeg && leg
        ? { origin: leg.from, waypoints: [], destination: leg.to, mode: state.mode }
        : wholePlan,
    [byLeg, leg, wholePlan, state.mode],
  );

  // 설치 여부는 실제로 물어본다. Info.plist의 LSApplicationQueriesSchemes에 등록돼 있어야 한다
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    Promise.all(MAP_APPS.map(app => Linking.canOpenURL(app.probeUrl).catch(() => false))).then(results => {
      if (!alive) return;
      const next: InstalledMap = {};
      MAP_APPS.forEach((app, i) => {
        next[app.id] = results[i];
      });
      setInstalled(next);
    });
    return () => {
      alive = false;
    };
  }, [visible]);

  /**
   * 전부 미설치로 나오면 그 판정을 믿지 않는다.
   * canOpenURL은 Info.plist에 스킴이 등록돼야 동작하는데, 지도 앱이 하나도 없는 기기보다
   * 등록이 빠진 빌드(Expo Go 포함)일 확률이 훨씬 높다. 하나라도 잡혀야 판정을 신뢰한다.
   */
  const trustProbe = Object.values(installed).some(Boolean);
  const knownMissing = (app: MapAppSpec) => trustProbe && installed[app.id] === false;

  const openStore = (app: MapAppSpec) => {
    haptic();
    Linking.openURL(app.storeUrl).catch(() => setFailed(app));
  };

  /**
   * 미설치로 보여도 일단 열어본다.
   * 판정을 못 믿는 상황(스킴 미등록)에서 오판이 막다른 길이 되면 안 되므로,
   * 확실히 미설치일 때만 곧장 스토어로 넘기고 나머지는 배너로 물어본다.
   */
  const tryOpen = (app: MapAppSpec) => {
    haptic();
    setFailed(null);
    setOpening(app.id);
    const { url } = linkFor(app, plan);
    setTimeout(() => {
      Linking.openURL(url)
        .then(() => setOpening(null))
        .catch(() => {
          setOpening(null);
          if (knownMissing(app)) openStore(app);
          else setFailed(app);
        });
    }, DEEPLINK_DELAY);
  };

  const stopCount = wholePlan.waypoints.length;
  const anyDropped = MAP_APPS.some(app => linkFor(app, wholePlan).dropped > 0);

  const banner = byLeg
    ? {
        title: '대중교통은 구간마다 열어야 해요',
        body: '지도 앱이 대중교통 경유지를 지원하지 않아요. 도착하면 다음 구간이 여기에 자동으로 준비됩니다.',
      }
    : stopCount === 0
      ? { title: '목적지만 전달돼요', body: '들를 곳이 없는 경로예요.' }
      : anyDropped
        ? {
            title: '일부 앱은 경유지를 5개까지만 받아요',
            body: `지금 경로는 ${stopCount}곳이라 넘치는 만큼은 지도 앱에서 직접 추가해야 해요.`,
          }
        : { title: '경유지도 함께 전달돼요', body: `들를 곳 ${stopCount}곳이 순서 그대로 넘어갑니다.` };

  return (
    <Sheet visible={visible} onClose={onClose} scrim={color.scrimStrong}>
      <View style={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 23, lineHeight: 29, letterSpacing: -0.23, color: color.ink }}>
            {byLeg ? '어느 구간을 열까요?' : '어떤 지도 앱으로 열까요?'}
          </Text>
          <Text style={[type.body, { color: color.muted }]}>
            {byLeg
              ? '지금 갈 구간이 골라져 있어요. 저장과 실제 안내는 선택한 앱에서 진행됩니다.'
              : '경로를 전달만 해요. 저장과 실제 안내는 선택한 앱에서 진행됩니다.'}
          </Text>
        </View>

        {byLeg && leg && (
          <LegPicker
            legs={legs}
            selected={leg.index}
            open={pickerOpen}
            onToggle={() => {
              haptic();
              setPickerOpen(o => !o);
            }}
            onSelect={index => {
              haptic();
              setLegIndex(index);
              setPickerOpen(false);
            }}
          />
        )}

        {/* 구간을 고르는 동안에는 앱 목록을 접는다 — 구간이 많으면 시트가 화면을 넘긴다 */}
        {!pickerOpen && (
        <View style={{ backgroundColor: color.surface, borderRadius: 20, overflow: 'hidden' }}>
          {MAP_APPS.map((app, i) => {
            const missing = knownMissing(app);
            return (
              <React.Fragment key={app.id}>
                {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginLeft: 70 }} />}
                <Pressable
                  onPress={() => tryOpen(app)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    padding: 16,
                    minHeight: 58,
                    opacity: missing ? 0.6 : pressed || opening === app.id ? 0.6 : 1,
                  })}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: app.tint }} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 16, lineHeight: 19, color: color.ink }}>
                      {app.name}
                    </Text>
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 16, color: color.muted }}>
                      {missing
                        ? '미설치 · App Store로 이동'
                        : byLeg
                          ? '이 구간 대중교통 길찾기'
                          : transferNote(linkFor(app, plan), plan)}
                    </Text>
                  </View>
                  {missing ? (
                    <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 14, lineHeight: 14, color: color.primary }}>
                      설치
                    </Text>
                  ) : (
                    <Chevron size={8} thickness={2} color={color.stroke} dir="right" />
                  )}
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
        )}

        {pickerOpen ? null : failed ? (
          /* A8 스타일 오류 배너 */
          <View style={{ backgroundColor: color.amberBg, borderRadius: 16, padding: 14, gap: 8 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 17.5, color: color.amber }}>
              {failed.name} 앱을 열 수 없어요
            </Text>
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 19, color: color.amber }}>
              설치되어 있지 않거나 연결이 불안정해요. 다른 앱을 고르거나 설치한 뒤 다시 시도해 주세요.
            </Text>
            <View style={{ flexDirection: 'row', gap: 18, paddingTop: 2 }}>
              <Pressable onPress={() => openStore(failed)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.amberDeep }}>
                  설치하러 가기
                </Text>
              </Pressable>
              <Pressable onPress={() => setFailed(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.amber }}>
                  확인
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ backgroundColor: color.amberBg, borderRadius: 16, padding: 14, gap: 4 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 17.5, color: color.amber }}>
              {banner.title}
            </Text>
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 19, color: color.amber }}>
              {banner.body}
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => {
            haptic();
            onClose();
          }}
          style={({ pressed }) => ({
            minHeight: 54,
            borderRadius: radius.input,
            backgroundColor: color.track,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={[type.btn, { color: color.body }]}>취소</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/** 선택된 구간을 출발–도착 두 줄로 보여주고, 탭하면 전체 구간 목록으로 펼친다 */
function LegPicker({
  legs,
  selected,
  open,
  onToggle,
  onSelect,
}: {
  legs: ReturnType<typeof useRouteLegs>['legs'];
  selected: number;
  open: boolean;
  onToggle: () => void;
  onSelect: (index: number) => void;
}) {
  const leg = legs.find(l => l.index === selected);
  if (!leg) return null;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[type.label, { flex: 1, color: color.muted }]}>
          대중교통 · {legs.length}개 구간 중 {selected + 1}번째
        </Text>
        {legs.length > 1 && (
          <Pressable onPress={onToggle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.primary }}>
              {open ? '닫기' : '구간 바꾸기'}
            </Text>
          </Pressable>
        )}
      </View>

      {open ? (
        <Card style={{ padding: 8 }}>
          {legs.map((l, i) => (
            <React.Fragment key={l.index}>
              {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
              <Pressable
                onPress={() => onSelect(l.index)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 13,
                  paddingHorizontal: 12,
                  opacity: pressed ? 0.7 : l.done ? 0.45 : 1,
                })}
              >
                <Text
                  style={{
                    width: 18,
                    fontFamily: 'Pretendard-SemiBold',
                    fontSize: 13,
                    lineHeight: 18,
                    color: l.index === selected ? color.primary : color.muted,
                  }}
                >
                  {l.index + 1}
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontFamily: l.index === selected ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                    fontSize: 14,
                    lineHeight: 19,
                    color: color.ink,
                  }}
                  numberOfLines={1}
                >
                  {l.from.name} → {l.to.name}
                </Text>
                {l.isNext && (
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 16, color: color.primary }}>
                    지금
                  </Text>
                )}
              </Pressable>
            </React.Fragment>
          ))}
        </Card>
      ) : (
        /* 계획 화면의 출발–목적지 카드와 같은 구조로 맞춘다 */
        <Pressable onPress={onToggle} disabled={legs.length <= 1}>
          <Card style={{ padding: 18, flexDirection: 'row', gap: 14 }}>
            <View style={{ width: 12, alignItems: 'center', paddingVertical: 6 }}>
              <View style={{ width: 11, height: 11, borderRadius: 5.5, borderWidth: 3, borderColor: color.primary }} />
              <DashedLineV style={{ flex: 1, marginVertical: 6 }} />
              <View style={{ width: 11, height: 11, borderRadius: 5.5, backgroundColor: color.green }} />
            </View>
            <View style={{ flex: 1, gap: 14 }}>
              <View style={{ gap: 3 }}>
                <Text style={[type.labelPlain, { color: color.muted }]}>출발</Text>
                <Text style={[type.title, { color: color.ink }]} numberOfLines={1}>
                  {leg.from.name}
                </Text>
              </View>
              <Hairline />
              <View style={{ gap: 3 }}>
                <Text style={[type.labelPlain, { color: color.muted }]}>도착</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[type.title, { flex: 1, color: color.ink }]} numberOfLines={1}>
                    {leg.to.name}
                  </Text>
                  {legs.length > 1 && (
                    <Chevron size={9} thickness={2} color={color.stroke} dir="down" style={{ marginTop: -4 }} />
                  )}
                </View>
              </View>
            </View>
          </Card>
        </Pressable>
      )}
    </View>
  );
}
