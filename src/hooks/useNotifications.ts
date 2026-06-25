// src/hooks/useNotifications.ts
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { doc, setDoc } from 'firebase/firestore';
import { firestore } from '../firebaseConfig';

// Foreground: always show banner + badge + sound (native only)
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators can't get tokens

  // Android requires a channel before anything else
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#CFAF45',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch {
    // No EAS project configured — token unavailable but local notifs still work
    return null;
  }
}

function handleNotificationResponse(
  response: Notifications.NotificationResponse
) {
  const data = response.notification.request.content.data as Record<string, any>;
  if (!data) return;

  switch (data.type) {
    case 'friend_request':
    case 'friend_accepted':
      if (data.fromUid) router.push(`/user/${data.fromUid}` as any);
      break;
    case 'match_found':
    case 'match_expired':
    case 'match_cancelled':
      router.push('/(tabs)/home' as any);
      break;
    case 'new_message':
      if (data.fromUid) router.push(`/dm/${data.fromUid}` as any);
      break;
    default:
      router.push('/notifications' as any);
  }
}

export function useNotifications(uid: string) {
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!uid || Platform.OS === 'web') return;

    // Register and save push token
    registerForPushNotifications().then((token) => {
      if (token) {
        setDoc(
          doc(firestore, 'users', uid),
          { expoPushToken: token },
          { merge: true }
        ).catch(() => {});
      }
    });

    // Handle tap on notification (app foregrounded from notification)
    responseListenerRef.current =
      Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    return () => {
      responseListenerRef.current?.remove();
    };
  }, [uid]);
}

/** Schedule a local push notification on this device. */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: data ?? {}, sound: true },
      trigger: null, // fire immediately
    });
  } catch {
    // ignore scheduling errors (e.g. no permission)
  }
}
