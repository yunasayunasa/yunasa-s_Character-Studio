# SVG Character Studio 2

少数の高品質マスター絵と再利用可能な共有パーツを扱う、スマートフォン優先のSVG立ち絵Webアプリです。キャラクター固有情報はSVG/JSONパックへ閉じ込め、表情・瞬き・口パク・視線・ポーズ・モーション・エモート・書き出しを共通エンジンが処理します。実行時依存はありません。

既存パイロット資産は変更せず、`tools/migrate-pilot.mjs` が規格化した `public/characters/pilot-standing/` をサンプルとして収録しています。

## 主な機能

- schemaVersion 2のマスター、`sharedParts`、マスター固有override。schemaVersion 1は読込時に自動移行
- SVG ID、JSON part ID、PSDレイヤー名を同じASCII `snake_case` IDで管理
- JSONの汎用トラックだけで平行移動、回転、拡縮、sin/triangle/saw/pulse波を追加
- ポーズ、モーション、視線を内部状態で合成し、`transform` 上書き競合を防止
- マスター切替後も表情・目・眉・口・視線・エフェクト・口パク状態を再評価して継承
- M4A/MP3/WAVをWeb Audio APIで事前解析し、任意時刻の音量を再現
- SRT/VTT口パク、音声＋字幕、字幕区間ごとのGIF一括ZIP
- 実時間待機を使わない決定論的GIF/WebM書き出し
- 軽量320px/8fps、標準512px/12fps、高品質768px/20fps。推定サイズと作業メモリ表示
- GIFは1フレームずつ生成・エンコードし、使用済みCanvasを解放。長尺は指定秒数で分割可能
- ZIP 1ファイルまたは旧来の複数ファイルから、検証後にIndexedDBへパックを保存
- PNG、透過GIF、透過対応を事前確認するWebM、losslessパックZIP、初期visibility付き明示partレイヤーPSD
- PWA、iPhoneセーフエリア、44px以上のタップ領域、バックグラウンド負荷停止
- Realtime Preview専用のSVG DOMキャッシュと差分更新。タッチ端末は30fpsを目標に間引き、書き出しFPSとは分離
- Realtime Previewは選択状態をStatic Canvasとcrop済みeye/mouth/effect Canvasへ派生し、全身sway/breathingをHTML合成レイヤーで処理。SVGは高品質出力元として維持
- PCはポインター追従、タッチ端末はタップまたは意図的な横ドラッグで視線を操作し、通常の縦スクロールを維持

## 起動

```powershell
npm run serve
```

PCでは `http://127.0.0.1:4173` を開きます。iPhone/PWAではHTTPS配信が必要です。利用端末にNode.jsやFFmpegは不要です。

## 書き出し時間軸

- 音声: 事前解析した音声全長
- 音声＋字幕: 音声全長。口パクは音声を優先し、字幕は補助
- 字幕: 最終キュー終了時刻まで
- 手動: UIで指定した秒数
- 字幕区間GIF ZIP: 各キューの `end - start`

書き出しは `t = frame / fps` の状態を純粋関数で評価し、プレビュー再生や `setTimeout` の進行へ依存しません。WebMは `alpha: "keep"` を含むWebCodecs構成を対応判定し、VP9/VP8をオフライン生成します。透過alpha非対応端末では不透明WebMを生成せず、UIで透過GIF/PNGを案内します。

## キャラクター追加

配布時は `public/characters/<id>/` にパックを置き、`npm run sync:characters` を実行します。利用者はキャラクター選択欄の直下にある「＋ キャラクターを追加」から `character-name.zip` を選べます。既存のvalidatorとIndexedDB保存をそのまま使用し、キャラクター追加時にアプリ本体のJavaScript変更は不要です。

開発時に `?debug-preview=1` をURLへ付けると、Preview FPS、平均frame処理時間、1 frame当たりのDOM更新数、backend、cache rebuild、rasterizations/s、active layers、概算cacheメモリを表示します。この計測はRealtime Previewだけが対象で、GIF/WebM等のオフラインレンダリング条件を変更しません。

- [キャラクターパック仕様](./docs/character-pack-spec.md)
- [新規キャラクター制作手順](./docs/character-production-guide.md)
- [タイムライン・出力設計](./docs/export-and-motion-design.md)
- [Realtime Preview・モバイル入力設計](./docs/realtime-preview-design.md)
- [Realtime Raster Cache設計](./docs/raster-preview-design.md)
- [変更内容一覧](./docs/change-list.md)
- [最終QA](./docs/final-qa.md)
- [既存パイロット監査](./docs/pilot-audit.md)

## 検証

実装完了後に一度だけ実行します。

```powershell
npm run verify
```

## 既知の制約

- iPhone SafariのWebCodecs対応状況によってWebM書き出しは利用できません。GIF/PNG/PSD/パックZIPはWebCodecs非依存です。
- GIFは256色です。標準/高品質では順序ディザを使用しますが、写真的グラデーションはPNG/WebMより色数が少なくなります。
- deflate ZIPの展開には `DecompressionStream("deflate-raw")` が必要です。非対応の古いSafariでは無圧縮ZIPを使用します。
- PSDは編集可能な全キャンバス透過ラスターレイヤーで、SVGベクター自体は保持しません。
- パイロット資産には本来の指差し・腕組み完成マスターがないため、サンプルのpoint/alertは構造・継承・override検証用の互換マスターです。新規制作では描き直した専用マスターを使います。
