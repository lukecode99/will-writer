import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { scopeNotesForText } from '../scope';

/**
 * Live, inline out-of-scope warning shown directly beneath a free-text field.
 *
 * Give it the field's current value; it scans on every render (i.e. every
 * keystroke) and shows one amber advisory per category tripped — trust,
 * business, overseas, conditional gifts and the rest the app cannot express.
 * Renders nothing when the text is clean, so it costs the user nothing until
 * they type a word the app can't honour. This is the same scan that feeds the
 * Review screen (`scopeWarnings`), surfaced early so the warning lands next to
 * the words that caused it. Never blocks — purely advisory.
 */
export function ScopeNotice({ text }: { text: string }) {
  const notes = scopeNotesForText(text);
  if (notes.length === 0) return null;
  return (
    <View>
      {notes.map(n => (
        <View key={n.key} style={styles.warnBox}>
          <Text style={styles.warnText}>{n.message}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  warnBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E4C77A',
    backgroundColor: '#FDF6E3',
  },
  warnText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: '#6B5216',
  },
});
