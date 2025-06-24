/**
 * 类型声明文件，确保 node-fetch 在所有环境中都有正确的类型
 */

declare module 'node-fetch' {
  export interface RequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  }

  export interface Response {
    ok: boolean;
    status: number;
    statusText: string;
    text(): Promise<string>;
    json(): Promise<any>;
  }

  function fetch(url: string, init?: RequestInit): Promise<Response>;
  export default fetch;
}
