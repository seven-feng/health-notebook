import { Platform } from 'react-native';
import { router } from 'expo-router';
import { Header, Screen } from '../../src/ui';
import { BackLink } from '../../src/components/BackLink';
import { HelpParagraph, SettingsGroup, SettingsRow } from '../../src/components/SettingsList';
import { analyticsConfigured } from '../../src/services/analytics';

export default function PrivacySettings() {
  return (
    <Screen>
      <BackLink />
      <Header title="数据与隐私" />
      {analyticsConfigured && (
        <SettingsGroup>
          <SettingsRow
            title="使用统计"
            icon="bar-chart-outline"
            testID="settings-usage"
            onPress={() => router.push('/settings/usage')}
            last
          />
        </SettingsGroup>
      )}
      <HelpParagraph title="报告保存在这台设备">
        原件、识别内容、修改结果和家庭档案在本机保存。数据库加密，原件放在 App
        私有目录；识别不使用云端服务，也不会自动把报告发送给开发者。
      </HelpParagraph>
      <HelpParagraph title="请保留医院提供的原件">
        目前没有完整备份恢复或自动云同步。卸载 App
        会移除本地记录，丢失设备也可能使资料无法找回。你可以单独导出报告原件，但这不包含核对修改和就诊关联。
      </HelpParagraph>
      <HelpParagraph title="权限按需使用">
        拍照时才请求相机权限；相册图片由系统选择器选取，不读取整个相册。不使用麦克风，也不需要通讯录或位置权限。
      </HelpParagraph>
      {analyticsConfigured && (
        <HelpParagraph title="使用统计可以关闭">
          使用统计默认关闭。开启后只发送随机安装标识、页面访问和导入是否完成等固定事件，不包含姓名、报告原件、文件名或指标。关闭会停止发送并清除本机待发送事件。
        </HelpParagraph>
      )}
      {Platform.OS === 'android' && (
        <HelpParagraph title="Android 识别组件">
          本地文字识别使用 Google ML Kit。该组件可能产生独立的运行诊断数据，本地识别不代表整个 App
          完全不联网。
        </HelpParagraph>
      )}
      <HelpParagraph title="记录整理不代替就医">
        指标变化和参考范围来自你的报告。App 帮助整理和回顾，不提供诊断或治疗建议。
      </HelpParagraph>
    </Screen>
  );
}
