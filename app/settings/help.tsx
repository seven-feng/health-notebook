import { Header, Screen } from '../../src/ui';
import { BackLink } from '../../src/components/BackLink';
import { HelpParagraph, SettingsGroup, SettingsRow } from '../../src/components/SettingsList';
import { useOnboarding } from '../../src/components/Onboarding';

export default function HelpSettings() {
  const openOnboarding = useOnboarding();
  return (
    <Screen>
      <BackLink />
      <Header title="使用帮助" />
      <SettingsGroup>
        <SettingsRow
          title="重新查看使用引导"
          testID="open-onboarding"
          icon="play-circle-outline"
          onPress={openOnboarding}
          last
        />
      </SettingsGroup>
      <HelpParagraph title="怎样添加记录？">
        先在首页选择所属成员，再导入
        PDF、拍照或选择相册图片。照片可先裁剪、旋转；识别后对照原件核对并保存。
      </HelpParagraph>
      <HelpParagraph title="哪些报告可以整理？">
        支持部分版式的检验报告、多页体检报告、打印门诊病历和超声报告。检验结果用于查看指标变化；病历和超声文字保留报告原意，不生成诊疗结论。
      </HelpParagraph>
      <HelpParagraph title="为什么还要核对？">
        清晰照片也可能漏掉数字、单位或文字。优先处理标出的疑点，并检查姓名、日期和所属成员；没有提示的内容也建议快速对照原件。
      </HelpParagraph>
      <HelpParagraph title="识别不出来怎么办？">
        保留完整标题、日期和表格，避开反光，尽量正对报告拍摄。手写、模糊或未适配的版式可能需要手动整理，原件仍可保存和查看。
      </HelpParagraph>
      <HelpParagraph title="怎样查看指标变化？">
        保存核对后的结果，再到“指标”页查看。相同成员、可比较的项目才会归在一起；数值看变化曲线，文字看历次结果。缺少日期等信息时，先补充后再比较。
      </HelpParagraph>
      <HelpParagraph title="怎样删除记录？">
        打开记录，在详情页找到删除入口。整份报告删除前会列出受影响的检查和就诊记录，请确认范围后操作。
      </HelpParagraph>
    </Screen>
  );
}
