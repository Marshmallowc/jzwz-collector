# 更新日志

版本号的每一次跳跃基本对应一次"对网站机制的理解错了"。把踩过的坑记下来，明年网站改版时能少走一遍。

## 3.1.0 — 开源整理

- 去掉调试期的个人化文案，诊断输出改为通用表述
- 分批落盘（每 5 页写一次 localStorage），全国量级下不再卡顿
- 重试次数收敛到 3 次、失败上限抽成常量 `MAX_FAILS`
- 补 README / LICENSE / CHANGELOG
- 首请求失败、返回非 JSON（登录失效）给出明确提示

## 3.0.0 — 改用页面自身的 ajax 接口

**关键发现**：从下载的 HTML 里挖出了 `cxDoQuery`：

```js
function cxDoQuery(pno, collapse){
  var p = cxCollect(); p.page = pno || 1;
  p.examid = $('#examid').val(); p.userid = $('#userid').val();
  $.post(CX_CTX + "/stuchooseexam/querykspoFullByAjax.htm", p, function(zwdata){
    cxRender(zwdata, collapse);
  });
}
```

数据在 `zwdata.zzpoList.data.list`，是纯 JSON 数组；表格只是前端用 JS 拼出来的。

- 直接 POST 该接口，取 24 个字段的原始 JSON
- 筛选条件复用页面 `cxCollect()`，不再逆向那几十个下拉框
- 不再解析 HTML，不再模拟表单，不再翻页

这是唯一走得通的路。前两版都是在错误的方向上打补丁。

## 2.2.0 — 加诊断

- 打印 `sub()` / `gotopage()` / `querykspo()` 源码
- 打印后台返回 HTML 的真实结构（`id="kslist"` 出现次数、`<tr>` 数量）
- 加「下载返回HTML」按钮

**诊断暴露的结论**：后台 POST 返回 77KB，`id="kslist"` 只在 JS 字符串里出现一次，第 1 页和第 2 页字节数完全相同（77394）。说明服务端根本没按页码给数据。

## 2.1.0 — 加自检

- 打印表单字段清单：只有 6 个（`examid/userid/zwdm/sfzxin/cx_sdd_sfmbs/requestPage`），**筛选条件一个都没提交**
- 打印分页解析结果、当前页前 3 条岗位代码作为基准
- 打印后台请求的 HTTP 状态、字节数、解码是否正常

## 2.0.0 — 改成后台批量请求

- 放弃"点下一页"的方案，改为在后台逐页 POST
- 原因：翻页是整页表单提交，每翻一页页面白屏重载，脚本状态必丢

**结果**：仍然只拿到空壳 HTML，因为方向错了（见 3.0.0）。

## 1.x — 模拟点击翻页

- 1.0.0 抓 `td[title]`，按岗位代码去重，localStorage 累积，导出 CSV
- 1.1.0 修复沙箱限制：不直接调用页面 `onchange`，改为模拟真实点击
- 1.2.0 加三级兜底（点链接 → 派发 change → 提交表单）
- 1.3.0 状态标记从 sessionStorage 移到 localStorage，加心跳

**结果**：始终只翻一页就停。整页重载 + 脚本沙箱，跨页状态不可靠。

---

## 换年度时的排查顺序

网站每年改版，明年大概率要重新逆一遍。按这个顺序查最快：

1. 打开岗位查询页，F12 Console 输入 `cxCollect`，函数存在说明筛选条件这条路还在
2. 抓一次请求：Network 面板筛 XHR，翻一页，看那条 `querykspoFullByAjax` 的参数和返回
3. 看返回 JSON 的 `zzpoList.data.list[0]`，字段名有没有变
4. 字段名变了就改脚本顶部的 `COLS`；接口路径变了改 `API_PATH`；`toolsMenu` 里分页文案变了就改 `fetchPage` 里的三个正则
