# 変更内容一覧

- 実時間2秒録画を廃止し、共通の決定論的タイムライン評価器を追加
- 音声を選択時に全長・60Hz音量エンベロープへ事前解析
- 音声全長GIF/WebM、字幕末尾までのGIF/WebM、音声＋字幕の音声軸出力
- SRT/VTT各区間の同尺GIFを番号・時刻入りファイル名でZIP一括保存
- 3品質preset、推定出力サイズ、作業メモリ、長尺警告、任意秒分割
- GIFをRGBA全フレーム保持から逐次LZWエンコードへ変更
- 高品質GIFに小型の順序ディザを追加
- WebCodecs＋内製WebM muxerによるオフラインVP9/VP8出力
- motionsを名前別ハードコードから汎用track配列へ変更
- pose/motion/expression/gaze transformを1つの内部状態で合成
- schemaVersion 2のmasters/sharedParts/masterOverridesを追加
- v1パックと旧motion形式の読込互換移行
- マスター切替時に表情・視線・口パク・effectを再適用
- ZIP 1ファイルimport、store/deflate展開、CRC、サイズ、パス、JSON、SVG、PSD整合検証
- PSD対象を `data-export-part` 明示制へ変更し、レイヤー名とpart IDを統一
- サンプルパイロットをv2へ移行し、shared eye/brow/mouth/effectとpoint用mouth overrideを収録
- PWAキャッシュをv2へ更新し、新規モジュールをオフライン対象へ追加
- 自動テストを決定性、時間長、transform合成、ZIP拒否、逐次GIF、PSD名、master継承/overrideへ拡張

## v2.0.2 最終安全性修正

- WebCodecsの対応判定とconfigureを `alpha: "keep"` で統一し、透過非対応時はWebM生成を明示拒否
- PSDの各独立レイヤーへ書き出し時点の初期visibilityを記録し、ONレイヤーからflattened compositeを生成
- import元の全packファイルを相対パス・バイト列のままIndexedDBへ保持し、lossless再export
- motions、poses、expressions、controllers、masters/sharedParts/masterOverrides、psdLayersの全SVG ID参照をJSONパス付きで検証
- `character.json.files` は宣言した全パスをpack内必須とし、optionalは宣言省略で表現
- pilotサンプルは同梱していない `files.psd` 宣言を削除し、PSDは独立した書き出しサンプルとして配布

## v2.0.3 Realtime Preview・モバイルUX修正

- SVG mount時にIDを一括解決するRealtime専用DOM cacheを追加し、animation frame内の `querySelector` を廃止
- visibility/transformの適用済み値を保持し、同じstateの再適用ではDOM更新を行わない差分更新へ変更
- expression、pose、master、emoteを操作時だけ再準備し、frame loopはblink、lip sync、gaze、motionを中心に評価
- Realtime state objectを再利用し、タッチ端末ではrAFを維持した30fps目標の更新間引きを追加。Offline Rendererは変更なし
- 非選択master/slot/effectを `display: none` とし、巨大な不可視SVG partの描画を抑制
- マウス追従に加え、タッチのtap gaze、横方向の意図的drag gaze、900ms後の中央復帰と滑らかな補間を追加
- stageは `touch-action: pan-y pinch-zoom` とし、通常の縦スクロールとpinch zoomを維持
- キャラクター選択欄へ常設の「＋ キャラクターを追加」を移動し、既存ZIP import/validator/IndexedDB経路へ接続
- coarse pointer / hoverなし端末でbackdrop blurと大型shadowを軽減
- `?debug-preview=1` にFPS、frame time、DOM updates/frame表示を追加
- Service Worker cache revisionを `svg-character-studio-v2.0.3` へ更新し、旧cacheをactivation時に削除
