import { formatExaminationText } from '../../src/domain/visit-text';

test('examination prose has consistent punctuation and spacing, with separate printed subheadings', () => {
  const text =
    '血 压: 118 / 72mmHg, 脉搏：76次/分钟，身高:168cm,体重:62kg,BMI: \n21.97,BSA:1.71m²,哺乳: 否，妊娠状态:\n否,专科检查: 原文描述 (双侧)\n各项评估: 疼痛评分:0,心理评估:平静。';
  expect(formatExaminationText(text)).toBe(
    '血压：118/72 mmHg，脉搏：76 次/分钟，身高：168 cm，体重：62 kg，BMI：21.97，BSA：1.71 m²，哺乳：否，妊娠状态：否\n\n专科检查：原文描述（双侧）\n\n各项评估：疼痛评分：0，心理评估：平静。',
  );
});

test('formatting preserves decimals, thousands separators, times, ratios, intervals and medical notation', () => {
  const text =
    "复测时间:08:30,比例:1:1000,计数:1,234.50/μL;范围:(3.5,5.5);单位:10^9/L，BMI<18.5，体温:36.5℃，血氧:98%，BSA:1.45m'";
  expect(formatExaminationText(text)).toBe(
    "复测时间：08:30，比例：1:1000，计数：1,234.50/μL；范围：(3.5,5.5)；单位：10^9/L，BMI<18.5，体温：36.5 ℃，血氧：98%，BSA：1.45 m'",
  );
});

test('formatting neither invents a missing decimal nor removes English word boundaries', () => {
  expect(formatExaminationText('BMI<18\n5；描述:No acute change；pH:7.35')).toBe(
    'BMI<18\n5；描述：No acute change；pH：7.35',
  );
});
