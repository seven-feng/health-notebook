export const reviewCopy = {
  item: '请对照原报告，确认本项的数值、单位和参考范围。',
  text: '请对照原报告核对文字，尤其是数字、小数点和分级。',
  value: '数值可能识别有误，请核对数字和小数点。',
  missingValue: '结果未识别清楚，请按原报告填写。',
  unit: '单位可能识别有误，请按原报告确认或修改。',
  suggestedUnit: '单位未识别清楚，请核对暂填的单位；如有不同，请修改。',
  reference: '请按原报告确认或修改参考范围；原报告未注明时可留空。',
  name: '项目名称可能识别有误，请按原报告确认或修改。',
  marker: '结果旁的箭头未识别清楚，请对照原报告核对数值和 ↑／↓ 标记。',
  patient: '请按原报告填写患者姓名。',
  date: '请按原报告填写采样日期；无法确认时可留空。',
  specimen: '未识别出检验样本类型，这份报告暂不能与历史结果自动比较。',
  report: '请对照原报告检查数字、小数点和单位。',
  table: '请对照原报告检查是否有漏项，确认数值、单位和参考范围。',
  method: '不同检测方法的结果可能存在差异，查看历史变化时请留意原报告。',
  unsupported: '暂未能自动整理这页的检验项目。你可以查看原件，手动补充或仅保存报告。',
  unreadable: '这页内容未识别清楚。你可以查看原件，手动补充或仅保存报告。',
} as const;

// Older reports store warning sentences in the database. Translate at display
// time so open drafts also get clearer copy without rewriting or reprocessing data.
function currentMessage(message: string): string {
  if (message.includes('此生化报告版式为首次适配')) return reviewCopy.item;
  if (message.includes('按模板暂列')) return reviewCopy.suggestedUnit;
  if (/两次识别的单位|与该项目预期单位不符/.test(message)) return reviewCopy.unit;
  if (/两次识别的数值|结果已通过局部放大识别补充/.test(message)) return reviewCopy.value;
  if (/两次识别的参考范围|参考范围需要核对/.test(message)) return reviewCopy.reference;
  if (message.includes('结果未能可靠读取')) return reviewCopy.missingValue;
  if (/项目识别为|项目名称尚未匹配/.test(message)) return reviewCopy.name;
  if (
    /结果旁的标记被识别成|上下箭头识别不一致|箭头方向未能可靠读取|数值或相邻标记未能可靠区分/.test(
      message,
    )
  )
    return reviewCopy.marker;
  if (/患者名称未能提取|患者信息缺失，请核对归属/.test(message)) return reviewCopy.patient;
  if (/采集日期未能可靠提取|采样日期缺失或无效/.test(message)) return reviewCopy.date;
  if (message.includes('样本类型未确认')) return reviewCopy.specimen;
  if (message.startsWith('已在本机识别，请对照原件')) return reviewCopy.report;
  if (message.startsWith('原报告未注明检测方法；')) return reviewCopy.method;
  if (message.startsWith('已读取页面文字，但此报告版式尚未适配')) return reviewCopy.unsupported;
  if (message.startsWith('未能识别此页文字。')) return reviewCopy.unreadable;
  return message;
}

export function reviewMessages(warnings: readonly string[]): string[] {
  const messages = [...new Set(warnings.map(currentMessage))];
  return messages.filter((message) => {
    if (message === reviewCopy.item && messages.length > 1) return false;
    if (message === reviewCopy.unit && messages.includes(reviewCopy.suggestedUnit)) return false;
    if (message === reviewCopy.value && messages.includes(reviewCopy.missingValue)) return false;
    return true;
  });
}
