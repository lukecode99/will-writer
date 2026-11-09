import { StyleSheet } from 'react-native';

export const C = {
  primary: '#1B3A6B',
  // iOS systemGroupedBackground / neutral separators, so screens read as native
  // grouped lists rather than a tinted web page.
  background: '#F2F2F7',
  surface: '#FFFFFF',
  text: '#1C1C1E',
  textLight: '#6E6E73',
  border: '#D1D1D6',
  // A faint hairline for grouped-row separators (iOS opaque separator).
  hairline: '#E3E3E8',
  danger: '#DC2626',
  success: '#059669',
};

/**
 * Forms are capped to this width and centred. Roughly the width of an iPhone
 * Pro Max, so phones are unaffected; on an iPad it stops a name field being
 * stretched across the whole screen.
 */
export const CONTENT_MAX_WIDTH = 560;

export const shared = StyleSheet.create({
  scrollContent: {
    padding: 20,
    paddingBottom: 48,
    backgroundColor: C.background,
    flexGrow: 1,
  },
  heading: {
    // iOS large-title weight/size — the screen title sits big and bold at the
    // top of the scroll, the way a UINavigationController large title does.
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.37,
    color: C.text,
    marginBottom: 4,
    marginTop: 4,
  },
  sub: {
    fontSize: 15,
    color: C.textLight,
    marginBottom: 20,
    lineHeight: 21,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    marginBottom: 7,
    marginTop: 16,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    // 17pt is the iOS body size; anything smaller reads as a web form and also
    // makes iOS zoom the field on focus.
    fontSize: 17,
    color: C.text,
    marginBottom: 2,
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: C.danger,
  },
  error: {
    color: C.danger,
    fontSize: 12,
    marginBottom: 4,
  },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryBtnText: {
    color: '#fff',
    // 17pt / semibold is the iOS prominent-button convention; the old 700 read
    // heavier than any native control.
    fontSize: 17,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  // iOS "gray" (tinted) button: a soft fill with the brand tint as the label,
  // rather than a web outline. Reads as a secondary action, not a bordered link.
  secondaryBtn: {
    backgroundColor: '#EAEAF0',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryBtnText: {
    color: C.primary,
    fontSize: 17,
    fontWeight: '600',
  },
  dangerBtn: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  dangerBtnText: {
    color: C.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  addBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#EAEAF0',
    marginTop: 10,
  },
  addBtnText: {
    color: C.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.hairline,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginTop: 20,
    marginBottom: 2,
  },
  hint: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 10,
    lineHeight: 18,
  },
  optionalTag: {
    fontSize: 12,
    color: C.textLight,
    fontStyle: 'italic',
    marginLeft: 4,
  },
});
