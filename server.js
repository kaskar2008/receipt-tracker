const http = require("node:http");

const WEBHOOK_PATH = "/telegram-webhook";

function deferResponseEnd(response) {
  let endArgs;
  const deferredResponse = new Proxy(response, {
    get(target, property) {
      if (property === "end") {
        return (...args) => {
          endArgs = args;
          return deferredResponse;
        };
      }
      if (property === "writableEnded") return endArgs !== undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });

  return {
    response: deferredResponse,
    flush() {
      if (endArgs) response.end(...endArgs);
      else response.end();
    },
  };
}

function createHttpServer({ webhookHandler, logger = console }) {
  return http.createServer(async (req, res) => {
    // Cloud Run intercepts /healthz on public run.app URLs, so /health is an
    // externally reachable alias while /healthz remains available locally.
    if (
      req.method === "GET" &&
      (req.url === "/healthz" || req.url === "/health")
    ) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    if (req.method === "POST" && req.url === WEBHOOK_PATH) {
      const deferred = deferResponseEnd(res);
      try {
        await webhookHandler(req, deferred.response);
        deferred.flush();
      } catch (error) {
        logger.error("Ошибка обработки Telegram update:", error);
        // A valid update has already reached us. Returning 5xx makes Telegram
        // redeliver it repeatedly, which duplicates user-facing error replies.
        // Log the failure and acknowledge delivery; the user can resend the
        // original expense explicitly after correcting the underlying issue.
        if (!res.headersSent) {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        }
        if (!res.writableEnded) res.end("ok");
      }
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
}

function listen(server, port, host = "0.0.0.0") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function installShutdownHandlers(server, logger = console) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Получен ${signal}, HTTP-сервер завершается`);
    server.close((error) => {
      if (error) {
        logger.error("Ошибка завершения HTTP-сервера:", error);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

module.exports = {
  WEBHOOK_PATH,
  createHttpServer,
  deferResponseEnd,
  installShutdownHandlers,
  listen,
};
