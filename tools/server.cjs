const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-cache',
    'Content-Type': contentType,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createStaticServer(rootDirectory) {
  const root = path.resolve(rootDirectory);

  return http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      send(res, 405, 'Method Not Allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    } catch {
      send(res, 400, 'Bad Request');
      return;
    }

    const requestedPath = path.resolve(root, `.${pathname}`);
    if (!isInsideRoot(root, requestedPath)) {
      send(res, 403, 'Forbidden');
      return;
    }

    fs.stat(requestedPath, (statError, stats) => {
      let filePath = requestedPath;
      if (!statError && stats.isDirectory()) filePath = path.join(requestedPath, 'index.html');

      fs.stat(filePath, (fileError, fileStats) => {
        if (fileError || !fileStats.isFile()) {
          send(
            res,
            404,
            '<!doctype html><meta charset="utf-8"><title>404</title><p>Not Found</p>',
            'text/html; charset=utf-8',
          );
          return;
        }

        const contentType = contentTypes.get(path.extname(filePath).toLowerCase())
          || 'application/octet-stream';
        res.writeHead(200, {
          'Cache-Control': 'no-cache',
          'Content-Length': fileStats.size,
          'Content-Type': contentType,
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-Content-Type-Options': 'nosniff',
        });

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        const stream = fs.createReadStream(filePath);
        stream.on('error', (error) => {
          if (!res.headersSent) send(res, 500, 'Internal Server Error');
          else res.destroy(error);
        });
        stream.pipe(res);
      });
    });
  });
}

function readPort(argv) {
  const flagIndex = argv.indexOf('--port');
  const value = flagIndex >= 0 ? argv[flagIndex + 1] : process.env.PORT || '4173';
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

if (require.main === module) {
  try {
    const port = readPort(process.argv.slice(2));
    const host = '127.0.0.1';
    const server = createStaticServer(path.resolve(__dirname, '..', 'dist'));
    server.on('error', (error) => {
      process.stderr.write(`${JSON.stringify({ error: 'SERVER_ERROR', message: error.message })}\n`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      const address = server.address();
      process.stdout.write(`${JSON.stringify({ status: 'listening', url: `http://${host}:${address.port}/` })}\n`);
    });
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: 'INVALID_ARGUMENT', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createStaticServer };
