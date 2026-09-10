/**
 * Seeds the `devices` collection with test sound traps in Ile-Alatau
 * National Park, south of Almaty.
 *
 *   npm run seed
 *
 * Uses the client SDK and the NEXT_PUBLIC_FIREBASE_* keys from .env.local,
 * so your Firestore rules must allow writes to `devices` while seeding.
 */

import { config } from "dotenv";
import { initializeApp } from "firebase/app";
import { doc, getFirestore, Timestamp, writeBatch } from "firebase/firestore";

config({ path: ".env.local" });
config({ path: ".env" });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length) {
  console.error(
    "\n  Missing Firebase config. Fill these in .env.local:\n" +
      missing.map((key) => `    NEXT_PUBLIC_FIREBASE_${camelToEnv(key)}`).join("\n") +
      "\n",
  );
  process.exit(1);
}

function camelToEnv(key) {
  return key.replace(/([A-Z])/g, "_$1").toUpperCase();
}

const minutesAgo = (minutes) =>
  Timestamp.fromMillis(Date.now() - minutes * 60 * 1000);

// Real locations inside / around Ile-Alatau National Park.
const DEVICES = [
  {
    id: "QRG-001",
    name: "Большое Алматинское ущелье",
    lat: 43.0561,
    lng: 76.9848,
    status: "alert",
    lastSignal: minutesAgo(2),
    soundType: "Бензопила",
    audioUrl: "/audio/chainsaw-demo.wav",
    battery: 78,
    classification: { animal: 3, dog: 2, vehicle: 9, chainsaw: 82, gunshot: 1, other: 3 },
  },
  {
    id: "QRG-002",
    name: "Медеу, гребень",
    lat: 43.1571,
    lng: 77.0574,
    status: "normal",
    lastSignal: minutesAgo(6),
    soundType: null,
    audioUrl: null,
    battery: 92,
    classification: { animal: 68, dog: 4, vehicle: 6, chainsaw: 2, gunshot: 1, other: 19 },
  },
  {
    id: "QRG-003",
    name: "Долина Кимасар",
    lat: 43.1348,
    lng: 77.0812,
    status: "normal",
    lastSignal: minutesAgo(14),
    soundType: null,
    audioUrl: null,
    battery: 64,
    classification: { animal: 60, dog: 5, vehicle: 11, chainsaw: 3, gunshot: 1, other: 20 },
  },
  {
    id: "QRG-004",
    name: "Бутаковский водопад",
    lat: 43.1689,
    lng: 77.1204,
    status: "alert",
    lastSignal: minutesAgo(37),
    soundType: "Выстрел",
    audioUrl: "/audio/gunshot-demo.wav",
    battery: 41,
    classification: { animal: 5, dog: 3, vehicle: 12, chainsaw: 3, gunshot: 74, other: 3 },
  },
  {
    id: "QRG-005",
    name: "Плато Кок-Жайляу",
    lat: 43.1402,
    lng: 77.0208,
    status: "normal",
    lastSignal: minutesAgo(3),
    soundType: null,
    audioUrl: null,
    battery: 88,
    classification: { animal: 52, dog: 6, vehicle: 18, chainsaw: 2, gunshot: 1, other: 21 },
  },
  {
    id: "QRG-006",
    name: "Проходное ущелье",
    lat: 43.0912,
    lng: 76.8931,
    status: "normal",
    lastSignal: minutesAgo(52),
    soundType: null,
    audioUrl: null,
    battery: 17,
    classification: { animal: 45, dog: 7, vehicle: 9, chainsaw: 2, gunshot: 1, other: 36 },
  },
];

/**
 * The Firestore client retries transport failures forever rather than
 * rejecting, so a missing database or a blocking rule looks like a hang.
 * Race the commit against a deadline to turn that into a real error.
 */
function withTimeout(promise, ms) {
  const deadline = new Promise((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          [
            "timed out talking to Firestore.",
            "",
            "  Most likely one of:",
            `    - Project "${firebaseConfig.projectId}" has no Firestore database yet.`,
            "      Create one in the Firebase console: Build > Firestore Database > Create database",
            '    - Security rules block writes to "devices".',
            "    - No network route to firestore.googleapis.com.",
          ].join("\n"),
        ),
      );
    }, ms);
  });

  return Promise.race([promise, deadline]);
}

async function seed() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const batch = writeBatch(db);

  for (const device of DEVICES) {
    batch.set(doc(db, "devices", device.id), device);
  }

  await withTimeout(batch.commit(), 20_000);

  console.log(`\n  Seeded ${DEVICES.length} devices into "devices":\n`);
  for (const device of DEVICES) {
    console.log(
      `    ${device.id}  ${device.name.padEnd(22)} ${device.status}`,
    );
  }
  console.log("");
  process.exit(0);
}

seed().catch((error) => {
  console.error("\n  Seed failed:", error.message, "\n");
  process.exit(1);
});
