export const DEEPSEEK_TOOL_TRANSCRIPT_FIXTURES = [
  {
    name: 'markdown-bold Calling read_file',
    text: [
      '我先核查一下当前代码状态。',
      '**Calling:** `read_file`',
      '```json',
      '{"path": "/home/ff/work/devseek_netai/code/shape_manager/main.cpp"}',
      '```',
    ].join('\n'),
    expectedToolNames: ['read_file'],
    expectedVisibleText: '我先核查一下当前代码状态。',
  },
  {
    name: 'fullwidth DSML read_file and list_dir',
    text: [
      '我来先查看当前 shape_manager 的完整代码，了解现有的渲染和交互逻辑。',
      '<｜｜DSML｜｜tool_calls>',
      '<｜｜DSML｜｜invoke name="read_file">',
      '<｜｜DSML｜｜parameter name="filePath" string="true">code/shape_manager/main.cpp</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '<｜｜DSML｜｜invoke name="list_dir">',
      '<｜｜DSML｜｜parameter name="path" string="true">code/shape_manager</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '</｜｜DSML｜｜tool_calls>',
    ].join('\n'),
    expectedToolNames: ['read_file', 'list_dir'],
    expectedVisibleText: '我来先查看当前 shape_manager 的完整代码，了解现有的渲染和交互逻辑。',
  },
  {
    name: 'XML self-closing read_file grep_search list_dir',
    text: [
      '让我先查看一下当前 `shape_manager` 项目的实现情况。',
      '<read_file path="/home/ff/work/devseek_netai/code/shape_manager/main.cpp" startLine="0" endLine="200"/>',
      '<grep_search pattern="glutMouseFunc|mouse|选择|select|keyboard|数字" directory="/home/ff/work/devseek_netai/code/shape_manager" fileTypes=".cpp,.h"/>',
      '<list_dir path="/home/ff/work/devseek_netai/code/shape_manager"/>',
    ].join('\n'),
    expectedToolNames: ['read_file', 'grep_search', 'list_dir'],
    expectedVisibleText: '让我先查看一下当前 `shape_manager` 项目的实现情况。',
  },
  {
    name: 'function-style search_content alias',
    text: [
      '我先查找鼠标回调。',
      'search_content({"pattern":"glutMouseFunc|mouse|keyboard","directory":"/home/ff/work/devseek_netai/code/shape_manager","fileTypes":"*.cpp,h"})',
    ].join('\n'),
    expectedToolNames: ['grep_search'],
    expectedVisibleText: '我先查找鼠标回调。',
  },
  {
    name: 'bracketed Chinese calling read_file and search_content',
    text: [
      '我理解您的需求，先核查当前实现。',
      '[调用 read_file] {"filePath":"/home/ff/work/devseek_netai/code/shape_manager/main.cpp", "offset": 0, "limit": 150}',
      '[调用 search_content] {"pattern": "glutKeyboardFunc|keyboard|数字", "directory": "/home/ff/work/devseek_netai/code/shape_manager", "fileTypes": ".cpp,.h"}',
    ].join('\n'),
    expectedToolNames: ['read_file', 'grep_search'],
    expectedVisibleText: '我理解您的需求，先核查当前实现。',
  },
  {
    name: 'Tool Arguments run_terminal',
    text: '好的，现在执行编译和运行。 Tool: run_terminal Arguments:{"command":"cmake -S . -B build && cmake --build build","is_background":false}',
    expectedToolNames: ['run_terminal'],
    expectedVisibleText: '好的，现在执行编译和运行。',
  },
];
