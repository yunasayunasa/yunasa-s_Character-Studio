# Hybrid Raster import欠落と同一ID更新（2.0.5）

## 原因と切り分け

2026-09-17、公開URLの `src/engine/character-loader.js` を取得したところ、埋め込みRaster対応 `isEmbeddedRaster` が存在せず、`#` 以外のhrefをすべて削除する旧sanitizerだった。公開SWも `svg-character-studio-v2.0.4`。ローカルHybrid対応は未公開だった。

silver-scholarのZIPは6ファイル。全身JPEGは `character.svg` 内のdata URLであり、外部Rasterファイル名・relative URL・object URLに依存しない。ZIP decode、sourceFiles、IndexedDBのsvgTextではデータが維持される。公開ローダーを通常UIへ差し込むと、表示用SVGのparseSafeSvg段階でimage.hrefだけが消える。Pack固有・保存・Raster Previewの描画問題ではない。

最小条件は、SVGの `<image href="data:image/png;base64,..."/>` と任意のpathのみ。旧sanitizerはimageのhrefを削除し、pathは残す。現行sanitizerは署名検査済みPNG/JPEG/WebPのBase64をimageにだけ許可し、remote href、SVG data URL、不正bitmapは除去する。

通常UIの配布ZIP import実測（591×1100 viewport）：

| ローダー | IDBのJPEG | 表示SVGのJPEG href | Canvas下半分の非透明画素数 |
| --- | --- | --- | ---: |
| 公開旧版 | 維持 | 欠落 | 331 |
| 現行版 | 維持 | 維持 | 126,919 |
| 現行版reload後 | 維持 | 維持 | 126,919 |

画素数は各Canvas下半分の非透明画素を合計した欠落検出指標。Reference美術評価やMAEではない。before/afterの全身スクリーンショットも確認済み。

以前の自動テストはローカルの新ローダーを使い、API import→直接Renderer初期化で検証していた。公開配信コード・SWキャッシュ・通常UIのバージョン差を検証しておらず、公開E2E成功を保証できなかった。

## 修正

- `src/engine/character-loader.js`：既存の汎用埋め込みRaster許可修正（本作業では変更せず、公開時に含める）。
- `sw.js` / `package.json`：2.0.5へ更新。古い2.0.4のcacheをactivation時に削除する既存機構を利用。
- `src/engine/pack-store.js`：検証後・書込前に既存ID確認。confirmUpdateがtrueの場合のみレコード全体置換。transaction完了を待って保存成功を返す。
- `src/main.js` / `index.html` / `styles.css`：名前・任意version・更新/キャンセルのmodal。更新後は新Packで再mount。
- `docs/character-pack-spec.md`：既存IDと更新契約を追記。
- `test/pack-import.browser.mjs`：配布ZIPを通常inputからimport/reloadし、body/face実画素を検査。指定TEST 1〜12とbitmap安全検査。
- `test/pack-cache.browser.mjs`：旧SW cache削除、Full-SVG ZIPの通常UI import/reload。
- `test/realtime-preview.test.js`：既存UI配線検査をconfirmUpdate引数に対応。

Raster Preview描画アルゴリズム、CharacterEngine、Offline Renderer、顔geometry、Raster画像は本作業で変更していない。キャラクター専用分岐なし。

## 更新の契約

既存 `character.json.id` を安定IDとして使用。新characterId/schemaなし。label一致では更新しない。Legacy schemaVersion 1も既存idのままimport可能。versionがなければ確認UIに「記載なし」。

更新は新PackのJSON・SVG・全sourceFiles/auxiliaryFiles・metadataで旧レコードを丸ごと置換する。旧のみの素材は削除される。キャンセルではupdatedAtを含め保存内容が不変。Preview再mountが旧キャッシュを破棄し、新Rasterへ切替。StudioのPack外の音声・字幕・品質・口パク値・再生設定を維持し、存在する表情/ポーズ/emote選択は引継ぐ。

今後の赤鬼更新：同一の `id: red-oni-hybrid` を維持した新ZIPを「＋キャラクターを追加」で選択→「更新する」→保存後表示→reload。旧Full-SVG赤鬼 `red-oni-warrior` は異なるIDなので別キャラクター。

## 配布・公開状況

検証：通常UI import/update 16/16 PASS（指定TEST 1〜12を含む）、SW cache/Full-SVG通常UI 3/3 PASS、silver-scholar既存描画/出力 4/4 PASS、赤鬼normal/crossed Golden・point描画/PSD 4/4 PASS。共通verifyのproject verify 52/52 PASS。その後追加したSW browser scenarioと関連PWA/UI配線を含む対象9件もPASS。browser scenarioのNode import成功と、実際のPlaywright実行結果は別々に数える。

証跡は `C:/Users/guestuser/Desktop/コウセイ/pack-import-evidence/`。before/after-import.png、update-confirmation.png、before/after.json、各ブラウザresult.json、verify.logを保存した。

`release/silver-scholar-hybrid-pack.zip` は修正不要。同じZIPを新アプリで検証した。SHA256 `4d0261d9fabc1a2128cd4bb2bda5a0efead8fbcfe3c98d7a2084cc84bc9a8e73`。

コード修正はローカルで検証済み。公開サイトへのcommit/push/deployは未実施。Git運用ルールに従い、ユーザーの指示前に行わない。公開時は新ローダーとSW版を同時に反映し、アプリを再読み込みして新SWをactivation後、もう一度reloadする。既存IDBのraw SVGにRasterが残っているので再importなしでも再表示できる。

共通verifyの秘密スキャンには、既存赤鬼JPEGのBase64がcase-insensitive AKIAパターンに当たる4件の既知FAILが残る。対象画像や検査を変更して回避しない。依存追加なし。機能PASSを共通ゲート全PASSと表記しない。

rollbackは今回追加したUI・confirmUpdate・transaction完了待ち・2.0.5版変更と追記のみを戻す。作業前から存在したHybridローダー/Raster修正や未コミット素材を一括restoreしない。保存済みPack更新を戻す場合は旧ZIPを同じIDで再importし更新する。
