# Realtime Preview・モバイル入力設計

## Offline Rendererとの境界

`createTimelineState()` は、任意時刻と同じ入力から同じ状態を返すオフライン書き出し用APIとして維持します。GIF、WebM、字幕区間、音声エンベロープの評価は従来どおりこの経路を使います。

画面プレビューだけが `RealtimePreviewRenderer` を使います。SVG mount時に全 `id` を一度走査し、master、part slot、effect、motion/pose/gaze targetの参照を保持します。animation frame内では同じIDを再検索しません。

## 差分更新

- expression、pose、master、emote、slot基本選択は操作時にだけstatic stateを再準備
- blink、lip sync、gaze、motion trackだけを時間依存stateとしてframeごとに評価
- visibilityとtransformの適用済み値をMapへ保持し、同じ値ならDOMを書き換えない
- 非選択master・part・effectはDOM構造を維持したまま `display: none` にし、大きな不可視SVGの描画を避ける
- Realtime評価ではstate object、parts、effects、transform mapを再利用し、frameごとのcloneを行わない

タッチ端末では `requestAnimationFrame` 自体を維持しつつ、DOM反映を約30fpsへ間引きます。PCは最大60fpsです。これはPreview専用値であり、品質presetの書き出しFPSへ影響しません。

## 視線入力

- マウス: stage内のpointer位置を継続追従
- タッチ: 短いタップ位置を見る。約900ms後に中央へ戻る
- タッチドラッグ: 12pxを超え、縦移動より明確に横移動が大きい場合だけ視線を追従
- 縦移動: スクロールとして扱い、`preventDefault()`を呼ばない

stageの `touch-action` は `pan-y pinch-zoom` です。ページ全体への `touch-action: none`、常時preventDefault、pinch zoom抑止は行いません。視線値は数frameでtargetへ補間します。

## 計測

URLに `?debug-preview=1` を指定すると、stage左上に以下を表示します。

- 実測Preview FPS
- Realtime frame評価＋DOM反映の平均ms
- 1 frame当たりDOM更新数
- 端末判定から選んだtarget FPS

通常利用時は計測UIを非表示にします。

## SVG資産の性能規約

新規パックでは「目だけ必要なら目だけのgeometry」を持たせます。全身を `<use>` で複製してclipし、小差分として見せる構造は推奨しません。連続alpha補間が必要なpart以外は選択状態を離散的に切り替えます。

pilotは約992KB、1,829 pathを含む移行用heavy sampleです。見た目と既存パック互換性を優先し、今回は大規模な再描画を行っていません。エンジン側のDOM検索・不要書込み・不可視part描画を削減し、新規キャラクターには軽量part規約を適用します。
