export const LX_SHIM = String.raw`
(function () {
  var listeners = Object.create(null);

  function emit(name, data) {
    var payload = JSON.stringify(data);
    if (typeof globalThis.__songloftEmitEvent === 'function') {
      globalThis.__songloftEmitEvent(name, payload);
      return;
    }
    if (typeof globalThis.__go_send === 'function') {
      globalThis.__go_send(name, payload);
    }
  }

  globalThis.lx = globalThis.lx || {};
  globalThis.lx.version = globalThis.lx.version || '2.0.0';
  globalThis.lx.env = 'desktop';
  globalThis.lx.platform = globalThis.lx.platform || 'web';
  globalThis.lx.EVENT_NAMES = globalThis.lx.EVENT_NAMES || {
    request: 'request',
    inited: 'inited',
    updateAlert: 'updateAlert',
  };
  globalThis.lx.currentScriptInfo = globalThis.lx.currentScriptInfo || {
    name: '',
    version: '',
    description: '',
    author: '',
    homepage: '',
  };
  globalThis.lx.utils = globalThis.lx.utils || {};
  globalThis.lx.utils.buffer = globalThis.lx.utils.buffer || {
    from: function (data, encoding) {
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(data, encoding);
      }

      if (typeof data === 'string' && typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(data);
      }

      return data;
    },
    bufToString: function (buffer, encoding) {
      if (typeof buffer === 'string') {
        return buffer;
      }

      if (buffer && typeof buffer.toString === 'function' && buffer.toString !== Object.prototype.toString) {
        return buffer.toString(encoding || 'utf-8');
      }

      if (typeof TextDecoder !== 'undefined') {
        try {
          return new TextDecoder(encoding || 'utf-8').decode(buffer);
        } catch (_) {
          return String(buffer || '');
        }
      }

      return String(buffer || '');
    },
  };
  globalThis.currentScriptInfo = globalThis.lx.currentScriptInfo;

  globalThis.lx.on = function (name, handler) {
    listeners[name] = handler;
  };

  globalThis.lx.send = function (name, data) {
    emit(name, data);
  };

  globalThis.lx.request = function (url, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    options = options || {};

    var requestOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    var timeoutMs = Number(options.timeout || 0);

    if (options.body !== undefined) {
      requestOptions.body = options.body;
    } else if (options.data !== undefined) {
      requestOptions.body = options.data;
    }

    return new Promise(function (resolve, reject) {
      var settled = false;
      var timeoutId = null;

      function clearRequestTimeout() {
        if (timeoutId !== null && typeof clearTimeout === 'function') {
          clearTimeout(timeoutId);
        }
        timeoutId = null;
      }

      function fail(error) {
        if (settled) return;
        settled = true;
        clearRequestTimeout();
        if (typeof callback === 'function') {
          callback(error, null, null);
          resolve(null);
          return;
        }

        reject(error);
      }

      function succeed(result, body) {
        if (settled) return;
        settled = true;
        clearRequestTimeout();
        if (typeof callback === 'function') {
          callback(null, result, body);
        }
        resolve(result);
      }

      if (timeoutMs > 0 && typeof setTimeout === 'function') {
        timeoutId = setTimeout(function () {
          fail(new Error('Request timeout after ' + timeoutMs + 'ms'));
        }, timeoutMs);
      } else if (timeoutMs > 0) {
        fail(new Error('Request timeout after ' + timeoutMs + 'ms'));
        return;
      }

      fetch(url, requestOptions)
        .then(function (response) {
          return response.text().then(function (body) {
            var headers = {};
            if (response.headers && response.headers.forEach) {
              response.headers.forEach(function (value, key) {
                headers[key] = value;
              });
            }

            succeed({
              status: response.status,
              statusCode: response.status,
              statusMessage: response.statusText || '',
              headers: headers,
              body: body,
              data: body,
            }, body);
          });
        })
        .catch(function (error) {
          fail(error);
        });
    });
  };

  globalThis.lx._dispatch = function (id, event, payload) {
    var handler = listeners[event];
    if (typeof handler !== 'function') {
      emit('dispatchError', {
        id: id,
        error: 'No listener registered for event: ' + event,
      });
      return;
    }

    Promise.resolve()
      .then(function () {
        return handler(payload);
      })
      .then(function (result) {
        emit('dispatchResult', {
          id: id,
          result: result === undefined ? null : result,
        });
      })
      .catch(function (error) {
        emit('dispatchError', {
          id: id,
          error: String(error && error.message || error),
        });
      });
  };
}());
`;
