# Garoon2Google

Garoonの予定を正として、Google Calendarへ予定を同期するNode.jsプログラムです。

実装に沿った詳細仕様は [doc/specification.md](doc/specification.md) を参照してください。

## 動作概要

実行時点から約3か月後までのGaroonの予定を取得し、GaroonのイベントIDでGoogle Calendarの予定と対応付けます。

- Google Calendarに同じ予定がなければ追加します
- 同じ予定があれば更新します
- Garoonの繰り返し予定は、Google Calendarの繰り返し予定として登録します
- Garoonで削除された、このプログラムが作成した予定はGoogle Calendarから削除します

同期先のGoogle Calendarを変更するため、初回はテスト用のアカウントやカレンダーで動作を確認してください。Garoon以外で作成したGoogle Calendarの予定は削除しません。

Garoonで設定された毎日、週次、2週間ごと、3週間ごと、平日、月内の第1・第2・第3・第4・最終曜日、月日指定の月次繰り返しと、設定された除外日を反映します。繰り返し対応前に作成された単発のGoogle Calendar予定は、自動的には1つの繰り返し予定へ統合されません。不要な単発予定が残っている場合は、内容を確認してから手動で削除してください。

Garoonの年次など、ここに記載されていない繰り返し形式は、Garoon APIの `repeatInfo` の形式を確認したうえで対応します。形式が未対応のままGoogle Calendarへ誤った繰り返し予定を登録することはありません。

## 事前に用意するもの

- Windows PC
- Node.jsのLTS版
- GaroonのAPI URL、認証情報、対象ユーザーID
- Googleアカウント
- 同期先のGoogle Calendar
- Google Cloudプロジェクトを作成できる権限

## 1. Node.jsをインストールする

