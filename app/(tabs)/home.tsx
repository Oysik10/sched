import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../src/firebaseConfig';

import EphemeralMatchTile from '../../components/EphemeralMatchTile'; // you can keep it stateful or make it dumb later
import EphemeralAnswersBlock from '../../components/EphemeralAnswersBlock';

import { useDailyQuestions } from '../../src/hooks/useDailyQuestions';
import { useActiveEphemeralMatch } from '../../src/hooks/useActiveEphemeralMatch';

function AdminButton() {
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [checking, setChecking] = React.useState(true);
  const router = useRouter();

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setIsAdmin(false); setChecking(false); return; }
      const token = await u.getIdTokenResult(true);
      setIsAdmin(!!token.claims?.admin);
      setChecking(false);
    });
    return unsub;
  }, []);

  if (checking || !isAdmin) return null;

  return (
    <TouchableOpacity
      onPress={() => router.push('/admin/reports')}
      style={{ padding: 10, backgroundColor: '#1f2937', borderRadius: 8 }}
    >
      <Text style={{ color: '#fff', fontWeight: '700' }}>Open Admin Reports</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const { dayKey, questions } = useDailyQuestions(3);
  const { hasActiveMatch, partnerUid } = useActiveEphemeralMatch();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, backgroundColor: '#000' }}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>🏠 Home</Text>
        <AdminButton />
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        <EphemeralMatchTile />
        {hasActiveMatch && partnerUid ? (
          <EphemeralAnswersBlock
            partnerUid={partnerUid}
            questionSet={questions}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No active match yet.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  placeholderText: { color: '#777' },
});
