# 最終QA結果

最終更新: 2026-09-14

## 自動検証

`PASS` — `npm run verify`: 22 tests / 22 passed / 0 failed / 0 skipped。共通 `verify.ps1` もProject verify PASS。Git statusは対象がGitリポジトリでないためSKIPPED。

確認範囲: 従来の16項目に加え、WebCodecsのalpha keep判定/configure/AlphaMode整合と非対応拒否、PSD初期visibilityとvisibleレイヤー由来composite、全sourceFilesのlossless round-trip、files宣言の必須化、JSONパス付きSVG ID typo拒否、v1 migration後の同一参照検証。

## v2.0.2修正確認

- `PASS` — WebMの `isConfigSupported()` と `configure()` が同じ `alpha: "keep"` configを使用。返却configがalpha保持を認識しない場合は透過WebMを生成せずGIF/PNGを案内
- `PASS` — WebM trackのAlphaMode=1を自動テストで確認
- `PASS` — PSD 34レイヤーを維持し、neutral初期状態は10レイヤーON、24レイヤーOFF
- `PASS` — flattened compositeを初期ONレイヤーだけから通常合成し、テスト画像で一致
- `PASS` — ZIP全ファイルを `sourceFiles` としてバイト単位で保存・再export・再読込し、PSD/thumbnail/masters/shared_parts/未知補助ファイルと相対パスが一致
- `PASS` — motion/pose/expression/blink/lipSync/gaze/master/override/psdLayersの意図的typoをimport検証ロジックが詳細エラーで拒否
- `PASS` — missing PSD、missing thumbnailを拒否し、宣言省略したoptional packを許可
- `PASS` — pilot packは未同梱PSDの `files.psd` 宣言を削除し、宣言と実体を一致

実codecをencode→decodeしてalpha値を読む `test/browser-alpha-smoke.html` も追加しましたが、この実行環境ではブラウザ制御面が未提供で、headless ChromeのGPU processも起動不能だったため実ピクセルQAは `SKIPPED（実行環境制約）` です。対応判定・設定・非対応拒否・コンテナAlphaModeは自動テストでPASSです。

## デスクトップ統合確認

`PASS` — Chromium系インアプリブラウザで以下を実行しました。

- 初回起動、schemaVersion 2サンプル読込
- `happy + normal → happy + point` で共有 `eye_left_smile` を維持し、`mouth_smile_point` overrideだけを優先
- 標準512px/12fpsの2.00秒GIFを実生成
- 旧v2でWebCodecsから2.00秒オフラインWebMを実生成、console error/warning 0。v2.0.2の実alphaピクセルdecode確認は上記のとおりSKIPPED
- 12.400秒WAVを事前解析し、GIF Graphic Control Extensionのdelay合計12.40秒を確認
- 2.50秒/1.20秒字幕キューを実GIF化し、ZIP内各GIFのdelay合計2.50秒/1.20秒を確認
- 実ZIPを `importPackZip → schema/SVG/CRC検証 → IndexedDB保存 → 再読込` しPASS
- 1254×1254のPSDを実生成。PackBits導入前220,155,274 bytesから、導入後12,074,722 bytesへ縮小

## iPhone Safari実機QA

`SKIPPED（接続実機なし）` — Windowsの接続デバイス一覧にiPhone/Apple Mobile Deviceがなく、実機Safariを操作できませんでした。iOS/Safari versionは取得不能です。デスクトップの幅320px対応CSS、safe-area、PWAファイル、自動テストはPASSですが、実機確認の代用とはしていません。

- 初回/PWA起動、縦横画面、ホーム画面追加
- 組込/ZIPキャラクター、表情、ポーズ、master切替と状態継承
- M4A/MP3/WAV、SRT/VTT、音声、字幕、音声＋字幕
- 長時間プレビュー、バックグラウンド、ロック復帰
- PNG/GIF/WebM/PSD/ZIP保存
- 大容量入力、分割出力、低メモリ状態

未実施: M4A/MP3/WAVのiOSデコード差、Files保存、ホーム画面追加、画面ロック復帰、低メモリ強制終了、実機縦横回転、iOS WebCodecs可否。

## Photoshop / Photopea PSD実ファイルQA

構造自動検証は `PASS`。生成物は1254×1254、RGBA 4ch、34レイヤーです。neutral状態の初期ONは `master_normal`、`hair_sway`、左右eye base/open、`brow_normal`、`mouth_base`、`mouth_closed`、`pose_normal` の10個で、非選択master・目・口・effect・poseの24個はOFFです。

- Adobe Photoshop: `SKIPPED（Photoshop.exeがこのPCに未導入。ユーザーが後日手動確認予定）`
- Photopea: `SKIPPED（ユーザー指定により外部経由の検証を行わず、後日手動確認予定）`

追加の一時公開や外部送信は行っていません。実アプリでの次の目視項目は未確認です。

- 警告なしで開く
- Canvas寸法、透明部分、レイヤー名/順/数
- 合成画像一致、不要重複なし
- SVG ID / JSON part ID / PSDレイヤー名一致
- master/shared/override関係を編集者が追える

PSD v1ヘッダー、Canvas寸法、RGBAチャンネル、レイヤー名、PackBitsによるサイズ縮小は確認済みです。Photoshop/Photopea実確認は未実施として分離しています。

## 判定ルール

- `PASS`: 実行して期待結果を確認
- `FAIL`: 実行し、必須条件を満たさない
- `SKIPPED（理由）`: 工程や実機/アプリが環境に存在しない

必須チェックにFAILがある場合、完成とは報告しません。
