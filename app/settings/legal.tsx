// app/settings/legal.tsx
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function LegalScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 14 }}>
      <Text style={styles.title}>Legal</Text>
      <Text style={styles.text}>
        Terms of Service and Privacy Policy go here. Replace this with your legal text
        or a WebView pointing to your hosted policy page.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  text: { color: '#e5e7eb', lineHeight: 20 },
});
