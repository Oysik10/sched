import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

const TABS = [
  { label: 'Account Information', route: '../Profile/account-information' },
  { label: 'Liked', route: '../Profile/liked' },
  { label: 'Follows', route: '../Profile/following' },
  { label: 'Visited Places', route: '../Profile/visited-countries' },
  { label: 'Lists', route: '../Profile/lists' },
  { label: 'Uploaded Journals', route: '../Profile/uploaded-journals' },
];


export default function ProfileScreen() {
  return (
    <LinearGradient colors={['#0f0f0f', '#1a1a1a']} style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.header}>👤 Your Profile</Text>
        <View style={styles.tabColumn}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.label}
              style={styles.tabButton}
              onPress={() => router.push(tab.route)}
            >
              <Text style={styles.tabText}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: 40,
    marginBottom: 16,
    textAlign: 'center',
  },
  tabColumn: {
    paddingHorizontal: 20,
  },
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
  tabText: {
    color: '#aaa',
    fontSize: 16,
  },
});
