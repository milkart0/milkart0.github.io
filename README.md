# 日常行事曆

繁體中文行事曆 Web App，支援月／週檢視、行程新增編輯刪除、分類、備註、訪客本機儲存，以及 Firebase Google 登入與 Firestore 個人雲端同步。

## 本機使用

用 localhost 或 HTTPS 開啟；不要直接雙擊 `index.html`，因為瀏覽器會限制 JavaScript modules。Windows 可執行：

```sh
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

接著開啟 `http://localhost:5173/`。按 Ctrl+C 停止伺服器。尚未設定 Firebase 時，行事曆仍可在訪客模式使用，資料留在目前瀏覽器。

## 啟用 Firebase 登入和雲端同步

1. 在 Firebase Console 建立專案，新增 Web App。
2. 到 **Authentication → Sign-in method** 啟用 **Google** 登入。若要使用 LINE，需先在 Firebase Authentication 建立 LINE 的 OpenID Connect（OIDC）Provider，並確認 `firebase-config.js` 的 `lineProviderId` 與 Provider ID 相同；LINE Client ID 和 Secret 請只填在 Firebase Console。
3. 到 **Firestore Database** 建立資料庫。
4. 將本專案的 `firestore.rules` 發佈到 Firestore Rules。
5. 到 **Project settings → General → Your apps** 複製 Web App 的 `firebaseConfig`，填入 `firebase-config.js` 的對應欄位。
6. 在 **Authentication → Settings → Authorized domains** 加入 `localhost` 和正式網站網域。
7. 重新開啟網站並登入。訪客行程會在該使用者的雲端行程集合為空時搬到 Firestore；其後登入會載入雲端資料。

資料位置為 `users/{Firebase UID}/events/{event ID}`。Firestore 規則限制只有登入者本人能讀寫自己的行程，並檢查行程欄位。前端 Firebase Web 設定不是服務帳戶私鑰；切勿將 Service Account JSON、私人 API 金鑰或使用者 token 放入 Repository。

## 發佈到 GitHub Pages

1. 將此資料夾內容推送到 GitHub Repository 的 `main` 分支。
2. 在 Repository **Settings → Pages → Build and deployment**，將 Source 設為 **GitHub Actions**。
3. `.github/workflows/deploy.yml` 會在推送到 `main` 後部署網站；完成後網址會出現在 Actions 的部署工作紀錄。
4. 把 `username.github.io` 網域（以你的 GitHub 使用者名稱為準）加進 Firebase Authentication 的 Authorized domains。

這是純靜態網站，不需要建置伺服器。Firebase Authentication 與 Firestore 直接由瀏覽器呼叫；資料權限由 `firestore.rules` 控制。

## 功能

- 月曆、週曆、快速選日、回到今天。
- 新增、編輯和刪除行程；欄位包含標題、日期、時間、分類和備註。
- 手機與桌面版版面、近期行程和分類統計。
- 訪客本機儲存；Firebase Google 登入與 Firestore 即時同步。

## AI 行程助理

目前版本不呼叫 AI API。若要加入 AI 建議，應由受控的後端或 Cloud Function 代為呼叫模型服務，並把服務金鑰保存在伺服器端；不能將秘密金鑰放進 `app.js` 或 GitHub Pages。
