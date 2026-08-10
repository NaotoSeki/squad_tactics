# RTwP 接続監査台帳

更新日: 2026-08-10

## 判定基準

- **削除**: 現行の唯一の戦闘実行系である RTwP に意味がなく、表示・説明・互換分岐として残すと誤解や再接続を招くもの。
- **RTwP化**: 画面または永続データに存在するため、AP やターン境界を使わず RTwP の tick／命令／戦闘イベントへ接続するもの。
- **共有必須**: 表示と実行で別定義にすると再び食い違うため、単一カタログまたは正規化関数を正本にするもの。

## 台帳

| 対象 | 現状 | 分類 | 処置 |
|---|---|---|---|
| 9スキルの名称・説明・アイコン | `data.js` に表示定義があるが、効果の大半は旧AP戦闘の `logic_game.js` にだけ存在 | 共有必須 | `SKILLS` を表示とRTwP効果の唯一の正本にする |
| Precision | 旧命中計算だけが +15% | RTwP化 | RTwPの発ごとの命中率へ x1.15 |
| Radio | 「支援効果UP」とだけ表示され、RTwPの `hasRadio` に届かない | RTwP化 | 遠距離命令を無線伝達時間へ短縮 |
| Ambush | 旧命中計算だけが回避 +15% | RTwP化 | RTwPの被命中率へ x0.85 |
| AmmoBox | 説明だけで実効果がない | RTwP化 | 登録時の予備弾倉を +1 |
| HighPower | 旧ダメージ計算だけが +20% | RTwP化 | RTwPの与ダメージへ x1.20 |
| Mechanic | 「毎ターン回復」という旧境界依存 | RTwP化 | 一定時間交戦していない時の継続回復へ変更 |
| Armor | 旧ダメージ計算だけが -5 | RTwP化 | RTwPの各被ダメージから 5 軽減 |
| Hero | AP+1 と昇進時 `maxAp` 加算 | RTwP化 | 動作時間短縮と士気耐性へ置換し、AP加算を削除 |
| CQC | 旧隣接攻撃への固定カウンター | RTwP化 | RTwP強襲／同一hex白兵の威力へ x1.25 |
| `SKILL_TRAITS` | カタログに無い Berserker/Veteran/Medic/Rookie を変換するため、本編から到達不能 | 削除 | 私的対応表を廃止し、各 `SKILLS[].rtwp.traits` から生成 |
| aggressive / cautious / calm | シムとテストには実装済みだが、本編スキルから到達不能 | RTwP化 | HighPower/CQC、Ambush/Mechanic、Precision/Hero から共有カタログ経由で付与 |
| timid | 負の人格差としてシム内で有効。現行の正の永続スキルには対応物がない | 共有必須 | コアのトレイトとして保持し、架空スキル名への対応は作らない |
| 8能力のうち speed/str/melee/recon | すでにRTwPの移動、息切れ、白兵、観察へ接続済み | 共有必須 | 現行接続を回帰テストで固定 |
| action | コメントと表示上はAPだがRTwPでは未使用 | RTwP化 | 「動作」へ再定義し、照準・再装填・持替時間へ反映 |
| aim | レーダーに表示されるがRTwP登録は常に `skill: 1.0` | RTwP化 | RTwP命中倍率へ反映 |
| throw | レーダーに表示されるが投擲準備時間へ未接続 | RTwP化 | 手榴弾／銃擲弾の準備時間へ反映 |
| morale | レーダーに表示されるが全員同じ士気推移 | RTwP化 | 指揮官喪失・釘付け時の士気損失と回復へ反映 |
| `SimBattleAdapter.skills=[]` | 検証用／別シーンではスキル表示が消える | RTwP化 | シムsnapshotのskills/traits/effects/hasRadioを表示面へ透過し、maxHpもsnapshot契約に含める |
| 戦闘中の装備交換 | 右ペインの装備と速度だけ更新され、シムの武器・弾倉・投擲物は登録時のまま | RTwP化 | `SimCore.updateSoldierLoadout` で武器・弾薬・副武装・能力を原子的に再同期 |
| AERIAL支援カード | `gameLogic.units` へ直接ダメージを与えるため、次の `syncUnits` で巻き戻る | RTwP化 | SimCoreの外部爆発キューへ3発を投入し、ダメージ・VFX・結果判定を同じtick系列へ統合 |
| `logic_support.js` | 未定義の `SUPPORT_CARDS` を参照し、HTMLからも読み込まれない第二の支援実装 | 削除 | 重複モジュールを削除し、AERIALはRTwP接続層へ一本化 |
| WOUNDED_STATE | AP低下・旧命中式の効果。RTwPでは同じ25%域が `incap` で行動不能になる | 削除 | 旧数値効果フラグを削除。`wounded` はRTwP HP同期から導出する戦果表示だけに限定 |
| BATTLE_SCALE内の旧RT_*／ammoBurnMult | 旧同時戦闘の数値で、現行SimCoreが読む `SIM_TUNING` と二重化 | 削除 | 旧RT数値群とAP共振値を削除し、戦闘数値は `SIM_TUNING` だけを正本にする |
| BATTLE_SCALE内のAUTO攻撃回数 | 削除済みの自動戦闘入口専用で、人数プリセットに残存 | 削除 | `AUTO_ATTACKS_PER_ACTOR` / `ENEMY_ATTACKS_IN_AUTO` とmorph対象を削除 |
| 初期姿勢 `RT_DEFAULT_STANCE` | 旧設定はSimCore登録へ届かず、シム側は立位で初期化 | RTwP化 | 歩兵をproneで生成し、登録時に `prone` をsnapshotへ渡す |
| 手榴弾・強襲の重複チューニング | `GRENADE_*` / `ASSAULT_WIN_*` が実装で読まれず、`MUNITIONS` と白兵解決に二重化 | 削除 | 未使用キーを削除し、投擲は `MUNITIONS`、白兵はSimCoreの決定論計算を正本にする |
| 複数ターン行軍フラグ／オーバーレイ | 現行命令は経路をRTwPで継続するため、ターン境界の行軍計画は不要 | 削除 | `FEATURE_EXTENDED_MARCH` / `MARCH_PLAN_MAX_TURNS` と利用案内を削除。旧facade内部状態は入力非到達 |
| M8ロケット専用処理 | 戦車無効中の旧AP攻撃・弾薬・専用ゲージだけが残存 | 削除 | 製品武器エントリ、キャンペーン配布、専用攻撃分岐、ゲージを削除。PLロケット再有効化は別途SimCore接続が必須 |
| 戦車テンプレート | `FEATURE_TANK_UNITS=false` で全配置・候補から除外される | 共有必須 | 将来有効化する場合もSimCoreの武器・移動・被弾契約を先に実装し、旧攻撃メソッドを起動しない |
| BattleReviewの `turn-based` / `this.turn` | 勝敗snapshotへ存在しない時刻と旧表示モードを保存 | RTwP化 | SimCoreの決着tickと `mode:'rtwp'` を保存 |
| BattleReviewの旧行軍・終了操作面 | snapshotと読取専用facadeに複数ターン行軍・終了・自動戦闘名が残る | 削除 | 旧view fieldsと架空メソッドを削除し、現行RTwP命令だけを読取専用化 |
| RTwP依存欠落時の黙示失敗 | attachがnullを返すだけで旧クリック・攻撃面が残り得る | 削除 | `RTWP_ERROR` へ遷移し、戦闘入力と旧メニューを閉じ、欠落依存を明示する |
| 装備交換後の旧APメニュー再評価 | `refreshCommandMenuState` が旧APでボタンを再判定 | 削除 | RTwP中は `showSoldierMenu` を再描画し、旧判定へ入らない |
| 戦闘中のスキル再同期 | 装備同期時に武器と能力だけを更新すると、動的に付いたRadio/効果がsnapshotに残らない | RTwP化 | 同じ原子的更新でskills/traits/effects/hasRadioも更新 |
| UNIT_TEMPLATES.stats | paramsと同じaim/str/moraleを別名で持ち、旧命中式のfallbackだけが参照 | 削除 | テンプレートと新兵生成から削除し、8能力はparamsだけを正本にする |
| `INCAP_DRAG_ALLOWED` | 将来用と明記された未実装フラグで、表示・実行とも参照なし | 削除 | 未接続フラグを削除。担送を作る場合はRTwP命令として別設計する |
| BattleFacade内の旧AP攻撃メソッド | 共有map/inventory面と同じクラスに凍結コードが残るが、製品UIとRTwP接続層からは非到達 | 削除 | 新規呼出しを禁止。依存欠落時も入力を閉じ、段階的に共有面から物理分離する。新機能を追加しない |
| BattleCloud / BattleCloudTactics | 無効フラグの描画とAP依存の移動評価だけが読み込まれ、SimCoreの制圧・士気へ未接続 | 削除 | 製品HTMLから旧雲・戦術モジュールを外す。SimCoreの既存状態機械を正本にする |
| ReactionRules / CombatRules | 旧直接ダメージ、AP移動、ammoBurnからだけ参照され、SimCoreに同じ責務が実装済み | 削除 | 製品HTMLから外す。ファイルは履歴テスト用に残すがRTwPへ橋渡ししない |
| UnitViewのsnapshot未到達fallback | 初期フレーム用の一定速度・姿勢fallbackが描画層に残る | 共有必須 | 戦闘決定には使わず、RTwP snapshot到着前の描画だけに限定。依存欠落時は戦闘入力ごと停止する |
| 修理・治療・手動姿勢・旧白兵のHTMLメニュー | RTwP開始後はカタログメニューで上書きされるが、初期HTMLには旧語彙が残る | 削除 | 空のメニュー容器だけを置き、RTwPカタログから描画 |
| End Turn / AP / `?rtwp=0` の利用案内 | README、取扱説明書、構造資料、引継ぎ資料に現行と矛盾する説明が残る | 削除 | 現行RTwP操作・能力・スキル説明へ更新し、危険な旧RTwP引継ぎ書を削除。設計判断の履歴記録だけは履歴として保持 |
| RTwP行動メニューとホットキー | `sim_actions.js` の同じカタログを利用済み | 共有必須 | 現行構造を維持し、旧メニューへフォールバックしない |

