# タイムライン・出力・モーション設計

## 決定論的状態評価

`createTimelineState(pack, snapshot, t, source)` は時刻以外の実時間状態を参照しない純粋な評価器です。返り値はmaster、選択part、effect、lipLevel、target別の合成transformです。同じpack/snapshot/source/tから同じ結果が得られます。

プレビューは `requestAnimationFrame` の経過秒をこの評価器へ渡します。書き出しは `frame / fps` を渡すため、待機、音声再生、`AnalyserNode`、画面更新速度、バックグラウンド化から独立します。瞬きもcharacter IDと周期番号から決まる疑似乱数で再現可能です。

## 音声・字幕

音声選択時に `decodeAudioData` で全長を取得し、60HzのRMSエンベロープへ縮約します。任意時刻は隣接サンプルを線形補間します。書き出し中に音声を再生しません。

- audio: 音声全長、音声エンベロープを口パクへ使用
- subtitle: 最終字幕終了まで、文字列と句読点から疑似レベルを生成
- combined: 音声全長、`max(audio, subtitle * 0.7)`
- 字幕バッチ: 各cueのstartをグローバル時刻として評価し、`end - start` のGIFを作る

GIFは1/100秒単位の各フレームdelayを配分し、合計を区間長の1/100秒丸めへ一致させます。

## 品質とメモリ

| preset | 幅 | FPS | 色処理 | 用途 |
|---|---:|---:|---|---|
| light | 320 | 8 | 3-3-2固定palette | スマホ確認 |
| standard | 512 | 12 | 固定palette＋4×4順序dither | 通常利用 |
| high | 768 | 20 | 固定palette＋4×4順序dither | 短尺高品質 |

GIFはCanvas→ImageData→即時LZW圧縮の順で1フレームずつ処理し、RGBA配列の履歴を保持しません。Canvasは使用後1×1へ縮小します。保持する主データは圧縮済みGIFバイトと1フレーム分のRGBAです。15秒等の分割指定では、各GIFを順に生成してZIPへ入れます。

## 透過WebM

VP9、次にVP8について、`VideoEncoder.isConfigSupported()` へ `alpha: "keep"`、`latencyMode: "quality"` を含む完全なconfigを渡します。`supported` がtrueかつ返却configもalpha保持を認識したcodecだけを採用し、同じconfigを `configure()` に渡します。WebM trackのAlphaMode=1はこの場合だけ出力されるため、コンテナ宣言と実映像が一致します。どのcodecもalpha保持を確認できない端末ではWebMを生成せず、「この端末では透過WebMに対応していません」と表示して透過GIF/PNGを案内します。

WebCodecs VideoEncoderへ決定論的timestamp付きVideoFrameを順次渡し、VP9またはVP8のSimpleBlockをWebMへmuxします。エンコード待ちキューが8を超えるとflushし、未圧縮フレームの増加を抑えます。MediaRecorderによる実時間録画は最終書き出しに使用しません。

## transform合成

各targetは `pose → motion → expression → gaze` のチャンネルを内部状態へ加算・乗算し、最後に1つのtransform文字列へ合成します。個別機能はSVG属性を直接上書きしません。ポーズ変更、呼吸、左右揺れ、回転、視線を同時に適用しても前の成分は消えません。

## motions.json v2

```json
{
  "schemaVersion": 2,
  "default": "idle",
  "motions": {
    "idle": {
      "tracks": [{
        "target": "hair_side_left",
        "property": "rotation",
        "wave": "sin",
        "amplitude": 2,
        "period": 5,
        "phase": 0.1,
        "delay": 0.2,
        "easing": "easeInOut",
        "origin": { "x": 620, "y": 205 }
      }]
    }
  }
}
```

対応propertyは `translateX`、`translateY`、`rotation`、`scaleX`、`scaleY`。waveは `sin`、`triangle`、`saw`、`pulse` です。髪・袖・頭などの名称をエンジンへ追加する必要はありません。
