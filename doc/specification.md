# Garoon2Google 詳細仕様書

- 対象: Garoonの予定をGoogle Calendarへ同期するNode.jsアプリケーション
- 基準実装: `main.js`、`lib/garoon.js`、`lib/eventConverter.js`、`lib/googleCalendar.js`
- 更新日: 2026-09-16

## 1. Garoonイベントの取得

`lib/garoon.js` はGaroon APIへ次の条件でGETリクエストを送る。

| パラメーター | 値 |
| --- | --- |
| `limit` | `200` |
| `rangeStart` | 実行時刻のISO 8601文字列 |
| `rangeEnd` | 実行時刻の約3か月後のISO 8601文字列 |
| `target` | `config.garoon.user.id` |
| `targetType` | `user` |
| `orderBy` | `start asc` |

レスポンスの `events` 配列を同期処理へ渡す。APIエラー時はエラーをログへ記録し、メイン処理を失敗させる。

## 2. GaroonからGoogleイベントへの変換

変換は `convertGaroonToGoogleEvent` が担当する。Google APIへ渡す主な項目は `summary`、`iCalUID`、`start`、`end`、`description`、`recurrence` である。

### 2.1 件名と説明

- `summary` はGaroonの `subject` をそのまま設定する。
- 参加者は `attendees` の各 `name` から全角スペースを除去し、`, ` で連結する。
- 説明は次の形式で作成する。

```text
▼参加者<br>{参加者一覧}<br><br>{notes}
```

参加者がない場合は参加者一覧を空文字列とする。メモがない場合も空文字列とする。

### 2.2 日時

終日予定は次のいずれかで判定する。

- `garoonEvent.isAllDay === true`
- `repeatInfo.isAllDay === true`
- `start.date` と `end.date` が両方存在し、日時フィールドがない

終日予定はGoogle Calendarの `date` フィールドを使う。開始日と終了日が同じ場合、Google Calendarの終了日は排他的終了日であるため、終了日に1日加算する。

時刻指定予定は `start.dateTime` と `end.dateTime` を使い、各フィールドの `timeZone` も引き継ぐ。

終日予定に有効な日付がない場合、または時刻指定予定に開始・終了日時が揃っていない場合は変換エラーとする。

### 2.3 繰り返しの前提

`repeatInfo` がある場合に繰り返し規則を作成する。`repeatId` は発生日ごとに変わるため、シリーズ判定やUID生成には使用しない。

Garoon APIから実際に取得したイベントでは、`EVERY_*WEEK` が月内の曜日序数を表している。たとえば、件名「毎月第3火曜日」のイベントは次の値で返る。

```json
{
  "type": "EVERY_3RDWEEK",
  "dayOfWeek": "TUE"
}
```

### 2.4 対応する繰り返しタイプ

| Garoon `repeatInfo.type` | `dayOfWeek` | Google RRULE |
| --- | --- | --- |
| `EVERY_WEEK` | 曜日 | `FREQ=WEEKLY;BYDAY={曜日}` |
| `ONCE_EVERY_TWO_WEEKS` | 曜日 | `FREQ=WEEKLY;INTERVAL=2;BYDAY={曜日}` |
| `ONCE_EVERY_THREE_WEEKS` | 曜日 | `FREQ=WEEKLY;INTERVAL=3;BYDAY={曜日}` |
| `EVERY_DAY` | 使用しない | `FREQ=DAILY` |
| `EVERY_WEEKDAY` | 使用しない | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| `EVERY_1STWEEK` | 曜日 | `FREQ=MONTHLY;BYDAY=1{曜日}` |
| `EVERY_2NDWEEK` | 曜日 | `FREQ=MONTHLY;BYDAY=2{曜日}` |
| `EVERY_3RDWEEK` | 曜日 | `FREQ=MONTHLY;BYDAY=3{曜日}` |
| `EVERY_4THWEEK` | 曜日 | `FREQ=MONTHLY;BYDAY=4{曜日}` |
| `EVERY_LASTWEEK` | 曜日 | `FREQ=MONTHLY;BYDAY=-1{曜日}` |
| `EVERY_MONTH` | `dayOfMonth` | `FREQ=MONTHLY;BYMONTHDAY={日}` |

曜日は `MO`、`TU`、`WE`、`TH`、`FR`、`SA`、`SU` に正規化する。英語の短縮形・完全形も受け付ける。未対応の曜日はエラーとする。

`repeatInfo.period.end` がある場合は `UNTIL` を付ける。終日予定は `YYYYMMDD`、時刻指定予定は `YYYYMMDDT235959Z` とする。

### 2.5 除外日

`repeatInfo.exclusiveDateTimes` の各 `start` をGoogle Calendarの除外規則へ変換する。

- 終日予定: `EXDATE;VALUE=DATE:YYYYMMDD`
- 時刻指定予定: `EXDATE;TZID={タイムゾーン}:YYYYMMDDTHHMMSS`

時刻指定予定のタイムゾーンはイベントの `start.timeZone` を優先し、ない場合は `repeatInfo.timeZone` を使う。除外日時はローカル日時として区切り文字を除去する。

### 2.6 未対応タイプ

対応表にない `repeatInfo.type` は、推測で変換せず `Unsupported recurrence type` エラーとする。これにより、誤った繰り返し予定をGoogle Calendarへ登録しない。

