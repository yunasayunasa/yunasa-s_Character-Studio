# キャラクターパック仕様 v2

## 論理モデル

主データは完成PNGではなく、マスターとパーツの構造です。

```text
master artwork
  ├─ master_normal / master_point / ...  大きな身体構造差
  └─ shared parts                        目・眉・口・効果などの小差分
         └─ master override              共有不能な例外だけ差替え
             ├─ character.svg            Web表示
             ├─ character.psd            人間が編集するラスターレイヤー
             └─ JSON                      組合せ・挙動・互換情報
```

## ZIP構成

```text
character-name/
├─ character.svg          必須
├─ character.json         必須
├─ expressions.json       必須
├─ motions.json           必須
├─ poses.json             任意
├─ emotes.json            任意
├─ character.psd          任意
├─ thumbnail.webp         任意
├─ masters/               制作元を同梱する場合に任意
└─ shared_parts/          制作元を同梱する場合に任意
```

ZIPは上位フォルダを1つ含んでも、ファイルをルート直下に置いても構いません。`character.json` はZIP内に1つだけ必要です。

`character.json.files` に宣言したパスは、必須・任意の種別にかかわらず同じZIP内に実在しなければなりません。PSDなしなら `files.psd`、thumbnailなしなら `files.thumbnail` を省略します。`poses`、`emotes`、将来追加するoptional項目も「宣言したら実体必須、不要なら宣言を省略」が共通ルールです。宣言済みファイルがなければ保存前に `character.json: files.<key> "<path>" is declared but missing from ZIP` として拒否します。

## ID命名規則

- ASCII英小文字、数字、アンダースコア。例: `eye_left_open`
- 同じ論理パーツはSVG `id`、PSDレイヤー名、JSON part IDを完全一致させる
- マスターは `master_<pose>`、共有パーツは `<role>_<side>_<state>` を推奨
- SVG内IDは重複禁止
- PSD出力対象は `data-export-part="eye_left_open"` を明示する
- `data-export-part` のない要素は単独PSDレイヤーへ暗黙混入させない

PSDで背景皮膚などを別レイヤーにする場合も `eye_left_base` のような一意IDを付けます。

## character.json

`schemaVersion` は2です。主要フィールドは以下です。

```json
{
  "schemaVersion": 2,
  "id": "sample-character",
  "files": {
    "svg": "character.svg",
    "expressions": "expressions.json",
    "motions": "motions.json",
    "poses": "poses.json",
    "emotes": "emotes.json",
    "psd": "character.psd"
  },
  "assetModel": {
    "defaultMaster": "normal",
    "masters": {
      "normal": { "root": "master_normal" },
      "point": { "root": "master_point" }
    },
    "sharedParts": {
      "eye_left": ["eye_left_open", "eye_left_closed"],
      "mouth": ["mouth_closed", "mouth_smile"]
    },
    "masterOverrides": {
      "profile": {
        "parts": { "mouth_smile": "mouth_smile_profile" }
      }
    }
  }
}
```

`masterOverrides.<master>.parts` は「選択された共有part ID → 専用part ID」の対応です。未指定なら共有partをそのまま使います。override先も `partSlots` へ登録します。

`partSlots` は同時に1つだけ表示するID集合、`effectParts` は重ねて表示できるID集合です。`psdLayers` は `{ "name": "eye_left_open", "partId": "eye_left_open" }` とし、nameとpartIdを一致させます。

## lossless round-trip

ZIP import時は、ランタイム用に解析したJSON/SVGとは別に、packルート以下の全正当ファイルを元の相対パスとバイト列のまま `sourceFiles` としてIndexedDBへ保存します。pack ZIP再export時はこの `sourceFiles` を使用するため、PSD、thumbnail、`masters/`、`shared_parts/`、ライセンス等の未知の補助ファイルも欠落・再整形しません。旧保存レコードに `sourceFiles` がない場合だけ、従来のランタイムデータ＋`auxiliaryFiles`再構成へフォールバックします。

## expressions / poses / emotes

表情は完成画像名ではなく共有パーツの組合せです。

```json
{
  "schemaVersion": 2,
  "default": "happy",
  "expressions": {
    "happy": {
      "parts": {
        "eye_left": "eye_left_smile",
        "eye_right": "eye_right_smile",
        "brows": "brow_raised",
        "mouth": "mouth_smile"
      },
      "visible": ["blush"]
    }
  }
}
```

ポーズは大きな形状差を `master` で、軽い差分を `parts` と `transform` で指定します。マスター変更後、表情と口パクは新しいマスターへ再適用されます。

## ZIPインポート検証

- ZIP終端・中央ディレクトリ・各エントリ境界
- ファイル数256以下、展開後合計80MB以下
- `..`、絶対パス、ドライブレターの拒否
- store/deflate以外の圧縮方式拒否、展開後サイズ、CRC32
- 必須ファイル、JSON構文、schemaVersion、相対パス
- `files` に宣言された全ファイルの存在
- SVG sanitizer、重複ID、全JSON→SVG参照の存在
- motionsの全track target
- posesのpartsとtransform.target
- expressionsのparts/visible/hidden
- blinkの各`*Parts`、lipSyncのparts/closed/small/medium/wide、gaze targets、その他controllerのtarget/targets/parts/visible/hidden
- masters root、sharedParts、masterOverridesの元/先
- `psdLayers` のname/partId/SVG ID一致
- PSD同梱時のヘッダー、Canvas寸法、必須レイヤー名

存在しない参照は `motions.json: motions.idle.tracks[3].target "hair_side_lef" does not exist in character.svg` のように、ファイル名、JSONパス、問題のID、理由を表示します。推測置換やsilent fallbackは行いません。検証完了後だけIndexedDBへ保存します。

## PSDレイヤー初期状態

`psdLayers` の全パーツは独立レイヤーとして残します。書き出し時点のmaster、partSlots、effectのSVG可視状態をPSD layer flagsへ反映し、非選択のmaster・目・口・effectは初期OFFです。flattened compositeは初期ONレイヤーだけをSVG描画順に通常合成して生成するため、visibleレイヤー合成と一致します。

## v1互換

schemaVersion 1の既存パックはランタイム読込時にv2へ正規化します。旧 `sway` / `breathing` / `hairSway` は汎用tracksへ変換され、単一互換マスターが補われます。元ファイルのバイト列は書き換えず、import済みpackの再exportでは元ZIP内容を保持します。migration後のランタイムデータにもv2と同じSVG参照検証を適用します。
