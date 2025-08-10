import React, { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { collection, doc, onSnapshot, getDoc, writeBatch } from "firebase/firestore";
import { firestore, auth } from "../src/firebaseConfig";
import { router } from "expo-router";

type UserLite = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

type Props = {
  onBack?: () => void;
};

export function SentRequests({ onBack }: Props) {
  const currentUid = auth.currentUser?.uid ?? null;

  const [followers, setFollowers] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to my followers & following
  useEffect(() => {
    if (!currentUid) return;

    const followersRef = collection(firestore, "users", currentUid, "followers");
    const followingRef = collection(firestore, "users", currentUid, "following");

    const unsubFollowers = onSnapshot(followersRef, (snap) => {
      setFollowers(new Set(snap.docs.map((d) => d.id)));
    });
    const unsubFollowing = onSnapshot(followingRef, (snap) => {
      setFollowing(new Set(snap.docs.map((d) => d.id)));
    });

    return () => {
      unsubFollowers();
      unsubFollowing();
    };
  }, [currentUid]);

  // Compute "sent requests" = following − followers, then load user docs
  useEffect(() => {
    if (!currentUid) return;

    const pendingIds = [...following].filter((id) => !followers.has(id));
    if (pendingIds.length === 0) {
      setSent([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      const results = await Promise.all(
        pendingIds.map(async (uid) => {
          const uref = doc(firestore, "users", uid);
          const udoc = await getDoc(uref);
          return udoc.exists() ? ({ id: uid, ...udoc.data() } as UserLite) : null;
        })
      );
      if (!cancelled) {
        setSent(results.filter(Boolean) as UserLite[]);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [followers, following, currentUid]);

  const cancelRequest = async (otherUid: string) => {
    if (!currentUid) return;
    const batch = writeBatch(firestore);

    // Remove the "request" (your follow + your entry in their followers)
    batch.delete(doc(firestore, "users", currentUid, "following", otherUid));
    batch.delete(doc(firestore, "users", otherUid, "followers", currentUid));

    try {
      await batch.commit();
    } catch (e) {
      console.warn("Failed to cancel request:", e);
    }
  };

  const renderItem = ({ item }: { item: UserLite }) => (
    <View style={styles.item}>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.username} numberOfLines={1}>
          {item.username ? `@${item.username}` : "@unknown"}
        </Text>
        <Text style={styles.details} numberOfLines={1}>
          {(item.firstName || "") + " " + (item.lastName || "")}
        </Text>
      </View>
      <TouchableOpacity style={styles.cancelBtn} onPress={() => cancelRequest(item.id)}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  if (!currentUid) {
    return (
      <View style={[styles.center, { backgroundColor: "#0b0b0b", flex: 1 }]}>
        <Text style={styles.emptyText}>Please sign in to view sent requests.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0b0b" }}>
    <View style={styles.headerRow}>
        <TouchableOpacity
        onPress={onBack ?? (() => router.back())}
        style={{ width: 60 }} // fixed width
        >
        <Text
            style={styles.backText}
            numberOfLines={1}
            ellipsizeMode="clip"
        >
            ‹ Back
        </Text>
        </TouchableOpacity>
        <Text style={styles.title}>Sent Requests</Text>
        <View style={{ width: 50 }} />
    </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={sent}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={sent.length === 0 ? styles.center : { paddingVertical: 8 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No sent requests.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: "#0f0f0f",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2a2a2a",
  },
  backText: { color: "#4f8ef7", fontSize: 16, fontWeight: "600", width: 48 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },

  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#171717",
    padding: 12,
    marginHorizontal: 10,
    marginVertical: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  username: { color: "#4f8ef7", fontSize: 16, fontWeight: "600" },
  details: { color: "#ccc", fontSize: 14, marginTop: 2 },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#f55",
  },
  cancelText: { color: "#f55", fontWeight: "700" },

  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { textAlign: "center", color: "#888", marginTop: 8 },
});
