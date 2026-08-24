export function resolveFileMentionInput(
  text: string,
  filePath: string,
  content: string | null,
): string {
  if (content === null) return text;
  const injection = `\n\n**文件内容 \`${filePath}\`：**\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``;
  return text.replace(`@${filePath}`, injection);
}
