const path=require('path');
const XLSX=require(path.resolve(__dirname,'..','legacy-order','node_modules','xlsx'));
const wb=XLSX.utils.book_new();
const task=XLSX.utils.aoa_to_sheet([
  ['料号'],
  ['示例：请替换为实际新品料号']
]);
task['!cols']=[{wch:34}];
XLSX.utils.book_append_sheet(wb,task,'新品下单任务');
const guide=XLSX.utils.aoa_to_sheet([
  ['新品下单 Excel 模板说明'],
  ['必填列','料号'],
  ['填写规则','每行一个精确料号；不要合并单元格；首行必须保留“料号”列名。'],
  ['处理规则','工作台依次查询美西仓库料号预警。每行异常会记录原因并继续后续行。'],
  ['正式下单','仅在工作台选择正式新品下单并确认后才可能创建真实采购订单。']
]);
guide['!cols']=[{wch:18},{wch:92}];
XLSX.utils.book_append_sheet(wb,guide,'填写说明');
XLSX.writeFile(wb,'C:/Users/admin/Desktop/新品下单模块原型/新品下单任务模板.xlsx');
console.log('created');
