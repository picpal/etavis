/**
 * A2 — 되묻기 선택 시트. '어떤 마트로 할까요?' 같은 넓은 업종을 좁힌다.
 *
 * 채팅 인라인에서 여기로 옮긴 이유: 한 턴에 안내 멘트와 버튼 줄이 겹겹이 쌓여
 * 되묻기가 어느 것인지 묻혔다. 되묻기는 전체 케이스의 17%에서만 뜨고 그때도 거의
 * 항상 한 개라(186케이스 중 2개 이상은 2건), 모달로 끌어내도 연달아 뜨지 않는다.
 *
 * **고르지 않을 길을 반드시 남긴다.** 되묻기는 선택이지 관문이 아니다 — 모달로
 * 올라온 것만으로 답해야만 넘어가는 것처럼 보이므로, 옵트아웃과 안내 문구를 둘 다 둔다.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { Card, haptic } from '../components/common';
import { Sheet } from '../components/Sheet';
import type { NarrowAsk } from '../state/narrowAsk';

/** 고르지 않을 길. `schema.ts:parseOptions` 가 선택지 끝에 항상 붙인다 */
const OPT_OUT = '상관없어요';

export function NarrowAskSheet({
  ask,
  onPick,
  onClose,
}: {
  /** 지금 물을 질문. `null` 이면 시트가 닫혀 있다 — 큐는 화면이 들고 있다 */
  ask: NarrowAsk | null;
  onPick: (option: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Sheet visible={ask != null} onClose={onClose}>
      <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
            경유지
          </Text>
          {/* 질문은 서버가 준 문장 그대로 쓴다 — 화면이 고쳐 쓰면 선택지와 말이 어긋난다 */}
          <Text style={[type.titleL, { color: color.ink }]}>{ask?.question ?? ''}</Text>
        </View>

        <Card style={{ padding: 8 }}>
          {(ask?.options ?? []).map((option, i) => {
            const optOut = option === OPT_OUT;
            return (
              <React.Fragment key={option}>
                {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                <Pressable
                  onPress={() => {
                    haptic();
                    onPick(option);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    style={{
                      flex: 1,
                      // 옵트아웃은 선택지가 아니라 빠져나갈 길이다 — 무게를 낮춰 구분한다
                      fontFamily: optOut ? 'Pretendard-Medium' : 'Pretendard-SemiBold',
                      fontSize: 16,
                      lineHeight: 20,
                      color: optOut ? color.muted : color.ink,
                    }}
                  >
                    {option}
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </Card>

        {/* 모달은 답해야만 넘어가는 것처럼 보인다 — 그렇지 않다고 먼저 말한다 */}
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
          닫아도 괜찮아요 · 경유지 칩을 눌러 다시 고를 수 있어요
        </Text>
      </View>
    </Sheet>
  );
}
