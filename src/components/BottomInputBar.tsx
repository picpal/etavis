/** 하단 입력 바 — 입력창(minHeight 52, R18) + (선택) 52×52 마이크 + 52×52 전송 버튼
 *  마이크: 누르면 듣기 시작(버튼 초록·아이콘 흰색). 부분 결과가 오기 전엔 입력창에 음파,
 *  오면 회색 글자가 차오른다. 끝나면 입력창에 채워지고 전송은 사용자가 한다. */
import React, { useState } from 'react';
import { Keyboard, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, shadow, type } from '../theme/tokens';
import { haptic } from './common';
import { MicIcon } from './primitives';
import { VoiceBars } from './VoiceBars';
import { useSpeechInput } from '../lib/speech';
import { errorCopy, mergeTranscript } from '../lib/speechSession';

function SendGlyph() {
  return (
    <View
      style={{
        width: 14,
        height: 14,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateX: -1.4 }],
      }}
    >
      <View
        style={{
          width: 9,
          height: 9,
          borderTopWidth: 2,
          borderRightWidth: 2,
          borderColor: '#fff',
          borderRadius: 1,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function BottomInputBar({
  placeholder,
  editable = true,
  sendEnabled = true,
  autoFocus,
  onPressIn,
  onSubmit,
  withBottomInset,
  draft,
  voice,
}: {
  placeholder: string;
  editable?: boolean;
  sendEnabled?: boolean;
  autoFocus?: boolean;
  /** 입력창 탭 시 (A1: A2로 이동) */
  onPressIn?: () => void;
  onSubmit?: (text: string) => void;
  /** 아래에 탭바가 없을 때 홈 인디케이터 여백 포함 */
  withBottomInset?: boolean;
  /** 외부에서 입력값 주입 (수정 모드) — key가 바뀔 때마다 text로 교체 */
  draft?: { text: string; key: string };
  /** 마이크 버튼을 보인다. 기기가 음성 인식을 지원하지 않으면 숨는다 */
  voice?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const speech = useSpeechInput({
    onFinal: t => setText(prev => mergeTranscript(prev, t)),
  });
  const listening = speech.listening;
  const showMic = voice && speech.available;

  const onPressMic = () => {
    haptic();
    if (listening) {
      speech.stop();
      return;
    }
    if (speech.error === 'not-allowed') {
      // iOS 는 한 번 거부하면 다시 묻지 않는다. 설정으로 보낸다
      Linking.openSettings();
      return;
    }
    Keyboard.dismiss();
    void speech.start();
  };

  React.useEffect(() => {
    if (draft) setText(draft.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.key]);
  const submit = () => {
    if (!sendEnabled) return;
    haptic();
    if (text.trim()) {
      onSubmit?.(text.trim());
      setText('');
    }
  };
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingVertical: 12,
        paddingBottom: withBottomInset ? Math.max(insets.bottom, 12) : 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {onPressIn ? (
        <Pressable
          onPress={onPressIn}
          style={{
            flex: 1,
            minHeight: 52,
            justifyContent: 'center',
            paddingHorizontal: 18,
            borderRadius: radius.input,
            backgroundColor: color.surface,
            ...shadow.input,
          }}
        >
          <Text style={[type.bodyL, { lineHeight: 16, color: color.placeholder }]}>{placeholder}</Text>
        </Pressable>
      ) : (
        <View
          style={{
            flex: 1,
            minHeight: 52,
            justifyContent: 'center',
            paddingHorizontal: 18,
            borderRadius: radius.input,
            backgroundColor: color.surface,
            ...shadow.input,
          }}
        >
          {listening && !speech.interim ? (
            <View style={{ alignItems: 'center' }}>
              <VoiceBars level={speech.level} />
            </View>
          ) : listening ? (
            <Text style={[type.bodyL, { color: color.muted }]} numberOfLines={2}>
              {speech.interim}
            </Text>
          ) : (
            <TextInput
              editable={editable}
              autoFocus={autoFocus}
              value={text}
              onChangeText={setText}
              onSubmitEditing={submit}
              placeholder={speech.error ? errorCopy(speech.error) : placeholder}
              placeholderTextColor={speech.error ? color.amber : color.placeholder}
              selectionColor={color.primary}
              returnKeyType="send"
              style={[type.bodyL, { color: color.ink, paddingVertical: 0 }]}
            />
          )}
        </View>
      )}
      {showMic && (
        <Pressable
          onPress={onPressMic}
          accessibilityLabel={listening ? '음성 인식 중, 누르면 멈춤' : '음성으로 말하기'}
          style={({ pressed }) => ({
            width: 52,
            height: 52,
            borderRadius: radius.input,
            backgroundColor: listening ? color.green : color.surface,
            alignItems: 'center',
            justifyContent: 'center',
            ...shadow.input,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <MicIcon size={24} tint={listening ? '#fff' : color.primary} />
        </Pressable>
      )}
      <Pressable
        onPress={onPressIn ?? submit}
        disabled={!sendEnabled && !onPressIn}
        style={({ pressed }) => ({
          width: 52,
          height: 52,
          borderRadius: radius.input,
          backgroundColor: sendEnabled || onPressIn ? color.primary : color.stroke,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <SendGlyph />
      </Pressable>
    </View>
  );
}
