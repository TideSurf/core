import { afterEach, describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import { ActionCommittedError, CDPConnectionError } from "../../src/errors.js";
import { TabManager } from "../../src/cdp/tab-manager.js";

const servers = new Set<Server>();

async function serve(
  listener: RequestListener
): Promise<{ port: number; server: Server }> {
  const server = createServer(listener);
  servers.add(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server has no TCP address");
  }
  return { port: address.port, server };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    servers.delete(server);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  servers.delete(server);
}

afterEach(async () => {
  await Promise.all([...servers].map(closeServer));
});

describe("TabManager mutation failures", () => {
  it("marks a reset create response as uncertain", async () => {
    const { port } = await serve((request) => request.socket.destroy());

    await expect(
      new TabManager(port, "127.0.0.1").createTab()
    ).rejects.toBeInstanceOf(ActionCommittedError);
  });

  it("marks a reset close response as uncertain", async () => {
    const { port } = await serve((request) => request.socket.destroy());

    await expect(
      new TabManager(port, "127.0.0.1").closeTab("target-1")
    ).rejects.toBeInstanceOf(ActionCommittedError);
  });

  it("preserves deterministic HTTP failures as connection errors", async () => {
    const { port } = await serve((_request, response) => {
      response.writeHead(500);
      response.end("target rejected");
    });

    await expect(
      new TabManager(port, "127.0.0.1").createTab()
    ).rejects.toMatchObject({
      name: "CDPConnectionError",
      message: "Failed to create tab: target rejected",
    });
  });

  it("keeps a refused pre-connect failure retryable", async () => {
    const { port, server } = await serve((_request, response) => response.end());
    await closeServer(server);

    await expect(
      new TabManager(port, "127.0.0.1").createTab()
    ).rejects.toBeInstanceOf(CDPConnectionError);
  });
});
