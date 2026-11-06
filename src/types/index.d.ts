// src/types/index.d.ts
declare module 'bcryptjs';
declare module 'cors';
declare module 'express-rate-limit';
declare module 'helmet';
declare module 'pino';
declare module 'pino-pretty';

declare module 'express' {
  export interface Request {
    body?: any;
    query?: any;
    params?: any;
    headers?: any;
    ip?: string;
    socket?: any;
    app?: any;
    user?: any;
    sanitizedBody?: any;
    id?: string;
    startTime?: number;
    [key: string]: any;
  }

  export interface Response {
    status(code: number): this;
    json(body?: any): this;
    send(body?: any): this;
    setHeader(name: string, value: any): this;
    getHeader(name: string): any;
    removeHeader(name: string): this;
    headersSent: boolean;
    statusCode: number;
    [key: string]: any;
  }

  export type NextFunction = (err?: any) => void;

  export interface Router {
    get(path: string, ...handlers: any[]): this;
    post(path: string, ...handlers: any[]): this;
    put(path: string, ...handlers: any[]): this;
    patch(path: string, ...handlers: any[]): this;
    delete(path: string, ...handlers: any[]): this;
    use(...handlers: any[]): this;
    [key: string]: any;
  }

  export function Router(): Router;

  export interface Express extends Router {
    set(setting: string, val: any): this;
    use(...handlers: any[]): this;
    listen(port: number | string, cb?: () => void): any;
  }

  const express: (() => Express) & {
    Router: () => Router;
    json: () => any;
    urlencoded: (options?: any) => any;
    static: (root: string) => any;
  };

  export default express;
}

declare module 'jsonwebtoken' {
  export interface SignOptions {
    expiresIn?: string | number;
    issuer?: string;
    audience?: string | string[];
    subject?: string;
    algorithm?: string;
    [key: string]: any;
  }

  export interface JwtPayload {
    [key: string]: any;
    iss?: string;
    sub?: string;
    aud?: string | string[];
    exp?: number;
    nbf?: number;
    iat?: number;
    jti?: string;
  }

  export interface VerifyOptions {
    issuer?: string | string[];
    audience?: string | RegExp | Array<string | RegExp>;
    [key: string]: any;
  }

  export function sign(payload: any, secretOrPrivateKey: any, options?: SignOptions): string;
  export function verify(token: string, secretOrPublicKey: any, options?: VerifyOptions): any;
  export function decode(token: string, options?: any): any;

  const jwt: {
    sign: typeof sign;
    verify: typeof verify;
    decode: typeof decode;
  };

  export default jwt;
}

declare module 'pg' {
  export interface PoolConfig {
    connectionString?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    [key: string]: any;
  }

  export interface QueryResult<T = any> {
    rows: T[];
    rowCount: number;
    command: string;
    oid: number;
    fields: any[];
  }

  export interface PoolClient {
    query(text: string, values?: any[]): Promise<QueryResult>;
    release(err?: Error | boolean): void;
    [key: string]: any;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    connect(): Promise<PoolClient>;
    query(text: string, values?: any[]): Promise<QueryResult>;
    end(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): this;
    [key: string]: any;
  }
}
