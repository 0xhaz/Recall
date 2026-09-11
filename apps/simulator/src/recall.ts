import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

/** The simulator reaches Recall only through MCP, as Alexa+ would (workplan WS12). */
export interface RecallApi {
  tools(): Promise<ToolInfo[]>;
  call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
}

export class RecallClient implements RecallApi {
  private client: Client | null = null;
  private toolList: ToolInfo[] | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async tools(): Promise<ToolInfo[]> {
    if (!this.toolList) this.toolList = (await (await this.connect()).listTools()).tools as ToolInfo[];
    return this.toolList;
  }

  async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    let text = '';
    try {
      const result = await (await this.connect()).callTool({ name, arguments: args });
      text = (result.content as { type: string; text?: string }[])[0]?.text ?? '';
      if (result.isError) throw new Error(text);
    } catch (err) {
      // A restarted server drops the connection: the next call reconnects.
      this.client = null;
      throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return JSON.parse(text) as T;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: 'recall-simulator', version: '0.1.0' });
    const headers: Record<string, string> = this.token ? { Authorization: `Bearer ${this.token}` } : {};
    await client.connect(new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers } }));
    this.client = client;
    return client;
  }
}
