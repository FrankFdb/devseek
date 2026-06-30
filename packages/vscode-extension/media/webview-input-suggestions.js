// Input suggestion helpers for slash and @ completions in the DevSeek webview.

const SLASH_CMDS = [
  { label: '/explain',  desc: '解释选中代码' },
  { label: '/fix',      desc: '修复 Bug（含 LSP 诊断）' },
  { label: '/refactor', desc: '重构代码' },
  { label: '/tests',    desc: '生成单元测试（框架自动检测）' },
  { label: '/test',     desc: '运行测试（在终端执行检测到的测试命令）' },
  { label: '/doc',      desc: '生成文档注释' },
  { label: '/commit',   desc: '生成 Git 提交信息（不需要选中代码）' },
  { label: '/shell',    desc: '自然语言转 Shell 命令' },
];

// P3-2: @ 提示词
 const AT_CMDS = [
  { label: '@workspace', desc: '注入工作区文件结构摘要' },
  { label: '@problems',  desc: '注入 诊断错误（同 #problems）' },
  { label: '@git',       desc: '注入 git diff（未暂存 + 暂存变更）' },
];

let suggestActiveIdx = 0;

function showSuggest(items) {
  if (!items.length) { hideSuggest(); return; }
  suggestActiveIdx = 0;
  suggestEl.innerHTML = items.map((it, i) =>
    `<div class="item${i===0?' active':''}" data-idx="${i}">
      <span class="lbl">${it.label}</span><span class="desc">${it.desc}</span>
    </div>`
  ).join('');
  suggestEl.style.display = 'block';
  suggestEl.querySelectorAll('.item').forEach(function(el) {
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      completeSuggest(items[parseInt(el.getAttribute('data-idx'))].label);
    });
  });
}

function hideSuggest() {
  suggestEl.style.display = 'none';
  suggestEl.innerHTML = '';
}

function moveSuggest(dir) {
  const items = suggestEl.querySelectorAll('.item');
  if (!items.length) return false;
  items[suggestActiveIdx].classList.remove('active');
  suggestActiveIdx = (suggestActiveIdx + dir + items.length) % items.length;
  items[suggestActiveIdx].classList.add('active');
  return true;
}

function completeSuggest(label) {
  const cur = inputEl.value;
  // Handle @ completions
  const atIdx = cur.search(/(?:^|\s)@\S*$/);
  if (label.startsWith('@') && atIdx >= 0) {
    const spaceAt = /(?:^|\s)@/.exec(cur.slice(atIdx));
    const insertAt = atIdx + (spaceAt ? spaceAt[0].indexOf('@') : 0);
    inputEl.value = cur.slice(0, insertAt) + label + ' ';
    hideSuggest();
    inputEl.focus();
    return;
  }
  // Handle / completions
  const slashIdx = cur.lastIndexOf('/');
  if (slashIdx >= 0) {
    inputEl.value = cur.slice(0, slashIdx) + label + ' ';
  } else {
    inputEl.value = label + ' ';
  }
  hideSuggest();
  inputEl.focus();
}
