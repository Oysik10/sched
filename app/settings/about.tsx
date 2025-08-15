// app/settings/about.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function AboutScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>About</Text>
      <Text style={styles.text}>App Name v1.0.0</Text>
      <Text style={styles.text}>© {new Date().getFullYear()} Your Company</Text>
      <Text style={[styles.text, { marginTop: 8 }]}>
        Built with Expo + Firebase.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', padding: 14 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  text: { color: '#e5e7eb', lineHeight: 20 },
});
