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
      setFileInputFiles(params: { files: string[]; backendNodeId: number }): Promise<void>;
      getBoxModel(params: { backendNodeId: number }): Promise<{
        model: {
          content: number[];
          padding: number[];
          border: number[];
          margin: number[];
          width: number;
          height: number;
        };
      }>;
    };
    Page: {
      enable(): Promise<void>;
      navigate(params: { url: string }): Promise<unknown>;
      loadEventFired(): Promise<unknown>;
      captureScreenshot(params: {
        format?: string;
        clip?: { x: number; y: number; width: number; height: number; scale: number };
        captureBeyondViewport?: boolean;
      }): Promise<{ data: string }>;
      setDownloadBehavior(params: {
        behavior: string;
        downloadPath?: string;
      }): Promise<void>;
      on(event: string, callback: (params: any) => void): void;
      removeListener(event: string, callback: (params: any) => void): void;
    };
    Runtime: {
      enable(): Promise<void>;
      evaluate(params: {
        expression: string;
        returnByValue?: boolean;
        awaitPromise?: boolean;
        userGesture?: boolean;
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
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
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
