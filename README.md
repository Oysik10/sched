# Sched

An anonymous matching and chat app. It pairs two people anonymously and gives them a three-day window to actually talk — then identities are revealed and a set of questions opens up. The idea was to strip out the usual profile-first dynamic and see what happens when the conversation comes first. Runs on iOS and on the web from a single codebase.

**[Live demo →](https://sched-eight.vercel.app)**

## What it does

- **Anonymous pairing** — you're matched with someone, no profile, no photo
- **Three-day window** — you've got 72 hours to talk before the reveal
- **The reveal** — identities open up and a set of questions unlocks
- **Real-time messaging** — DMs that stay in sync as you chat
- **Social layer** — followers, friend requests, blocking
- **Streaks & profiles** — daily streaks and an editable account
- **Push notifications**
- **Moderation** — a reporting flow plus an admin screen, backed by a Cloud Function

## The interesting parts

The three things I spent the most time on: keeping messages in sync in real time, managing the three-day session as state (trickier than it sounds once you account for reconnects and the reveal transition), and the matching logic underneath it all.

## Built with

React Native · TypeScript · Expo · Firebase (Auth, Firestore, Cloud Functions, Storage)

One codebase ships to iOS, Android, and the web via Expo Router and Expo for Web.

## Running it locally

You'll need Node 18+, a Firebase project, and either Expo Go on your phone or a simulator.

```bash
npm install
npx expo start
```

Then open it wherever you like:

```bash
npm run ios      # iOS
npm run android  # Android
npm run web      # web
```

Firebase config lives in `src/firebaseConfig.ts`. Cloud Functions, Firestore rules, and Storage rules deploy with the Firebase CLI:

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
```

## Layout

```
app/         Screens (tabs, the match flow, DMs, profile, admin)
components/  Shared UI
src/
  hooks/     Match, notification, and daily-question hooks
  utils/     Moderation, notifications, storage, translation
  theme/     Theming
functions/   Cloud Functions (moderation)
```
