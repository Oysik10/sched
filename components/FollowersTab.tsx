import React, { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { collection, doc, onSnapshot, getDoc, writeBatch } from "firebase/firestore";
import { firestore, auth } from "../src/firebaseConfig";
import { router } from "expo-router"; 
import { deleteDoc } from "firebase/firestore";

type Friend = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

const FriendsScreen = () => {
  const [followers, setFollowers] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<Friend[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const currentUid = auth.currentUser?.uid ?? null;

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

  // Load mutual friends
  useEffect(() => {
    if (!currentUid) return;

    const mutualIds = [...followers].filter((id) => following.has(id));
    if (mutualIds.length === 0) {
      setFriends([]);
      setLoadingFriends(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingFriends(true);
      const results = await Promise.all(
        mutualIds.map(async (uid) => {
          const uref = doc(firestore, "users", uid);
          const udoc = await getDoc(uref);
          return udoc.exists() ? ({ id: uid, ...udoc.data() } as Friend) : null;
        })
      );
      if (!cancelled) {
        setFriends(results.filter(Boolean) as Friend[]);
        setLoadingFriends(false);
      }
    })();

    return () => { cancelled = true; };
  }, [followers, following, currentUid]);

  // Load incoming requests (followers that you are NOT following back)
  useEffect(() => {
    if (!currentUid) return;

    const requestIds = [...followers].filter((id) => !following.has(id));
    if (requestIds.length === 0) {
      setRequests([]);
      setLoadingRequests(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingRequests(true);
      const results = await Promise.all(
        requestIds.map(async (uid) => {
          const uref = doc(firestore, "users", uid);
          const udoc = await getDoc(uref);
          return udoc.exists() ? ({ id: uid, ...udoc.data() } as Friend) : null;
        })
      );
      if (!cancelled) {
        setRequests(results.filter(Boolean) as Friend[]);
        setLoadingRequests(false);
      }
    })();

    return () => { cancelled = true; };
  }, [followers, following, currentUid]);

  const acceptRequest = async (otherUid: string) => {
    if (!currentUid) return;
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, "users", currentUid, "following", otherUid), { createdAt: Date.now() });
    batch.set(doc(firestore, "users", otherUid, "followers", currentUid), { createdAt: Date.now() });
    try { await batch.commit(); } catch (e) { console.warn("Failed to accept:", e); }
  };

  const declineRequest = async (otherUid: string) => {
    if (!currentUid) return;
    const batch = writeBatch(firestore);
    batch.delete(doc(firestore, "users", currentUid, "followers", otherUid));
    batch.delete(doc(firestore, "users", otherUid, "following", currentUid));
    try { await batch.commit(); } catch (e) { console.warn("Failed to decline:", e); }
  };

  // Unfriend with confirmation: removes both directions so it's no longer mutual
  const unfriend = async (otherUid: string) => {
    if (!currentUid) return;

    Alert.alert(
      "Unfriend",
      "Are you sure you want to remove this friend?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unfriend",
          style: "destructive",
          onPress: async () => {
            try {
              // First remove friendship both ways
              const batch = writeBatch(firestore);
              batch.delete(doc(firestore, "users", currentUid, "following", otherUid));
              batch.delete(doc(firestore, "users", otherUid, "followers", currentUid));
              batch.delete(doc(firestore, "users", otherUid, "following", currentUid));
              batch.delete(doc(firestore, "users", currentUid, "followers", otherUid));
              await batch.commit();

              // Then delete any DM thread(s) with them
              // Assumes threads are in `dms/{threadId}` where threadId is `${uid}_${otherUid}` or vice versa
              const possibleIds = [
                `${currentUid}_${otherUid}`,
                `${otherUid}_${currentUid}`,
              ];

              for (const tid of possibleIds) {
                const tRef = doc(firestore, "dms", tid);
                const snap = await getDoc(tRef);
                if (snap.exists()) {
                  // Delete the thread doc (which also deletes messages if you use subcollections)
                  await deleteDoc(tRef);
                }
              }

              console.log(`Unfriended ${otherUid} and removed chat`);
            } catch (e) {
              console.warn("Failed to unfriend/delete chat:", e);
            }
          },
        },
      ]
    );
  };

  const renderRequestItem = ({ item }: { item: Friend }) => (
    <View style={styles.reqItem}>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.username} numberOfLines={1}>{item.username || "@unknown"}</Text>
        <Text style={styles.details} numberOfLines={1}>{(item.firstName || "") + " " + (item.lastName || "")}</Text>
      </View>
      <View style={styles.reqActions}>
        <TouchableOpacity style={[styles.chipBtn, styles.acceptBtn]} onPress={() => acceptRequest(item.id)}>
          <Text style={[styles.chipText, styles.acceptText]}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.chipBtn, styles.declineBtn]} onPress={() => declineRequest(item.id)}>
          <Text style={[styles.chipText, styles.declineText]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // Show "Friends ✓" badge ONLY if mutual (in followers AND following), plus Unfriend button
  const renderFriendItem = ({ item }: { item: Friend }) => {
    const isFriends = followers.has(item.id) && following.has(item.id);
    return (
      <View style={styles.userItem}>
        <View style={styles.userTopRow}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.username} numberOfLines={1}>{item.username || "@unknown"}</Text>
            <Text style={styles.details} numberOfLines={1}>{(item.firstName || "") + " " + (item.lastName || "")}</Text>
          </View>

          {isFriends && (
            <View style={styles.friendsBadge}>
              <Text style={styles.friendsBadgeText}>Friends ✓</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.unfriendBtn} onPress={() => unfriend(item.id)}>
          <Text style={styles.unfriendText}>Unfriend</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (!currentUid) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Please sign in to view friends.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header with button */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>
          Friend Requests {loadingRequests ? "" : `(${requests.length})`}
        </Text>
        <TouchableOpacity onPress={() => router.push("/sentrequests")} style={{ padding: 8 }}>
          <Text style={styles.sentRequestsBtn}>Sent Requests</Text>
        </TouchableOpacity>
      </View>

      {/* Top quarter: Friend Requests */}
      <View style={styles.requestsContainer}>
        {loadingRequests ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={requests}
            keyExtractor={(item) => item.id}
            renderItem={renderRequestItem}
            ListEmptyComponent={<Text style={styles.emptyText}>No pending requests.</Text>}
            contentContainerStyle={requests.length === 0 ? styles.center : undefined}
          />
        )}
      </View>

      {/* Bottom: Friends (flex rest) */}
      <View style={styles.friendsContainer}>
        <Text style={styles.sectionTitle}>Friends {loadingFriends ? "" : `(${friends.length})`}</Text>
        {loadingFriends ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={friends}
            keyExtractor={(item) => item.id}
            renderItem={renderFriendItem}
            ListEmptyComponent={<Text style={styles.emptyText}>No friends yet.</Text>}
            contentContainerStyle={friends.length === 0 ? styles.center : undefined}
          />
        )}
      </View>
    </View>
  );
};

