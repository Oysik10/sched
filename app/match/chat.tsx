// app/match/chat.tsx
import React from 'react';
import { View, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import EphemeralMatchChat from '../../components/EphemeralMatchChat';

export default function MatchChatScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <EphemeralMatchChat onExit={() => router.back()} />
    </SafeAreaView>
  );
}
