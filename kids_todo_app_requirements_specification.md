# 家族向け子供用TODO Webアプリケーション 要件定義書・実装仕様書

## 1. システム概要
本システムは、小学生低学年のお子様たちが専用タブレットで日々のTODOを一覧で確認・チェックし、保護者がスマートフォン等の別端末からリモートでタスク設定や最終確認（おやチェック）を行えるリアルタイムWebアプリケーションである。

---

## 2. 画面・アーキテクチャ構成

### 2.1 ネットワーク & サーバー構成
* **Web サーバー:** Apache2 (リバースプロキシ設定・HTTPS/SSL終端)
* **アプリケーションサーバー:** Node.js + Express
* **リアルタイム通信:** Socket.io
* **データベース:** SQLite3 (ファイルベース DB `todo.db`)
* **アクセス制御:** 
  * 認証機能（ID/PW）は設けない。
  * **シークレットURL方式**により親用管理画面のセキュリティを確保。

### 2.2 画面分離設計
1. **子供用TODO画面（タブレット設置専用）**
   * URL例: `https://your-domain.com/kids/`
   * 設定・編集・リロード等の管理要素を排除した表示＋タップ専用UI。
2. **親用管理画面（保護者スマホ・PC専用）**
   * URL例: `https://your-domain.com/admin-a8f3k9x2/` (ランダム文字列パス)
   * タスクの作成・編集・削除、曜日指定リピート管理、当日限定の例外処理（追加/お休み）、親チェック（確認スタンプ）の入力を行う。

---

## 3. UI/UX 機能仕様

### 3.1 子供用TODO画面仕様（一覧表・マトリクス形式）
* **全員まとめて一覧表示:**
  * 添付デザインをベースとしたテーブル（マトリクス）形式。
  * **列構成:** 「やること」 | 「こども1 チェック」 | 「こども2 チェック」 | 「おやチェック」
  * 低学年でも読みやすいフォント、猫・足あとスタンプアイコンを採用。
* **スタンプ入力:**
  * 子供が自分の列の肉球マークをタップすると、猫顔スタンプ（完了状態）に切り替わり、ポンという効果音を再生。
* **打ち上げ花火エフェクト（重要条件）:**
  * **【発動条件】「おやチェック」が本日の全タスク分すべて完了（100%）した瞬間。**
  * 親が自分のスマホで最後の「おやチェック」を入れた際、リアルタイム通信でタブレット画面全体に美しい打ち上げ花火アニメーション（Canvas / `canvas-confetti`）が自動で打ち上がり、ハナマル完了モーダルを表示する。
* **リアルタイム自動同期:**
  * 子供の操作、および親のスマホ操作（タスク変更・おやチェック）が Socket.io 経由で即座に双方向反映される。

### 3.2 親用管理画面仕様
* **マスタースケジュール管理:**
  * タスクの新規登録・編集・削除。
  * リピート設定（「毎日」「指定曜日」「単発」）。
* **日別例外カスタマイズ (当日調整ビュー):**
  * 「今日だけ単発で手伝いを追加」
  * 「今日だけ習い事タスクを非表示（お休み）」
* **おやチェック（最終確認）操作:**
  * 子供たちの達成状況を見ながら、スマホ上から1タップで「おやチェック」を入力。全タスクに親チェックがついた時点でタブレット側に花火が打ち上がる。

---

## 4. データベース設計 (SQLite3)

### テーブル構成

#### 1. `children`（子供マスタ）
```sql
CREATE TABLE children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT '😸',
    display_order INTEGER DEFAULT 0
);
```

#### 2. `tasks`（タスク基本定義）
```sql
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'せいかつ',
    repeat_type TEXT DEFAULT 'daily', -- 'daily', 'weekly', 'single'
    repeat_days TEXT, -- JSON文字列 例: "[1, 3, 5]" (月水金)
    active INTEGER DEFAULT 1
);
```

#### 3. `task_logs`（日々の完了実績 & チェックログ）
```sql
CREATE TABLE task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    date TEXT NOT NULL, -- 'YYYY-MM-DD'
    child1_checked INTEGER DEFAULT 0, -- 1: こども1完了
    child2_checked INTEGER DEFAULT 0, -- 1: こども2完了
    parent_checked INTEGER DEFAULT 0, -- 1: 親確認完了 (全員達成条件)
    is_skipped INTEGER DEFAULT 0, -- 1: 今日だけお休み
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    UNIQUE(task_id, date)
);
```

---

## 5. 通信仕様 (Socket.io イベント)

| イベント名 | 送信元 | 引数 / ペイロード | 説明 |
| :--- | :--- | :--- | :--- |
| `task:toggle_child` | Client (Kids) | `{ taskId, date, childId, status }` | 子供が自分のチェックを入れた/外した |
| `task:toggle_parent` | Client (Admin)| `{ taskId, date, status }` | 親が確認チェックを入れた/外した |
| `task:update_schedule`| Client (Admin)| `{ taskData }` | タスクの追加・編集・例外設定 |
| `task:sync` | Server | `{ tasksData, allParentChecked }` | 最新状態を全クライアントへ配信。`allParentChecked`がtrueになった瞬間に花火発動 |

---

## 6. 技術スタック & 推奨ディレクトリ構造

### 技術スタック
* **Frontend:** HTML5, CSS3 (Tailwind CSS CDN / Plain CSS), JavaScript (Vanilla JS)
* **Backend:** Node.js (v18+), Express, Socket.io
* **Database:** SQLite3 (`sqlite3` / `better-sqlite3`)
* **Process Manager:** PM2 (VPS自動起動用)

### ディレクトリ構造
```text
/var/www/todo-app/
├── package.json
├── server.js               # Express + Socket.io + SQLiteロジック
├── db.js                   # SQLite接続・初期化スクリプト
├── todo.db                 # データベースファイル
└── public/
    ├── kids/
    │   └── index.html      # 子供用TODO画面（一覧表マトリクス形式）
    ├── admin-a8f3k9x2/
    │   └── index.html      # 親用管理画面（おやチェック・タスク編集）
    ├── css/
    └── js/
```

---

## 7. Apache2 設定例 (`/etc/apache2/sites-available/todo.conf`)

```apache
<VirtualHost *:443>
    ServerName your-domain.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/your-domain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem

    DocumentRoot /var/www/todo-app/public

    # 1. 子供用画面エントリーポイント
    <Directory "/var/www/todo-app/public/kids">
        DirectoryIndex index.html
    </Directory>

    # 2. WebSocket/Socket.io リバースプロキシ
    ProxyPass /socket.io/ ws://localhost:3000/socket.io/
    ProxyPassReverse /socket.io/ ws://localhost:3000/socket.io/

    # 3. REST API リバースプロキシ
    ProxyPass /api/ http://localhost:3000/api/
    ProxyPassReverse /api/ http://localhost:3000/api/
</VirtualHost>
```

---

## 8. AIエージェントへの実装指示（プロンプト用指示文）

> **AI実装プロンプト案:**
> 上記の要件定義書に従い、Node.js + Express + Socket.io + SQLite3 による家族向けTODO Webアプリの `server.js` および `public/kids/index.html`（一覧表形式・花火演出付き）、`public/admin-a8f3k9x2/index.html`（親用管理・おやチェック画面）のフルコードを生成してください。親チェックが全て完了したタイミングでタブレット側に花火が打ち上がるロジックをSocket.ioで実装してください。