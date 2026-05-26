from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socket import timeout as SocketTimeout
import errno


HOST = "127.0.0.1"
PORT = 8000
ROOT_DIR = Path(__file__).resolve().parent.parent


class StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".json5"):
            return "application/json"
        return super().guess_type(path)

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, SocketTimeout, OSError) as error:
            if not self._is_ignorable_disconnect(error):
                raise

    def log_message(self, format, *args):
        # Keep the localhost server quiet unless there is a real problem.
        return

    @staticmethod
    def _is_ignorable_disconnect(error):
        if isinstance(error, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, SocketTimeout)):
            return True

        if isinstance(error, OSError):
            return error.errno in {
                errno.EPIPE,
                errno.ECONNABORTED,
                errno.ECONNRESET,
            }

        return False


def main():
    server = ThreadingHTTPServer((HOST, PORT), StaticHandler)
    print(f"Serving {ROOT_DIR} at http://{HOST}:{PORT}/")
    print(f"index.html: http://{HOST}:{PORT}/index.html")
    print(f"debug.html: http://{HOST}:{PORT}/debug.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
