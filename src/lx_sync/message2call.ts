/**
 * Minimal message2call implementation compatible with lx-music clients (v0.1.3).
 * Message shape: { name, path?, data?, error? }
 */

export type Msg2CallMessage = {
  name: string;
  path?: string[];
  data?: unknown;
  error?: string | null;
};

export type CreateMsg2CallOptions = {
  funcsObj: Record<string, unknown>;
  sendMessage: (data: Msg2CallMessage) => void;
  timeout?: number;
  onError?: (error: Error, path: string[], groupName: string | null) => void;
  onCallBeforeParams?: (args: unknown[]) => unknown[];
};

type EventHandler = ((err: string | null | undefined, data: unknown) => void) & {
  timeout?: ReturnType<typeof setTimeout> | null;
};

type QueueGroup = {
  handling: boolean;
  queue: Array<[() => void, (error: Error) => void]>;
};

const nextTick = (fn: () => void): void => {
  if (typeof queueMicrotask === 'function') queueMicrotask(fn);
  else setTimeout(fn, 0);
};

export function createMsg2call(options: CreateMsg2CallOptions) {
  const events = new Map<string, EventHandler>();
  const queueGroups = new Map<string, QueueGroup>();
  const timeoutMs = options.timeout ?? 120_000;
  const onError = options.onError ?? (() => {});
  const onCallBeforeParams = options.onCallBeforeParams;
  const sendMessage = options.sendMessage;
  const funcsObj = options.funcsObj;

  async function handleResponseData(eventName: string, path: string[], args: unknown[]) {
    let obj: unknown = funcsObj;
    const names = path.slice();
    const name = names.pop();
    if (!name) {
      sendMessage({ name: eventName, error: 'empty path' });
      return;
    }
    for (const part of names) {
      obj = (obj as Record<string, unknown>)?.[part];
      if (obj === undefined) {
        sendMessage({ name: eventName, error: `${name} is not defined` });
        return;
      }
    }
    const target = (obj as Record<string, unknown>)?.[name];
    if (typeof target === 'function') {
      let callArgs = Array.isArray(args) ? args : [];
      try {
        if (onCallBeforeParams) callArgs = onCallBeforeParams(callArgs) as unknown[];
        const result = await (target as (...a: unknown[]) => unknown).apply(obj, callArgs);
        sendMessage({ name: eventName, error: null, data: result });
      } catch (err) {
        sendMessage({
          name: eventName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    if (target === undefined) {
      sendMessage({ name: eventName, error: `${name} is not defined` });
      return;
    }
    sendMessage({ name: eventName, error: null, data: target });
  }

  function handleGroupNextTask(groupName: string, error?: Error) {
    nextTick(() => {
      const group = queueGroups.get(groupName);
      if (!group) return;
      group.handling = false;
      if (!group.queue.length) return;
      if (error == null) group.queue.shift()![0]();
      else group.queue.shift()![1](error);
    });
  }

  async function getData(groupName: string | null, pathname: string[], data?: unknown) {
    const eventName = `${pathname.join('.')}__${String(Math.random()).substring(2)}`;
    if (groupName != null) {
      let group = queueGroups.get(groupName);
      if (!group) {
        group = { handling: false, queue: [] };
        queueGroups.set(groupName, group);
      }
      if (group.handling) {
        await new Promise<void>((resolve, reject) => {
          group!.queue.push([
            resolve,
            (error) => {
              reject(error);
              onError(error, pathname, groupName);
              handleGroupNextTask(groupName, error);
            },
          ]);
        });
      }
      group.handling = true;
    }

    let promise: Promise<unknown> = new Promise((resolve, reject) => {
      const handler: EventHandler = (err, payload) => {
        if (handler.timeout) clearTimeout(handler.timeout);
        events.delete(eventName);
        if (err == null) resolve(payload);
        else {
          const error = new Error(err);
          onError(error, pathname, groupName);
          reject(error);
        }
      };
      events.set(eventName, handler);
      handler.timeout = setTimeout(() => {
        handler.timeout = null;
        handler('timeout', undefined);
      }, timeoutMs);
      sendMessage({
        name: eventName,
        path: pathname,
        data,
      });
    });

    if (groupName != null) {
      promise = promise
        .then((payload) => {
          handleGroupNextTask(groupName);
          return payload;
        })
        .catch((error: Error) => {
          handleGroupNextTask(groupName, error);
          return Promise.reject(error);
        });
    }
    return promise;
  }

  function createProxy(groupName: string | null, path: string[] = []): unknown {
    return new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then' && path.length) {
          const r = getData(groupName, path);
          return r.then.bind(r);
        }
        return createProxy(groupName, [...path, String(prop)]);
      },
      apply(_target, _thisArg, argumentsList) {
        return getData(groupName, path, argumentsList);
      },
    });
  }

  function onMessage(msg: Msg2CallMessage) {
    if (!msg?.name) return;
    if (msg.path?.length) {
      void handleResponseData(msg.name, msg.path.slice(), (msg.data as unknown[]) || []);
    } else {
      const handler = events.get(msg.name);
      if (handler) handler(msg.error ?? null, msg.data);
    }
  }

  function destroy() {
    for (const handler of events.values()) handler('destroy', undefined);
    events.clear();
    // Fail any queued group tasks so destroy does not leave orphan waiters until timeout.
    for (const group of queueGroups.values()) {
      const pending = group.queue.splice(0);
      group.handling = false;
      const err = new Error('destroy');
      for (const [, reject] of pending) {
        try {
          reject(err);
        } catch {
          /* ignore */
        }
      }
    }
    queueGroups.clear();
  }

  return {
    remote: createProxy(null) as Record<string, (...args: unknown[]) => Promise<unknown>>,
    createQueueRemote(groupName: string) {
      queueGroups.set(groupName, { handling: false, queue: [] });
      return createProxy(groupName) as Record<string, (...args: unknown[]) => Promise<unknown>>;
    },
    message: onMessage,
    destroy,
  };
}
