// Minimal declarations for the Node built-ins this project uses. `typescript`
// is the only dev dependency (no @types/node), so these cover just enough of
// `process`, node:util, node:test, node:assert and node:child_process for
// `npm run typecheck`. Runtime behaviour comes from Node itself.

interface WritableLike {
  write(chunk: string): boolean;
}

declare var process: {
  argv: string[];
  execPath: string;
  exitCode: number | undefined;
  stdout: WritableLike;
  stderr: WritableLike;
};

declare module "node:util" {
  interface OptionConfig {
    type: "string" | "boolean";
    default?: string | boolean;
    short?: string;
  }
  export function parseArgs(config: {
    args?: string[];
    options?: Record<string, OptionConfig>;
    allowPositionals?: boolean;
    strict?: boolean;
  }): { values: Record<string, string | boolean | undefined>; positionals: string[] };
}

declare module "node:test" {
  type Body = () => void | Promise<void>;
  export function test(name: string, fn: Body): Promise<void>;
  export function describe(name: string, fn: () => void): Promise<void>;
  export function before(fn: Body): void;
}

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    match(value: string, pattern: RegExp, message?: string): void;
    doesNotMatch(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}

declare module "node:child_process" {
  interface Readable {
    on(event: "data", listener: (chunk: { toString(): string }) => void): void;
  }
  interface ChildProcess {
    stdout: Readable;
    stderr: Readable;
    on(event: "close", listener: (code: number | null) => void): void;
  }
  export function spawn(command: string, args: string[], options?: { cwd?: string }): ChildProcess;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
