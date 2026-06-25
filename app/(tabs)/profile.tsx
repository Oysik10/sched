import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { getAuth, signOut } from 'firebase/auth';

const TABS = [
  { label: 'Account Information', route: '../Profile/account-information' },
  { label: 'Friends', route: '../Profile/following' },
  { label: 'Settings', route: '../Profile/settings' },
];

export default function ProfileScreen() {
  const handleSignOut = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
      router.replace('/'); // 👈 AuthScreen route; change if yours differs
    } catch (e: any) {
      Alert.alert('Sign out failed', e?.message ?? 'Please try again.');
    }
  };

  return (
    <LinearGradient colors={['#0f0f0f', '#1a1a1a']} style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <Text style={styles.header}>👤 Your Profile</Text>
        <View style={styles.tabColumn}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.label}
              style={styles.tabButton}
              onPress={() => router.push(tab.route as any)}
            >
              <Text style={styles.tabText}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Bottom sign out bar */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: 40,
    marginBottom: 16,
    textAlign: 'center',
  },
  tabColumn: { paddingHorizontal: 20 },
  tabButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#222',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  tabText: { color: '#aaa', fontSize: 16 },

  // footer sign out
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
  },
  signOutButton: {
    backgroundColor: '#b91c1c', // deep red
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  signOutText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
