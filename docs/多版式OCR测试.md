# 多版式本地 OCR：2026-10-23

> **专题历史记录。** 下文结果与安装模式只对应各段记录的时间，不代表当前手机状态或全部功能验收。最新汇总见[当前状态与待办](当前状态与待办.md)，日常运行见[本地开发与测试](本地开发与测试.md)。

## 本次改动

保留已验证的浙一解析优先级，新增 `lab-table-v1` 通用表格解析。未知医院只要具有足够清楚的项目、结果、单位和参考范围表头，即可尝试整理指标，不再必须匹配医院名称或固定页坐标。

- 动态定位表头，支持“单位在参考范围前”和相反顺序；支持英文代码在项目前或项目后。
- 按列位置分开英文代码与项目名称，保留名称自身的 `C`、`β2`、`α-L-` 和 `5′` 等前缀，不通过删除首个汉字之前的全部字符来清洗名称。
- 分开解析左右表格，按左栏、右栏顺序展示；按文字基线分行，避免较高的汉字框把相邻数字行合并。
- 数字 `0` 保留；缺失结果留空并沿用最多 12 格的局部补读。模糊小数、多个数字片段、辅助读数冲突或疑似箭头均保留核对要求，不按参考值猜数字。
- 原生 OCR 保留已有主读取、辅助读取，再提供长边不超过 1400 像素的中文读取结果 `tableSpans`。它与原始读取分开返回，只参与通用表格候选选择，不改变浙一规则的输入。额外读取失败保留已有结果。没有新增模型、网络请求或付费 API。
- 表格须有完整的必要表头，至少 3 行有合法结果和参考范围，且这类行不少于候选行的 65%；不满足时保留原件供手工整理。这个阈值是保守结构校验，不是准确率保证。
- 候选项目保留原图行区域、原识别名称/数值/单位与警告。全部通用候选需确认，具体疑点沿用当前逐项核对交互；报告级提醒检查是否漏项。

通用解析器不猜患者、采样日期、标本或检测方法，也不根据中文名称直接建立跨医院指标等价关系。新格式可以核对、保存、查看原件和参考范围；**目前不自动加入趋势序列**，即使用户确认数值。跨医院指标映射仍是后续独立工作，原浙一趋势保持原逻辑。

## 实际样本结果

素材为本地 `private-fixtures/public-reports-20261023/` 中的 9 张公开报告示例，包含科普教学表、截取图、标注和低清照片；不是 9 家医院的原始临床 PDF。V1-V3 局部重复图未计数。测试输入是这些图转换的单页 PDF，使用 App 的实际原生提取器。

改动前两端 9 张均不能结构化提取。当前 iOS 7/9、Android 6/9 能提取部分或全部项目；不能将此比例视作准确率。

下面仅核对**数值**，按原图位置匹配，小数尾零视为等值；不包含名称、单位、参考范围和箭头的准确性。207 个数值来自 7 张可核对样例的人工转录；03、05 没有建立可靠的人工数值清单。全部样本参与了开发，不是独立留出集。

| 样本 | 人工数值数 | iOS 提取项 / 数值正确 | Android 提取项 / 数值正确 | 已知限制 |
|---|---:|---:|---:|---|
| 01 血常规单栏 | 19 | 19 / 19 | 19 / 19 | 名称和单位仍有误读 |
| 02 教学示例表 | 24 | 24 / 24 | 24 / 24 | 百分号等仍可能漏读 |
| 03 歪斜拍照 | 未标注 | 0 / — | 0 / — | 表头残缺、歪斜，保留手工整理 |
| 04 红字标注表 | 22 | 22 / 21 | 22 / 20 | 科普箭头/文字干扰；错误值要求核对 |
| 05 极低清双栏 | 未标注 | 0 / — | 0 / — | 必要表头读不清，保留手工整理 |
| 06 代码在前的单栏 | 24 | 24 / 22 | 24 / 24 | iOS 将两个上箭头读成末尾数字 1；已提示数值疑点 |
| 07 广东省中医院低清图 | 22 | 11 / 10 | 0 / 0 | iOS 仅整理右栏；Android 结构证据不足，整页未整理 |
| 08 双栏生化 | 48 | 48 / 48 | 48 / 48 | 只确认数值；名称、单位和范围仍需核对 |
| 09 同版式另一张生化 | 48 | 43 / 43 | 48 / 48 | iOS 漏掉 5 个项目名称，对应项目没有生成 |

