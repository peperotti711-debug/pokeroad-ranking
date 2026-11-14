// ローカルの管理者PCだけで実行。秘密鍵をGitHubにアップロードしないこと。
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const [uid, keyPath] = process.argv.slice(2);
if (!uid || !keyPath) { console.error('使い方: node set-admin.mjs <UID> <秘密鍵JSONのパス>'); process.exit(1); }
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({credential: cert(key)});
const auth = getAuth();
const user = await auth.getUser(uid);
if (user.customClaims?.admin === true) { console.log('すでに運営権限が付いています'); process.exit(0); }
await auth.setCustomUserClaims(uid, {...(user.customClaims || {}), admin: true});
console.log('運営権限を付与しました。ログアウトして再ログインしてください。');
