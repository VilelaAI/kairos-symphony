import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { Logger, MetricsRegistry } from '@kairos-symphony/core';

export interface ObservabilityServerOpts {
  host: string;
  port: number;
  registry: MetricsRegistry;
  log: Logger;
}

/**
 * Servidor HTTP local-first (§13.2) que expõe `/healthz` e `/metrics`. Usa
 * apenas o módulo `http` nativo — sem dependências novas. Bind em 127.0.0.1 por
 * default (não exposto à rede); operação remota é responsabilidade da platform.
 */
export class ObservabilityServer {
  private server: Server | null = null;

  constructor(private readonly opts: ObservabilityServerOpts) {}

  start(): Promise<void> {
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      const url = req.url ?? '/';
      if (req.method === 'GET' && url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end('{"status":"ok"}');
        return;
      }
      if (req.method === 'GET' && url === '/metrics') {
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(this.opts.registry.render());
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
    };

    return new Promise((resolve, reject) => {
      const server = createServer(handler);
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host, () => {
        server.removeListener('error', reject);
        this.server = server;
        this.opts.log.info({
          event: 'metrics_server_started',
          message: `Servidor de observabilidade em http://${this.opts.host}:${this.opts.port} (/healthz, /metrics)`,
        });
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    if (server === null) return Promise.resolve();
    this.server = null;
    return new Promise((resolve) => server.close(() => resolve()));
  }
}
