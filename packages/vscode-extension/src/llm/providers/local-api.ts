import { OpenAICompatProvider } from './openai-compat';

export class LocalApiProvider extends OpenAICompatProvider {
  constructor() {
    super({
      type: 'local-api',
      displayName: '$(server) 本地API',
      baseUrlKey: 'localApiBaseUrl',
      apiKeyKey: 'localApiApiKey',
      modelKey: 'localApiModel',
      defaultBaseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3',
    });
  }
}
