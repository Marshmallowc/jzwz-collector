// ==UserScript==
// @name         军队文职岗位查询采集器
// @name:en      JZ WZ Position Collector
// @namespace    https://github.com/Marshmallowc/jzwz-collector
// @version      3.1.0
// @description  在军队人才网岗位查询页一键抓取全部页岗位数据，按岗位代码去重累积，导出 CSV。2027 年度官方已取消岗位表 Excel 附件，本脚本用页面自身的 ajax 接口还原出结构化数据。
// @author       Marshmallowc
// @license      MIT
// @homepageURL  https://github.com/Marshmallowc/jzwz-collector
// @supportURL   https://github.com/Marshmallowc/jzwz-collector/issues
// @match        https://*.81rc.mil.cn/*
// @match        http://*.81rc.mil.cn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '3.1.0';

  /* ============================ 配置 ============================ */
  const DB_KEY = 'jzwz_gw_db_v2';
  const API_PATH = '/stuchooseexam/querykspoFullByAjax.htm';
  // 两页之间的随机间隔（毫秒）。调大更安全，调小更快。
  const DELAY_MIN = 600;
  const DELAY_MAX = 1100;
  // 每抓 N 页落盘一次。写太频繁会卡，写太少中途崩了会丢。
  const SAVE_EVERY = 5;
  const MAX_PAGES = 2000;
  const MAX_FAILS = 5;

  // 字段 → 表头。顺序即导出的列顺序，与页面列定义（CX_COLS）一致。
  // sfmbs / gwfl 在数据里存在但页面不显示。
  const COLS = [
    { f: 'zwdm',     lb: '岗位代码' },
    { f: 'zpdwmc1',  lb: '所属单位' },
    { f: 'zpdwmc2',  lb: '用人单位' },
    { f: 'gwlx',     lb: '岗位类别' },
    { f: 'zwmc',     lb: '岗位名称' },
    { f: 'csgz',     lb: '从事工作' },
    { f: 'zprs',     lb: '招考数量' },
    { f: 'rwbl',     lb: '入围比例' },
    { f: 'gzsf',     lb: '工作省份' },
    { f: 'gzcs',     lb: '工作城市' },
    { f: 'sfmbs',    lb: '是否免笔试直接面试' },
    { f: 'gwfl',     lb: '是否先面试后笔试' },
    { f: 'xl',       lb: '学历要求' },
    { f: 'xw',       lb: '学位要求' },
    { f: 'sxzy',     lb: '所学专业要求' },
    { f: 'sfqrz',    lb: '是否要求全日制' },
    { f: 'qttj',     lb: '其他要求' },
    { f: 'lylx',     lb: '来源类别要求' },
    { f: 'kskskm',   lb: '考试科目' },
    { f: 'zyjszggx', lb: '职称要求(高校毕业生)' },
    { f: 'zyjszg',   lb: '职称要求(社会人才)' },
    { f: 'zyzggx',   lb: '职业资格要求(高校毕业生)' },
    { f: 'zyzg',     lb: '职业资格要求(社会人才)' },
    { f: 'dwlxdh',   lb: '咨询电话' }
  ];

  /* ============================ 小工具 ============================ */
  function log() {
    try { console.log.apply(console, ['[jzwz]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const val = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };

  /* ============================ 存储 ============================ */
  function loadDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }
  function saveDB(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
    catch (e) { msg('浏览器存储已满，请先导出 CSV 再清空'); return false; }
  }
  function dbCount() { return Object.keys(loadDB()).length; }

  /* ============================ 数据规整 ============================ */
  function cleanRow(r) {
    const o = {};
    for (let i = 0; i < COLS.length; i++) {
      const v = r[COLS[i].f];
      o[COLS[i].f] = (v === null || v === undefined || v === 'null') ? '' : String(v);
    }
    return o;
  }

  function pagerInfo() {
    const info = document.querySelector('.cx-pager .cx-pg-info');
    const txt = (info && info.textContent) || '';
    const m = txt.match(/第\s*(\d+)\s*\/\s*(\d+)\s*页/);
    const t = txt.match(/共\s*(\d+)\s*条/);
    return {
      cur: m ? parseInt(m[1], 10) : 1,
      pages: m ? parseInt(m[2], 10) : 1,
      total: t ? parseInt(t[1], 10) : 0
    };
  }

  /* ============================ 接口调用 ============================ */
  // 直接复用页面自己的 cxCollect()，这样筛选条件永远与页面上的一致，
  // 不必去逆向那一堆下拉框的字段名。
  function collectParams() {
    try {
      if (typeof window.cxCollect === 'function') return window.cxCollect();
    } catch (e) { log('cxCollect 调用失败', e); }
    return {};
  }

  function apiUrl() {
    const ctx = (typeof window.CX_CTX === 'string' && window.CX_CTX) ? window.CX_CTX : '/qjwzwb';
    return ctx + API_PATH;
  }

  async function fetchPage(pageNo) {
    const p = collectParams();
    p.page = pageNo;
    p.examid = val('examid');
    p.userid = val('userid');

    const body = new URLSearchParams();
    Object.keys(p).forEach(function (k) {
      const v = p[k];
      if (v === null || v === undefined) return;
      body.append(k, String(v));
    });

    const res = await fetch(apiUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch (e) {
      const head = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error('返回不是 JSON（可能登录已失效）：' + head);
    }

    const list = json && json.zzpoList && json.zzpoList.data && json.zzpoList.data.list;
    const menu = (json && json.toolsMenu) || '';
    const mTotal = /共\s*(\d+)\s*条记录/.exec(menu);
    const mPages = /共\s*(\d+)\s*页/.exec(menu);
    const mCur = /当前第\s*(\d+)\s*页/.exec(menu);

    return {
      rows: Array.isArray(list) ? list : null,
      total: mTotal ? parseInt(mTotal[1], 10) : 0,
      pages: mPages ? parseInt(mPages[1], 10) : 0,
      cur: mCur ? parseInt(mCur[1], 10) : pageNo,
      raw: json
    };
  }

  /* ============================ 采当前页（读页面内存） ============================ */
  function harvest() {
    const rows = window.CX_ROWS;
    if (!Array.isArray(rows) || !rows.length) return { ok: false, pageRows: 0, added: 0, total: dbCount() };

    const db = loadDB();
    let added = 0;
    rows.forEach(function (r) {
      const o = cleanRow(r);
      if (!o.zwdm || db[o.zwdm]) return;
      db[o.zwdm] = o;
      added++;
    });
    if (added) saveDB(db);
    return { ok: true, pageRows: rows.length, added: added, total: Object.keys(db).length };
  }

  /* ============================ 批量抓取 ============================ */
  let running = false;

  async function runAll() {
    if (running) return;
    running = true;
    refreshStatus();

    const db = loadDB();
    let added = 0;
    let total = 0, pages = 0, failed = 0, unsaved = 0;

    msg('请求第 1 页，确认接口…');
    let first;
    try {
      first = await fetchPage(1);
    } catch (e) {
      running = false; refreshStatus();
      msg('接口调用失败：' + e.message);
      log('首请求失败', e);
      return;
    }

    if (!first.rows) {
      running = false; refreshStatus();
      msg('接口返回里没有岗位列表，点「诊断」查看详情');
      return;
    }

    total = first.total || 0;
    pages = first.pages || 1;
    if (pages > MAX_PAGES) pages = MAX_PAGES;
    log('开始抓取', { total: total, pages: pages, firstRows: first.rows.length });

    for (let page = 1; page <= pages; page++) {
      if (!running) { saveDB(db); msg('已停止，库存 ' + Object.keys(db).length + ' 条'); return; }

      let res = null;
      if (page === 1) {
        res = first;
      } else {
        for (let attempt = 0; attempt <= 2; attempt++) {
          try {
            res = await fetchPage(page);
            if (res.rows) break;
          } catch (e) {
            log('第 ' + page + ' 页失败', e.message);
          }
          if (attempt < 2) await sleep(900 + attempt * 700);
        }
      }

      if (!res || !res.rows) {
        failed++;
        msg('第 ' + page + ' 页失败（连续 ' + failed + ' 次）');
        if (failed >= MAX_FAILS) {
          running = false; saveDB(db); refreshStatus();
          msg('连续失败 ' + MAX_FAILS + ' 页，已停止。库存 ' + Object.keys(db).length + ' 条');
          return;
        }
        continue;
      }
      failed = 0;

      res.rows.forEach(function (r) {
        const o = cleanRow(r);
        if (!o.zwdm || db[o.zwdm]) return;
        db[o.zwdm] = o;
        added++;
      });

      // 分批落盘，避免每页都序列化一遍大对象
      if (++unsaved >= SAVE_EVERY || page === pages) { saveDB(db); unsaved = 0; }

      const pct = Math.round(page / pages * 100);
      msg('抓取 ' + page + '/' + pages + '（' + pct + '%）· 库存 ' + Object.keys(db).length + ' 条');
      elStatus.innerHTML = '已存 <b>' + Object.keys(db).length + '</b> 条 · 抓取中 ' + pct + '%';

      if (page < pages) await sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
    }

    running = false;
    saveDB(db);
    refreshStatus();
    msg('完成：共 ' + pages + ' 页，本次新增 ' + added + ' 条，库存 ' + Object.keys(db).length + ' 条' +
        (total ? '（接口报总记录 ' + total + ' 条）' : ''));
    log('完成', { pages: pages, added: added });
  }

  /* ============================ 诊断 ============================ */
  async function diagnose() {
    const out = [];
    const push = function (s) { out.push(s); };

    push('=== 岗位采集器 诊断 v' + VERSION + ' ===');
    push('时间: ' + new Date().toLocaleString());
    push('URL : ' + location.href);
    push('');

    push('[1] 页面变量');
    push('    CX_CTX    = ' + (function () { try { return window.CX_CTX; } catch (e) { return '(不可读)'; } })());
    push('    接口地址   = ' + apiUrl());
    push('    cxCollect = ' + typeof window.cxCollect);
    push('    CX_ROWS   = ' + (Array.isArray(window.CX_ROWS) ? window.CX_ROWS.length + ' 条' : typeof window.CX_ROWS));
    push('');

    push('[2] 当前筛选条件 cxCollect()');
    try { push('    ' + JSON.stringify(collectParams())); } catch (e) { push('    (序列化失败)'); }
    push('    examid=' + val('examid') + '  userid=' + val('userid'));
    push('');

    push('[3] 页面分页');
    const pg = pagerInfo();
    push('    当前 ' + pg.cur + ' / 共 ' + pg.pages + ' 页，共 ' + pg.total + ' 条');
    push('');

    try {
      const r = await fetchPage(1);
      push('[4] 调接口 page=1');
      push('    list ' + (r.rows ? r.rows.length : 'null') + ' 条；total=' + r.total + ' pages=' + r.pages + ' cur=' + r.cur);
      if (r.rows && r.rows.length) {
        const o = cleanRow(r.rows[0]);
        push('    第1条: ' + o.zwdm + ' / ' + o.zpdwmc1 + ' / ' + o.zwmc);
        push('    字段数: ' + Object.keys(r.raw.zzpoList.data.list[0]).length);
      }
      const r2 = await fetchPage(2);
      push('[5] 调接口 page=2');
      push('    list ' + (r2.rows ? r2.rows.length : 'null') + ' 条；第1条: ' +
           (r2.rows && r2.rows.length ? cleanRow(r2.rows[0]).zwdm : '(无)'));
      push('');
      push('结论：[4][5] 都有数据且岗位代码不同，说明接口正常，直接点「后台抓全部页」。');
    } catch (e) {
      push('[4] 调接口失败：' + e.message);
      push('');
      push('结论：接口不通。若提示登录失效，回登录页重新扫码后重试。');
    }

    return out.join('\n');
  }

  /* ============================ 导出 ============================ */
  function csvCell(v) {
    const s = (v === undefined || v === null) ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportCSV() {
    const db = loadDB();
    const codes = Object.keys(db);
    if (!codes.length) { msg('还没有采集到数据'); return; }

    codes.sort(function (a, b) { return String(a).localeCompare(String(b)); });

    const lines = [COLS.map(function (c) { return csvCell(c.lb); }).join(',')];
    codes.forEach(function (code) {
      const row = db[code];
      lines.push(COLS.map(function (c) { return csvCell(row[c.f]); }).join(','));
    });

    const csv = '\ufeff' + lines.join('\r\n'); // BOM：Excel 双击不乱码
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const p2 = function (n) { return String(n).padStart(2, '0'); };
    const name = '军队文职岗位_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
                 '_' + p2(d.getHours()) + p2(d.getMinutes()) + '.csv';

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 3000);
    msg('已导出 ' + codes.length + ' 条');
  }

  /* ============================ 界面 ============================ */
  let elStatus, elMsg, panel, elDiag;

  function msg(t) { if (elMsg) elMsg.textContent = t; }

  function refreshStatus() {
    if (!elStatus || !panel) return;
    const p = pagerInfo();
    elStatus.innerHTML = '已存 <b>' + dbCount() + '</b> 条 · 第 ' + p.cur + '/' + p.pages + ' 页' +
      (running ? ' · <span style="color:#218af4">抓取中</span>' : '');
    const allBtn = panel.querySelector('button[data-act="all"]');
    if (allBtn) { allBtn.disabled = running; allBtn.style.opacity = running ? '.5' : '1'; }
    const stopBtn = panel.querySelector('button[data-act="stop"]');
    if (stopBtn) { stopBtn.disabled = !running; stopBtn.style.opacity = running ? '1' : '.5'; }
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'jzwz-panel';
    panel.innerHTML =
      '<div class="jz-hd"><span>⚡ 岗位采集器 <i>v' + VERSION + '</i></span><span class="jz-fold" title="收起/展开">—</span></div>' +
      '<div class="jz-bd">' +
        '<div class="jz-status">已存 0 条</div>' +
        '<div class="jz-row"><button data-act="all" class="jz-primary">后台抓全部页</button></div>' +
        '<div class="jz-row"><button data-act="one">采集本页</button>' +
          '<button data-act="diag">诊断</button></div>' +
        '<div class="jz-row"><button data-act="stop">停止</button>' +
          '<button data-act="csv" class="jz-primary">导出 CSV</button></div>' +
        '<div class="jz-row"><button data-act="clear">清空数据</button></div>' +
        '<div class="jz-msg"></div>' +
        '<div class="jz-diag" style="display:none">' +
          '<textarea class="jz-diag-txt" readonly></textarea>' +
          '<div class="jz-row" style="margin-top:6px"><button data-act="copy">复制诊断结果</button></div>' +
        '</div>' +
      '</div>';

    const css = document.createElement('style');
    css.textContent = [
      '#jzwz-panel{position:fixed;right:18px;bottom:18px;width:250px;z-index:2147483000;',
      'background:#fff;border:1px solid #d5dbe5;border-radius:10px;',
      'box-shadow:0 8px 24px rgba(15,35,70,.16);',
      'font:12px/1.55 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#2b3445}',
      '#jzwz-panel.diaging{width:470px}',
      '#jzwz-panel .jz-hd{display:flex;justify-content:space-between;align-items:center;',
      'padding:9px 12px;border-bottom:1px solid #eef1f6;font-weight:600;color:#1f4e79}',
      '#jzwz-panel .jz-hd i{font-style:normal;font-weight:400;color:#9aa4b4;font-size:11px}',
      '#jzwz-panel .jz-fold{cursor:pointer;color:#8a93a3;padding:0 4px;user-select:none}',
      '#jzwz-panel .jz-bd{padding:10px 12px 12px}',
      '#jzwz-panel.folded .jz-bd{display:none}',
      '#jzwz-panel .jz-status{color:#5b6577;margin-bottom:8px;word-break:break-all}',
      '#jzwz-panel .jz-status b{color:#1f4e79}',
      '#jzwz-panel .jz-row{display:flex;gap:6px;margin-bottom:6px}',
      '#jzwz-panel button{flex:1;padding:6px 4px;border:1px solid #ccd4e0;border-radius:6px;',
      'background:#f7f9fc;color:#2b3445;font-size:12px;cursor:pointer;transition:.15s}',
      '#jzwz-panel button:hover:not(:disabled){background:#eaf1fb;border-color:#a9c4e6}',
      '#jzwz-panel button:disabled{cursor:default}',
      '#jzwz-panel button.jz-primary{background:#218af4;border-color:#218af4;color:#fff}',
      '#jzwz-panel button.jz-primary:hover:not(:disabled){background:#1477d8}',
      '#jzwz-panel .jz-msg{margin-top:4px;color:#8a93a3;font-size:11px;line-height:1.5;word-break:break-all}',
      '#jzwz-panel .jz-diag-txt{width:100%;height:280px;box-sizing:border-box;margin-top:8px;',
      'border:1px solid #d5dbe5;border-radius:6px;padding:8px;font:11px/1.5 Menlo,Consolas,monospace;',
      'color:#2b3445;background:#fbfcfe;resize:vertical}'
    ].join('');

    document.head.appendChild(css);
    document.body.appendChild(panel);

    elStatus = panel.querySelector('.jz-status');
    elMsg = panel.querySelector('.jz-msg');
    elDiag = panel.querySelector('.jz-diag');

    panel.querySelector('.jz-hd').addEventListener('click', function (e) {
      if (e.target.classList.contains('jz-fold')) panel.classList.toggle('folded');
    });

    panel.addEventListener('click', async function (e) {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      const act = btn.dataset.act;

      if (act === 'one') {
        const r = harvest();
        refreshStatus();
        msg(r.ok ? ('本页 ' + r.pageRows + ' 条，新增 ' + r.added + ' 条，库存 ' + r.total + ' 条')
                 : '页面里没有数据，先点「查询」出结果');
      } else if (act === 'all') {
        runAll();
      } else if (act === 'diag') {
        elDiag.style.display = 'block';
        panel.classList.add('diaging');
        elDiag.querySelector('textarea').value = '诊断中…';
        msg('请求中，稍等');
        try {
          elDiag.querySelector('textarea').value = await diagnose();
          msg('诊断完成');
        } catch (err) {
          elDiag.querySelector('textarea').value = '诊断出错:\n' + ((err && err.stack) || err);
          msg('诊断出错');
        }
      } else if (act === 'copy') {
        const ta = elDiag.querySelector('textarea');
        ta.select();
        try { await navigator.clipboard.writeText(ta.value); msg('已复制'); }
        catch (err) { document.execCommand('copy'); msg('已复制'); }
      } else if (act === 'stop') {
        running = false; saveDB(loadDB()); refreshStatus(); msg('已停止，数据已保存');
      } else if (act === 'csv') {
        exportCSV();
      } else if (act === 'clear') {
        if (confirm('确定清空已采集的数据？建议先导出 CSV。')) {
          localStorage.removeItem(DB_KEY);
          refreshStatus();
          msg('已清空');
        }
      }
    });
  }

  /* ============================ 启动 ============================ */
  function init() {
    if (document.getElementById('jzwz-panel')) return;
    // 只在岗位查询页出现面板
    if (!document.getElementById('tablelist') && !document.getElementById('cxtj2')) return;
    buildPanel();
    refreshStatus();
    log('ready v' + VERSION, pagerInfo(), 'db=' + dbCount());
  }

  init();
  // 查询结果由 ajax 渲染，面板可能要晚几百毫秒才能插入
  let tries = 0;
  const timer = setInterval(function () {
    if (document.getElementById('jzwz-panel')) { clearInterval(timer); return; }
    if (document.getElementById('tablelist') || document.getElementById('cxtj2')) { clearInterval(timer); init(); return; }
    if (++tries > 40) clearInterval(timer);
  }, 500);
})();