### 2.7 iCalUID

Google Calendarとの照合に使う安定したUIDを次の規則で作成する。

- 単発予定: `garoon` + GaroonイベントID
- 繰り返し予定を含むすべての予定: `garoon` + GaroonイベントID
- GaroonイベントIDがない場合: UIDを生成せず、`Garoon event has invalid id` エラーにする
- 値が空、長すぎる、またはiCalendar UIDとして許可しない文字を含む場合: SHA-256ハッシュへ置換

過去形式との移行用に、Base64URL形式の旧UIDと、repeatId導入前のSHA-256形式UIDを生成できる。旧実装で作成された `garoon + repeatId` UIDも既存Googleイベントの検索・削除判定候補に含める。

## 3. Google Calendarとの同期

### 3.1 Google予定の取得

通常同期では `singleEvents: false` で繰り返しシリーズを展開せずに取得する。`timeMin` は実行時刻、`showDeleted` は `true`、最大取得件数は1ページあたり2500件とし、`nextPageToken` がある限りページングする。

### 3.2 シリーズの集約

GaroonイベントをGaroonイベントIDを基にした `getRecurrenceKey` の結果でグループ化し、同じキーの最初のイベントだけを同期する。Garoon APIが発生日ごとに異なる `repeatId` を返しても、繰り返し予定を重複登録しない。

### 3.3 追加・更新

1. GaroonイベントをGoogleイベントへ変換する。
2. 現行UID、GaroonイベントID、旧UID、過去UIDの順でGoogleイベントを探す。
3. 見つからなければ `events.insert` で追加する。
4. 見つかった場合、`summary`、`description`、`start`、`end`、`recurrence` を比較する。
5. 差分がなければ更新しない。
6. 差分があればGoogle側の最新イベントを取得して `events.update` する。

更新時はGoogle側の `iCalUID` と `sequence` を維持する。Google側の最新イベントに既存UIDがあればそれを優先する。

### 3.4 Garoonで削除された予定の削除

削除対象は次の条件をすべて満たすGoogleイベントである。

- `deleted` ではない
- `status` が `cancelled` ではない
- 説明が `▼参加者<br>` で始まる
- 現在のGaroonイベントから生成した照合キー集合にUIDが存在しない

照合キー集合にはGaroonイベントID、現行UID、旧UID、過去UIDを含める。削除APIが404または410を返した場合は、すでに削除済みとして扱う。それ以外の失敗は件数を記録し、終了コードを1にする。

### 3.5 キャンセル済みGoogleイベントの削除

`--delete-cancelled-google-events` 指定時は、キャンセル済みイベントを全ページ取得する。各イベントの削除は、404または410を成功扱いとし、レート制限エラーは最大5回まで指数バックオフして再試行する。

## 4. エラーとログ

致命的エラーはメッセージをログへ出力し、プロセス終了コードを1にする。個別イベントの変換・追加・更新に失敗した場合は、そのイベント以外の処理を継続し、失敗件数を最後に判定する。

ログはコンソールへ `timestamp level message` の読みやすい形式で表示し、実行ごとに生成する `logs/run-YYYY-MM-DDTHH-mm-ss-SSS-<プロセスID>.log` へJSON形式で保存する。保持期間は7日であり、起動時に7日より古い実行ログを削除する。通常ログにはイベントID、iCalUID、件名などを記録するが、説明文・参加者・認証情報は成功ログへ記録しない。

## 5. ファイル構成と責務

| ファイル | 責務 |
| --- | --- |
| `main.js` | 起動、同期順序、シリーズ集約、追加・更新・削除、終了コード |
| `lib/config.js` | `config.json` の読み込み |
| `lib/garoon.js` | Garoon APIからの予定取得 |
| `lib/eventConverter.js` | 日時、説明、UID、RRULE、EXDATEの変換 |
| `lib/googleCalendar.js` | Google OAuth、イベント取得・追加・更新・削除 |
| `logger.js` | コンソール・実行単位ファイルログ、古いログの削除 |
| `execute.vbs` | Windowsから非表示で通常同期を起動 |
| `test/eventConverter.test.js` | 変換、UID、削除判定、差分判定の回帰テスト |
| `scripts/save-and-push.js` | mainブランチのテスト、コミット、プッシュ |

## 6. 実装上の制約

- Garoonの取得期間は実行時点から約3か月後までである。
- Garoon APIの取得上限はリクエストごとに200件である。
- 対応表にない繰り返しタイプは同期に失敗する。
- 繰り返し対応前に作成した単発Google予定を、後から繰り返しシリーズへ自動統合する機能はない。
- 初回認証時は対話的に認証コードを入力する必要がある。
- `execute.vbs` はGoogle認証の入力画面を表示する用途ではなく、認証済みトークンを使った定期実行を想定する。
- 実際のGoogle Calendarを変更するため、初回や仕様変更後はテスト用カレンダーで確認する。

## 7. 変更時の確認方法

イベント変換ロジックを変更した場合は、プロジェクトルートで次を実行する。

```powershell
npm test
git diff --check
```

Google Calendarへ実際に同期する前に、ログで対象イベントの追加・更新結果を確認する。特に繰り返し予定は、Google Calendar上で発生間隔、終了日、除外日を確認する。
