declare module "chrome-remote-interface" {
  interface CDPOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    target?: number | string;
  }

  interface Target {
    id: string;
    url: string;
    title: string;
    type: string;
    description: string;
    webSocketDebuggerUrl: string;
  }

  interface Client {
    DOM: {
      enable(): Promise<void>;
      getDocument(params: { depth?: number; pierce?: boolean }): Promise<{ root: unknown }>;
      resolveNode(params: { backendNodeId: number }): Promise<{ object: { objectId?: string } }>;
    };
    Page: {
      enable(): Promise<void>;
      navigate(params: { url: string }): Promise<unknown>;
      loadEventFired(): Promise<unknown>;
    };
    Runtime: {
      enable(): Promise<void>;
      evaluate(params: {
        expression: string;
        returnByValue?: boolean;
        awaitPromise?: boolean;
      }): Promise<{
        result: { value?: unknown };
        exceptionDetails?: { text?: string };
      }>;
      callFunctionOn(params: {
        objectId: string;
        functionDeclaration: string;
        returnByValue?: boolean;
      }): Promise<unknown>;
      releaseObject(params: { objectId: string }): Promise<void>;
    };
    Input: {
      dispatchKeyEvent(params: {
        type: string;
        text?: string;
        key?: string;
      }): Promise<void>;
    };
    close(): Promise<void>;
  }

  function CDP(options?: CDPOptions): Promise<Client>;

  namespace CDP {
    function List(options?: { host?: string; port?: number }): Promise<Target[]>;
    function New(options?: { host?: string; port?: number; url?: string }): Promise<Target>;
    function Close(options?: { host?: string; port?: number; id: string }): Promise<void>;
  }

  export default CDP;
  export { Client, Target };
}
