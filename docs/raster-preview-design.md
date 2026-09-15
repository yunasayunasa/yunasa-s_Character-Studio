# Realtime Raster Preview設計（v2.0.4）

## 境界

`character.svg` は構造化マスター、PSD生成元、高品質出力元として維持します。GIF、WebM、PNG、PSD、字幕区間出力は従来どおり `createTimelineState()` とSVG cloneを使用し、Raster Previewを参照しません。

画面上のRealtime Previewだけが次の派生レイヤーを使います。

1. 選択中master・pose・expressionのStatic Canvas
2. blink/lip sync対象slotのcrop済みpart Canvas
3. effectと小さな局所motionのcrop済みpart Canvas
4. 全身motion用HTML transform wrapper

Raster初期化が失敗した場合はv2.0.3のcache済みSVG DOM rendererへ自動fallbackします。`?preview-backend=legacy-svg` で開発時にfallbackを強制できます。

## Static / Dynamic分離

Static Canvasにはmaster、body、clothes、固定髪、眉等を含めます。blink/lip slot、effect、小面積の独立motion partは除外します。master、pose、expressionの組合せが変わった時だけStatic Cacheを検索し、missした場合だけ再Rasterizeします。

blink、mouth、gazeはStatic Cache keyへ含めません。eye/mouth variantは選択された時に個別Canvasを使い、gazeは該当するcrop済みeye layerをCSS translateします。`hair_sway`のように小さく、`data-export-part` が明示されたmotion targetも個別Canvasにします。

`character`、`pose_root`、`body`のようにmasterを包含するmotion targetは、SVG transformではなく入れ子のHTML wrapperへCSS `translate3d / rotate / scale`を適用します。これにより全身swayとbreathingで巨大なvector subtreeを毎frame再Rasterizeしません。

## Raster生成とcrop

小partはSVG `getBBox()`を基準に余白6 unitを加えた範囲だけRasterizeします。clipされた巨大な`use`等で幾何bboxが全身相当になる場合は、一時Canvasでalpha範囲を検出し、保持前に実画素bboxへcropします。一時Canvasはcrop直後に0×0へ解放します。

保持解像度は表示scaleと端末pixel ratioから決め、元SVG解像度を上限とします。mouth等を1254×1254 RGBAのまま保持しません。

## Cache規則

- Static Cache: 最大2 entry
- Small Part Cache: 最大32 entry
- 同一keyの並行生成: 1 Promiseへ集約
- eviction: 最古entryをDOMから外し、Canvasを0×0へ解放
- character切替: cache generationを無効化し、全Canvas、ResizeObserver、layer DOMを破棄
- expression往復: 上限内の既存entryをLRU再利用
- background中: rAF評価を停止し、part prewarmもvisibility復帰まで停止

Cache rebuild countはStatic Cache missだけを数えます。blink、mouth、gazeの変更では増えません。

## Debug Metrics

`?debug-preview=1` では次を表示します。

- actual / target FPS
- JS frame processing ms
- DOM updates / frame
- backend: `raster` または `legacy-svg`
- Static Cache rebuild累計
- rasterizations / second
- active raster layers
- cache entry数と概算RGBA bytes

安定再生中はrasterizations / secondが0へ戻ることを確認できます。

## 既知の近似

masterを包含しない大面積の内部motion targetは、全身Bitmapの重複保持を避けるためRealtime Previewでは省略する場合があります。Offline Exportは完全なSVG timelineを使うため影響しません。新規パックでは、局所motion対象を独立した小さな `data-export-part` にしてください。
