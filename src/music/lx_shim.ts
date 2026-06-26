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
  function bridgeBuffer(hex) {
    return {
      _hex: hex,
      length: Math.floor(hex.length / 2),
      toString: function (encoding) {
        var format = encoding || 'utf-8';
        if (format === 'hex') {
          return hex;
        }
        if (typeof __go_buffer_to_string === 'function') {
          return __go_buffer_to_string(hex, format);
        }
        return hex;
      },
    };
  }

  function bufferFrom(data, encoding) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(data, encoding);
    }

    if (data && typeof data === 'object' && typeof data._hex === 'string') {
      return bridgeBuffer(data._hex);
    }

    if (typeof data === 'string') {
      if (typeof __go_buffer_from === 'function') {
        return bridgeBuffer(__go_buffer_from(data, encoding || 'utf-8'));
      }
      if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(data);
      }
    }

    return data;
  }

  function bufferToString(buffer, encoding) {
    var format = encoding || 'utf-8';
    if (typeof buffer === 'string') {
      return buffer;
    }

    if (buffer && typeof buffer === 'object' && typeof buffer._hex === 'string') {
      if (format === 'hex') {
        return buffer._hex;
      }
      if (typeof __go_buffer_to_string === 'function') {
        return __go_buffer_to_string(buffer._hex, format);
      }
      return buffer._hex;
    }

    if (buffer && typeof buffer.toString === 'function' && buffer.toString !== Object.prototype.toString) {
      return buffer.toString(format);
    }

    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder(format).decode(buffer);
      } catch (_) {
        return String(buffer || '');
      }
    }

    return String(buffer || '');
  }

  function bufferToHex(data) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(data).toString('hex');
    }
    if (data && typeof data === 'object' && typeof data._hex === 'string') {
      return data._hex;
    }
    if (typeof data === 'string' && typeof __go_buffer_from === 'function') {
      return __go_buffer_from(data, 'utf-8');
    }
    if (data && typeof data.length === 'number') {
      var hex = '';
      for (var index = 0; index < data.length; index += 1) {
        var byte = Number(data[index]) & 0xff;
        hex += byte.toString(16).padStart(2, '0');
      }
      return hex;
    }
    return '';
  }

  function bufferFromHex(hex) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(hex, 'hex');
    }
    return bridgeBuffer(hex);
  }

  function normalizeAesMode(mode) {
    var normalized = String(mode || '').toLowerCase();
    if (normalized.indexOf('ecb') >= 0) {
      return 'ecb';
    }
    if (normalized.indexOf('cbc') >= 0) {
      return 'cbc';
    }
    return normalized;
  }

  function bridgeCrypto() {
    return globalThis.crypto && typeof globalThis.crypto === 'object' ? globalThis.crypto : null;
  }

  globalThis.lx.utils.buffer = globalThis.lx.utils.buffer || {
    from: function (data, encoding) {
      return bufferFrom(data, encoding);
    },
    bufToString: function (buffer, encoding) {
      return bufferToString(buffer, encoding);
    },
  };
  globalThis.lx.utils.crypto = globalThis.lx.utils.crypto || {
    aesEncrypt: function (buffer, mode, key, iv) {
      var cryptoBridge = bridgeCrypto();
      var normalizedMode = normalizeAesMode(mode);
      if (cryptoBridge && typeof cryptoBridge.aesEncrypt === 'function') {
        return cryptoBridge.aesEncrypt(buffer, normalizedMode, key, iv || '');
      }
      if (typeof __go_crypto_aes_encrypt === 'function') {
        return bufferFromHex(__go_crypto_aes_encrypt(
          bufferToHex(buffer),
          normalizedMode,
          bufferToHex(key),
          iv ? bufferToHex(iv) : '',
        ));
      }
      throw new Error('lx.utils.crypto.aesEncrypt is not available');
    },
    md5: function (str) {
      var cryptoBridge = bridgeCrypto();
      if (cryptoBridge && typeof cryptoBridge.md5 === 'function') {
        return cryptoBridge.md5(str);
      }
      if (typeof __go_crypto_md5 === 'function') {
        return __go_crypto_md5(str);
      }
      throw new Error('lx.utils.crypto.md5 is not available');
    },
    randomBytes: function (size) {
      var cryptoBridge = bridgeCrypto();
      if (cryptoBridge && typeof cryptoBridge.randomBytes === 'function') {
        return cryptoBridge.randomBytes(size);
      }
      if (typeof __go_crypto_random_bytes === 'function') {
        return bufferFromHex(__go_crypto_random_bytes(size));
      }
      var bytes = new Uint8Array(size);
      if (cryptoBridge && typeof cryptoBridge.getRandomValues === 'function') {
        cryptoBridge.getRandomValues(bytes);
      } else {
        for (var index = 0; index < size; index += 1) {
          bytes[index] = Math.floor(Math.random() * 256);
        }
      }
      return bufferFrom(bytes);
    },
    rsaEncrypt: function (buffer, key) {
      var cryptoBridge = bridgeCrypto();
      if (cryptoBridge && typeof cryptoBridge.rsaEncrypt === 'function') {
        return cryptoBridge.rsaEncrypt(buffer, key);
      }
      if (typeof __go_crypto_rsa_encrypt === 'function') {
        return bufferFromHex(__go_crypto_rsa_encrypt(bufferToHex(buffer), key));
      }
      throw new Error('lx.utils.crypto.rsaEncrypt is not available');
    },
  };
  globalThis.lx.utils.zlib = globalThis.lx.utils.zlib || {
    inflate: function (buf) {
      return new Promise(function (resolve, reject) {
        try {
          if (typeof __go_zlib_inflate === 'function') {
            resolve(bufferFromHex(__go_zlib_inflate(bufferToHex(buf))));
            return;
          }
          if (globalThis.zlib && typeof globalThis.zlib.inflate === 'function') {
            if (globalThis.zlib.inflate.length >= 2) {
              globalThis.zlib.inflate(buf, function (error, data) {
                if (error) reject(new Error(error.message || String(error)));
                else resolve(data);
              });
            } else {
              resolve(globalThis.zlib.inflate(buf));
            }
            return;
          }
          if (globalThis.pako && typeof globalThis.pako.inflate === 'function') {
            resolve(bufferFrom(globalThis.pako.inflate(buf)));
            return;
          }
          reject(new Error('lx.utils.zlib.inflate is not available'));
        } catch (error) {
          reject(error);
        }
      });
    },
    deflate: function (data) {
      return new Promise(function (resolve, reject) {
        try {
          if (typeof __go_zlib_deflate === 'function') {
            resolve(bufferFromHex(__go_zlib_deflate(bufferToHex(data))));
            return;
          }
          if (globalThis.zlib && typeof globalThis.zlib.deflate === 'function') {
            if (globalThis.zlib.deflate.length >= 2) {
              globalThis.zlib.deflate(data, function (error, buf) {
                if (error) reject(new Error(error.message || String(error)));
                else resolve(buf);
              });
            } else {
              resolve(globalThis.zlib.deflate(data));
            }
            return;
          }
          if (globalThis.pako && typeof globalThis.pako.deflate === 'function') {
            resolve(bufferFrom(globalThis.pako.deflate(data)));
            return;
          }
          reject(new Error('lx.utils.zlib.deflate is not available'));
        } catch (error) {
          reject(error);
        }
      });
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

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var requestOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    if (controller) {
      requestOptions.signal = controller.signal;
    }
    var timeoutMs = Number(options.timeout || 0);

    if (options.body !== undefined) {
      requestOptions.body = options.body;
    } else if (options.data !== undefined) {
      requestOptions.body = options.data;
    } else if (options.form !== undefined && typeof URLSearchParams !== 'undefined') {
      requestOptions.body = new URLSearchParams(options.form).toString();
      if (!requestOptions.headers['content-type'] && !requestOptions.headers['Content-Type']) {
        requestOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
      }
    } else if (options.formData !== undefined) {
      requestOptions.body = options.formData;
    }

    var requestPromise = new Promise(function (resolve, reject) {
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
          if (controller) {
            try {
              controller.abort();
            } catch (_) {}
          }
          fail(new Error('Request timeout after ' + timeoutMs + 'ms'));
        }, timeoutMs);
      } else if (timeoutMs > 0) {
        fail(new Error('Request timeout after ' + timeoutMs + 'ms'));
        return;
      }

      fetch(url, requestOptions)
        .then(function (response) {
          return response.text().then(function (rawBody) {
            var headers = {};
            if (response.headers && response.headers.forEach) {
              response.headers.forEach(function (value, key) {
                headers[key] = value;
              });
            }
            var body = rawBody;
            try {
              body = JSON.parse(rawBody);
            } catch (_) {}

            succeed({
              status: response.status,
              statusCode: response.status,
              statusMessage: response.statusText || '',
              headers: headers,
              raw: rawBody,
              body: body,
              data: body,
            }, body);
          });
        })
        .catch(function (error) {
          fail(error);
        });
    });

    function cancel() {
      if (controller) {
        controller.abort();
      }
    }
    cancel.then = requestPromise.then.bind(requestPromise);
    cancel.catch = requestPromise.catch.bind(requestPromise);
    cancel.finally = requestPromise.finally ? requestPromise.finally.bind(requestPromise) : undefined;
    cancel.promise = requestPromise;
    return cancel;
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