export default FriendsScreen;

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "#0f0f0f",
  },
  sentRequestsBtn: {
    color: "#4f8ef7",
    fontWeight: "600",
    fontSize: 14,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  requestsContainer: {
    height: "25%",
    backgroundColor: "#0f0f0f",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2a2a2a",
  },
  reqItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#171717",
    padding: 12,
    marginHorizontal: 10,
    marginVertical: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  reqActions: { flexDirection: "row", gap: 8 },
  chipBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  acceptBtn: { borderColor: "#51ff87" },
  declineBtn: { borderColor: "#f55" },
  chipText: { fontWeight: "700" },
  acceptText: { color: "#51ff87" },
  declineText: { color: "#f55" },

  friendsContainer: { flex: 1, backgroundColor: "#0b0b0b", paddingTop: 6 },

  // Updated layout for friend item with badge + button
  userItem: {
    backgroundColor: "#1a1a1a",
    padding: 14,
    marginHorizontal: 10,
    marginVertical: 6,
    borderRadius: 8,
  },
  userTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  // Green "Friends ✓" badge
  friendsBadge: {
    backgroundColor: "#16351f",
    borderColor: "#3cab5b",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  friendsBadgeText: { color: "#3cab5b", fontSize: 12, fontWeight: "700" },

  username: { color: "#4f8ef7", fontSize: 16, fontWeight: "600" },
  details: { color: "#ccc", fontSize: 14, marginTop: 2 },

  emptyText: { textAlign: "center", color: "#888", marginTop: 20 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },

  unfriendBtn: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#f55",
    alignSelf: "flex-start",
  },
  unfriendText: { color: "#f55", fontWeight: "600" },
});
