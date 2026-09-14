# 既存パイロット資産の確認結果

参照元は `standing-video/実況動画素材/_直立/_Canva.zip` として指定された既存試作です。元資産は一切変更せず、読み取り専用で確認しました。

## ZIPの内容

- Canva向け透過GIF: 待機1種、口パク付き4表情
- WebM: 待機1種、口パク付き4表情
- PNG: 4表情 × 開閉2差分
- SVG: `neutral`、`happy`、`surprised`、`worried`
- 元素材: `standing-vector.svg`、`traced.svg`、元PNG、生成指示
- 旧レンダリング処理: `rig.cjs`、`render.cjs`
- 利用手順・検証レポート

別のZIPには180枚のPNGフレームがありました。これは既存書き出し処理の中間成果物で、Phase 1のランタイムには取り込んでいません。

## 移行判断

旧SVGは各表情を別ファイルとして生成し、顔の一部をマスクして目・眉・口を重ねる方式でした。Phase 1では元の `standing-vector.svg` を1つのマスター描画として埋め込み、差分に共通IDを付与した1つの `character.svg` に再構成しました。

現行 `character.svg` は約992KB、1,829 path、7 use、2 clipPathを含むため、軽量な新規パックより描画負荷が高いlegacy / heavy sampleです。今回は見た目と既存互換性を守るため全面再描画せず、RealtimeエンジンのDOM cache、差分更新、不可視partの `display: none` で負荷を軽減しました。新規制作では必要部位だけの独立geometryを標準にします。

移行した役割は次のとおりです。

- 目: open / half / closed / smile
- 眉: normal / raised / worried
- 口: closed / small / medium / wide / smile / o
- 瞳・視線対象: iris_left / iris_right
- 効果: blush
- モーション対象: character / body / head

既存パイロットは単一の完成絵をベースにしているため、瞳だけの完全な独立レイヤーや髪・腕の分離はありません。視線は目のクリップ領域、髪揺れは追加した前髪ストランドを数ピクセル動かす近似です。ポーズ機構は実装済みですが、このサンプルでは全身の軽い傾きと演出差分に留まります。完全な腕・手・髪差分は、新しい分離素材をパックへ追加することでアプリ本体を変えずに利用できます。

## 再生成

サンプルの `character.svg` は次の形で再生成できます。

```powershell
node tools/migrate-pilot.mjs <standing-vector.svg> public/characters/pilot-standing/character.svg
```

座標調整はパイロット固有の移行アダプター内に閉じており、共通エンジンには含めていません。