## 実装結果

上表の「現状」は監査開始時点の証拠、「処置」は本変更で採用した決定を示す。RTwP化・共有必須の項目はすべて接続済みで、削除項目は製品の表示・データ・HTML読込・実行入口から除去済みである。BattleFacade内の互換死コードと、単体描画のsnapshot未到達fallbackは製品戦闘から到達不能にし、物理分離の残作業として明記した。

`WOUNDED_STATE` の旧AP/命中効果は削除したが、`wounded` 表示そのものは削除していない。RTwPのライブHP同期から毎フレーム導出し、右ペインと戦果報告へ共有する。

## 接続設計

`data.js` の `SKILLS` が名称・説明・アイコン・RTwP効果を保持する。`logic_battle_rtwp.js` はユニットのスキルを重複排除して加算／乗算し、シムが理解する `effects` と行動差だけの `traits` に正規化する。`sim_core.js` はスキルIDや日本語表示を知らず、正規化済みの命中、被命中、威力、装甲、回復、動作、白兵、通信だけを決定論的に適用する。

能力値は既存保存データとの互換のためキー名 `action` を維持するが、意味はAPではなく実時間の「動作」とする。ターン、AP回復、ターン終了を新しい効果の条件にしてはならない。

## 検証門

1. 9スキルすべてについて、RTwP登録と該当する戦闘差分を決定論的テストで確認する。
2. 8能力すべてがRTwPのいずれかの計算へ接続されることを確認する。
3. Radio の命令遅延、Mechanic の非交戦回復、Hero 昇進時にAPが増えないことを個別確認する。
4. README／取扱説明書／現行構造資料に、プレイヤー向けのターン終了・AP運用・`?rtwp=0` 切戻し案内が残らないことを静的検査する。
5. 既存RTwP回帰テストを実行する。既知のベースライン失敗（`map_city.test.js` のseed 0、`sim_incap_prone.test.js` の伏せ命中比）は本変更と分離して報告する。
