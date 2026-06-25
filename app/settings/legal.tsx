import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';

export default function LegalScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Legal</Text>

      <Text style={styles.heading}>Terms of Service</Text>
      <Text style={styles.text}>
        By using this app you agree to use it respectfully and lawfully. You must be 18 or older.
        We reserve the right to suspend accounts that violate community guidelines, including harassment,
        hate speech, or misuse of the anonymous match feature.
      </Text>

      <Text style={styles.heading}>Privacy Policy</Text>
      <Text style={styles.text}>
        We collect only the data necessary to run the app: your email address, username, and messages
        sent during anonymous matches. Anonymous match messages are automatically deleted when the
        match expires or is cancelled. We do not sell your data to third parties.
      </Text>

      <Text style={styles.heading}>Anonymous Matching</Text>
      <Text style={styles.text}>
        Anonymous matches are time-limited chats with other users. Your identity is not revealed
        during the chat. All messages are permanently deleted after the match ends.
      </Text>

      <Text style={styles.heading}>Contact</Text>
      <Text style={styles.text}>
        For questions or concerns, contact us through the app's support channel.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  content: { padding: 20, paddingTop: 50, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 20 },
  heading: { color: '#CFAF45', fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 6 },
  text: { color: '#ccc', fontSize: 14, lineHeight: 22 },
});
