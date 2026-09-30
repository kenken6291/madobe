# まどべ — 設計とセットアップ手順

```
madobe/                  ← GitHub リポジトリ（GitHub Pages）
├── index.html
├── style.css
├── config.js            ← GASのURLだけを書くファイル
├── script.js
└── gas/Code.gs          ← Apps Script エディタに貼り付け（Pagesには不要）
```

---

## 1. スプレッドシート設計

`setup()` を実行すると、下記2シートが見出し付きで自動作成されます。

### Users（会員）

| 列 | 項目 | 内容 |
|---|---|---|
| A | userId | UUID |
| B | email | 小文字化して保存（ログインID） |
| C | name | 呼んでほしい名前 |
| D | passwordHash | SHA-256 × 300回（salt＋pepper） |
| E | salt | ユーザーごとのUUID |
| F | isFirstLogin | TRUE＝仮パスワード状態（チャット・設定不可） |
| G | companionName | 話し相手の名前 |
| H | avatarCategory | pet / person / anime |
| I | avatarPreset | dog / cat / person_f / person_m / anime_g / anime_b / custom |
| J | avatarImageUrl | 写真の公開URL（lh3.googleusercontent.com） |
| K | avatarImageId | DriveファイルID（差し替え時に旧画像をゴミ箱へ） |
| L | avatarConfig | JSON：目・口の位置(%)、まぶた色、眉の有無、表情ごとの個別位置（perEmotion） |
| M | failedCount | 連続ログイン失敗回数 |
| N | lockedUntil | 5回失敗で15分ロック |
| O | createdAt | 登録日時 |
| P | lastLoginAt | 最終ログイン |
| Q | avatarImages | 表情ごとの写真 JSON：neutral / joy / sad / surprised / blink（瞬き）/ talk（しゃべり）の URL と DriveファイルID（既存シートには自動で列を追加） |

### History（会話履歴）

| 列 | 項目 | 内容 |
|---|---|---|
| A | timestamp | 日時 |
| B | userId | Users.userId |
| C | role | user / model |
| D | text | 本文 |
| E | emotion | joy / neutral / sad / surprised（model のみ） |

セッションはシートではなく **CacheService**（6時間・アクセスごとに延長）で管理します。

---

## 2. GAS の準備

1. 新しい Google スプレッドシートを作成（名前は「まどべDB」など）
2. **拡張機能 → Apps Script** を開き、`Code.gs` の中身を全部置き換えて保存
3. Google Drive に画像保存用フォルダ（例：`まどべ_avatars`）を作り、URL の `folders/` の後ろの文字列（フォルダID）を控える
4. Apps Script の **プロジェクトの設定（歯車）→ スクリプト プロパティ** に追加

| プロパティ | 値 | 必須 |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio で発行したキー | ✅ |
| `DRIVE_FOLDER_ID` | 手順3のフォルダID | ✅ |
| `PASSWORD_PEPPER` | 空でOK（setup() が自動生成） | 自動 |
| `APP_URL` | `https://kenken6291.github.io/madobe/` | 任意（メールに記載） |
| `GEMINI_MODEL` | 既定 `gemini-2.5-flash`。変える場合のみ | 任意 |

5. エディタで関数 **`setup`** を選んで実行 → 権限を承認（スプレッドシート・Drive・メール送信・外部接続）
6. 関数 **`testGemini`** を実行し、ログに `{"reply":…,"emotion":…}` が出れば Gemini 接続OK

> ⚠️ `PASSWORD_PEPPER` は会員登録後に変更しないでください（全員ログイン不可になります）。

---

## 3. ウェブアプリとしてデプロイ

1. **デプロイ → 新しいデプロイ → 種類：ウェブアプリ**
2. 次のユーザーとして実行：**自分**／アクセスできるユーザー：**全員**
3. 表示された `https://script.google.com/macros/s/…/exec` をコピー
4. `config.js` の `GAS_URL` に貼り付け（script.js を差し替えてもURLは消えません）

