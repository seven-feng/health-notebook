// Administrative labels can appear anywhere in a cropped report, including
// inside apparent result/unit columns. Do not rely on a fixed footer height or
// a specific hospital's name to distinguish them from measured rows.
export function isTableMetadata(name: string, rowText = name): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '');
  const label = normalize(name);
  const value = normalize(rowText);
  return (
    /(?:联系|咨询|客服|服务|预约|解读)(?:电话|热线)|(?:电话|地址|网址)[:：]|(?:自费|付费|收费)(?:增项|项目)|(?:收费|费用)说明/.test(
      value,
    ) ||
    /(?:体检中心|健康管理中心|医疗中心|医院|分院|门诊部)$/.test(label) ||
    /^(?:第\d+页(?:共\d+页)?|\d+\/\d+)$/.test(label)
  );
}
