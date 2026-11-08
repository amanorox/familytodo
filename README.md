# FamilyTodo

家族で共有する子ども用TODOアプリです。子ども用タブレットと親用スマートフォンの状態を Socket.IO で同期し、タスク・完了チェックを SQLite に保存します。

## 必要な環境

- Node.js 18.12 以上
- npm
- 本番公開時は HTTPS リバースプロキシ（Apache など）

日付の区切りは既定で日本時間です。必要に応じてサーバーの `TZ` 環境変数で変更できます。
Node.js は既定で `127.0.0.1` のみで待ち受けます。Apache と同じホスト上で動かす場合はこのままにし、外部ネットワークへ直接公開しないでください。

```powershell
npm install
npm start
```

起動すると、子ども画面 `http://localhost:3000/kids/` と親用URLがコンソールに表示されます。親用URLはシークレットURLです。`ADMIN_PATH` を指定しない場合、起動ごとに暗号学的乱数で生成されるため、再起動後も同じURLを使う場合は固定値を環境変数に設定してください。

```powershell
$env:ADMIN_PATH = "admin-a8f3k9x2"
$env:PORT = "3000"
$env:HOST = "127.0.0.1"
$env:DB_PATH = "data/todo.db"
npm start
```

`ADMIN_PATH` は `admin-` の後に8文字以上の英数字・`_`・`-` を設定してください。固定値は十分に長く推測困難なものを選び、URLを家族以外に共有しないでください。親画面を開くと HttpOnly / SameSite=Strict Cookie が発行され、親用の API と Socket.IO 操作に使われます。パスワード認証はありません。公開時は必ず HTTPS を使ってください。

## 保存データと初回移行

- SQLite ファイルの既定値は `data/todo.db` です。`DB_PATH` で変更できます。
- 初回起動時、DB にタスクがまだない場合だけ、既存の `todo.txt` を一度取り込みます。曜日キーワード（`SUN`〜`SAT`）も曜日リピートとして引き継ぎます。
- 以降のタスク編集は親用画面から DB に保存します。`todo.txt` は初回取り込み用の元データとして残ります。
- `task_logs` に日付ごとの子どもチェック、おやチェック、お休みを保存します。バックアップ時はアプリを停止して DB ファイルをコピーしてください。WAL モード利用時は `todo.db-wal` / `todo.db-shm` も含めてください。
- 子どもの初期名は「こども1」「こども2」です。親用画面から変更できます。

## 機能

- 子ども画面: 全タスクを一覧表で表示。子どもスタンプとおやチェックをタップすると共有 DB に保存し、他端末に即時反映します。
- 親画面: タスクの追加・編集・削除、ドラッグまたは上下ボタンでの並び替え、毎日・曜日指定・単発の日程設定、子どもの達成状況確認を行います。並び順は子ども画面にも反映されます。おやチェックの操作は子ども画面から行います。
- 当日例外: 親画面から今日だけのタスクを追加したり、今日の定期タスクをお休みにできます。お休み中のタスクは子ども画面・達成率から除外されます。
- 花火: 今日の対象タスクが1件以上あり、親チェックが未完了から全件完了に変わった瞬間、接続中の子ども画面で花火と「はなまる」モーダルを表示します。ページ再読み込み時や対象タスクが0件のときには発火しません。

## Apache2 リバースプロキシ例

Node.js の Express が画面・API・Socket.IO を配信します。Apache から HTTPS を終端し、すべてのアプリパスを Node.js に転送してください。`mod_proxy`、`mod_proxy_http`、`mod_headers`、`mod_ssl` を有効にし、Apache 2.4.47 以降では `upgrade=websocket` を利用できます。

```apache
<VirtualHost *:443>
    ServerName your-domain.com
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/your-domain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass        /socket.io/ http://127.0.0.1:3000/socket.io/ upgrade=websocket
    ProxyPassReverse /socket.io/ http://127.0.0.1:3000/socket.io/
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

Socket.IO と通常 HTTP の両方をプロキシしてください。Apache の設定後は HTTPS の `/kids/` と親用URLを別端末で開き、子ども画面でおやチェックした状態が親画面にも反映されることを確認します。

### PM2 で起動する場合

```powershell
npm install --global pm2
$env:ADMIN_PATH = "admin-7f2c9b6e4a1d8c03"
pm2 start server.js --name familytodo
pm2 save
```

PM2 の環境変数は起動ユーザーの設定に合わせて永続化してください。`ADMIN_PATH` を固定しない場合、プロセス再起動のたびに親用URLが変わります。

## 開発・テスト

```powershell
npm test
```

親用URLに認証機能はありません。URLを知る人は親画面を開けるため、シークレットURLを認証情報として扱い、HTTPS・アクセス制限のあるネットワークで運用してください。
