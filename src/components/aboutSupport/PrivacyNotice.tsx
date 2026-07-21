import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { aboutSupportColors, aboutSupportTypography } from '@/src/styles/aboutSupportTokens';

export interface PrivacyNoticeProps {
  text: string;
  tone?: 'green' | 'neutral';
  style?: StyleProp<ViewStyle>;
}

export function PrivacyNotice({ text, tone = 'neutral', style }: PrivacyNoticeProps) {
  const isGreen = tone === 'green';

  return (
    <View style={[styles.notice, isGreen ? styles.greenNotice : null, style]}>
      <MaterialIcons
        color={isGreen ? aboutSupportColors.privacy : aboutSupportColors.neutralNotice}
        name="lock-outline"
        size={19}
      />
      <Text style={[styles.text, isGreen ? styles.greenText : null]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: aboutSupportColors.neutralNoticeBackground,
  },
  greenNotice: {
    minHeight: 38,
    borderRadius: 999,
    paddingVertical: 7,
    backgroundColor: aboutSupportColors.privacySoft,
  },
  text: {
    ...aboutSupportTypography.supporting,
    flexShrink: 1,
    color: aboutSupportColors.neutralNotice,
    textAlign: 'center',
  },
  greenText: {
    color: aboutSupportColors.privacy,
    fontWeight: '600',
  },
});
