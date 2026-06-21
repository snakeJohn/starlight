export const LX_SHIM = String.raw`
(function () {
  var listeners = Object.create(null);

  function emit(name, data) {
    globalThis.__songloftEmitEvent(name, JSON.stringify(data));
  }

  globalThis.lx = globalThis.lx || {};
  globalThis.lx.env = 'desktop';
  globalThis.lx.currentScriptInfo = globalThis.lx.currentScriptInfo || {
    name: '',
    version: '',
    description: '',
    author: '',
    homepage: '',
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

    if (options.body !== undefined) {
      requestOptions.body = options.body;
    } else if (options.data !== undefined) {
      requestOptions.body = options.data;
    }

    return fetch(url, requestOptions)
      .then(function (response) {
        return response.text().then(function (body) {
          var headers = {};
          if (response.headers && response.headers.forEach) {
            response.headers.forEach(function (value, key) {
              headers[key] = value;
            });
          }

          var result = {
            status: response.status,
            statusCode: response.status,
            headers: headers,
            body: body,
            data: body,
          };

          if (typeof callback === 'function') {
            callback(null, result);
          }

          return result;
        });
      })
      .catch(function (error) {
        if (typeof callback === 'function') {
          callback(error);
          return null;
        }

        throw error;
      });
  };

  globalThis.lx._dispatch = function (id, event, payload) {
    var handler = listeners[event];
    if (typeof handler !== 'function') {
      emit('dispatchError', {
        id: id,
        event: event,
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
          event: event,
          result: result === undefined ? null : result,
        });
      })
      .catch(function (error) {
        emit('dispatchError', {
          id: id,
          event: event,
          error: error && error.stack ? error.stack : String(error),
        });
      });
  };
}());
`;
