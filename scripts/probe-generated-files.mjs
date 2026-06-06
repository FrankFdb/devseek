import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const prompts = [
  '在 code 目录下创建一个 helloworld.cpp，输出完整代码，并附上编译运行说明。',
  '请修改 code/helloworld.cpp，给出 unified diff。',
  '请解释下面这段代码为什么慢，只解释不要修改文件。',
  '请为 code/test_count.cpp 增加参数校验，优先返回可应用的变更格式。',
];

const outDir = path.join('/home/ff/work/deepseek_netai', 'artifacts', 'generated-file-probes');
mkdirSync(outDir, { recursive: true });

for (let index = 0; index < prompts.length; index += 1) {
  const prompt = prompts[index];
  const content = await postChat(prompt);
  const file = path.join(outDir, `${String(index + 1).padStart(2, '0')}.md`);
  writeFileSync(file, `# Prompt\n\n${prompt}\n\n# Response\n\n${content}\n`, 'utf8');
  console.log(`saved: ${file}`);
}

function postChat(prompt) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:3721/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.content || data);
          } catch {
            resolve(data);
          }
        });
      },
    );

    req.on('error', reject);
    req.write(JSON.stringify({ prompt, stream: false, newSession: true }));
    req.end();
  });
}