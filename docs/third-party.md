# 原生 PDF 依赖

Android PDF 提取使用 `io.legere:pdfiumandroid:1.0.32`，其 Maven POM 声明 Apache License 2.0：

https://repo.maven.apache.org/maven2/io/legere/pdfiumandroid/1.0.32/pdfiumandroid-1.0.32.pom

底层 PDFium 及其内含依赖还有各自许可证和 notices。本文只是开发阶段依赖登记，不是完整的发行许可证汇编。公开分发前应从实际锁定的原生和 JavaScript 依赖生成并随 App 提供完整 notices。

iOS PDF 处理使用系统 PDFKit，不随 App 打包第三方 PDF 引擎。

本地 OCR：iOS 使用系统 Vision；Android 使用 `com.google.mlkit:text-recognition-chinese:16.0.1` 的内置中文模型。模型随安装包分发，已在模拟器飞行模式下验证，不需要调用云端识别接口。

Android 实测日志出现 `FIREBASE_ML_SDK` 诊断事件入队及上传任务调度。它与 App 的可选 UV/PV 统计开关是不同的数据流，不能宣称关闭业务统计就没有 SDK 网络活动。本次没有核查诊断事件完整载荷或确认发送成功；发布前须核查锁定版本的诊断数据字段、配置和披露要求，并完成 Release 网络检查。参考 [ML Kit 数据收集说明](https://developers.google.com/ml-kit/terms)。

图片入口使用 Expo 的 `expo-image-picker`（系统相机／相册）和 `expo-image-manipulator`（本地处理），版本锁定于 `package-lock.json`。仅拍照时请求相机权限；不录音，相册使用系统选择器。图片转换使用 iOS UIKit 与 Android PdfDocument，未接入额外云端图片服务。
