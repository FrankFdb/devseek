export const TOOL_PROTOCOL_SAMPLES = [
  {
    id: 'markdown-calling-read-file',
    text: [
      'I will inspect the file.',
      '**Calling:** `read_file`',
      '```json',
      '{"path": "/tmp/project/main.cpp"}',
      '```',
    ].join('\n'),
    expectedVisible: 'I will inspect the file.',
    expectedToolNames: ['read_file'],
  },
  {
    id: 'tool-arguments-list-dir',
    text: [
      'I will inspect the project.',
      'Tool: list_dirArguments: {"path":"/tmp/project"}',
    ].join('\n'),
    expectedVisible: 'I will inspect the project.',
    expectedToolNames: ['list_dir'],
  },
  {
    id: 'dsml-read-file',
    text: [
      'I will inspect the current file.',
      '< | DSML | tool_calls< | DSML | invoke name="read_file"< | DSML | parameter name="filePath" string="true">/tmp/project/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
    ].join('\n'),
    expectedVisible: 'I will inspect the current file.',
    expectedToolNames: ['read_file'],
  },
  {
    id: 'xml-self-closing-tools',
    text: [
      'I will inspect implementation points.',
      '<read_file path="/tmp/project/main.cpp" startLine="0" endLine="200"/>',
      '<grep_search pattern="glutMouseFunc|mouse|keyboard" directory="/tmp/project" fileTypes=".cpp,.h"/>',
      '<list_dir path="/tmp/project"/>',
    ].join('\n'),
    expectedVisible: 'I will inspect implementation points.',
    expectedToolNames: ['read_file', 'grep_search', 'list_dir'],
  },
  {
    id: 'paired-xml-tools',
    text: [
      'I will implement the change.',
      '<manage_todo_list>{"todoList":[{"id":1,"title":"Implement mouse selection","status":"in-progress"}]}</manage_todo_list>',
      '<run_terminal>',
      '{"command":"cd /tmp/project && cmake -S . -B build && cmake --build build"}',
      '</run_terminal>',
    ].join('\n'),
    expectedVisible: 'I will implement the change.',
    expectedToolNames: ['manage_todo_list', 'run_terminal'],
  },
  {
    id: 'prefixed-paired-xml-tools',
    text: [
      'I will inspect implementation points.',
      '<TOOL_list_dir>{"path":"/tmp/project/src/license"}</TOOL_list_dir>',
      '<TOOL_read_file>{"path":"/tmp/project/docs/uav-warranty-reminder-plan_v1.7.md"}</TOOL_read_file>',
    ].join('\n'),
    expectedVisible: 'I will inspect implementation points.',
    expectedToolNames: ['list_dir', 'read_file'],
  },
  {
    id: 'prefixed-open-xml-json-tools',
    text: [
      'I will finish validation.',
      '<TOOL_run_terminal> {"command":"ls -1 /tmp/project/src/*.hpp /tmp/project/src/*.cpp 2>/dev/null | wc -l","requires_approval":false}',
      '<TOOL_task_complete> {"summary":"Generated docs and source files; validation passed."}',
      'Validation evidence is ready.',
    ].join('\n'),
    expectedVisible: 'I will finish validation.\nValidation evidence is ready.',
    expectedToolNames: ['run_terminal', 'task_complete'],
  },
  {
    id: 'tool-call-envelope',
    text: [
      'I will run validation.',
      '<TOOL_CALL>run_terminal</TOOL_CALL>',
      '<TOOL_CALL>{"command":"cmake --build /tmp/project/build"}</TOOL_CALL>',
    ].join(''),
    expectedVisible: 'I will run validation.',
    expectedToolNames: ['run_terminal'],
  },
  {
    id: 'generic-tool-envelope',
    text: [
      'I will inspect the project.',
      '<TOOL>read_file {"path":"/tmp/project/main.cpp"}</TOOL>',
      '<TOOL>list_dir {"path":"/tmp/project"}</TOOL>',
    ].join(''),
    expectedVisible: 'I will inspect the project.',
    expectedToolNames: ['read_file', 'list_dir'],
  },
  {
    id: 'escaped-generic-tool-envelope',
    text: [
      'I will search the project.',
      '&lt;TOOL&gt;grep_search {&quot;pattern&quot;:&quot;TunnelTransport&quot;,&quot;path&quot;:&quot;/tmp/project&quot;}&lt;/TOOL&gt;',
    ].join(''),
    expectedVisible: 'I will search the project.',
    expectedToolNames: ['grep_search'],
  },
  {
    id: 'function-style-tools',
    text: [
      'I will locate the source files.',
      'read_file({"filePath":"/tmp/project/main.cpp"})',
      'list_dir({"path":"/tmp/project"})',
    ].join(''),
    expectedVisible: 'I will locate the source files.',
    expectedToolNames: ['read_file', 'list_dir'],
  },
  {
    id: 'json-tool-array',
    text: [
      'I will inspect the project.',
      '```json',
      '[',
      '  {"type":"list_dir","path":"/tmp/project"},',
      '  {"type":"read_file","path":"/tmp/project/main.cpp"}',
      ']',
      '```',
    ].join('\n'),
    expectedVisible: 'I will inspect the project.',
    expectedToolNames: ['list_dir', 'read_file'],
  },
  {
    id: 'react-glued-action-input',
    text: [
      'I need to read the file first.',
      'Action: read_fileAction Input: {"path":"/tmp/project/main.cpp"}',
    ].join(' '),
    expectedVisible: 'I need to read the file first.',
    expectedToolNames: ['read_file'],
  },
  {
    id: 'react-fenced-action-input',
    text: [
      'I need to read the file first.',
      'Action: read_file',
      'Action Input:',
      '```json',
      '{"path":"/tmp/project/main.cpp"}',
      '```',
      'Then I will edit it.',
    ].join('\n'),
    expectedVisible: 'I need to read the file first.\nThen I will edit it.',
    expectedToolNames: ['read_file'],
  },
];

export const TOOL_PROTOCOL_STREAMING_TAIL_SAMPLES = [
  {
    id: 'incomplete-react-action',
    text: 'I need to read the file first. Action: read_file',
    expectedVisible: 'I need to read the file first.',
    expectedToolNames: [],
  },
  {
    id: 'incomplete-tool-call-envelope',
    text: 'I will inspect the title.<TOOL',
    expectedVisible: 'I will inspect the title.',
    expectedToolNames: [],
  },
  {
    id: 'incomplete-generic-tool-envelope',
    text: 'I will inspect the file.<TOOL>read_file {"path":"/tmp/project/main.cpp"',
    expectedVisible: 'I will inspect the file.',
    expectedToolNames: [],
  },
  {
    id: 'incomplete-xml-tool',
    text: 'I will inspect the file.<read_file path="/tmp/project/main.cpp"',
    expectedVisible: 'I will inspect the file.',
    expectedToolNames: [],
  },
  {
    id: 'incomplete-prefixed-xml-tool',
    text: 'I will inspect the file.<TOOL_read_file>{"path":"/tmp/project/main.cpp"',
    expectedVisible: 'I will inspect the file.',
    expectedToolNames: [],
  },
];
