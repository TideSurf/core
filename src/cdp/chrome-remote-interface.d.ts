declare module "chrome-remote-interface" {
  interface CDPOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    target?: number | string;
    useHostName?: boolean;
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
      resolveNode(params: { backendNodeId: number }): Promise<{ object: { objectId?: string } }>;
      setFileInputFiles(params: {
        files: string[];
        backendNodeId?: number;
        objectId?: string;
      }): Promise<void>;
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
      setLifecycleEventsEnabled(params: { enabled: boolean }): Promise<void>;
      navigate(params: { url: string }): Promise<{
        errorText?: string;
        loaderId?: string;
      }>;
      lifecycleEvent(callback: (event: {
        name: string;
        loaderId: string;
      }) => void): () => void;
      captureScreenshot(params: {
        format?: string;
        clip?: { x: number; y: number; width: number; height: number; scale: number };
        captureBeyondViewport?: boolean;
      }): Promise<{ data: string }>;
      setDownloadBehavior(params: {
        behavior: string;
        downloadPath?: string;
      }): Promise<void>;
      on(event: string, callback: (params: any) => void): () => void;
    };
    Runtime: {
      enable(): Promise<void>;
      evaluate(params: {
        expression: string;
        returnByValue?: boolean;
        awaitPromise?: boolean;
        userGesture?: boolean;
      }): Promise<{
        result: {
          value?: unknown;
          unserializableValue?: string;
          description?: string;
        };
        exceptionDetails?: {
          text?: string;
          exception?: {
            description?: string;
            value?: unknown;
          };
        };
      }>;
      callFunctionOn(params: {
        objectId: string;
        functionDeclaration: string;
        arguments?: Array<{
          value?: unknown;
          unserializableValue?: string;
          objectId?: string;
        }>;
        returnByValue?: boolean;
      }): Promise<{
        result?: {
          value?: unknown;
          unserializableValue?: string;
          description?: string;
        };
        exceptionDetails?: {
          text?: string;
          exception?: {
            description?: string;
            value?: unknown;
          };
        };
      }>;
      releaseObject(params: { objectId: string }): Promise<void>;
    };
    Emulation: {
      setDeviceMetricsOverride(params: {
        width: number;
        height: number;
        deviceScaleFactor: number;
        mobile: boolean;
      }): Promise<void>;
    };
    once(event: "disconnect", callback: () => void): Client;
    removeListener(event: "disconnect", callback: () => void): Client;
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    close(): Promise<void>;
  }

  function CDP(options?: CDPOptions): Promise<Client>;

  namespace CDP {
    function List(options?: { host?: string; port?: number; useHostName?: boolean }): Promise<Target[]>;
    function New(options?: { host?: string; port?: number; url?: string; useHostName?: boolean }): Promise<Target>;
    function Close(options?: { host?: string; port?: number; id: string; useHostName?: boolean }): Promise<void>;
    function Version(options?: {
      host?: string;
      port?: number;
      useHostName?: boolean;
    }): Promise<unknown>;
  }

  export default CDP;
  export { Client, Target };
}
