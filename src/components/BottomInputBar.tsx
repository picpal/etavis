/** 하단 입력 바 — 입력창(minHeight 52, R18) + (선택) 52×52 마이크 + 52×52 전송 버튼 */
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, shadow, type } from '../theme/tokens';
import { haptic } from './common';
import { MicIcon } from './primitives';
import { VoiceBars } from './VoiceBars';

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
  /** 마이크 버튼을 보인다. 아직 인식은 없고 듣는 중 표시만 토글한다(디자인) */
  voice?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);

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
          {listening ? (
            <View style={{ alignItems: 'center' }}>
              <VoiceBars />
            </View>
          ) : (
            <TextInput
              editable={editable}
              autoFocus={autoFocus}
              value={text}
              onChangeText={setText}
              onSubmitEditing={submit}
              placeholder={placeholder}
              placeholderTextColor={color.placeholder}
              selectionColor={color.primary}
              returnKeyType="send"
              style={[type.bodyL, { color: color.ink, paddingVertical: 0 }]}
            />
          )}
        </View>
      )}
      {voice && (
        <Pressable
          onPress={() => {
            haptic();
            setListening(v => !v);
          }}
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
