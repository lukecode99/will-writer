import React, { useRef } from 'react';
import { Animated, Pressable, Text, Platform, StyleSheet, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { shared } from './screens/shared';

/**
 * A single place for the small native touches that make the app feel like an iOS
 * app rather than a web page in a shell: a light tap buzz, and buttons that
 * physically dip when pressed. Everything here degrades to a no-op on web, so
 * the same codebase keeps working in the browser.
 */

/** A light confirmation tap. Silent/no-op on web (and never throws there). */
export function haptic(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS === 'web') return;
  // Fire-and-forget: a failed haptic must never block or crash a tap.
  Haptics.impactAsync(style).catch(() => {});
}

/** A success thud — used when an order/action completes. */
export function hapticSuccess() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** 'primary' = filled navy CTA, 'secondary' = outlined. */
  variant?: 'primary' | 'secondary';
  style?: ViewStyle | ViewStyle[];
  /** Fire a haptic on press (default true). */
  withHaptic?: boolean;
}

/**
 * The standard call-to-action button. Scales down slightly while held — the
 * press feedback iOS users expect — and gives a light haptic tap on release.
 * Visually identical to the old `shared.primaryBtn`/`secondaryBtn` so swapping it
 * in changes feel, not look.
 */
export function Button({
  label,
  onPress,
  disabled,
  variant = 'primary',
  style,
  withHaptic = true,
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const native = Platform.OS !== 'web';

  const to = (v: number) =>
    Animated.spring(scale, {
      toValue: v,
      useNativeDriver: native,
      speed: 50,
      bounciness: 0,
    }).start();

  const isPrimary = variant === 'primary';
  const baseBtn = isPrimary ? shared.primaryBtn : shared.secondaryBtn;
  const baseTxt = isPrimary ? shared.primaryBtnText : shared.secondaryBtnText;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={() => !disabled && to(0.97)}
        onPressOut={() => to(1)}
        onPress={() => {
          if (disabled) return;
          if (withHaptic) haptic();
          onPress();
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        style={[baseBtn, disabled ? shared.btnDisabled : null, style as ViewStyle]}
      >
        <Text style={baseTxt}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({});
