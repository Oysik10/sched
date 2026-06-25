import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function AboutScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>About</Text>
      <Text style={styles.app}>Sched</Text>
      <Text style={styles.version}>Version 1.0.0</Text>
      <Text style={styles.text}>
        Sched is an anonymous matching app that connects you with someone new for a short,
        time-limited chat. Answer questions, get matched, and see how well you really know a stranger.
      </Text>
      <Text style={styles.built}>Built with Expo + Firebase</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', padding: 20, paddingTop: 50 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 24 },
  app: { color: '#CFAF45', fontSize: 28, fontWeight: '900', marginBottom: 4 },
  version: { color: '#555', fontSize: 13, marginBottom: 20 },
  text: { color: '#ccc', fontSize: 14, lineHeight: 22, marginBottom: 24 },
  built: { color: '#444', fontSize: 12 },
});