> 🔁 **Code.gs を直したら、必ず「デプロイを管理 → 鉛筆 → バージョン：新しいバージョン → デプロイ」**。保存だけでは反映されません（URLはそのまま使えます）。

---

## 4. GitHub Pages に公開

1. リポジトリ `madobe` を作成し、`index.html` / `style.css` / `config.js` / `script.js` を push
2. **Settings → Pages → Branch: main / (root)** で公開
3. `https://kenken6291.github.io/madobe/` を開いて動作確認

---

## 5. 動作確認チェックリスト

- [ ] 「はじめて使う」で登録 → 仮パスワードのメールが届く
- [ ] 仮パスワードでログイン → パスワード設定画面が出て、閉じられない
- [ ] 新パスワード設定後、あいさつが表示され、アバターが笑顔になる
- [ ] 目のアイコンでパスワードの表示／非表示が切り替わる
- [ ] 話しかけると、返事に合わせて表情・背景の灯りの色・口パクが変わる
- [ ] 人のアイコン → 写真を選ぶ → 目・目・口の順にタップ → 「表情を試す」でまばたき・口パクを確認 → 保存
- [ ] 再読み込みしてもログイン状態と会話が残っている
- [ ] 5回パスワードを間違えると15分ロックされる

---

## 6. メモ・注意点

- **メール送信上限**：無料 Gmail は1日100通（MailApp）。
- **写真の公開範囲**：アップロード画像は「リンクを知っている全員が閲覧可」になります。Google Workspace アカウントで組織外共有が禁止されている場合は表示されません（個人の Gmail アカウント推奨）。
- **写真の表示**：`lh3.googleusercontent.com/d/ID` で表示し、失敗時は `drive.google.com/thumbnail` に自動で切り替えます。
- **表情ごとの写真**：「普通の顔」「笑顔」「困り顔」「驚き顔」を登録でき、返事の感情に合わせて写真がふわっと切り替わります。登録していない表情は、普通の顔の色味・まぶた・眉で表現します。同じ構図で撮れば「目と口の位置は普通の顔と同じ」のままでOK、ずれる場合はその表情だけ位置を指定できます。
- **瞬き・しゃべり写真**：普通の顔の「目を閉じた写真」「口を開けた写真」を登録すると、まばたきは目を閉じた写真に一瞬切り替え、話している間は口の開き具合に合わせて普通の顔と口を開けた写真を交互に表示します（普通の顔を表示しているときに使用）。
- **写真アバターの仕組み**：写真を512px正方形に切り抜き、タップした目・口の位置に「まぶた（肌色を自動取得・手動調整可）」「口の開き」「眉（任意）」を重ねて、まばたき・口パク・表情を出します。写真全体の明るさ・彩度・傾きも表情に合わせて変わります。
- **声**：返事は標準で読み上げます。声の種類・速さ・高さは「設定 → 声」でキャラクターごとに選べます（端末に入っている声から選択。Edge では自然な声が多く使えます）。
- **聞き取りモード**：ヘッダーの「聞き取り」をオンにすると、返事のあと自動でマイクが聞き取りを始め、話し終わると自動で送信します。読み上げ中は自分の声を拾わないよう聞き取りを止めています。Chrome / Edge 推奨。
- **全画面**：「全画面」でキャラクターを大きく表示。「設定 → 表示と会話」で字幕の有無・入力欄の非表示・ブラウザ全画面を切り替えられます。話している途中でキャラクターをタップすると止まります。
- **安全面**：AIであることを聞かれたら正直に答える／深刻な悩みには相談窓口（よりそいホットライン・いのちの電話）を案内する、という指示をシステムプロンプトに入れています。
- **Gemini モデル**：モデル名が廃止・変更された場合は `GEMINI_MODEL` プロパティだけ差し替えればOKです。