原来的两份浙一血常规在本次重新运行的两端原生 OCR（含原有单元格补读）中，仍各 45/45 项名称、数值、单位、参考范围匹配，患者和日期一致。上述新样例不能套用这项完整字段结论。

最终一轮模拟器单页原生提取耗时约 iOS 2.3–4.3 秒、Android 3.3–8.2 秒；较早一轮 Android 为 0.6–1.3 秒，可见本机测试耗时存在明显波动。这些测量含额外尺寸识别、不含用户核对，不代表真机 Release 性能。

## 复现

仅测试目标通过环境变量加载公开素材。它们不进入 App 的生产资源。先指定素材目录：

```sh
export DOCTOR_OCR_FIXTURES="$PWD/private-fixtures/public-reports-20261023/samples"
```

iOS：

```sh
GEM_HOME=/opt/homebrew/Cellar/cocoapods/1.16.2_1/libexec /opt/homebrew/opt/ruby/bin/ruby scripts/prepare-ios-ocr-tests.rb
xcodebuild test -project tmp/ocr/ios-tests/LocalOCRTests.xcodeproj -scheme LocalOCRTests -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -only-testing:LocalOCRTests/PublicReportOCRTests CODE_SIGN_IDENTITY=-
```

`PublicReportOCRTests` 附件是 `public-ios-<样本文件名>.json`。使用 `xcresulttool export attachments` 导出后，按附件建议名移除系统追加的测试后缀，放入统一提取结果目录。

Android：在 `android/` 下执行 `./gradlew :local-pdf:assembleDebugAndroidTest -PreactNativeArchitectures=arm64-v8a`，安装生成的测试 APK，再用 instrumentation 运行 `expo.modules.localpdf.PublicReportOCRTest`。只运行测试，不会导入或确认用户病历。结果在测试包 `expo.modules.localpdf.test` 的 `files/public-android-<样本文件名>.json`。

字段比较：

```sh
node scripts/check-public-ocr.mjs private-fixtures/public-reports-20261023 tmp/multihospital-20261023/extracted-multiscale tmp/multihospital-20261023/evaluation
node scripts/check-private-ocr.mjs tmp/multihospital-20261023/regression
npm run verify
npm run check:bundles
```

`check-public-ocr.mjs` 会报告已识别项、匹配数值、缺项、多出项和已标记的差异；它返回成功只说明比较执行完成且已知差异带核对标记，**不说明全部字段正确**。

## 验证与体验

已有测试覆盖：单/双栏及列顺序、页面缩放和偏移、代码位置、零/空白、行合并、额外尺寸回退、箭头冲突、多个数字片段、原件区域、无表头/参考表/残缺页拒绝，以及旧浙一回归。原生 XCTest 和 Android instrumentation 调用实际提取器，原始输出和比较结果在忽略的 `tmp/multihospital-20261023/`。

最终 `npm run verify` 通过：类型检查、lint、19 套共 159 项 Jest 测试及统计 HTTP 测试。iOS 原生 4 项、Android 原生 3 项通过；`npm run check:bundles` 两端 JS / Hermes 导出通过。公开样本比较使用最终原生输出重新执行，数值结果如上表；原浙一 45 项完整字段回归通过。对应证据为 `verify-final.log`、`ios-final.xcresult`、`android-final-test.log`、`bundles-final.log`、`evaluation/summary.json` 和 `regression-final.log`。

本次更新包含原生实现，**iPhone 和 Android 需要重新编译安装**，只重启 Metro 无法获得额外尺寸 OCR。旧报告不会被自动覆盖；安装后可选择“重新识别原报告”，核对新候选后保存。本次未自动安装到用户真机，也未确认、替换已有病历。