1. [Node.js公式サイト](https://nodejs.org/)を開き、LTS版をダウンロードします。
2. ダウンロードしたインストーラーを実行します。
3. 基本的には初期設定のままインストールします。
4. 新しいPowerShellを開き、次のコマンドを実行します。

```powershell
node --version
npm --version
```

両方ともバージョン番号が表示されれば、インストール完了です。

## 2. プロジェクトを準備する

PowerShellで、このプロジェクトのフォルダーへ移動します。パスは実際の保存場所に置き換えてください。

```powershell
cd C:\path\to\shareCalendar
```

依存パッケージをインストールします。

```powershell
npm ci
```

`npm ci` は `package-lock.json` に記録されたバージョンでパッケージをインストールします。

## 3. Google Calendar APIを設定する

### 3-1. Google Cloudプロジェクトを作成する

1. [Google Cloud Console](https://console.cloud.google.com/)にログインします。
2. プロジェクト選択画面から「新しいプロジェクト」を選択します。
3. プロジェクト名を入力して作成します。
4. 作成したプロジェクトを選択します。

### 3-2. Google Calendar APIを有効にする

1. 「APIとサービス」から「ライブラリ」を開きます。
2. `Google Calendar API` を検索します。
3. 対象APIを開き、「有効にする」を選択します。

### 3-3. OAuth同意画面を設定する

初めて設定する場合は、OAuth同意画面を設定します。画面の名称や表示項目はGoogle Cloud Consoleの更新で変わる場合があります。

1. 「APIとサービス」から「OAuth同意画面」を開きます。
2. 利用者の種類を組織の設定に合わせて選択します。
3. アプリ名、連絡先メールアドレスなどの必須項目を入力します。
4. Google Calendarへのアクセスを許可するスコープを設定します。
5. アプリがテスト中の場合は、利用するGoogleアカウントをテストユーザーに追加します。

### 3-4. OAuth認証情報を作成する

1. 「APIとサービス」から「認証情報」を開きます。
2. 「認証情報を作成」から「OAuthクライアントID」を選択します。
3. アプリケーションの種類は「デスクトップアプリ」を選択します。
4. 作成後、JSON形式の認証情報をダウンロードします。
5. ダウンロードしたJSONを `lib/credentials.json` という名前で保存します。

`lib/credentials.example.json` はJSONの構造を確認するためのサンプルです。実際の認証情報をGitHubへコミットしたり、サンプルファイルへ保存したりしないでください。

## 4. 設定ファイルを作成する

サンプルから実環境用の設定ファイルを作成します。

```powershell
Copy-Item config.example.json config.json
```

`config.json` をテキストエディターで開き、次の項目を実際の値に変更します。

| 項目 | 設定する内容 |
| --- | --- |
| `garoon.apiUrl` | Garoonの予定API URL |
| `garoon.auth` | Garoon APIで使用する認証値 |
| `garoon.user.name` | Garoonの対象ユーザー名 |
| `garoon.user.id` | Garoonの対象ユーザーID |
| `google.credentialsPath` | Google認証情報JSONへのパス。通常は変更不要 |
| `google.calendarId` | 同期先Google CalendarのカレンダーID |
| `sync.mode` | 同期動作モード |

`google.calendarId` はGoogle Calendarの「設定と共有」で対象カレンダーを開き、「カレンダーの統合」にある「カレンダーID」から確認できます。

`garoon.auth` はGaroon環境の管理者または担当者から指定された値を使用してください。認証値の作り方や必要な権限は環境によって異なるため、推測して変更しないでください。

## 5. 初回実行とGoogle認証

プロジェクトのフォルダーで次のコマンドを実行します。

```powershell
node main.js
```

初回実行時は、コンソールにGoogleの認証URLが表示されます。

1. 表示されたURLをブラウザーで開きます。
2. Googleアカウントを選択します。
3. カレンダーへのアクセスを許可します。
4. 表示された認証コードをPowerShellへ貼り付けてEnterキーを押します。

認証に成功すると `token.json` が作成されます。次回以降は保存済みのトークンが使われるため、通常は再認証不要です。

認証エラーが発生した場合は、次のコマンドで保存済みトークンを削除してから再実行できます。別の実行担当者が使っていないことを確認してから実行してください。

```powershell
Remove-Item token.json
node main.js
```

## 6. 2回目以降の実行

PowerShellから実行する場合:

```powershell
node main.js
```

Windowsのエクスプローラーから実行する場合は `execute.vbs` をダブルクリックします。コマンド画面を表示せずに同期が実行されます。実行結果は `logs` フォルダーのログで確認してください。

## 実行結果の見方

- `Event added in Google Calendar`: Google Calendarへ新規追加
- `Event updated in Google Calendar`: Google Calendarの既存予定を更新
- `Garoon events fetched successfully`: Garoonからの取得成功
- `Google Calendar events fetched successfully`: Google Calendarからの取得成功
- `Event unchanged in Google Calendar`: GaroonとGoogle Calendarの内容が同じため更新なし
- `Error:`: 処理全体を継続できないエラー
- `Failed to add/update event in Google Calendar:`: 個別予定の処理に失敗。ほかの予定の処理は継続する場合があります
- `Synchronization completed with errors`: 一部の同期または削除に失敗。ログを確認してください

ログはコンソールに表示され、プロジェクト内の `logs` フォルダーに実行ごとの `run-YYYY-MM-DDTHH-mm-ss-SSS-<プロセスID>.log` というJSONファイルとして保存されます。7日より古い実行ログは、`main.js` 実行時に削除されます。

## トラブルシューティング

### `node` または `npm` が認識されない

Node.jsをインストールした後に開いた新しいPowerShellで再実行してください。それでも解決しない場合は、Node.jsを再インストールしてPATHへの追加を有効にします。

### `Cannot find module` が表示される

プロジェクトのフォルダーで次のコマンドを実行してください。

```powershell
npm ci
```

### Googleの認証画面でアクセスが拒否される

次を確認してください。

- Google Calendar APIが有効になっている
- OAuth同意画面が設定されている
- ログインしたGoogleアカウントがテストユーザーに追加されている
- `lib/credentials.json` がGoogle CloudからダウンロードしたJSONである

### Garoon APIへの接続に失敗する

`config.json` の `garoon.apiUrl`、`garoon.auth`、`garoon.user.id` を確認してください。社内ネットワークやVPNが必要な環境では、Garoonへアクセスできるネットワークから実行してください。

### 予定が追加・更新されない

Garoon側の予定が同期期間内か、対象ユーザーの `garoon.user.id` が正しいか、Google Calendarの `google.calendarId` が正しいかを確認してください。Google Calendarの予定は複数ページに分けて取得されます。

## 開発者向けのテスト

実際のCalendarを変更せずに、イベント変換処理のテストを実行できます。

```powershell
npm test
```

すべてのテストが成功すると、`pass` の件数が表示されます。

## mainブランチの保存とプッシュ

`scripts/save-and-push.js` は、テストと差分チェックを実行してから、変更をコミットして `main` ブランチをoriginへプッシュする補助スクリプトです。`main` 以外のブランチからは実行できません。

```powershell
npm run save-and-push
```

ブランチ作業中は使用せず、`main` へ統合済みの変更を公開する場合だけ実行してください。

## コード構成

| ファイル | 役割 |
| --- | --- |
| `main.js` | 同期全体の流れ、差分判定、削除判定、終了コードの管理 |
| `lib/garoon.js` | Garoon APIからの予定取得 |
| `lib/googleCalendar.js` | Google OAuthとGoogle Calendar API操作 |
| `lib/eventConverter.js` | GaroonイベントからGoogleイベントへの変換、RRULE、UID生成 |
| `lib/config.js` | `config.json` の読み込み |
| `logger.js` | コンソール出力、実行単位ログ、古いログの削除 |
| `test/eventConverter.test.js` | イベント変換、UID、削除判定、差分判定の回帰テスト |

主要な関数にはJSDoc形式の日本語コメントがあります。引数、戻り値、例外などの設計意図を確認するときは、対象関数の直前にあるコメントを参照してください。

## 秘密情報について

次のファイルは秘密情報を含むため、Git管理から除外されています。

- `config.json`
- `lib/credentials.json`
- `token.json`

これらをGitHub、チャット、Issue、ログなどへ貼り付けないでください。認証情報を誤って公開した場合は、Google Cloud ConsoleでOAuth認証情報を無効化または再発行し、Garoonの認証情報も管理者へ相談してください。
