// app/settings/index.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export default function SettingsHome() {
  const router = useRouter();

  const [uid, setUid] = useState<string>('');
  const [darkMode, setDarkMode] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setUid(user?.uid ?? '');
      if (!user) return;

      const dm = await AsyncStorage.getItem('pref:darkMode');
      if (dm != null) setDarkMode(dm === '1');

      try {
        const us = await getDoc(doc(firestore, 'users', user.uid));
        const dbNotif = us.exists() ? (us.data() as any)?.notificationsEnabled : undefined;
        if (typeof dbNotif === 'boolean') setNotifEnabled(dbNotif);
        else {
          const local = await AsyncStorage.getItem('pref:notifications');
          if (local != null) setNotifEnabled(local === '1');
        }
      } catch {
        const local = await AsyncStorage.getItem('pref:notifications');
        if (local != null) setNotifEnabled(local === '1');
      }
    });
    return unsub;
  }, []);

  const toggleDarkMode = async (val: boolean) => {
    setDarkMode(val);
    await AsyncStorage.setItem('pref:darkMode', val ? '1' : '0');
    // TODO: wire into your theme provider/context
  };

  const toggleNotifications = async (val: boolean) => {
    setNotifEnabled(val);
    await AsyncStorage.setItem('pref:notifications', val ? '1' : '0');
    setSavingNotif(true);
    try {
      if (uid) await updateDoc(doc(firestore, 'users', uid), { notificationsEnabled: val });
    } catch {
      // ignore if user doc updates are not allowed yet
    } finally {
      setSavingNotif(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      {/* Notifications */}
      <Section title="Notifications">
        <Row
          label="Enable Notifications"
          right={<Switch value={notifEnabled} onValueChange={toggleNotifications} disabled={savingNotif} />}
        />
      </Section>

      {/* Privacy / Safety */}
      <Section title="Privacy & Safety">
        <TouchableOpacity
          onPress={() => router.push('../settings/blocked')}
          style={styles.linkRow}
        >
          <Text style={styles.link}>Blocked users</Text>
        </TouchableOpacity>
      </Section>

      {/* Legal & About (stubs you can keep/remove) */}
      <Section title="Legal & About">
        <TouchableOpacity
          onPress={() => router.push('../settings/legal')}
          style={styles.linkRow}
        >
          <Text style={styles.link}>Legal</Text>
        </TouchableOpacity>
                <TouchableOpacity
          onPress={() => router.push('../settings/about')}
          style={styles.linkRow}
        >
          <Text style={styles.link}>About</Text>
        </TouchableOpacity>
      </Section>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

function Row({ label, sub, right }: { label: string; sub?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.rowBetween}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.dim}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', padding: 14, paddingTop: 50 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },

  section: { backgroundColor: '#0b0b0b', borderColor: '#222', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  sectionTitle: { color: '#fff', fontWeight: '800', marginBottom: 8 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: '#e5e7eb', fontSize: 16 },

  linkRow: { paddingVertical: 10, borderTopColor: '#1b1b1b', borderTopWidth: StyleSheet.hairlineWidth },
  link: { color: '#93c5fd', fontWeight: '700' },

  dim: { color: '#9aa7b1' },
});
