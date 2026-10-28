// Reading typography only. Keep stored OCR/user edits untouched, and never
// normalize decimals, time/ratio colons, comparison signs, or unit spelling.
export function formatExaminationText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g, '$1')
    .replace(/[,：:;]/g, (mark, index, text: string) => {
      if (mark === ',' && /\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1] ?? ''))
        return mark;
      if (mark === ':') {
        if (/\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1] ?? '')) return mark;
        if (text.slice(index + 1, index + 3) === '//') return mark;
      }
      return mark === ',' ? '，' : mark === ';' ? '；' : '：';
    })
    .replace(/ *([，；：、]) */g, '$1')
    .replace(/([：，])\n\s*/g, '$1')
    .replace(/([\u3400-\u9fff])\n(?=[\u3400-\u9fff])/g, '$1')
    .replace(/\(([^()\n]*[\u3400-\u9fff][^()\n]*)\)/g, '（$1）')
    .replace(/ *（ */g, '（')
    .replace(/ *）/g, '）')
    .replace(/(\d) *\/ *(?=\d)/g, '$1/')
    .replace(
      /(\d)\s*(mmHg|cmH2O|mmol\/L|μmol\/L|mg\/dL|g\/L|次\/分钟|次\/分|次\/min|bpm|kg|cm|mm|m[²³]?|℃|°C)(?![A-Za-z0-9²³])/g,
      '$1 $2',
    )
    .replace(/[，； \n]*(专科检查|各项评估)：\s*/g, '\n\n$1：')
    .trim();
}
